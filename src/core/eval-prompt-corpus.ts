/**
 * §5.AB — the EVAL PROMPT CORPUS: a small, hand-authored set of role × difficulty tasks with a deterministic answer
 * key, so the model-fitness sweep can grade a candidate model OBJECTIVELY (no LLM judge). It is the data half of the
 * §5.V/§5.AB eval: `prompt-family-scorers` supplies the pure scorers (valid-DAG / passing-code / defect-recall), this
 * supplies the prompts to run and the ground truth to score against. Kept in lock-step with the rest of §5.AB:
 *   - `role`       — the canonical routing role (`architect`/`worker`/`reviewer`) so a score lands on a real fitness cell;
 *   - `difficulty` — the `TaskDifficultyTier` (`easy`/`medium`/`hard`) `estimateTaskDifficulty` emits, so a corpus row's
 *                    (role, difficulty) is exactly a fitness-table key `(model × role × difficulty)`;
 *   - `family`     — which deterministic scorer grades it (`decompose`/`implement`/`review`).
 *
 * Deliberately PURE DATA + total pure functions — no LLM calls, no I/O. The sweep harness (`verify-all-models`) is what
 * actually runs each prompt through a model and feeds the model's parsed output into {@link scoreEvalAnswer}; this module
 * is unit-testable in isolation (every row self-scores 1 against its own reference answer). Small by design: a curated
 * seed set that a human extends, not an exhaustive benchmark. Add rows here; the schema + selftests keep them honest.
 */

import { z } from "zod";
import {
	scoreDefectCatchingReview,
	scorePassingCode,
	scoreToolUseCall,
	scoreValidDag,
	type TaskGraph,
	type ToolCallAttempt,
} from "./prompt-family-scorers.js";
import type { TaskDifficultyTier } from "./task-difficulty-estimate.js";

// ── Schema ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const taskGraphSchema = z.object({
	nodes: z.array(z.string().min(1)),
	edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
});

/** The three difficulty tiers `estimateTaskDifficulty` emits — kept identical so a row maps to a fitness cell. */
export const evalDifficultySchema = z.enum(["easy", "medium", "hard"]);

const evalCommonShape = {
	/** Stable kebab id (also the harness's per-row result key). */
	id: z.string().min(1),
	difficulty: evalDifficultySchema,
	/** The instruction handed verbatim to the model under evaluation. */
	prompt: z.string().min(1),
	/** What a strong answer looks like — for human review + harness prompt-scaffolding, never scored. */
	guidance: z.string().min(1),
};

/** Decomposition family (architect): the model must emit a valid task DAG; scored by {@link scoreValidDag}. */
export const decomposeEvalPromptSchema = z.object({
	...evalCommonShape,
	role: z.literal("architect"),
	family: z.literal("decompose"),
	/**
	 * A canonical VALID decomposition. Two uses: (1) a self-test — the corpus row must score 1 against its own reference,
	 * proving the answer key is a real DAG; (2) a completeness band for the harness (how many nodes a good split has),
	 * beyond what `scoreValidDag`'s validity-only check measures.
	 */
	reference: taskGraphSchema,
	/**
	 * P22.2 — approximate size of a CODEBASE-OVERVIEW preamble generated at run time, so decomposition can be
	 * measured AT DEPTH. Omitted ⇒ the prompt is sent alone, exactly as before.
	 *
	 * The padding is deliberately CONTEXT, never extra requirements. Adding requirements would change the task —
	 * a bigger graph is correctly a different answer — and the matched shallow/deep pair would then measure
	 * difficulty instead of depth, which is precisely the confound Phase 22 is about. The preamble is plausible
	 * repository description the architect must read past to find the request, which is what a real card looks
	 * like and what a two-sentence prompt cannot measure.
	 */
	contextPreambleTokens: z.number().int().positive().optional(),
});

/** Coding family (worker): the model must implement code; the harness runs `tests` → passed/total → {@link scorePassingCode}. */
export const implementEvalPromptSchema = z.object({
	...evalCommonShape,
	role: z.literal("worker"),
	family: z.literal("implement"),
	/** The acceptance tests the harness executes against the model's code (in the sandbox). `total = tests.length`. */
	tests: z.array(z.object({ name: z.string().min(1), assertion: z.string().min(1) })).min(1),
});

/** Review family (reviewer): the model reviews `code`; its findings → caught defect ids → {@link scoreDefectCatchingReview}. */
export const reviewEvalPromptSchema = z.object({
	...evalCommonShape,
	role: z.literal("reviewer"),
	family: z.literal("review"),
	/** The snippet to review — contains exactly the `seededDefects` (and nothing the harness should penalize as a miss). */
	code: z.string().min(1),
	/** Canonical defect ids a correct review must surface. The harness maps the model's free-text findings onto these. */
	seededDefects: z.array(z.string().min(1)),
	/**
	 * P22.2 — approximate size of SURROUNDING, defect-free code generated at run time, so a review can be measured
	 * AT DEPTH. Omitted ⇒ the snippet is reviewed alone, exactly as before.
	 *
	 * Generated rather than stored, following the `context_probe` pattern: a 24k-token file in the corpus would
	 * bloat the source for no benefit, and the corpus is deliberately compact. The generated code is deliberately
	 * BORING and correct — its job is to be volume the reviewer must read past, not a second puzzle. Any defect it
	 * contained would be scored as a miss the prompt never seeded.
	 */
	surroundingTokens: z.number().int().positive().optional(),
	/** Fraction 0..1 through the padded file where the real snippet sits. Ignored without `surroundingTokens`. */
	snippetDepth: z.number().min(0).max(1).optional(),
});

