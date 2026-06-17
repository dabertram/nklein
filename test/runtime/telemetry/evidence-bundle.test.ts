import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEvidenceBundle, resolveEvidenceBundleRoot } from "../../../src/telemetry/evidence-bundle";

async function createBundleRoot(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "kanban-evidence-bundle-"));
}

describe("evidence bundle", () => {
	it("resolves the default dev-runs root", () => {
		expect(resolveEvidenceBundleRoot()).toContain(join(".cline", "kanban", "dev-runs"));
	});

	it("writes a stable evidence bundle layout", async () => {
		const rootDir = await createBundleRoot();
		const result = await createEvidenceBundle({
			rootDir,
			scenario: "Small Model @ 8k",
			startedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
			finishedAt: Date.UTC(2026, 0, 2, 3, 5, 6),
			outcome: "passed",
			summary: "Agent completed the smoke task.",
			models: ["ollama:qwen3.5-9b"],
			metrics: [
				{ label: "tokens in", value: 1200 },
				{ label: "wall time ms", value: 3400 },
			],
			transcripts: [
				{
					taskId: "task-1",
					title: "Smoke task",
					messages: [{ role: "assistant", content: "Done" }],
				},
			],
			diffPatch: "diff --git a/a.ts b/a.ts\n",
			telemetryEvents: [{ type: "run", status: "passed" }],
			configSnapshot: { modelRoles: { worker: "ollama:qwen3.5-9b" } },
			evalResult: { status: "passed", command: "npm test", exitCode: 0 },
		});

		expect(result.bundlePath).toBe(join(rootDir, "small-model-8k-2026-01-02T03-04-05-000Z"));
		expect(result.files.transcripts).toHaveLength(1);
		await expect(readFile(result.files.summary, "utf8")).resolves.toContain("Agent completed the smoke task.");
		await expect(readFile(result.files.telemetry, "utf8")).resolves.toBe('{"type":"run","status":"passed"}\n');
		await expect(readFile(result.files.configSnapshot, "utf8")).resolves.toContain("modelRoles");
		await expect(readFile(result.files.evalResult, "utf8")).resolves.toContain('"status": "passed"');
		await expect(readFile(result.files.diffPatch ?? "", "utf8")).resolves.toContain("diff --git");
		await expect(readFile(result.files.transcripts[0] ?? "", "utf8")).resolves.toContain("Smoke task");
	});

	it("creates skipped eval and empty telemetry files when optional data is absent", async () => {
		const rootDir = await createBundleRoot();
		const result = await createEvidenceBundle({
			rootDir,
			scenario: "",
			startedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
			outcome: "unknown",
		});

		expect(result.bundlePath).toBe(join(rootDir, "scenario-2026-01-02T03-04-05-000Z"));
		await expect(readFile(result.files.telemetry, "utf8")).resolves.toBe("");
		await expect(readFile(result.files.evalResult, "utf8")).resolves.toContain('"status": "skipped"');
		expect(result.files.diffPatch).toBeNull();
	});
});
