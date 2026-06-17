import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runClineDevSmokeEval } from "../../../src/cline-sdk/cline-eval-harness";

async function createTempDir(prefix: string): Promise<string> {
	return await mkdtemp(join(tmpdir(), prefix));
}

describe("cline eval harness", () => {
	it("runs the dev smoke fixture and writes an evidence bundle", async () => {
		const parentDir = await createTempDir("kanban-eval-workspace-");
		const evidenceRootDir = await createTempDir("kanban-eval-evidence-");
		let now = Date.UTC(2026, 0, 2, 3, 4, 5);
		const result = await runClineDevSmokeEval({
			parentDir,
			evidenceRootDir,
			initializeGit: false,
			now: () => {
				now += 1_000;
				return now;
			},
		});

		expect(result.passed).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.acceptanceCommand).toBe("npm test");
		expect(result.workspacePath.startsWith(parentDir)).toBe(true);
		const evalJson = await readFile(join(result.evidenceBundlePath, "eval.json"), "utf8");
		expect(evalJson).toContain('"status": "passed"');
		expect(evalJson).toContain("calculates a bounded habit score");
		const summary = await readFile(join(result.evidenceBundlePath, "summary.md"), "utf8");
		expect(summary).toContain("Dev smoke eval passed.");
	});
});