/**
 * Tool-use family (worker): BFCL-style function-calling (todo 6845c). The model is offered `tools` and must emit the
 * correct call for `prompt` — or NO call when `expected === null` (an irrelevance probe: the tools can't satisfy the
 * ask). Scored by {@link scoreToolUseCall}. Tool-calling is the worker capability axis (§5-AN), so role = worker.
 */
export const toolUseEvalPromptSchema = z.object({
	...evalCommonShape,
	role: z.literal("worker"),
	family: z.literal("tool_use"),
	/** The OpenAI-style function tools offered to the model for this probe. */
	tools: z
		.array(
			z.object({
				name: z.string().min(1),
				description: z.string().min(1),
				parameters: z.record(z.string(), z.unknown()),
			}),
		)
		.min(1),
	/** The call a correct answer requires, or `null` for an irrelevance probe (no call expected). */
	expected: z.object({ name: z.string().min(1), args: z.record(z.string(), z.unknown()) }).nullable(),
	/**
	 * P22.2 — plausible IRRELEVANT tools generated at run time and offered alongside the real ones, so tool
	 * selection can be measured at catalog depth. Omitted ⇒ only the declared tools are offered.
	 *
	 * Depth for this family is CATALOG SIZE, not prose volume — that is the dimension the evidence is about.
	 * Filtering an offered set from 40+ tools down to 7 fixed 62% of observed tool-use failures (arXiv 2607.08938),
	 * and RAG-MCP tripled selection accuracy by retrieval-gating the catalog. !Klein caps the offered set at 7
	 * (`DEFAULT_TOOL_CAP`), so this measures what the gate is PROTECTING AGAINST — the ungated case — rather than
	 * re-measuring the protected one.
	 */
	distractorToolCount: z.number().int().positive().optional(),
});

/**
 * Context-probe family (worker): RULER/NoLiMa-style needle retrieval at a GRADUATED context size (§5.AD — seeds
 * the learned quality-effective-budget curve with `{contextTokens, quality}` points for models with no prior
 * outcome data). The haystack is GENERATED deterministically at run time from this compact spec (the corpus stays
 * small — see {@link buildContextProbeInput}); `prompt` is the QUESTION asked after the haystack.
 */
export const contextProbeEvalPromptSchema = z.object({
	...evalCommonShape,
	role: z.literal("worker"),
	family: z.literal("context_probe"),
	/** Approximate haystack size in tokens (filler surrounding the needle). */
	contextTokens: z.number().int().positive(),
	/** The needle sentence buried in the haystack. */
	needle: z.string().min(1),
	/** Fraction 0..1 of the way through the haystack where the needle is buried. */
	needleDepth: z.number().min(0).max(1),
	/** A correct reply must contain at least one of these fragments (case-insensitive). */
	expectedFragments: z.array(z.string().min(1)).min(1),
});

export const evalPromptSchema = z.discriminatedUnion("family", [
	decomposeEvalPromptSchema,
	implementEvalPromptSchema,
	reviewEvalPromptSchema,
	toolUseEvalPromptSchema,
	contextProbeEvalPromptSchema,
]);

export type DecomposeEvalPrompt = z.infer<typeof decomposeEvalPromptSchema>;
export type ImplementEvalPrompt = z.infer<typeof implementEvalPromptSchema>;
export type ReviewEvalPrompt = z.infer<typeof reviewEvalPromptSchema>;
export type ToolUseEvalPrompt = z.infer<typeof toolUseEvalPromptSchema>;
export type ContextProbeEvalPrompt = z.infer<typeof contextProbeEvalPromptSchema>;
export type EvalPrompt = z.infer<typeof evalPromptSchema>;
export type EvalRole = EvalPrompt["role"];
export type EvalScorerFamily = EvalPrompt["family"];

// ── Scoring dispatch ────────────────────────────────────────────────────────────────────────────────────────────────

/** A model's parsed output for one eval prompt, in the shape the matching scorer consumes. */
export type EvalAnswer =
	| { family: "decompose"; graph: TaskGraph }
	| { family: "implement"; passed: number; total: number }
	| { family: "review"; caught: readonly string[] }
	| { family: "tool_use"; called: ToolCallAttempt | null }
	| { family: "context_probe"; answerText: string };

/**
 * Grade a model's `answer` to `prompt` with the deterministic scorer for the prompt's family, returning a score in
 * `[0, 1]`. Throws if the answer family doesn't match the prompt family (a harness wiring bug, not a model failure).
 */
export function scoreEvalAnswer(prompt: EvalPrompt, answer: EvalAnswer): number {
	if (prompt.family !== answer.family) {
		throw new Error(
			`eval answer family "${answer.family}" does not match prompt "${prompt.id}" family "${prompt.family}"`,
		);
	}
	switch (answer.family) {
		case "decompose":
			return scoreValidDag(answer.graph);
		case "implement":
			return scorePassingCode(answer.passed, answer.total);
		case "review":
			// prompt is narrowed to the review family by the guard above.
			return scoreDefectCatchingReview(answer.caught, (prompt as ReviewEvalPrompt).seededDefects);
		case "tool_use":
			return scoreToolUseCall(answer.called, (prompt as ToolUseEvalPrompt).expected);
		case "context_probe":
			return scoreContextProbeAnswer(answer.answerText, (prompt as ContextProbeEvalPrompt).expectedFragments);
	}
}

