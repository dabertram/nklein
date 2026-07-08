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
 *
 * HARNESS-CALLER REQUIREMENT (live-found 2026-07-08): a reasoning/mtp model emits its answer to the `reasoning_content`
 * channel and returns an EMPTY `content` (observed: deepseek-r1-8b + qwopus3.5-9b-coder-mtp both returned empty `content`
 * on the architect/decompose cells, while qwen2.5-coder-14b returned a clean parseable decomposition in `content`). The
 * sweep MUST feed this extractor `content || reasoning_content` (and/or a larger token budget for reasoning models), else
 * it scores every reasoning model 0 for a purely mechanical channel reason, not a capability failure. RE-VERIFIED: reading
 * `reasoning_content` at a 2500-token budget recovered qwopus3.5-9b-coder-mtp from 0/3 → 2/3 (richer 10–11-edge DAGs) —
 * confirming the empty-content was mechanical. deepseek-r1-8b still landed 0/3 (its reasoning_content is pure
 * chain-of-thought that never emits the final JSON even at 2500 tokens — a genuine over-reasoning weakness for the direct
 * structured-decompose role, distinct from the mechanical channel issue; it needs the §5.AA reason-then-act / larger budget).
 *
 * CONVERGENCE (re-verified 2026-07-08): routing r1 through the §5.AN prescription for reasoning models —
 * `native_tool_call` (`tool_choice:"required"` with the decomposition as a tool), per `selectStructuredOutputStrategy` —
 * RECOVERED it from 0/3 → 2/3 AND faster (~5–6s vs ~24s), because the tool_calls channel forces the structured answer and
 * short-circuits the reasoning ramble that never emits JSON in prose. So the sweep should select the per-model structured
 * mechanism (this extractor then parses the tool-call arguments the same way): coder/instruct → content-channel JSON,
 * reasoning → native tool_call. The §5.AB eval and the §5.AN structured-output strategy are the same subsystem seen twice.
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

// ── Review family: map a model's free-text review onto canonical seeded-defect ids ────────────────────────────────────

/**
 * Per-defect matchers for the canonical defect ids seeded in the review corpus. A reviewer emits FREE TEXT ("the loop
 * reads one past the end…"), not the canonical id, so the harness maps findings onto ids (see `eval-prompt-corpus.ts`).
 * Each pattern is authored from the defect's real-world phrasings so a genuine finding is credited regardless of wording,
 * while an on-topic review of the SEEDED snippet keeps false positives low (we only ever test the defects a prompt
 * actually seeded — an un-seeded defect can't be "caught"). Add an entry when the corpus adds a new defect id; an id with
 * no explicit matcher falls back to a token-derived pattern (see {@link defectMatcher}).
 */
const DEFECT_MATCHERS: Readonly<Record<string, RegExp>> = {
	"off-by-one":
		/off[\s-]?by[\s-]?one|out[\s-]of[\s-]bounds|one past the|past the (end|array|last)|<=\s*[\w.]+\.length/i,
	"null-deref":
		/(null|undefined)[\s\w]{0,30}(deref|dereferenc|\.\w)|(deref|access)[\s\w]{0,20}(null|undefined)|can be (null|undefined)|possibly (null|undefined)|may be null/i,
	"unhandled-rejection":
		/unhandled[\s-]?(rejection|promise|error)|never awaited|not awaited|missing await|un-?awaited|floating promise|promise[\s\w]{0,20}not (awaited|handled)/i,
	"toctou-race":
		/toctou|time[\s-]of[\s-]check|race condition|\brace\b|check[\s-]?then[\s-]?act|concurrent[\s\w]{0,20}(create|check|request)/i,
	"resource-leak":
		/resource leak|(file|handle|descriptor|fd|connection)[\s\w]{0,20}(leak|never closed|not closed|unclosed)|never closed|memory leak|\bleak(ed|s|ing)?\b/i,
	"sql-injection":
		/sql[\s-]?injection|\binjection\b|interpolat[\s\w]{0,20}(sql|query|string)|unsanitiz|un-?parameteriz|concatenat[\s\w]{0,15}(sql|query)|string[\s\w]{0,15}(sql|query)/i,
};

/** A loose token-derived fallback matcher for a defect id with no explicit entry: require all hyphen-split tokens present. */
function defectMatcher(defectId: string): (text: string) => boolean {
	const explicit = DEFECT_MATCHERS[defectId];
	if (explicit) {
		return (text) => explicit.test(text);
	}
	const tokens = defectId
		.split(/[-_\s]+/)
		.map((t) => t.trim().toLowerCase())
		.filter((t) => t.length > 0);
	return (text) => {
		const lower = text.toLowerCase();
		return tokens.length > 0 && tokens.every((tok) => lower.includes(tok));
	};
}

/**
 * Map a model's free-text review onto the subset of `seededDefects` it surfaced (pure). Only the prompt's OWN seeded
 * defects are tested (an un-seeded defect cannot be "caught"), which both matches the scorer's recall semantics and keeps
 * false positives low. Returns the caught canonical ids, ready for `scoreDefectCatchingReview` via {@link scoreEvalAnswer}.
 */
export function extractReviewCaught(reviewText: string, seededDefects: readonly string[]): string[] {
	if (typeof reviewText !== "string" || reviewText.trim().length === 0) {
		return [];
	}
	return seededDefects.filter((defectId) => defectMatcher(defectId)(reviewText));
}

/** Convenience: extract a review {@link EvalAnswer} ready for `scoreEvalAnswer` against a review prompt's seededDefects. */
export function extractReviewEvalAnswer(reviewText: string, seededDefects: readonly string[]): EvalAnswer {
	return { family: "review", caught: extractReviewCaught(reviewText, seededDefects) };
}
