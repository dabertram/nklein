import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	createSandboxReviewFinalizer,
	type SandboxReviewFinalizerDeps,
} from "../../../src/nklein-agent/nklein-sandbox-review-finalizer";
import type { NKleinTaskSessionEntry } from "../../../src/nklein-agent/nklein-session-state";

const summary = (over: Partial<RuntimeTaskSessionSummary>): RuntimeTaskSessionSummary =>
	({ taskId: "t1", state: "running", ...over }) as RuntimeTaskSessionSummary;

const entry = (): NKleinTaskSessionEntry =>
	({ summary: summary({ state: "awaiting_review" }), messages: [] }) as unknown as NKleinTaskSessionEntry;

function sandboxState(over: Record<string, unknown> = {}) {
	return {
		isFinalizing: vi.fn(() => false),
		hasSandbox: vi.fn(() => true),
		getRepoPath: vi.fn(() => "/repo"),
		getBaseRef: vi.fn(() => "main"),
		markFinalizing: vi.fn(),
		clearRecaptureExpected: vi.fn(),
		unmarkFinalizing: vi.fn(),
		setResultBranch: vi.fn(),
		isDeliverySettled: vi.fn(() => false),
		...over,
	};
}

/**
 * A partial AgentSandboxManager stub carrying the P1.CAPTURERACE obligation seam every finalization now marks and
 * settles. It is on the BASE stub rather than each caller's: the finalizer declares the obligation before it can
 * know anything about the task, so a manager without it is not a manager this code can run against.
 */
function sandboxManager(over: Record<string, unknown> = {}) {
	return {
		markCaptureOwed: vi.fn(),
		releaseOwedCapture: vi.fn(),
		...over,
	} as never;
}

function deps(over: Partial<SandboxReviewFinalizerDeps> = {}, ss = sandboxState()): SandboxReviewFinalizerDeps {
	return {
		getSandboxState: () => ss as never,
		getAgentSandboxManager: () => sandboxManager(),
		getTaskEntry: vi.fn(() => entry()),
		emitSummary: vi.fn(),
		emitMessage: vi.fn(),
		isExplicitDecomposition: vi.fn(() => false),
		getTaskRunSummaryRoot: () => undefined,
		releaseSandboxMcpResources: vi.fn(async () => {}),
		...over,
	};
}

describe("shouldFinalizeSandboxReview (§5.U extraction)", () => {
	const prev = summary({ state: "running" });
	const next = summary({ state: "awaiting_review" });

	it("is true for a sandbox-backed task entering awaiting_review", () => {
		const f = createSandboxReviewFinalizer(deps());
		expect(f.shouldFinalizeSandboxReview(prev, next)).toBe(true);
	});

	it("is false when not entering awaiting_review, already finalizing, no sandbox, or no manager", () => {
		expect(createSandboxReviewFinalizer(deps()).shouldFinalizeSandboxReview(next, next)).toBe(false); // already there
		expect(
			createSandboxReviewFinalizer(deps({}, sandboxState({ isFinalizing: () => true }))).shouldFinalizeSandboxReview(
				prev,
				next,
			),
		).toBe(false);
		expect(
			createSandboxReviewFinalizer(deps({}, sandboxState({ hasSandbox: () => false }))).shouldFinalizeSandboxReview(
				prev,
				next,
			),
		).toBe(false);
		expect(
			createSandboxReviewFinalizer(deps({ getAgentSandboxManager: () => null })).shouldFinalizeSandboxReview(
				prev,
				next,
			),
		).toBe(false);
	});
});

