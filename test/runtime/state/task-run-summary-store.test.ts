import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type RecordTaskRunSummaryInput,
	readTaskRunSummaries,
	recordTaskRunSummary,
	summarizeTimeoutOutcomes,
	type TaskRunSummaryRecord,
} from "../../../src/state/task-run-summary-store";

function baseInput(overrides: Partial<RecordTaskRunSummaryInput> = {}): RecordTaskRunSummaryInput {
	return {
		taskId: "task-1",
		workspacePath: "/repo",
		state: "awaiting_review",
		reviewReason: "completed",
		providerId: "lmstudio",
		modelId: "qwen",
		endpoint: "http://127.0.0.1:1234",
		lastActivity: "Result patch captured",
		warningMessage: null,
		exitCode: null,
		startedAt: 1,
		promptTokens: 100,
		completionTokens: 50,
		totalTokens: 150,
		timeoutReason: null,
		timeoutSource: null,
		patchCaptureStatus: null,
		...overrides,
	};
}

describe("task-run-summary-store", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-task-runs-"));
	});

	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("appends and reads back run summaries newest-first, scoped by workspace", async () => {
		await recordTaskRunSummary(baseInput({ taskId: "a", endedAt: 10 }), { rootDir });
		await recordTaskRunSummary(baseInput({ taskId: "b", endedAt: 20 }), { rootDir });
		await recordTaskRunSummary(baseInput({ taskId: "c", workspacePath: "/other", endedAt: 30 }), { rootDir });

		const repoSummaries = await readTaskRunSummaries({ workspacePath: "/repo", rootDir });
		expect(repoSummaries.map((record) => record.taskId)).toEqual(["b", "a"]);

		const otherSummaries = await readTaskRunSummaries({ workspacePath: "/other", rootDir });
		expect(otherSummaries).toHaveLength(1);
		expect(otherSummaries[0].taskId).toBe("c");
	});

	it("filters by taskId and applies a limit", async () => {
		await recordTaskRunSummary(baseInput({ taskId: "a", endedAt: 1 }), { rootDir });
		await recordTaskRunSummary(baseInput({ taskId: "a", state: "failed", endedAt: 2 }), { rootDir });
		await recordTaskRunSummary(baseInput({ taskId: "z", endedAt: 3 }), { rootDir });

		const aSummaries = await readTaskRunSummaries({ workspacePath: "/repo", taskId: "a", rootDir });
		expect(aSummaries).toHaveLength(2);
		expect(aSummaries[0].state).toBe("failed");

		const limited = await readTaskRunSummaries({ workspacePath: "/repo", taskId: "a", limit: 1, rootDir });
		expect(limited).toHaveLength(1);
	});

	it("returns an empty list when no runs exist", async () => {
		expect(await readTaskRunSummaries({ workspacePath: "/missing", rootDir })).toEqual([]);
	});
});

function record(overrides: Partial<TaskRunSummaryRecord> = {}): TaskRunSummaryRecord {
	return {
		schemaVersion: 1,
		taskId: "task",
		workspacePath: "/repo",
		state: "awaiting_review",
		reviewReason: null,
		providerId: "lmstudio",
		modelId: "qwen",
		endpoint: null,
		lastActivity: null,
		warningMessage: null,
		exitCode: null,
		startedAt: 1,
		endedAt: 10,
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		timeoutReason: null,
		timeoutSource: null,
		patchCaptureStatus: null,
		...overrides,
	};
}

describe("summarizeTimeoutOutcomes", () => {
	it("ignores runs that did not end on a timeout", () => {
		expect(summarizeTimeoutOutcomes([record({ timeoutReason: null })])).toEqual([]);
	});

	it("groups timeout-triggered runs by model and timeout source and counts outcomes", () => {
		const summary = summarizeTimeoutOutcomes([
			record({
				timeoutReason: "stream inactivity timeout after 600s",
				timeoutSource: "global_config",
				state: "awaiting_review",
				endedAt: 30,
			}),
			record({
				timeoutReason: "conversation timeout after 1200s",
				timeoutSource: "global_config",
				state: "failed",
				endedAt: 40,
			}),
			record({
				modelId: "deepseek",
				timeoutReason: "tool execution timeout after 600s",
				timeoutSource: "role_override",
				state: "interrupted",
				endedAt: 20,
			}),
		]);

		expect(summary).toHaveLength(2);
		const global = summary.find((entry) => entry.timeoutSource === "global_config");
		expect(global).toMatchObject({
			modelId: "qwen",
			timeoutRuns: 2,
			awaitingReviewRuns: 1,
			failedRuns: 1,
			lastEndedAt: 40,
		});
		const roleOverride = summary.find((entry) => entry.timeoutSource === "role_override");
		expect(roleOverride).toMatchObject({ modelId: "deepseek", timeoutRuns: 1, interruptedRuns: 1 });
		// Most-frequent timeout grouping is ordered first.
		expect(summary[0]?.timeoutSource).toBe("global_config");
	});
});
