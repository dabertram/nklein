# Reference / Benchmark Solution — `habit-deep-chain`

> Gold-standard end-state + judging rubric. This file is **NOT** shown to the model under test;
> it is the anchor a judge uses to score the model's output. Preset: `deep_chain` (the task
> decomposes into a single deep dependency chain of cards; the reference is the correct clean end-state code).

## Task

Build a **strictly linear** habit-data processing pipeline on top of the existing `smoke-ts-cli`
fixture. Each stage is a pure, typed function `(input: PrevOutput) => NextOutput`, lives in its own
file under `src/pipeline/`, and consumes exactly the type produced by the previous stage — so the work
cannot be parallelized. The chain is:

```
parse → normalize → validate → score → classifyTrend → recommend → format → emit
```

Stage contracts (verbatim from `specification.md`):

- `parse`: `string[] -> RawEntry[]`
- `normalize`: `RawEntry[] -> NormalizedEntry[]`
- `validate`: `NormalizedEntry[] -> ValidEntry[]` (drops/flags malformed rows, **never throws** on bad input)
- `score`: `ValidEntry[] -> number` (0–100)
- `classifyTrend`: `number[] (history) -> 'improving' | 'declining' | 'steady'`
- `recommend`: `(score, trend) -> string`
- `format`: `Summary -> string`
- `emit`: `string -> { ok: true; output: string }`

Plus a final **end-to-end test** that runs the whole pipeline and asserts the invariants. The existing
two tests (`calculateHabitScore`, `summarizeHabitWeek`) must stay green, and **no fixture file may be
modified** — the pipeline is additive.

Acceptance command: `npm test`.

## Suggested decomposition

The grader is checking that the model emitted a **deep, near-linear DAG** — one card per stage, each
depending on the immediately preceding card, with no parallel fan-out of the stage work. A strong agent
produces this chain (edges = `depends-on`):

| # | Card | Depends on | Produces (the type that becomes the next stage's input) |
|---|------|-----------|----------------------------------------------------------|
| 0 | Types module `src/pipeline/types.ts` (RawEntry, NormalizedEntry, ValidEntry, Trend, Summary, EmitResult) | — | shared type vocabulary |
| 1 | `parse` — `string[] -> RawEntry[]` | 0 | `RawEntry[]` |
| 2 | `normalize` — `RawEntry[] -> NormalizedEntry[]` | 1 | `NormalizedEntry[]` |
| 3 | `validate` — `NormalizedEntry[] -> ValidEntry[]` (total, never throws) | 2 | `ValidEntry[]` |
| 4 | `score` — `ValidEntry[] -> number` (0–100) | 3 | `number` |
| 5 | `classifyTrend` — `number[] -> Trend` | 4 | `Trend` |
| 6 | `recommend` — `(score, trend) -> string` | 5 | `string` |
| 7 | `format` — `Summary -> string` | 6 | `string` |
| 8 | `emit` — `string -> EmitResult` | 7 | `EmitResult` |
| 9 | `runPipeline` orchestrator + **end-to-end test** | 8 | wired chain + acceptance |

Notes on the DAG the judge should accept:
- Card 0 (types) is an acceptable shared root that every later card depends on; it does **not** break
  linearity because no stage *logic* runs in parallel. A model that inlines the types into stage 1 (no
  separate `types.ts`) is also fine — judge the **edges between stage logic**, not file count.
- Cards 4→5 and 5→6: `score` yields the latest score; `classifyTrend` consumes a **history of scores**
  (the run accumulates per-entry/per-window scores into a `number[]`), and `recommend` consumes
  `(score, trend)`. This is still a single chain — `recommend` depends on `classifyTrend`, which depends
  on `score`. A linear chain that threads a growing `Summary` accumulator is the cleanest shape.
- The orchestrator (card 9) and the e2e test are the **sink**: they depend on the last stage `emit`.
- **Reject** any decomposition that splits the stages into independent parallel branches
  (e.g. "parse" and "score" as siblings with no edge) — the spec explicitly forbids parallelism.

## Reference implementation

All new files live under `src/pipeline/`; the existing fixture files are untouched. The reference
reuses the fixture's `calculateHabitScore` inside the `score` stage rather than reimplementing it
(minimalism + cross-file consistency).

### `src/pipeline/types.ts`

