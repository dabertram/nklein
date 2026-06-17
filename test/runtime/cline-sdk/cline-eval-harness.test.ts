import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runClineDevSmokeEval } from "../../../src/cline-sdk/cline-eval-harness";

async function createTempDir(prefix: string): Promise<string> {
	return await mkdtemp(join(tmpdir(), prefix));
}

describe("cline eval harness", () => {
	it("runs the dev smoke fixture and writes an evidence bundle", async () => {
		const parentDir = await createTempDir("kanban-eval-workspace-");
		const evidenceRootDir = await createTempDir("kanban-eval-evidence-");
		let now = Date.UTC(2026, 0, 2, 3, 4, 5);
		const recordCapability = vi.fn(async () => {});
		const result = await runClineDevSmokeEval({
			parentDir,
			evidenceRootDir,
			initializeGit: false,
			modelObservation: {
				providerId: "ollama",
				modelId: "qwen3.5-9b",
				endpoint: "http://127.0.0.1:11434",
			},
			recordCapability,
			now: () => {
				now += 1_000;
				return now;
			},
		});

		expect(result.passed).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.acceptanceCommand).toBe("npm test");
		expect(result.workspacePath.startsWith(parentDir)).toBe(true);
		expect(recordCapability).toHaveBeenCalledWith({
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			endpoint: "http://127.0.0.1:11434",
			passed: true,
			score: 100,
			createdAt: Date.UTC(2026, 0, 2, 3, 4, 8),
		});
		const evalJson = await readFile(join(result.evidenceBundlePath, "eval.json"), "utf8");
		expect(evalJson).toContain('"status": "passed"');
		expect(evalJson).toContain('"capabilityScore": 100');
		expect(evalJson).toContain("calculates a bounded habit score");
		const summary = await readFile(join(result.evidenceBundlePath, "summary.md"), "utf8");
		expect(summary).toContain("Dev smoke eval passed.");
	});
});