/**
 * Canonicalize separators so a retrieval scores on CONTENT, not typography: lowercase, then collapse any run of
 * whitespace / underscore / regular hyphen / Unicode dashes (U+2010 hyphen … U+2015 horizontal bar, U+2212 minus)
 * to a single `-`. Fixes a real §11-sweep mis-score (2026-07-11): models rendered the needle "amber-falcon-92" with
 * NON-BREAKING hyphens (U+2011) — a CORRECT answer — yet the old exact-substring match scored it 0 (nemotron-nano +
 * gpt-oss-120b both lost the 8k worker cell to this). Plain-token fragments ("7431", "porto") are unaffected.
 */
function canonicalizeContextProbeText(text: string): string {
	// Char class: whitespace, underscore, the Unicode dash range U+2010–U+2015 (incl. U+2011 non-breaking hyphen),
	// U+2212 minus, and the regular hyphen (kept LAST so it is a literal, never a range endpoint).
	return text.toLowerCase().replace(/[\s_‐-―−-]+/gu, "-");
}

/** Context-probe scorer: 1 when the reply contains ANY expected fragment (case- + separator-insensitive), else 0. */
export function scoreContextProbeAnswer(answerText: string, expectedFragments: readonly string[]): number {
	const normalized = canonicalizeContextProbeText(answerText);
	return expectedFragments.some((fragment) => normalized.includes(canonicalizeContextProbeText(fragment))) ? 1 : 0;
}

/** Filler sentences the haystack cycles through — varied so repetition-collapse can't trivially compress them. */
const CONTEXT_PROBE_FILLER = [
	"Log entry %N: routine telemetry heartbeat received, all subsystems reporting nominal readings.",
	"Audit note %N: scheduled maintenance completed on the secondary cache without incident.",
	"Status %N: background indexing progressed through another shard; no anomalies were flagged.",
	"Record %N: the nightly backup rotation finished and checksums were verified successfully.",
	"Trace %N: a periodic health check pinged every service endpoint and all responded in time.",
] as const;

/** Rough tokens-per-filler-sentence estimate (words × ~1.3); keeps the generated haystack near `contextTokens`. */
const CONTEXT_PROBE_TOKENS_PER_SENTENCE = 16;

/**
 * Deterministically expand a context-probe spec into the full model input: `contextTokens` of numbered filler with
 * the `needle` buried at `needleDepth`, followed by the question (`prompt.prompt`). Pure — same spec, same string —
 * so repeats measure the MODEL's variance, never the probe's.
 */
export function buildContextProbeInput(prompt: ContextProbeEvalPrompt): string {
	const sentenceCount = Math.max(4, Math.round(prompt.contextTokens / CONTEXT_PROBE_TOKENS_PER_SENTENCE));
	const needleIndex = Math.min(sentenceCount - 1, Math.max(0, Math.round(sentenceCount * prompt.needleDepth)));
	const lines: string[] = [];
	for (let index = 0; index < sentenceCount; index += 1) {
		if (index === needleIndex) {
			lines.push(prompt.needle);
		}
		const template = CONTEXT_PROBE_FILLER[index % CONTEXT_PROBE_FILLER.length] as string;
		lines.push(template.replace("%N", String(index + 1)));
	}
	return `Read the following operations log carefully. A question follows at the end.\n\n${lines.join("\n")}\n\nQuestion: ${prompt.prompt}\nAnswer concisely using only the log above.`;
}

/** Filler functions for a depth-padded review: correct, unremarkable, and deliberately not a second puzzle. */
const REVIEW_FILLER_TEMPLATES: readonly string[] = [
	"function formatLabel%N(value) {\n  return String(value ?? '').trim();\n}",
	"function clampPercent%N(value) {\n  if (value < 0) return 0;\n  if (value > 100) return 100;\n  return value;\n}",
	"function sumField%N(rows, field) {\n  let total = 0;\n  for (const row of rows) total += row[field] ?? 0;\n  return total;\n}",
	"function uniqueIds%N(rows) {\n  return Array.from(new Set(rows.map((row) => row.id)));\n}",
];
/** Rough tokens per generated filler function; only the resulting SIZE matters, not the estimate's precision. */
const REVIEW_FILLER_TOKENS_PER_FUNCTION = 30;

/**
 * P22.2 — build the code a reviewer actually sees, padding the seeded snippet to `surroundingTokens` when asked.
 *
 * Without padding this returns the snippet unchanged, so existing rows are byte-identical. With it, the snippet is
 * buried among correct, boring functions at `snippetDepth` — measuring whether a model can still FIND a defect
 * once it has to read past volume, which is what reviewing a real diff demands and what a 6-line snippet cannot
 * measure.
 */
export function buildReviewInput(prompt: ReviewEvalPrompt): string {
	if (!prompt.surroundingTokens) {
		return prompt.code;
	}
	const count = Math.max(2, Math.round(prompt.surroundingTokens / REVIEW_FILLER_TOKENS_PER_FUNCTION));
	const insertAt = Math.min(count, Math.max(0, Math.round(count * (prompt.snippetDepth ?? 0.5))));
	const blocks: string[] = [];
	for (let index = 0; index < count; index += 1) {
		if (index === insertAt) {
			blocks.push(prompt.code);
		}
		const template = REVIEW_FILLER_TEMPLATES[index % REVIEW_FILLER_TEMPLATES.length] as string;
		blocks.push(template.replaceAll("%N", String(index + 1)));
	}
	if (insertAt >= count) {
		blocks.push(prompt.code);
	}
	return blocks.join("\n\n");
}

