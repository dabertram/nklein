import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeBoardData } from "../core/api-contract";

/**
 * CRDT for portable, cross-machine board state (specsheet §14.2; conflict model: CRDT merge).
 *
 * Two machines may advance the same committed board concurrently. To merge without a central authority, the
 * durable board is modeled as a state-based CRDT: a per-field **last-writer-wins register** map per card
 * (placement is just another field), with a **tombstone** register for deletion, and a presence register per
 * dependency edge. `mergePortableBoardCrdt` is commutative, associative, and idempotent, so any order of
 * merges across machines converges to the same board.
 *
 * The logical clock is the card's `updatedAt` (monotonic per edit) tie-broken by `replicaId`, so a more
 * recently edited field wins and concurrent edits resolve deterministically. The committed CRDT — not a
 * re-derived snapshot — is the source of truth, so deletions survive as tombstones.
 *
 * Note (local-only invariant, §14.2): machine-specific assignments such as `clineSettings` are carried as
 * fields but MUST be re-resolved against the importing machine's local models on load; this module preserves
 * them, it does not endorse them.
 */

export interface CrdtStamp {
	/** Monotonic logical counter for the field (board uses `updatedAt`/`createdAt`). */
	counter: number;
	/** Originating replica id, used to break ties deterministically. */
	replicaId: string;
}

export interface CrdtRegister<T> {
	value: T;
	stamp: CrdtStamp;
}

export interface CrdtCard {
	id: string;
	fields: Record<string, CrdtRegister<unknown>>;
	deleted: CrdtRegister<boolean>;
}

export interface CrdtDependency {
	fromTaskId: string;
	toTaskId: string;
	present: CrdtRegister<boolean>;
	createdAt: number;
}

export interface PortableBoardCrdt {
	schemaVersion: 1;
	cards: Record<string, CrdtCard>;
	/** Keyed by `${fromTaskId}->${toTaskId}`. */
	dependencies: Record<string, CrdtDependency>;
}

/** The card field that records column placement. Prefixed to avoid colliding with real card properties. */
const COLUMN_FIELD = "__column";

export function compareStamp(a: CrdtStamp, b: CrdtStamp): number {
	if (a.counter !== b.counter) {
		return a.counter < b.counter ? -1 : 1;
	}
	if (a.replicaId === b.replicaId) {
		return 0;
	}
	return a.replicaId < b.replicaId ? -1 : 1;
}

function pickRegister<T>(a: CrdtRegister<T>, b: CrdtRegister<T>): CrdtRegister<T> {
	return compareStamp(a.stamp, b.stamp) >= 0 ? a : b;
}

function dependencyKey(fromTaskId: string, toTaskId: string): string {
	return `${fromTaskId}->${toTaskId}`;
}

function mergeCard(a: CrdtCard, b: CrdtCard): CrdtCard {
	const fields: Record<string, CrdtRegister<unknown>> = { ...a.fields };
	for (const [key, register] of Object.entries(b.fields)) {
		const existing = fields[key];
		fields[key] = existing ? pickRegister(existing, register) : register;
	}
	return {
		id: a.id,
		fields,
		deleted: pickRegister(a.deleted, b.deleted),
	};
}

export function mergePortableBoardCrdt(a: PortableBoardCrdt, b: PortableBoardCrdt): PortableBoardCrdt {
	const cards: Record<string, CrdtCard> = { ...a.cards };
	for (const [id, card] of Object.entries(b.cards)) {
		const existing = cards[id];
		cards[id] = existing ? mergeCard(existing, card) : card;
	}
	const dependencies: Record<string, CrdtDependency> = { ...a.dependencies };
	for (const [key, dependency] of Object.entries(b.dependencies)) {
		const existing = dependencies[key];
		dependencies[key] = existing
			? {
					fromTaskId: existing.fromTaskId,
					toTaskId: existing.toTaskId,
					createdAt: Math.min(existing.createdAt, dependency.createdAt),
					present: pickRegister(existing.present, dependency.present),
				}
			: dependency;
	}
	return { schemaVersion: 1, cards, dependencies };
}

/** Marks a card deleted with a stamp strictly newer than any present field, so the tombstone wins on merge. */
export function markCardDeleted(crdt: PortableBoardCrdt, cardId: string, replicaId: string): PortableBoardCrdt {
	const card = crdt.cards[cardId];
	if (!card) {
		return crdt;
	}
	const maxCounter = Math.max(
		card.deleted.stamp.counter,
		...Object.values(card.fields).map((register) => register.stamp.counter),
	);
	return {
		...crdt,
		cards: {
			...crdt.cards,
			[cardId]: { ...card, deleted: { value: true, stamp: { counter: maxCounter + 1, replicaId } } },
		},
	};
}

