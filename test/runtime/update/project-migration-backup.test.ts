import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	buildProjectMigrationBackupRecord,
	prepareProjectMigrationBackup,
} from "../../../src/update/project-migration-backup";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
	const root = await mkdir(path.join(tmpdir(), `nklein-migration-backup-${Date.now()}-${Math.random()}`), {
		recursive: true,
	});
	if (!root) {
		throw new Error("mkdir did not return a path");
	}
	tempRoots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("buildProjectMigrationBackupRecord", () => {
	it("creates a stable metadata record for a project migration backup", () => {
		expect(
			buildProjectMigrationBackupRecord({
				runtimeHomePath: "/home/user/.nklein/nklein",
				backupPath: "/home/user/.nklein/nklein-backups/backup",
				migration: {
					required: true,
					fromVersion: "0.1.0",
					toVersion: "0.2.0",
					rollbackSupported: true,
					notes: ["workspace-index-v2"],
				},
				now: new Date("2026-07-08T21:00:00.000Z"),
			}),
		).toEqual({
			schemaVersion: 1,
			createdAt: "2026-07-08T21:00:00.000Z",
			fromVersion: "0.1.0",
			toVersion: "0.2.0",
			sourceRuntimeHomePath: "/home/user/.nklein/nklein",
			backupPath: "/home/user/.nklein/nklein-backups/backup",
			rollbackSupported: true,
			notes: ["workspace-index-v2"],
		});
	});
});

describe("prepareProjectMigrationBackup", () => {
	it("skips when no migration or backup is required", async () => {
		const root = await makeTempRoot();
		await expect(
			prepareProjectMigrationBackup({
				runtimeHomePath: path.join(root, "runtime"),
				backupRootPath: path.join(root, "backups"),
				migration: { required: false, toVersion: "0.2.0" },
			}),
		).resolves.toEqual({ status: "not_required", reason: "migration_not_required" });

		await expect(
			prepareProjectMigrationBackup({
				runtimeHomePath: path.join(root, "runtime"),
				backupRootPath: path.join(root, "backups"),
				migration: { required: true, backupRequired: false, toVersion: "0.2.0" },
			}),
		).resolves.toEqual({ status: "not_required", reason: "backup_not_required" });
	});

	it("copies the runtime home and writes a backup record before migration", async () => {
		const root = await makeTempRoot();
		const runtimeHomePath = path.join(root, "runtime-home");
		const backupRootPath = path.join(root, "runtime-backups");
		await mkdir(path.join(runtimeHomePath, "plans"), { recursive: true });
		await writeFile(path.join(runtimeHomePath, "config.json"), '{"ok":true}\n', "utf8");
		await writeFile(path.join(runtimeHomePath, "plans", "workspace-index.json"), '{"projects":[]}\n', "utf8");

		const result = await prepareProjectMigrationBackup({
			runtimeHomePath,
			backupRootPath,
			migration: {
				required: true,
				fromVersion: "0.1.0",
				toVersion: "0.2.0",
				rollbackSupported: true,
				notes: ["workspace-index-v2"],
			},
			now: () => new Date("2026-07-08T21:00:00.000Z"),
		});

		expect(result.status).toBe("backup_created");
		if (result.status !== "backup_created") {
			throw new Error("expected backup_created");
		}
		expect(await readFile(path.join(result.record.backupPath, "config.json"), "utf8")).toBe('{"ok":true}\n');
		expect(await readFile(path.join(result.record.backupPath, "plans", "workspace-index.json"), "utf8")).toBe(
			'{"projects":[]}\n',
		);
		expect(JSON.parse(await readFile(result.recordPath, "utf8"))).toEqual(result.record);
		expect(result.record).toMatchObject({
			createdAt: "2026-07-08T21:00:00.000Z",
			fromVersion: "0.1.0",
			toVersion: "0.2.0",
			sourceRuntimeHomePath: runtimeHomePath,
			rollbackSupported: true,
			notes: ["workspace-index-v2"],
		});
	});

	it("returns backup_failed when the runtime home cannot be copied", async () => {
		const root = await makeTempRoot();
		const result = await prepareProjectMigrationBackup({
			runtimeHomePath: path.join(root, "missing-runtime-home"),
			backupRootPath: path.join(root, "backups"),
			migration: { required: true, toVersion: "0.2.0" },
			now: () => new Date("2026-07-08T21:00:00.000Z"),
		});

		expect(result.status).toBe("backup_failed");
		if (result.status !== "backup_failed") {
			throw new Error("expected backup_failed");
		}
		await expect(stat(path.join(root, "backups"))).resolves.toBeTruthy();
	});
});