```ts
// Shared type vocabulary for the linear habit pipeline.
// Each stage consumes exactly the type the previous stage produced.

/** Raw line split into fields, no coercion yet. */
export interface RawEntry {
	dateRaw: string;
	completedRaw: string;
	targetRaw: string;
	streakRaw: string;
}

/** Fields coerced to their natural shapes; may still be out of range / NaN. */
export interface NormalizedEntry {
	date: string;
	completedDays: number;
	targetDays: number;
	streakDays: number;
}

/** A normalized entry that passed validation; all numbers are finite and in range. */
export interface ValidEntry {
	date: string;
	completedDays: number;
	targetDays: number;
	streakDays: number;
}

export type Trend = "improving" | "declining" | "steady";

/** The thing `format` consumes. */
export interface Summary {
	score: number;
	trend: Trend;
	recommendation: string;
}

export interface EmitResult {
	ok: true;
	output: string;
}
```

### `src/pipeline/parse.ts`

```ts
import type { RawEntry } from "./types.ts";

/**
 * Stage 1: `string[] -> RawEntry[]`.
 * Each line is `date,completed,target,streak`. Splitting only — no coercion, no validation.
 * Lines that are blank or have too few fields still produce a RawEntry (missing fields become "");
 * malformed rows are dropped later in `validate`, never here (this stage never throws).
 */
export function parse(lines: string[]): RawEntry[] {
	return lines
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const [dateRaw = "", completedRaw = "", targetRaw = "", streakRaw = ""] = line
				.split(",")
				.map((f) => f.trim());
			return { dateRaw, completedRaw, targetRaw, streakRaw };
		});
}
```

### `src/pipeline/normalize.ts`

```ts
import type { NormalizedEntry, RawEntry } from "./types.ts";

/**
 * Stage 2: `RawEntry[] -> NormalizedEntry[]`.
 * Coerces raw string fields to numbers. Non-numeric fields become NaN (flagged out in `validate`).
 * Pure and total — never throws.
 */
export function normalize(entries: RawEntry[]): NormalizedEntry[] {
	return entries.map((e) => ({
		date: e.dateRaw,
		completedDays: toNumber(e.completedRaw),
		targetDays: toNumber(e.targetRaw),
		streakDays: toNumber(e.streakRaw),
	}));
}

function toNumber(raw: string): number {
	if (raw.trim() === "") {
		return Number.NaN;
	}
	return Number(raw);
}
```

### `src/pipeline/validate.ts`

```ts
import type { NormalizedEntry, ValidEntry } from "./types.ts";

/**
 * Stage 3: `NormalizedEntry[] -> ValidEntry[]`.
 * Drops malformed rows (non-finite numbers, negative counts, non-positive target,
 * or a blank date). Total function: never throws on bad input — bad rows are simply omitted.
 */
export function validate(entries: NormalizedEntry[]): ValidEntry[] {
	return entries.filter(isValid).map((e) => ({
		date: e.date,
		completedDays: e.completedDays,
		targetDays: e.targetDays,
		streakDays: e.streakDays,
	}));
}

function isValid(e: NormalizedEntry): boolean {
	return (
		e.date.length > 0 &&
		Number.isFinite(e.completedDays) &&
		Number.isFinite(e.targetDays) &&
		Number.isFinite(e.streakDays) &&
		e.completedDays >= 0 &&
		e.streakDays >= 0 &&
		e.targetDays > 0
	);
}
```

### `src/pipeline/score.ts`

```ts
import { calculateHabitScore } from "../habit-score.ts";
import type { ValidEntry } from "./types.ts";

/**
 * Stage 4: `ValidEntry[] -> number` (0–100).
 * Reuses the fixture's `calculateHabitScore` per entry and averages, so the score is always
 * bounded 0–100. Empty input yields 0 (a defined, total result — no division by zero / NaN).
 */
export function score(entries: ValidEntry[]): number {
	if (entries.length === 0) {
		return 0;
	}
	const total = entries.reduce(
		(sum, e) =>
			sum +
			calculateHabitScore({
				completedDays: e.completedDays,
				targetDays: e.targetDays,
				streakDays: e.streakDays,
			}),
		0,
	);
	return Math.round(total / entries.length);
}

/**
 * Per-entry scores, in order — the score *history* consumed by `classifyTrend`.
 * Kept alongside `score` because the trend stage needs the trajectory, not just the final number.
 */
export function scoreHistory(entries: ValidEntry[]): number[] {
	return entries.map((e) =>
		calculateHabitScore({
			completedDays: e.completedDays,
			targetDays: e.targetDays,
			streakDays: e.streakDays,
		}),
	);
}
```