export function boardToPortableBoardCrdt(board: RuntimeBoardData, replicaId: string): PortableBoardCrdt {
	const cards: Record<string, CrdtCard> = {};
	for (const column of board.columns) {
		for (const card of column.cards) {
			const stamp: CrdtStamp = { counter: card.updatedAt, replicaId };
			const fields: Record<string, CrdtRegister<unknown>> = {
				[COLUMN_FIELD]: { value: column.id, stamp },
			};
			for (const [key, value] of Object.entries(card)) {
				if (key === "id") {
					continue;
				}
				fields[key] = { value, stamp };
			}
			cards[card.id] = { id: card.id, fields, deleted: { value: false, stamp } };
		}
	}
	const dependencies: Record<string, CrdtDependency> = {};
	for (const dependency of board.dependencies) {
		dependencies[dependencyKey(dependency.fromTaskId, dependency.toTaskId)] = {
			fromTaskId: dependency.fromTaskId,
			toTaskId: dependency.toTaskId,
			createdAt: dependency.createdAt,
			present: { value: true, stamp: { counter: dependency.createdAt, replicaId } },
		};
	}
	return { schemaVersion: 1, cards, dependencies };
}

const DEFAULT_COLUMN_ORDER: RuntimeBoardColumnId[] = [
	"backlog",
	"planning",
	"in_progress",
	"review",
	"completed",
	"trash",
];

const COLUMN_TITLES: Record<RuntimeBoardColumnId, string> = {
	backlog: "Backlog",
	planning: "Planning",
	in_progress: "In Progress",
	review: "Review",
	completed: "Completed",
	trash: "Trash",
};

function projectCard(card: CrdtCard): { columnId: RuntimeBoardColumnId; card: RuntimeBoardCard } | null {
	if (card.deleted.value) {
		return null;
	}
	const columnRegister = card.fields[COLUMN_FIELD];
	const columnId = (columnRegister?.value as RuntimeBoardColumnId) ?? "backlog";
	const projected: Record<string, unknown> = { id: card.id };
	for (const [key, register] of Object.entries(card.fields)) {
		if (key === COLUMN_FIELD) {
			continue;
		}
		projected[key] = register.value;
	}
	return { columnId, card: projected as unknown as RuntimeBoardCard };
}

export function portableBoardCrdtToBoard(
	crdt: PortableBoardCrdt,
	options: { columnOrder?: RuntimeBoardColumnId[] } = {},
): RuntimeBoardData {
	const columnOrder = options.columnOrder ?? DEFAULT_COLUMN_ORDER;
	const cardsByColumn = new Map<RuntimeBoardColumnId, RuntimeBoardCard[]>();
	for (const columnId of columnOrder) {
		cardsByColumn.set(columnId, []);
	}
	for (const card of Object.values(crdt.cards)) {
		const projected = projectCard(card);
		if (!projected) {
			continue;
		}
		const bucket = cardsByColumn.get(projected.columnId) ?? cardsByColumn.get("backlog");
		bucket?.push(projected.card);
	}
	for (const bucket of cardsByColumn.values()) {
		bucket.sort((a, b) => a.createdAt - b.createdAt);
	}
	const presentCardIds = new Set(
		Object.values(crdt.cards)
			.filter((card) => !card.deleted.value)
			.map((card) => card.id),
	);
	const dependencies = Object.values(crdt.dependencies)
		.filter(
			(dependency) =>
				dependency.present.value &&
				presentCardIds.has(dependency.fromTaskId) &&
				presentCardIds.has(dependency.toTaskId),
		)
		.map((dependency) => ({
			id: dependencyKey(dependency.fromTaskId, dependency.toTaskId),
			fromTaskId: dependency.fromTaskId,
			toTaskId: dependency.toTaskId,
			createdAt: dependency.createdAt,
		}))
		.sort((a, b) => a.createdAt - b.createdAt);

	return {
		columns: columnOrder.map((columnId) => ({
			id: columnId,
			title: COLUMN_TITLES[columnId],
			cards: cardsByColumn.get(columnId) ?? [],
		})),
		dependencies,
	};
}
