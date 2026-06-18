import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLegacyNameMigrationMarker, runLegacyNameMigration } from "../../../src/config/legacy-name-migration";
import { resolveLegacyKanbanRuntimeHomePath, resolveNkleinRuntimeHomePath } from "../../../src/config/runtime-paths";

const tempDirs: string[] = [];

async function createTempHome(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "kanban-legacy-name-migration-"));
	tempDirs.push(path);
	return path;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(async (path) => rm(path, { recursive: true, force: true })));
});

describe("legacy name migration", () => {
	it("moves legacy Kanban runtime files into the nklein runtime home and writes a marker", async () => {
		const homePath = await createTempHome();
		const legacyRootPath = resolveLegacyKanbanRuntimeHomePath(homePath);
		const currentRootPath = resolveNkleinRuntimeHomePath(homePath);
		mkdirSync(join(legacyRootPath, "plans", "demo"), { recursive: true });
		mkdirSync(join(legacyRootPath, "telemetry"), { recursive: true });
		mkdirSync(join(legacyRootPath, "dev-runs", "sample"), { recursive: true });
		writeFileSync(join(legacyRootPath, "config.json"), '{"theme":"graphite"}\n', "utf8");
		writeFileSync(join(legacyRootPath, "code-index-v1.json"), '{"ok":true}\n', "utf8");
		writeFileSync(join(legacyRootPath, "plans", "demo", "plan.md"), "# Plan\n", "utf8");
		writeFileSync(join(legacyRootPath, "telemetry", "2026-06-17.jsonl"), '{"event":1}\n', "utf8");
		writeFileSync(join(legacyRootPath, "dev-runs", "sample", "summary.md"), "# Summary\n", "utf8");

		const logs: string[] = [];
		const result = await runLegacyNameMigration({
			homePath,
			now: () => Date.UTC(2026, 5, 18, 12, 0, 0),
			log: (message) => logs.push(message),
		});

		expect(result.attempted).toBe(true);
		expect(result.skipReason).toBeNull();
		expect(result.failures).toEqual([]);
		expect(result.migratedEntries.sort()).toEqual([
			"code-index-v1.json",
			"config.json",
			"dev-runs",
			"plans",
			"telemetry",
		]);
		expect(existsSync(join(currentRootPath, "config.json"))).toBe(true);
		expect(existsSync(join(currentRootPath, "code-index-v1.json"))).toBe(true);
		expect(existsSync(join(currentRootPath, "plans", "demo", "plan.md"))).toBe(true);
		expect(existsSync(join(currentRootPath, "telemetry", "2026-06-17.jsonl"))).toBe(true);
		expect(existsSync(join(currentRootPath, "dev-runs", "sample", "summary.md"))).toBe(true);
		expect(existsSync(join(legacyRootPath, "config.json"))).toBe(false);
		expect(existsSync(result.markerPath)).toBe(true);
		expect(readFileSync(result.markerPath, "utf8")).toContain("migratedEntries");
		expect(logs[0]).toContain("Legacy Kanban runtime migration");
	});

	it("is idempotent after the marker is written", async () => {
		const homePath = await createTempHome();
		const currentRootPath = resolveNkleinRuntimeHomePath(homePath);
		mkdirSync(currentRootPath, { recursive: true });
		writeFileSync(join(currentRootPath, "migrated-from-kanban"), '{"done":true}\n', "utf8");

		const result = await runLegacyNameMigration({ homePath });

		expect(result.attempted).toBe(false);
		expect(result.skipReason).toBe("already_migrated");
		expect(await readLegacyNameMigrationMarker(result.markerPath)).toContain('"done":true');
	});
});