/** Plausible, irrelevant repository description used to pad a decompose prompt to depth. */
const DECOMPOSE_PREAMBLE_TEMPLATES: readonly string[] = [
	"Module %N (`src/services/module%N.ts`) exposes a small façade over the persistence layer and is covered by unit tests.",
	"Package %N ships a CLI entry point that reads configuration from the environment and validates it at start-up.",
	"Directory %N contains generated API clients; they are regenerated on release and should not be edited by hand.",
	"Component %N renders a read-only summary view and has no side effects beyond fetching its own data.",
];
const DECOMPOSE_PREAMBLE_TOKENS_PER_LINE = 22;

/**
 * P22.2 — build the decomposition request the architect actually receives, prepending a codebase overview when
 * `contextPreambleTokens` is set. Returns `prompt.prompt` unchanged otherwise, so existing rows are untouched.
 *
 * The overview is irrelevant to the task ON PURPOSE. The question is whether a model can still produce the same
 * graph once the request is buried in repository context — not whether it can decompose a harder problem.
 */
export function buildDecomposeInput(prompt: DecomposeEvalPrompt): string {
	if (!prompt.contextPreambleTokens) {
		return prompt.prompt;
	}
	const count = Math.max(2, Math.round(prompt.contextPreambleTokens / DECOMPOSE_PREAMBLE_TOKENS_PER_LINE));
	const lines = Array.from({ length: count }, (_, index) =>
		(DECOMPOSE_PREAMBLE_TEMPLATES[index % DECOMPOSE_PREAMBLE_TEMPLATES.length] as string).replaceAll(
			"%N",
			String(index + 1),
		),
	);
	return [
		"Repository overview (context only — the task follows at the end):",
		"",
		...lines,
		"",
		"TASK:",
		prompt.prompt,
	].join("\n");
}

/** Plausible, clearly-irrelevant tools used to pad a tool-use probe's catalog to depth. */
const TOOL_DISTRACTOR_TEMPLATES: readonly { suffix: string; description: string }[] = [
	{ suffix: "list_invoices", description: "List billing invoices for an account within a date range." },
	{ suffix: "rotate_log", description: "Rotate a server log file and compress the previous segment." },
	{ suffix: "resize_image", description: "Resize an image to the requested pixel dimensions." },
	{ suffix: "geocode_address", description: "Convert a postal address into latitude and longitude." },
	{ suffix: "send_sms", description: "Send a short text message to a verified phone number." },
];

/**
 * P22.2 — the tool catalog actually offered for a probe, padded with distractors when configured.
 *
 * The distractors are plausible but UNAMBIGUOUSLY irrelevant to any probe's task: the question is whether a model
 * can still find the right tool in a crowd, not whether it can disambiguate two reasonable candidates. A
 * near-miss distractor would make a wrong pick defensible and turn a selection measurement into a judgement call.
 */
export function buildToolCatalog(prompt: ToolUseEvalPrompt): ToolUseEvalPrompt["tools"] {
	if (!prompt.distractorToolCount) {
		return prompt.tools;
	}
	const distractors = Array.from({ length: prompt.distractorToolCount }, (_, index) => {
		const template = TOOL_DISTRACTOR_TEMPLATES[index % TOOL_DISTRACTOR_TEMPLATES.length] as {
			suffix: string;
			description: string;
		};
		return {
			name: `${template.suffix}_${index + 1}`,
			description: template.description,
			parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } as Record<
				string,
				unknown
			>,
		};
	});
	// Real tools LAST: a model that simply picks the first offered tool must not score by accident.
	return [...distractors, ...prompt.tools];
}

/**
 * P22.2 — the context a prompt actually puts in front of the model.
 *
 * Depth is a property of the PROMPT, not the response: `context_probe` haystacks, padded reviews and padded
 * decompose preambles all expand at run time from a compact spec. Measuring the STORED row instead of the
 * expanded one is the trap that produced a confidently wrong "the corpus is entirely shallow" reading on
 * 2026-07-31 — a 24k probe stores as a few hundred bytes.
 */
export function evalPromptContextTokens(prompt: EvalPrompt): number {
	switch (prompt.family) {
		case "context_probe":
			return prompt.contextTokens;
		case "review":
			return estimateEvalTextTokens(buildReviewInput(prompt));
		case "decompose":
			return estimateEvalTextTokens(buildDecomposeInput(prompt));
		default:
			return estimateEvalTextTokens(prompt.prompt);
	}
}

/** Rough token estimate — only the DEPTH BAND it lands in matters, never the exact figure. */
function estimateEvalTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

// ── The corpus ──────────────────────────────────────────────────────────────────────────────────────────────────────

