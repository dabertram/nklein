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
import { isTruthyEnv } from "../core/env-flag";
import { fetchLoadedModelDescriptors, type LoadedModelDescriptor } from "../core/lmstudio-loaded-model-descriptors";
import { fetchLoadedModelIdsCached } from "../core/lmstudio-loaded-models";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../core/local-model-endpoint";
import { modelsShareLineage, resolveLineage } from "../core/model-lineage";
import type { ReviewBoardContext, ReviewRelatedCard, ReviewSubmissionInput } from "../core/review-orchestration";
import { planReviewPanel } from "../core/review-panel-plan";
import { resolveSwarmRoleModel } from "../core/swarm-role-selection";
import { addTaskToColumn } from "../core/task-board-mutations";
import { classifyTaskComplexity } from "../core/task-complexity";
import type { RuntimeTaskAcceptanceResult } from "../core/task-lifecycle-api-contract";
import { decideTestDrivenDelivery } from "../core/test-driven-delivery";
import { type PanelJudge, runReviewPanel } from "../nklein-agent/nklein-review-panel-runner";
import { buildReviewerCandidates, resolveWorkerRealId } from "../nklein-agent/nklein-reviewer-candidate-selection";
import { selectReviewerPanel } from "../nklein-agent/nklein-reviewer-panel-selection";
import {
	type NKleinSecondOpinionReviewOutcome,
	runNKleinSecondOpinionReview,
} from "../nklein-agent/nklein-second-opinion-review";
import type { NKleinTaskSessionService } from "../nklein-agent/nklein-task-session-service";
import { loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import { deleteTaskResultBranch, getTaskResultBranchDiff } from "../workspace/task-result-branches";

/** Suffix the service uses for the isolated reviewer session id; guards against reviewing a review. */
const REVIEW_SESSION_TASK_SUFFIX = "::review";

/** W4.2 layer 3: one worker-escalation per card per server run (resets on restart — v1 semantics). */
const escalatedWorkerTaskIds = new Set<string>();

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
	service: Pick<NKleinTaskSessionService, "runSecondOpinionReviewSession" | "sendTaskSessionInput" | "getSummary"> &
		Partial<
			Pick<
				NKleinTaskSessionService,
				| "verifyTaskAcceptanceInSandbox"
				| "pickDiverseEscalationModel"
				| "cancelTaskTurn"
				| "cancelSpeculativeMirror"
			>
		>;
	loadWorkspaceState?: typeof loadWorkspaceState;
	mutateWorkspaceState?: typeof mutateWorkspaceState;
	loadRuntimeConfig?: typeof loadRuntimeConfig;
	getTaskResultBranchDiff?: typeof getTaskResultBranchDiff;
	now?: () => number;
	/** Sink for surfaced-but-non-blocking signals (e.g. the reviewer-monoculture waiver, §5.AB W0.4). */
	warn?: (message: string) => void;
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
	acceptance: Pick<RuntimeTaskAcceptanceResult, "present" | "command" | "passed" | "exitCode" | "output"> | null,
): string | null {
	if (acceptance === null) {
		return "Acceptance evidence UNAVAILABLE (the check could not run). Treat completion claims skeptically — the delivery gate will fail closed without a passing acceptance run.";
	}
	if (acceptance.present !== true) {
		return "NO acceptance command exists on this card. Treat this as strong grounds to request changes (every card should carry a machine-runnable acceptance check); auto-delivery is held without one.";
	}
	const verdict = acceptance.passed === true ? "PASSED" : `FAILED (exit ${acceptance.exitCode ?? "?"})`;
	const outputTail = acceptance.output.trim().slice(-ACCEPTANCE_OUTPUT_TAIL_BUDGET);
	return [
		`Command: \`${acceptance.command ?? "?"}\` — ${verdict}.`,
		...(acceptance.passed === true
			? []
			: [
					"A failing acceptance check is strong grounds to request changes — reconcile the worker's claims against this result.",
				]),
		...(outputTail && acceptance.passed !== true ? ["", "Output tail:", "```", outputTail, "```"] : []),
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
	const state = await loadState(input.workspacePath);
	const located = state.board.columns
		.flatMap((column) => column.cards.map((card) => ({ columnId: column.id, card })))
		.find((entry) => entry.card.id === input.taskId);
	if (!located) {
		return { type: "skipped", reason: "card_not_found" };
	}
	const { card, columnId } = located;
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
		}
	}

	// §5.AW (adversarial finding 2026-07-02): a review round that concludes WITHOUT delivering the speculative
	// candidate must destroy its ::spec branch — otherwise the next round's getSpeculativeDiff re-arms the A/B
	// seed with a candidate that predates this round's feedback (deliverable stale work), and the ref leaks in
	// the user's repo forever. Deliver-path cleanup (loser pruning) happens at the merge seam in runtime-server.
	const discardSpeculativeCandidate = async (): Promise<void> => {
		await deleteTaskResultBranch({ repoPath: input.workspacePath, taskId: `${input.taskId}::spec` }).catch(
			() => false,
		);
	};

	const persistReview = async (review: RuntimeCardReview, targetColumnId?: string): Promise<void> => {
		await mutate(input.workspacePath, (current) => ({
			board: applyCardReviewToBoard(current.board, input.taskId, review, targetColumnId, now),
			value: null,
		}));
	};

	// §5.AW: the primary handed off — a speculative mirror still running has LOST the race. Cancel it now so
	// (a) its endpoint frees up and (b) a partial spec never captures after this point; a spec that already
	// captured its ::spec branch before this line is the arbitration candidate below.
	await input.service.cancelSpeculativeMirror?.(input.taskId).catch(() => undefined);

	// W1.5 (audit 2026-07-02): run the ACCEPTANCE check BEFORE the review, deterministically, and hand the reviewer
	// its result — previously acceptanceSummary was never populated, so the reviewer judged the diff with zero
	// knowledge of whether acceptance passed/failed/exists (an opinion, not an evidence-backed gate). Best-effort:
	// an unavailable check (no sandbox / method absent on a fake) yields null and the reviewer is told so.
	const acceptance = config.secondOpinionReviewEnabled
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

	// W4.2 layer 3: probe once per review run for a lineage-diverse escalation worker (null ⇒ park as before).
	const escalationCandidate = config.secondOpinionReviewEnabled
		? await input.service.pickDiverseEscalationModel?.(input.taskId).catch(() => null)
		: null;

	// §5.AW review-panel lenses (OPT-IN behind NKLEIN_REVIEW_LENSES; default = undefined ⇒ the seed prompt is
	// byte-identical). complexity is derived from the card prompt; reviewerTier is a FIXED conservative "mid" because
	// the reviewer object here carries only {providerId, modelId} with no tier (a tier-resolution subsystem is out of
	// scope). An empty panel (e.g. no eligible lenses) still resolves to undefined so nothing is threaded.
	const reviewLenses =
		config.secondOpinionReviewEnabled && isTruthyEnv(process.env.NKLEIN_REVIEW_LENSES)
			? (() => {
					const plan = planReviewPanel({
						complexity: classifyTaskComplexity({ taskText: card.prompt }),
						reviewerTier: "mid",
					});
					return plan.lenses.length > 0 ? plan.lenses : undefined;
				})()
			: undefined;

	// §5.V test-driven gate, slice 1 (OPT-IN via NKLEIN_TEST_DRIVEN_MODE; default OFF = byte-identical): a change
	// that touched NO test file gets a deterministic pre-review `request_changes` riding the STANDARD transition
	// machinery — the normal onBounce re-drives the worker with the "add a test" reason, and a card that keeps
	// coming back testless trips the identical-feedback PARK guard instead of bouncing forever. The changed-file
	// list is parsed from the same result-branch diff the reviewer sees (`+++ b/<path>` headers).
	let preReviewVerdict: ReviewSubmissionInput | null = null;
	// Slice 2: the persisted config field ORs with the env flag (either enables; default OFF until live-validated).
	if (isTruthyEnv(process.env.NKLEIN_TEST_DRIVEN_MODE) || config.testDrivenModeEnabled) {
		const gateDiff = await getDiff({
			repoPath: input.workspacePath,
			taskId: input.taskId,
			baseRef: card.baseRef,
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
	}
	return runNKleinSecondOpinionReview({
		taskId: input.taskId,
		columnId,
		enabled: config.secondOpinionReviewEnabled,
		...(preReviewVerdict ? { preReviewVerdict } : {}),
		maxRounds: config.reviewMaxRounds,
		isReviewerCard: input.taskId.includes(REVIEW_SESSION_TASK_SUFFIX),
		acceptanceSummary: formatAcceptanceSummaryForReview(acceptance),
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
				getDiff({ repoPath: input.workspacePath, taskId: input.taskId, baseRef: card.baseRef }),
			// §5.AW: the speculative candidate's diff (its ::spec result branch), arming the A/B seed when present.
			getSpeculativeDiff: async () =>
				getDiff({ repoPath: input.workspacePath, taskId: `${input.taskId}::spec`, baseRef: card.baseRef }).catch(
					() => null,
				),
			getReviewContext: async () => ({
				workerReasoning: input.service.getSummary(input.taskId)?.latestHookActivity?.finalMessage?.trim() || null,
				boardContext: buildReviewBoardContext(state.board, card),
			}),
			runReviewSession: async ({ seedPrompt }) => {
				// §5.AB panel: ≥2 diverse judges ⇒ run each over the SAME seed and combine (majority + veto) into one
				// submission; a null panel result (no judge produced a verdict) falls through to the single reviewer.
				if (panelJudges.length > 1) {
					const panelResult = await runReviewPanel({
						judges: panelJudges,
						runJudgeSession: (judge) =>
							input.service.runSecondOpinionReviewSession({
								taskId: input.taskId,
								projectRepoPath: input.workspacePath,
								baseRef: card.baseRef,
								seedPrompt,
								reviewer: judge.reviewer,
							}),
					});
					if (panelResult) {
						input.warn?.(`Review panel for ${input.taskId}: ${panelResult.decision.reason}`);
						return panelResult.submission;
					}
				}
				return input.service.runSecondOpinionReviewSession({
					taskId: input.taskId,
					projectRepoPath: input.workspacePath,
					baseRef: card.baseRef,
					seedPrompt,
					reviewer,
				});
			},
			onDeliver: async ({ review }) => {
				await persistReview(review);
			},
			onBounce: async ({ review, workerPrompt }) => {
				await persistReview(review, "in_progress");
				await discardSpeculativeCandidate();
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
				// objective into smaller cards; the terminal sweep auto-starts it (backlog + no deps). Runs 21-25:
				// this is the productive escape for the score-clamp-class cards that defeated all three model tiers.
				if (escalatedWorkerTaskIds.has(input.taskId)) {
					const redecomposeTaskId = `redecompose-${input.taskId}`;
					await mutate(input.workspacePath, (current) => {
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
						return { board: created.board, value: null };
					});
					input.warn?.(
						`Parked card ${input.taskId} exhausted the escalation ladder — spawned re-decompose card ${redecomposeTaskId} (the architect will split the objective).`,
					);
				}
			},
		},
	});
}
