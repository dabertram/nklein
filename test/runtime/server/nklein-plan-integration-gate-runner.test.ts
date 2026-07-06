import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	findJustCompletedPlans: vi.fn((_i: unknown) => [] as string[]),
	resolvePlanAcceptanceCommand: vi.fn((_i: unknown) => "npm test" as string | null),
	resolvePlanFailureSurfaceCardId: vi.fn((_b: unknown, _s: string) => "card-1" as string | null),
	mutateWorkspaceState: vi.fn(async (_p: string, mutate: (s: unknown) => unknown) =>
		mutate({ board: { columns: [{ cards: [{ id: "card-1", review: null }] }] } }),
	),
	retryWorkspaceStateLock: vi.fn(async (fn: () => unknown) => fn()),
	applyCardReviewToBoard: vi.fn((board: unknown, _id: string, _r: unknown, _lane: string) => board),
	recordSelfObservation: vi.fn(),
}));

vi.mock("../../../src/core/plan-integration-gate", () => ({
	findJustCompletedPlans: h.findJustCompletedPlans,
	resolvePlanAcceptanceCommand: h.resolvePlanAcceptanceCommand,
	resolvePlanFailureSurfaceCardId: h.resolvePlanFailureSurfaceCardId,
}));
vi.mock("../../../src/state/workspace-state", () => ({ mutateWorkspaceState: h.mutateWorkspaceState }));
vi.mock("../../../src/server/workspace-state-lock-retry", () => ({
	retryWorkspaceStateLock: h.retryWorkspaceStateLock,
}));
vi.mock("../../../src/server/second-opinion-review-runner", () => ({
	applyCardReviewToBoard: h.applyCardReviewToBoard,
}));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: h.recordSelfObservation }));

import { createPlanIntegrationGateRunner } from "../../../src/server/nklein-plan-integration-gate-runner";

const scope = { workspaceId: "ws", workspacePath: "/ws" } as never;
const board = { columns: [] } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));

function serviceWith(passed: boolean) {
	return {
		verifyTaskAcceptanceInSandbox: vi.fn(async () => ({ passed, output: "log-output", exitCode: passed ? 0 : 1 })),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	h.findJustCompletedPlans.mockReturnValue([]);
	h.resolvePlanAcceptanceCommand.mockReturnValue("npm test");
	h.resolvePlanFailureSurfaceCardId.mockReturnValue("card-1");
});

describe("createPlanIntegrationGateRunner", () => {
	it("does nothing when no plan just completed", async () => {
		const service = serviceWith(true);
		createPlanIntegrationGateRunner({ warn: vi.fn() }).runForCompletion(scope, service as never, "t1", board);
		await flush();
		expect(service.verifyTaskAcceptanceInSandbox).not.toHaveBeenCalled();
	});

	it("skips (no gate run) when the plan carries no acceptance command", async () => {
		h.findJustCompletedPlans.mockReturnValue(["plan-a"]);
		h.resolvePlanAcceptanceCommand.mockReturnValue(null);
		const service = serviceWith(true);
		createPlanIntegrationGateRunner({ warn: vi.fn() }).runForCompletion(scope, service as never, "t1", board);
		await flush();
		expect(service.verifyTaskAcceptanceInSandbox).not.toHaveBeenCalled();
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: expect.objectContaining({ verdict: "skipped" }) }),
		);
	});

	it("records a pass and does NOT surface anything when the gate passes", async () => {
		h.findJustCompletedPlans.mockReturnValue(["plan-a"]);
		const service = serviceWith(true);
		createPlanIntegrationGateRunner({ warn: vi.fn() }).runForCompletion(scope, service as never, "t1", board);
		await flush();
		expect(service.verifyTaskAcceptanceInSandbox).toHaveBeenCalledOnce();
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: expect.objectContaining({ verdict: "pass" }) }),
		);
		expect(h.mutateWorkspaceState).not.toHaveBeenCalled();
	});

	it("surfaces the failure on the board when the gate fails", async () => {
		h.findJustCompletedPlans.mockReturnValue(["plan-a"]);
		const service = serviceWith(false);
		createPlanIntegrationGateRunner({ warn: vi.fn() }).runForCompletion(scope, service as never, "t1", board);
		await flush();
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: expect.objectContaining({ verdict: "fail" }) }),
		);
		expect(h.mutateWorkspaceState).toHaveBeenCalledOnce();
		expect(h.applyCardReviewToBoard).toHaveBeenCalledWith(expect.anything(), "card-1", expect.anything(), "review");
	});

	it("runs the gate AT MOST once per (workspace, plan) key", async () => {
		h.findJustCompletedPlans.mockReturnValue(["plan-a"]);
		const service = serviceWith(true);
		const runner = createPlanIntegrationGateRunner({ warn: vi.fn() });
		runner.runForCompletion(scope, service as never, "t1", board);
		await flush();
		runner.runForCompletion(scope, service as never, "t2", board); // same plan re-finalized
		await flush();
		expect(service.verifyTaskAcceptanceInSandbox).toHaveBeenCalledOnce();
	});
});
