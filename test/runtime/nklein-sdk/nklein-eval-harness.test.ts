import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runNKleinDevSmokeEval } from "../../../src/nklein-sdk/nklein-eval-harness";

async function createTempDir(prefix: string): Promise<string> {
	return await mkdtemp(join(tmpdir(), prefix));
}

describe("nklein eval harness", () => {
	it("runs the dev smoke fixture and writes an evidence bundle", async () => {
		const parentDir = await createTempDir("kanban-eval-workspace-");
		const evidenceRootDir = await createTempDir("kanban-eval-evidence-");
		const telemetryRootDir = await createTempDir("kanban-eval-telemetry-");
		await mkdir(telemetryRootDir, { recursive: true });
		await writeFile(
			join(telemetryRootDir, "2026-01-02.jsonl"),
			[
				JSON.stringify({
					schemaVersion: 1,
					signal: "context_overflow",
					severity: "warning",
					message: "Pre-send context guard compacted the prompt.",
					taskId: "task-1",
					providerId: "ollama",
					modelId: "qwen3.5-9b",
					createdAt: Date.UTC(2026, 0, 2, 3, 4, 7),
				}),
				JSON.stringify({
					schemaVersion: 1,
					signal: "runtime_error",
					severity: "error",
					message: "NKlein stream inactivity timeout after 60 seconds",
					taskId: "task-1",
					createdAt: Date.UTC(2026, 0, 2, 3, 4, 7),
				}),
				JSON.stringify({
					schemaVersion: 1,
					signal: "runtime_error",
					severity: "error",
					message: "Unrelated runtime issue",
					taskId: "task-1",
					createdAt: Date.UTC(2026, 0, 2, 3, 4, 7),
				}),
			].join("\n"),
			"utf8",
		);
		let now = Date.UTC(2026, 0, 2, 3, 4, 5);
		const recordCapability = vi.fn(async () => {});
		const result = await runNKleinDevSmokeEval({
			parentDir,
			evidenceRootDir,
			telemetryRootDir,
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
		expect(summary).toContain("ollama:qwen3.5-9b @ http://127.0.0.1:11434");
		expect(summary).toContain("context overflow signals: 1");
		expect(summary).toContain("timeout runtime signals: 1");
		const telemetry = await readFile(join(result.evidenceBundlePath, "telemetry.jsonl"), "utf8");
		expect(telemetry).toContain("context_overflow");
		expect(telemetry).toContain("stream inactivity timeout");
		expect(telemetry).not.toContain("Unrelated runtime issue");
		const configSnapshot = await readFile(join(result.evidenceBundlePath, "config-snapshot.json"), "utf8");
		expect(configSnapshot).toContain('"localModel"');
	});
});