### `src/pipeline/classify-trend.ts`

```ts
import type { Trend } from "./types.ts";

/**
 * Stage 5: `number[] (history) -> Trend`.
 * Compares the last score to the first. Fewer than two data points is "steady" (no trajectory).
 * Total and deterministic; result is always exactly one of improving/declining/steady.
 */
export function classifyTrend(history: number[]): Trend {
	if (history.length < 2) {
		return "steady";
	}
	const first = history[0];
	const last = history[history.length - 1];
	if (last > first) {
		return "improving";
	}
	if (last < first) {
		return "declining";
	}
	return "steady";
}
```

### `src/pipeline/recommend.ts`

```ts
import type { Trend } from "./types.ts";

/**
 * Stage 6: `(score, trend) -> string`.
 * Deterministic mapping from trend to advice. `score` is part of the contract and is folded
 * into the message so the recommendation reflects both inputs.
 */
export function recommend(score: number, trend: Trend): string {
	const advice =
		trend === "improving"
			? "Keep the streak visible and protect the next habit window."
			: trend === "declining"
				? "Reduce the target for one week and recover consistency."
				: "Maintain the current routine and watch for missed days.";
	return `Score ${score}/100 (${trend}). ${advice}`;
}
```

### `src/pipeline/format.ts`

```ts
import type { Summary } from "./types.ts";

/**
 * Stage 7: `Summary -> string`.
 * Pure rendering of the summary into a stable, single-line-per-field string.
 */
export function format(summary: Summary): string {
	return [
		`score: ${summary.score}`,
		`trend: ${summary.trend}`,
		`recommendation: ${summary.recommendation}`,
	].join("\n");
}
```

### `src/pipeline/emit.ts`

```ts
import type { EmitResult } from "./types.ts";

/**
 * Stage 8: `string -> { ok: true; output: string }`.
 * Terminal stage — wraps the formatted output in the success envelope.
 */
export function emit(output: string): EmitResult {
	return { ok: true, output };
}
```

### `src/pipeline/run.ts`

```ts
import type { EmitResult, Summary } from "./types.ts";
import { parse } from "./parse.ts";
import { normalize } from "./normalize.ts";
import { validate } from "./validate.ts";
import { score, scoreHistory } from "./score.ts";
import { classifyTrend } from "./classify-trend.ts";
import { recommend } from "./recommend.ts";
import { format } from "./format.ts";
import { emit } from "./emit.ts";

/**
 * The full linear chain, wired end to end. Each call below consumes exactly the type
 * the previous call produced. Pure: same `lines` in => identical `EmitResult` out.
 */
export function runPipeline(lines: string[]): EmitResult {
	const raw = parse(lines); // string[]            -> RawEntry[]
	const normalized = normalize(raw); // RawEntry[]          -> NormalizedEntry[]
	const valid = validate(normalized); // NormalizedEntry[]   -> ValidEntry[]
	const finalScore = score(valid); // ValidEntry[]        -> number
	const history = scoreHistory(valid); // ValidEntry[]        -> number[]
	const trend = classifyTrend(history); // number[]            -> Trend
	const recommendation = recommend(finalScore, trend); // (number, Trend) -> string
	const summary: Summary = { score: finalScore, trend, recommendation };
	const formatted = format(summary); // Summary             -> string
	return emit(formatted); // string              -> EmitResult
}
```

### `test/pipeline.test.js` (new end-to-end test — fixture tests untouched)

