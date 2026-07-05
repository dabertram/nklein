/**
 * §5.AV — INCREMENTAL, VALIDATED graph construction: make an invalid decomposition (nearly) impossible to *emit*.
 *
 * The §5.AV bet is to move decomposition validity UPSTREAM — instead of a model emitting a whole task graph in one shot
 * and us repairing it (`breakDependencyCycles`, the last-resort net), the model builds the graph through a SEQUENCE of
 * validated operations (`add_node`, `add_edge`), each checked against the partial graph and REJECTED with a reason if it
 * would break validity. This is candidate design direction (1) from the §5.AV mandate — the strongest "can't emit an
 * invalid graph" story: the accepted graph is **valid-by-construction** (always acyclic, every edge references declared
 * nodes), so there is nothing to repair.
 *
 * The invariant, precisely: after ANY sequence of operations, `dagConstructionToGraph(state)` is a valid DAG
 * (`scoreValidDag === 1`). Each `add_edge(from → to)` is accepted only if (a) both endpoints are already declared (the
 * REFERENCE check — no dangling edge), (b) it is not a self-loop, (c) it is not a duplicate, and (d) it does not close a
 * cycle (the ACYCLICITY check — rejected iff `from` is already reachable from `to`, which would make `to → … → from → to`
 * a loop). A rejected op leaves the state untouched and returns a model-facing `message` explaining WHY — the protocol's
 * whole point is that the runtime feeds that reason back so the model corrects the single bad edge instead of being
 * bounced to redo the entire graph (weak local models spiral when bounced — see `deriveOpenQuestionDefaults`).
 *
 * Deliberately PURE + total: a state machine over plain operations, no I/O, no model calls. The runtime wiring (exposing
 * `add_task`/`add_dependency` as tools whose handlers call {@link applyDagOp} and relay the reject message) is a separate
 * step; this is the substrate + the guarantee, unit-testable in isolation. Composes with `prompt-family-scorers`'
 * {@link TaskGraph} (the scorer's shape) so a constructed graph drops straight into the §5.AB eval + the existing
 * validity checks. Repair stays only as the net for the one-shot path; where this protocol is used, repair is a no-op.
 */

import type { TaskGraph } from "./prompt-family-scorers.js";

/** A declared node: a stable id plus an optional human label (the task title). */
export interface DagConstructionNode {
	id: string;
	label?: string;
}

/** The accumulating partial graph. Always valid-by-construction: acyclic, every edge between declared nodes. */
export interface DagConstruction {
	readonly nodes: readonly DagConstructionNode[];
	readonly edges: readonly { from: string; to: string }[];
}

/** One construction operation the model emits (mapped from an `add_task` / `add_dependency` tool call). */
export type DagOp = { op: "add_node"; id: string; label?: string } | { op: "add_edge"; from: string; to: string };

/** Why an operation was rejected — a stable code the runtime maps to a model-facing correction hint. */
export type DagRejectReason =
	| "empty_id"
	| "duplicate_node"
	| "unknown_from"
	| "unknown_to"
	| "self_loop"
	| "duplicate_edge"
	| "would_create_cycle";

/** The outcome of applying one op: accepted, or rejected with a reason + a message to relay to the model. */
export type DagOpResult = { ok: true } | { ok: false; reason: DagRejectReason; message: string };

/** An empty construction — the starting state. */
export function emptyDagConstruction(): DagConstruction {
	return { nodes: [], edges: [] };
}

function hasNode(state: DagConstruction, id: string): boolean {
	return state.nodes.some((node) => node.id === id);
}

/**
 * Is `target` reachable from `start` by following edges (`from → to`) in the current graph? Used to reject an edge
 * `from → to` when `from` is already reachable from `to` (adding it would close a cycle). Iterative DFS, cycle-safe via a
 * visited set (the current graph is acyclic by invariant, but the guard keeps it total regardless).
 */
