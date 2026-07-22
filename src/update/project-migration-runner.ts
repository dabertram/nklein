import { readFile } from "node:fs/promises";
import path from "node:path";
import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath } from "../state/workspace-state-paths";
import { INDEX_VERSION, workspaceIndexFileSchema } from "../state/workspace-state-schema";
import {
	type ProjectMigrationBackupRecord,
	prepareProjectMigrationBackup,
	rollbackProjectMigration,
} from "./project-migration-backup";

export const PROJECT_MIGRATION_JOURNAL_SCHEMA_VERSION = 1;
export const WORKSPACE_INDEX_V2_MIGRATION_ID = "workspace-index-v1-to-v2";

export type ProjectMigrationJournalState =
	| "backup_created"
	| "applying"
	| "accepting"
	| "completed"
	| "rolling_back"
	| "rolled_back";

export interface ProjectMigrationJournal {
	schemaVersion: 1;
	migrationId: string;
	fromVersion: number;
	toVersion: number;
	state: ProjectMigrationJournalState;
	runtimeHomePath: string;
	indexPath: string;
	backupRecord: ProjectMigrationBackupRecord;
	startedAt: string;
	updatedAt: string;
	error?: string;
}

export type ProjectMigrationRunResult =
	| { status: "not_required"; currentVersion: number | null }
	| { status: "accepted"; currentVersion: number; resumed: boolean; journal: ProjectMigrationJournal }
	| {
			status: "rejected";
			message: string;
			rollbackStatus: "not_attempted" | "restored" | "failed";
			journal?: ProjectMigrationJournal;
	  };