const DECOMPOSE_PROMPTS: readonly DecomposeEvalPrompt[] = [
	{
		id: "decompose-cli-version-flag",
		role: "architect",
		family: "decompose",
		difficulty: "easy",
		prompt:
			"Decompose the work to add a `--version` flag to an existing CLI that prints the package version and exits 0. " +
			"Return a task graph: nodes are concrete steps, edges are 'must precede' dependencies.",
		guidance:
			"3–5 steps: read the version (from package.json), add the flag to the arg parser, print + exit, wire into main, " +
			"add a test. A valid DAG with a single sink (the wiring/test) and no cycles.",
		reference: {
			nodes: ["read-version", "add-flag-parse", "print-and-exit", "wire-into-main", "add-test"],
			edges: [
				{ from: "read-version", to: "print-and-exit" },
				{ from: "add-flag-parse", to: "wire-into-main" },
				{ from: "print-and-exit", to: "wire-into-main" },
				{ from: "wire-into-main", to: "add-test" },
			],
		},
	},
	{
		// P22.2 — the SAME task and reference graph as `decompose-cli-version-flag`, buried under ~18k tokens of
		// repository overview. The pair isolates DEPTH: identical request, identical answer key, only the
		// surrounding context differs. Decompose quality was the G6.8a campaign's binding constraint, and every
		// decompose measurement until now was taken on a two-sentence prompt.
		id: "decompose-cli-version-flag-deep",
		role: "architect",
		family: "decompose",
		difficulty: "hard",
		prompt:
			"Decompose the work to add a `--version` flag to an existing CLI that prints the package version and exits 0. " +
			"Return a task graph: nodes are concrete steps, edges are 'must precede' dependencies.",
		guidance:
			"The same 3–5 steps as the shallow variant. A model that produces a valid graph shallow and a malformed " +
			"or truncated one here is losing the task to CONTEXT VOLUME, not to difficulty.",
		reference: {
			nodes: ["read-version", "add-flag-parse", "print-and-exit", "wire-into-main", "add-test"],
			edges: [
				{ from: "read-version", to: "print-and-exit" },
				{ from: "add-flag-parse", to: "wire-into-main" },
				{ from: "print-and-exit", to: "wire-into-main" },
				{ from: "wire-into-main", to: "add-test" },
			],
		},
		contextPreambleTokens: 18_000,
	},
	{
		id: "decompose-rest-pagination",
		role: "architect",
		family: "decompose",
		difficulty: "medium",
		prompt:
			"Decompose the work to add limit/offset pagination to a REST list endpoint backed by a SQL repository, including " +
			"a stable sort and a total-count in the response envelope. Return a task graph (nodes = steps, edges = ordering).",
		guidance:
			"6–8 steps threading query params → repository limit/offset + stable ORDER BY → count query → response envelope → " +
			"contract test + integration test. A DAG; the tests are sinks, the param parsing is a source.",
		reference: {
			nodes: [
				"parse-query-params",
				"repo-limit-offset",
				"stable-sort",
				"count-query",
				"response-envelope",
				"contract-test",
				"integration-test",
			],
			edges: [
				{ from: "parse-query-params", to: "repo-limit-offset" },
				{ from: "repo-limit-offset", to: "stable-sort" },
				{ from: "stable-sort", to: "response-envelope" },
				{ from: "count-query", to: "response-envelope" },
				{ from: "response-envelope", to: "contract-test" },
				{ from: "response-envelope", to: "integration-test" },
			],
		},
	},
	{
		id: "decompose-streaming-pipeline-migration",
		role: "architect",
		family: "decompose",
		difficulty: "hard",
		prompt:
			"Decompose the migration of a synchronous, load-everything-into-memory file-processing pipeline to a streaming, " +
			"back-pressured design that bounds memory, preserving output equivalence. Return a task graph (nodes = steps, " +
			"edges = 'must precede').",
		guidance:
			"8–12 steps: audit current behavior + capture a golden output, define stream interfaces, implement source/" +
			"transform/sink, add a bounded-buffer back-pressure policy, migrate callers behind a flag, benchmark memory + " +
			"throughput, then flip the flag. A DAG converging on the equivalence benchmark/flip as sinks.",
		reference: {
			nodes: [
				"audit-current-pipeline",
				"capture-golden-output",
				"define-stream-interfaces",
				"implement-source",
				"implement-transforms",
				"implement-sink",
				"backpressure-policy",
				"migrate-callers-behind-flag",
				"equivalence-benchmark",
				"flip-flag",
			],
			edges: [
				{ from: "audit-current-pipeline", to: "capture-golden-output" },
				{ from: "audit-current-pipeline", to: "define-stream-interfaces" },
				{ from: "define-stream-interfaces", to: "implement-source" },
				{ from: "define-stream-interfaces", to: "implement-transforms" },
				{ from: "define-stream-interfaces", to: "implement-sink" },
				{ from: "implement-transforms", to: "backpressure-policy" },
				{ from: "implement-source", to: "migrate-callers-behind-flag" },
				{ from: "implement-sink", to: "migrate-callers-behind-flag" },
				{ from: "backpressure-policy", to: "migrate-callers-behind-flag" },
				{ from: "capture-golden-output", to: "equivalence-benchmark" },
				{ from: "migrate-callers-behind-flag", to: "equivalence-benchmark" },
				{ from: "equivalence-benchmark", to: "flip-flag" },
			],
		},
	},
];