```js
import test from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "../src/pipeline/run.ts";

const wellFormed = [
	"2026-06-01,2,5,1",
	"2026-06-02,3,5,2",
	"2026-06-03,5,5,4",
];

test("pipeline runs end to end and is deterministic", () => {
	const first = runPipeline(wellFormed);
	const second = runPipeline(wellFormed);
	assert.deepEqual(first, second); // referential transparency
	assert.equal(first.ok, true);
	assert.equal(typeof first.output, "string");
});

test("final score is bounded 0..100 and trend is one of the three labels", () => {
	const { output } = runPipeline(wellFormed);
	const scoreLine = output.split("\n").find((l) => l.startsWith("score: "));
	const score = Number(scoreLine.slice("score: ".length));
	assert.ok(Number.isFinite(score) && score >= 0 && score <= 100);
	const trendLine = output.split("\n").find((l) => l.startsWith("trend: "));
	const trend = trendLine.slice("trend: ".length);
	assert.ok(["improving", "declining", "steady"].includes(trend));
});

test("rising completion across the window classifies as improving", () => {
	const { output } = runPipeline(wellFormed);
	assert.ok(output.includes("trend: improving"));
});

test("degrades gracefully on malformed rows (never throws, drops bad lines)", () => {
	const messy = [
		"",
		"garbage",
		"2026-06-01,abc,5,1", // non-numeric completed -> dropped
		"2026-06-02,3,0,2", // target 0 -> dropped
		"2026-06-03,4,5,3", // valid
	];
	const result = runPipeline(messy);
	assert.equal(result.ok, true);
	const score = Number(
		result.output.split("\n").find((l) => l.startsWith("score: ")).slice("score: ".length),
	);
	assert.ok(score >= 0 && score <= 100);
});

test("empty / all-invalid input yields a defined zero-score summary, no throw", () => {
	const result = runPipeline(["", "nope", ",,,"]);
	assert.equal(result.ok, true);
	assert.ok(result.output.includes("score: 0"));
	assert.ok(result.output.includes("trend: steady"));
});
```

## Why this is correct

| Invariant (from spec) | Where it is enforced |
|-----------------------|----------------------|
| Each stage is a pure function `(PrevOutput) => NextOutput` | Every stage file exports one such function; no shared mutable state, no I/O inside stages (`emit` only constructs an object). |
| Stage output type == next stage input type, no `any` | `types.ts` defines the shared vocabulary; `run.ts` threads `RawEntry[] → NormalizedEntry[] → ValidEntry[] → number → number[]/Trend → string → Summary → string → EmitResult`. `tsconfig` has `"strict": true`; nothing is typed `any`. |
| Final score always 0–100 | `score` averages `calculateHabitScore`, which is already clamped to 0–100 (`completionRatio` clamped to [0,1], `streakBonus` ≤ 0.2, `×100` rounded); the mean of values in [0,100] stays in [0,100]; empty input short-circuits to `0`. |
| Trend is exactly one of improving/declining/steady | `classifyTrend` returns the `Trend` union and has no other branch; `<2` points → `"steady"`. |
| Total on well-formed input, degrades gracefully (no throw) on malformed rows | `parse` drops blank lines; `normalize` coerces with `Number(...)` (→ NaN, never throws); `validate` filters out non-finite / out-of-range / blank-date rows; `score`/`classifyTrend` are defined on empty arrays. No stage throws. |
| Determinism / referential transparency | No `Date.now`, `Math.random`, or external state anywhere; identical `lines` ⇒ identical `EmitResult`. The e2e test asserts `deepEqual(runPipeline(x), runPipeline(x))`. |
| Existing tests stay green | `score.ts` *imports* `calculateHabitScore` rather than editing `habit-score.ts`; no fixture file is modified, so `calculateHabitScore` (=86) and `summarizeHabitWeek` assertions are unchanged. |
| Linear, non-parallel chain | `run.ts` is a straight-line sequence; each binding feeds the next. The only fan-in is the shared `types.ts` (declarations, not logic). |

## Quality rubric (for judging a model's output)

### Must-pass invariants (any failure ⇒ not EXCELLENT; hard failure ⇒ FAILING)

