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
			workspacePath: "/Users/david/GIT/nklein",
			metadata: {
				apiKey: "sk-abc123456789999",
				aws: "AKIA1234567890ABCDEF",
				filePath: "/Users/david/GIT/nklein/src/index.ts",
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

	it("filters telemetry reads by workspace path", async () => {
		const rootDir = await createTelemetryRoot();
		const sink = new LocalSelfObservationSink({ rootDir });

		await sink.record({
			signal: "runtime_error",
			severity: "error",
			message: "First workspace",
			taskId: "shared-task",
			workspacePath: "/tmp/workspace-a",
			createdAt: Date.UTC(2026, 0, 4, 1, 0, 0),
		});
		await sink.record({
			signal: "runtime_error",
			severity: "error",
			message: "Second workspace",
			taskId: "shared-task",
			workspacePath: "/tmp/workspace-b",
			createdAt: Date.UTC(2026, 0, 4, 2, 0, 0),
		});

		const events = await readSelfObservationEvents({
			rootDir,
			taskId: "shared-task",
			workspacePath: "/tmp/workspace-b",
			limit: 5,
		});

		expect(events.map((event) => event.message)).toEqual(["Second workspace"]);
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

describe("token COUNTS are preserved while token CREDENTIALS stay redacted", () => {
	/**
	 * The bug (2026-07-30): `SECRET_KEY_PATTERN` contains the substring `token`, so `inputTokens`,
	 * `outputTokens`, `cacheReadTokens` and friends were all written as `"[REDACTED]"`. Every token count !Klein
	 * had ever recorded was unusable, and nothing failed loudly — it surfaced only when an analysis tried to use
	 * them and concluded, wrongly, that the provider had reported nothing.
	 *
	 * These tests are weighted toward the SECURITY side: the exemption must be narrow, so most of what follows
	 * asserts that credentials are still destroyed.
	 */
	async function writeAndRead(metadata: Record<string, unknown>) {
		const rootDir = await createTelemetryRoot();
		const sink = new LocalSelfObservationSink({ rootDir, now: () => Date.UTC(2026, 6, 30, 12) });
		await sink.record({ signal: "custom", severity: "info", message: "usage", metadata });
		const [event] = await readSelfObservationEvents({ rootDir, limit: 10 });
		return (event?.metadata ?? {}) as Record<string, unknown>;
	}

	it("preserves NUMERIC token measurements in every spelling the codebase uses", async () => {
		// These names were taken from an exhaustive sweep of 521 telemetry metadata keys: 19 distinct measurement
		// keys were being destroyed, not the four the bug was first noticed through. The spellings vary wildly
		// (camelCase, snake_case, plural, suffixed, a timestamp), which is exactly why the rule keys off VALUE TYPE
		// rather than a list of blessed names — an allow-list would silently drop the next new one.
		const metadata = await writeAndRead({
			inputTokens: 4231,
			outputTokens: 512,
			cacheReadTokens: 3000,
			cacheWriteTokens: 0,
			reasoningTokenCount: 88,
			tokens: 17,
			max_tokens: 8192,
			maxTokensPerTurn: 4096,
			tokensFreed: 1200,
			lastTokenAt: 1_785_369_600_000,
			compactedHistoryTokens: 60_000,
		});
		expect(metadata.inputTokens).toBe(4231);
		expect(metadata.outputTokens).toBe(512);
		expect(metadata.cacheReadTokens).toBe(3000);
		expect(metadata.cacheWriteTokens).toBe(0);
		expect(metadata.reasoningTokenCount).toBe(88);
		expect(metadata.tokens).toBe(17);
		expect(metadata.max_tokens).toBe(8192);
		expect(metadata.maxTokensPerTurn).toBe(4096);
		expect(metadata.tokensFreed).toBe(1200);
		expect(metadata.lastTokenAt).toBe(1_785_369_600_000);
		expect(metadata.compactedHistoryTokens).toBe(60_000);
	});

	it("STILL redacts every credential spelling of token", async () => {
		// The exemption keys off a camelCase COUNT shape; credential spellings have no compound-word boundary.
		const metadata = await writeAndRead({
			token: "sk-live-abcdef",
			access_token: "ya29.abcdef",
			refresh_token: "1//abcdef",
			auth_token: "Bearer abcdef",
			apiToken: "abcdef",
			// A REAL credential in this codebase, confirmed by the key sweep — it must not be rescued.
			egressIdentityToken: "eyJhbGciOi",
		});
		for (const key of ["token", "access_token", "refresh_token", "auth_token", "apiToken", "egressIdentityToken"]) {
			expect(metadata[key], `${key} leaked a credential`).toBe("[REDACTED]");
		}
	});

	it("STILL redacts a count-shaped key whose value is a STRING — value type earning its keep", async () => {
		// A secret smuggled under a measurement-shaped key must not survive: every credential spelling is a string,
		// so a string under ANY token key is treated as one.
		const metadata = await writeAndRead({ inputTokens: "sk-live-not-a-number", outputTokens: 12 });
		expect(metadata.inputTokens).toBe("[REDACTED]");
		expect(metadata.outputTokens).toBe(12);
	});

	it("STILL redacts non-finite numbers under a count-shaped key", async () => {
		// NaN/Infinity are not measurements; they are also not credentials, but preserving them would mean the
		// exemption is looser than "a real count".
		const metadata = await writeAndRead({ inputTokens: Number.NaN, outputTokens: Number.POSITIVE_INFINITY });
		expect(metadata.inputTokens).toBe("[REDACTED]");
		expect(metadata.outputTokens).toBe("[REDACTED]");
	});

	it("leaves the OTHER secret families completely untouched", async () => {
		const metadata = await writeAndRead({
			apiKey: "abc",
			password: "hunter2",
			secret: "s",
			authorization: "Bearer x",
		});
		for (const key of ["apiKey", "password", "secret", "authorization"]) {
			expect(metadata[key], `${key} must remain redacted`).toBe("[REDACTED]");
		}
	});
});
