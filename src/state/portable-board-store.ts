import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { NKLEIN_HOME_DIR_NAME, NKLEIN_RUNTIME_DIR_NAME } from "../config/runtime-path-constants";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import type { RuntimeBoardCard, RuntimeBoardData } from "../core/api-contract";
import { lockedFileSystem } from "../fs/locked-file-system";
import {
	boardToPortableBoardCrdt,
	markCardDeleted,
	mergePortableBoardCrdt,
	migratePortableBoardCrdt,
	type PortableBoardCrdt,
	portableBoardCrdtToBoard,
} from "./portable-board-crdt";

/**
 * Committed, portable board CRDT store (specsheet §14.2).
 *
 * The board CRDT is written into the repository itself (`<repo>/.nklein/nklein/workspace/board-crdt.json`) so
 * the durable project state — cards, the DAG, placement, provenance — can be pushed, fetched on another
 * machine, and merged there. Plan artifacts (spec/plan/decisions/revisions) already live under
 * `.nklein/nklein/plans/`, so this store covers the remaining board/DAG portion.
 *
 * `importPortableBoard` merges the committed CRDT with the local board and re-resolves machine-local model
 * assignments against the importing machine (the source machine's `nkleinSettings` are dropped so roles/fit are
 * resolved locally on start — see `prepareImportedBoardForLocalModels`), honoring the local-only invariant.
 */

const PORTABLE_BOARD_CRDT_FILENAME = "board-crdt.json";
const WORKSPACE_LOCAL_STATE_DIR = "workspace";

export function getPortableBoardCrdtPath(repoPath: string): string {
	return join(
		repoPath,
		NKLEIN_HOME_DIR_NAME,
		NKLEIN_RUNTIME_DIR_NAME,
		WORKSPACE_LOCAL_STATE_DIR,
		PORTABLE_BOARD_CRDT_FILENAME,
	);
}

export async function readPortableBoardCrdt(repoPath: string): Promise<PortableBoardCrdt | null> {
	try {
		const raw = await readFile(getPortableBoardCrdtPath(repoPath), "utf8");
		// Migrate older committed CRDTs forward on read (e.g. a file pushed by a machine on a prior schema),
		// and refuse files written by a newer schema this build cannot safely downgrade.
		return migratePortableBoardCrdt(JSON.parse(raw));
	} catch {
		return null;
	}
}

/**
 * Committed-file states the EXPORT (write) path must tell apart — `readPortableBoardCrdt` flattens all of these to
 * `null`, which is fine for read-only callers but DANGEROUS for a writer: treating "present but unusable" as "absent"
 * makes the export overwrite (and destroy) a newer-schema or corrupt file with a downgraded current-schema write.
 */
type CommittedBoardCrdtState =
	| { status: "absent" }
	| { status: "usable"; crdt: PortableBoardCrdt }
	| { status: "refused" };

async function readCommittedPortableBoardCrdtState(repoPath: string): Promise<CommittedBoardCrdtState> {
	let raw: string;
	try {
		raw = await readFile(getPortableBoardCrdtPath(repoPath), "utf8");
	} catch (error) {
		// Genuinely absent → a fresh start the export may safely initialize. Any OTHER read error (permissions, IO)
		// is treated as "refused" so a file we merely could not read is never overwritten.
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			return { status: "absent" };
		}
		return { status: "refused" };
	}
	let migrated: PortableBoardCrdt | null;
	try {
		migrated = migratePortableBoardCrdt(JSON.parse(raw));
	} catch {
		return { status: "refused" }; // corrupt JSON — do not clobber
	}
	// migratePortableBoardCrdt returns null for a NEWER schema it refuses to downgrade → present but unusable.
	return migrated ? { status: "usable", crdt: migrated } : { status: "refused" };
}

export async function writePortableBoardCrdt(repoPath: string, crdt: PortableBoardCrdt): Promise<string> {
	const path = getPortableBoardCrdtPath(repoPath);
	await mkdir(join(repoPath, NKLEIN_HOME_DIR_NAME, NKLEIN_RUNTIME_DIR_NAME, WORKSPACE_LOCAL_STATE_DIR), {
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
	const committedState = await readCommittedPortableBoardCrdtState(input.repoPath);
	if (committedState.status === "refused") {
		// The committed board-crdt.json is a NEWER schema (or corrupt/unreadable) this build cannot safely fold in.
		// REFUSE to export — overwriting it with a downgraded current-schema write would silently destroy another
		// machine's newer data, defeating migratePortableBoardCrdt's newer-schema guard. The caller's best-effort
		// export catch skips the write; the local board is still persisted to local state either way.
		throw new Error(
			"Refusing to export the local board: committed board-crdt.json is a newer schema or unreadable and cannot be safely merged.",
		);
	}
	const committed = committedState.status === "usable" ? committedState.crdt : null;
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
	// Hold the file lock across the whole read-generate-write. The replica-id file is machine-global but its only
	// callers hold merely per-WORKSPACE directory locks, so without this two concurrent first-run resolutions (from
	// different workspaces) could both read ENOENT and generate DISTINCT UUIDs — the write-side lock alone can't
	// prevent the double-generation because it doesn't cover the earlier read. Re-reading inside the lock lets a
	// racing caller that already persisted an id be observed instead of overwritten. (Nested writeTextFileAtomic on
	// the same path is re-entrant-safe, so this does not deadlock.)
	return await lockedFileSystem.withLock({ path }, async () => {
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
	});
}

/**
 * Strips machine-local model assignments so the importing machine re-resolves roles/fit against its own local
 * models (specsheet §14.2: "re-resolve roles/fit on load rather than trusting the source machine's
 * assignments"). The card keeps its `agentId` (always `nklein` under local-only) but loses `nkleinSettings`.
 */
export function prepareImportedBoardForLocalModels(board: RuntimeBoardData): RuntimeBoardData {
	return {
		...board,
		columns: board.columns.map((column) => ({
			...column,
			cards: column.cards.map((card) => {
				if (!("nkleinSettings" in card)) {
					return card;
				}
				const { nkleinSettings: _nkleinSettings, ...rest } = card as RuntimeBoardCard & {
					nkleinSettings?: unknown;
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
