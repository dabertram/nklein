import type { PromptWarmthLedgerEntry } from "../core/cache-warmth";
import { fetchLoadedModelDescriptors, pickReviewFallbackDescriptor } from "../core/lmstudio-loaded-model-descriptors";
import { resolveDefaultLocalModelBaseUrl } from "../core/local-model-endpoint";
import { isReasoningModel } from "../core/model-thinking-control";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { type AgentSandboxManager, createAgentSandboxToolExecutors } from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import { isAuxiliarySessionTranscriptUnavailableError } from "./nklein-auxiliary-session-transcript";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import type { NKleinPauseController } from "./nklein-pause-controller";
import type { NKleinReviewResult } from "./nklein-review-tool";
import { buildReviewerCandidates, resolveWorkerRealId } from "./nklein-reviewer-candidate-selection";
import {
	DISABLED_REVIEWER_CAPABILITY_EVIDENCE,
	loadReviewerCapabilityEvidence,
} from "./nklein-reviewer-capability-evidence";
import { excludeUnroutableDescriptors, pickDiverseReviewerModel } from "./nklein-reviewer-model-selection";
import type {
	RuntimeTaskSessionStartResult,
	StartRuntimeTaskSessionFromLaunchConfigInput,
} from "./nklein-runtime-session-input";
import type { SecondarySessionHarness, SecondaryTurnOutcome } from "./nklein-secondary-session-harness";
import { createSessionId } from "./nklein-session-state";

/**
 * §5.AN / live-fix 2026-07-14: a REASONING reviewer emits variable `reasoning_content` BEFORE it can call
 * `submit_review`; a per-turn output budget sized for a non-reasoning worker truncates it MID-THOUGHT, so the verdict
 * never lands → `no_verdict` → every delivery holds (root-caused live on qwen3.6-35b-a3b: 179–484 reasoning tokens on a
 * TRIVIAL prompt, far more on a real ~7KB review). The review turn has no adaptive-budget raise (that's wired to the
 * PRIMARY session only), so floor the reasoning reviewer's budget up-front to leave room to reason AND emit the call.
 * The floor only RAISES (max with the inherited budget) and applies only to reasoning models — non-reasoning reviewers
 * are unchanged. The context clamp downstream still bounds it to the window.
 */
const REASONING_REVIEWER_BUDGET_FLOOR = 4096;
/**
 * Wall-clock held back from the reviewer's exploration turn so the "call submit_review now" nudge always gets
 * a turn. Sized from the campaign's own numbers: verdict-emitting nudge turns settled in ~10-70s on the 27B
 * local models, so two minutes covers the ask plus a slow first token.
 */
// Flat 120s starves slow local rigs (live 2026-08-31, Flash-Next ~600 tok/s prefill: re-prompting a 30k-token
// review context alone eats the reserve, so the verdict nudge got cut three rounds straight and every big-diff
// review parked "for a human decision"). Rig-tunable; unset keeps the validated default.
const REVIEW_VERDICT_RESERVE_MS =
	Number(process.env.NKLEIN_REVIEW_VERDICT_RESERVE_MS ?? "") > 0
		? Number(process.env.NKLEIN_REVIEW_VERDICT_RESERVE_MS)
		: 120_000;
/** Hard ceiling for the raise-on-retry ladder — a reviewer that needs more than this is not budget-starved. */
export const REVIEW_RETRY_BUDGET_CEILING = 32_768;
/** The no-verdict retry index (0-based) at which the reviewer pick escalates to the strongest routable model. */
const REVIEW_ESCALATE_TO_STRONGEST_ON_ATTEMPT = 2;
/** The output budget never exceeds this share of the reviewer's loaded context (the prompt needs the rest). */
const REVIEWER_OUTPUT_CONTEXT_SHARE = 0.35;
const REVIEWER_OUTPUT_BUDGET_FLOOR = 2_048;
/** At most this many doublings, so the ceiling is approached deliberately rather than by exponent growth. */
export const REVIEW_RETRY_BUDGET_MAX_DOUBLINGS = 3;

/**
 * P0.REVIEWNOVERDICT: the objective shape of a reviewer session that ended without a verdict, in one sentence the
 * park reason / fallback summary can quote. Pure; exported for tests.
 */
