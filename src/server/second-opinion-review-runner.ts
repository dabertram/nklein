/**
 * Live second-opinion review runner (todo.md §5.K).
 *
 * The state hub calls this when a worker card becomes reviewable. It wires the pure
 * {@link runNKleinSecondOpinionReview} orchestrator to real I/O — runtime config (is review on, the round cap,
 * the reviewer model), the board (the card + its diff), the reviewer session (via the task-session service), and
 * the board transitions (persist the review round; on bounce move the card back to In Progress and re-drive the
 * worker; on park flag it). All I/O is injectable so the wiring is unit-testable without a live model or Docker;
 * the reviewer session itself (`service.runSecondOpinionReviewSession`) is the one piece that needs a live model.
 */

import { loadRuntimeConfig } from "../config/runtime-config";
import type { RuntimeBoardCard, RuntimeBoardData, RuntimeCardReview } from "../core/api-contract";
import { REVIEW_PHASE_CATEGORY } from "../core/card-tracking-coverage";
import { isCrashRecoveryMatrixPhaseEnabled, reachCrashRecoveryMatrixBarrier } from "../core/crash-recovery-matrix";
import { isTruthyEnv } from "../core/env-flag";
import { arbitrateByExecution, type CandidateExecutionRun } from "../core/execution-arbitration";
import { deriveFrontendRouteFromChangedPaths } from "../core/frontend-preview-plan";
import { buildHistoryBlindCorrectorPrompt } from "../core/history-blind-corrector";
import { fetchLoadedModelDescriptors, type LoadedModelDescriptor } from "../core/lmstudio-loaded-model-descriptors";
import { fetchLoadedModelIdsCached } from "../core/lmstudio-loaded-models";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../core/local-model-endpoint";
import { modelsShareLineage, resolveLineage } from "../core/model-lineage";
import { planReviewEffort } from "../core/review-effort-scaling";
import type { ReviewBoardContext, ReviewRelatedCard, ReviewSubmissionInput } from "../core/review-orchestration";
import { fingerprintReviewArtifact } from "../core/review-orchestration";
import { planReviewPanel } from "../core/review-panel-plan";
import { resolveSwarmRoleModel } from "../core/swarm-role-selection";
import { addTaskToColumn } from "../core/task-board-mutations";
import { classifyTaskComplexity } from "../core/task-complexity";
import type { RuntimeTaskAcceptanceResult } from "../core/task-lifecycle-api-contract";
import { decideTestDrivenDelivery } from "../core/test-driven-delivery";
import { decideVerificationFirst } from "../core/verification-first-gate";
import { buildVerificationRubric, renderRubricLensStance } from "../core/verification-rubric";
import { recordCommunitySkillEffectivenessForTask } from "../nklein-agent/community-skill-effectiveness-recorder";
import {
	getReusableAcceptanceEvidence,
	storeAcceptanceEvidence,
} from "../nklein-agent/nklein-acceptance-evidence-registry";
import { extractAcceptanceFailureConstraint } from "../nklein-agent/nklein-acceptance-repair";
import { getBaselineProbe } from "../nklein-agent/nklein-baseline-probe-registry";
import { hashWorkspacePathForLedger } from "../nklein-agent/nklein-ledger-attempt";
import { type PanelJudge, runNEyesReviewPanel, runReviewPanel } from "../nklein-agent/nklein-review-panel-runner";
import { buildReviewerCandidates, resolveWorkerRealId } from "../nklein-agent/nklein-reviewer-candidate-selection";
import { selectReviewerPanel } from "../nklein-agent/nklein-reviewer-panel-selection";
import {
	type NKleinSecondOpinionReviewOutcome,
	runNKleinSecondOpinionReview,
} from "../nklein-agent/nklein-second-opinion-review";
import type { NKleinTaskSessionService } from "../nklein-agent/nklein-task-session-service";
import { recordExecutionOutcomeForTaskSkills } from "../nklein-agent/procedural-skill-execution-recorder";
import { readAgentLedger } from "../state/agent-attempt-ledger-store";
import { loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { deleteTaskResultBranch, getTaskResultBranchDiff } from "../workspace/task-result-branches";
import { retryWorkspaceStateLock } from "./workspace-state-lock-retry";

/** Suffix the service uses for the isolated reviewer session id; guards against reviewing a review. */
const REVIEW_SESSION_TASK_SUFFIX = "::review";

/** W4.2 layer 3: one worker-escalation per card per server run (resets on restart — v1 semantics). */
const escalatedWorkerTaskIds = new Set<string>();

function shouldQuiescePrimaryWorkerBeforeReview(summary: ReturnType<NKleinTaskSessionService["getSummary"]>): boolean {
	if (summary?.state !== "running") {
		return false;
	}
	const hookEventName = summary.latestHookActivity?.hookEventName ?? null;
	return hookEventName === "sandbox_patch_empty" || hookEventName === "sandbox_patch_captured";
}

/** Returns a new board with the card's review state set, optionally moving it to `targetColumnId`. */
export function applyCardReviewToBoard(
	board: RuntimeBoardData,
	taskId: string,
	review: RuntimeCardReview,
	targetColumnId?: string,
	now: () => number = Date.now,
): RuntimeBoardData {
	let movedCard: RuntimeBoardData["columns"][number]["cards"][number] | null = null;
	const columns = board.columns.map((column) => {
		const existing = column.cards.find((card) => card.id === taskId);
		if (!existing) {
			return column;
		}
		const updated = { ...existing, review, updatedAt: now() };
		if (targetColumnId && targetColumnId !== column.id) {
			movedCard = updated;
			return { ...column, cards: column.cards.filter((card) => card.id !== taskId) };
		}
		return { ...column, cards: column.cards.map((card) => (card.id === taskId ? updated : card)) };
	});
	if (movedCard && targetColumnId) {
		const landed: RuntimeBoardData["columns"][number]["cards"][number] = movedCard;
		return {
			...board,
			columns: columns.map((column) =>
				column.id === targetColumnId ? { ...column, cards: [...column.cards, landed] } : column,
			),
		};
	}
	return { ...board, columns };
}

export interface RunSecondOpinionReviewForTaskInput {
	workspacePath: string;
	taskId: string;
	/**
	 * The trusted runtime gate's admitted primary-artifact class. Keep this explicit: a null/empty diff can also mean
	 * branch lookup or capture trouble, while `empty_patch` means the worker really handed off with no file changes.
	 */
	primaryArtifactStatus?: "result_branch" | "empty_patch";
	/** Exact primary artifact admitted by the runtime gate; prevents review from drifting to a later branch update. */
	primaryResultCommit?: string | null;
	/** Exact speculative candidate observed alongside the primary admission, when present. */
	speculativeResultCommit?: string | null;
	service: Pick<NKleinTaskSessionService, "runSecondOpinionReviewSession" | "sendTaskSessionInput" | "getSummary"> &
		Partial<
			Pick<
				NKleinTaskSessionService,
				| "verifyTaskAcceptanceInSandbox"
				| "verifyTaskVisualInSandbox"
				| "pickDiverseEscalationModel"
				| "cancelTaskTurn"
				| "cancelSpeculativeMirror"
				| "isSecondOpinionReviewInFlight"
				| "noteNextAttemptStrategy"
				| "markSandboxRecaptureExpected"
			>
		>;
	loadWorkspaceState?: typeof loadWorkspaceState;
	mutateWorkspaceState?: typeof mutateWorkspaceState;
	loadRuntimeConfig?: typeof loadRuntimeConfig;
	getTaskResultBranchDiff?: typeof getTaskResultBranchDiff;
	now?: () => number;
	/** Sink for surfaced-but-non-blocking signals (e.g. the reviewer-monoculture waiver, §5.AB W0.4). */
	warn?: (message: string) => void;
	/** Called after the review ladder creates a re-decompose recovery card so the runtime can schedule it immediately. */
	onRedecomposeCardSpawned?: (taskId: string) => void | Promise<void>;
	/**
	 * W2.5 pin residency probe: the loaded model ids the configured reviewer PIN is checked against (injectable for
	 * tests). Default probes the local LM Studio endpoint outside the test runner; failures resolve to an empty
	 * list, which — lenient, exactly like `shouldBlockUnloadedModel` — HONORS the pin (an unreachable probe must
	 * never wedge a review).
	 */
	fetchLoadedModelIds?: () => Promise<readonly string[]>;
	/**
	 * §5.AB panel: the loaded descriptors the panel judges are assembled from (injectable for tests — the real fetch is
	 * skipped under the test runner exactly like the pin probe, so the panel path is only exercised when a fetch is
	 * injected or a live endpoint is present).
	 */
	fetchLoadedModelDescriptors?: (baseUrl: string) => Promise<readonly LoadedModelDescriptor[]>;
}

const REVIEW_PLAN_OBJECTIVE_BUDGET = 2_000;

/**
 * Derives the card's board/plan context for the reviewer: the plan objective it serves, its prerequisites
 * (cards it depends on), its dependents (cards depending on it), and its sibling cards from the same plan — so
 * the reviewer judges fit, scope, and coherence across the board, not the card in isolation. A dependency edge
 * `fromTaskId → toTaskId` means `fromTaskId` depends on `toTaskId`.
 */
export function buildReviewBoardContext(board: RuntimeBoardData, card: RuntimeBoardCard): ReviewBoardContext {
	const byId = new Map<string, ReviewRelatedCard>();
	for (const column of board.columns) {
		for (const entry of column.cards) {
			byId.set(entry.id, { title: entry.title ?? entry.id, column: column.id });
		}
	}
	const dependsOn: ReviewRelatedCard[] = [];
	const dependedOnBy: ReviewRelatedCard[] = [];
	for (const dependency of board.dependencies) {
		if (dependency.fromTaskId === card.id) {
			const related = byId.get(dependency.toTaskId);
			if (related) {
				dependsOn.push(related);
			}
		} else if (dependency.toTaskId === card.id) {
			const related = byId.get(dependency.fromTaskId);
			if (related) {
				dependedOnBy.push(related);
			}
		}
	}
	const planTaskId = card.generatedFromPlan?.planTaskId ?? null;
	const siblings: ReviewRelatedCard[] = [];
	let planObjective: string | null = null;
	if (planTaskId) {
		for (const column of board.columns) {
			for (const entry of column.cards) {
				if (entry.id === planTaskId) {
					planObjective = entry.prompt.slice(0, REVIEW_PLAN_OBJECTIVE_BUDGET);
				} else if (entry.id !== card.id && entry.generatedFromPlan?.planTaskId === planTaskId) {
					siblings.push({ title: entry.title ?? entry.id, column: column.id });
				}
			}
		}
	}
	return {
		planObjective,
		...(dependsOn.length > 0 ? { dependsOn } : {}),
		...(dependedOnBy.length > 0 ? { dependedOnBy } : {}),
		...(siblings.length > 0 ? { siblings } : {}),
	};
}

/** Bound tail of acceptance output shown to the reviewer (enough to judge a failure, small enough for tiny windows). */
const ACCEPTANCE_OUTPUT_TAIL_BUDGET = 800;

/**
 * Format an acceptance result into the reviewer-facing "## Acceptance check" summary (W1.5). Pure. Null when there
 * is nothing meaningful to tell the reviewer (no check ran and none exists — the core omits the section entirely).
 * A failing or MISSING acceptance is framed as strong request-changes grounds (fail-closed posture, W0.1).
 */
export function formatAcceptanceSummaryForReview(
	acceptance: Pick<
		RuntimeTaskAcceptanceResult,
		"present" | "command" | "passed" | "exitCode" | "output" | "failureHint"
	> | null,
	// F12.60(a): the card-start BASE-tree probe, when one ran — turns a red acceptance into an ATTRIBUTED verdict.
	baseline?: { present: boolean; passed: boolean | null } | null,
): string | null {
	if (acceptance === null) {
		return "Acceptance evidence UNAVAILABLE (the check could not run). Treat completion claims skeptically — the delivery gate will fail closed without a passing acceptance run.";
	}
	if (acceptance.present !== true) {
		return "NO acceptance command exists on this card. Treat this as strong grounds to request changes (every card should carry a machine-runnable acceptance check); auto-delivery is held without one.";
	}
	const verdict = acceptance.passed === true ? "PASSED" : `FAILED (exit ${acceptance.exitCode ?? "?"})`;
	const outputTail = acceptance.output.trim().slice(-ACCEPTANCE_OUTPUT_TAIL_BUDGET);
	const failureConstraint = acceptance.passed === false ? extractAcceptanceFailureConstraint(acceptance.output) : null;
	// F12.60(a) attribution: a red acceptance reads very differently when the BASE tree was already red before any
	// work happened — say which world the reviewer is in, in both directions, only when a probe actually ran.
	const attribution =
		acceptance.passed === false && baseline?.present === true && baseline.passed !== null
			? baseline.passed
				? "Baseline attribution: the BASE tree PASSED this check before the work — this failure is attributable to the change."
				: "Baseline attribution: the BASE tree ALREADY FAILED this check before any work — the failure may be pre-existing; judge the diff on its own merits rather than holding the worker to a baseline that was never green."
			: null;
	return [
		`Command: \`${acceptance.command ?? "?"}\` — ${verdict}.`,
		...(attribution ? [attribution] : []),
		...(acceptance.passed === true
			? []
			: [
					"A failing acceptance check is strong grounds to request changes — reconcile the worker's claims against this result.",
					...(acceptance.failureHint?.trim() ? [`Failure hint: ${acceptance.failureHint.trim()}`] : []),
				]),
		...(failureConstraint && acceptance.passed !== true
			? ["", "Failing test/error excerpt:", "```", failureConstraint, "```"]
			: outputTail && acceptance.passed !== true
				? ["", "Output tail:", "```", outputTail, "```"]
				: []),
	].join("\n");
}

export async function runSecondOpinionReviewForTask(
	input: RunSecondOpinionReviewForTaskInput,
): Promise<NKleinSecondOpinionReviewOutcome> {
	const loadState = input.loadWorkspaceState ?? loadWorkspaceState;
	const mutate = input.mutateWorkspaceState ?? mutateWorkspaceState;
	const loadConfig = input.loadRuntimeConfig ?? loadRuntimeConfig;
	const getDiff = input.getTaskResultBranchDiff ?? getTaskResultBranchDiff;
	const now = input.now ?? Date.now;

	const config = await loadConfig(input.workspacePath);
	const state = await retryWorkspaceStateLock(() => loadState(input.workspacePath));
	const located = state.board.columns
		.flatMap((column) => column.cards.map((card) => ({ columnId: column.id, card })))
		.find((entry) => entry.card.id === input.taskId);
	if (!located) {
		return { type: "skipped", reason: "card_not_found" };
	}
	const { card, columnId } = located;
	// Duplicate-dispatch guard (live 2026-07-18): the stalled-review rescue can re-dispatch a card whose round is
	// STILL RUNNING (eye/judge sessions run under the runner's single-flight key, invisible to the watchdog's
	// active-session view). A blocked duplicate resolves "no submission" and increments the no-verdict park
	// streak — three duplicates would park a card whose genuine round is about to submit. Skip up front instead.
	if (input.service.isSecondOpinionReviewInFlight?.(input.taskId)) {
		input.warn?.(`[review-phase] ${input.taskId}: review-resolution skipped (a review round is already in flight)`);
		return { type: "skipped", reason: "review_round_in_flight" };
	}
	// run21 finding: a re-driven/escalated worker is BLIND to the card's declared file scope and burns its
	// turns on blocked writes (3 strikes → abandoned). Name the fence UP FRONT in every re-drive prompt.
	const fileScopeNote =
		Array.isArray(card.filesLikelyTouched) && card.filesLikelyTouched.length > 0
			? `\n\nIMPORTANT — this card's declared file scope (writes OUTSIDE these paths are blocked): ${card.filesLikelyTouched.join(", ")}. Work within it; if the task genuinely needs another file, say so instead of retrying blocked writes.`
			: "";
	const reviewerRole = config.effectiveModelRoles?.reviewer ?? null;
	const pinnedReviewer =
		reviewerRole?.modelSelectionMode === "pinned" && reviewerRole.providerId && reviewerRole.modelId
			? { providerId: reviewerRole.providerId, modelId: reviewerRole.modelId }
			: null;
	// W2.5 role auto-assignment: the configured reviewer is automatic by default. Only an explicit pinned reviewer is
	// honored as a hard user choice. If a positive loaded-set probe proves that pin is absent, block the review/delivery
	// instead of waiving the pin to the service's lineage-diverse auto-pick. Lenient exactly like
	// `shouldBlockUnloadedModel`: an unknown/empty loaded set honors the pin, so an unreachable probe never wedges a
	// review. The probe is skipped under the test runner unless injected, mirroring the task-start residency gate.
	const reviewer = pinnedReviewer;
	if (pinnedReviewer) {
		const residencyCheckEnabled = !(process.env.VITEST || process.env.NODE_ENV === "test");
		const probeLoadedModelIds =
			input.fetchLoadedModelIds ??
			(residencyCheckEnabled
				? // Default local LM Studio endpoint — the same fallback the service's diverse-pick uses.
					() => fetchLoadedModelIdsCached(DEFAULT_LOCAL_MODEL_BASE_URL)
				: null);
		const loadedIds = probeLoadedModelIds ? await probeLoadedModelIds().catch(() => [] as string[]) : [];
		if (loadedIds.length > 0) {
			const pinDecision = resolveSwarmRoleModel({
				role: "reviewer",
				pinned: pinnedReviewer,
				candidates: loadedIds.map((id) => ({ modelKey: id, modelId: id, score: 0 })),
			});
			if (pinDecision.source === "unmatched_pin") {
				const message =
					`Configured reviewer ${pinnedReviewer.providerId}/${pinnedReviewer.modelId} for ${input.taskId} ` +
					`is pinned but not currently loaded/runnable. Load that model or switch the reviewer assignment back to Auto. ` +
					pinDecision.reasons.join(" ");
				input.warn?.(message);
				return { type: "blocked", reason: "pinned_reviewer_unavailable", message };
			}
		}
	}
	// §5.AB reasoning-diversity observability (audit W0.4): a reviewer sharing the WORKER's lineage is a
	// CORRELATED second opinion (same-family models agree on wrong answers ~60% — research 2026-07-02). Surfaced,
	// not blocked — an explicit pin is the user's call (the W2.5 auto path prefers a diverse reviewer via
	// applyDiversityPreference), so the waiver must at least be visible instead of silently monocultural.
	const workerSummary = input.service.getSummary(input.taskId);
	const workerModelId = workerSummary?.modelId ?? null;
	if (reviewer && workerModelId && modelsShareLineage(workerModelId, reviewer.modelId)) {
		input.warn?.(
			`Reviewer ${reviewer.modelId} shares the ${resolveLineage(reviewer.modelId)} lineage with worker ` +
				`${workerModelId} on ${input.taskId} — correlated second opinion (diversity waived).`,
		);
	}
	// A sandbox handoff can leave the PRIMARY worker summary in `running` even though the latest activity is already the
	// terminal patch-capture marker. If the reviewer then waits behind capacity, that stale primary session looks like
	// live model work and can occupy verifier/scheduler lanes. Quiesce only this proven handoff shape; a real in-flight
	// re-drive has normal tool/model activity and is left alone.
	if (shouldQuiescePrimaryWorkerBeforeReview(workerSummary)) {
		await input.service.cancelTaskTurn?.(input.taskId).catch(() => null);
	}

	// §5.AB parallel panel-of-judges (OPT-IN via NKLEIN_REVIEW_PANEL; default OFF ⇒ the single-reviewer path, byte-
	// identical). Assemble up to 3 base-family-DIVERSE judges from the loaded set (David 2026-07-07: "3 diverse judges,
	// majority + security veto"). Each judge reviews the SAME seed; their verdicts combine into ONE effective submission
	// that drives the UNCHANGED deliver/bounce lifecycle. Best-effort: an unreachable endpoint / <2 diverse judges ⇒ the
	// single reviewer. The probe is skipped under the test runner (no live endpoint) unless a fetch is injected.
	const panelEnabled = config.secondOpinionReviewEnabled && isTruthyEnv(process.env.NKLEIN_REVIEW_PANEL);
	let panelJudges: PanelJudge[] = [];
	if (panelEnabled) {
		// The live descriptor fetch is skipped under the test runner (no endpoint) exactly like the pin probe — but an
		// INJECTED fetch is honored, so the panel-assembly wiring is unit-testable without a live LM Studio.
		const residencyCheckEnabled = !(process.env.VITEST || process.env.NODE_ENV === "test");
		const fetchDescriptors =
			input.fetchLoadedModelDescriptors ?? (residencyCheckEnabled ? fetchLoadedModelDescriptors : null);
		if (fetchDescriptors) {
			const reviewerProviderId = reviewer?.providerId ?? workerSummary?.providerId ?? "lmstudio";
			const baseUrl = workerSummary?.endpoint?.trim() || DEFAULT_LOCAL_MODEL_BASE_URL;
			const descriptors = await fetchDescriptors(baseUrl).catch(() => []);
			const workerRealId = resolveWorkerRealId(descriptors, workerModelId);
			// Panel size: David's default is 3 (decision #2); tunable via NKLEIN_REVIEW_PANEL_SIZE, clamped to [2, 5] (a panel
			// needs ≥2 to have a second opinion; capped so a large loaded fleet can't spawn an endpoint-overloading panel).
			const panelSize = Math.min(
				5,
				Math.max(2, Number.parseInt(process.env.NKLEIN_REVIEW_PANEL_SIZE ?? "3", 10) || 3),
			);
			panelJudges = selectReviewerPanel({
				candidates: buildReviewerCandidates(descriptors, workerModelId, workerRealId),
				workerLineage: resolveLineage(workerRealId),
				size: panelSize,
			}).map((candidate) => ({
				judgeModelKey: candidate.modelId,
				reviewer: { providerId: reviewerProviderId, modelId: candidate.modelKey },
			}));
			// Live-debug visibility (2026-07-18): the panel silently fell to the single-reviewer path on the rig —
			// say WHAT assembled so an empty/thin panel is diagnosable from the log instead of archaeology.
			input.warn?.(
				`Review panel assembly for ${input.taskId}: ${panelJudges.length} judge(s) from ${descriptors.length} loaded descriptor(s) [${panelJudges.map((judge) => judge.judgeModelKey).join(", ") || "none"}]; nEyes=${isTruthyEnv(process.env.NKLEIN_N_EYES_REVIEW)}.`,
			);
			// F4.8b: the line above went only to the runtime log — weakly structured, no reliable timestamp, and
			// impossible to COUNT. So "did the panel ever actually assemble, and with how many judges?" could only
			// be answered by reading logs, which is how it silently fell back to the single-reviewer path on the rig
			// in the first place. A structured observation makes the mechanism measurable and registerable.
			//
			// Recorded even when the panel comes out EMPTY: a thin or zero-judge panel is the failure worth
			// catching, and emitting only on success would hide precisely that case.
			try {
				recordSelfObservation({
					signal: "custom",
					severity: panelJudges.length > 0 ? "info" : "warning",
					message: `Review panel assembled for ${input.taskId}: ${panelJudges.length} judge(s) from ${descriptors.length} descriptor(s).`,
					taskId: input.taskId,
					workspacePath: input.workspacePath,
					metadata: {
						category: "review_panel_assembly",
						judges: panelJudges.length,
						descriptors: descriptors.length,
						judgeModelKeys: panelJudges.map((judge) => judge.judgeModelKey),
						nEyes: isTruthyEnv(process.env.NKLEIN_N_EYES_REVIEW),
					},
				});
			} catch {
				// Telemetry must never break a review round.
			}
		} else {
			input.warn?.(`Review panel assembly for ${input.taskId}: skipped (no descriptor fetch available).`);
		}
	}

	// §5.AW (adversarial finding 2026-07-02): a review round that concludes WITHOUT delivering the speculative
	// candidate must destroy its ::spec branch — otherwise the next round's getSpeculativeDiff re-arms the A/B
	// seed with a candidate that predates this round's feedback (deliverable stale work), and the ref leaks in
	// the user's repo forever. Deliver-path cleanup (loser pruning) happens at the merge seam in runtime-server.
	/**
	 * F4.8b: record WHICH review path actually produced the verdict.
	 *
	 * The n-eyes panel silently falls through to the plain panel when no eye returns a verdict, and the plain
	 * panel silently falls through to a single reviewer. **Two levels of degradation, each invisible** — so a run
	 * with `NKLEIN_N_EYES_REVIEW` on that quietly decided by one reviewer looked exactly like a run with the flag
	 * off, and "did n-eyes ever actually decide anything?" — the whole payoff question — had no answer.
	 *
	 * One category rather than one per flag, because the interesting fact is which path WON, and that is a single
	 * mutually-exclusive outcome. Recording it per-flag would need a join to answer the same question.
	 */
	const recordReviewPath = (path: "n_eyes" | "panel" | "single_reviewer", detail: Record<string, unknown>): void => {
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Review verdict for ${input.taskId} was produced by the ${path} path.`,
				taskId: input.taskId,
				workspacePath: input.workspacePath,
				metadata: {
					category: "review_path",
					path,
					nEyesEnabled: isTruthyEnv(process.env.NKLEIN_N_EYES_REVIEW),
					...detail,
				},
			});
		} catch {
			// Telemetry must never break a review round.
		}
	};

	const discardSpeculativeCandidate = async (): Promise<void> => {
		await deleteTaskResultBranch({ repoPath: input.workspacePath, taskId: `${input.taskId}::spec` }).catch(
			() => false,
		);
	};

	const persistReview = async (review: RuntimeCardReview, targetColumnId?: string): Promise<void> => {
		await retryWorkspaceStateLock(() =>
			mutate(input.workspacePath, (current) => ({
				board: applyCardReviewToBoard(current.board, input.taskId, review, targetColumnId, now),
				value: null,
			})),
		);
	};

	// §5.AW: the primary handed off — a speculative mirror still running has LOST the race. Cancel it now so
	// (a) its endpoint frees up and (b) a partial spec never captures after this point; a spec that already
	// captured its ::spec branch before this line is the arbitration candidate below.
	await input.service.cancelSpeculativeMirror?.(input.taskId).catch(() => undefined);

	// W1.5 (audit 2026-07-02): run the ACCEPTANCE check BEFORE the review, deterministically, and hand the reviewer
	// its result — previously acceptanceSummary was never populated, so the reviewer judged the diff with zero
	// knowledge of whether acceptance passed/failed/exists (an opinion, not an evidence-backed gate). Best-effort:
	// an unavailable check (no sandbox / method absent on a fake) yields null and the reviewer is told so.
	// Phase stamps (2026-07-10 review-hang autopsy): a silently-wedged review pinpoints its last-reached phase.
	// Fire only via the injected `warn`, so they're diagnostic noise-free unless a caller wants them.
	// N18: every review phase gets a TIMESTAMPED record, not only a log line.
	//
	// `stampPhase` is the single chokepoint every review-phase message already funnels through — verdicts, bounces,
	// judge fan-out, corrector rounds — so emitting here covers all of them at once and cannot be forgotten by a
	// new call site the way a per-site emission would be.
	//
	// **Why this matters beyond tidiness:** these messages previously existed ONLY in the runtime log, which
	// carries no reliable timestamps, so review events could be ordered against each other but not against
	// telemetry. The s03 investigation needed the bounce COUNT and the interleaving of a bounce with a capture
	// failure, and both had to be reconstructed by counting log lines by hand. With a real `createdAt` they merge
	// into the card timeline in true order.
	const stampPhase = (phase: string): void => {
		input.warn?.(`[review-phase] ${input.taskId}: ${phase}`);
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `[review-phase] ${input.taskId}: ${phase}`,
				taskId: input.taskId,
				metadata: { category: REVIEW_PHASE_CATEGORY, phase },
			});
		} catch {
			// Telemetry must never break a review round.
		}
	};
	stampPhase("acceptance-verify start");
	// Same diff basis the review core fingerprints (getTaskDiff below) — a cheap git call vs a sandbox run.
	const evidenceFingerprint = config.secondOpinionReviewEnabled
		? await getDiff({
				repoPath: input.workspacePath,
				taskId: input.taskId,
				baseRef: card.baseRef,
				...(input.primaryResultCommit ? { resultCommit: input.primaryResultCommit } : {}),
			})
				.then((diff) => fingerprintReviewArtifact(diff || "(no file changes)"))
				.catch(() => null)
		: null;
	// Live-found (rig 2026-07-18): verdict-less review retries re-ran the full sandbox acceptance on
	// byte-identical work — reuse the prior run's evidence until the work fingerprint changes.
	const reusedAcceptance = evidenceFingerprint
		? getReusableAcceptanceEvidence(input.taskId, evidenceFingerprint)
		: null;
	const acceptance = reusedAcceptance
		? reusedAcceptance
		: config.secondOpinionReviewEnabled
			? await (async () => {
					try {
						return (
							(await input.service.verifyTaskAcceptanceInSandbox?.({
								taskId: input.taskId,
								projectRepoPath: input.workspacePath,
								baseRef: card.baseRef,
								taskPrompt: card.prompt,
							})) ?? null
						);
					} catch {
						return null;
					}
				})()
			: null;
	if (reusedAcceptance) {
		input.warn?.(
			`Acceptance evidence reused for ${input.taskId}: work fingerprint unchanged since the last run — skipping the sandbox re-run.`,
		);
	} else if (evidenceFingerprint && acceptance) {
		storeAcceptanceEvidence(input.taskId, evidenceFingerprint, acceptance);
	}
	stampPhase(reusedAcceptance ? "acceptance-verify reused (work unchanged)" : "acceptance-verify done");
	// F12.29: a FRESH acceptance verdict is execution-level skill evidence — record validated/refuted for every
	// procedure surfaced into this task's session (fire-and-forget; the recorder is best-effort by contract).
	if (!reusedAcceptance && acceptance && typeof acceptance.passed === "boolean") {
		void recordExecutionOutcomeForTaskSkills({
			taskId: input.taskId,
			workspacePath: input.workspacePath,
			passed: acceptance.passed,
		});
		void recordCommunitySkillEffectivenessForTask({
			taskId: input.taskId,
			workspacePath: input.workspacePath,
			passed: acceptance.passed,
		});
	}

	// W4.2 layer 3: probe once per review run for a lineage-diverse escalation worker (null ⇒ park as before).
	const escalationCandidate = config.secondOpinionReviewEnabled
		? await input.service.pickDiverseEscalationModel?.(input.taskId).catch(() => null)
		: null;

	// §5.AW review-panel lenses (OPT-IN via the persisted `reviewLensesEnabled` setting OR the NKLEIN_REVIEW_LENSES env
	// override — either enables, §5.BB; default OFF = undefined ⇒ the seed prompt is byte-identical). complexity is
	// derived from the card prompt; reviewerTier is a FIXED conservative "mid" because the reviewer object here carries
	// only {providerId, modelId} with no tier (a tier-resolution subsystem is out of scope). An empty panel (e.g. no
	// eligible lenses) still resolves to undefined so nothing is threaded.
	const reviewLenses =
		config.secondOpinionReviewEnabled && (config.reviewLensesEnabled || isTruthyEnv(process.env.NKLEIN_REVIEW_LENSES))
			? (() => {
					const plan = planReviewPanel({
						complexity: classifyTaskComplexity({ taskText: card.prompt }),
						reviewerTier: "mid",
					});
					// F12.5: append the DYNAMIC rubric lens — an explicit per-item met/not-met/cannot-tell checklist
					// derived from the card's own spec; omitted when the prompt yields nothing checklist-shaped.
					const rubricStance = renderRubricLensStance(buildVerificationRubric(card.prompt));
					const lenses = [
						...plan.lenses,
						...(rubricStance
							? [{ id: "rubric" as const, stance: rubricStance, minReviewerTier: "weak" as const }]
							: []),
					];
					return lenses.length > 0 ? lenses : undefined;
				})()
			: undefined;

	// F4.8b: which lenses actually reached the seed prompt was unrecorded. The comment above notes that an EMPTY
	// panel "still resolves to undefined so nothing is threaded" — so the feature can be enabled, plan a panel,
	// find no eligible lens, and produce a byte-identical prompt. That outcome is indistinguishable from the flag
	// being off, and it is the one that says the lens plan is not doing its job.
	if (
		config.secondOpinionReviewEnabled &&
		(config.reviewLensesEnabled || isTruthyEnv(process.env.NKLEIN_REVIEW_LENSES))
	) {
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Review lenses for ${input.taskId}: ${reviewLenses?.length ?? 0} lens(es) threaded.`,
				taskId: input.taskId,
				workspacePath: input.workspacePath,
				metadata: {
					category: "review_lenses",
					lenses: reviewLenses?.map((lens) => lens.id) ?? [],
					count: reviewLenses?.length ?? 0,
				},
			});
		} catch {
			// Telemetry must never break a review round.
		}
	}

	// §5.V test-driven gate, slice 1 (OPT-IN via NKLEIN_TEST_DRIVEN_MODE; default OFF = byte-identical): a change
	// that touched NO test file gets a deterministic pre-review `request_changes` riding the STANDARD transition
	// machinery — the normal onBounce re-drives the worker with the "add a test" reason, and a card that keeps
	// coming back testless trips the identical-feedback PARK guard instead of bouncing forever. The changed-file
	// list is parsed from the same result-branch diff the reviewer sees (`+++ b/<path>` headers).
	let preReviewVerdict: ReviewSubmissionInput | null = null;
	// F12.87b: current-build visual verification is an opt-in deterministic delivery gate. Candidate code, its dev
	// server, and Chromium all execute in one network-none task sandbox; the host receives only screenshot evidence.
	// Run only for an actual UI diff. A non-frontend repository is explicitly not-applicable; missing evidence or a
	// broken harness fails closed because silently reviewing the wrong/stale build would invalidate the gate.
	if (isTruthyEnv(process.env.NKLEIN_VISUAL_GATE) && preReviewVerdict === null) {
		const visualDiff = await getDiff({
			repoPath: input.workspacePath,
			taskId: input.taskId,
			baseRef: card.baseRef,
			...(input.primaryResultCommit ? { resultCommit: input.primaryResultCommit } : {}),
		}).catch(() => null);
		const visualChangedPaths = [...(visualDiff ?? "").matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1] ?? "");
		const uiTouched = visualChangedPaths.some((path) => /\.(?:css|html|jsx|scss|svelte|tsx|vue)$/i.test(path));
		if (uiTouched) {
			const visual = input.service.verifyTaskVisualInSandbox
				? await input.service
						.verifyTaskVisualInSandbox({
							taskId: input.taskId,
							projectRepoPath: input.workspacePath,
							baseRef: card.baseRef,
							resultCommit: input.primaryResultCommit,
							route: deriveFrontendRouteFromChangedPaths(visualChangedPaths),
						})
						.catch(() => null)
				: null;
			if (!visual) {
				preReviewVerdict = {
					verdict: "request_changes",
					summary: "Visual verification unavailable",
					feedback:
						"The enabled current-build visual gate could not produce sandbox evidence. Restore the sandbox verifier and retry; absence of evidence is not a pass.",
					insight: null,
				};
			} else if (visual.decision?.verdict === "fail") {
				preReviewVerdict = {
					verdict: "request_changes",
					summary: "Deterministic visual verification failed",
					feedback: visual.decision.reason,
					insight: null,
				};
			}
			try {
				recordSelfObservation({
					signal: visual?.decision?.verdict === "fail" ? "verification_failed" : "custom",
					severity: visual?.decision?.verdict === "fail" ? "warning" : "info",
					message: `Visual delivery gate for ${input.taskId}: ${visual?.decision?.verdict ?? visual?.applicability ?? "unavailable"}.`,
					taskId: input.taskId,
					workspacePath: input.workspacePath,
					metadata: {
						category: "visual_delivery_gate",
						verdict: visual?.decision?.verdict ?? null,
						applicability: visual?.applicability ?? "unavailable",
						route: visual?.route ?? null,
						framework: visual?.framework ?? null,
					},
				});
			} catch {
				// Telemetry cannot break review.
			}
		}
	}
	// Slice 2: the persisted config field ORs with the env flag (either enables; default OFF until live-validated).
	if (isTruthyEnv(process.env.NKLEIN_TEST_DRIVEN_MODE) || config.effectiveTestDrivenMode) {
		const gateDiff = await getDiff({
			repoPath: input.workspacePath,
			taskId: input.taskId,
			baseRef: card.baseRef,
			...(input.primaryResultCommit ? { resultCommit: input.primaryResultCommit } : {}),
		}).catch(() => null);
		const changedFilePaths = [...(gateDiff ?? "").matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1] ?? "");
		const gate = decideTestDrivenDelivery({ enabled: true, changedFilePaths });
		if (!gate.allowReview && changedFilePaths.length > 0) {
			preReviewVerdict = {
				verdict: "request_changes",
				summary: "Test-driven delivery gate",
				feedback: gate.reason,
				insight: null,
			};
			input.warn?.(`Test-driven gate: bouncing ${input.taskId} — ${gate.reason}`);
		}
		// F4.8b: record the DECISION, not only the bounce. Emitting on bounce alone makes the gate visible only
		// when it acts, so "how often would this fire if I turned it on?" — the question you ask BEFORE enabling
		// it — has no answer. F12.35 immediately below already works this way on purpose; this is the same rule.
		try {
			recordSelfObservation({
				signal: "custom",
				severity: gate.allowReview ? "info" : "warning",
				message: `Test-driven gate for ${input.taskId}: ${gate.allowReview ? "allowed" : "BOUNCED"} — ${gate.reason}`,
				taskId: input.taskId,
				workspacePath: input.workspacePath,
				metadata: {
					category: "test_driven_gate",
					allowReview: gate.allowReview,
					changedFiles: changedFilePaths.length,
					reason: gate.reason,
				},
			});
		} catch {
			// Telemetry must never break the gate.
		}
	}
	// F12.36 verification-FIRST gate (OPT-IN via NKLEIN_VERIFICATION_FIRST; default OFF = byte-identical): a RED
	// fresh acceptance run short-circuits the LLM review into a deterministic request_changes carrying the machine's
	// own failure summary — zero reviewer tokens on work a machine already rejected. Rides the same preReviewVerdict
	// seam as the test-driven gate (which wins when both fire — its bounce is more specific).
	if (
		preReviewVerdict === null &&
		isTruthyEnv(process.env.NKLEIN_VERIFICATION_FIRST) &&
		acceptance?.present === true
	) {
		const verificationFirst = decideVerificationFirst([
			{
				name: acceptance.command ?? "acceptance",
				passed: acceptance.passed,
				detail: acceptance.failureHint ?? acceptance.failureCategory ?? null,
			},
		]);
		if (verificationFirst.action === "deterministic_bounce") {
			preReviewVerdict = verificationFirst.submission;
			input.warn?.(`Verification-first gate: bouncing ${input.taskId} — ${verificationFirst.submission.summary}`);
		}
		// F4.8b: same reason as the test-driven gate above. This one saves reviewer TOKENS by short-circuiting a
		// review the machine already rejected, so how often it fires is the entire argument for enabling it — and
		// that number is unobtainable if only the bounces are recorded.
		try {
			recordSelfObservation({
				signal: "custom",
				severity: verificationFirst.action === "deterministic_bounce" ? "warning" : "info",
				message: `Verification-first gate for ${input.taskId}: ${verificationFirst.action}.`,
				taskId: input.taskId,
				workspacePath: input.workspacePath,
				metadata: {
					category: "verification_first_gate",
					action: verificationFirst.action,
					acceptancePassed: acceptance.passed ?? null,
				},
			});
		} catch {
			// Telemetry must never break the gate.
		}
	}
	// F12.35 (RECORD-ONLY, deliberately): compare the effort this card WARRANTS against the depth it is about to
	// get. This feature can only ever REDUCE scrutiny, so it observes before it decides — the observation stream
	// shows how often the cheap path would have fired and on what evidence, which is what a flip must be argued
	// from. Difficulty comes from the card's latest ledger attempt; with no difficulty recorded there is nothing
	// to ground a recommendation on, so nothing is recorded.
	void (async () => {
		try {
			const ledgerEvents = await readAgentLedger({
				workspacePathHash: hashWorkspacePathForLedger(input.workspacePath),
			});
			const taskAttempts = ledgerEvents.filter((event) => event.kind === "attempt" && event.taskId === input.taskId);
			const latestAttempt = taskAttempts.at(-1);
			const difficultyTier =
				latestAttempt && "difficulty" in latestAttempt ? (latestAttempt.difficulty ?? null) : null;
			if (difficultyTier === null) {
				// F12.35b: this early return is why `review_effort_scaling` recorded ZERO across 44,421 observations —
				// and it was SILENT, so the zero looked like "the feature is off" rather than "the ledger read came
				// back empty". Record the SKIP with its reason so every review confirms or refutes the fragmentation
				// hypothesis on its own, without the "one instrumented run" the item said it needed. The two reasons
				// are distinct: NO attempt records for this task in the read (the wrong-hash/fragmentation cause) vs an
				// attempt present but carrying no difficulty tier.
				try {
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `Review-effort scaling SKIPPED for ${input.taskId}: ${taskAttempts.length === 0 ? "no attempt records found in the ledger read (F12.35b: reader hash may not match the writer's)" : "latest attempt has no difficulty tier"}.`,
						taskId: input.taskId,
						workspacePath: input.workspacePath,
						metadata: {
							category: "review_effort_scaling_skipped",
							reason: taskAttempts.length === 0 ? "no_ledger_records" : "no_difficulty_tier",
							ledgerEventsRead: ledgerEvents.length,
							taskAttemptsFound: taskAttempts.length,
						},
					});
				} catch {
					// Observation only — a failed record must never disturb the review.
				}
				return;
			}
			const difficulty =
				difficultyTier === "easy" || difficultyTier === "trivial"
					? 0.25
					: difficultyTier === "hard" || difficultyTier === "very-hard"
						? 0.85
						: 0.55;
			const plan = planReviewEffort({
				difficulty,
				deterministicGreen: acceptance?.passed ?? null,
			});
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Review-effort recommendation for ${input.taskId}: ${plan.depth} (${plan.reason})`,
				taskId: input.taskId,
				workspacePath: input.workspacePath,
				metadata: {
					category: "review_effort_scaling",
					depth: plan.depth,
					reviewPasses: plan.reviewPasses,
					debateRounds: plan.debateRounds,
					difficultyTier,
				},
			});
		} catch {
			// Observation only — a failed consult must never disturb the review.
		}
	})();
	stampPhase("review-resolution start");
	const reviewResult = await runNKleinSecondOpinionReview({
		taskId: input.taskId,
		columnId,
		stampPhase,
		enabled: config.secondOpinionReviewEnabled,
		...(preReviewVerdict ? { preReviewVerdict } : {}),
		maxRounds: config.reviewMaxRounds,
		isReviewerCard: input.taskId.includes(REVIEW_SESSION_TASK_SUFFIX),
		acceptanceSummary: formatAcceptanceSummaryForReview(acceptance, getBaselineProbe(input.taskId)),
		...(reviewLenses ? { reviewLenses } : {}),
		escalationAvailable: Boolean(escalationCandidate),
		// In-memory set ∪ the persisted flag — the one-escalation guard survives a runtime restart (#W4.2).
		alreadyEscalated: escalatedWorkerTaskIds.has(input.taskId) || card.review?.escalated === true,
		now,
		deps: {
			getCard: async () => ({
				id: card.id,
				title: card.title ?? card.id,
				prompt: card.prompt,
				review: card.review,
				focusChain: card.focusChain ?? null,
			}),
			getTaskDiff: async () =>
				getDiff({
					repoPath: input.workspacePath,
					taskId: input.taskId,
					baseRef: card.baseRef,
					...(input.primaryResultCommit ? { resultCommit: input.primaryResultCommit } : {}),
				}),
			// §5.AW: the speculative candidate's diff (its ::spec result branch), arming the A/B seed when present.
			getSpeculativeDiff: async () =>
				getDiff({
					repoPath: input.workspacePath,
					taskId: `${input.taskId}::spec`,
					baseRef: card.baseRef,
					...(input.speculativeResultCommit ? { resultCommit: input.speculativeResultCommit } : {}),
				}).catch(() => null),
			// F12.4: execution-based A/B arbitration — the core calls this only when the A/B seed actually arms.
			// Re-run the SAME acceptance check against the speculative ::spec candidate (the verifier accepts the
			// result-branch override) and fold both runs into the prompt-ready note. No acceptance command for the
			// card ⇒ null (nothing to execute on either candidate).
			getExecutionArbitrationNote: async () => {
				if (acceptance?.present !== true) {
					return null;
				}
				stampPhase("spec-acceptance-verify start");
				const specAcceptance = await (async () => {
					try {
						return (
							(await input.service.verifyTaskAcceptanceInSandbox?.({
								taskId: input.taskId,
								projectRepoPath: input.workspacePath,
								baseRef: card.baseRef,
								taskPrompt: card.prompt,
								resultBranchTaskId: `${input.taskId}::spec`,
								...(input.speculativeResultCommit ? { resultCommit: input.speculativeResultCommit } : {}),
							})) ?? null
						);
					} catch {
						return null;
					}
				})();
				stampPhase("spec-acceptance-verify done");
				const asRun = (result: RuntimeTaskAcceptanceResult | null): CandidateExecutionRun => ({
					passed: result?.present === true ? result.passed : null,
					failureCount: null,
				});
				return arbitrateByExecution(asRun(acceptance), asRun(specAcceptance)).note;
			},
			getReviewContext: async () => ({
				workerReasoning: input.service.getSummary(input.taskId)?.latestHookActivity?.finalMessage?.trim() || null,
				boardContext: buildReviewBoardContext(state.board, card),
			}),
			// F12.91 history-blind CORRECTOR (OPT-IN via NKLEIN_HISTORY_BLIND_CORRECTOR; default OFF ⇒ this wrapper
			// returns the primary submission untouched and the path is byte-identical).
			//
			// The corrector runs ONE bounded extra session whose seed prompt REPLACES the reviewer's seed rather
			// than appending to it — this is the whole point and the one thing that must not be "simplified" into
			// the N-eyes pattern above, which concatenates `${seedPrompt}${suffix}` and therefore carries the
			// conversation context an eye is supposed to share. The corrector must see ONLY objective + diff.
			//
			// THE FOLD IS ONE-DIRECTIONAL, and the asymmetry is the design: history-isolation makes this pass a
			// GOOD detector of over-approval (the contextual reviewer was talked into a patch by the worker's
			// narrative) and a BAD detector of over-rejection (it lacks the context that legitimately justified a
			// change). So it may tighten approve → request_changes, and may NEVER loosen a request_changes into an
			// approve. A corrector that could approve would let an uninformed pass overrule an informed one.
			runReviewSession: async (sessionArgs) => {
				const runPrimaryReviewSession = async ({ seedPrompt }: { seedPrompt: string }) => {
					// §5.AB panel: ≥2 diverse judges ⇒ run each over the SAME seed and combine (majority + veto) into one
					// submission; a null panel result (no judge produced a verdict) falls through to the single reviewer.
					if (panelJudges.length > 1) {
						// F1.37b N-eyes (OPT-IN via NKLEIN_N_EYES_REVIEW inside the panel path; default OFF ⇒ the plain
						// panel below, byte-identical): every eye is a DISTINCT (judge, lens) pair riding the SAME
						// sequential review-session machinery; blind findings → marginal-value stop → confer round
						// (dispute out-votes drop, veto-class findings never silently drop). Falls through to the plain
						// panel when no eye produced a verdict.
						if (isTruthyEnv(process.env.NKLEIN_N_EYES_REVIEW)) {
							const maxEyes = Math.min(
								6,
								Math.max(2, Number.parseInt(process.env.NKLEIN_N_EYES_MAX ?? "4", 10) || 4),
							);
							const nEyesResult = await runNEyesReviewPanel({
								judges: panelJudges,
								reviewerTier: "mid",
								maxEyes,
								runEyeSession: (eye, judge, promptSuffix) =>
									input.service.runSecondOpinionReviewSession({
										taskId: input.taskId,
										projectRepoPath: input.workspacePath,
										baseRef: card.baseRef,
										seedPrompt: `${seedPrompt}${promptSuffix}`,
										reviewer: judge.reviewer,
										stampPhase: (phase) => stampPhase(`${eye.eyeId}/${judge.judgeModelKey}: ${phase}`),
									}),
								// The confer round rides the same session machinery; the judge's raw feedback carries the
								// CONFER: lines (a verdict-shaped reply is fine — only the text is parsed).
								runConferSession: async (_eye, judge, conferPrompt) => {
									const conferSubmission = await input.service.runSecondOpinionReviewSession({
										taskId: input.taskId,
										projectRepoPath: input.workspacePath,
										baseRef: card.baseRef,
										seedPrompt: `${seedPrompt}${conferPrompt}`,
										reviewer: judge.reviewer,
									});
									return conferSubmission?.feedback ?? conferSubmission?.summary ?? null;
								},
								warn: input.warn,
							});
							if (nEyesResult) {
								input.warn?.(
									`N-eyes panel for ${input.taskId}: ${nEyesResult.decision.reason} — ${nEyesResult.eyesRun.length} eye(s), ${nEyesResult.conferred.filter((finding) => finding.status !== "dropped").length} finding(s) survived confer.`,
								);
								recordReviewPath("n_eyes", { eyes: nEyesResult.eyesRun.length });
								return nEyesResult.submission;
							}
						}
						const panelResult = await runReviewPanel({
							judges: panelJudges,
							runJudgeSession: (judge) =>
								input.service.runSecondOpinionReviewSession({
									taskId: input.taskId,
									projectRepoPath: input.workspacePath,
									baseRef: card.baseRef,
									seedPrompt,
									reviewer: judge.reviewer,
									stampPhase: (phase) => stampPhase(`judge/${judge.judgeModelKey}: ${phase}`),
								}),
						});
						if (panelResult) {
							input.warn?.(`Review panel for ${input.taskId}: ${panelResult.decision.reason}`);
							recordReviewPath("panel", { judges: panelJudges.length });
							return panelResult.submission;
						}
					}
					recordReviewPath("single_reviewer", { judges: panelJudges.length });
					return input.service.runSecondOpinionReviewSession({
						taskId: input.taskId,
						projectRepoPath: input.workspacePath,
						baseRef: card.baseRef,
						seedPrompt,
						reviewer,
						stampPhase,
					});
				};
				const primary = await runPrimaryReviewSession(sessionArgs);
				if (isCrashRecoveryMatrixPhaseEnabled("review")) {
					await reachCrashRecoveryMatrixBarrier("review", {
						taskId: input.taskId,
						verdict: primary?.verdict ?? null,
					});
				}
				if (primary?.verdict !== "approve") {
					// Nothing to tighten: a non-approval already carries the stricter verdict, and running the
					// corrector could only produce a looser opinion we would discard anyway.
					return primary;
				}
				if (!isTruthyEnv(process.env.NKLEIN_HISTORY_BLIND_CORRECTOR)) {
					return primary;
				}
				try {
					const correctorDiff = await getDiff({
						repoPath: input.workspacePath,
						taskId: input.taskId,
						baseRef: card.baseRef,
						...(input.primaryResultCommit ? { resultCommit: input.primaryResultCommit } : {}),
					}).catch(() => null);
					if (!correctorDiff || correctorDiff.trim().length === 0) {
						// No patch to judge in isolation — the corrector has nothing to say and must not guess.
						return primary;
					}
					const correctorSubmission = await input.service.runSecondOpinionReviewSession({
						taskId: input.taskId,
						projectRepoPath: input.workspacePath,
						baseRef: card.baseRef,
						seedPrompt: buildHistoryBlindCorrectorPrompt({
							taskObjective: card.prompt,
							diff: correctorDiff,
							acceptanceSummary: formatAcceptanceSummaryForReview(acceptance, getBaselineProbe(input.taskId)),
						}),
						reviewer,
						stampPhase: (phase) => stampPhase(`corrector: ${phase}`),
					});
					if (correctorSubmission?.verdict === "request_changes") {
						input.warn?.(
							`History-blind corrector OVERRODE an approve for ${input.taskId}: ${correctorSubmission.summary}`,
						);
						recordSelfObservation({
							signal: "custom",
							severity: "warning",
							message: `History-blind corrector overrode an approve for ${input.taskId}: ${correctorSubmission.summary}`,
							taskId: input.taskId,
							metadata: { category: "history_blind_corrector_override" },
						});
						return correctorSubmission;
					}
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `History-blind corrector agreed with the approve for ${input.taskId}.`,
						taskId: input.taskId,
						metadata: { category: "history_blind_corrector_agreed" },
					});
				} catch (error) {
					// Best-effort by contract: a corrector failure must never block a card that the primary
					// reviewer already approved.
					input.warn?.(`History-blind corrector failed for ${input.taskId}: ${String(error)}`);
				}
				return primary;
			},
			onDeliver: async ({ review }) => {
				await persistReview(review);
			},
			onBounce: async ({ review, workerPrompt }) => {
				// N7d: declare the owed capture at the ACTUAL bounce boundary, before the board mutation can expose
				// `in_progress` to terminal/session cleanup. The old runtime-server call marked this only AFTER this
				// callback returned — after persistReview and after the attempted send — so a late stop could interrupt
				// the session in between and make sendTaskSessionInput silently decline the re-drive. Every bounce owns
				// exactly one marker; the sandbox finalizer consumes it when that next capture begins.
				input.service.markSandboxRecaptureExpected?.(
					input.taskId,
					"review bounced (request_changes) — a further worker round will capture again",
				);
				// Live F3.24b proof (2026-07-22): qwen3.5-9b handed off three empty patches. The first reviewed
				// no-op was correctly rejected, but the ordinary bounce sent it straight back to the SAME model;
				// after another no-op the card stranded in In Progress and froze the fan-in. An admitted empty patch
				// is already model-capability evidence, not an ordinary code-review correction. Consume the existing
				// diverse-worker escalation rung immediately when one is available, persist that the rung was spent,
				// and carry the review feedback to a fresh model. Do not infer this from an empty/null diff: only the
				// trusted capture gate's explicit `empty_patch` status is authoritative.
				const emptyPatchEscalation =
					input.primaryArtifactStatus === "empty_patch" ? (escalationCandidate ?? null) : null;
				await persistReview(emptyPatchEscalation ? { ...review, escalated: true } : review, "in_progress");
				await discardSpeculativeCandidate();
				if (emptyPatchEscalation) {
					input.service.noteNextAttemptStrategy?.(input.taskId, "cross_model_empty_patch");
					await input.service.sendTaskSessionInput(
						input.taskId,
						`You are taking over after another model returned NO file changes for a task that still requires implementation. Read the preserved objective and reviewer feedback, make the required edits, and run the acceptance check.\n\n${workerPrompt}${fileScopeNote}`,
						"act",
						undefined,
						emptyPatchEscalation,
					);
					input.warn?.(
						`Empty-patch review bounce for ${input.taskId}: rerouted from the no-op worker to ${emptyPatchEscalation.modelId}.`,
					);
					try {
						recordSelfObservation({
							signal: "custom",
							severity: "warning",
							message: `Empty-patch review bounce for ${input.taskId}: rerouted to ${emptyPatchEscalation.modelId}.`,
							taskId: input.taskId,
							workspacePath: input.workspacePath,
							metadata: {
								category: "empty_patch_model_failover",
								nextModelId: emptyPatchEscalation.modelId,
							},
						});
					} catch {
						// Recovery telemetry must never break the re-drive.
					}
					return;
				}
				await input.service.sendTaskSessionInput(input.taskId, `${workerPrompt}${fileScopeNote}`, "act");
			},
			onEscalate: async ({ review, workerPrompt }) => {
				// W4.2: the stuck card retries ONCE on the diverse/stronger worker (the W1.1b override machinery).
				escalatedWorkerTaskIds.add(input.taskId);
				// Persist the escalation as SERVER-SIDE TRUTH (the in-memory set dies with the process; the card
				// chrome and future arbitration read this flag instead of re-deriving stuck signatures client-side).
				await persistReview({ ...review, escalated: true }, "in_progress");
				await discardSpeculativeCandidate();
				const escalationPreamble = escalationCandidate
					? `You are taking over this task from another model that got stuck in review. Read the feedback below carefully and address it directly.\n\n`
					: "";
				await input.service.sendTaskSessionInput(
					input.taskId,
					`${escalationPreamble}${workerPrompt}${fileScopeNote}`,
					"act",
					undefined,
					escalationCandidate ?? undefined,
				);
				input.warn?.(
					`Escalated ${input.taskId} to ${escalationCandidate?.modelId ?? "?"} after a stuck review loop (one escalation per card).`,
				);
			},
			onPark: async ({ review }) => {
				await persistReview(review);
				await discardSpeculativeCandidate();
				// Run20 live finding: a parked card's worker session kept CHURNING turns — burning tokens on a card
				// waiting for a human AND holding its endpoint slot (the scheduler counts `running` sessions), which
				// starved every queued card routed to the same model for the rest of the run. Parking now QUIESCES
				// the session: the turn is aborted and the state goes idle (slot freed), while the session stays
				// resumable — sendTaskSessionInput accepts an idle session, so the human's follow-up just works.
				await input.service.cancelTaskTurn?.(input.taskId).catch(() => null);
				// §5.AB RE-DECOMPOSE RUNG: a card parked after its ESCALATION also failed has exhausted the whole
				// ladder (bounce → diverse takeover → park) — the proven can't-handle-as-one-unit signal
				// (decideCardDecomposition Rule 1). Spawn ONE follow-up decompose card so the architect splits the
				// objective into smaller cards; the caller schedules it immediately (backlog + no deps). Runs 21-25:
				// this is the productive escape for the score-clamp-class cards that defeated all three model tiers.
				// The persisted flag is authoritative across runtime restarts; the in-memory set only closes the
				// same-process race before a refreshed card snapshot is available.
				if (
					escalatedWorkerTaskIds.has(input.taskId) ||
					card.review?.escalated === true ||
					review.escalated === true
				) {
					const redecomposeTaskId = `redecompose-${input.taskId}`;
					const spawned = await retryWorkspaceStateLock(() =>
						mutate(input.workspacePath, (current) => {
							const exists = current.board.columns.some((column) =>
								column.cards.some((boardCard) => boardCard.id === redecomposeTaskId),
							);
							if (exists) {
								return { board: current.board, save: false, value: null };
							}
							const created = addTaskToColumn(
								current.board,
								"backlog",
								{
									taskId: redecomposeTaskId,
									title: `Decompose: ${card.title ?? card.id}`,
									prompt: [
										`The card "${card.title ?? card.id}" proved too hard as ONE unit — a bounced worker, a diverse escalation, and the review ladder all failed to complete it. Split its objective into SMALLER, independently-verifiable cards using the decompose_project tool (do NOT implement it directly).`,
										`Original objective:
${card.prompt}`,
										review.lastFeedback
											? `Reviewer feedback the workers could not address:
${review.lastFeedback}`
											: "",
										`Keep each new card small enough for a single focused session, declare tight file scopes, and give every card an objective acceptance check.`,
									]
										.filter(Boolean)
										.join("\n\n"),
									baseRef: card.baseRef,
									startInPlanMode: true,
									autoReviewEnabled: card.autoReviewEnabled ?? true,
								},
								() => globalThis.crypto.randomUUID(),
							);
							return { board: created.board, value: redecomposeTaskId };
						}),
					);
					if (spawned.value) {
						input.warn?.(
							`Parked card ${input.taskId} exhausted the escalation ladder — spawned re-decompose card ${redecomposeTaskId} (the architect will split the objective).`,
						);
						await input.onRedecomposeCardSpawned?.(redecomposeTaskId);
					}
				}
			},
		},
	});
	stampPhase(
		reviewResult.type === "delivered" && reviewResult.reusedApproval
			? `review-resolution done (delivered; durable approval reused, round ${reviewResult.round})`
			: `review-resolution done (${reviewResult.type})`,
	);
	return reviewResult;
}
