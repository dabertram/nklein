import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type {
	RuntimeTaskAutoReviewMode,
	RuntimeTaskNKleinSettings,
	RuntimeTaskTestEvidencePolicy,
} from "../core/api-contract";
import { runtimeAgentIdSchema } from "../core/api-contract";
import { buildKanbanRuntimeUrl, getRuntimeFetch } from "../core/runtime-endpoint";
import { addTaskToColumn } from "../core/task-board-mutations";
import type { RuntimeTaskSessionSummary } from "../core/task-session-api-contract";
import { countActiveAgentSessions, countAttentionParkedSessions } from "../core/task-session-api-contract";
import { buildWorkspaceScopeHeaders } from "../core/workspace-scope";
import { runDevTestProject } from "../nklein-agent/nklein-dev-test-harness";
import type { NKleinDevTestProjectScenario } from "../nklein-agent/nklein-dev-test-project";
import { createDevTestStateReader } from "../nklein-agent/nklein-dev-test-runner";
import { loadWorkspaceBoardById } from "../state/workspace-state";
import type { RuntimeAppRouter } from "../trpc/app-router";

export function createDevRuntimeClient(workspaceId: string | null) {
	return createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: buildKanbanRuntimeUrl("/api/trpc"),
				headers: () => buildWorkspaceScopeHeaders(workspaceId),
				fetch: async (url, options) => {
					const runtimeFetch = await getRuntimeFetch();
					return runtimeFetch(url, options);
				},
			}),
		],
	});
}

export type DevRuntimeClient = ReturnType<typeof createDevRuntimeClient>;

interface DevScenarioBoardForActivity {
	columns: ReadonlyArray<{
		id: string;
		cards: ReadonlyArray<{ id?: string; autoReviewEnabled?: boolean; review?: unknown }>;
	}>;
}

/**
 * Auto-review is synthetic work and is not represented by the primary task-session count, so it is added to
 * `activeSessionCount` — the counter whose ONLY job is to suspend the stagnation settle while work is in flight.
 *
 * ⚠️ This used to require `card.review === undefined`, i.e. a card counted only until its FIRST verdict. But the
 * verdict is the START of the expensive half, not the end: bounce → re-review → delivery → acceptance all happen
 * after it. So the moment a reviewer returned anything, the card went invisible to the liveness counter and the
 * monitor began counting the run as stagnant while it was demonstrably still working.
 *
 * G6.8a v17 (2026-07-29) is the proof: the run settled at ~80 minutes with two review-lane cards that both had
 * `autoReviewEnabled: true` AND a verdict attached — counted 0 — while telemetry shows a review model request
 * completing 100 seconds before the settle and a decomposition turn continuing at the final second. Several
 * earlier campaign runs (v13/v15b/v16) ended the same way, so their "workflow incomplete" verdicts measured this
 * counter rather than !Klein's throughput.
 *
 * A card in the `review` LANE is non-terminal by definition — only completed/trash/failed are terminal — so it
 * counts as activity regardless of verdict. The genuinely stuck case (parked awaiting a human) does NOT hang the
 * run: it is tracked independently as `attentionCardCount` and has its own terminal outcome bucket.
 */
/**
 * P23.5 resume-mode: does the board still hold work (any card outside completed/trash)? When true, a resume run
 * skips seeding entirely — the surviving board IS the seed. Exhausted boards fall through to normal seeding: an
 * empty board resumed is a fresh start, not an error.
 */
export function boardHoldsNonTerminalCards(board: {
	columns: ReadonlyArray<{ id: string; cards: readonly unknown[] }>;
}): boolean {
	return board.columns.some((column) => column.id !== "completed" && column.id !== "trash" && column.cards.length > 0);
}

export function countPendingAutoReviews(
	board: DevScenarioBoardForActivity,
	attentionParkedTaskIds?: ReadonlySet<string>,
): number {
	const review = board.columns.find((column) => column.id === "review");
	return (
		review?.cards.filter((card) => {
			if (card.autoReviewEnabled !== true) {
				return false;
			}
			// Live 20260811-001402 (and run 11 before it): a card PARKED for the operator sits in the review
			// lane with autoReviewEnabled forever — counting it pinned activeSessionCount ≥ 1 on a board where
			// nothing could ever progress, the stagnation settle never fired, and the rig burned 7 idle minutes
			// before stall-killing an unclassified run. The exclusion set is derived from the SAME rule the
			// needs_attention outcome uses (countAttentionParkedSessions), so "parked" has one definition.
			if (card.id !== undefined && attentionParkedTaskIds?.has(card.id)) {
				return false;
			}
			// Harvested from codex/f11-followup 616903745, RECONCILED with the 2026-07-29 live evidence (see the
			// test): a verdicted card still has post-verdict flow (bounce → re-review → delivery), so it KEEPS
			// counting — the one exclusion the branch got right is a PERSISTED park: after a restart the parked
			// SESSION is gone, so the attention set alone cannot see it, and the card would pin the drain's
			// activity count forever on a board where nothing can progress.
			const reviewStatus =
				card.review && typeof card.review === "object" && "status" in card.review ? card.review.status : null;
			return reviewStatus !== "parked";
		}).length ?? 0
	);
}

