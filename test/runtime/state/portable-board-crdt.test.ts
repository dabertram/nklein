import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeBoardData } from "../../../src/core/api-contract";
import {
	boardToPortableBoardCrdt,
	CURRENT_PORTABLE_BOARD_SCHEMA_VERSION,
	markCardDeleted,
	mergePortableBoardCrdt,
	migratePortableBoardCrdt,
	type PortableBoardCrdtMigration,
	portableBoardCrdtToBoard,
} from "../../../src/state/portable-board-crdt";

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

function board(
	cards: Array<{ columnId: string; card: RuntimeBoardCard }>,
	deps: Array<[string, string]> = [],
): RuntimeBoardData {
	const columnIds = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;
	return {
		columns: columnIds.map((id) => ({
			id,
			title: id,
			cards: cards.filter((entry) => entry.columnId === id).map((entry) => entry.card),
		})),
		dependencies: deps.map(([fromTaskId, toTaskId], index) => ({
			id: `${fromTaskId}->${toTaskId}`,
			fromTaskId,
			toTaskId,
			createdAt: index + 1,
		})),
	};
}

describe("portable board CRDT merge", () => {
	it("is idempotent, commutative, and associative", () => {
		const a = boardToPortableBoardCrdt(board([{ columnId: "planning", card: card("a", { updatedAt: 5 }) }]), "m1");
		const b = boardToPortableBoardCrdt(
			board([{ columnId: "in_progress", card: card("a", { updatedAt: 9, prompt: "edited" }) }]),
			"m2",
		);
		const c = boardToPortableBoardCrdt(board([{ columnId: "review", card: card("b", { updatedAt: 3 }) }]), "m3");

		expect(mergePortableBoardCrdt(a, a)).toEqual(a); // idempotent
		expect(mergePortableBoardCrdt(a, b)).toEqual(mergePortableBoardCrdt(b, a)); // commutative
		expect(mergePortableBoardCrdt(mergePortableBoardCrdt(a, b), c)).toEqual(
			mergePortableBoardCrdt(a, mergePortableBoardCrdt(b, c)),
		); // associative
	});

	it("resolves concurrent edits by last-writer-wins on the logical clock", () => {
		const older = boardToPortableBoardCrdt(
			board([{ columnId: "planning", card: card("a", { updatedAt: 5, prompt: "old" }) }]),
			"m1",
		);
		const newer = boardToPortableBoardCrdt(
			board([{ columnId: "in_progress", card: card("a", { updatedAt: 9, prompt: "new" }) }]),
			"m2",
		);
		const merged = portableBoardCrdtToBoard(mergePortableBoardCrdt(older, newer));
		const inProgress = merged.columns.find((column) => column.id === "in_progress");
		expect(inProgress?.cards.map((entry) => entry.id)).toEqual(["a"]);
		expect(inProgress?.cards[0]?.prompt).toBe("new");
	});

	it("lets a newer deletion win over a concurrent edit, and vice versa", () => {
		const base = boardToPortableBoardCrdt(board([{ columnId: "planning", card: card("a", { updatedAt: 5 }) }]), "m1");
		const deleted = markCardDeleted(base, "a", "m1", 6);
		const concurrentEdit = boardToPortableBoardCrdt(
			board([{ columnId: "completed", card: card("a", { updatedAt: 5 }) }]),
			"m2",
		);
		// Deletion stamp is counter+1 over the edit, so the card stays deleted.
		const merged = portableBoardCrdtToBoard(mergePortableBoardCrdt(deleted, concurrentEdit));
		expect(merged.columns.every((column) => column.cards.length === 0)).toBe(true);
	});

	it("keeps a card deleted even when a concurrent edit carries a strictly NEWER wall clock (audit 2026-08-25)", () => {
		// The tombstone is stamped from a card at updatedAt:5; the concurrent replica edits the SAME card at a
		// later wall clock (updatedAt:9). The old counter+1 tombstone (=6) lost to 9 and the card resurrected.
		const base = boardToPortableBoardCrdt(board([{ columnId: "planning", card: card("a", { updatedAt: 5 }) }]), "m1");
		// Deletion happens at wall-clock 12, AFTER the other replica's edit at 9 — but the deleting replica has
		// never seen that edit, so only a wall-clock tombstone stamp can outrank it.
		const deleted = markCardDeleted(base, "a", "m1", 12);
		const laterEdit = boardToPortableBoardCrdt(
			board([{ columnId: "completed", card: card("a", { updatedAt: 9 }) }]),
			"m2",
		);
		const merged = portableBoardCrdtToBoard(mergePortableBoardCrdt(deleted, laterEdit));
		expect(merged.columns.every((column) => column.cards.length === 0)).toBe(true);
	});

	it("preserves concurrent edits to DIFFERENT fields of one card across machines (audit 2026-08-25 finding 21)", () => {
		// Shared base: both machines start from the same committed CRDT (card at updatedAt 1).
		const base = boardToPortableBoardCrdt(
			board([{ columnId: "planning", card: card("a", { title: "orig", prompt: "orig", updatedAt: 1 }) }]),
			"base",
		);
		// Machine A edits TITLE (updatedAt bumps to 5); machine B edits PROMPT (updatedAt bumps to 9). Each passes
		// the shared base as prior, so its UNCHANGED field keeps the base stamp instead of the new card timestamp.
		const machineA = boardToPortableBoardCrdt(
			board([{ columnId: "planning", card: card("a", { title: "A-title", prompt: "orig", updatedAt: 5 }) }]),
			"A",
			base,
		);
		const machineB = boardToPortableBoardCrdt(
			board([{ columnId: "planning", card: card("a", { title: "orig", prompt: "B-prompt", updatedAt: 9 }) }]),
			"B",
			base,
		);
		// Merge in either order — CRDT merge is commutative. BOTH edits must survive.
		const merged = portableBoardCrdtToBoard(mergePortableBoardCrdt(machineA, machineB));
		const cardOut = merged.columns.flatMap((column) => column.cards).find((entry) => entry.id === "a");
		expect(cardOut?.title).toBe("A-title");
		expect(cardOut?.prompt).toBe("B-prompt");
	});

	it("round-trips a board through the CRDT", () => {
		const original = board(
			[
				{ columnId: "planning", card: card("a", { updatedAt: 2 }) },
				{ columnId: "in_progress", card: card("b", { updatedAt: 3 }) },
			],
			[["b", "a"]],
		);
		const projected = portableBoardCrdtToBoard(boardToPortableBoardCrdt(original, "m1"));
		const planning = projected.columns.find((column) => column.id === "planning");
		const inProgress = projected.columns.find((column) => column.id === "in_progress");
		expect(planning?.cards.map((entry) => entry.id)).toEqual(["a"]);
		expect(inProgress?.cards.map((entry) => entry.id)).toEqual(["b"]);
		expect(projected.dependencies).toEqual([{ id: "b->a", fromTaskId: "b", toTaskId: "a", createdAt: 1 }]);
	});

	it("round-trips the additive-optional focusChain field, and omits it when absent (§5.N)", () => {
		const focusChain = {
			steps: [
				{ text: "read the spec", status: "done" as const },
				{ text: "write the tests", status: "in_progress" as const },
			],
			updatedAt: 7,
		};
		const original = board([
			{ columnId: "in_progress", card: card("with-chain", { updatedAt: 2, focusChain }) },
			{ columnId: "planning", card: card("no-chain", { updatedAt: 2 }) },
		]);
		const projected = portableBoardCrdtToBoard(boardToPortableBoardCrdt(original, "m1"));
		const cardsById = new Map(projected.columns.flatMap((column) => column.cards).map((entry) => [entry.id, entry]));
		// The field survives the round-trip equivalently…
		expect(cardsById.get("with-chain")?.focusChain).toEqual(focusChain);
		// …and a card with no focusChain round-trips WITHOUT the key appearing (the additive-optional invariant).
		const noChain = cardsById.get("no-chain");
		expect(noChain).toBeDefined();
		expect(noChain && "focusChain" in noChain).toBe(false);
	});

	it("drops dependencies whose endpoints were deleted", () => {
		const base = boardToPortableBoardCrdt(
			board(
				[
					{ columnId: "planning", card: card("a") },
					{ columnId: "planning", card: card("b") },
				],
				[["b", "a"]],
			),
			"m1",
		);
		const projected = portableBoardCrdtToBoard(markCardDeleted(base, "a", "m1", 6));
		expect(projected.dependencies).toEqual([]);
	});
});

