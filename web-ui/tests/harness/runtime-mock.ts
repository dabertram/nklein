import type { Page, WebSocketRoute } from "@playwright/test";

/**
 * Reusable runtime-mock harness for UI e2e specs (2026-06-27). Extracted from the per-spec ad-hoc mocking
 * (review-recovery / plan-artifact-review / settings) so new UI e2e tests are written systematically and
 * deterministically — no real runtime, no model flakiness. It injects the WebSocket board snapshot the app boots from,
 * a catch-all tRPC query responder (stub per procedure), and per-mutation handlers with request-body capture.
 *
 * For full-system tests (real runtime + models on a small project) use the separate full-system harness; this module is
 * the fast, deterministic "UI e2e with mocks" layer.
 */

export const E2E_WORKSPACE_ID = "ws-e2e";

export const BOARD_COLUMN_IDS = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;
const BOARD_COLUMN_TITLES: Record<(typeof BOARD_COLUMN_IDS)[number], string> = {
	backlog: "Backlog",
	planning: "Planning",
	in_progress: "In Progress",
	review: "Review",
	completed: "Completed",
	trash: "Trash",
};

export interface BoardColumnFixture {
	id: string;
	title: string;
	cards: unknown[];
}

/** The six standard board columns, optionally seeded with cards by column id. */
export function buildBoardColumns(cardsByColumn: Partial<Record<string, unknown[]>> = {}): BoardColumnFixture[] {
	return BOARD_COLUMN_IDS.map((id) => ({ id, title: BOARD_COLUMN_TITLES[id], cards: cardsByColumn[id] ?? [] }));
}

export interface BoardCardInput {
	id?: string;
	title: string;
	prompt?: string;
	/** Extra card fields spread verbatim (e.g. `generatedFromPlan`, `agentId`, `autoReviewEnabled`). */
	extra?: Record<string, unknown>;
}

/** A minimal board card (shape mirrors the proven fixtures) for seeding deterministic board state. */
export function buildBoardCard(input: BoardCardInput): Record<string, unknown> {
	return {
		id: input.id ?? `card-${input.title.replace(/\W+/g, "-").toLowerCase()}`,
		title: input.title,
		prompt: input.prompt ?? input.title,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_001_000_000,
		...(input.extra ?? {}),
	};
}

export interface BoardSnapshotInput {
	workspaceId?: string;
	projectName?: string;
	columns?: BoardColumnFixture[];
	sessions?: Record<string, unknown>;
	projects?: unknown[];
	/** Board dependencies ({id, fromTaskId, toTaskId}) — the §5.BC edges overlay renders these. */
	dependencies?: unknown[];
}

/** Build the `type:"snapshot"` WebSocket message the app hydrates the board from (shape mirrors the proven fixtures). */
export function buildBoardSnapshot(input: BoardSnapshotInput = {}): Record<string, unknown> {
	const workspaceId = input.workspaceId ?? E2E_WORKSPACE_ID;
	const columns = input.columns ?? buildBoardColumns();
	return {
		type: "snapshot",
		currentProjectId: workspaceId,
		projects: input.projects ?? [
			{
				id: workspaceId,
				path: "/home/user/project",
				name: input.projectName ?? "E2E Project",
				taskCounts: { backlog: 0, planning: 0, in_progress: 0, review: 0, completed: 0, trash: 0 },
			},
		],
		workspaceState: {
			repoPath: "/home/user/project",
			statePath: "/home/user/project/.nklein/state.json",
			git: { currentBranch: "main", defaultBranch: "main", branches: ["main"] },
			board: { columns, dependencies: input.dependencies ?? [] },
			sessions: input.sessions ?? {},
			revision: 1,
		},
		workspaceMetadata: null,
		nkleinSessionContextVersion: 0,
	};
}

/** Wrap a value in the tRPC batch-response envelope (one procedure). */
export function trpcOk(data: unknown): unknown[] {
	return [{ result: { data } }];
}

export interface RuntimeMockOptions {
	/** The board snapshot to inject (defaults to an empty board). */
	snapshot?: Record<string, unknown>;
	/** tRPC QUERY procedure → returned `data` (merged over the always-needed defaults). */
	queryStubs?: Record<string, unknown>;
	/** tRPC MUTATION procedure → a handler returning the response body (use `trpcOk`); the request body is captured. */
	mutations?: Record<string, (body: unknown) => unknown>;
}

export interface RuntimeMockHandle {
	/** Captured request bodies per mocked mutation procedure (in call order). */
	readonly calls: Record<string, unknown[]>;
	/**
	 * Push a runtime stream frame to the page over the mocked WebSocket — AFTER `page.goto` + board hydration (the WS
	 * must be open). Lets a spec simulate live streaming (agent output, chat tokens, session-state transitions, ready-
	 * for-review) deterministically. Frames MUST carry `workspaceId: E2E_WORKSPACE_ID` or the client drops them (it
	 * filters on the active workspace). Use the `*Frame` builders below. Throws if called before the WS connects.
	 */
	pushFrame(frame: Record<string, unknown>): void;
}

