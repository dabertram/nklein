import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ recordSelfObservation: vi.fn() }));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: h.recordSelfObservation }));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox", () => ({
	createAgentSandboxToolExecutors: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox-extra-tools", () => ({
	createAgentSandboxExtraTools: vi.fn(() => []),
}));
vi.mock("../../../src/nklein-agent/nklein-session-state", () => ({ createSessionId: (id: string) => id }));

import { createStepPlanRunner, type StepPlanRunnerDeps } from "../../../src/nklein-agent/nklein-step-plan-runner";

const PLAN = {
	objective: "add flag",
	assumptions: [],
	steps: [
		{
			id: "a",
			title: "A",
			intent: "do a",
			files: [{ path: "src/a.ts", symbol: null, change: "x" }],
			commands: [],
			inputs: [],
			expectedOutcome: "a",
			acceptance: { command: null, check: "a" },
			mustNot: [],
			difficulty: "easy" as const,
			verify: null,
		},
	],
};

function harness() {
	return {
		runBracketed: vi.fn(async (_config: unknown, drive: (ctx: unknown) => Promise<unknown>) =>
			drive({
				workspace: { workdir: "/wd" },
				deadlineMs: Date.now() + 8_000,
				runBoundedTurn: async (turn: Promise<unknown>) => {
					await turn;
				},
			}),
		),
	};
}

type Start = StepPlanRunnerDeps["startRuntimeSession"];

function deps(over: Partial<StepPlanRunnerDeps> = {}, verdicts: Array<"approve" | "revise" | null> = ["approve"]) {
	const reviews = [...verdicts];
	const startRuntimeSession = vi.fn(async (input) => {
		if (input.taskId.endsWith("::step-plan")) {
			await input.onStepPlanSubmitted?.(PLAN);
		} else if (input.taskId.endsWith("::step-plan-review")) {
			const verdict = reviews.shift() ?? null;
			if (verdict) {
				await input.onStepPlanReviewSubmitted?.({
					verdict,
					summary: "s",
					findings: verdict === "revise" ? [{ category: "ambiguity", stepId: "a", fix: "name the symbol" }] : [],
				});
			}
		}
		return { result: {} };
	}) as unknown as Start;
	return {
		getAgentSandboxManager: () => ({}) as never,
		getLaunchConfig: () => ({ providerId: "lmstudio", modelId: "card-m" }) as never,
		getPauseController: () => ({}) as never,
		getHarness: () => harness() as never,
		startRuntimeSession,
		sendTaskSessionInput: vi.fn(async () => {}),
		pickEscalationModel: vi.fn(async () => ({ providerId: "lmstudio", modelId: "diverse-m" })),
		defaultTimeoutMs: 60_000,
		maxNudges: 1,
		env: {},
		...over,
	} satisfies StepPlanRunnerDeps;
}

const input = {
	taskId: "t1",
	projectRepoPath: "/repo",
	baseRef: "HEAD",
	taskTitle: "Card",
	taskPrompt: "Add a --json flag",
	lookupAvailable: false,
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
	delete process.env.NKLEIN_STEP_PLANNER_MODEL;
});

describe("model selection per role", () => {
	it("planner: env > modelRoles > card model; reviewer: env > modelRoles > diverse pick > card model", async () => {
		const base = deps();
		expect(await createStepPlanRunner(base).resolveModel("t1", "planner")).toMatchObject({
			modelId: "card-m",
			source: "card_model",
		});
		expect(await createStepPlanRunner(base).resolveModel("t1", "plan_reviewer")).toMatchObject({
			modelId: "diverse-m",
			source: "diverse_escalation",
		});
		const configured = deps({
			resolveRoleModel: (role) =>
				role === "planner" ? { modelId: "planner-m" } : { providerId: "other", modelId: "reviewer-m" },
		});
		expect(await createStepPlanRunner(configured).resolveModel("t1", "planner")).toMatchObject({
			modelId: "planner-m",
			source: "modelRoles",
		});
		expect(await createStepPlanRunner(configured).resolveModel("t1", "plan_reviewer")).toMatchObject({
			providerId: "other",
			modelId: "reviewer-m",
			source: "modelRoles",
		});
		const env = deps({
			env: { NKLEIN_STEP_PLANNER_MODEL: "env-m" },
			resolveRoleModel: () => ({ modelId: "planner-m" }),
		});
		expect(await createStepPlanRunner(env).resolveModel("t1", "planner")).toMatchObject({
			modelId: "env-m",
			source: "env",
		});
		const noDiverse = deps({ pickEscalationModel: vi.fn(async () => null) });
		expect(await createStepPlanRunner(noDiverse).resolveModel("t1", "plan_reviewer")).toMatchObject({
			modelId: "card-m",
			source: "card_model",
		});
		expect(
			await createStepPlanRunner(deps({ getLaunchConfig: () => null })).resolveModel("t1", "planner"),
		).toBeNull();
	});
});