describe("M2: streams + satisfiedDependencies in the CRDT (2026-08-18)", () => {
	const stream = (id: string, updatedAt: number, title = id) => ({
		id,
		title,
		source: "manual" as const,
		createdAt: 1,
		updatedAt,
	});
	const satisfied = (from: string, to: string, releasedAt: number) => ({
		id: `${from}->${to}`,
		fromTaskId: from,
		toTaskId: to,
		createdAt: 1,
		releasedAt,
		releasedBy: "completed" as const,
	});

	it("concurrent retirements on DIFFERENT edges both survive the merge (grow-only union)", () => {
		const base = board([{ columnId: "backlog", card: card("a") }]);
		const replicaA = boardToPortableBoardCrdt({ ...base, satisfiedDependencies: [satisfied("a", "b", 10)] }, "A");
		const replicaB = boardToPortableBoardCrdt({ ...base, satisfiedDependencies: [satisfied("c", "d", 11)] }, "B");
		const merged = portableBoardCrdtToBoard(mergePortableBoardCrdt(replicaA, replicaB));
		expect((merged.satisfiedDependencies ?? []).map((entry) => entry.id).sort()).toEqual(["a->b", "c->d"]);
	});

	it("concurrent stream rename resolves LWW by stamp — the newer title wins on both merge orders", () => {
		const base = board([{ columnId: "backlog", card: card("a") }]);
		const replicaA = boardToPortableBoardCrdt({ ...base, streams: [stream("s1", 5, "old name")] }, "A");
		const replicaB = boardToPortableBoardCrdt({ ...base, streams: [stream("s1", 9, "new name")] }, "B");
		for (const [left, right] of [
			[replicaA, replicaB],
			[replicaB, replicaA],
		] as const) {
			const merged = portableBoardCrdtToBoard(mergePortableBoardCrdt(left, right));
			expect(merged.streams?.[0]?.title).toBe("new name");
		}
	});

	it("a v1 payload WITHOUT the new fields merges cleanly against one with them", () => {
		const base = board([{ columnId: "backlog", card: card("a") }]);
		const legacy = boardToPortableBoardCrdt(base, "A"); // no streams/satisfied fields at all
		const modern = boardToPortableBoardCrdt(
			{ ...base, streams: [stream("s1", 3)], satisfiedDependencies: [satisfied("a", "b", 4)] },
			"B",
		);
		const merged = portableBoardCrdtToBoard(mergePortableBoardCrdt(legacy, modern));
		expect(merged.streams).toHaveLength(1);
		expect(merged.satisfiedDependencies).toHaveLength(1);
		const mergedEmpty = portableBoardCrdtToBoard(mergePortableBoardCrdt(legacy, legacy));
		expect(mergedEmpty.streams).toBeUndefined();
		expect(mergedEmpty.satisfiedDependencies).toBeUndefined();
	});
});

