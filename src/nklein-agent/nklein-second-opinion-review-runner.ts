import type { PromptWarmthLedgerEntry } from "../core/cache-warmth";
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
		const providerId = (
			input.reviewer?.providerId ??
			autoReviewer?.providerId ??
			workerLaunch?.providerId ??
			""
		).trim();
		const modelId = (input.reviewer?.modelId ?? autoReviewer?.modelId ?? workerLaunch?.modelId ?? "").trim();
		if (!providerId || !modelId) {
			return null;
		}
		const selectionSource = input.reviewer ? "explicit_pin" : autoReviewer ? "auto_diverse" : "worker_fallback";
		stamp(`session: reviewer=${modelId} (${selectionSource}); bracketed-run enter`);
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...(workerLaunch ?? {}),
			providerId,
			modelId,
			workspaceRoot: input.projectRepoPath,
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

	return { runSecondOpinionReviewSession };
}
