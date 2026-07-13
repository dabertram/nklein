import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { readStableTaskCaptureSnapshot } from "../../../src/trpc/runtime-api/task-evidence";

function captureSummary(hookEventName: string): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "awaiting_review",
		updatedAt: hookEventName === "sandbox_patch_captured" ? 2 : 1,
		lastHookAt: hookEventName === "sandbox_patch_captured" ? 2 : 1,
		latestHookActivity: {
			activityText: null,
			toolName: null,
			toolInputSummary: null,
			finalMessage: hookEventName === "sandbox_patch_captured" ? "commit-2" : null,
			hookEventName,
			notificationType: null,
			source: "nklein",
		},
	} as RuntimeTaskSessionSummary;
}

describe("readStableTaskCaptureSnapshot", () => {
	it("retries when capture completes across the branch probe", async () => {
		const pending = captureSummary("agent_end");
		const captured = captureSummary("sandbox_patch_captured");
		let summaryReads = 0;
		const getSummary = vi.fn(() => {
			summaryReads += 1;
			return summaryReads === 1 ? pending : captured;
		});
		const probeResultBranch = vi.fn(async () => ({ status: "found" as const, commit: "commit-2" }));

		const snapshot = await readStableTaskCaptureSnapshot({
			service: { getSummary },
			taskId: "task-1",
			repoPath: "/repo",
			resultBranchTaskId: "task-1",
			probeResultBranch,
		});

		expect(snapshot.summary).toBe(captured);
		expect(snapshot.stable).toBe(true);
		expect(snapshot.probe).toEqual({ status: "found", commit: "commit-2" });
		expect(probeResultBranch).toHaveBeenCalledTimes(2);
	});

	it("reports an unstable snapshot instead of classifying the final mismatched pair", async () => {
		let version = 0;
		const getSummary = vi.fn(() => captureSummary(version++ % 2 === 0 ? "agent_end" : "sandbox_patch_captured"));
		const probeResultBranch = vi.fn(async () => ({ status: "found" as const, commit: `commit-${version}` }));

		const snapshot = await readStableTaskCaptureSnapshot({
			service: { getSummary },
			taskId: "task-1",
			repoPath: "/repo",
			resultBranchTaskId: "task-1",
			probeResultBranch,
		});

		expect(snapshot.stable).toBe(false);
		expect(probeResultBranch).toHaveBeenCalledTimes(3);
	});
});
