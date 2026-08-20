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

function deps(over: Partial<SandboxReviewFinalizerDeps> = {}, ss = sandboxState()): SandboxReviewFinalizerDeps {
	return {
		getSandboxState: () => ss as never,
		getAgentSandboxManager: () => ({}) as never,
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
				{ getAgentSandboxManager: () => ({ captureWorkspacePatch: vi.fn(() => new Promise(() => {})) }) as never },
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
						({
							captureWorkspacePatch: vi.fn(async () => {
								throw new Error("Agent sandbox is stopping; no workspace patch can be captured.");
							}),
							disposeWorkspace,
							hasWorkspace: () => false,
						}) as never,
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

	it("releases task-scoped sandbox MCP resources before disposing a parked workspace", async () => {
		const captureWorkspacePatch = vi.fn(async () => "");
		const disposeWorkspace = vi.fn(async () => {});
		const releaseSandboxMcpResources = vi.fn(async () => {});
		createSandboxReviewFinalizer(
			deps({
				getAgentSandboxManager: () =>
					({
						captureWorkspacePatch,
						disposeWorkspace,
						hasWorkspace: () => true,
					}) as never,
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