describe("finalizeSandboxReview early-return guards (§5.U extraction)", () => {
	it("does nothing (no markFinalizing) when manager / repoPath / baseRef / entry is missing or already finalizing", () => {
		const noManagerSS = sandboxState();
		createSandboxReviewFinalizer(deps({ getAgentSandboxManager: () => null }, noManagerSS)).finalizeSandboxReview(
			"t1",
		);
		expect(noManagerSS.markFinalizing).not.toHaveBeenCalled();

		const noRepoSS = sandboxState({ getRepoPath: () => null });
		createSandboxReviewFinalizer(deps({}, noRepoSS)).finalizeSandboxReview("t1");
		expect(noRepoSS.markFinalizing).not.toHaveBeenCalled();

		const finalizingSS = sandboxState({ isFinalizing: () => true });
		createSandboxReviewFinalizer(deps({}, finalizingSS)).finalizeSandboxReview("t1");
		expect(finalizingSS.markFinalizing).not.toHaveBeenCalled();
	});

	it("marks finalizing when all preconditions are met (then proceeds async)", () => {
		const ss = sandboxState();
		createSandboxReviewFinalizer(
			deps(
				{
					getAgentSandboxManager: () =>
						sandboxManager({ captureWorkspacePatch: vi.fn(() => new Promise(() => {})) }),
				},
				ss,
			),
		).finalizeSandboxReview("t1");
		expect(ss.markFinalizing).toHaveBeenCalledWith("t1");
		expect(ss.clearRecaptureExpected).toHaveBeenCalledWith("t1");
		expect(ss.markFinalizing.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(
			ss.clearRecaptureExpected.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("refuses to open a new finalization once the delivery settled (N5 flaky-02 late-capture race)", () => {
		const settledSS = sandboxState({ isDeliverySettled: () => true });
		const prev = summary({ state: "running" });
		const next = summary({ state: "awaiting_review" });
		const f = createSandboxReviewFinalizer(deps({}, settledSS));
		expect(f.shouldFinalizeSandboxReview(prev, next)).toBe(false);
		f.finalizeSandboxReview("t1");
		expect(settledSS.markFinalizing).not.toHaveBeenCalled();
	});

	it("treats an in-flight capture failing after the delivery settled as benign supersede: no failed summary, no capture-error status", async () => {
		// Settled flips DURING the flight: entry guard sees false (capture starts), the catch sees true.
		const isDeliverySettled = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
		const ss = sandboxState({ isDeliverySettled });
		const disposeWorkspace = vi.fn(async () => {});
		const emitSummary = vi.fn();
		createSandboxReviewFinalizer(
			deps(
				{
					getAgentSandboxManager: () =>
						sandboxManager({
							captureWorkspacePatch: vi.fn(async () => {
								throw new Error("Agent sandbox is stopping; no workspace patch can be captured.");
							}),
							disposeWorkspace,
							hasWorkspace: () => false,
						}),
					emitSummary,
				},
				ss,
			),
		).finalizeSandboxReview("t1");

		await vi.waitFor(() => {
			expect(ss.unmarkFinalizing).toHaveBeenCalledWith("t1");
		});
		expect(disposeWorkspace).toHaveBeenCalledWith("t1");
		// The just-delivered card must NOT be flipped to failed by the superseded capture.
		expect(emitSummary).not.toHaveBeenCalled();
	});

	it("declares the owed capture on the MANAGER synchronously, and settles it when the transaction ends (P1.CAPTURERACE)", async () => {
		// The store's `markFinalizing` is read by ONE disposal path; every other one goes straight to
		// `disposeWorkspace`. The obligation therefore has to reach the manager BEFORE this function yields —
		// a mark that lands after the first await is a mark a racing disposal never sees.
		const markCaptureOwed = vi.fn();
		const releaseOwedCapture = vi.fn();
		const ss = sandboxState();
		let resolveCapture!: (patch: string) => void;
		createSandboxReviewFinalizer(
			deps(
				{
					getAgentSandboxManager: () =>
						sandboxManager({
							markCaptureOwed,
							releaseOwedCapture,
							captureWorkspacePatch: vi.fn(
								() =>
									new Promise<string>((resolve) => {
										resolveCapture = resolve;
									}),
							),
							disposeWorkspace: vi.fn(async () => {}),
							hasWorkspace: () => true,
						}),
				},
				ss,
			),
		).finalizeSandboxReview("t1");

		expect(markCaptureOwed).toHaveBeenCalledWith("t1", "review_finalize");
		// The bounce obligation from the PREVIOUS round is consumed at the same point its store marker is.
		expect(releaseOwedCapture).toHaveBeenCalledWith("t1", "recapture_expected");
		expect(releaseOwedCapture).not.toHaveBeenCalledWith("t1", "review_finalize");

		resolveCapture("");
		await vi.waitFor(() => {
			expect(releaseOwedCapture).toHaveBeenCalledWith("t1", "review_finalize");
		});
	});

	it("releases task-scoped sandbox MCP resources before disposing a parked workspace", async () => {
		const captureWorkspacePatch = vi.fn(async () => "");
		const disposeWorkspace = vi.fn(async () => {});
		const releaseSandboxMcpResources = vi.fn(async () => {});
		createSandboxReviewFinalizer(
			deps({
				getAgentSandboxManager: () =>
					sandboxManager({
						captureWorkspacePatch,
						disposeWorkspace,
						hasWorkspace: () => true,
					}),
				releaseSandboxMcpResources,
			}),
		).finalizeSandboxReview("t1");

		await vi.waitFor(() => {
			expect(disposeWorkspace).toHaveBeenCalledWith("t1");
		});
		expect(releaseSandboxMcpResources).toHaveBeenCalledWith("t1");
		expect(releaseSandboxMcpResources.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
			disposeWorkspace.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		);
	});
});
