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
import { scoreDefectCatchingReview, scorePassingCode, scoreValidDag, type TaskGraph } from "./prompt-family-scorers.js";
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
});

export const evalPromptSchema = z.discriminatedUnion("family", [
	decomposeEvalPromptSchema,
	implementEvalPromptSchema,
	reviewEvalPromptSchema,
]);

export type DecomposeEvalPrompt = z.infer<typeof decomposeEvalPromptSchema>;
export type ImplementEvalPrompt = z.infer<typeof implementEvalPromptSchema>;
export type ReviewEvalPrompt = z.infer<typeof reviewEvalPromptSchema>;
export type EvalPrompt = z.infer<typeof evalPromptSchema>;
export type EvalRole = EvalPrompt["role"];
export type EvalScorerFamily = EvalPrompt["family"];

// ── Scoring dispatch ────────────────────────────────────────────────────────────────────────────────────────────────

/** A model's parsed output for one eval prompt, in the shape the matching scorer consumes. */
export type EvalAnswer =
	| { family: "decompose"; graph: TaskGraph }
	| { family: "implement"; passed: number; total: number }
	| { family: "review"; caught: readonly string[] };

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
	}
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
			{ name: "trailing-only", assertion: "3 rapid calls within ms → fn called once after ms" },
			{ name: "latest-args", assertion: "the single invocation receives the arguments of the LAST call" },
			{ name: "reschedule", assertion: "a call within the window pushes the fire time out by ms" },
			{ name: "cancel", assertion: "calling .cancel() before the timer fires suppresses the invocation" },
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
			{ name: "hit-miss", assertion: "put(a,1); get(a)===1; get(b)===undefined" },
			{ name: "evict-lru", assertion: "capacity 2; put a,b,c → a evicted, b and c present" },
			{ name: "get-is-a-use", assertion: "capacity 2; put a,b; get(a); put(c) → b evicted (a was just used)" },
			{ name: "update-existing", assertion: "put(a,1); put(a,2); get(a)===2; size unchanged" },
			{ name: "capacity-zero", assertion: "capacity 0; put(a,1); get(a)===undefined; no throw" },
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
export const EVAL_PROMPT_CORPUS: readonly EvalPrompt[] = [
	...DECOMPOSE_PROMPTS,
	...IMPLEMENT_PROMPTS,
	...REVIEW_PROMPTS,
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
