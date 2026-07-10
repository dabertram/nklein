import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	isCapturedSandboxPatchSummary,
	isEmptySandboxPatchSummary,
	resolveReviewSandboxResult,
} from "../../../src/server/review-sandbox-result";

const emptyPatchSummary = {
	latestHookActivity: { hookEventName: "sandbox_patch_empty" },
} as unknown as RuntimeTaskSessionSummary;

const busySummary = {
	latestHookActivity: { hookEventName: "post_tool_use" },
} as unknown as RuntimeTaskSessionSummary;

const pendingReviewCaptureSummary = {
	state: "awaiting_review",
	latestHookActivity: { hookEventName: "agent_end" },
} as unknown as RuntimeTaskSessionSummary;

const capturedPatchSummary = {
	state: "awaiting_review",
	latestHookActivity: { hookEventName: "sandbox_patch_captured" },
} as unknown as RuntimeTaskSessionSummary;

const noopSleep = () => Promise.resolve();
const input = { repoPath: "/repo", taskId: "task-1" };

describe("isEmptySandboxPatchSummary (§5.U extraction)", () => {
	it("is true only for the sandbox_patch_empty hook event", () => {
		expect(isEmptySandboxPatchSummary(emptyPatchSummary)).toBe(true);
		expect(isEmptySandboxPatchSummary(busySummary)).toBe(false);
		expect(isEmptySandboxPatchSummary(null)).toBe(false);
	});
});

describe("isCapturedSandboxPatchSummary", () => {
	it("recognizes only the current handoff's captured-patch marker", () => {
		expect(isCapturedSandboxPatchSummary(capturedPatchSummary)).toBe(true);
		expect(isCapturedSandboxPatchSummary(pendingReviewCaptureSummary)).toBe(false);
		expect(isCapturedSandboxPatchSummary(null)).toBe(false);
	});
});

describe("resolveReviewSandboxResult (§5.U extraction)", () => {
	it("returns empty_patch immediately, without sleeping or checking the result branch", async () => {
		const sleep = vi.fn(noopSleep);
		const resolveResultCommit = vi.fn(() => Promise.resolve(null));
		const result = await resolveReviewSandboxResult(input, {
			getSummary: () => emptyPatchSummary,
			resolveResultCommit,
			sleep,
		});
		expect(result).toBe("empty_patch");
		expect(sleep).not.toHaveBeenCalled();
		expect(resolveResultCommit).not.toHaveBeenCalled();
	});

	it("returns result_branch when a result commit resolves on the first pass", async () => {
		const sleep = vi.fn(noopSleep);
		const result = await resolveReviewSandboxResult(input, {
			getSummary: () => busySummary,
			resolveResultCommit: () => Promise.resolve("abc123"),
			sleep,
		});
		expect(result).toBe("result_branch");
		expect(sleep).not.toHaveBeenCalled();
	});

	it("polls the schedule until a result commit appears (sleeping between passes)", async () => {
		const sleep = vi.fn(noopSleep);
		let calls = 0;
		const result = await resolveReviewSandboxResult(input, {
			getSummary: () => busySummary,
			resolveResultCommit: () => {
				calls += 1;
				return Promise.resolve(calls >= 3 ? "commit" : null);
			},
			sleep,
			delaysMs: [1, 2, 3, 4],
		});
		expect(result).toBe("result_branch");
		// Immediate pass + 2 sleeps before the 3rd (successful) probe.
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it("does not accept an old result branch until the current bounced-worker handoff finishes capture", async () => {
		const sleep = vi.fn(noopSleep);
		let summaryCalls = 0;
		const result = await resolveReviewSandboxResult(input, {
			getSummary: () => {
				summaryCalls += 1;
				return summaryCalls >= 3 ? capturedPatchSummary : pendingReviewCaptureSummary;
			},
			resolveResultCommit: () => Promise.resolve("existing-round-1-branch"),
			sleep,
			delaysMs: [1, 2, 3],
		});
		expect(result).toBe("result_branch");
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it("returns unknown after the schedule is exhausted with no result", async () => {
		const sleep = vi.fn(noopSleep);
		const resolveResultCommit = vi.fn(() => Promise.resolve(null));
		const result = await resolveReviewSandboxResult(input, {
			getSummary: () => busySummary,
			resolveResultCommit,
			sleep,
			delaysMs: [1, 2],
		});
		expect(result).toBe("unknown");
		// Immediate pass + one probe per delay = 3 probes, 2 sleeps.
		expect(resolveResultCommit).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledTimes(2);
	});
});
