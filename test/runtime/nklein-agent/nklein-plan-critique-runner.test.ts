import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	pickDiverseReviewerModel: vi.fn(async (_l: unknown, _t: string, _k: string, _d: unknown) => null),
	recordSelfObservation: vi.fn(),
	buildPlanCritiqueSeedPrompt: vi.fn((_r: unknown) => "seed"),
}));

vi.mock("../../../src/nklein-agent/nklein-reviewer-model-selection", () => ({
	pickDiverseReviewerModel: h.pickDiverseReviewerModel,
}));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: h.recordSelfObservation }));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox", () => ({
	createAgentSandboxToolExecutors: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox-extra-tools", () => ({
	createAgentSandboxExtraTools: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-session-state", () => ({ createSessionId: (id: string) => id }));
vi.mock("../../../src/nklein-agent/nklein-plan-critique-tool", () => ({
	buildPlanCritiqueSeedPrompt: h.buildPlanCritiqueSeedPrompt,
}));

import {
	createPlanCritiqueRunner,
	type PlanCritiqueRunnerDeps,
} from "../../../src/nklein-agent/nklein-plan-critique-runner";

const PROCEED = { verdict: "proceed" } as never;

function harness() {
	return {
		runBracketed: vi.fn(async (_config: unknown, drive: (ctx: unknown) => Promise<unknown>) =>
			drive({
				workspace: { workdir: "/wd" },
				deadlineMs: 8_000,
				runBoundedTurn: async (p: Promise<unknown>) => {
					await p;
				},
			}),
		),
	};
}

function deps(over: Partial<PlanCritiqueRunnerDeps> = {}): PlanCritiqueRunnerDeps {
	return {
		getAgentSandboxManager: () => ({}) as never,
		getLaunchConfig: () => ({ providerId: "lmstudio", modelId: "architect-m" }) as never,
		getShellKeyByModelId: () => new Map(),
		getPauseController: () => ({}) as never,
		getHarness: () => harness() as never,
		pickEscalationModel: vi.fn(async () => ({ providerId: "lmstudio", modelId: "critic-m" })),
		getBaseRef: () => "HEAD",
		startRuntimeSession: vi.fn(async (input) => {
			input.onPlanCritiqueSubmitted?.(PROCEED);
			return { result: {} };
		}),
		sendTaskSessionInput: vi.fn(async () => {}),
		defaultTimeoutMs: 600_000,
		maxNudges: 2,
		runBudget: 2,
		...over,
	};
}

const input = { taskId: "t1", projectRepoPath: "/repo", baseRef: "HEAD", seedPrompt: "critique this" };

beforeEach(() => {
	vi.clearAllMocks();
	h.pickDiverseReviewerModel.mockResolvedValue(null);
});

describe("createPlanCritiqueRunner — runPlanCritiqueSession", () => {
	it("returns null without a sandbox manager", async () => {
		expect(
			await createPlanCritiqueRunner(deps({ getAgentSandboxManager: () => null })).runPlanCritiqueSession(input),
		).toBeNull();
	});

	it("returns null when the architect launch has no provider/model", async () => {
		expect(
			await createPlanCritiqueRunner(deps({ getLaunchConfig: () => null })).runPlanCritiqueSession(input),
		).toBeNull();
	});

	it("returns null (proceed) when no diverse critic can be resolved", async () => {
		const d = deps();
		expect(await createPlanCritiqueRunner(d).runPlanCritiqueSession(input)).toBeNull();
		expect(d.startRuntimeSession).not.toHaveBeenCalled();
	});

	it("drives the harness with the pre-picked critic and returns the submitted verdict", async () => {
		const d = deps();
		const result = await createPlanCritiqueRunner(d).runPlanCritiqueSession({
			...input,
			critic: { providerId: "lmstudio", modelId: "critic-m" },
		});
		expect(result).toEqual(PROCEED);
		const launchArg = (d.startRuntimeSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(launchArg.launchConfig.modelId).toBe("critic-m");
	});
});

describe("createPlanCritiqueRunner — buildRequestHandler", () => {
	it("returns undefined for synthetic (`::`) and home-agent sessions", () => {
		const runner = createPlanCritiqueRunner(deps());
		expect(runner.buildRequestHandler("t1::review", "/repo")).toBeUndefined();
	});

	it("waives (null) and records an observation when no diverse critic is loaded", async () => {
		const runner = createPlanCritiqueRunner(deps({ pickEscalationModel: async () => null }));
		const handler = runner.buildRequestHandler("t1", "/repo");
		expect(await handler?.({ slug: "plan-a" } as never)).toBeNull();
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: expect.objectContaining({ category: "plan_critique_diversity_waived" }) }),
		);
	});

	it("enforces the per-run budget: the 3rd request (budget 2) is a no-op", async () => {
		const d = deps({ runBudget: 2 });
		const runner = createPlanCritiqueRunner(d);
		const handler = runner.buildRequestHandler("t1", "/repo");
		await handler?.({ slug: "a" } as never);
		await handler?.({ slug: "b" } as never);
		(d.pickEscalationModel as ReturnType<typeof vi.fn>).mockClear();
		expect(await handler?.({ slug: "c" } as never)).toBeNull();
		expect(d.pickEscalationModel).not.toHaveBeenCalled(); // budget exhausted → probe never runs
	});
});