function defaultQueryStubs(snapshot: Record<string, unknown>): Record<string, unknown> {
	return {
		"workspace.getState": snapshot.workspaceState,
		"runtime.getSwarmStop": { ok: true, signal: null },
		"runtime.listNKleinPlanArtifacts": { artifacts: [] },
	};
}

/**
 * Install the runtime mock on a Playwright page. Call BEFORE `page.goto`. Returns a handle exposing captured mutation
 * request bodies so a spec can assert "the right runtime call fired with the right args".
 */
export async function installRuntimeMock(page: Page, options: RuntimeMockOptions = {}): Promise<RuntimeMockHandle> {
	const snapshot = options.snapshot ?? buildBoardSnapshot();
	const queryStubs = { ...defaultQueryStubs(snapshot), ...(options.queryStubs ?? {}) };
	const mutations = options.mutations ?? {};
	const calls: Record<string, unknown[]> = {};

	// Suppress the onboarding dialog so the board is reachable immediately, and pin zoom to Z3 (Expert — the kanban
	// board): the §5.BB five-level ladder defaults NEW users to Z1 Overview (activity map, no columns), which strands
	// every gotoBoard()-based spec on the map.
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
		window.localStorage.setItem("nklein.ui-zoom-level.v2", "3");
	});

	let currentWs: WebSocketRoute | null = null;
	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		// Track the latest socket so a spec can push frames after hydration (and reconnects re-hydrate).
		currentWs = ws;
		ws.onMessage(() => {
			/* absorb keep-alives */
		});
		ws.onClose(() => {
			/* no-op */
		});
		// The server sends the snapshot on every (re)connect.
		ws.send(JSON.stringify(snapshot));
	});

	// Catch-all tRPC query responder — registered FIRST so it is the lowest-priority match (Playwright routes are LIFO).
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		async (route) => {
			const procedures = route.request().url().split("/api/trpc/")[1]?.split("?")[0]?.split(",") ?? [];
			const stubs = (procedures.length > 0 ? procedures : [""]).map((procedure) => ({
				result: { data: procedure in queryStubs ? queryStubs[procedure] : null },
			}));
			await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stubs) });
		},
	);

	// Per-mutation handlers — registered LAST so they take priority over the catch-all.
	for (const [procedure, handler] of Object.entries(mutations)) {
		await page.route(
			(url) => url.pathname.startsWith("/api/trpc/") && url.pathname.includes(procedure),
			async (route) => {
				let body: unknown = null;
				try {
					body = route.request().postDataJSON();
				} catch {
					/* non-JSON body */
				}
				const captured = calls[procedure] ?? [];
				captured.push(body);
				calls[procedure] = captured;
				await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(handler(body)) });
			},
		);
	}

	const pushFrame = (frame: Record<string, unknown>): void => {
		if (currentWs === null) {
			throw new Error(
				"pushFrame() called before the runtime WebSocket opened — push frames AFTER page.goto + board hydration.",
			);
		}
		currentWs.send(JSON.stringify(frame));
	};

	return { calls, pushFrame };
}

// ─────────────────────────── stream-frame builders (the §5.AC/§5.AK e2e streaming layer) ───────────────────────────
// Shapes mirror `RuntimeStateStreamMessage` (src/core/stream-events-api-contract.ts). Kept as plain records so the
// harness stays self-contained; the runtime green-gate + the protocol doc keep them honest.

export type ChatMessageRole = "user" | "assistant" | "system" | "tool" | "reasoning" | "status";

/** One chat message object. The UI upserts by `id`: resend the SAME id with growing `content` to simulate streaming. */
export function chatMessage(
	id: string,
	role: ChatMessageRole,
	content: string,
	meta: Record<string, unknown> | null = null,
): Record<string, unknown> {
	return { id, role, content, createdAt: 1_700_000_500_000, meta };
}

/** Build a `task_chat_message` stream frame (assistant/tool/reasoning output for a task's chat panel). */
export function taskChatMessageFrame(
	taskId: string,
	message: Record<string, unknown>,
	workspaceId: string = E2E_WORKSPACE_ID,
): Record<string, unknown> {
	return { type: "task_chat_message", workspaceId, taskId, message };
}

/** Build a `task_sessions_updated` stream frame (drives the session-state badge + chat/terminal enablement). */
export function taskSessionsUpdatedFrame(
	summaries: Array<Record<string, unknown>>,
	workspaceId: string = E2E_WORKSPACE_ID,
): Record<string, unknown> {
	return { type: "task_sessions_updated", workspaceId, summaries };
}

