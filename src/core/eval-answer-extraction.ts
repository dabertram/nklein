/**
 * Eval-answer EXTRACTION (§5.AB eval harness, todo 5913) — the pure bridge between a model's RAW text output and the
 * structured {@link EvalAnswer} the deterministic scorers (`scoreEvalAnswer`) consume.
 *
 * The corpus (`eval-prompt-corpus.ts`) defines prompts + answer keys, and `scoreEvalAnswer(prompt, answer)` grades a
 * STRUCTURED answer. But a live sweep (verify-all-models) gets a model's freeform text, not a structured answer — so it
 * needs to PARSE that text into the answer shape first. This module owns that parse for the `decompose` family (the
 * architect eval), which is fully text-derivable: a decomposition is a JSON object of tasks/steps with dependency edges,
 * and `scoreValidDag` grades the resulting graph's structural validity (acyclic + edges reference real nodes). No code
 * execution is needed (unlike `implement`, which must run tests) and no fuzzy alias mapping (unlike `review`, which maps
 * free-text findings onto canonical defect ids — that needs per-defect alias data the corpus doesn't yet carry).
 *
 * Pure + dependency-free (core must not import the nklein-agent JSON repairer), so it carries a small self-contained
 * lenient JSON extractor: try a direct parse, strip a ```json code fence, else lift the first balanced {...}/[...] span
 * out of surrounding prose (weak models routinely wrap the JSON in commentary).
 */

import type { EvalAnswer } from "./eval-prompt-corpus.js";
import type { TaskGraph } from "./prompt-family-scorers.js";

/**
 * Best-effort parse of a JSON value out of a model's freeform reply. Pure. Order: (1) direct `JSON.parse`; (2) strip a
 * ```/```json code fence and retry; (3) lift the FIRST balanced object/array span out of the surrounding prose. Returns
 * `null` when nothing parses.
 */
export function extractJsonFromModelText(raw: string): unknown {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const direct = tryParse(trimmed);
	if (direct !== undefined) {
		return direct;
	}
	// Strip a fenced block ```json ... ``` (or bare ```), keep the inner text.
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence?.[1]) {
		const inner = tryParse(fence[1].trim());
		if (inner !== undefined) {
			return inner;
		}
	}
	// Lift the first balanced {...} or [...] span.
	const span = firstBalancedSpan(trimmed);
	if (span !== null) {
		const parsed = tryParse(span);
		if (parsed !== undefined) {
			return parsed;
		}
	}
	return null;
}

function tryParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** Return the first balanced `{...}` or `[...]` substring (string-literal aware), or null if none is balanced. */
function firstBalancedSpan(text: string): string | null {
	const startIdx = text.search(/[{[]/);
	if (startIdx < 0) {
		return null;
	}
	const open = text[startIdx];
	const close = open === "{" ? "}" : "]";
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = startIdx; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === open) {
			depth++;
		} else if (ch === close) {
			depth--;
			if (depth === 0) {
				return text.slice(startIdx, i + 1);
			}
		}
	}
	return null;
}

/** Read a string field from a record under any of the candidate keys; returns "" if none is a non-empty string. */
function stringField(record: Record<string, unknown>, keys: readonly string[]): string {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return "";
}

/** Read a string-array field under any of the candidate keys (tolerating a single string); [] otherwise. */
function stringArrayField(record: Record<string, unknown>, keys: readonly string[]): string[] {
	for (const key of keys) {
		const value = record[key];
		if (Array.isArray(value)) {
			return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
		}
		if (typeof value === "string" && value.trim().length > 0) {
			return [value.trim()];
		}
	}
	return [];
}

/**
 * Extract a {@link TaskGraph} (`{nodes, edges}`) from a model's raw decomposition output. Pure. Accepts the common weak-model
 * shapes: a top-level `{tasks:[…]}` or `{steps:[…]}` object, or a bare array of task objects. Each task's id comes from
 * `id`/`taskId`/`slug` (falling back to `task-<index>`); its dependency ids from `dependsOn`/`deps`/`dependencies`. An
 * edge `dep → task` is emitted only when `dep` is itself a known node (a dangling dep would otherwise force the score to 0
 * for a decomposition that is really just under-specified — we drop the unknown edge and let the DAG structure speak).
 * Returns `null` when no task list can be found.
 */
export function extractDecomposeGraph(raw: string): TaskGraph | null {
	const parsed = extractJsonFromModelText(raw);
	if (parsed === null || typeof parsed !== "object") {
		return null;
	}
	const container = parsed as Record<string, unknown>;
	const list: unknown = Array.isArray(parsed)
		? parsed
		: Array.isArray(container.tasks)
			? container.tasks
			: Array.isArray(container.steps)
				? container.steps
				: null;
	if (!Array.isArray(list)) {
		return null;
	}

	const nodes: string[] = [];
	const rawDeps: Array<{ task: string; deps: string[] }> = [];
	list.forEach((entry, index) => {
		if (typeof entry !== "object" || entry === null) {
			return;
		}
		const record = entry as Record<string, unknown>;
		// `title` is a last-resort id source: a titled-but-idless task uses its title as the node identity, so a
		// dependency that references the task by title still resolves to an edge.
		const id = stringField(record, ["id", "taskId", "slug", "name", "title"]) || `task-${index}`;
		nodes.push(id);
		rawDeps.push({ task: id, deps: stringArrayField(record, ["dependsOn", "deps", "dependencies", "after"]) });
	});
	if (nodes.length === 0) {
		return null;
	}

	const nodeSet = new Set(nodes);
	const edges: Array<{ from: string; to: string }> = [];
	for (const { task, deps } of rawDeps) {
		for (const dep of deps) {
			// Only emit an edge to a KNOWN node; a dangling dep id is dropped (see doc — under-specified ≠ invalid DAG).
			if (nodeSet.has(dep) && dep !== task) {
				edges.push({ from: dep, to: task });
			}
		}
	}
	return { nodes, edges };
}

/** Convenience: extract a decompose {@link EvalAnswer} (or null) ready for `scoreEvalAnswer`. */
export function extractDecomposeEvalAnswer(raw: string): EvalAnswer | null {
	const graph = extractDecomposeGraph(raw);
	return graph === null ? null : { family: "decompose", graph };
}
