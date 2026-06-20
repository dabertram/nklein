import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLINE_HOME_DIR_NAME, NKLEIN_RUNTIME_DIR_NAME } from "../config/runtime-path-constants";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { RuntimeBoardCard, RuntimeBoardData } from "../core/api-contract";
import { lockedFileSystem } from "../fs/locked-file-system";
import {
	boardToPortableBoardCrdt,
	markCardDeleted,
	mergePortableBoardCrdt,
	type PortableBoardCrdt,
	portableBoardCrdtToBoard,
} from "./portable-board-crdt";

/**
 * Committed, portable board CRDT store (specsheet §14.2).
 *
 * The board CRDT is written into the repository itself (`<repo>/.cline/nklein/workspace/board-crdt.json`) so
 * the durable project state — cards, the DAG, placement, provenance — can be pushed, fetched on another
 * machine, and merged there. Plan artifacts (spec/plan/decisions/revisions) already live under
 * `.cline/nklein/plans/`, so this store covers the remaining board/DAG portion.
 *
 * `importPortableBoard` merges the committed CRDT with the local board and re-resolves machine-local model
 * assignments against the importing machine (the source machine's `clineSettings` are dropped so roles/fit are
 * resolved locally on start — see `prepareImportedBoardForLocalModels`), honoring the local-only invariant.
 */

const PORTABLE_BOARD_CRDT_FILENAME = "board-crdt.json";
const WORKSPACE_LOCAL_STATE_DIR = "workspace";

export function getPortableBoardCrdtPath(repoPath: string): string {
	return join(
		repoPath,
		CLINE_HOME_DIR_NAME,
		NKLEIN_RUNTIME_DIR_NAME,
		WORKSPACE_LOCAL_STATE_DIR,
		PORTABLE_BOARD_CRDT_FILENAME,
	);
}

export async function readPortableBoardCrdt(repoPath: string): Promise<PortableBoardCrdt | null> {
	try {
		const raw = await readFile(getPortableBoardCrdtPath(repoPath), "utf8");
		const parsed = JSON.parse(raw) as PortableBoardCrdt;
		if (parsed?.schemaVersion !== 1 || typeof parsed.cards !== "object") {
			return null;
		}
		return { schemaVersion: 1, cards: parsed.cards ?? {}, dependencies: parsed.dependencies ?? {} };
	} catch {
		return null;
	}
}

export async function writePortableBoardCrdt(repoPath: string, crdt: PortableBoardCrdt): Promise<string> {
	const path = getPortableBoardCrdtPath(repoPath);
	await mkdir(join(repoPath, CLINE_HOME_DIR_NAME, NKLEIN_RUNTIME_DIR_NAME, WORKSPACE_LOCAL_STATE_DIR), {
		recursive: true,
	});
	await lockedFileSystem.writeJsonFileAtomic(path, crdt);
	return path;
}

/**
 * Folds the current local board into the committed CRDT and persists the merged state. Returns the merged
 * CRDT and the board projected from it, so a caller can both commit the file and refresh the live board.
 */
export async function exportLocalBoardToPortableCrdt(input: {
	repoPath: string;
	board: RuntimeBoardData;
	replicaId: string;
}): Promise<{ crdt: PortableBoardCrdt; board: RuntimeBoardData; path: string }> {
	const local = boardToPortableBoardCrdt(input.board, input.replicaId);
	const committed = await readPortableBoardCrdt(input.repoPath);
	let merged = committed ? mergePortableBoardCrdt(committed, local) : local;
	// A card that was in the committed CRDT but is no longer on the (non-empty, authoritative) local board was
	// permanently removed; tombstone it so a re-export does not resurrect it. Guard on a non-empty local board
	// so a not-yet-imported fresh machine cannot mass-tombstone the committed state.
	const localCardIds = new Set(Object.keys(local.cards));
	if (committed && localCardIds.size > 0) {
		for (const cardId of Object.keys(committed.cards)) {
			if (!localCardIds.has(cardId) && !merged.cards[cardId]?.deleted.value) {
				merged = markCardDeleted(merged, cardId, input.replicaId);
			}
		}
	}
	const path = await writePortableBoardCrdt(input.repoPath, merged);
	return { crdt: merged, board: portableBoardCrdtToBoard(merged), path };
}

const REPLICA_ID_FILENAME = "replica-id";

/**
 * A stable per-machine replica id used to break CRDT stamp ties, persisted under the runtime home so it
 * survives restarts but never leaks into the committed repo state.
 */
export async function resolveMachineReplicaId(): Promise<string> {
	const path = join(resolveNkleinRuntimeHomePath(homedir()), REPLICA_ID_FILENAME);
	try {
		const existing = (await readFile(path, "utf8")).trim();
		if (existing) {
			return existing;
		}
	} catch {
		// Falls through to create one.
	}
	const replicaId = randomUUID();
	try {
		await mkdir(resolveNkleinRuntimeHomePath(homedir()), { recursive: true });
		await lockedFileSystem.writeTextFileAtomic(path, replicaId);
	} catch {
		// Best-effort persistence; a transient id is still correct for a single run.
	}
	return replicaId;
}

/**
 * Strips machine-local model assignments so the importing machine re-resolves roles/fit against its own local
 * models (specsheet §14.2: "re-resolve roles/fit on load rather than trusting the source machine's
 * assignments"). The card keeps its `agentId` (always `cline` under local-only) but loses `clineSettings`.
 */
export function prepareImportedBoardForLocalModels(board: RuntimeBoardData): RuntimeBoardData {
	return {
		...board,
		columns: board.columns.map((column) => ({
			...column,
			cards: column.cards.map((card) => {
				if (!("clineSettings" in card)) {
					return card;
				}
				const { clineSettings: _clineSettings, ...rest } = card as RuntimeBoardCard & {
					clineSettings?: unknown;
				};
				return rest as RuntimeBoardCard;
			}),
		})),
	};
}

/**
 * Imports the committed portable board on a fresh machine: reads the CRDT, optionally merges the local board
 * into it, and returns a board with machine-local assignments cleared for local re-resolution.
 */
export async function importPortableBoard(input: {
	repoPath: string;
	localBoard?: RuntimeBoardData;
	replicaId: string;
}): Promise<{ board: RuntimeBoardData; crdt: PortableBoardCrdt } | null> {
	const committed = await readPortableBoardCrdt(input.repoPath);
	if (!committed) {
		return null;
	}
	const merged = input.localBoard
		? mergePortableBoardCrdt(committed, boardToPortableBoardCrdt(input.localBoard, input.replicaId))
		: committed;
	return { crdt: merged, board: prepareImportedBoardForLocalModels(portableBoardCrdtToBoard(merged)) };
}