const IMPLEMENT_PROMPTS: readonly ImplementEvalPrompt[] = [
	{
		id: "implement-slugify",
		role: "worker",
		family: "implement",
		difficulty: "easy",
		prompt:
			"Implement `slugify(text: string): string`: lowercase; replace any run of non-alphanumeric characters with a " +
			"single hyphen; trim leading/trailing hyphens. Pure, no dependencies.",
		guidance:
			"A one-liner regex is fine. Watch the edge cases: collapsing repeats, trimming, symbol-only input → empty string.",
		tests: [
			{ name: "basic", assertion: "slugify('Hello World') === 'hello-world'" },
			{ name: "collapse-runs", assertion: "slugify('a  --  b') === 'a-b'" },
			{ name: "trim-edges", assertion: "slugify('  Hi!  ') === 'hi'" },
			{ name: "symbols", assertion: "slugify('C++ & Rust') === 'c-rust'" },
			{ name: "empty", assertion: "slugify('!!!') === ''" },
		],
	},
	{
		id: "implement-debounce",
		role: "worker",
		family: "implement",
		difficulty: "medium",
		prompt:
			"Implement `debounce(fn, ms)` returning a debounced function that invokes `fn` only after `ms` have elapsed with " +
			"no new call, forwarding the LATEST arguments. Expose `.cancel()` to drop a pending invocation.",
		guidance:
			"Track a single timer; each call clears + reschedules it; the fire uses the most recent args. `.cancel()` clears " +
			"the timer without firing. Rapid calls collapse to one trailing invocation.",
		tests: [
			// P22.2 (2026-07-31): these were PROSE until the family became executable — descriptions of the intended
			// behaviour rather than runnable checks. Left as prose they would have thrown on every candidate and
			// scored 0, which reads as "the model cannot implement debounce" when nothing was ever measured. They
			// are now real assertions, async because a debounce only proves itself once its timer fires.
			{
				name: "trailing-only",
				assertion:
					"(async()=>{let n=0;const d=debounce(()=>{n++;},20);d();d();d();const early=n===0;await new Promise(r=>setTimeout(r,60));return early&&n===1;})()",
			},
			{
				name: "latest-args",
				assertion:
					"(async()=>{let seen=null;const d=debounce(v=>{seen=v;},20);d('first');d('last');await new Promise(r=>setTimeout(r,60));return seen==='last';})()",
			},
			{
				name: "reschedule",
				assertion:
					"(async()=>{let n=0;const d=debounce(()=>{n++;},40);d();await new Promise(r=>setTimeout(r,25));d();await new Promise(r=>setTimeout(r,25));const notYet=n===0;await new Promise(r=>setTimeout(r,40));return notYet&&n===1;})()",
			},
			{
				name: "cancel",
				assertion:
					"(async()=>{let n=0;const d=debounce(()=>{n++;},20);d();d.cancel();await new Promise(r=>setTimeout(r,60));return n===0;})()",
			},
		],
	},
	{
		id: "implement-lru-cache",
		role: "worker",
		family: "implement",
		difficulty: "hard",
		prompt:
			"Implement class `LruCache<K, V>(capacity: number)` with O(1) `get(k)` and `put(k, v)`. On capacity overflow evict " +
			"the least-recently-USED entry (a `get` counts as a use). `get` on a missing key returns undefined.",
		guidance:
			"A Map preserves insertion order; on get/put delete-then-set to move the key to the most-recent end; evict the " +
			"first Map key when size exceeds capacity. Handle capacity 0 (nothing is ever retained) without throwing.",
		tests: [
			// P22.2 (2026-07-31): converted from prose to runnable checks for the same reason as `implement-debounce`.
			// ⚠️ The class name here MUST match the prompt (`LruCache`). My first draft asserted `LRUCache` and the
			// self-test still passed — because I had written the reference implementation to match my ASSERTIONS
			// rather than the PROMPT. An answer key validated against itself proves nothing; it must be validated
			// against the contract the model is actually given.
			{
				name: "hit-miss",
				assertion: "(()=>{const c=new LruCache(2);c.put('a',1);return c.get('a')===1&&c.get('b')===undefined;})()",
			},
			{
				name: "evict-lru",
				assertion:
					"(()=>{const c=new LruCache(2);c.put('a',1);c.put('b',2);c.put('c',3);return c.get('a')===undefined&&c.get('b')===2&&c.get('c')===3;})()",
			},
			{
				name: "get-is-a-use",
				assertion:
					"(()=>{const c=new LruCache(2);c.put('a',1);c.put('b',2);c.get('a');c.put('c',3);return c.get('b')===undefined&&c.get('a')===1;})()",
			},
			{
				name: "update-existing",
				assertion:
					"(()=>{const c=new LruCache(2);c.put('a',1);c.put('a',2);c.put('b',3);return c.get('a')===2&&c.get('b')===3;})()",
			},
			{
				name: "capacity-zero",
				assertion: "(()=>{const c=new LruCache(0);c.put('a',1);return c.get('a')===undefined;})()",
			},
		],
	},
];

