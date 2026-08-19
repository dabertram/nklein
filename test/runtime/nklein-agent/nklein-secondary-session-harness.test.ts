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
		let failedOutcome: unknown = null;
		let settledOutcome: unknown = null;
		await createSecondarySessionHarness(deps(mgr)).runBracketed(config, async ({ runBoundedTurn }) => {
			failedOutcome = await runBoundedTurn(Promise.reject(new Error("turn boom"))); // recorded, not thrown
			settledOutcome = await runBoundedTurn(
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
		expect(failedOutcome).toBe("error");
		expect(settledOutcome).toBe("settled");
	});

	it("reserveMs keeps a slice of the budget for the follow-up turn (campaign round 3)", async () => {
		// Reviewer sessions spent their ENTIRE deadline exploring, so the "submit your verdict now" nudge —
		// gated on the deadline — never ran, and the session timed out having never been ASKED for a verdict.
		// A turn that may consume everything must leave room for the conclusion.
		const mgr = sandboxManager();
		let hungTurnOutcome: unknown = null;
		let nudgeRan = false;
		let msLeftForNudge = 0;
		await createSecondarySessionHarness(deps(mgr)).runBracketed(
			{ ...config, timeoutMs: 400 },
			async ({ runBoundedTurn, deadlineMs }) => {
				// A turn that never settles — the exploration loop that ate the whole budget in the field.
				hungTurnOutcome = await runBoundedTurn(new Promise(() => {}), { reserveMs: 150 });
				msLeftForNudge = deadlineMs - Date.now();
				if (Date.now() < deadlineMs) {
					nudgeRan = true;
				}
				return "ok";
			},
		);
		expect(hungTurnOutcome).toBe("timeout");
		// The reserve is the whole point: the deadline has NOT passed, so the nudge loop still gets its turn.
		expect(nudgeRan).toBe(true);
		expect(msLeftForNudge).toBeGreaterThan(0);
	});

	it("a reserve never starves the turn itself — it splits the window rather than yielding zero", async () => {
		const mgr = sandboxManager();
		let outcome: unknown = null;
		let elapsedMs = 0;
		await createSecondarySessionHarness(deps(mgr)).runBracketed(
			{ ...config, timeoutMs: 200 },
			async ({ runBoundedTurn }) => {
				const startedAt = Date.now();
				// Reserve larger than the whole remaining window: the turn must still get half, not nothing.
				outcome = await runBoundedTurn(new Promise(() => {}), { reserveMs: 10_000 });
				elapsedMs = Date.now() - startedAt;
				return "ok";
			},
		);
		expect(outcome).toBe("timeout");
		expect(elapsedMs).toBeGreaterThan(50);
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