describe("planAndReview", () => {
	it("approves on the first round and runs the reviewer on the diverse model with the card's admission parent", async () => {
		const d = deps();
		const outcome = await createStepPlanRunner(d).planAndReview({ ...input, admissionParentTaskId: "t1" });
		expect(outcome).toMatchObject({ status: "approved", rounds: 1, reviewed: true, reviewer: "lmstudio/diverse-m" });
		const calls = (d.startRuntimeSession as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
		expect(calls.map((call) => call.taskId)).toEqual(["t1::step-plan", "t1::step-plan-review"]);
		expect(calls[0]).toMatchObject({
			admissionParentTaskId: "t1",
			contextScope: "minimal",
			launchConfig: { modelId: "card-m" },
		});
		expect(calls[1].launchConfig.modelId).toBe("diverse-m");
		expect(calls[1].prompt).toContain("## Checklist");
		expect(calls[1].prompt).toContain("fact_from_memory");
	});

	it("revises once (findings reach the planner verbatim) and approves in round 2", async () => {
		const d = deps({}, ["revise", "approve"]);
		const outcome = await createStepPlanRunner(d).planAndReview(input);
		expect(outcome).toMatchObject({ status: "approved", rounds: 2 });
		const planner2 = (d.startRuntimeSession as ReturnType<typeof vi.fn>).mock.calls[2][0];
		expect(planner2.taskId).toBe("t1::step-plan");
		expect(planner2.prompt).toContain("REVISION requested by the plan reviewer (round 1)");
		expect(planner2.prompt).toContain("[ambiguity] step a: name the symbol");
	});

	it("falls back when the rounds are exhausted without approval", async () => {
		const outcome = await createStepPlanRunner(
			deps({ env: { NKLEIN_STEP_PLAN_MAX_REVIEW_ROUNDS: "2" } }, ["revise", "revise"]),
		).planAndReview(input);
		expect(outcome).toMatchObject({ status: "fallback", rounds: 2 });
		expect(h.recordSelfObservation.mock.calls.at(-1)?.[0].metadata).toMatchObject({
			category: "step_plan_review_round",
			action: "fallback_unplanned",
		});
	});

	it("executes UNREVIEWED (waiver recorded) only when no reviewer model exists at all", async () => {
		const noReviewer = deps(
			{ getLaunchConfig: vi.fn(() => ({ providerId: "lmstudio", modelId: "card-m" }) as never) },
			[null],
		);
		// A reviewer model always resolves (card model fallback) — so a missing verdict past resolution falls back:
		expect(await createStepPlanRunner(noReviewer).planAndReview(input)).toMatchObject({ status: "fallback" });
	});

	it("falls back when the planner never submits, and nudges it once first", async () => {
		const d = deps({ startRuntimeSession: vi.fn(async () => ({ result: {} })) as unknown as Start });
		expect(await createStepPlanRunner(d).planAndReview(input)).toMatchObject({
			status: "fallback",
			reason: expect.stringContaining("no plan"),
		});
		expect(d.sendTaskSessionInput).toHaveBeenCalledWith(
			"t1::step-plan",
			expect.stringContaining("submit_step_plan"),
			null,
		);
	});

	it("never plans for a synthetic or home session", async () => {
		const d = deps();
		expect(await createStepPlanRunner(d).planAndReview({ ...input, taskId: "t1::review" })).toMatchObject({
			status: "fallback",
		});
		expect(d.startRuntimeSession).not.toHaveBeenCalled();
	});
});