const REVIEW_PROMPTS: readonly ReviewEvalPrompt[] = [
	{
		id: "review-off-by-one",
		role: "reviewer",
		family: "review",
		difficulty: "easy",
		prompt: "Review this function for correctness bugs. List each defect you find.",
		guidance: "The loop bound `<=` reads one past the end of the array, returning undefined in the last iteration.",
		code: [
			"function lastNonEmpty(rows) {",
			"  let result = null;",
			"  for (let i = 0; i <= rows.length; i++) {",
			"    if (rows[i] && rows[i].length > 0) result = rows[i];",
			"  }",
			"  return result;",
			"}",
		].join("\n"),
		seededDefects: ["off-by-one"],
	},
	{
		id: "review-null-and-unhandled-rejection",
		role: "reviewer",
		family: "review",
		difficulty: "medium",
		prompt: "Review this async function for defects. List each one.",
		guidance:
			"Two defects: `user.profile.email` dereferences `profile` which can be null; and the `fetch(...)` promise is " +
			"never awaited nor its rejection handled, so a network error becomes an unhandled rejection.",
		code: [
			"async function notify(userId, db) {",
			"  const user = await db.findUser(userId);",
			"  const email = user.profile.email;",
			"  fetch('https://mail.local/send', { method: 'POST', body: email });",
			"  return email;",
			"}",
		].join("\n"),
		seededDefects: ["null-deref", "unhandled-rejection"],
	},
	{
		// P22.2 — the SAME defect as `review-null-and-unhandled-rejection`, buried mid-file at ~20k tokens.
		//
		// A matched pair is the point: the shallow row and this one seed the identical defects, so the score
		// DIFFERENCE isolates depth from difficulty. Two prompts of different difficulty at different depths would
		// confound exactly the variable Phase 22 is about.
		//
		// This is the first agent-work prompt in the corpus above the shallow band. Until it existed, every
		// decompose/implement/review/tool_use measurement was shallow, and the only depth coverage was needle
		// RETRIEVAL — a different capability, so it licensed no claim about reviewing a real diff.
		id: "review-null-and-unhandled-rejection-deep",
		role: "reviewer",
		family: "review",
		difficulty: "hard",
		prompt: "Review this file for defects. List each one. Most of the file is correct.",
		guidance:
			"The same two defects as the shallow variant — a null dereference of `user.profile` and an unawaited " +
			"`fetch` whose rejection is unhandled — but surrounded by ~20k tokens of correct code. A model that " +
			"scores well shallow and poorly here is losing the defect to VOLUME, not to difficulty.",
		code: [
			"async function notify(userId, db) {",
			"  const user = await db.findUser(userId);",
			"  const email = user.profile.email;",
			"  fetch('https://mail.local/send', { method: 'POST', body: email });",
			"  return email;",
			"}",
		].join("\n"),
		seededDefects: ["null-deref", "unhandled-rejection"],
		surroundingTokens: 20_000,
		// Mid-file: the hardest position. A defect at the very start or end is found by a model that only reads
		// the edges, which is the "lost in the middle" effect this is meant to expose rather than dodge.
		snippetDepth: 0.5,
	},
	{
		id: "review-race-leak-injection",
		role: "reviewer",
		family: "review",
		difficulty: "hard",
		prompt: "Review this handler for correctness AND security defects. List each defect.",
		guidance:
			"Three defects: a check-then-act TOCTOU race between `exists` and `create` (two requests both pass the check); a " +
			"file handle opened and never closed on the success path (resource leak); and `name` interpolated straight into " +
			"the SQL string (injection).",
		code: [
			"async function createAccount(req, db, fs) {",
			"  const name = req.body.name;",
			'  const exists = await db.query("SELECT 1 FROM accounts WHERE name=\'" + name + "\'");',
			"  if (exists.rows.length > 0) return { error: 'taken' };",
			"  const handle = await fs.open('/data/' + name + '.log', 'w');",
			'  await db.query("INSERT INTO accounts(name) VALUES(\'" + name + "\')");',
			"  await handle.write('created');",
			"  return { ok: true };",
			"}",
		].join("\n"),
		seededDefects: ["toctou-race", "resource-leak", "sql-injection"],
	},
];

/** The full eval corpus (all families). Small + curated; extend by adding rows to the family arrays above. */
/** BFCL-style tool-use probes (todo 6845c): simple call, multi-tool selection, and an irrelevance case. */
const TOOL_USE_PROMPTS: readonly ToolUseEvalPrompt[] = [
	{
		id: "tooluse-simple-weather",
		role: "worker",
		family: "tool_use",
		difficulty: "easy",
		prompt: "What is the current temperature in Berlin in celsius? Use the tool.",
		guidance: "Call get_weather with location=Berlin and unit=celsius.",
		tools: [
			{
				name: "get_weather",
				description: "Get the current weather for a location.",
				parameters: {
					type: "object",
					properties: {
						location: { type: "string", description: "City name" },
						unit: { type: "string", enum: ["celsius", "fahrenheit"] },
					},
					required: ["location"],
				},
			},
		],
		expected: { name: "get_weather", args: { location: "Berlin", unit: "celsius" } },
	},
	{
		// P22.2 — the SAME task, tool and expected call as `tooluse-simple-weather`, offered inside a 40-tool
		// catalog. The pair isolates CATALOG DEPTH: identical request, identical correct answer, only the number of
		// competing tools differs.
		//
		// 40 is not arbitrary — it is the ungated size the evidence is about (filtering 40+ down to 7 fixed 62% of
		// tool-use failures). !Klein's own gate caps the offered set at `DEFAULT_TOOL_CAP = 7`, so this row measures
		// what that gate PROTECTS AGAINST rather than re-measuring the protected case.
		id: "tooluse-simple-weather-deep-catalog",
		role: "worker",
		family: "tool_use",
		difficulty: "hard",
		prompt: "What is the current temperature in Berlin in celsius? Use the tool.",
		guidance:
			"Call get_weather with location=Berlin and unit=celsius, exactly as in the shallow variant. A model that " +
			"succeeds there and fails here is losing the task to CATALOG SIZE, not to difficulty.",
		tools: [
			{
				name: "get_weather",
				description: "Get the current weather for a location.",
				parameters: {
					type: "object",
					properties: {
						location: { type: "string", description: "City name" },
						unit: { type: "string", enum: ["celsius", "fahrenheit"] },
					},
					required: ["location"],
				},
			},
		],
		expected: { name: "get_weather", args: { location: "Berlin", unit: "celsius" } },
		distractorToolCount: 39,
	},
	{
		id: "tooluse-multi-select",
		role: "worker",
		family: "tool_use",
		difficulty: "medium",
		prompt: "Convert 100 US dollars to euros using the right tool.",
		guidance: "Pick convert_currency (not send_email or get_weather) with amount=100, from=USD, to=EUR.",
		tools: [
			{
				name: "get_weather",
				description: "Get the current weather for a location.",
				parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
			},
			{
				name: "convert_currency",
				description: "Convert an amount between two currencies.",
				parameters: {
					type: "object",
					properties: {
						amount: { type: "number" },
						from: { type: "string" },
						to: { type: "string" },
					},
					required: ["amount", "from", "to"],
				},
			},
			{
				name: "send_email",
				description: "Send an email.",
				parameters: { type: "object", properties: { to: { type: "string" } }, required: ["to"] },
			},
		],
		expected: { name: "convert_currency", args: { amount: 100, from: "USD", to: "EUR" } },
	},
	{
		id: "tooluse-irrelevance",
		role: "worker",
		family: "tool_use",
		difficulty: "hard",
		prompt: "Write me a haiku about the ocean.",
		guidance: "The offered tool cannot write a haiku — a correct model makes NO tool call and answers directly.",
		tools: [
			{
				name: "get_weather",
				description: "Get the current weather for a location.",
				parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
			},
		],
		expected: null,
	},
];

