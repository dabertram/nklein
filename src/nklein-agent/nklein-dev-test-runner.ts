import type { DevTestCleanupEntry, DevTestCleanupKind } from "../core/dev-test-cleanup";
import type { DevTestBoardLike } from "../core/dev-test-outcome";
import type { DevTestStateRead } from "./nklein-dev-test-harness";

/**
 * Thin real-wiring helpers for the dev-test harness (todo.md §5.D).
 *
 * The harness (`runDevTestProject`) and the cleanup summarizer (`summarizeDevTestCleanup`) are pure and
 * injected-dependency-driven so they unit-test without a live runtime, Docker, or a local model. This module
 * supplies the two side-effecting seams the caller needs:
 *
 *  - `createDevTestStateReader` implements the injected `readState` contract: ask the running runtime for live
 *    board state, and when it is unreachable fall back to the last persisted board so the monitor still
 *    classifies from *some* state instead of crashing. The fallback semantics are pure and tested here; the
 *    real tRPC `workspace.getState` call and the persisted `loadWorkspaceBoardById` read are passed in.
 *  - `discoverDevTestCleanupEntries` turns discovered candidates (dev-test workspaces, sandbox volumes, editor
 *    caches) into `DevTestCleanupEntry[]`, marking the active run's workspace as retained. The active-detection
 *    and shaping are pure and tested here; the marker scan / `du` / `docker volume ls` discovery is passed in.
 */

export interface CreateDevTestStateReaderDeps {
	/** Read live board state from the running runtime (tRPC `workspace.getState`). */
	readLiveBoard(): Promise<DevTestBoardLike>;
	/** Read the last persisted board state for the workspace, used when the runtime is unreachable. */
	readPersistedBoard(): Promise<DevTestBoardLike>;
	/** Optional count of failed sessions the column derivation cannot see (live runtime only). */
	readFailedCardCount?(): Promise<number>;
	/** Optional count of sessions doing in-flight LLM work (running + queued); keeps the monitor from settling mid-turn. */
	readActiveSessionCount?(): Promise<number>;
	/** Optional count of sessions parked for the operator (awaiting_review + attention) — the needs-you signal. */
	readAttentionCardCount?(): Promise<number>;
}

export function createDevTestStateReader(deps: CreateDevTestStateReaderDeps): () => Promise<DevTestStateRead> {
	return async (): Promise<DevTestStateRead> => {
		try {
			const board = await deps.readLiveBoard();
			const failedCardCount = deps.readFailedCardCount
				? await deps.readFailedCardCount().catch(() => undefined)
				: undefined;
			const activeSessionCount = deps.readActiveSessionCount
				? await deps.readActiveSessionCount().catch(() => undefined)
				: undefined;
			const attentionCardCount = deps.readAttentionCardCount
				? await deps.readAttentionCardCount().catch(() => undefined)
				: undefined;
			return {
				board,
				runtimeReachable: true,
				...(typeof failedCardCount === "number" ? { failedCardCount } : {}),
				...(typeof activeSessionCount === "number" ? { activeSessionCount } : {}),
				...(typeof attentionCardCount === "number" ? { attentionCardCount } : {}),
			};
		} catch {
			// The runtime went away mid-run; classify from the last durable board we can still read.
			try {
				const board = await deps.readPersistedBoard();
				return { board, runtimeReachable: false };
			} catch {
				return { board: null, runtimeReachable: false };
			}
		}
	};
}

/** A discovered throwaway artifact, before active/retained classification. */
export interface DevTestCleanupCandidate {
	path: string;
	kind: DevTestCleanupKind;
	sizeBytes: number;
}

export interface DiscoverDevTestCleanupDeps {
	/** Scaffolded dev-test project workspaces (each carries the dev-test marker), sized via `du`. */
	listDevTestWorkspaces(): Promise<DevTestCleanupCandidate[]>;
	/** Docker sandbox named volumes / containers created for agent isolation. */
	listSandboxVolumes(): Promise<DevTestCleanupCandidate[]>;
	/** Editor/cache artifacts outside !Klein ownership. */
	listEditorCaches?(): Promise<DevTestCleanupCandidate[]>;
	/** Absolute path of the active run's workspace, which must be retained. */
	activeWorkspacePath?: string | null;
}

function normalizePath(path: string): string {
	return path.replace(/[/\\]+$/, "");
}

export async function discoverDevTestCleanupEntries(deps: DiscoverDevTestCleanupDeps): Promise<DevTestCleanupEntry[]> {
	const candidates: DevTestCleanupCandidate[] = [
		...(await deps.listDevTestWorkspaces()),
		...(await deps.listSandboxVolumes()),
		...(deps.listEditorCaches ? await deps.listEditorCaches() : []),
	];
	const activePath = deps.activeWorkspacePath ? normalizePath(deps.activeWorkspacePath) : null;
	return candidates.map((candidate) => ({
		path: candidate.path,
		kind: candidate.kind,
		sizeBytes: candidate.sizeBytes,
		// Only a dev-test workspace can be the active run; sandbox volumes/editor caches are never retained as "active".
		isActive:
			candidate.kind === "dev_test_workspace" && activePath !== null && normalizePath(candidate.path) === activePath,
	}));
}
