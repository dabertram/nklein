/**
 * F2.36 (b) — dependencies BETWEEN open backlog items on the self board, from EXPLICIT declarations only. PURE core.
 *
 * ── WHY NOT FROM THE TEXT ──
 * Investigated 2026-09-08 and deliberately not built from mentions: 9 of the 15 open items reference another
 * item's id, but a MENTION is not a dependency — P25.3 and P23.5 cite each other, so inferring edges from
 * references produces a cycle on the very first pass. A wrong edge BLOCKS work, which is worse than the state it
 * would replace (everything hangs off the spine head). So an entry declares its prerequisites in its own words,
 * the shape (c) settled on for testability:
 *
 *     *(depends on: P15.3, F3.41)*
 *
 * ── THE GUARD ──
 * Every declaration goes through the board's own cycle guard (`wouldCreateDependencyCycle`, the rule the manual
 * and tool dependency-add paths already obey). A refused edge is REPORTED, never silently dropped; so is a
 * declaration naming an unknown item, or one naming an item that already shipped (satisfied, no edge needed).
 * Declared edges carry their own id prefix so a withdrawn declaration removes exactly its edge and nothing else.
 */
import type { RuntimeBoardData, RuntimeBoardDependency } from "./board-api-contract";
import { wouldCreateDependencyCycle } from "./task-board-mutations";

const DECLARATION = /\(depends on:\s*([^)]+)\)/giu;
const ITEM_ID = /^[A-Za-z0-9§.-]+$/u;
export const DECLARED_TODO_DEPENDENCY_ID_PREFIX = "self-declared:";

/** Every item id named by an explicit `*(depends on: …)*` declaration, in order, deduplicated. */
export function parseTodoCardDependencyDeclarations(text: string): string[] {
	const ids: string[] = [];
	for (const match of text.matchAll(DECLARATION)) {
		for (const raw of (match[1] ?? "").split(/[,\s]+/u)) {
			const id = raw
				.trim()
				.replace(/^\*+|\*+$/gu, "")
				.replace(/[.,;]+$/u, "");
			if (id && ITEM_ID.test(id) && !ids.includes(id)) {
				ids.push(id);
			}
		}
	}
	return ids;
}

export function declaredTodoDependencyId(dependent: string, prerequisite: string): string {
	return `${DECLARED_TODO_DEPENDENCY_ID_PREFIX}${dependent}->${prerequisite}`;
}

export interface DeclaredTodoDependencyItem {
	/** The board card id (`todo:<ITEM>`). */
	readonly cardId: string;
	/** The backlog item id as written in todo.md (`P15.5`). */
	readonly itemId: string;
	/** The entry's full text — the declaration may sit anywhere in it. */
	readonly text: string;
}

export interface DeclaredTodoDependencyInput {
	readonly board: RuntimeBoardData;
	readonly items: readonly DeclaredTodoDependencyItem[];
	/** True when the named item is in done.md — a dependency on shipped work is satisfied, not an edge. */
	readonly isShipped?: (itemId: string) => boolean;
	readonly nowMs: number;
}

export interface DeclaredTodoDependencyEdge {
	readonly dependent: string;
	readonly prerequisite: string;
}

export interface DeclaredTodoDependencyRefusal {
	readonly dependent: string;
	readonly declared: string;
	readonly reason: "unknown_item" | "self" | "would_create_cycle";
}

export interface DeclaredTodoDependencyPlan {
	readonly board: RuntimeBoardData;
	readonly added: readonly DeclaredTodoDependencyEdge[];
	readonly kept: readonly DeclaredTodoDependencyEdge[];
	/** Edges whose declaration was withdrawn from the entry — removed. */
	readonly removed: readonly DeclaredTodoDependencyEdge[];
	readonly refused: readonly DeclaredTodoDependencyRefusal[];
	readonly satisfied: readonly { readonly dependent: string; readonly declared: string }[];
	/** Cards with at least one accepted declared prerequisite (new or kept) — they hang off it, not the spine. */
	readonly dependentsWithEdges: ReadonlySet<string>;
}

export function applyDeclaredTodoDependencies(input: DeclaredTodoDependencyInput): DeclaredTodoDependencyPlan {
	const cardIdByItemId = new Map(input.items.map((item) => [item.itemId, item.cardId] as const));
	const wanted = new Map<string, DeclaredTodoDependencyEdge>();
	const refused: DeclaredTodoDependencyRefusal[] = [];
	const satisfied: { dependent: string; declared: string }[] = [];
	for (const item of input.items) {
		for (const declared of parseTodoCardDependencyDeclarations(item.text)) {
			if (declared === item.itemId) {
				refused.push({ dependent: item.cardId, declared, reason: "self" });
				continue;
			}
			const prerequisite = cardIdByItemId.get(declared);
			if (!prerequisite) {
				if (input.isShipped?.(declared)) {
					satisfied.push({ dependent: item.cardId, declared });
				} else {
					refused.push({ dependent: item.cardId, declared, reason: "unknown_item" });
				}
				continue;
			}
			wanted.set(declaredTodoDependencyId(item.cardId, prerequisite), { dependent: item.cardId, prerequisite });
		}
	}
	// Withdrawn declarations: only edges THIS mechanism created are its to remove.
	const removed: DeclaredTodoDependencyEdge[] = [];
	const kept: DeclaredTodoDependencyEdge[] = [];
	let dependencies: RuntimeBoardDependency[] = [];
	for (const edge of input.board.dependencies) {
		if (!edge.id.startsWith(DECLARED_TODO_DEPENDENCY_ID_PREFIX)) {
			dependencies.push(edge);
			continue;
		}
		if (wanted.has(edge.id)) {
			dependencies.push(edge);
			kept.push({ dependent: edge.fromTaskId, prerequisite: edge.toTaskId });
		} else {
			removed.push({ dependent: edge.fromTaskId, prerequisite: edge.toTaskId });
		}
	}
	const added: DeclaredTodoDependencyEdge[] = [];
	const existingIds = new Set(dependencies.map((edge) => edge.id));
	for (const [id, edge] of wanted) {
		if (existingIds.has(id)) {
			continue;
		}
		// The guard sees the edges accepted so far in this pass, so A→B then B→A refuses the second, not neither.
		if (wouldCreateDependencyCycle({ ...input.board, dependencies }, edge.dependent, edge.prerequisite)) {
			refused.push({
				dependent: edge.dependent,
				declared: edge.prerequisite.replace(/^todo:/u, ""),
				reason: "would_create_cycle",
			});
			continue;
		}
		dependencies = [
			...dependencies,
			{ id, fromTaskId: edge.dependent, toTaskId: edge.prerequisite, createdAt: input.nowMs },
		];
		existingIds.add(id);
		added.push(edge);
	}
	const dependentsWithEdges = new Set([...added, ...kept].map((edge) => edge.dependent));
	return {
		board: { ...input.board, dependencies },
		added,
		kept,
		removed,
		refused,
		satisfied,
		dependentsWithEdges,
	};
}
