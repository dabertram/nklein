import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resolveTaskResultBranchCommit: vi.fn(async () => "commit-x" as string | null),
	recordSelfObservation: vi.fn(),
}));
vi.mock("../../../src/workspace/task-result-branches", () => ({
	resolveTaskResultBranchCommit: mocks.resolveTaskResultBranchCommit,
}));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: mocks.recordSelfObservation }));

import {
	createSecondarySessionHarness,
	type SecondarySessionHarnessDeps,
} from "../../../src/nklein-agent/nklein-secondary-session-harness";

function sandboxManager() {
	return {
		assertAvailable: vi.fn(async () => {}),
		prepareWorkspace: vi.fn(async () => ({ workdir: "/wd" })),
		disposeWorkspace: vi.fn(async () => {}),
	};
}

function deps(mgr: ReturnType<typeof sandboxManager> | null): SecondarySessionHarnessDeps {
	return {
		getAgentSandboxManager: () => mgr as never,
		setSandbox: vi.fn(),
		clearTaskSessions: vi.fn(async () => {}),
		forgetSyntheticState: vi.fn(),
	};
}

const config = {
	primaryTaskId: "t1",
	syntheticTaskId: "t1::review",
	projectRepoPath: "/repo",
	baseRef: "main",
	defaultTimeoutMs: 5000,
	errorLabel: "Review session",
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolveTaskResultBranchCommit.mockResolvedValue("commit-x");
});

describe("createSecondarySessionHarness.runBracketed", () => {
	it("returns null without driving when there is no sandbox manager", async () => {
		const d = deps(null);
		const drive = vi.fn(async () => "verdict");
		expect(await createSecondarySessionHarness(d).runBracketed(config, drive)).toBeNull();
		expect(drive).not.toHaveBeenCalled();
	});

	it("prepares the DELIVERED-tree workspace, drives, returns the verdict, and tears down in a finally", async () => {
		const mgr = sandboxManager();
		const d = deps(mgr);
		const drive = vi.fn(async (_ctx: { workspace: { workdir: string }; deadlineMs: number }) => "verdict");
		const result = await createSecondarySessionHarness(d).runBracketed(config, drive);

		expect(mgr.assertAvailable).toHaveBeenCalled();
		expect(mgr.prepareWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "t1::review", baseRef: "commit-x", maxQueueWaitMs: 180_000 }),
		);
		expect(d.setSandbox).toHaveBeenCalledWith("t1::review", "/repo", "commit-x");
		const ctx = drive.mock.calls[0][0] as { workspace: { workdir: string }; deadlineMs: number };
		expect(ctx.workspace.workdir).toBe("/wd");
		expect(typeof ctx.deadlineMs).toBe("number");
		expect(result).toBe("verdict");
		// teardown
		expect(d.clearTaskSessions).toHaveBeenCalledWith("t1::review");
		expect(mgr.disposeWorkspace).toHaveBeenCalledWith("t1::review");
		expect(d.forgetSyntheticState).toHaveBeenCalledWith("t1::review");
	});

	it("still tears down when the drive throws", async () => {
		const mgr = sandboxManager();
		const d = deps(mgr);
		await expect(
			createSecondarySessionHarness(d).runBracketed(config, async () => {
				throw new Error("drive boom");
			}),
		).rejects.toThrow("drive boom");
		expect(d.clearTaskSessions).toHaveBeenCalledWith("t1::review");
		expect(mgr.disposeWorkspace).toHaveBeenCalledWith("t1::review");
		expect(d.forgetSyntheticState).toHaveBeenCalledWith("t1::review");
	});

	it("runBoundedTurn records (not throws) a failing turn, and awaits a resolving one", async () => {
		const mgr = sandboxManager();
		let sawResolve = false;
		await createSecondarySessionHarness(deps(mgr)).runBracketed(config, async ({ runBoundedTurn }) => {
			await runBoundedTurn(Promise.reject(new Error("turn boom"))); // recorded, not thrown
			await runBoundedTurn(
				Promise.resolve().then(() => {
					sawResolve = true;
				}),
			);
			return "ok";
		});
		expect(mocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("Review session failed: turn boom") }),
		);
		expect(sawResolve).toBe(true);
	});

	it("falls back to the base ref when the result-branch commit does not resolve (primaryTaskId given)", async () => {
		mocks.resolveTaskResultBranchCommit.mockResolvedValueOnce(null);
		const mgr = sandboxManager();
		const d = deps(mgr);
		await createSecondarySessionHarness(d).runBracketed(config, async () => "v");
		expect(mgr.prepareWorkspace).toHaveBeenCalledWith(expect.objectContaining({ baseRef: "main" }));
		expect(d.setSandbox).toHaveBeenCalledWith("t1::review", "/repo", "main");
	});

	it("checks out the base ref DIRECTLY (no result-commit resolution) when primaryTaskId is omitted", async () => {
		const mgr = sandboxManager();
		const d = deps(mgr);
		const { primaryTaskId: _omit, ...noPrimary } = config;
		await createSecondarySessionHarness(d).runBracketed(noPrimary, async () => "v");
		expect(mocks.resolveTaskResultBranchCommit).not.toHaveBeenCalled();
		expect(mgr.prepareWorkspace).toHaveBeenCalledWith(expect.objectContaining({ baseRef: "main" }));
		expect(d.setSandbox).toHaveBeenCalledWith("t1::review", "/repo", "main");
	});
});