export function describeReviewNoVerdict(input: {
	neverAdmitted: boolean;
	cutAtReserve: boolean;
	startOutcome: SecondaryTurnOutcome;
	explorationMs: number;
	nudgeOutcomes: readonly SecondaryTurnOutcome[];
	nudgeRefusal: string | null;
	maxNudges: number;
	budgetExhausted: boolean;
}): string {
	if (input.neverAdmitted) {
		return "the start was never admitted to its model endpoint within the budget (queued behind another session) — no transcript existed to nudge";
	}
	const seconds = Math.max(0, Math.round(input.explorationMs / 1000));
	const nudges = input.nudgeOutcomes.length;
	const nudgeText = input.nudgeRefusal
		? `the verdict nudge could not reach the reviewer's transcript (${input.nudgeRefusal})`
		: nudges > 0
			? `${nudges} verdict nudge turn(s)${input.cutAtReserve ? " resumed its persisted transcript and" : ""} ended ${input.nudgeOutcomes.join("/")} without a submit_review call`
			: input.maxNudges <= 0
				? "no verdict nudge is configured"
				: input.budgetExhausted
					? "no budget remained for a verdict nudge"
					: "no verdict nudge ran";
	if (input.cutAtReserve) {
		return `the exploration turn was cut at the verdict reserve after ${seconds}s without a submit_review call; ${nudgeText}`;
	}
	if (input.startOutcome === "error") {
		return `the reviewer turn failed after ${seconds}s; ${nudgeText}`;
	}
	return `the reviewer ended its turn after ${seconds}s without calling submit_review; ${nudgeText}`;
}

/** Re-prompt the reviewer if it ended a turn without the structured `submit_review` call (small models often do). */
const SECOND_OPINION_REVIEW_NUDGE_PROMPT =
	"You ended your turn without calling `submit_review`, so no review was recorded. Your verdict is delivered ONLY by that tool. Call `submit_review` now: `approve`, or `request_changes` with concrete, actionable feedback. Do not answer in prose.";

export interface SecondOpinionReviewRunnerDeps {
	getAgentSandboxManager(): AgentSandboxManager | null;
	getLaunchConfig(taskId: string): NKleinTaskRestartLaunchConfig | null;
	/** The §5.AQ warmth ledger (read by the diverse-reviewer auto-pick). */
	getShellKeyByModelId(): Map<string, PromptWarmthLedgerEntry>;
	/** The service's isolated ledger root (F1.26b), when any — the P0.REVRANK capability-evidence read honors it. */
	getLedgerRootDir?(): string | undefined;
	/** Test seam for the P0.REVRANK capability-evidence loader (default: the live stores). */
	loadCapabilityEvidence?: typeof loadReviewerCapabilityEvidence;
	getPauseController(): NKleinPauseController;
	/** The shared secondary-session harness (bounded sandbox session + always-teardown). */
	getHarness(): SecondarySessionHarness;
	startRuntimeSession(input: StartRuntimeTaskSessionFromLaunchConfigInput): Promise<RuntimeTaskSessionStartResult>;
	sendTaskSessionInput(taskId: string, prompt: string, admissionParentTaskId: string): Promise<unknown>;
	/** End a synthetic reviewer turn once its first valid structured verdict has been accepted. */
	stopRuntimeSession(taskId: string): Promise<unknown>;
	defaultTimeoutMs: number;
	maxNudges: number;
}

export interface SecondOpinionReviewRunner {
	runSecondOpinionReviewSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		reviewer?: { providerId: string; modelId: string } | null;
		timeoutMs?: number;
		/** No-verdict retry index; each retry raises the per-turn output budget (see runInner). */
		budgetAttempt?: number;
		/**
		 * Reports the RESOLVED reviewer before its first turn. The caller cannot recover this later — the
		 * harness clears the `<taskId>::review` session on teardown — and the per-model review ceiling
		 * (P21.6b) depends on the attribution.
		 */
		onReviewerResolved?: (reviewer: { providerId: string; modelId: string; selectionSource: string }) => void;
		/**
		 * P0.REVIEWNOVERDICT: called when the session ends WITHOUT a verdict, with its objective shape (cut at the
		 * verdict reserve after Ns, never admitted, nudge refused because no transcript could be resumed, …) so a
		 * park or a fallback verdict can say why the reviewer never spoke instead of only counting sessions.
		 */
		onNoVerdict?: (reason: string) => void;
	}): Promise<NKleinReviewResult | null>;
	/**
	 * Whether a review round for this card is CURRENTLY in flight (the single-flight key is held). The rescue
	 * dispatcher consults this so a duplicate dispatch skips BEFORE the review core runs — a blocked duplicate
	 * otherwise resolves "no submission" and increments the no-verdict park streak while the genuine round is
	 * still working (live-found 2026-07-18: three overlapped rescue dispatches nearly parked a verdicting card).
	 */
	isSecondOpinionReviewInFlight(taskId: string): boolean;
}