1. `npm test` passes — the **two original fixture tests stay green** and at least one new end-to-end pipeline test exists and passes.
2. `npm run build` (tsc `--noEmit`, `strict`) type-checks with **no `any`** and no errors; each stage's output type is the next stage's input type.
3. Stages are split into separate files under `src/pipeline/` (or an equivalent clearly-staged module), one function per stage, matching the contract signatures.
4. The pipeline is **total**: malformed rows do not throw; they are dropped/flagged. Empty/all-invalid input returns a defined `EmitResult`.
5. Final score is provably in 0–100; trend is exactly one of the three labels.
6. **Deterministic** — no `Date`, `Math.random`, `process`, network, or filesystem inside the stages; same input ⇒ same output (asserted).
7. No fixture file modified; **no new runtime dependencies** added to `package.json` (Node's built-in `node:test`/`node:assert` only).

### Dimension scoring

| Dimension | EXCELLENT | MEDIOCRE | FAILING |
|-----------|-----------|----------|---------|
| **Correctness** | All invariants enforced in code, not just comments; build + tests green. | Mostly works but one invariant is only partially enforced (e.g. score can exceed 100 on an edge case, or empty input yields NaN that happens not to be tested). | Build fails, tests fail/missing, or pipeline throws on malformed input. |
| **Chain-depth handling** | Genuine deep linear chain — 8 stage functions, each consuming the prior output type; orchestrator threads them in order; e2e test is the sink. | Stages exist but some are collapsed (e.g. parse+normalize fused) or the "chain" is really 2–3 fat functions. | Single monolithic function; no per-stage decomposition; or stages are independent siblings with no real type dependency. |
| **Cross-file consistency** | Shared `types.ts` (or inlined-but-consistent types) used across all stages; `score` reuses the fixture's `calculateHabitScore`; imports resolve via `.ts` extensions (NodeNext + `allowImportingTsExtensions`). | Types duplicated per file but compatible; or `calculateHabitScore` reimplemented instead of reused. | Type mismatches between stages, broken imports, or `any` glue to force-fit incompatible shapes. |
| **Determinism** | No nondeterministic source anywhere; double-run equality asserted. | Deterministic in practice but no test asserts it. | Uses `Date.now`/`Math.random`/ordering-dependent logic; output varies run to run. |
| **Minimalism** | Adds only the pipeline files + one test; reuses existing scoring; no dead code. | Some redundant helpers or an unused stage variant. | Rewrites/duplicates fixture logic, adds scaffolding (CLI flags, config) the spec never asked for. |
| **No added deps** | `package.json` unchanged; built-ins only. | Adds a dev-only formatter/types pkg that is unused. | Adds a runtime dep (zod, lodash, date-fns, a test framework, etc.). |

### Common small-model pitfalls (deduct accordingly)

- **`validate` throws** on bad rows instead of dropping them (violates the "never throws" contract). Very common; check the malformed-input path explicitly.
- **Empty-array NaN**: `score` divides by `entries.length` without the empty guard → `NaN` (not 0–100, and not finite). Often hidden because the happy-path test never exercises empty input.
- **Score can exceed 100**: summing instead of averaging, or re-deriving the score with an unclamped formula instead of reusing `calculateHabitScore`.
- **Modifying the fixture** (`habit-score.ts` / `habit-insights.ts` / the existing test) to "make it fit" → breaks the must-pass "fixture untouched / existing tests green" gate.
- **Wrong import extensions**: importing `./parse` or `./parse.js` instead of `./parse.ts`; under this `tsconfig` (`NodeNext` + `allowImportingTsExtensions`) and the `node --experimental-strip-types` runner, the `.ts` extension is required — wrong extension fails build or test resolution.
- **Adding `any`** at stage boundaries to dodge a type error (defeats the "chain type-checks end to end with no `any`" invariant).
- **Collapsing the chain** into one big function (defeats the deep-chain objective) or, conversely, splitting stages into **parallel** independent branches (spec forbids parallelism).
- **CommonJS drift**: `require`/`module.exports` in a `"type": "module"` package, or omitting `export`.
- **Nondeterminism**: stamping the output with `new Date()` or sorting by an unstable key.
- **Trend off-by-one**: returning a fourth label, or throwing on a single-element history instead of `"steady"`.

## Acceptance

- `npm test` passes: original `calculateHabitScore` (= 86) and `summarizeHabitWeek` assertions remain green, **and** the new `test/pipeline.test.js` passes.
- `npm run build` type-checks under `strict` with no `any`.
- Key assertions the e2e test must make (judge for presence of equivalent checks):
  - `assert.deepEqual(runPipeline(x), runPipeline(x))` — determinism / referential transparency.
  - `result.ok === true` and `typeof result.output === "string"` — terminal envelope shape.
  - Final score parsed from output is finite and in `[0, 100]`.
  - Trend parsed from output ∈ `{improving, declining, steady}`.
  - Malformed / empty input returns a defined `EmitResult` **without throwing** (graceful degradation).
