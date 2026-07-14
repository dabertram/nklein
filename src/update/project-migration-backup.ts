import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
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

/** The marker file the backup writes inside the backup dir — excluded when restoring so it never pollutes the home. */
export const MIGRATION_BACKUP_RECORD_FILENAME = "migration-backup.json";

export type ProjectMigrationRollbackPlan =
	| { canRollback: true; backupPath: string; restoreTo: string }
	| { canRollback: false; reason: "rollback_not_supported" };

/**
 * Pure precondition check for a rollback: the recorded migration must have declared `rollbackSupported`. The effectful
 * {@link rollbackProjectMigration} additionally verifies the backup still exists on disk. `restoreTo` defaults to the
 * home the backup was taken from.
 */
export function planProjectMigrationRollback(
	record: ProjectMigrationBackupRecord,
	targetRuntimeHomePath?: string,
): ProjectMigrationRollbackPlan {
	if (!record.rollbackSupported) {
		return { canRollback: false, reason: "rollback_not_supported" };
	}
	return {
		canRollback: true,
		backupPath: record.backupPath,
		restoreTo: targetRuntimeHomePath ?? record.sourceRuntimeHomePath,
	};
}

export type ProjectMigrationRollbackResult =
	| { status: "not_supported"; reason: "rollback_not_supported" }
	| { status: "backup_missing"; backupPath: string }
	| { status: "restored"; restoredTo: string; fromBackupPath: string }
	| { status: "rollback_failed"; message: string };

export interface RollbackProjectMigrationOptions {
	record: ProjectMigrationBackupRecord;
	/** Where to restore the backup to; defaults to the home the backup was taken from. */
	targetRuntimeHomePath?: string;
}

/**
 * Restore a runtime home from a migration backup (the rollback half of F5.6). Fails closed: rolls back only when the
 * record declared `rollbackSupported` AND the backup directory still exists. Overwrites the target home from the backup,
 * then removes the stray backup-record marker so the restored home is byte-clean.
 */
export async function rollbackProjectMigration(
	options: RollbackProjectMigrationOptions,
): Promise<ProjectMigrationRollbackResult> {
	const plan = planProjectMigrationRollback(options.record, options.targetRuntimeHomePath);
	if (!plan.canRollback) {
		return { status: "not_supported", reason: plan.reason };
	}

	const backupExists = await stat(plan.backupPath)
		.then((stats) => stats.isDirectory())
		.catch(() => false);
	if (!backupExists) {
		return { status: "backup_missing", backupPath: plan.backupPath };
	}

	try {
		await mkdir(path.dirname(plan.restoreTo), { recursive: true });
		await cp(plan.backupPath, plan.restoreTo, { recursive: true, force: true });
		// The backup dir carries the record marker; drop it from the restored home so rollback is idempotent + clean.
		await rm(path.join(plan.restoreTo, MIGRATION_BACKUP_RECORD_FILENAME), { force: true });
		return { status: "restored", restoredTo: plan.restoreTo, fromBackupPath: plan.backupPath };
	} catch (error) {
		return {
			status: "rollback_failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
