import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	readAllAgentLedger,
	buildModelBehaviorProfilesFromLedger,
	learnedQualityEffectiveBudget,
	readSelfObservationEvents,
	recordSelfObservation,
} = vi.hoisted(() => ({
	readAllAgentLedger: vi.fn(async () => [] as unknown[]),
	buildModelBehaviorProfilesFromLedger: vi.fn((_events: unknown) => [] as { modelId: string }[]),
	learnedQualityEffectiveBudget: vi.fn((_profile: { modelId: string }) => null as number | null),
	readSelfObservationEvents: vi.fn(async (_q: unknown) => [] as { createdAt: number; signal?: string }[]),
	recordSelfObservation: vi.fn(),
}));

vi.mock("../../../src/state/agent-attempt-ledger-store", () => ({ readAllAgentLedger }));
vi.mock("../../../src/core/agent-ledger-projections", () => ({ buildModelBehaviorProfilesFromLedger }));
vi.mock("../../../src/core/model-behavior-profile", () => ({ learnedQualityEffectiveBudget }));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ readSelfObservationEvents, recordSelfObservation }));

import {
	type AdaptiveBudgetControllerDeps,
	createAdaptiveBudgetController,
} from "../../../src/nklein-agent/nklein-adaptive-budget-controller";

function deps(over: Partial<AdaptiveBudgetControllerDeps> = {}): AdaptiveBudgetControllerDeps {
	return {
		hasResultBranch: () => false,
		resolveKnownContextWindow: () => 32_000,
		resendTaskInput: vi.fn(async () => {}),
		...over,
	};
}

const stalledSummary = {
	state: "awaiting_review",
	providerId: "lmstudio",
	modelId: "worker-m",
	startedAt: 1000,
} as never;

beforeEach(() => {
	vi.clearAllMocks();
	learnedQualityEffectiveBudget.mockReturnValue(null);
	readAllAgentLedger.mockResolvedValue([]);
	buildModelBehaviorProfilesFromLedger.mockReturnValue([]);
	readSelfObservationEvents.mockResolvedValue([]);
});
afterEach(() => {
	process.env.NKLEIN_ADAPTIVE_RETRY = undefined;
});

describe("createAdaptiveBudgetController", () => {
	it("getQualityBudget is null until a refresh folds a learned budget from the ledger", async () => {
		buildModelBehaviorProfilesFromLedger.mockReturnValue([{ modelId: "worker-m" }]);
		learnedQualityEffectiveBudget.mockReturnValue(16_000);
		const c = createAdaptiveBudgetController(deps());
		expect(c.getQualityBudget("worker-m")).toBeNull();
		c.refreshLearnedQualityBudgets();
		await vi.waitFor(() => expect(c.getQualityBudget("worker-m")).toBe(16_000));
	});

	it("refresh skips models whose learned budget is null (advertised window unchanged)", async () => {
		buildModelBehaviorProfilesFromLedger.mockReturnValue([{ modelId: "worker-m" }]);
		learnedQualityEffectiveBudget.mockReturnValue(null);
		const c = createAdaptiveBudgetController(deps());
		c.refreshLearnedQualityBudgets();
		await vi.waitFor(() => expect(readAllAgentLedger).toHaveBeenCalled());
		expect(c.getQualityBudget("worker-m")).toBeNull();
	});

	it("does NOT retry when the NKLEIN_ADAPTIVE_RETRY flag is off", async () => {
		process.env.NKLEIN_ADAPTIVE_RETRY = undefined;
		const resend = vi.fn(async () => {});
		createAdaptiveBudgetController(deps({ resendTaskInput: resend })).maybeAdaptiveBudgetRetry("t1", stalledSummary);
		await Promise.resolve();
		expect(resend).not.toHaveBeenCalled();
	});

	it("re-sends on a RAISED per-turn budget when the flag is on and the turn stalled with no delivered work", async () => {
		process.env.NKLEIN_ADAPTIVE_RETRY = "1";
		readSelfObservationEvents.mockResolvedValue([{ createdAt: 2000, signal: "model_stalled" }]);
		const resend = vi.fn(async (..._a: Parameters<AdaptiveBudgetControllerDeps["resendTaskInput"]>) => {});
		createAdaptiveBudgetController(deps({ resendTaskInput: resend })).maybeAdaptiveBudgetRetry("t1", stalledSummary);
		await vi.waitFor(() => expect(resend).toHaveBeenCalled());
		const [taskId, , mode, , overrides] = resend.mock.calls[0];
		expect(taskId).toBe("t1");
		expect(mode).toBe("act");
		expect((overrides as { maxTokensPerTurn: number }).maxTokensPerTurn).toBeGreaterThan(1024);
		expect(recordSelfObservation).toHaveBeenCalled();
	});

	it("does NOT retry when a stall observation exists but the turn captured a result branch", async () => {
		process.env.NKLEIN_ADAPTIVE_RETRY = "1";
		readSelfObservationEvents.mockResolvedValue([{ createdAt: 2000, signal: "model_stalled" }]);
		const resend = vi.fn(async () => {});
		const c = createAdaptiveBudgetController(deps({ hasResultBranch: () => true, resendTaskInput: resend }));
		c.maybeAdaptiveBudgetRetry("t1", stalledSummary);
		await Promise.resolve();
		await Promise.resolve();
		expect(resend).not.toHaveBeenCalled();
	});
});