/**
 * §5.AD RULER/NoLiMa-style long-context probes: the SAME needle-retrieval task at graduated context sizes, so a
 * sweep yields `{contextTokens, quality}` points that seed a model's learned quality-effective budget when no live
 * outcome data exists yet. Sizes stay well under the ≥32k context floor so every gated model can attempt all three.
 */
const CONTEXT_PROBE_PROMPTS: readonly ContextProbeEvalPrompt[] = [
	{
		id: "context-probe-2k",
		role: "worker",
		family: "context_probe",
		difficulty: "easy",
		prompt: "Which employee badge number was reported at the reception desk incident?",
		guidance: "The needle states badge 7431 was handed in at reception. A correct answer names 7431.",
		contextTokens: 2_000,
		needle:
			"Incident report: employee badge number 7431 was handed in at the reception desk after being found in the elevator.",
		needleDepth: 0.45,
		expectedFragments: ["7431"],
	},
	{
		id: "context-probe-8k",
		role: "worker",
		family: "context_probe",
		difficulty: "medium",
		prompt: "What passphrase did the migration runbook assign to the staging vault?",
		guidance: "The needle assigns the staging vault the passphrase 'amber-falcon-92'. A correct answer repeats it.",
		contextTokens: 8_000,
		needle:
			"Migration runbook note: the staging vault passphrase was rotated to amber-falcon-92 effective immediately.",
		needleDepth: 0.35,
		expectedFragments: ["amber-falcon-92"],
	},
	{
		id: "context-probe-24k",
		role: "worker",
		family: "context_probe",
		difficulty: "hard",
		prompt: "Which city hosts the tertiary disaster-recovery site mentioned in the log?",
		guidance: "The needle places the tertiary disaster-recovery site in Porto. A correct answer names Porto.",
		contextTokens: 24_000,
		needle:
			"Infrastructure memo: the tertiary disaster-recovery site was provisioned in Porto and joined replication today.",
		needleDepth: 0.6,
		expectedFragments: ["porto"],
	},
];

export const EVAL_PROMPT_CORPUS: readonly EvalPrompt[] = [
	...DECOMPOSE_PROMPTS,
	...IMPLEMENT_PROMPTS,
	...REVIEW_PROMPTS,
	...TOOL_USE_PROMPTS,
	...CONTEXT_PROBE_PROMPTS,
];

// ── Selectors ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The corpus rows for one routing role (the sweep runs a model against its role's prompts). */
export function evalPromptsByRole(role: EvalRole): EvalPrompt[] {
	return EVAL_PROMPT_CORPUS.filter((prompt) => prompt.role === role);
}

/** The corpus rows at one difficulty tier (a (role, difficulty) pair keys a fitness cell). */
export function evalPromptsByDifficulty(difficulty: TaskDifficultyTier): EvalPrompt[] {
	return EVAL_PROMPT_CORPUS.filter((prompt) => prompt.difficulty === difficulty);
}

/** Look up one row by id (the harness's per-row result key), or undefined if absent. */
export function evalPromptById(id: string): EvalPrompt | undefined {
	return EVAL_PROMPT_CORPUS.find((prompt) => prompt.id === id);
}

// ── Versioning ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Bump on a BREAKING change to the corpus schema or scoring SEMANTICS (a change that makes old scores incomparable even
 * if the prompt text is unchanged — e.g. a scorer's meaning shifts). Additive prompt edits don't need a bump; the content
 * fingerprint below detects those automatically. Persisted eval results should record BOTH so a re-eval knows whether the
 * corpus it scored against still matches.
 */
export const EVAL_CORPUS_VERSION = 1;

/**
 * A stable content fingerprint of the corpus: `v<version>-<hash>` where the hash is a deterministic 32-bit rolling hash
 * (djb2-xor) of the serialized rows. The SAME corpus always fingerprints identically; ANY change to a prompt, answer key,
 * or row set changes it — so the eval harness can detect that stored scores were produced against a DIFFERENT corpus and
 * must be recomputed, even without a manual version bump. Pure + deterministic (no crypto dependency); this is a
 * change-detector, not a security hash, so collision-resistance is not required.
 */
export function evalCorpusFingerprint(corpus: readonly EvalPrompt[] = EVAL_PROMPT_CORPUS): string {
	const serialized = JSON.stringify(corpus);
	let hash = 5381;
	for (let index = 0; index < serialized.length; index += 1) {
		// hash * 33 ^ charCode, coerced to a 32-bit int each step so long inputs don't drift into float imprecision.
		hash = (((hash << 5) + hash) ^ serialized.charCodeAt(index)) | 0;
	}
	return `v${EVAL_CORPUS_VERSION}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
