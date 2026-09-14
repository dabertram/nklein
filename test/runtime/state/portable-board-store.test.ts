import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeBoardData } from "../../../src/core/api-contract";
import {
	exportLocalBoardToPortableCrdt,
	importPortableBoard,
	prepareImportedBoardForLocalModels,
	readPortableBoardCrdt,
} from "../../../src/state/portable-board-store";

function card(id: string, overrides: Partial<RuntimeBoardCard> = {}): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: `prompt ${id}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	} as RuntimeBoardCard;
}

function board(cards: Array<{ columnId: string; card: RuntimeBoardCard }>): RuntimeBoardData {
	const columnIds = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;
	return {
		columns: columnIds.map((id) => ({
			id,
			title: id,
			cards: cards.filter((entry) => entry.columnId === id).map((entry) => entry.card),
		})),
		dependencies: [],
	};
}

describe("portable board store", () => {
	let repoPath: string;

	beforeEach(async () => {
		repoPath = await mkdtemp(join(tmpdir(), "nklein-portable-board-"));
	});

	afterEach(async () => {
		await rm(repoPath, { force: true, recursive: true });
	});

	it("exports the board to a committed CRDT file and imports it back", async () => {
		const original = board([{ columnId: "planning", card: card("a") }]);
		const exported = await exportLocalBoardToPortableCrdt({ repoPath, board: original, replicaId: "m1" });
		expect(exported.path).toContain(join(".nklein", "nklein", "workspace", "board-crdt.json"));

		const committed = await readPortableBoardCrdt(repoPath);
		expect(committed?.cards.a).toBeTruthy();

		const imported = await importPortableBoard({ repoPath, replicaId: "m2" });
		const planning = imported?.board.columns.find((column) => column.id === "planning");
		expect(planning?.cards.map((entry) => entry.id)).toEqual(["a"]);
	});

	it("merges a later remote edit over the committed state on export", async () => {
		await exportLocalBoardToPortableCrdt({
			repoPath,
			board: board([{ columnId: "planning", card: card("a", { updatedAt: 1, prompt: "old" }) }]),
			replicaId: "m1",
		});
		const merged = await exportLocalBoardToPortableCrdt({
			repoPath,
			board: board([{ columnId: "in_progress", card: card("a", { updatedAt: 9, prompt: "new" }) }]),
			replicaId: "m2",
		});
		const inProgress = merged.board.columns.find((column) => column.id === "in_progress");
		expect(inProgress?.cards[0]?.prompt).toBe("new");
	});

	it("tombstones an EDGE the local board no longer carries, so an unlink survives the round trip (found 2026-09-14)", async () => {
		const linked: RuntimeBoardData = {
			...board([
				{ columnId: "planning", card: card("a") },
				{ columnId: "planning", card: card("b") },
			]),
			dependencies: [{ id: "a->b", fromTaskId: "a", toTaskId: "b", createdAt: 5 }],
		};
		await exportLocalBoardToPortableCrdt({ repoPath, board: linked, replicaId: "m1" });
		const unlinked = await exportLocalBoardToPortableCrdt({
			repoPath,
			board: { ...linked, dependencies: [] },
			replicaId: "m1",
		});
		expect(unlinked.crdt.dependencies["a->b"]?.present.value).toBe(false);
		expect(unlinked.board.dependencies).toEqual([]);
		const imported = await importPortableBoard({ repoPath, replicaId: "m2" });
		expect(imported?.board.dependencies).toEqual([]);
		// The tombstone dominates the edge's own stamp: a re-export of the OLD linked board (an older replica view)
		// does not resurrect it.
		const stale = await exportLocalBoardToPortableCrdt({ repoPath, board: linked, replicaId: "m3" });
		expect(stale.board.dependencies).toEqual([]);
	});

	it("does not tombstone edges from an EMPTY local board (a not-yet-imported machine is not an authority)", async () => {
		const linked: RuntimeBoardData = {
			...board([
				{ columnId: "planning", card: card("a") },
				{ columnId: "planning", card: card("b") },
			]),
			dependencies: [{ id: "a->b", fromTaskId: "a", toTaskId: "b", createdAt: 5 }],
		};
		await exportLocalBoardToPortableCrdt({ repoPath, board: linked, replicaId: "m1" });
		const fresh = await exportLocalBoardToPortableCrdt({ repoPath, board: board([]), replicaId: "m2" });
		expect(fresh.crdt.dependencies["a->b"]?.present.value).toBe(true);
		expect(fresh.board.dependencies.map((edge) => edge.id)).toEqual(["a->b"]);
	});

	it("strips machine-local nkleinSettings on import for local re-resolution", () => {
		const withSettings = board([
			{
				columnId: "planning",
				card: card("a", {
					nkleinSettings: { providerId: "lmstudio", modelId: "qwen" },
				} as Partial<RuntimeBoardCard>),
			},
		]);
		const prepared = prepareImportedBoardForLocalModels(withSettings);
		const preparedCard = prepared.columns.flatMap((column) => column.cards).find((entry) => entry.id === "a");
		expect(preparedCard).toBeTruthy();
		expect("nkleinSettings" in (preparedCard as object)).toBe(false);
		// agentId is preserved (always nklein under local-only); only the model assignment is dropped.
		expect(preparedCard?.baseRef).toBe("main");
	});

	it("returns null when no committed portable board exists", async () => {
		expect(await importPortableBoard({ repoPath, replicaId: "m1" })).toBeNull();
	});

	it("REFUSES to overwrite a committed board-crdt.json written by a NEWER schema (cross-machine data loss)", async () => {
		// First export creates the file + directory at the current schema.
		const first = await exportLocalBoardToPortableCrdt({
			repoPath,
			board: board([{ columnId: "planning", card: card("a") }]),
			replicaId: "m1",
		});
		// A newer machine committed a schema this build can't safely downgrade.
		const newerContent = JSON.stringify({ schemaVersion: 999, cards: { z: { future: "shape" } }, dependencies: {} });
		await writeFile(first.path, newerContent, "utf8");

		// Exporting the local board must REFUSE, not clobber the newer file with a downgraded write.
		await expect(
			exportLocalBoardToPortableCrdt({
				repoPath,
				board: board([{ columnId: "planning", card: card("b") }]),
				replicaId: "m2",
			}),
		).rejects.toThrow(/newer schema or unreadable/u);

		// The newer file is preserved byte-for-byte (the old code silently downgraded it to schemaVersion 1).
		expect(await readFile(first.path, "utf8")).toBe(newerContent);
	});
});
