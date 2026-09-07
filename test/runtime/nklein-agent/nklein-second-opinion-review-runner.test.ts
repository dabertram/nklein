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
	// Routability filtering (liveness ledger + fleet identifier collisions) is the chooser module's concern and
	// is unit-tested there; the runner tests see every fixture descriptor as routable.
	excludeUnroutableDescriptors: async (descriptors: readonly unknown[]) => [...descriptors],
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

import { AuxiliarySessionTranscriptUnavailableError } from "../../../src/nklein-agent/nklein-auxiliary-session-transcript";
import type {
	RuntimeTaskSessionStartResult,
	StartRuntimeTaskSessionFromLaunchConfigInput,
} from "../../../src/nklein-agent/nklein-runtime-session-input";
import {
	createSecondOpinionReviewRunner,
	describeReviewNoVerdict,
	type SecondOpinionReviewRunnerDeps,
} from "../../../src/nklein-agent/nklein-second-opinion-review-runner";

const APPROVE = { verdict: "approve" } as never;

/** A harness that drives the runner's closure with a minimal bounded context. */
function harness(over: { hang?: boolean } = {}) {
	return {
		runBracketed: vi.fn(async (_config: unknown, drive: (ctx: unknown) => Promise<unknown>) => {
			if (over.hang) return new Promise(() => {}); // never resolves → keeps the round in-flight
			const deadlineMs = Date.now() + 8_000;
			return drive({
				workspace: { workdir: "/wd" },
				deadlineMs,
				deadline: () => deadlineMs,
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
			input.onAdmitted?.();
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

	it("P1.REVIEWNUDGE: a start that was never admitted to its endpoint is not nudged — no ghost reviewers", async () => {
		// The bracket cuts the start turn (timeout) while it is still queued behind another session: no transcript
		// exists, so a nudge would restart a fresh reviewer from the seed prompt (HITL 2026-09-07: three within 50 ms).
		const d = deps({
			getHarness: () =>
				({
					runBracketed: vi.fn(async (_config: unknown, drive: (ctx: unknown) => Promise<unknown>) => {
						const deadlineMs = Date.now() + 8_000;
						return drive({
							workspace: { workdir: "/wd" },
							deadlineMs,
							deadline: () => deadlineMs,
							runBoundedTurn: async () => "timeout",
						});
					}),
				}) as never,
			startRuntimeSession: vi.fn(() => new Promise<RuntimeTaskSessionStartResult>(() => {})),
		});
		await expect(createSecondOpinionReviewRunner(d).runSecondOpinionReviewSession(input)).resolves.toBeNull();
		expect(d.sendTaskSessionInput).not.toHaveBeenCalled();
		// The queued start is still released (stop) so it cannot hold the endpoint later.
		expect(d.stopRuntimeSession).toHaveBeenCalledWith("t1::review");
	});

	it("P1.REVIEWNUDGE: an admitted-but-cut reviewer IS nudged, with the admission signal wired to the bounded turn", async () => {
		const seenOptions: unknown[] = [];
		const d = deps({
			getHarness: () =>
				({
					runBracketed: vi.fn(async (_config: unknown, drive: (ctx: unknown) => Promise<unknown>) => {
						const deadlineMs = Date.now() + 8_000;
						return drive({
							workspace: { workdir: "/wd" },
							deadlineMs,
							deadline: () => deadlineMs,
							runBoundedTurn: async (p: Promise<unknown>, options?: unknown) => {
								seenOptions.push(options);
								return seenOptions.length === 1 ? "timeout" : (await p, "settled");
							},
						});
					}),
				}) as never,
			startRuntimeSession: vi.fn((input) => {
				input.onAdmitted?.();
				return new Promise<RuntimeTaskSessionStartResult>(() => {});
			}),
		});
		await createSecondOpinionReviewRunner(d).runSecondOpinionReviewSession(input);
		expect(d.sendTaskSessionInput).toHaveBeenCalled();
		expect(seenOptions[0]).toMatchObject({ reserveMs: expect.any(Number), clockStartsOn: expect.any(Promise) });
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

	/** A bracket whose FIRST bounded turn (the start, carrying `clockStartsOn`) is cut; later turns run to settlement. */
	function cutStartHarness() {
		return {
			runBracketed: vi.fn(async (_config: unknown, drive: (ctx: unknown) => Promise<unknown>) => {
				const deadlineMs = Date.now() + 8_000;
				return drive({
					workspace: { workdir: "/wd" },
					deadlineMs,
					deadline: () => deadlineMs,
					runBoundedTurn: async (p: Promise<unknown>, options?: { clockStartsOn?: Promise<unknown> }) => {
						if (options?.clockStartsOn) {
							return "timeout";
						}
						try {
							await p;
							return "settled";
						} catch {
							return "error";
						}
					},
				});
			}),
		};
	}

	it("P0.REVIEWNOVERDICT: a reviewer cut at the verdict reserve is stopped and then nudged — the nudge lands on the transcript-resumed session and its verdict wins", async () => {
		// Live 2026-09-05 (s44b, flash-next): the reserve cut STOPS the SDK session to free the endpoint, and a stopped
		// session cannot be sent to — every post-cut nudge died in milliseconds, three sessions in a row, park. The
		// service now rebuilds the reviewer from its persisted transcript for the nudge (same submit_review hand-back);
		// the runner's contract is the ORDER (stop before nudge) and that the nudge's verdict outranks the cut.
		const calls: string[] = [];
		let seedStart: StartRuntimeTaskSessionFromLaunchConfigInput | null = null;
		const d = deps({
			getHarness: () => cutStartHarness() as never,
			startRuntimeSession: vi.fn((startInput) => {
				seedStart = startInput;
				startInput.onAdmitted?.();
				calls.push("start");
				return new Promise<RuntimeTaskSessionStartResult>(() => {});
			}),
			stopRuntimeSession: vi.fn(async () => {
				calls.push("stop");
			}),
			// The service's transcript resume re-issues the ORIGINAL start input (tools + callbacks) with the nudge as
			// the next user turn, so the verdict arrives through the seed start's own onReviewSubmitted.
			sendTaskSessionInput: vi.fn(async () => {
				calls.push("nudge");
				(seedStart as StartRuntimeTaskSessionFromLaunchConfigInput | null)?.onReviewSubmitted?.(APPROVE);
			}),
		});
		const reasons: string[] = [];
		const result = await createSecondOpinionReviewRunner(d).runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "critic-m" },
			onNoVerdict: (reason) => reasons.push(reason),
		});
		expect(result).toEqual(APPROVE);
		// stop (release the endpoint) → nudge → stop (the verdict path ends the resumed session too).
		expect(calls).toEqual(["start", "stop", "nudge", "stop"]);
		expect(d.sendTaskSessionInput).toHaveBeenCalledWith("t1::review", expect.stringContaining("submit_review"), "t1");
		expect(reasons).toEqual([]);
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "t1::review",
				severity: "info",
				metadata: expect.objectContaining({
					category: "second_opinion_review_session",
					outcome: "verdict",
					cutAtReserve: true,
					nudges: 1,
					transcriptResumed: true,
					noVerdictReason: null,
				}),
			}),
		);
	});

	it("P0.REVIEWNOVERDICT: a nudge refused for want of a resumable transcript ends the nudging and becomes the objective no-verdict reason", async () => {
		// The service refuses to resume a transcript with no assistant turn (that would be P1.REVIEWNUDGE's ghost
		// restart). The refusal is deterministic, so a second nudge is pointless: one attempt, then the reason.
		const d = deps({
			getHarness: () => cutStartHarness() as never,
			startRuntimeSession: vi.fn((startInput) => {
				startInput.onAdmitted?.();
				return new Promise<RuntimeTaskSessionStartResult>(() => {});
			}),
			sendTaskSessionInput: vi.fn(async () => {
				throw new AuxiliarySessionTranscriptUnavailableError("t1::review", "no_assistant_turn");
			}),
			maxNudges: 2,
		});
		const reasons: string[] = [];
		const result = await createSecondOpinionReviewRunner(d).runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "critic-m" },
			onNoVerdict: (reason) => reasons.push(reason),
		});
		expect(result).toBeNull();
		expect(d.sendTaskSessionInput).toHaveBeenCalledTimes(1);
		expect(reasons).toHaveLength(1);
		expect(reasons[0]).toContain("cut at the verdict reserve");
		expect(reasons[0]).toContain("could not reach the reviewer's transcript");
		expect(reasons[0]).toContain("no assistant turn");
		expect(h.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "t1::review",
				severity: "warning",
				metadata: expect.objectContaining({
					category: "second_opinion_review_session",
					outcome: "timeout",
					cutAtReserve: true,
					nudges: 1,
					transcriptResumed: false,
					noVerdictReason: reasons[0],
				}),
			}),
		);
	});

	it("P0.REVIEWNOVERDICT: a transient nudge failure keeps the nudge budget (it is not the typed refusal) and the reason names every outcome", async () => {
		const d = deps({
			getHarness: () => cutStartHarness() as never,
			startRuntimeSession: vi.fn((startInput) => {
				startInput.onAdmitted?.();
				return new Promise<RuntimeTaskSessionStartResult>(() => {});
			}),
			sendTaskSessionInput: vi.fn(async () => {
				throw new Error("model-side error on the nudge turn");
			}),
			maxNudges: 2,
		});
		const reasons: string[] = [];
		await createSecondOpinionReviewRunner(d).runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "critic-m" },
			onNoVerdict: (reason) => reasons.push(reason),
		});
		expect(d.sendTaskSessionInput).toHaveBeenCalledTimes(2);
		expect(reasons[0]).toContain("2 verdict nudge turn(s) resumed its persisted transcript and ended error/error");
	});

	it("P0.REVIEWNOVERDICT: a settled no-verdict session reports its shape too (no cut, nudged in place)", async () => {
		const reasons: string[] = [];
		const d = deps({
			startRuntimeSession: vi.fn(async () => ({ result: {} })),
			sendTaskSessionInput: vi.fn(async () => {}),
			maxNudges: 1,
		});
		await createSecondOpinionReviewRunner(d).runSecondOpinionReviewSession({
			...input,
			reviewer: { providerId: "lmstudio", modelId: "critic-m" },
			onNoVerdict: (reason) => reasons.push(reason),
		});
		expect(d.stopRuntimeSession).not.toHaveBeenCalled();
		expect(reasons).toHaveLength(1);
		expect(reasons[0]).toMatch(
			/^the reviewer ended its turn after \d+s without calling submit_review; 1 verdict nudge turn\(s\) ended settled without a submit_review call$/,
		);
	});

	describe("describeReviewNoVerdict", () => {
		const shape = {
			neverAdmitted: false,
			cutAtReserve: false,
			startOutcome: "settled" as const,
			explorationMs: 480_400,
			nudgeOutcomes: [] as const,
			nudgeRefusal: null,
			maxNudges: 2,
			budgetExhausted: false,
		};

		it("a never-admitted start names the queue, not the model", () => {
			expect(describeReviewNoVerdict({ ...shape, neverAdmitted: true, startOutcome: "timeout" })).toBe(
				"the start was never admitted to its model endpoint within the budget (queued behind another session) — no transcript existed to nudge",
			);
		});

		it("a cut exploration followed by transcript-resumed nudges reads as a budget fact", () => {
			expect(
				describeReviewNoVerdict({
					...shape,
					cutAtReserve: true,
					startOutcome: "timeout",
					nudgeOutcomes: ["settled", "timeout"],
				}),
			).toBe(
				"the exploration turn was cut at the verdict reserve after 480s without a submit_review call; 2 verdict nudge turn(s) resumed its persisted transcript and ended settled/timeout without a submit_review call",
			);
		});

		it("a cut with no nudge budget left says so instead of implying a nudge ran", () => {
			expect(
				describeReviewNoVerdict({ ...shape, cutAtReserve: true, startOutcome: "timeout", budgetExhausted: true }),
			).toBe(
				"the exploration turn was cut at the verdict reserve after 480s without a submit_review call; no budget remained for a verdict nudge",
			);
		});

		it("a failed turn is named as a failure, with the refusal quoted when the nudge was refused", () => {
			expect(
				describeReviewNoVerdict({
					...shape,
					startOutcome: "error",
					explorationMs: 1_500,
					nudgeOutcomes: ["error"],
					nudgeRefusal:
						"Auxiliary session t1::review has no live session and cannot be resumed from its transcript: the SDK persisted no session record for it.",
				}),
			).toBe(
				"the reviewer turn failed after 2s; the verdict nudge could not reach the reviewer's transcript (Auxiliary session t1::review has no live session and cannot be resumed from its transcript: the SDK persisted no session record for it.)",
			);
		});
	});
});
