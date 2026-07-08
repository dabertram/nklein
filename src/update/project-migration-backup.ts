import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ProjectUpdateMigrationSpec {
	required: boolean;
	backupRequired?: boolean;
	rollbackSupported?: boolean;
	fromVersion?: string;
	toVersion: string;
	notes?: string[];
}

export interface ProjectMigrationBackupRecord {
	schemaVersion: 1;
	createdAt: string;
	fromVersion: string;
	toVersion: string;
	sourceRuntimeHomePath: string;
	backupPath: string;
	rollbackSupported: boolean;
	notes: string[];
}

export type ProjectMigrationBackupResult =
	| { status: "not_required"; reason: "migration_not_required" | "backup_not_required" }
	| { status: "backup_created"; record: ProjectMigrationBackupRecord; recordPath: string }
	| { status: "backup_failed"; message: string };

export interface PrepareProjectMigrationBackupOptions {
	runtimeHomePath: string;
	backupRootPath: string;
	migration: ProjectUpdateMigrationSpec;
	now?: () => Date;
}

function sanitizeBackupSegment(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9._-]/gu, "_") || "unknown";
}

export function buildProjectMigrationBackupRecord(input: {
	runtimeHomePath: string;
	backupPath: string;
	migration: ProjectUpdateMigrationSpec;
	now: Date;
}): ProjectMigrationBackupRecord {
	return {
		schemaVersion: 1,
		createdAt: input.now.toISOString(),
		fromVersion: input.migration.fromVersion ?? "",
		toVersion: input.migration.toVersion,
		sourceRuntimeHomePath: input.runtimeHomePath,
		backupPath: input.backupPath,
		rollbackSupported: input.migration.rollbackSupported === true,
		notes: input.migration.notes ?? [],
	};
}

export async function prepareProjectMigrationBackup(
	options: PrepareProjectMigrationBackupOptions,
): Promise<ProjectMigrationBackupResult> {
	if (options.migration.required !== true) {
		return { status: "not_required", reason: "migration_not_required" };
	}
	if (options.migration.backupRequired === false) {
		return { status: "not_required", reason: "backup_not_required" };
	}

	const now = options.now?.() ?? new Date();
	const backupName = [
		"nklein-projects",
		sanitizeBackupSegment(options.migration.fromVersion ?? "unknown"),
		"to",
		sanitizeBackupSegment(options.migration.toVersion),
		String(now.getTime()),
	].join("-");
	const backupPath = path.join(options.backupRootPath, backupName);
	const recordPath = path.join(backupPath, "migration-backup.json");

	try {
		await mkdir(options.backupRootPath, { recursive: true });
		await cp(options.runtimeHomePath, backupPath, {
			recursive: true,
			errorOnExist: true,
			force: false,
		});
		const record = buildProjectMigrationBackupRecord({
			runtimeHomePath: options.runtimeHomePath,
			backupPath,
			migration: options.migration,
			now,
		});
		await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
		return { status: "backup_created", record, recordPath };
	} catch (error) {
		return {
			status: "backup_failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
