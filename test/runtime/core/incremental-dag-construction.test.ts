import { describe, expect, it } from "vitest";
import {
	applyDagOp,
	applyDagOps,
	countRejectedOps,
	type DagOp,
	dagConstructionToGraph,
	emptyDagConstruction,
} from "../../../src/core/incremental-dag-construction";
import { scoreValidDag } from "../../../src/core/prompt-family-scorers";

/** Declare a chain of nodes then whatever edges follow — convenience for building fixtures. */
function build(ops: DagOp[]) {
	return applyDagOps(emptyDagConstruction(), ops);
}

describe("applyDagOp — node declaration", () => {
	it("accepts a fresh node and carries the label", () => {
		const { state, result } = applyDagOp(emptyDagConstruction(), { op: "add_node", id: "a", label: "Task A" });
		expect(result.ok).toBe(true);
		expect(state.nodes).toEqual([{ id: "a", label: "Task A" }]);
	});

	it("rejects an empty / whitespace id, state unchanged", () => {
		const start = emptyDagConstruction();
		const { state, result } = applyDagOp(start, { op: "add_node", id: "   " });
		expect(result).toMatchObject({ ok: false, reason: "empty_id" });
		expect(state).toBe(start);
	});

	it("rejects a duplicate node id", () => {
		const { state } = build([{ op: "add_node", id: "a" }]);
		const { result } = applyDagOp(state, { op: "add_node", id: "a" });
		expect(result).toMatchObject({ ok: false, reason: "duplicate_node" });
	});
});

describe("applyDagOp — edge validation (the reference + acyclicity checks)", () => {
	const twoNodes = build([
		{ op: "add_node", id: "a" },
		{ op: "add_node", id: "b" },
	]).state;

	it("accepts an edge between two declared nodes", () => {
		const { state, result } = applyDagOp(twoNodes, { op: "add_edge", from: "a", to: "b" });
		expect(result.ok).toBe(true);
		expect(state.edges).toEqual([{ from: "a", to: "b" }]);
	});

	it("rejects a dangling edge (unknown_from / unknown_to)", () => {
		expect(applyDagOp(twoNodes, { op: "add_edge", from: "z", to: "b" }).result).toMatchObject({
			ok: false,
			reason: "unknown_from",
		});
		expect(applyDagOp(twoNodes, { op: "add_edge", from: "a", to: "z" }).result).toMatchObject({
			ok: false,
			reason: "unknown_to",
		});
	});

	it("rejects a self-loop", () => {
		expect(applyDagOp(twoNodes, { op: "add_edge", from: "a", to: "a" }).result).toMatchObject({
			ok: false,
			reason: "self_loop",
		});
	});

	it("rejects a duplicate edge", () => {
		const once = applyDagOp(twoNodes, { op: "add_edge", from: "a", to: "b" }).state;
		expect(applyDagOp(once, { op: "add_edge", from: "a", to: "b" }).result).toMatchObject({
			ok: false,
			reason: "duplicate_edge",
		});
	});

	it("rejects the direct back-edge that would create a 2-cycle", () => {
		const withEdge = applyDagOp(twoNodes, { op: "add_edge", from: "a", to: "b" }).state;
		const { state, result } = applyDagOp(withEdge, { op: "add_edge", from: "b", to: "a" });
		expect(result).toMatchObject({ ok: false, reason: "would_create_cycle" });
		expect(state.edges).toEqual([{ from: "a", to: "b" }]); // unchanged
	});

	it("rejects a TRANSITIVE cycle (a→b→c, then c→a)", () => {
		const chain = build([
			{ op: "add_node", id: "a" },
			{ op: "add_node", id: "b" },
			{ op: "add_node", id: "c" },
			{ op: "add_edge", from: "a", to: "b" },
			{ op: "add_edge", from: "b", to: "c" },
		]).state;
		expect(applyDagOp(chain, { op: "add_edge", from: "c", to: "a" }).result).toMatchObject({
			ok: false,
			reason: "would_create_cycle",
		});
		// but a fan-in that does NOT cycle is fine (a→b, a→c already; add a diamond b→c is acyclic)
		expect(applyDagOp(chain, { op: "add_edge", from: "a", to: "c" }).result.ok).toBe(true);
	});

	it("every reject carries a non-empty model-facing message", () => {
		const r = applyDagOp(twoNodes, { op: "add_edge", from: "a", to: "a" }).result;
		if (r.ok) throw new Error("expected reject");
		expect(r.message.length).toBeGreaterThan(0);
	});
});

describe("valid-by-construction invariant", () => {
	// Any sequence of ops — including ones that ATTEMPT cycles/dangling edges — yields a valid DAG.
	const sequences: DagOp[][] = [
		[],
		[{ op: "add_node", id: "solo" }],
		[
			{ op: "add_node", id: "a" },
			{ op: "add_node", id: "b" },
			{ op: "add_node", id: "c" },
			{ op: "add_edge", from: "a", to: "b" },
			{ op: "add_edge", from: "b", to: "c" },
			{ op: "add_edge", from: "c", to: "a" }, // rejected — cycle
			{ op: "add_edge", from: "a", to: "z" }, // rejected — dangling
			{ op: "add_edge", from: "a", to: "c" }, // accepted — diamond
		],
		[
			{ op: "add_node", id: "x" },
			{ op: "add_edge", from: "x", to: "x" }, // rejected — self loop
			{ op: "add_node", id: "x" }, // rejected — dup
			{ op: "add_node", id: "y" },
			{ op: "add_edge", from: "y", to: "x" },
		],
	];

	it("produces a valid DAG for every sequence", () => {
		for (const ops of sequences) {
			const { state } = build(ops);
			expect(scoreValidDag(dagConstructionToGraph(state))).toBe(1);
		}
	});

	it("only accepted ops mutate the graph (rejected cycle/dangling never land)", () => {
		const { state, trace } = build(sequences[2]);
		expect(countRejectedOps(trace)).toBe(2); // the cycle + the dangling edge
		const graph = dagConstructionToGraph(state);
		expect(graph.nodes).toEqual(["a", "b", "c"]);
		expect(graph.edges).toEqual([
			{ from: "a", to: "b" },
			{ from: "b", to: "c" },
			{ from: "a", to: "c" },
		]);
	});
});

describe("dagConstructionToGraph + traces", () => {
	it("projects nodes (id-only) and edges to the scorer shape", () => {
		const { state } = build([
			{ op: "add_node", id: "a", label: "Alpha" },
			{ op: "add_node", id: "b" },
			{ op: "add_edge", from: "a", to: "b" },
		]);
		expect(dagConstructionToGraph(state)).toEqual({ nodes: ["a", "b"], edges: [{ from: "a", to: "b" }] });
	});

	it("trace records each op's result in order", () => {
		const { trace } = build([
			{ op: "add_node", id: "a" },
			{ op: "add_edge", from: "a", to: "a" },
		]);
		expect(trace.map((t) => t.result.ok)).toEqual([true, false]);
	});
});