/** Identify a terminal sandbox result-capture failure without conflating ordinary model/session failures with infra. */
export function findSandboxPatchCaptureFailure(
	sessions: readonly Pick<RuntimeTaskSessionSummary, "taskId" | "latestHookActivity" | "warningMessage">[],
): string | null {
	const failed = sessions.find(
		(summary) =>
			summary.latestHookActivity?.hookEventName === "sandbox_patch_capture_failed" ||
			/(?:patch.*captur|captur.*patch)/iu.test(summary.warningMessage ?? ""),
	);
	if (!failed) return null;
	const detail =
		failed.warningMessage?.trim() ||
		failed.latestHookActivity?.activityText?.trim() ||
		"sandbox patch capture failed";
	return `Sandbox patch capture failed for ${failed.taskId}: ${detail}`;
}

// Real-model runs have between-turn lulls that exceed the simulator's 30-second settle default. A live 2026-07-12
// run looked stagnant at three minutes while the runtime continued to completion at eighteen. Preserve a bounded
// four-minute no-progress tolerance; active sessions still suspend the counter and maxWaitMs remains the hard limit.
export const DEVTEST_REAL_MODEL_STABLE_POLLS = 48;

export interface ExecuteDevTestScenarioInput {
	client: DevRuntimeClient;
	workspaceId: string;
	scenario: NKleinDevTestProjectScenario;
	baseRef: string;
	seedTaskId?: string;
	/**
	 * P23.5 resume-mode: when true and the live board already holds any card in a non-terminal lane, the seed
	 * step is SKIPPED entirely and no session is started — the surviving board IS the seed, and the runtime's
	 * own dispatch (liveness sweep / scheduler) starts the startable cards. Fresh-workspace runs are
	 * measurement-stationary (each run re-delivers the same foundation cards); resuming is what lets run N+1
	 * attack the graph's DEEPER cards.
	 */
	resumeExistingBoard?: boolean;
	pollIntervalMs?: number;
	maxWaitMs?: number;
	stablePollsUntilSettled?: number;
	nkleinSettings?: RuntimeTaskNKleinSettings;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: RuntimeTaskAutoReviewMode;
	testEvidencePolicy?: RuntimeTaskTestEvidencePolicy;
	nullAgent?: boolean;
	/** Independent acceptance is intentionally optional; benchmark oracles must stay outside the agent workspace. */
	runAcceptance?: () => Promise<boolean>;
}

export interface ExecuteDevTestScenarioResult {
	scenario: NKleinDevTestProjectScenario;
	seedTaskId: string;
	result: Awaited<ReturnType<typeof runDevTestProject>>;
	durationMs: number;
}

/**
 * Execute an arbitrary explicit scenario through the same board seed, runtime session, and settled-state monitor as the
 * curated dev-test presets. Keeping this seam scenario-based prevents benchmark commands from reimplementing runtime
 * orchestration or launching a subprocess with a weaker contract.
 */
