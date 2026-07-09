import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	pickDiverseReviewerModel: vi.fn(async (_l: unknown, _t: string, _k: string, _d: unknown) => null),
	recordSelfObservation: vi.fn(),
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

import {
	createSecondOpinionReviewRunner,
	type SecondOpinionReviewRunnerDeps,
} from "../../../src/nklein-agent/nklein-second-opinion-review-runner";

const APPROVE = { verdict: "approve" } as never;

/** A harness that drives the runner's closure with a minimal bounded context. */
function harness(over: { hang?: boolean } = {}) {
	return {
		runBracketed: vi.fn(async (_config: unknown, drive: (ctx: unknown) => Promise<unknown>) => {
			if (over.hang) return new Promise(() => {}); // never resolves → keeps the round in-flight
			return drive({
				workspace: { workdir: "/wd" },
				deadlineMs: 8_000,
				runBoundedTurn: async (p: Promise<unknown>) => {
					await p;
					return "settled";
				},
			});
		}),
	};
}

function deps(over: Partial<SecondOpinionReviewRunnerDeps> = {}): SecondOpinionReviewRunnerDeps {
	return {
		getAgentSandboxManager: () => ({}) as never,
		getLaunchConfig: () => ({ providerId: "lmstudio", modelId: "worker-m" }) as never,
		getShellKeyByModelId: () => new Map(),
		getPauseController: () => ({}) as never,
		getHarness: () => harness() as never,
		// The reviewer turn delivers its verdict through the onReviewSubmitted callback.
		startRuntimeSession: vi.fn(async (input) => {
			input.onReviewSubmitted?.(APPROVE);
			return { result: {} };
		}),
		sendTaskSessionInput: vi.fn(async () => {}),
		defaultTimeoutMs: 600_000,
		maxNudges: 2,
		...over,
	};
}

const input = { taskId: "t1", projectRepoPath: "/repo", baseRef: "main", seedPrompt: "review this" };

beforeEach(() => vi.clearAllMocks());

describe("createSecondOpinionReviewRunner", () => {
	it("returns null when there is no sandbox manager", async () => {
		const runner = createSecondOpinionReviewRunner(deps({ getAgentSandboxManager: () => null }));
		expect(await runner.runSecondOpinionReviewSession(input)).toBeNull();
	});

	it("returns null when no reviewer, auto-pick, or worker launch yields a provider+model", async () => {
		const runner = createSecondOpinionReviewRunner(deps({ getLaunchConfig: () => null }));
		expect(await runner.runSecondOpinionReviewSession(input)).toBeNull();
	});

	it("drives the harness and returns the submitted verdict on the happy path", async () => {
		const d = deps();
		const runner = createSecondOpinionReviewRunner(d);
		const result = await runner.runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "critic-m" },
		});
		expect(result).toEqual(APPROVE);
		expect(d.startRuntimeSession).toHaveBeenCalledOnce();
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "t1::review",
				providerId: "lmstudio",
				modelId: "critic-m",
				metadata: expect.objectContaining({
					category: "second_opinion_review_session",
					outcome: "verdict",
					selectionSource: "explicit_pin",
					verdict: "approve",
				}),
			}),
		);
	});

	it("single-flights concurrent rounds for the same task (second returns null, records the skip)", async () => {
		const runner = createSecondOpinionReviewRunner(deps({ getHarness: () => harness({ hang: true }) as never }));
		const first = runner.runSecondOpinionReviewSession(input); // stays in-flight (harness hangs)
		const second = await runner.runSecondOpinionReviewSession(input);
		expect(second).toBeNull();
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ category: "second_opinion_review_single_flight" }),
			}),
		);
		void first;
	});

	it("auto-picks a lineage-diverse reviewer when none is supplied", async () => {
		h.pickDiverseReviewerModel.mockResolvedValue({ providerId: "lmstudio", modelId: "diverse-m" } as never);
		const d = deps();
		await createSecondOpinionReviewRunner(d).runSecondOpinionReviewSession(input);
		expect(h.pickDiverseReviewerModel).toHaveBeenCalled();
		const launchArg = (d.startRuntimeSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(launchArg.launchConfig.modelId).toBe("diverse-m");
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "t1::review",
				modelId: "diverse-m",
				metadata: expect.objectContaining({
					category: "second_opinion_review_session",
					selectionSource: "auto_diverse",
				}),
			}),
		);
	});

	it("records a settled reviewer turn even when the reviewer produces no verdict", async () => {
		const d = deps({
			startRuntimeSession: vi.fn(async () => ({ result: {} })),
			sendTaskSessionInput: vi.fn(async () => {}),
			maxNudges: 0,
		});
		const runner = createSecondOpinionReviewRunner(d);
		await runner.runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "critic-m" },
		});
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "t1::review",
				modelId: "critic-m",
				severity: "warning",
				metadata: expect.objectContaining({
					category: "second_opinion_review_session",
					outcome: "no_verdict",
					turnOutcome: "settled",
					verdict: null,
				}),
			}),
		);
	});
});
