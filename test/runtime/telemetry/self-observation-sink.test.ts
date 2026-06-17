import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalSelfObservationSink, resolveSelfObservationLogPath } from "../../../src/telemetry/self-observation-sink";

async function createTelemetryRoot(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "kanban-self-observation-"));
}

describe("self observation sink", () => {
	it("resolves one JSONL file per UTC day", async () => {
		const rootDir = await createTelemetryRoot();
		const timestamp = Date.UTC(2026, 0, 2, 3, 4, 5);

		expect(resolveSelfObservationLogPath(rootDir, timestamp)).toBe(join(rootDir, "2026-01-02.jsonl"));
	});

	it("appends redacted local telemetry events", async () => {
		const rootDir = await createTelemetryRoot();
		const timestamp = Date.UTC(2026, 0, 2, 3, 4, 5);
		const sink = new LocalSelfObservationSink({
			rootDir,
			now: () => timestamp,
		});

		await sink.record({
			signal: "provider_error",
			severity: "error",
			message: "Provider failed with bearer sk-secretSECRET1234",
			taskId: " task-1 ",
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			workspacePath: "/Users/david/GIT/kanban",
			metadata: {
				apiKey: "sk-abc123456789999",
				nested: {
					message: "bearer ghp_abcdefghijklmnop",
				},
			},
		});
		await sink.record({
			signal: "slow_turn",
			severity: "warning",
			message: "Slow turn",
		});

		const lines = (await readFile(join(rootDir, "2026-01-02.jsonl"), "utf8")).trim().split("\n");
		expect(lines).toHaveLength(2);
		const first = JSON.parse(lines[0] ?? "{}") as {
			message: string;
			taskId: string;
			metadata: { apiKey: string; nested: { message: string } };
		};
		expect(first.taskId).toBe("task-1");
		expect(first.message).toContain("[REDACTED]");
		expect(first.metadata.apiKey).toBe("[REDACTED]");
		expect(first.metadata.nested.message).toContain("[REDACTED]");
	});

	it("uses the event timestamp for log routing", async () => {
		const rootDir = await createTelemetryRoot();
		const sink = new LocalSelfObservationSink({
			rootDir,
			now: () => Date.UTC(2026, 0, 2, 3, 4, 5),
		});

		await sink.record({
			signal: "custom",
			severity: "info",
			message: "Backfilled event",
			createdAt: Date.UTC(2026, 0, 3, 3, 4, 5),
		});

		await expect(readFile(join(rootDir, "2026-01-03.jsonl"), "utf8")).resolves.toContain("Backfilled event");
	});
});