function isReachable(state: DagConstruction, start: string, target: string): boolean {
	if (start === target) {
		return true;
	}
	const adjacency = new Map<string, string[]>();
	for (const edge of state.edges) {
		const list = adjacency.get(edge.from);
		if (list) {
			list.push(edge.to);
		} else {
			adjacency.set(edge.from, [edge.to]);
		}
	}
	const stack = [...(adjacency.get(start) ?? [])];
	const visited = new Set<string>([start]);
	while (stack.length > 0) {
		const node = stack.pop();
		if (node === undefined || visited.has(node)) {
			continue;
		}
		if (node === target) {
			return true;
		}
		visited.add(node);
		for (const next of adjacency.get(node) ?? []) {
			stack.push(next);
		}
	}
	return false;
}

const REJECT_MESSAGES: Record<DagRejectReason, string> = {
	empty_id: "a task id must be a non-empty string",
	duplicate_node: "that task id is already declared — use a different id",
	unknown_from: "the source task is not declared yet — add it before adding a dependency from it",
	unknown_to: "the target task is not declared yet — add it before adding a dependency to it",
	self_loop: "a task cannot depend on itself",
	duplicate_edge: "that dependency is already declared",
	would_create_cycle: "that dependency would create a cycle — reverse it or restructure so the graph stays acyclic",
};

function reject(reason: DagRejectReason): DagOpResult {
	return { ok: false, reason, message: REJECT_MESSAGES[reason] };
}

/**
 * Apply ONE operation to the construction (pure). Returns the next state (UNCHANGED when the op is rejected) plus the
 * result. The state stays valid-by-construction: no op that would introduce a dangling edge, a self-loop, a duplicate, or
 * a cycle is ever applied.
 */
export function applyDagOp(state: DagConstruction, op: DagOp): { state: DagConstruction; result: DagOpResult } {
	if (op.op === "add_node") {
		const id = op.id.trim();
		if (id.length === 0) {
			return { state, result: reject("empty_id") };
		}
		if (hasNode(state, id)) {
			return { state, result: reject("duplicate_node") };
		}
		const node: DagConstructionNode = op.label === undefined ? { id } : { id, label: op.label };
		return { state: { nodes: [...state.nodes, node], edges: state.edges }, result: { ok: true } };
	}
	// add_edge
	const from = op.from.trim();
	const to = op.to.trim();
	if (from === to) {
		return { state, result: reject("self_loop") };
	}
	if (!hasNode(state, from)) {
		return { state, result: reject("unknown_from") };
	}
	if (!hasNode(state, to)) {
		return { state, result: reject("unknown_to") };
	}
	if (state.edges.some((edge) => edge.from === from && edge.to === to)) {
		return { state, result: reject("duplicate_edge") };
	}
	// Adding from → to closes a cycle iff `from` is already reachable from `to` (to → … → from → to).
	if (isReachable(state, to, from)) {
		return { state, result: reject("would_create_cycle") };
	}
	return { state: { nodes: state.nodes, edges: [...state.edges, { from, to }] }, result: { ok: true } };
}

/** The per-op record of applying a sequence: the op, whether it was accepted, and (if not) the reason + message. */
export interface DagOpTrace {
	op: DagOp;
	result: DagOpResult;
}

/** Fold a sequence of operations, returning the final valid-by-construction state + the per-op trace (for feedback). */
export function applyDagOps(
	state: DagConstruction,
	ops: readonly DagOp[],
): { state: DagConstruction; trace: DagOpTrace[] } {
	let current = state;
	const trace: DagOpTrace[] = [];
	for (const op of ops) {
		const { state: next, result } = applyDagOp(current, op);
		current = next;
		trace.push({ op, result });
	}
	return { state: current, trace };
}

/** Project the construction to the scorer's {@link TaskGraph} shape (drops labels; edges/nodes carry through). */
export function dagConstructionToGraph(state: DagConstruction): TaskGraph {
	return {
		nodes: state.nodes.map((node) => node.id),
		edges: state.edges.map((edge) => ({ from: edge.from, to: edge.to })),
	};
}

/** How many of a trace's operations were rejected (a signal the runtime can surface / the model can be nudged on). */
export function countRejectedOps(trace: readonly DagOpTrace[]): number {
	return trace.filter((entry) => !entry.result.ok).length;
}