export interface RunProjectMigrationsOptions {
	runtimeHomePath?: string;
	backupRootPath?: string;
	journalPath?: string;
	now?: () => Date;
	/** Test seam invoked after the migrated file is written but before acceptance re-reads it. */
	beforeAcceptance?: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
	try {
		return JSON.parse(await readFile(filePath, "utf8")) as unknown;
	} catch (error) {
		if (isRecord(error) && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function parseJournal(value: unknown): ProjectMigrationJournal | null {
	if (
		!isRecord(value) ||
		value.schemaVersion !== PROJECT_MIGRATION_JOURNAL_SCHEMA_VERSION ||
		value.migrationId !== WORKSPACE_INDEX_V2_MIGRATION_ID ||
		typeof value.fromVersion !== "number" ||
		typeof value.toVersion !== "number" ||
		typeof value.state !== "string" ||
		typeof value.runtimeHomePath !== "string" ||
		typeof value.indexPath !== "string" ||
		!isRecord(value.backupRecord) ||
		typeof value.backupRecord.backupPath !== "string" ||
		typeof value.backupRecord.sourceRuntimeHomePath !== "string" ||
		value.backupRecord.rollbackSupported !== true ||
		typeof value.startedAt !== "string" ||
		typeof value.updatedAt !== "string"
	) {
		return null;
	}
	const states: ProjectMigrationJournalState[] = [
		"backup_created",
		"applying",
		"accepting",
		"completed",
		"rolling_back",
		"rolled_back",
	];
	if (!states.includes(value.state as ProjectMigrationJournalState)) {
		return null;
	}
	return value as unknown as ProjectMigrationJournal;
}

function migrateWorkspaceIndexV1ToV2(value: unknown): unknown {
	if (!isRecord(value) || value.version !== 1 || !isRecord(value.entries) || !isRecord(value.repoPathToId)) {
		throw new Error("Workspace index is not a structurally valid version-1 index.");
	}
	const entries: Record<string, unknown> = {};
	for (const [workspaceId, rawEntry] of Object.entries(value.entries)) {
		if (!isRecord(rawEntry)) {
			throw new Error(`Workspace index entry ${workspaceId} is not an object.`);
		}
		entries[workspaceId] = { ...rawEntry, autoResumeEnabled: rawEntry.autoResumeEnabled === true };
	}
	return { ...value, version: 2, entries };
}

function assertAcceptedWorkspaceIndex(value: unknown): void {
	const accepted = workspaceIndexFileSchema.safeParse(value);
	if (!accepted.success) {
		throw new Error(`Migrated workspace index failed acceptance: ${accepted.error.message}`);
	}
	for (const entry of Object.values(accepted.data.entries)) {
		if (typeof entry.autoResumeEnabled !== "boolean") {
			throw new Error(`Migrated workspace ${entry.workspaceId} has no explicit auto-resume policy.`);
		}
	}
}

function assertExternalBackupPaths(runtimeHomePath: string, backupRootPath: string, journalPath: string): void {
	const runtime = path.resolve(runtimeHomePath);
	for (const candidate of [backupRootPath, journalPath]) {
		const resolved = path.resolve(candidate);
		if (resolved === runtime || resolved.startsWith(`${runtime}${path.sep}`)) {
			throw new Error(`Migration recovery path must be outside the rollback target: ${resolved}`);
		}
	}
}

export function isProjectMigrationAccepted(
	result: ProjectMigrationRunResult,
): result is Exclude<ProjectMigrationRunResult, { status: "rejected" }> {
	return result.status === "not_required" || result.status === "accepted";
}

/**
 * Effectful, restart-safe update migration gate. A journal and full-home backup live outside the rollback target; every
 * mutation is idempotent, acceptance re-reads the durable file, and any post-backup failure restores by replacement.
 * A caller must not accept/start the updated runtime unless this returns `not_required` or `accepted`.
 */
export async function runProjectMigrations(
	options: RunProjectMigrationsOptions = {},
): Promise<ProjectMigrationRunResult> {
	const runtimeHomePath = path.resolve(options.runtimeHomePath ?? getRuntimeHomePath());
	const recoveryRootPath = path.join(path.dirname(runtimeHomePath), "migrations");
	const backupRootPath = path.resolve(options.backupRootPath ?? path.join(recoveryRootPath, "backups"));
	const journalPath = path.resolve(options.journalPath ?? path.join(recoveryRootPath, "project-migration.json"));
	const indexPath = path.join(runtimeHomePath, "workspaces", "index.json");
	const now = options.now ?? (() => new Date());
	assertExternalBackupPaths(runtimeHomePath, backupRootPath, journalPath);

	return await lockedFileSystem.withLocks([{ path: journalPath }, { path: indexPath }], async () => {
		let rawJournal: unknown;
		try {
			rawJournal = await readJsonIfPresent(journalPath);
		} catch (error) {
			return {
				status: "rejected",
				message: `Could not read migration journal: ${error instanceof Error ? error.message : String(error)}`,
				rollbackStatus: "not_attempted",
			};
		}
		let journal = parseJournal(rawJournal);
		if (rawJournal !== null && !journal) {
			return {
				status: "rejected",
				message: `Migration journal is invalid or belongs to an unsupported migration: ${journalPath}`,
				rollbackStatus: "not_attempted",
			};
		}
		if (journal && (journal.runtimeHomePath !== runtimeHomePath || journal.indexPath !== indexPath)) {
			return {
				status: "rejected",
				message: "Migration journal recovery paths do not match the requested runtime home.",
				rollbackStatus: "not_attempted",
				journal,
			};
		}
		if (
			journal &&
			(journal.backupRecord.sourceRuntimeHomePath !== runtimeHomePath ||
				!path.resolve(journal.backupRecord.backupPath).startsWith(`${backupRootPath}${path.sep}`) ||
				journal.backupRecord.fromVersion !== "1" ||
				journal.backupRecord.toVersion !== String(INDEX_VERSION))
		) {
			return {
				status: "rejected",
				message: "Migration journal backup authority does not match the requested migration paths or versions.",
				rollbackStatus: "not_attempted",
				journal,
			};
		}
		const rollbackAndReject = async (
			recoveryJournal: ProjectMigrationJournal,
			message: string,
		): Promise<ProjectMigrationRunResult> => {
			let updatedJournal: ProjectMigrationJournal = {
				...recoveryJournal,
				state: "rolling_back" as const,
				updatedAt: now().toISOString(),
				error: message,
			};
			await lockedFileSystem.writeJsonFileAtomic(journalPath, updatedJournal, { lock: null });
			const rollback = await rollbackProjectMigration({
				record: updatedJournal.backupRecord,
				targetRuntimeHomePath: runtimeHomePath,
			});
			const restored = rollback.status === "restored";
			updatedJournal = { ...updatedJournal, state: "rolled_back", updatedAt: now().toISOString() };
			await lockedFileSystem.writeJsonFileAtomic(journalPath, updatedJournal, { lock: null });
			return {
				status: "rejected",
				message,
				rollbackStatus: restored ? "restored" : "failed",
				journal: updatedJournal,
			};
		};

		let rawIndex: unknown;
		try {
			rawIndex = await readJsonIfPresent(indexPath);
		} catch (error) {
			const message = `Could not read workspace index for migration: ${error instanceof Error ? error.message : String(error)}`;
			if (journal && journal.state !== "completed") {
				return await rollbackAndReject(journal, message);
			}
			return {
				status: "rejected",
				message,
				rollbackStatus: "not_attempted",
			};
		}
		if (rawIndex === null) {
			if (journal && journal.state !== "completed") {
				return await rollbackAndReject(journal, "Workspace index disappeared during an interrupted migration.");
			}
			return { status: "not_required", currentVersion: null };
		}

		const rawVersion = isRecord(rawIndex) && typeof rawIndex.version === "number" ? rawIndex.version : null;
		const resumed = journal !== null && journal.state !== "completed";
		if (rawVersion === INDEX_VERSION) {
			try {
				assertAcceptedWorkspaceIndex(rawIndex);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (journal && journal.state !== "completed") {
					return await rollbackAndReject(journal, message);
				}
				return {
					status: "rejected",
					message,
					rollbackStatus: "not_attempted",
					...(journal ? { journal } : {}),
				};
			}
			if (!journal) {
				return { status: "not_required", currentVersion: INDEX_VERSION };
			}
			if (journal.state !== "completed") {
				journal = { ...journal, state: "completed", updatedAt: now().toISOString(), error: undefined };
				await lockedFileSystem.writeJsonFileAtomic(journalPath, journal, { lock: null });
			}
			return { status: "accepted", currentVersion: INDEX_VERSION, resumed, journal };
		}
		if (rawVersion !== 1) {
			const message = `Unsupported workspace index version ${String(rawVersion)}; expected 1 or ${INDEX_VERSION}.`;
			if (journal && journal.state !== "completed") {
				return await rollbackAndReject(journal, message);
			}
			return {
				status: "rejected",
				message,
				rollbackStatus: "not_attempted",
				...(journal ? { journal } : {}),
			};
		}

		if (
			!journal ||
			journal.state === "completed" ||
			journal.fromVersion !== 1 ||
			journal.toVersion !== INDEX_VERSION
		) {
			const backup = await prepareProjectMigrationBackup({
				runtimeHomePath,
				backupRootPath,
				migration: {
					required: true,
					fromVersion: "1",
					toVersion: String(INDEX_VERSION),
					rollbackSupported: true,
					notes: [WORKSPACE_INDEX_V2_MIGRATION_ID],
				},
				now,
			});
			if (backup.status !== "backup_created") {
				return {
					status: "rejected",
					message:
						backup.status === "backup_failed"
							? `Could not create migration backup: ${backup.message}`
							: "Migration backup was unexpectedly skipped.",
					rollbackStatus: "not_attempted",
				};
			}
			const timestamp = now().toISOString();
			journal = {
				schemaVersion: 1,
				migrationId: WORKSPACE_INDEX_V2_MIGRATION_ID,
				fromVersion: 1,
				toVersion: INDEX_VERSION,
				state: "backup_created",
				runtimeHomePath,
				indexPath,
				backupRecord: backup.record,
				startedAt: timestamp,
				updatedAt: timestamp,
			};
			await lockedFileSystem.writeJsonFileAtomic(journalPath, journal, { lock: null });
		}

		try {
			journal = { ...journal, state: "applying", updatedAt: now().toISOString(), error: undefined };
			await lockedFileSystem.writeJsonFileAtomic(journalPath, journal, { lock: null });
			const migrated = migrateWorkspaceIndexV1ToV2(rawIndex);
			await lockedFileSystem.writeJsonFileAtomic(indexPath, migrated, { lock: null });
			journal = { ...journal, state: "accepting", updatedAt: now().toISOString() };
			await lockedFileSystem.writeJsonFileAtomic(journalPath, journal, { lock: null });
			await options.beforeAcceptance?.();
			assertAcceptedWorkspaceIndex(await readJsonIfPresent(indexPath));
			journal = { ...journal, state: "completed", updatedAt: now().toISOString() };
			await lockedFileSystem.writeJsonFileAtomic(journalPath, journal, { lock: null });
			return { status: "accepted", currentVersion: INDEX_VERSION, resumed, journal };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return await rollbackAndReject(journal, message);
		}
	});
}
