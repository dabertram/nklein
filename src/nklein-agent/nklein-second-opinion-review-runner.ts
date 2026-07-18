import type { PromptWarmthLedgerEntry } from "../core/cache-warmth";
import { fetchLoadedModelDescriptors, pickReviewFallbackDescriptor } from "../core/lmstudio-loaded-model-descriptors";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../core/local-model-endpoint";
import { isReasoningModel } from "../core/model-thinking-control";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { type AgentSandboxManager, createAgentSandboxToolExecutors } from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import type { NKleinTaskRestartLaunchConfig } from "./nklein-launch-config";
import type { NKleinPauseController } from "./nklein-pause-controller";
import type { NKleinReviewResult } from "./nklein-review-tool";
import { pickDiverseReviewerModel } from "./nklein-reviewer-model-selection";
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

/** Re-prompt the reviewer if it ended a turn without the structured `submit_review` call (small models often do). */
const SECOND_OPINION_REVIEW_NUDGE_PROMPT =
	"You ended your turn without calling `submit_review`, so no review was recorded. Your verdict is delivered ONLY by that tool. Call `submit_review` now: `approve`, or `request_changes` with concrete, actionable feedback. Do not answer in prose.";

export interface SecondOpinionReviewRunnerDeps {
	getAgentSandboxManager(): AgentSandboxManager | null;
	getLaunchConfig(taskId: string): NKleinTaskRestartLaunchConfig | null;
	/** The §5.AQ warmth ledger (read by the diverse-reviewer auto-pick). */
	getShellKeyByModelId(): Map<string, PromptWarmthLedgerEntry>;
	getPauseController(): NKleinPauseController;
	/** The shared secondary-session harness (bounded sandbox session + always-teardown). */
	getHarness(): SecondarySessionHarness;
	startRuntimeSession(input: StartRuntimeTaskSessionFromLaunchConfigInput): Promise<RuntimeTaskSessionStartResult>;
	sendTaskSessionInput(taskId: string, prompt: string): Promise<unknown>;
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
		const autoReviewer =
			!input.reviewer && workerLaunch?.providerId && workerLaunch.modelId
				? await pickDiverseReviewerModel(workerLaunch, input.taskId, "review", {
						lastShellKeyByModel: deps.getShellKeyByModelId(),
					}).catch(() => null)
				: null;
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
			const loaded = await fetchLoadedModelDescriptors(
				workerLaunch?.baseUrl?.trim() || DEFAULT_LOCAL_MODEL_BASE_URL,
			).catch(() => [] as Awaited<ReturnType<typeof fetchLoadedModelDescriptors>>);
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
		// A reasoning reviewer needs headroom to think BEFORE emitting `submit_review` — floor its per-turn budget so the
		// inherited (worker-sized) budget can't truncate it mid-reasoning into a `no_verdict` hold. Only raises; only for
		// reasoning models. Live-found 2026-07-18 (rig11, glm-4.6v-flash): name-matching alone missed a model whose
		// CATALOG declares reasoning (default "on") — it burned its whole budget thinking and returned empty on every
		// review. Union the name predicate with the loaded catalog's declared `reasoning` capability (the descriptors
		// are already fetched in this resolution).
		const reasoningDescriptors = await fetchLoadedModelDescriptors(
			workerLaunch?.baseUrl?.trim() || DEFAULT_LOCAL_MODEL_BASE_URL,
		).catch(() => [] as Awaited<ReturnType<typeof fetchLoadedModelDescriptors>>);
		const catalogDeclaresReasoning = reasoningDescriptors.some(
			(descriptor) =>
				(descriptor.runtimeId === modelId || descriptor.modelKey === modelId) && descriptor.reasoning === true,
		);
		const reasoningSafeMaxTokensPerTurn =
			isReasoningModel(modelId) || catalogDeclaresReasoning
				? Math.max(workerLaunch?.maxTokensPerTurn ?? 0, REASONING_REVIEWER_BUDGET_FLOOR)
				: (workerLaunch?.maxTokensPerTurn ?? null);
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
			async ({ workspace, deadlineMs, runBoundedTurn }) => {
				let verdict: NKleinReviewResult | null = null;
				let turnOutcome: SecondaryTurnOutcome = "settled";
				// First turn: seed prompt + the submit_review tool. startRuntimeSession awaits the turn, so the
				// tool's verdict (if emitted) is captured by the time it settles.
				turnOutcome = mergeTurnOutcome(
					turnOutcome,
					await runBoundedTurn(
						deps.startRuntimeSession({
							taskId: reviewTaskId,
							cwd: workspace.workdir,
							workspaceRoot: input.projectRepoPath,
							prompt: input.seedPrompt,
							launchConfig,
							contextScope: "minimal",
							onReviewSubmitted: (result) => {
								verdict = result;
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
					),
				);
				// Re-prompt nudge: small models often end a turn without the structured call. Mirror the decomposition
				// re-prompt — if there's still no verdict, tell the reviewer to call submit_review now, bounded by a
				// small budget and the overall deadline.
				for (let nudge = 0; verdict === null && nudge < deps.maxNudges && Date.now() < deadlineMs; nudge += 1) {
					turnOutcome = mergeTurnOutcome(
						turnOutcome,
						await runBoundedTurn(deps.sendTaskSessionInput(reviewTaskId, SECOND_OPINION_REVIEW_NUDGE_PROMPT)),
					);
				}
				// Widen past TS's closure-assignment blind spot: `verdict` is written by the submit_review callback.
				const submittedVerdict = verdict as NKleinReviewResult | null;
				const observationOutcome =
					turnOutcome === "settled" ? (submittedVerdict ? "verdict" : "no_verdict") : turnOutcome;
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
					},
				});
				return submittedVerdict;
			},
		);
	}

	return { runSecondOpinionReviewSession, isSecondOpinionReviewInFlight };
}
