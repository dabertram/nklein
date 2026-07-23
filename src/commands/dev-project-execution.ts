import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type {
	RuntimeTaskAutoReviewMode,
	RuntimeTaskNKleinSettings,
	RuntimeTaskTestEvidencePolicy,
} from "../core/api-contract";
import { runtimeAgentIdSchema } from "../core/api-contract";
import { buildKanbanRuntimeUrl, getRuntimeFetch } from "../core/runtime-endpoint";
import { addTaskToColumn } from "../core/task-board-mutations";
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
		cards: ReadonlyArray<{ autoReviewEnabled?: boolean; review?: unknown }>;
	}>;
}

/** Auto-review is synthetic work and is not represented by the primary task-session count. */
export function countPendingAutoReviews(board: DevScenarioBoardForActivity): number {
	const review = board.columns.find((column) => column.id === "review");
	return review?.cards.filter((card) => card.autoReviewEnabled === true && card.review === undefined).length ?? 0;
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
		readLiveBoard: async () => (await input.client.workspace.getState.query()).board,
		readPersistedBoard: async () => await loadWorkspaceBoardById(input.workspaceId),
		readActiveSessionCount: async () => {
			const state = await input.client.workspace.getState.query();
			const sessions = Object.values(state.sessions ?? {});
			const counts = countActiveAgentSessions(sessions);
			return counts.running + counts.queued + countPendingAutoReviews(state.board);
		},
		readAttentionCardCount: async () => {
			const sessions = Object.values((await input.client.workspace.getState.query()).sessions ?? {});
			return countAttentionParkedSessions(sessions);
		},
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
								...(typeof input.autoReviewEnabled === "boolean"
									? { autoReviewEnabled: input.autoReviewEnabled }
									: {}),
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
				return { ok: started.ok, ...(started.error ? { message: started.error } : {}) };
			},
			readState,
			...(input.runAcceptance ? { runAcceptance: input.runAcceptance } : {}),
			sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
			now: () => Date.now(),
		},
	);
	return { scenario: input.scenario, seedTaskId, result, durationMs: Date.now() - startedAt };
}
