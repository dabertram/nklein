import type { Page } from "@playwright/test";

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
	};
}

export interface BoardSnapshotInput {
	workspaceId?: string;
	projectName?: string;
	columns?: BoardColumnFixture[];
	sessions?: Record<string, unknown>;
	projects?: unknown[];
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
			board: { columns, dependencies: [] },
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

	// Suppress the onboarding dialog so the board is reachable immediately.
	await page.addInitScript(() => {
		window.localStorage.setItem("nklein.onboarding.dialog.shown", "true");
	});

	await page.routeWebSocket(/\/api\/runtime\/ws/, (ws) => {
		ws.onMessage(() => {
			/* absorb keep-alives */
		});
		ws.onClose(() => {
			/* no-op */
		});
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

	return { calls };
}
