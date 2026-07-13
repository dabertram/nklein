import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	isCapturedSandboxPatchSummary,
	isEmptySandboxPatchSummary,
	isFailedSandboxPatchSummary,
	isSettledReviewSandboxArtifact,
	resolveReviewSandboxResult,
	runWithSettledReviewSandboxArtifact,
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

const salvageReboundSummary = {
	state: "awaiting_review",
	latestHookActivity: { hookEventName: "interrupted_salvage_rebound" },
} as unknown as RuntimeTaskSessionSummary;

const failedPatchSummary = {
	state: "awaiting_review",
	latestHookActivity: { hookEventName: "sandbox_patch_capture_failed" },
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
	it("recognizes direct captures and interrupted-work rebound markers", () => {
		expect(isCapturedSandboxPatchSummary(capturedPatchSummary)).toBe(true);
		expect(isCapturedSandboxPatchSummary(salvageReboundSummary)).toBe(true);
		expect(isCapturedSandboxPatchSummary(pendingReviewCaptureSummary)).toBe(false);
		expect(isCapturedSandboxPatchSummary(null)).toBe(false);
	});
});

describe("runWithSettledReviewSandboxArtifact", () => {
	it("blocks every downstream delivery side effect for pending and failed capture", async () => {
		for (const status of ["unknown", "capture_failed"] as const) {
			const result = { status, resultCommit: null };
			const reviewer = vi.fn(async () => undefined);
			const acceptance = vi.fn(async () => undefined);
			const merge = vi.fn(async () => undefined);
			const gated = await runWithSettledReviewSandboxArtifact(result, async () => {
				await reviewer();
				await acceptance();
				await merge();
			});

			expect(gated.delivered).toBe(false);
			expect(reviewer).not.toHaveBeenCalled();
			expect(acceptance).not.toHaveBeenCalled();
			expect(merge).not.toHaveBeenCalled();
		}
	});

	it("admits the complete delivery suffix when a later invocation sees the capture marker", async () => {
		let currentSummary = pendingReviewCaptureSummary;
		let resultCommit: string | null = "stale-round-1";
		const runDelivery = vi.fn(async () => "delivered");
		const probe = {
			getSummary: () => currentSummary,
			resolveResultCommit: () => Promise.resolve(resultCommit),
			sleep: noopSleep,
			delaysMs: [] as const,
		};

		const first = await resolveReviewSandboxResult(input, probe);
		expect(await runWithSettledReviewSandboxArtifact(first, runDelivery)).toMatchObject({ delivered: false });
		expect(runDelivery).not.toHaveBeenCalled();

		currentSummary = capturedPatchSummary;
		resultCommit = "current-round-2";
		const second = await resolveReviewSandboxResult(input, probe);
		expect(await runWithSettledReviewSandboxArtifact(second, runDelivery)).toMatchObject({
			delivered: true,
			value: "delivered",
		});
		expect(runDelivery).toHaveBeenCalledTimes(1);
	});
});

describe("capture-failure delivery guard", () => {
	it("recognizes capture failure and only admits settled artifacts", () => {
		expect(isFailedSandboxPatchSummary(failedPatchSummary)).toBe(true);
		expect(isFailedSandboxPatchSummary(capturedPatchSummary)).toBe(false);
		expect(isSettledReviewSandboxArtifact({ status: "result_branch", resultCommit: "abc" })).toBe(true);
		expect(isSettledReviewSandboxArtifact({ status: "empty_patch", resultCommit: null })).toBe(true);
		expect(isSettledReviewSandboxArtifact({ status: "capture_failed", resultCommit: null })).toBe(false);
		expect(isSettledReviewSandboxArtifact({ status: "unknown", resultCommit: null })).toBe(false);
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
		expect(result).toEqual({ status: "empty_patch", resultCommit: null });
		expect(sleep).not.toHaveBeenCalled();
		expect(resolveResultCommit).not.toHaveBeenCalled();
	});

	it("returns capture_failed immediately, without probing a branch", async () => {
		const sleep = vi.fn(noopSleep);
		const resolveResultCommit = vi.fn(() => Promise.resolve(null));
		const result = await resolveReviewSandboxResult(input, {
			getSummary: () => failedPatchSummary,
			resolveResultCommit,
			sleep,
		});
		expect(result).toEqual({ status: "capture_failed", resultCommit: null });
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
		expect(result).toEqual({ status: "result_branch", resultCommit: "abc123" });
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
		expect(result).toEqual({ status: "result_branch", resultCommit: "commit" });
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
		expect(result).toEqual({ status: "result_branch", resultCommit: "existing-round-1-branch" });
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
		expect(result).toEqual({ status: "unknown", resultCommit: null });
		// Immediate pass + one probe per delay = 3 probes, 2 sleeps.
		expect(resolveResultCommit).toHaveBeenCalledTimes(3);
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it("never accepts a stale branch while the worker is queued, running, or paused", async () => {
		for (const state of ["queued", "running", "paused"] as const) {
			const result = await resolveReviewSandboxResult(input, {
				getSummary: () => ({ ...busySummary, state }) as RuntimeTaskSessionSummary,
				resolveResultCommit: () => Promise.resolve("stale-round-1"),
				sleep: noopSleep,
				delaysMs: [],
			});
			expect(result).toEqual({ status: "unknown", resultCommit: null });
		}
	});
});