export async function executeDevTestScenario(
	input: ExecuteDevTestScenarioInput,
): Promise<ExecuteDevTestScenarioResult> {
	const seedTaskId = input.seedTaskId ?? `devtest-${input.scenario.id}-${Date.now()}`;
	const readState = createDevTestStateReader({
		readLiveState: async () => {
			const state = await input.client.workspace.getState.query();
			const sessions = Object.values(state.sessions ?? {});
			const counts = countActiveAgentSessions(sessions);
			// ⚠️ DO NOT add an `awaiting_review` SESSION term here. Added 2026-07-29, reverted 2026-07-30 after it
			// hung a run for two hours: that state conflates a review genuinely IN FLIGHT with a card PARKED after
			// failing. G6.8a v18's dead decompose seed sat in `awaiting_review` with `reviewReason: "error"` — so
			// it was not attention-parked either, and no existing filter excluded it. Counting it pinned
			// activeSessionCount at 1 on a board where nothing could ever progress, so the stagnation settle never
			// fired and the run burned its full 12-hour budget instead of ending in six minutes.
			// The in-flight case that motivated it is already covered correctly by BOARD-LANE membership below
			// (`countPendingAutoReviews`), which cannot mistake a parked terminal for live work.
			return {
				board: state.board,
				runtimeReachable: true,
				failedCardCount: sessions.filter((summary) => summary.state === "failed").length,
				activeSessionCount:
					counts.running +
					counts.queued +
					countPendingAutoReviews(
						state.board,
						new Set(
							sessions
								.filter(
									(summary) => summary.state === "awaiting_review" && summary.reviewReason === "attention",
								)
								.map((summary) => summary.taskId),
						),
					),
				attentionCardCount: countAttentionParkedSessions(sessions),
				infrastructureFailure: findSandboxPatchCaptureFailure(sessions),
			};
		},
		readPersistedBoard: async () => await loadWorkspaceBoardById(input.workspaceId),
	});
	const startedAt = Date.now();
	const result = await runDevTestProject(
		{
			scenario: input.scenario,
			seedTaskId,
			baseRef: input.baseRef,
			...(typeof input.startInPlanMode === "boolean" ? { startInPlanMode: input.startInPlanMode } : {}),
			...(input.nkleinSettings ? { nkleinSettings: input.nkleinSettings } : {}),
			...(typeof input.pollIntervalMs === "number" ? { pollIntervalMs: input.pollIntervalMs } : {}),
			...(typeof input.maxWaitMs === "number" ? { maxWaitMs: input.maxWaitMs } : {}),
			stablePollsUntilSettled: input.nullAgent
				? 2
				: (input.stablePollsUntilSettled ?? DEVTEST_REAL_MODEL_STABLE_POLLS),
		},
		{
			startSeedTask: async (payload) => {
				try {
					const state = await input.client.workspace.getState.query();
					if (input.resumeExistingBoard) {
						if (boardHoldsNonTerminalCards(state.board)) {
							return {
								ok: true,
								message:
									"Resume: the board already holds non-terminal cards — no seed added; the runtime's own dispatch drives them.",
							};
						}
						// A resume against a board with nothing left to do falls through to normal seeding: an
						// exhausted board is a fresh start, not an error.
					}
					const cardExists = state.board.columns.some((column) =>
						column.cards.some((card) => card.id === payload.taskId),
					);
					if (!cardExists) {
						const seeded = addTaskToColumn(
							state.board,
							"backlog",
							{
								taskId: payload.taskId,
								prompt: payload.prompt,
								title: payload.taskTitle,
								baseRef: payload.baseRef,
								startInPlanMode: payload.startInPlanMode,
								// A dev-test card's objective comes from a preset or an operator-supplied
								// `--scenario-file` on this machine — first-party authored text, not ingress.
								// (Campaign 2026-08-19: without this every rig card was permanently gate-held.)
								trustedOrigin: "operator",
								// N20 (live-hit 2026-08-02): default TRUE. Dev-test drains are HEADLESS — a seed
								// without auto-review waits for an operator that does not exist, and the omission
								// is not even neutral: `addTaskToColumn` coerces an absent flag to an explicit
								// `false` opt-OUT. An ACT-mode seed therefore dead-stopped in Review with zero log
								// lines. Plan-mode drains only ever completed because decompose CHILDREN opt in
								// themselves (plan-task-board-apply.ts); the benchmark harness already passed
								// `true` explicitly. Pass `false` deliberately to exercise the manual-review path.
								autoReviewEnabled: input.autoReviewEnabled ?? true,
								...(input.autoReviewMode ? { autoReviewMode: input.autoReviewMode } : {}),
								...(input.testEvidencePolicy ? { testEvidencePolicy: input.testEvidencePolicy } : {}),
								...(payload.nkleinSettings ? { nkleinSettings: payload.nkleinSettings } : {}),
							},
							() => crypto.randomUUID(),
						);
						await input.client.workspace.saveState.mutate({
							board: seeded.board,
							expectedRevision: state.revision,
						});
					}
				} catch (error) {
					return {
						ok: false,
						message: `Failed to seed board card: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
				if (input.nullAgent) {
					return { ok: true, message: "Null-agent baseline: seeded the board without starting a task session." };
				}
				const started = await input.client.runtime.startTaskSession.mutate({
					taskId: payload.taskId,
					prompt: payload.prompt,
					taskTitle: payload.taskTitle,
					startInPlanMode: payload.startInPlanMode,
					baseRef: payload.baseRef,
					agentId: runtimeAgentIdSchema.catch("nklein").parse(payload.agentId),
					...(payload.nkleinSettings ? { nkleinSettings: payload.nkleinSettings } : {}),
				});
				// Surface the runtime's full selection reasoning on refusal — the generic error ("not currently
				// selectable") hid the actual free-first refusal cause across seven aider-arm launches.
				const startedSelectionReason = (started as { selectionReason?: string | null }).selectionReason;
				const startFailureMessage = started.error
					? `${started.error}${startedSelectionReason ? ` [selection: ${startedSelectionReason}]` : ""}`
					: undefined;
				return { ok: started.ok, ...(startFailureMessage ? { message: startFailureMessage } : {}) };
			},
			readState,
			...(input.runAcceptance ? { runAcceptance: input.runAcceptance } : {}),
			sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
			now: () => Date.now(),
		},
	);
	return { scenario: input.scenario, seedTaskId, result, durationMs: Date.now() - startedAt };
}
