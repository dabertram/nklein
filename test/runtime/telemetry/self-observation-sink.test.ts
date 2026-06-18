import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	LocalSelfObservationSink,
	readSelfObservationEvents,
	resolveSelfObservationLogPath,
} from "../../../src/telemetry/self-observation-sink";

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
				aws: "AKIA1234567890ABCDEF",
				filePath: "/Users/david/GIT/kanban/src/index.ts",
				prompt: "Implement the entire feature with local secrets and long user instructions intact.",
				spec: "# Spec\n\nKeep the full planning document out of telemetry.",
				nested: {
					message: "bearer ghp_abcdefghijklmnop in /private/tmp/workspace/file.ts",
					plan: "# Plan\n\n1. Read all files.\n2. Emit the entire prompt transcript.",
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
			workspacePath: string;
			metadata: {
				apiKey: string;
				aws: string;
				filePath: string;
				prompt: string;
				spec: string;
				nested: { message: string; plan: string };
			};
		};
		expect(first.taskId).toBe("task-1");
		expect(first.workspacePath).toBe("[REDACTED_PATH]");
		expect(first.message).toContain("[REDACTED]");
		expect(first.metadata.apiKey).toBe("[REDACTED]");
		expect(first.metadata.aws).toBe("[REDACTED]");
		expect(first.metadata.filePath).toBe("[REDACTED_PATH]");
		expect(first.metadata.prompt).toBe("[REDACTED_TEXT]");
		expect(first.metadata.spec).toBe("[REDACTED_TEXT]");
		expect(first.metadata.nested.message).toContain("[REDACTED]");
		expect(first.metadata.nested.message).toContain("[REDACTED_PATH]");
		expect(first.metadata.nested.plan).toBe("[REDACTED_TEXT]");
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

	it("reads recent task-scoped telemetry newest first", async () => {
		const rootDir = await createTelemetryRoot();
		const sink = new LocalSelfObservationSink({ rootDir });

		await sink.record({
			signal: "runtime_error",
			severity: "error",
			message: "Older task event",
			taskId: "task-1",
			createdAt: Date.UTC(2026, 0, 2, 3, 0, 0),
		});
		await sink.record({
			signal: "plan_gap",
			severity: "warning",
			message: "Other task event",
			taskId: "task-2",
			createdAt: Date.UTC(2026, 0, 3, 3, 0, 0),
		});
		await sink.record({
			signal: "tool_error",
			severity: "warning",
			message: "Newer task event",
			taskId: "task-1",
			createdAt: Date.UTC(2026, 0, 4, 3, 0, 0),
		});
		await writeFile(join(rootDir, "2026-01-05.jsonl"), "{not json}\n", "utf8");

		const events = await readSelfObservationEvents({ rootDir, taskId: "task-1", limit: 5 });

		expect(events.map((event) => event.message)).toEqual(["Newer task event", "Older task event"]);
		expect(events.every((event) => event.taskId === "task-1")).toBe(true);
	});

	it("limits telemetry reads", async () => {
		const rootDir = await createTelemetryRoot();
		const sink = new LocalSelfObservationSink({ rootDir });

		await sink.record({
			signal: "custom",
			severity: "info",
			message: "First",
			taskId: "task-1",
			createdAt: Date.UTC(2026, 0, 2, 1, 0, 0),
		});
		await sink.record({
			signal: "custom",
			severity: "info",
			message: "Second",
			taskId: "task-1",
			createdAt: Date.UTC(2026, 0, 2, 2, 0, 0),
		});

		await expect(readSelfObservationEvents({ rootDir, taskId: "task-1", limit: 1 })).resolves.toMatchObject([
			{ message: "Second" },
		]);
	});

	it("prunes daily telemetry files outside retention", async () => {
		const rootDir = await createTelemetryRoot();
		await writeFile(join(rootDir, "2025-12-01.jsonl"), "{}\n", "utf8");
		await writeFile(join(rootDir, "2026-01-01.jsonl"), "{}\n", "utf8");
		const sink = new LocalSelfObservationSink({
			rootDir,
			retentionDays: 7,
			now: () => Date.UTC(2026, 0, 10, 3, 4, 5),
		});

		await sink.record({
			signal: "custom",
			severity: "info",
			message: "Fresh event",
		});

		await expect(readdir(rootDir)).resolves.toEqual(["2026-01-10.jsonl"]);
	});
});