/** Build a `task_ready_for_review` stream frame (the agent finished and wants human review). */
export function taskReadyForReviewFrame(
	taskId: string,
	workspaceId: string = E2E_WORKSPACE_ID,
): Record<string, unknown> {
	return { type: "task_ready_for_review", workspaceId, taskId, triggeredAt: 1_700_000_600_000 };
}

// The runtime-state reducer is updatedAt-GATED: a streamed summary whose updatedAt is not newer than the resident one
// is dropped as stale/out-of-order. So each builder call advances a monotonic default updatedAt — sequential frames for
// the same task "just work" without the spec author bumping it manually. Override `updatedAt` to pin it explicitly.
let summaryUpdateClock = 1_700_000_500_000;

/** Minimal task-session summary for {@link taskSessionsUpdatedFrame}; override any field (e.g. `state`). */
export function taskSessionSummary(taskId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	summaryUpdateClock += 1000;
	return {
		taskId,
		state: "running",
		mode: "act",
		role: "worker",
		agentId: "agent-e2e",
		workspacePath: "/home/user/project",
		pid: 4242,
		startedAt: 1_700_000_400_000,
		updatedAt: summaryUpdateClock,
		lastOutputAt: summaryUpdateClock,
		reviewReason: null,
		exitCode: null,
		...overrides,
	};
}

/**
 * A complete mock `runtime.getConfig` response — the §5.AK shared e2e helper. Mock `runtime.getConfig` with this (via
 * `installRuntimeMock`'s queryStubs or a route) so the Settings dialog renders; override any field for the test.
 */
export function buildMockRuntimeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		selectedAgentId: "nklein",
		selectedShortcutLabel: null,
		cloudProviderSupportEnabled: false,
		agentAutonomousModeEnabled: true,
		agentTimeoutMode: "normal",
		agentTimeoutProfile: "local",
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
		maxAgentWritableFileLines: 1000,
		maxConcurrentTasks: 3,
		sandboxMaxContainers: 1,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 2048,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 10,
		sandboxIsolationProfileDefault: "lean_shared",
		sandboxIsolationProfileOverride: null,
		effectiveSandboxIsolationProfile: "lean_shared",
		lostHeartbeatPolicy: "park",
		decompositionAutoApplyEnabled: true,
		secondOpinionReviewEnabled: true,
		reviewMaxRounds: 20,
		codeEmbeddingDefaults: { provider: "local_lexical", model: "local", baseUrl: null },
		codeEmbeddingOverride: null,
		effectiveCodeEmbeddingSettings: { provider: "local_lexical", model: "local", baseUrl: null },
		developerModeEnabled: false,
		replayCardsEnabled: false,
		effectiveCommand: null,
		globalConfigPath: "/home/user/.nklein/config.json",
		projectConfigPath: null,
		readyForReviewNotificationsEnabled: true,
		detectedCommands: [],
		agents: [
			{
				id: "nklein",
				label: "!Klein",
				binary: "nklein",
				command: "",
				defaultArgs: [],
				installed: true,
				configured: true,
			},
		],
		agentSandboxStatus: {
			state: "checking",
			dockerAvailable: null,
			imageAvailable: null,
			image: "nklein/agent-sandbox:0.0.1",
			message: null,
			checkedAt: null,
		},
		shortcuts: [],
		nkleinProviderSettings: {
			providerId: "lm-studio",
			modelId: "test-model",
			baseUrl: "http://localhost:1234",
			reasoningEffort: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		modelRoles: {},
		agentRulesets: {
			capability: { globalPreset: "fully_open" },
			delivery: { globalPreset: "fully_open" },
		},
		swarmGuardrails: {
			maxAutonomousTurnsPerTask: 12,
			maxAutonomousWallTimeMs: 7200000,
			maxRepeatedNoDiffCheckpoints: 4,
			maxRepeatedToolCallsPerTask: 3,
		},
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "Commit message",
		openPrPromptTemplateDefault: "PR description",
		...overrides,
	};
}

let workspaceRevisionClock = 1;

/**
 * Build a `workspace_state_updated` stream frame (a BOARD mutation — e.g. a card moved columns / a lane reconcile). The
 * revision auto-advances so the reducer doesn't drop it as stale; pass `revision` to pin it.
 */
export function workspaceStateUpdatedFrame(
	columns: BoardColumnFixture[],
	options: { workspaceId?: string; sessions?: Record<string, unknown>; revision?: number } = {},
): Record<string, unknown> {
	workspaceRevisionClock += 1;
	return {
		type: "workspace_state_updated",
		workspaceId: options.workspaceId ?? E2E_WORKSPACE_ID,
		workspaceState: {
			repoPath: "/home/user/project",
			statePath: "/home/user/project/.nklein/state.json",
			git: { currentBranch: "main", defaultBranch: "main", branches: ["main"] },
			board: { columns, dependencies: [] },
			sessions: options.sessions ?? {},
			revision: options.revision ?? workspaceRevisionClock,
		},
	};
}
