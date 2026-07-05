/**
 * §5.V — deterministic scorers per PROMPT FAMILY (pure core). An eval corpus grades a model's output objectively, no
 * LLM judge: the DECOMPOSITION family is scored on whether it produced a valid task DAG, the CODING family on whether
 * the tests pass, and the REVIEW family on how many seeded defects it caught. Deterministic ⇒ reproducible fitness
 * signals for the §5.AB store. Pure + total.
 */

// ── Decomposition family: valid task DAG ────────────────────────────────────────────────────────────────────────────

export interface TaskGraph {
	nodes: readonly string[];
	edges: readonly { from: string; to: string }[];
}

/**
 * Score a decomposition on whether it is a VALID task DAG: every edge references known nodes AND the graph is acyclic.
 * Returns 1 (valid DAG) or 0 (dangling edge or a cycle). Cycle detection via Kahn's algorithm (indegree elimination).
 */
export function scoreValidDag(graph: TaskGraph): number {
	const nodes = new Set(graph.nodes);
	const indegree = new Map<string, number>(graph.nodes.map((node) => [node, 0]));
	const adjacency = new Map<string, string[]>(graph.nodes.map((node) => [node, []]));

	for (const edge of graph.edges) {
		if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
			return 0; // an edge references a node that doesn't exist
		}
		adjacency.get(edge.from)?.push(edge.to);
		indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
	}

	// Kahn: repeatedly remove a zero-indegree node; if all nodes are removed, the graph is acyclic.
	// Seed from the DISTINCT node set (not the raw array) so a duplicate node id isn't enqueued/counted twice.
	const queue = [...nodes].filter((node) => (indegree.get(node) ?? 0) === 0);
	let removed = 0;
	while (queue.length > 0) {
		const node = queue.shift();
		if (node === undefined) {
			break;
		}
		removed += 1;
		for (const next of adjacency.get(node) ?? []) {
			const remaining = (indegree.get(next) ?? 0) - 1;
			indegree.set(next, remaining);
			if (remaining === 0) {
				queue.push(next);
			}
		}
	}
	return removed === nodes.size ? 1 : 0; // fewer distinct nodes removed ⇒ a cycle remains
}

// ── Coding family: passing code ─────────────────────────────────────────────────────────────────────────────────────

/** Score a coding attempt on its test pass fraction in [0,1] (0 total tests ⇒ 0 — nothing was proven to pass). */
export function scorePassingCode(passed: number, total: number): number {
	// Non-finite (NaN / ±Infinity) coerces to 0 so the totalTests===0 guard actually catches garbage (Math.max(0,NaN)=NaN).
	const totalTests = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
	if (totalTests === 0) {
		return 0;
	}
	const passedTests = Number.isFinite(passed) ? Math.min(totalTests, Math.max(0, Math.trunc(passed))) : 0;
	return passedTests / totalTests;
}

// ── Review family: defect-catching ──────────────────────────────────────────────────────────────────────────────────

/**
 * Score a review on the fraction of SEEDED defects it caught (recall). `caught` is the set the review flagged; only
 * those that are actually seeded defects count. No seeded defects ⇒ 1 (a clean review of clean code is correct).
 */
export function scoreDefectCatchingReview(caught: readonly string[], seededDefects: readonly string[]): number {
	if (seededDefects.length === 0) {
		return 1;
	}
	const flagged = new Set(caught);
	const found = seededDefects.filter((defect) => flagged.has(defect)).length;
	return found / seededDefects.length;
}
