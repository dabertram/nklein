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
const REVISE = {
	verdict: "revise",
	summary: "Remove redundant work",
	feedback: "Keep only scoring-cap, cli-output, and acceptance-tests.",
} as never;

function harness() {
	return {
		runBracketed: vi.fn(async (_config: unknown, drive: (ctx: unknown) => Promise<unknown>) =>
			drive({
				workspace: { workdir: "/wd" },
				deadlineMs: Date.now() + 8_000,
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
		expect(launchArg).toMatchObject({ taskId: "t1::plan-critique", admissionParentTaskId: "t1" });
	});

	it("marks both the initial turn and nudges as awaited children of the worker turn", async () => {
		let submit: ((result: typeof PROCEED) => void) | undefined;
		const d = deps({
			startRuntimeSession: vi.fn(async (launch) => {
				submit = launch.onPlanCritiqueSubmitted as typeof submit;
				return { result: {} };
			}),
			sendTaskSessionInput: vi.fn(async () => {
				submit?.(PROCEED);
			}),
		});
		await createPlanCritiqueRunner(d).runPlanCritiqueSession({
			...input,
			critic: { providerId: "lmstudio", modelId: "critic-m" },
		});

		expect(d.startRuntimeSession).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "t1::plan-critique", admissionParentTaskId: "t1" }),
		);
		expect(d.sendTaskSessionInput).toHaveBeenCalledWith(
			"t1::plan-critique",
			expect.stringContaining("Submit your critique"),
			"t1",
		);
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

	it("lets loaded-model availability and admission define capacity instead of a service-lifetime count", async () => {
		const d = deps();
		const runner = createPlanCritiqueRunner(d);
		const handler = runner.buildRequestHandler("t1", "/repo");
		await handler?.({ slug: "a" } as never);
		await handler?.({ slug: "b" } as never);
		await handler?.({ slug: "c" } as never);
		expect(d.pickEscalationModel).toHaveBeenCalledTimes(3);
		expect(d.startRuntimeSession).toHaveBeenCalledTimes(3);
	});

	it("retains revision feedback and candidate numbering across architect-session handlers", async () => {
		const verdicts = [REVISE, PROCEED];
		const d = deps({
			startRuntimeSession: vi.fn(async (launch) => {
				launch.onPlanCritiqueSubmitted?.(verdicts.shift() ?? PROCEED);
				return { result: {} };
			}),
		});
		const runner = createPlanCritiqueRunner(d);
		const candidateOne = await runner.buildRequestHandler("t1", "/repo")?.({ slug: "habit-insights" } as never);

		expect(candidateOne).toMatchObject({ verdict: "revise", critiqueAttempt: 1 });
		expect(runner.getPendingRevisionPrompt("t1")).toContain("candidate 1/2");
		expect(runner.getPendingRevisionPrompt("t1")).toContain("Keep only scoring-cap");

		const candidateTwo = await runner.buildRequestHandler("t1", "/repo")?.({ slug: "habit-insights" } as never);
		expect(candidateTwo).toMatchObject({ verdict: "proceed", critiqueAttempt: 2 });
		expect(runner.getPendingRevisionPrompt("t1")).toBeNull();
	});

	it("rejects a revised candidate that changes its slug instead of resetting critique lineage", async () => {
		const d = deps({
			startRuntimeSession: vi.fn(async (launch) => {
				launch.onPlanCritiqueSubmitted?.(REVISE);
				return { result: {} };
			}),
		});
		const runner = createPlanCritiqueRunner(d);
		await runner.buildRequestHandler("t1", "/repo")?.({ slug: "habit-insights" } as never);
		const changed = await runner.buildRequestHandler("t1", "/repo")?.({ slug: "new-slug" } as never);

		expect(changed).toMatchObject({ verdict: "revise", critiqueAttempt: 2 });
		expect(changed?.feedback).toContain('Keep the stable plan slug "habit-insights"');
		expect(d.startRuntimeSession).toHaveBeenCalledTimes(1);
	});

	it("fails a rejected plan closed when its required fresh critic is no longer available", async () => {
		const pickEscalationModel = vi
			.fn()
			.mockResolvedValueOnce({ providerId: "lmstudio", modelId: "critic-m" })
			.mockResolvedValueOnce(null);
		const d = deps({
			pickEscalationModel,
			startRuntimeSession: vi.fn(async (launch) => {
				launch.onPlanCritiqueSubmitted?.(REVISE);
				return { result: {} };
			}),
		});
		const runner = createPlanCritiqueRunner(d);
		await runner.buildRequestHandler("t1", "/repo")?.({ slug: "habit-insights" } as never);
		const candidateTwo = await runner.buildRequestHandler("t1", "/repo")?.({ slug: "habit-insights" } as never);

		expect(candidateTwo).toMatchObject({ verdict: "revise", critiqueAttempt: 2 });
		expect(candidateTwo?.feedback).toContain("cannot use the ordinary no-critic waiver");
		expect(d.startRuntimeSession).toHaveBeenCalledTimes(1);
	});
});
