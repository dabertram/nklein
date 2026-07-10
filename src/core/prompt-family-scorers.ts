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

// ── Tool-use family: BFCL-style function-calling (todo 6845c) ─────────────────────────────────────────────────────────

/** One tool call the model made (or `null` if it made none) and the call a correct answer requires. */
export interface ToolCallAttempt {
	name: string;
	args: Record<string, unknown>;
}

/**
 * Score a function-calling attempt BFCL-style. `expected === null` is an IRRELEVANCE probe: the offered tools cannot
 * satisfy the ask, so a correct model makes NO call (score 1) and a spurious call scores 0. Otherwise: 0 if no call
 * or the wrong function; else 0.5 for the right function name + 0.5 × the fraction of expected argument key/values
 * that match (loose string-equal, case-insensitive, whitespace-trimmed — a right call with a wrong arg still earns
 * partial credit). Extra args the model adds are not penalized (BFCL grades the required arguments).
 */
export function scoreToolUseCall(called: ToolCallAttempt | null, expected: ToolCallAttempt | null): number {
	if (expected === null) {
		return called === null ? 1 : 0;
	}
	if (called === null || called.name !== expected.name) {
		return 0;
	}
	const expectedKeys = Object.keys(expected.args);
	if (expectedKeys.length === 0) {
		return 1;
	}
	const matched = expectedKeys.filter((key) => looseArgEqual(called.args[key], expected.args[key])).length;
	return 0.5 + 0.5 * (matched / expectedKeys.length);
}

function looseArgEqual(actual: unknown, expected: unknown): boolean {
	if (typeof expected === "string" && typeof actual === "string") {
		return actual.trim().toLowerCase() === expected.trim().toLowerCase();
	}
	if (typeof expected === "number" && typeof actual === "number") {
		return actual === expected;
	}
	if (typeof expected === "boolean") {
		return actual === expected;
	}
	// Fallback: structural string compare (covers nested objects/arrays without a deep-equal dep).
	return JSON.stringify(actual) === JSON.stringify(expected);
}