describe("migratePortableBoardCrdt", () => {
	const currentCrdt = boardToPortableBoardCrdt(board([{ columnId: "backlog", card: card("a") }]), "m1");

	it("returns a well-formed current-version CRDT unchanged in shape", () => {
		const migrated = migratePortableBoardCrdt(JSON.parse(JSON.stringify(currentCrdt)));
		expect(migrated?.schemaVersion).toBe(CURRENT_PORTABLE_BOARD_SCHEMA_VERSION);
		expect(Object.keys(migrated?.cards ?? {})).toContain("a");
	});

	it("rejects malformed input and a missing cards map", () => {
		expect(migratePortableBoardCrdt(null)).toBeNull();
		expect(migratePortableBoardCrdt([])).toBeNull();
		expect(migratePortableBoardCrdt({ schemaVersion: CURRENT_PORTABLE_BOARD_SCHEMA_VERSION })).toBeNull();
	});

	it("refuses a CRDT written by a newer schema this build cannot downgrade", () => {
		expect(
			migratePortableBoardCrdt({ schemaVersion: CURRENT_PORTABLE_BOARD_SCHEMA_VERSION + 1, cards: {} }),
		).toBeNull();
	});

	it("returns null when an older version has no registered migration path forward", () => {
		// A legacy unversioned file (treated as version 0) with no migration registered.
		expect(migratePortableBoardCrdt({ cards: {} })).toBeNull();
	});

	it("applies the forward migration chain up to the current version", () => {
		// Simulate a legacy version-0 file plus an injected 0->current migration to exercise the chain mechanism.
		const upgrade: PortableBoardCrdtMigration = (input) => ({
			...input,
			schemaVersion: CURRENT_PORTABLE_BOARD_SCHEMA_VERSION,
			cards: currentCrdt.cards,
			dependencies: currentCrdt.dependencies,
		});
		const migrated = migratePortableBoardCrdt({ cards: { legacy: {} } }, { 0: upgrade });
		expect(migrated?.schemaVersion).toBe(CURRENT_PORTABLE_BOARD_SCHEMA_VERSION);
		expect(Object.keys(migrated?.cards ?? {})).toContain("a");
	});

	it("rejects a migration that fails to advance the version", () => {
		const nonAdvancing: PortableBoardCrdtMigration = (input) => input;
		expect(migratePortableBoardCrdt({ schemaVersion: 0, cards: {} }, { 0: nonAdvancing })).toBeNull();
	});
});