/**
 * §5.U: the §5.AB second-opinion reviewer session, extracted verbatim from InMemoryNKleinTaskSessionService as a
 * standalone harness-based runner (the sibling pattern to the speculative-mirror / merge-resolution runners). Spawns a
 * synthetic `<taskId>::review` sandbox session that judges the delivered tree with a lineage-DIVERSE model, bounded by
 * the shared harness. Owns its single-flight guard so two concurrent rounds can't destroy each other's workspace.
 */
export function createSecondOpinionReviewRunner(deps: SecondOpinionReviewRunnerDeps): SecondOpinionReviewRunner {
	/** #31: `::review` sessions share one workspace path per task — two concurrent rounds destroy each other. */
	const inFlightSecondOpinionReviewTaskIds = new Set<string>();

	function isSecondOpinionReviewInFlight(taskId: string): boolean {
		return inFlightSecondOpinionReviewTaskIds.has(taskId);
	}

	async function runSecondOpinionReviewSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		reviewer?: { providerId: string; modelId: string } | null;
		timeoutMs?: number;
		/** Diagnostic phase stamps (todo §12 review-hang autopsy); absent ⇒ zero overhead. */
		onReviewerResolved?: (reviewer: { providerId: string; modelId: string; selectionSource: string }) => void;
		/**
		 * P0.REVIEWNOVERDICT: called when the session ends WITHOUT a verdict, with its objective shape (cut at the
		 * verdict reserve after Ns, never admitted, nudge refused because no transcript could be resumed, …) so a
		 * park or a fallback verdict can say why the reviewer never spoke instead of only counting sessions.
		 */
		onNoVerdict?: (reason: string) => void;
		stampPhase?: (phase: string) => void;
	}): Promise<NKleinReviewResult | null> {
		const stamp = input.stampPhase ?? (() => {});
		if (!deps.getAgentSandboxManager()) {
			stamp("session: no sandbox manager (skip)");
			return null;
		}
		// #31 (run32 live): a second concurrent review for the same task would prepare the SAME
		// `<taskId>::review` workspace and the first round's teardown would destroy it mid-turn (the grinding
		// blocked-read loop + no verdict). Single-flight: the caller treats null as "skipped" (fail-closed
		// hold), and the in-flight round concludes normally.
		if (inFlightSecondOpinionReviewTaskIds.has(input.taskId)) {
			stamp("session: single-flight BLOCKED (a prior round is still in flight)");
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Second-opinion review already in flight for ${input.taskId}; skipping the concurrent round.`,
				taskId: `${input.taskId}::review`,
				workspacePath: input.projectRepoPath,
				metadata: { category: "second_opinion_review_single_flight" },
			});
			return null;
		}
		inFlightSecondOpinionReviewTaskIds.add(input.taskId);
		try {
			stamp("session: single-flight enter");
			return await runInner(input);
		} finally {
			inFlightSecondOpinionReviewTaskIds.delete(input.taskId);
			stamp("session: single-flight exit");
		}
	}

	/** The body of {@link runSecondOpinionReviewSession}; the wrapper owns ONLY the single-flight flag, so no
	 * early return or pre-`try` throw (sandbox unavailable, prepareWorkspace queue rejection, unresolvable
	 * reviewer) can leak it and permanently wedge the card's reviews (adversarial finding, 2026-07-02). */
	async function runInner(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		reviewer?: { providerId: string; modelId: string } | null;
		timeoutMs?: number;
		budgetAttempt?: number;
		onReviewerResolved?: (reviewer: { providerId: string; modelId: string; selectionSource: string }) => void;
		/**
		 * P0.REVIEWNOVERDICT: called when the session ends WITHOUT a verdict, with its objective shape (cut at the
		 * verdict reserve after Ns, never admitted, nudge refused because no transcript could be resumed, …) so a
		 * park or a fallback verdict can say why the reviewer never spoke instead of only counting sessions.
		 */
		onNoVerdict?: (reason: string) => void;
		stampPhase?: (phase: string) => void;
	}): Promise<NKleinReviewResult | null> {
		const stamp = input.stampPhase ?? (() => {});
		const sandboxManager = deps.getAgentSandboxManager();
		if (!sandboxManager) {
			return null;
		}
		stamp("session: reviewer-resolve");
		const workerLaunch = deps.getLaunchConfig(input.taskId) ?? null;
		// W2.5a (audit 2026-07-02, §5.AB): with NO configured reviewer this previously fell back to the WORKER's
		// own model — the model reviewing its own work, the worst monoculture form. Auto-pick a lineage-DIVERSE
		// loaded model instead (best-effort; when nothing diverse is loaded the waiver is recorded and the old
		// fallback stands, so behavior only ever improves).
		// LAST-RETRY ESCALATION (David 2026-09-06 "why need me"): the third no-verdict session used to be a
		// byte-identical replay on the same reviewer and then a park for a human. On the last retry pick the
		// STRONGEST routable non-worker model (P0.REVRANK: capability evidence ranks — registry × ledger/fitness ×
		// verdict — class fit gates, then context/quantization tie-break; lineage diversity waived) so the park is
		// only ever reached after the best available judge had its turn.
		const escalateToStrongest =
			!input.reviewer &&
			(input.budgetAttempt ?? 0) >= REVIEW_ESCALATE_TO_STRONGEST_ON_ATTEMPT &&
			!!workerLaunch?.modelId;
		const strongestReviewer = escalateToStrongest
			? await (async () => {
					const escalationBaseUrl = workerLaunch?.baseUrl?.trim() || resolveDefaultLocalModelBaseUrl();
					const loaded = await excludeUnroutableDescriptors(
						await fetchLoadedModelDescriptors(escalationBaseUrl).catch(
							() => [] as Awaited<ReturnType<typeof fetchLoadedModelDescriptors>>,
						),
						{ taskId: input.taskId, purpose: "no-verdict escalation reviewer" },
					);
					const workerModelId = workerLaunch?.modelId ?? "";
					const ledgerRootDir = deps.getLedgerRootDir?.();
					const evidence = await (deps.loadCapabilityEvidence ?? loadReviewerCapabilityEvidence)({
						providerId: workerLaunch?.providerId ?? "lmstudio",
						endpoint: escalationBaseUrl,
						...(ledgerRootDir !== undefined ? { ledgerRootDir } : {}),
					}).catch(() => DISABLED_REVIEWER_CAPABILITY_EVIDENCE);
					const best = buildReviewerCandidates(loaded, workerModelId, resolveWorkerRealId(loaded, workerModelId), {
						role: "reviewer",
						capabilityEvidence: evidence.resolve,
					})[0];
					return best ? { providerId: workerLaunch?.providerId ?? "lmstudio", modelId: best.modelKey } : null;
				})().catch(() => null)
			: null;
		if (strongestReviewer) {
			stamp(
				`session: no-verdict escalation → strongest reviewer ${strongestReviewer.modelId} (lineage diversity waived)`,
			);
		}
		const autoReviewer =
			strongestReviewer ??
			(!input.reviewer && workerLaunch?.providerId && workerLaunch.modelId
				? await pickDiverseReviewerModel(workerLaunch, input.taskId, "review", {
						lastShellKeyByModel: deps.getShellKeyByModelId(),
					}).catch(() => null)
				: null);
		let providerId = (
			input.reviewer?.providerId ??
			autoReviewer?.providerId ??
			workerLaunch?.providerId ??
			""
		).trim();
		let modelId = (input.reviewer?.modelId ?? autoReviewer?.modelId ?? workerLaunch?.modelId ?? "").trim();
		let usedLoadedFallback = false;
		if (!providerId || !modelId) {
			// Restart-durability fallback (root-caused live 2026-07-14): the launch config is IN-MEMORY only
			// (`launchConfigByTaskId`), so after a restart a resumed / crash-parked card has no worker provider+model to
			// resolve a reviewer from → the review would return null here → `no_verdict` → the card is HELD FOREVER (no
			// model turn ever runs). Fall back to the first non-embedding LOADED model so the review can still run — this
			// picks what's actually serving (avoids the trap of resolving a CONFIGURED role model that isn't loaded).
			const loaded = await excludeUnroutableDescriptors(
				await fetchLoadedModelDescriptors(workerLaunch?.baseUrl?.trim() || resolveDefaultLocalModelBaseUrl()).catch(
					() => [] as Awaited<ReturnType<typeof fetchLoadedModelDescriptors>>,
				),
				{ taskId: input.taskId, purpose: "reviewer fallback" },
			);
			const fallback = pickReviewFallbackDescriptor(loaded);
			if (fallback) {
				providerId = providerId || workerLaunch?.providerId?.trim() || "lmstudio";
				modelId = fallback.runtimeId;
				usedLoadedFallback = true;
			}
		}
		if (!providerId || !modelId) {
			return null;
		}
		const selectionSource = input.reviewer
			? "explicit_pin"
			: autoReviewer
				? "auto_diverse"
				: usedLoadedFallback
					? "loaded_fallback"
					: "worker_fallback";
		stamp(`session: reviewer=${modelId} (${selectionSource}); bracketed-run enter`);
		// Report the RESOLVED reviewer while the session still EXISTS: the harness clears the synthetic
		// `<taskId>::review` session in its finally, so a post-hoc getSummary lookup returns null (measured:
		// 0 of 76 review-capacity rows were attributed that way). The per-model ceiling depends on this.
		input.onReviewerResolved?.({ providerId, modelId, selectionSource });
		// A reasoning reviewer needs headroom to think BEFORE emitting `submit_review` — floor its per-turn budget so the
		// inherited (worker-sized) budget can't truncate it mid-reasoning into a `no_verdict` hold. Only raises; only for
		// reasoning models. Live-found 2026-07-18 (rig11, glm-4.6v-flash): name-matching alone missed a model whose
		// CATALOG declares reasoning (default "on") — it burned its whole budget thinking and returned empty on every
		// review. Union the name predicate with the loaded catalog's declared `reasoning` capability (the descriptors
		// are already fetched in this resolution).
		const reasoningDescriptors = await fetchLoadedModelDescriptors(
			workerLaunch?.baseUrl?.trim() || resolveDefaultLocalModelBaseUrl(),
		).catch(() => [] as Awaited<ReturnType<typeof fetchLoadedModelDescriptors>>);
		const catalogDeclaresReasoning = reasoningDescriptors.some(
			(descriptor) =>
				(descriptor.runtimeId === modelId || descriptor.modelKey === modelId) && descriptor.reasoning === true,
		);
		const baseMaxTokensPerTurn =
			isReasoningModel(modelId) || catalogDeclaresReasoning
				? Math.max(workerLaunch?.maxTokensPerTurn ?? 0, REASONING_REVIEWER_BUDGET_FLOOR)
				: (workerLaunch?.maxTokensPerTurn ?? null);
		// RAISE-ON-RETRY (campaign round 2, 2026-08-19): the no-verdict ladder re-ran the reviewer byte-identically,
		// and the telemetry showed every attempt ending `max-tokens` at the SAME output-token count — a
		// deterministic re-truncation at temperature 0, so the retries could not have succeeded. Each retry now
		// doubles the per-turn output budget (capped), mirroring the worker ladder's `raise_token_budget`-first
		// ordering for `aborted`/`no_tool_call`. Attempt 0 (the first try) is unchanged, so nothing moves for a
		// reviewer that verdicts normally. A null base budget stays null: the provider default is not ours to guess.
		const budgetAttempt = Math.max(0, Math.trunc(input.budgetAttempt ?? 0));
		const escalatedMaxTokensPerTurn =
			baseMaxTokensPerTurn === null
				? null
				: Math.min(
						REVIEW_RETRY_BUDGET_CEILING,
						baseMaxTokensPerTurn * 2 ** Math.min(budgetAttempt, REVIEW_RETRY_BUDGET_MAX_DOUBLINGS),
					);
		// Live 2026-09-05: the third retry raised the budget to 16k on the m4mini's 32k instance — the review prompt
		// plus 16k of output exceeds the window and the engine errors the turn (a strike with no verdict). Clamp the
		// output budget to a share of the reviewer's LOADED context so the prompt always keeps the larger part.
		const reviewerContextLength =
			reasoningDescriptors.find((descriptor) => descriptor.runtimeId === modelId || descriptor.modelKey === modelId)
				?.loadedContextLength ?? null;
		const contextSafeCeiling =
			reviewerContextLength !== null
				? Math.max(REVIEWER_OUTPUT_BUDGET_FLOOR, Math.floor(reviewerContextLength * REVIEWER_OUTPUT_CONTEXT_SHARE))
				: null;
		const reasoningSafeMaxTokensPerTurn =
			escalatedMaxTokensPerTurn !== null && contextSafeCeiling !== null
				? Math.min(escalatedMaxTokensPerTurn, contextSafeCeiling)
				: escalatedMaxTokensPerTurn;
		if (budgetAttempt > 0 && reasoningSafeMaxTokensPerTurn !== null) {
			stamp(
				`session: retry ${budgetAttempt} raises the per-turn output budget ${baseMaxTokensPerTurn} → ${reasoningSafeMaxTokensPerTurn}${
					escalatedMaxTokensPerTurn !== null && reasoningSafeMaxTokensPerTurn < escalatedMaxTokensPerTurn
						? ` (clamped from ${escalatedMaxTokensPerTurn}: reviewer context ${reviewerContextLength})`
						: ""
				}`,
			);
		}
		// F1.34c hang forensics 2026-07-25: reviews were observed stuck for 30+ minutes with "bracketed-run enter"
		// as their last stamp — an un-instrumented window spanning descriptor resolution, workspace/sandbox
		// acquisition, and the first model turn. These stamps split it so the NEXT hang names its exact segment.
		stamp("session: descriptors resolved; acquiring bracket workspace");
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...(workerLaunch ?? {}),
			providerId,
			modelId,
			workspaceRoot: input.projectRepoPath,
			...(reasoningSafeMaxTokensPerTurn !== null ? { maxTokensPerTurn: reasoningSafeMaxTokensPerTurn } : {}),
		};
		const reviewTaskId = `${input.taskId}::review`;
		const mergeTurnOutcome = (current: SecondaryTurnOutcome, next: SecondaryTurnOutcome): SecondaryTurnOutcome => {
			if (current === "timeout" || next === "timeout") {
				return "timeout";
			}
			if (current === "error" || next === "error") {
				return "error";
			}
			return "settled";
		};
		return deps.getHarness().runBracketed(
			{
				primaryTaskId: input.taskId,
				syntheticTaskId: reviewTaskId,
				projectRepoPath: input.projectRepoPath,
				baseRef: input.baseRef,
				timeoutMs: input.timeoutMs,
				defaultTimeoutMs: deps.defaultTimeoutMs,
				errorLabel: "Second-opinion reviewer session",
			},
			async ({ workspace, runBoundedTurn, deadline }) => {
				stamp("session: bracket workspace acquired; starting reviewer turn");
				let verdict: NKleinReviewResult | null = null;
				let turnOutcome: SecondaryTurnOutcome = "settled";
				// P1.REVIEWNUDGE: the budget starts when the session is admitted to its endpoint, not when it is queued.
				let admitted = false;
				let admittedAt: number | null = null;
				let markAdmitted: () => void = () => {};
				const admission = new Promise<void>((resolve) => {
					markAdmitted = () => {
						admitted = true;
						admittedAt ??= Date.now();
						resolve();
					};
				});
				const driveStartedAt = Date.now();
				// First turn: seed prompt + the submit_review tool. startRuntimeSession awaits the turn, so the
				// tool's verdict (if emitted) is captured by the time it settles.
				const startOutcome = await runBoundedTurn(
					deps.startRuntimeSession({
						taskId: reviewTaskId,
						admissionParentTaskId: input.taskId,
						onAdmitted: markAdmitted,
						cwd: workspace.workdir,
						workspaceRoot: input.projectRepoPath,
						prompt: input.seedPrompt,
						launchConfig,
						contextScope: "minimal",
						onReviewSubmitted: (result) => {
							// The verdict tool is the terminal protocol event. Some local models ignore its "stop now"
							// result and continue inspecting files/submitting contradictory verdicts, monopolizing the
							// reviewer host until timeout. First valid submission wins; actively stop that synthetic
							// session so the turn promise settles and the next queued review can proceed.
							if (verdict !== null) {
								return;
							}
							verdict = result;
							void deps.stopRuntimeSession(reviewTaskId).catch(() => undefined);
						},
						// Route the reviewer's file/bash tools into its sandbox container (so the host cwd is never
						// touched), exactly like a worker session — keeps strict isolation and lets the reviewer inspect.
						toolExecutors: createAgentSandboxToolExecutors(sandboxManager, reviewTaskId, {
							pauseController: deps.getPauseController(),
						}),
						extraTools: createAgentSandboxExtraTools(sandboxManager, reviewTaskId, {
							sessionId: createSessionId(reviewTaskId),
							contextWindow: launchConfig.contextWindow ?? undefined,
							maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
						}),
					}),
					// Campaign round 3 (2026-08-19): reviewers spent the ENTIRE deadline on exploration tool calls,
					// so the nudge loop below (gated on the deadline) never ran and three sessions timed out without
					// ever being ASKED for a verdict. Reserve a slice for the ask.
					{ reserveMs: REVIEW_VERDICT_RESERVE_MS, clockStartsOn: admission },
				);
				turnOutcome = mergeTurnOutcome(turnOutcome, startOutcome);
				const explorationMs = Date.now() - (admittedAt ?? driveStartedAt);
				// CUTTING A TURN MUST ALSO END IT. `runBoundedTurn` races the turn against a timer — it does not
				// cancel the loser — so a turn cut at the reserve boundary keeps its session, and therefore its
				// endpoint admission slot, alive with nobody awaiting it. On a 1-concurrency local host that slot
				// IS the fleet: the nudge below would queue behind the very turn it is replacing, and the primary
				// worker behind that. This mirrors what the verdict path already does for the same reason ("stop
				// that synthetic session so the turn promise settles and the next queued review can proceed") —
				// awaited here, because the point is that the lane is free BEFORE the nudge asks for it.
				//
				// P0.REVIEWNOVERDICT (2026-09-07): the stop ENDS the SDK session, so the nudge cannot be a plain send —
				// the service rebuilds the reviewer from its PERSISTED transcript (every completed iteration is on
				// disk) in a fresh session carrying the nudge as the next user turn. Before that, every post-cut
				// nudge threw "No active !Klein session" within milliseconds, both nudges burned, and the inline
				// retry ladder ran two more fresh explorations to the same cut: the "3 no-verdict sessions" park on
				// every review whose exploration outlived (timeout − reserve) — the park generator on slow-prefill rigs.
				const cutAtReserve = verdict === null && turnOutcome === "timeout";
				if (cutAtReserve) {
					stamp("session: exploration turn cut at the verdict reserve; releasing the endpoint before the nudge");
					await deps.stopRuntimeSession(reviewTaskId).catch(() => undefined);
				}
				// P1.REVIEWNUDGE: a session that was never ADMITTED has no transcript to nudge — every nudge to it would
				// restart a fresh reviewer from the seed prompt (HITL 2026-09-07: three concurrent S72 reviewers within
				// 50 ms, all answering the same card). The outcome is the honest one: no verdict, no ghosts.
				// A start that SETTLED ran (a test double may not signal admission); only a cut-while-queued start has none.
				const neverAdmitted = !admitted && turnOutcome === "timeout";
				if (verdict === null && neverAdmitted) {
					stamp("session: start was never admitted to the endpoint within the budget; skipping the nudge");
				}
				// Re-prompt nudge: small models often end a turn without the structured call. Mirror the decomposition
				// re-prompt — if there's still no verdict, tell the reviewer to call submit_review now, bounded by a
				// small budget and the overall deadline (the reserve above guarantees this budget is non-empty).
				const nudgeOutcomes: SecondaryTurnOutcome[] = [];
				let nudgeRefusal: string | null = null;
				for (
					let nudge = 0;
					verdict === null &&
					!neverAdmitted &&
					nudgeRefusal === null &&
					nudge < deps.maxNudges &&
					Date.now() < deadline();
					nudge += 1
				) {
					const nudgeTurn = deps.sendTaskSessionInput(
						reviewTaskId,
						SECOND_OPINION_REVIEW_NUDGE_PROMPT,
						input.taskId,
					);
					// Side-channel on the same promise: the bounded turn records every failure; the runner only needs
					// to know whether this one was the deterministic "no transcript to resume" refusal — retrying
					// that changes nothing, so it ends the nudging and becomes the park's objective reason.
					const refusal = nudgeTurn.then(
						() => null,
						(error: unknown) => (isAuxiliarySessionTranscriptUnavailableError(error) ? error.message : null),
					);
					const nudgeOutcome = await runBoundedTurn(nudgeTurn);
					nudgeOutcomes.push(nudgeOutcome);
					turnOutcome = mergeTurnOutcome(turnOutcome, nudgeOutcome);
					if (nudgeOutcome === "error") {
						nudgeRefusal = await refusal;
						if (nudgeRefusal) {
							stamp(`session: nudge ${nudge + 1} cannot reach the reviewer's transcript — ${nudgeRefusal}`);
						}
					}
				}
				// Widen past TS's closure-assignment blind spot: `verdict` is written by the submit_review callback.
				const submittedVerdict = verdict as NKleinReviewResult | null;
				// P0.REVIEWNOVERDICT: a session that produced no verdict names its objective shape — the park and the
				// fallback verdict quote it, and the reviewer-health stream can separate "budget too small for this
				// diff" from "the model never verdicts" (both used to read as the same three silent sessions).
				const noVerdictReason = submittedVerdict
					? null
					: describeReviewNoVerdict({
							neverAdmitted,
							cutAtReserve,
							startOutcome,
							explorationMs,
							nudgeOutcomes,
							nudgeRefusal,
							maxNudges: deps.maxNudges,
							budgetExhausted: Date.now() >= deadline(),
						});
				if (noVerdictReason) {
					stamp(`session: no verdict — ${noVerdictReason}`);
					try {
						input.onNoVerdict?.(noVerdictReason);
					} catch {
						// A caller-side listener must never break the session's own accounting.
					}
				}
				// A SUBMITTED verdict outranks the turn outcome. Since the verdict reserve landed, the exploration
				// turn is CUT at the reserve boundary on purpose — `mergeTurnOutcome` lets that intentional timeout
				// dominate, so a session rescued by the nudge (exactly what the reserve exists to enable) was being
				// recorded as `timeout`. That made the reviewer-health stream unable to distinguish "cut exploration
				// short and got the verdict" (success) from "got nothing" (failure) — the measurement would have
				// mis-read the fix's own successes as failures. The artifact is the verdict; classify on it first.
				const observationOutcome = submittedVerdict
					? "verdict"
					: turnOutcome === "settled"
						? "no_verdict"
						: turnOutcome;
				recordSelfObservation({
					signal: "custom",
					severity: observationOutcome === "verdict" ? "info" : "warning",
					message:
						`Second-opinion review session ${observationOutcome} for ${input.taskId} ` +
						`on ${providerId}/${modelId}.`,
					taskId: reviewTaskId,
					providerId,
					modelId,
					workspacePath: input.projectRepoPath,
					metadata: {
						category: "second_opinion_review_session",
						sessionKind: "review",
						primaryTaskId: input.taskId,
						syntheticTaskId: reviewTaskId,
						providerId,
						modelId,
						selectionSource,
						turnOutcome,
						outcome: observationOutcome,
						verdict: submittedVerdict?.verdict ?? null,
						// P0.REVIEWNOVERDICT: the session's shape, so the health stream can count cuts and resumes.
						// `transcriptResumed` is OBSERVED, not guessed: after the cut there is no live session, so a nudge
						// that was not met by the typed "cannot be resumed" refusal reached the model through the service's
						// transcript rebuild. A nudge that then errors or times out MODEL-side was still resumed.
						cutAtReserve,
						nudges: nudgeOutcomes.length,
						transcriptResumed: cutAtReserve && nudgeOutcomes.length > 0 && nudgeRefusal === null,
						noVerdictReason,
					},
				});
				return submittedVerdict;
			},
		);
	}

	return { runSecondOpinionReviewSession, isSecondOpinionReviewInFlight };
}
