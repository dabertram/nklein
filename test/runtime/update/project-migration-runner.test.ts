import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isProjectMigrationAccepted, runProjectMigrations } from "../../../src/update/project-migration-runner";

const tempRoots: string[] = [];

async function makeFixture(index: unknown): Promise<{
	root: string;
	runtimeHomePath: string;
	backupRootPath: string;
	journalPath: string;
	indexPath: string;
}> {
	const root = await mkdir(path.join(tmpdir(), `nklein-migration-runner-${Date.now()}-${Math.random()}`), {
		recursive: true,
	});
	if (!root) throw new Error("mkdir did not return a path");
	tempRoots.push(root);
	const runtimeHomePath = path.join(root, "nklein");
	const indexPath = path.join(runtimeHomePath, "workspaces", "index.json");
	await mkdir(path.dirname(indexPath), { recursive: true });
	await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
	await writeFile(path.join(runtimeHomePath, "config.json"), '{"preserved":true}\n', "utf8");
	return {
		root,
		runtimeHomePath,
		backupRootPath: path.join(root, "migration-recovery", "backups"),
		journalPath: path.join(root, "migration-recovery", "journal.json"),
		indexPath,
	};
}

function legacyIndex(): unknown {
	return {
		version: 1,
		entries: {
			alpha: { workspaceId: "alpha", repoPath: "/repos/alpha", autoResumeEnabled: true },
			beta: { workspaceId: "beta", repoPath: "/repos/beta" },
		},
		repoPathToId: { "/repos/alpha": "alpha", "/repos/beta": "beta" },
	};
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runProjectMigrations", () => {
	it("backs up, applies, durably accepts, and journals the first real schema migration", async () => {
		const fixture = await makeFixture(legacyIndex());
		const result = await runProjectMigrations({ ...fixture, now: () => new Date("2026-07-22T09:00:00.000Z") });

		expect(result.status).toBe("accepted");
		expect(isProjectMigrationAccepted(result)).toBe(true);
		const migrated = JSON.parse(await readFile(fixture.indexPath, "utf8"));
		expect(migrated).toMatchObject({
			version: 2,
			entries: { alpha: { autoResumeEnabled: true }, beta: { autoResumeEnabled: false } },
		});
		const journal = JSON.parse(await readFile(fixture.journalPath, "utf8"));
		expect(journal).toMatchObject({ state: "completed", fromVersion: 1, toVersion: 2 });
		expect(await stat(journal.backupRecord.backupPath)).toBeTruthy();
		expect(
			JSON.parse(await readFile(path.join(journal.backupRecord.backupPath, "workspaces", "index.json"), "utf8")),
		).toEqual(legacyIndex());
	});

	it("rolls back a failed acceptance by replacement, then resumes idempotently on restart", async () => {
		const fixture = await makeFixture(legacyIndex());
		const failed = await runProjectMigrations({
			...fixture,
			beforeAcceptance: async () => {
				await writeFile(path.join(fixture.runtimeHomePath, "bad-new-file"), "must roll back", "utf8");
				throw new Error("simulated update acceptance failure");
			},
		});
		expect(failed).toMatchObject({ status: "rejected", rollbackStatus: "restored" });
		expect(JSON.parse(await readFile(fixture.indexPath, "utf8"))).toEqual(legacyIndex());
		await expect(stat(path.join(fixture.runtimeHomePath, "bad-new-file"))).rejects.toThrow();

		const resumed = await runProjectMigrations(fixture);
		expect(resumed).toMatchObject({ status: "accepted", resumed: true, currentVersion: 2 });
		expect(JSON.parse(await readFile(fixture.journalPath, "utf8"))).toMatchObject({ state: "completed" });
	});

	it("finishes an interrupted acceptance journal without reapplying or taking another backup", async () => {
		const fixture = await makeFixture(legacyIndex());
		const first = await runProjectMigrations(fixture);
		if (first.status !== "accepted") throw new Error("expected accepted migration");
		await writeFile(
			fixture.journalPath,
			`${JSON.stringify({ ...first.journal, state: "accepting" }, null, 2)}\n`,
			"utf8",
		);

		const resumed = await runProjectMigrations(fixture);
		expect(resumed).toMatchObject({ status: "accepted", resumed: true, currentVersion: 2 });
		expect(JSON.parse(await readFile(fixture.journalPath, "utf8"))).toMatchObject({ state: "completed" });
	});

	it("takes a fresh backup when a completed migration is followed by a new version-1 attempt", async () => {
		const fixture = await makeFixture(legacyIndex());
		const first = await runProjectMigrations(fixture);
		if (first.status !== "accepted") throw new Error("expected accepted migration");

		await writeFile(fixture.indexPath, `${JSON.stringify(legacyIndex(), null, 2)}\n`, "utf8");
		await writeFile(path.join(fixture.runtimeHomePath, "created-after-first-migration"), "preserve me", "utf8");
		const second = await runProjectMigrations({
			...fixture,
			beforeAcceptance: async () => {
				throw new Error("reject second migration attempt");
			},
		});

		expect(second).toMatchObject({ status: "rejected", rollbackStatus: "restored" });
		expect(await readFile(path.join(fixture.runtimeHomePath, "created-after-first-migration"), "utf8")).toBe(
			"preserve me",
		);
		if (second.status !== "rejected" || !second.journal) throw new Error("expected rejected journal");
		expect(second.journal.backupRecord.backupPath).not.toBe(first.journal.backupRecord.backupPath);
	});

	it("uses the external journal to recover when the live index disappeared mid-migration", async () => {
		const fixture = await makeFixture(legacyIndex());
		const first = await runProjectMigrations(fixture);
		if (first.status !== "accepted") throw new Error("expected accepted migration");
		await writeFile(
			fixture.journalPath,
			`${JSON.stringify({ ...first.journal, state: "applying" }, null, 2)}\n`,
			"utf8",
		);
		await rm(fixture.indexPath, { force: true });

		const recovered = await runProjectMigrations(fixture);
		expect(recovered).toMatchObject({ status: "rejected", rollbackStatus: "restored" });
		expect(JSON.parse(await readFile(fixture.indexPath, "utf8"))).toEqual(legacyIndex());
	});

	it("fails closed and restores the original home when a version-1 payload is structurally invalid", async () => {
		const invalid = { version: 1, entries: { alpha: "not-an-entry" }, repoPathToId: {} };
		const fixture = await makeFixture(invalid);
		const result = await runProjectMigrations(fixture);
		expect(result).toMatchObject({ status: "rejected", rollbackStatus: "restored" });
		expect(isProjectMigrationAccepted(result)).toBe(false);
		expect(JSON.parse(await readFile(fixture.indexPath, "utf8"))).toEqual(invalid);
	});

	it("accepts an already-current valid index without creating recovery artifacts", async () => {
		const fixture = await makeFixture({
			version: 2,
			entries: { alpha: { workspaceId: "alpha", repoPath: "/repos/alpha", autoResumeEnabled: false } },
			repoPathToId: { "/repos/alpha": "alpha" },
		});
		const result = await runProjectMigrations(fixture);
		expect(result).toEqual({ status: "not_required", currentVersion: 2 });
		await expect(stat(fixture.journalPath)).rejects.toThrow();
	});

	it("fails closed on malformed recovery state instead of overwriting the only journal", async () => {
		const fixture = await makeFixture(legacyIndex());
		await mkdir(path.dirname(fixture.journalPath), { recursive: true });
		await writeFile(fixture.journalPath, '{"schemaVersion":1,"migrationId":"other"}\n', "utf8");

		const result = await runProjectMigrations(fixture);
		expect(result).toMatchObject({ status: "rejected", rollbackStatus: "not_attempted" });
		expect(await readFile(fixture.journalPath, "utf8")).toBe('{"schemaVersion":1,"migrationId":"other"}\n');
		expect(JSON.parse(await readFile(fixture.indexPath, "utf8"))).toEqual(legacyIndex());
	});

	it("rejects a journal whose backup path escapes the configured recovery root", async () => {
		const fixture = await makeFixture(legacyIndex());
		const first = await runProjectMigrations(fixture);
		if (first.status !== "accepted") throw new Error("expected accepted migration");
		await writeFile(
			fixture.journalPath,
			`${JSON.stringify(
				{
					...first.journal,
					state: "applying",
					backupRecord: { ...first.journal.backupRecord, backupPath: path.join(fixture.root, "outside") },
				},
				null,
				2,
			)}\n`,
			"utf8",
		);

		const result = await runProjectMigrations(fixture);
		expect(result).toMatchObject({ status: "rejected", rollbackStatus: "not_attempted" });
	});
});
