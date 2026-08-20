import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	pickDiverseReviewerModel: vi.fn(async (_l: unknown, _t: string, _k: string, _d: unknown) => null),
	recordSelfObservation: vi.fn(),
	fetchLoadedModelDescriptors: vi.fn(
		async (_baseUrl: string) => [] as Array<{ runtimeId: string; isEmbedding: boolean }>,
	),
}));

vi.mock("../../../src/nklein-agent/nklein-reviewer-model-selection", () => ({
	pickDiverseReviewerModel: h.pickDiverseReviewerModel,
}));
vi.mock("../../../src/core/lmstudio-loaded-model-descriptors", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../src/core/lmstudio-loaded-model-descriptors")>()),
	fetchLoadedModelDescriptors: h.fetchLoadedModelDescriptors,
}));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({ recordSelfObservation: h.recordSelfObservation }));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox", () => ({
	createAgentSandboxToolExecutors: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-agent-sandbox-extra-tools", () => ({
	createAgentSandboxExtraTools: vi.fn(() => ({})),
}));
vi.mock("../../../src/nklein-agent/nklein-session-state", () => ({ createSessionId: (id: string) => id }));

import type { RuntimeTaskSessionStartResult } from "../../../src/nklein-agent/nklein-runtime-session-input";
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
				deadlineMs: Date.now() + 8_000,
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
		stopRuntimeSession: vi.fn(async () => {}),
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

	it("returns null when no reviewer, auto-pick, worker launch, OR loaded model yields a provider+model", async () => {
		h.fetchLoadedModelDescriptors.mockResolvedValueOnce([]);
		const runner = createSecondOpinionReviewRunner(deps({ getLaunchConfig: () => null }));
		expect(await runner.runSecondOpinionReviewSession(input)).toBeNull();
	});

	it("restart-durability: with no launch config (lost on restart), falls back to a LOADED model so the review still runs", async () => {
		// getLaunchConfig null (in-memory config gone after restart) + no diverse pick → the loaded-model fallback resolves
		// the first non-embedding loaded model so the review isn't stuck no_verdict → held forever.
		h.fetchLoadedModelDescriptors.mockResolvedValueOnce([
			{ runtimeId: "embed-m", isEmbedding: true },
			{ runtimeId: "qwen/qwen3.6-35b-a3b-m5max", isEmbedding: false },
		]);
		const d = deps({ getLaunchConfig: () => null });
		const runner = createSecondOpinionReviewRunner(d);
		const result = await runner.runSecondOpinionReviewSession(input);
		expect(result).toEqual(APPROVE);
		const launchArg = (d.startRuntimeSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(launchArg.launchConfig.modelId).toBe("qwen/qwen3.6-35b-a3b-m5max");
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ selectionSource: "loaded_fallback" }),
			}),
		);
	});

	it("drives the harness and returns the submitted verdict on the happy path", async () => {
		const d = deps();
		const runner = createSecondOpinionReviewRunner(d);
		const result = await runner.runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "critic-m" },
		});
		expect(result).toEqual(APPROVE);
		expect(d.stopRuntimeSession).toHaveBeenCalledWith("t1::review");
		expect(d.startRuntimeSession).toHaveBeenCalledOnce();
		expect(d.startRuntimeSession).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "t1::review", admissionParentTaskId: "t1" }),
		);
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

	it("reports the resolved reviewer to the caller BEFORE teardown clears the session (P21.6b attribution)", async () => {
		// The per-model review ceiling is derived from `review_capacity_evidence.reviewerModelId`, and the
		// obvious way to get it — look up the `<taskId>::review` summary after the review resolves — cannot
		// work: the harness clears that synthetic session in its `finally`. Measured, not assumed: the
		// post-hoc approach attributed 0 of 76 real rows. So the model must be reported while it is known.
		const d = deps();
		const runner = createSecondOpinionReviewRunner(d);
		const seen: { providerId: string; modelId: string; selectionSource: string }[] = [];
		await runner.runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "critic-m" },
			onReviewerResolved: (resolved) => seen.push(resolved),
		});
		expect(seen).toEqual([{ providerId: "lmstudio", modelId: "critic-m", selectionSource: "explicit_pin" }]);
		// The session IS torn down afterwards — which is exactly why the callback, not a later lookup, is the
		// attribution source.
		expect(d.stopRuntimeSession).toHaveBeenCalledWith("t1::review");
	});

	it("ends a reviewer turn at the first valid verdict even when the model would keep running", async () => {
		let settleTurn: (() => void) | null = null;
		const first = { verdict: "request_changes", feedback: "Fix the import." } as never;
		const d = deps({
			startRuntimeSession: vi.fn(
				(input) =>
					new Promise<RuntimeTaskSessionStartResult>((resolve) => {
						settleTurn = () => resolve({ result: {} });
						input.onReviewSubmitted?.(first);
						input.onReviewSubmitted?.(APPROVE);
					}),
			),
			stopRuntimeSession: vi.fn(async () => settleTurn?.()),
		});

		await expect(createSecondOpinionReviewRunner(d).runSecondOpinionReviewSession(input)).resolves.toEqual(first);
		expect(d.stopRuntimeSession).toHaveBeenCalledTimes(1);
		expect(d.sendTaskSessionInput).not.toHaveBeenCalled();
	});

	it("floors a REASONING reviewer's per-turn budget so it can't truncate before submit_review (live fix 2026-07-14)", async () => {
		const d = deps();
		const runner = createSecondOpinionReviewRunner(d);
		await runner.runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "qwen/qwen3.6-35b-a3b-m5max" },
		});
		const launchArg = (d.startRuntimeSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(launchArg.launchConfig.maxTokensPerTurn).toBe(4096);
	});

	it("does NOT floor a non-reasoning reviewer's budget (leaves the inherited value untouched)", async () => {
		const d = deps();
		const runner = createSecondOpinionReviewRunner(d);
		await runner.runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "qwen/qwen2.5-coder-14b" },
		});
		const launchArg = (d.startRuntimeSession as ReturnType<typeof vi.fn>).mock.calls[0][0];
		// worker launch has no maxTokensPerTurn → non-reasoning reviewer keeps it unset (no floor applied).
		expect(launchArg.launchConfig.maxTokensPerTurn).toBeUndefined();
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

	it("records a settled reviewer turn and hands admission through its nudge when no verdict lands", async () => {
		const d = deps({
			startRuntimeSession: vi.fn(async () => ({ result: {} })),
			sendTaskSessionInput: vi.fn(async () => {}),
			maxNudges: 1,
		});
		const runner = createSecondOpinionReviewRunner(d);
		await runner.runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "critic-m" },
		});
		expect(d.sendTaskSessionInput).toHaveBeenCalledWith("t1::review", expect.any(String), "t1");
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
