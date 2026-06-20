import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type RecordTaskRunSummaryInput,
	readTaskRunSummaries,
	recordTaskRunSummary,
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
