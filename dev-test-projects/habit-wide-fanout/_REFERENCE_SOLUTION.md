# Reference / Benchmark Solution — `habit-wide-fanout`

> Gold-standard END-STATE for judging a model under test. **Not** shown to the model.
> The sweep preset is `wide_fanout`: the task must decompose into a WIDE fan-out of many
> independent sibling cards from a shared base, joining only at the very end.

## Task

Extend the `smoke-ts-cli` habit-scoring fixture with **six independent, non-overlapping
output formatters**, each turning a habit `HabitView` into a different string
representation, then wire them together. All formatters share one contract defined once;
no formatter may import another. Concretely:

- Define the shared contract once in `src/formatters/types.ts`:
  - `interface HabitView { score: number; trend: 'improving' | 'declining' | 'steady'; recommendation: string }`
  - `type Formatter = (view: HabitView) => string` (pure, total).
- Six formatters, each in its own file under `src/formatters/` with its own test, none
  importing another: compact line, JSON, CSV row, markdown table row, emoji sparkline,
  plain-text report.
- One **registry** card that wires all six into the CLI and depends on all six.
- One broad **integration test** card that depends on the registry.

Acceptance command: `npm test` (which runs `node --experimental-strip-types --test test/*.test.js`).
Existing tests (`test/habit-score.test.js`) must stay green; no new dependencies.

## Suggested decomposition

The decomposition a strong agent produces is a textbook **wide fan-out**: one shared base
card, six parallel sibling leaves with **no edges between them**, then exactly two join
points (registry → integration). This is the *reference fan-out shape* used to judge the
model's card graph.

```
                ┌─────────────────────────────────────────────┐
                │ C0  Shared base: src/formatters/types.ts     │
                │     HabitView + Formatter contract (define    │
                │     once; HabitView is structurally the same  │
                │     as the existing HabitInsightSummary)      │
                └───┬───┬───┬───┬───┬───┬──────────────────────┘
       ┌────────────┘   │   │   │   │   └────────────┐
       │       ┌────────┘   │   │   └────────┐       │
       ▼       ▼            ▼   ▼            ▼        ▼
   ┌───────┐┌──────┐  ┌───────┐┌──────────┐┌────────────┐┌──────────────┐
   │C1     ││C2    │  │C3     ││C4        ││C5          ││C6            │
   │compact││json  │  │csv    ││markdown  ││sparkline   ││report        │
   │ .ts   ││ .ts  │  │ .ts   ││ .ts      ││ .ts        ││ .ts          │
   │ +test ││+test │  │ +test ││ +test    ││ +test      ││ +test        │
   └───┬───┘└──┬───┘  └───┬───┘└────┬─────┘└─────┬──────┘└──────┬───────┘
       └───────┴──────────┴────────┴─────────────┴──────────────┘
                                   ▼
                ┌─────────────────────────────────────────────┐
                │ C7  Registry: src/formatters/registry.ts     │
                │     depends on C1..C6 (all six)              │
                │     also wires into CLI (src/index.ts)        │
                └──────────────────┬──────────────────────────┘
                                   ▼
                ┌─────────────────────────────────────────────┐
                │ C8  Integration test: test/formatters.test.js│
                │     depends on C7                            │
                └─────────────────────────────────────────────┘
```

**Edge list (the only edges that should exist):**
`C0→C1, C0→C2, C0→C3, C0→C4, C0→C5, C0→C6` (base→leaves);
`C1→C7, C2→C7, C3→C7, C4→C7, C5→C7, C6→C7` (leaves→registry);
`C7→C8` (registry→integration).

**Fan-out width = 6 sibling leaves with zero leaf-to-leaf edges.** Any edge between two
formatters (e.g. CSV importing JSON, or report importing compact) is a fan-out-shape
defect: it serializes parallel work that the spec explicitly forbids.

> Note: `C0` is a tiny type-only base. It is legitimate (and arguably cleaner) to fold the
> contract directly into the registry's import surface, but defining it once in
> `types.ts` is the canonical "shared base card" and keeps the six leaves truly
> independent — each imports only `types.ts`, never a sibling.

## Reference implementation

### `src/formatters/types.ts`

```ts
export interface HabitView {
	score: number;
	trend: "improving" | "declining" | "steady";
	recommendation: string;
}

export type Formatter = (view: HabitView) => string;
```

### `src/formatters/compact.ts`

```ts
import type { Formatter } from "./types.ts";

const TREND_SIGIL: Record<string, string> = {
	improving: "^",
	declining: "v",
	steady: "=",
};

export const formatCompact: Formatter = (view) =>
	`${view.score} ${TREND_SIGIL[view.trend]} ${view.recommendation}`;
```

### `src/formatters/json.ts`

```ts
import type { Formatter, HabitView } from "./types.ts";

export const formatJson: Formatter = (view) => {
	const payload: HabitView = {
		score: view.score,
		trend: view.trend,
		recommendation: view.recommendation,
	};
	return JSON.stringify(payload);
};
```

### `src/formatters/csv.ts`

```ts
import type { Formatter } from "./types.ts";

const escapeCsv = (value: string): string => `"${value.replace(/"/g, '""')}"`;

export const formatCsv: Formatter = (view) =>
	[String(view.score), view.trend, escapeCsv(view.recommendation)].join(",");
```

### `src/formatters/markdown.ts`

```ts
import type { Formatter } from "./types.ts";

const escapeCell = (value: string): string => value.replace(/\|/g, "\\|");

export const formatMarkdown: Formatter = (view) =>
	`| ${view.score} | ${view.trend} | ${escapeCell(view.recommendation)} |`;
```

### `src/formatters/sparkline.ts`

```ts
import type { Formatter } from "./types.ts";

const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
const WIDTH = 8;

export const formatSparkline: Formatter = (view) => {
	const clamped = Math.max(0, Math.min(100, view.score));
	const level = Math.min(BARS.length - 1, Math.floor((clamped / 100) * BARS.length));
	return BARS[level].repeat(WIDTH);
};
```

### `src/formatters/report.ts`

```ts
import type { Formatter } from "./types.ts";

export const formatReport: Formatter = (view) =>
	[
		"Habit report",
		`  Score:          ${view.score}`,
		`  Trend:          ${view.trend}`,
		`  Recommendation: ${view.recommendation}`,
	].join("\n");
```

### `src/formatters/registry.ts`

```ts
import type { Formatter } from "./types.ts";
import { formatCompact } from "./compact.ts";
import { formatJson } from "./json.ts";
import { formatCsv } from "./csv.ts";
import { formatMarkdown } from "./markdown.ts";
import { formatSparkline } from "./sparkline.ts";
import { formatReport } from "./report.ts";

export const formatters = {
	compact: formatCompact,
	json: formatJson,
	csv: formatCsv,
	markdown: formatMarkdown,
	sparkline: formatSparkline,
	report: formatReport,
} as const satisfies Record<string, Formatter>;

export type FormatterKey = keyof typeof formatters;

export const formatterKeys = Object.keys(formatters) as FormatterKey[];

export function format(key: FormatterKey, view: Parameters<Formatter>[0]): string {
	return formatters[key](view);
}
```

### `src/index.ts` (CLI wiring; minimal change to existing file)

```ts
import { summarizeHabitWeek } from "./habit-insights.ts";
import { formatters, formatterKeys } from "./formatters/registry.ts";

const summary = summarizeHabitWeek({
	completedDays: 4,
	previousCompletedDays: 3,
	targetDays: 5,
	streakDays: 3,
});

console.log(`habit score: ${summary.score}`);
console.log(`trend: ${summary.trend}`);

for (const key of formatterKeys) {
	console.log(`[${key}] ${formatters[key](summary)}`);
}
```

### `test/formatters.test.js` (broad integration test — C8)

```js
import test from "node:test";
import assert from "node:assert/strict";
import { formatters, formatterKeys, format } from "../src/formatters/registry.ts";

const SAMPLE_VIEWS = [
	{ score: 86, trend: "improving", recommendation: "Keep the streak visible." },
	{ score: 0, trend: "declining", recommendation: "Recover, with \"quotes\" and | pipes." },
	{ score: 100, trend: "steady", recommendation: "Maintain the routine." },
];

test("registry exposes every formatter exactly once under a unique key", () => {
	const expected = ["compact", "json", "csv", "markdown", "sparkline", "report"];
	assert.deepEqual([...formatterKeys].sort(), [...expected].sort());
	assert.equal(formatterKeys.length, new Set(formatterKeys).size);
	assert.equal(formatterKeys.length, expected.length);
});

test("every formatter is total and pure: non-empty string, never throws", () => {
	for (const view of SAMPLE_VIEWS) {
		for (const key of formatterKeys) {
			let out;
			assert.doesNotThrow(() => {
				out = format(key, view);
			});
			assert.equal(typeof out, "string");
			assert.ok(out.length > 0, `${key} produced empty output`);
			// purity: identical input → identical output
			assert.equal(format(key, view), out);
		}
	}
});

test("json formatter round-trips the view fields", () => {
	for (const view of SAMPLE_VIEWS) {
		const parsed = JSON.parse(formatters.json(view));
		assert.equal(parsed.score, view.score);
		assert.equal(parsed.trend, view.trend);
		assert.equal(parsed.recommendation, view.recommendation);
	}
});

test("csv row has a stable column count", () => {
	// The recommendation is the only free-text field and is always the quoted final
	// column, so commas inside it live after the last structural comma. Splitting on
	// the first two commas yields exactly score, trend, and the quoted remainder.
	for (const view of SAMPLE_VIEWS) {
		const row = formatters.csv(view);
		const firstComma = row.indexOf(",");
		const secondComma = row.indexOf(",", firstComma + 1);
		assert.ok(firstComma > 0 && secondComma > firstComma);
		const cols = [
			row.slice(0, firstComma),
			row.slice(firstComma + 1, secondComma),
			row.slice(secondComma + 1),
		];
		assert.equal(cols.length, 3);
		assert.equal(cols[0], String(view.score));
		assert.equal(cols[1], view.trend);
		assert.ok(cols[2].startsWith('"') && cols[2].endsWith('"'));
	}
});

test("markdown row is a single valid table row", () => {
	for (const view of SAMPLE_VIEWS) {
		const row = formatters.markdown(view);
		assert.ok(!row.includes("\n"));
		assert.ok(row.startsWith("|") && row.endsWith("|"));
		// 3 data cells => 4 unescaped pipes
		assert.equal((row.match(/(?<!\\)\|/g) || []).length, 4);
	}
});

test("sparkline length is stable for a given score", () => {
	for (const view of SAMPLE_VIEWS) {
		const a = formatters.sparkline(view);
		const b = formatters.sparkline({ ...view, recommendation: "different text" });
		assert.equal([...a].length, [...b].length);
		assert.equal([...a].length, 8);
	}
});
```

> Note on the per-formatter tests (C1..C6): each formatter also ships a small dedicated
> test file (`test/formatters-compact.test.js`, etc.) asserting the same per-card
> invariant (non-empty, no-throw, plus the formatter's specific property). They are
> omitted here for brevity but are part of the gold end-state — the integration test
> above is the *broad* C8 card, not a substitute for the per-leaf tests. A model that
> ships only the integration test loses points on fan-out completeness but is not failing
> if every formatter is independently exercised somewhere.

## Why this is correct

| Invariant (from spec) | Enforcement in the reference |
| --- | --- |
| Shared contract defined once | `types.ts` is the single source of `HabitView` / `Formatter`; every leaf imports only it. |
| No formatter depends on another | Each `src/formatters/*.ts` imports `./types.ts` and nothing else from the folder. The only fan-in is `registry.ts`. |
| Formatter is pure & total (non-empty string, never throws) | Every formatter is a single expression over the view's three fields — no I/O, no mutation, no `throw`, no partial cases. Integration test asserts non-empty + no-throw + identical-output-for-identical-input across edge views (score 0, 100, quotes, pipes). |
| JSON round-trips view fields | `formatJson` serializes exactly `{score, trend, recommendation}`; test `JSON.parse`s and compares each field. |
| CSV stable column count | Fixed 3-field `join(",")` with the free-text recommendation quoted/escaped, so embedded commas never add columns. |
| Markdown single valid row | One `\n`-free string `\| .. \| .. \| .. \|`; pipes inside text escaped; test checks delimiters + 4 unescaped pipes + no newline. |
| Sparkline stable length for a given score | Fixed `WIDTH = 8` repeat; length depends only on `WIDTH`, independent of score/text; test compares lengths across views. |
| Registry exposes every formatter once, unique key, no collisions | Object literal keyed by name `satisfies Record<string, Formatter>`; `Object.keys` count == `Set` size == 6; test asserts exact key set and uniqueness. |
| Existing tests stay green | `habit-score.ts` / `habit-insights.ts` untouched; CLI change is additive. `HabitView` is structurally identical to `HabitInsightSummary`, so `summary` flows into formatters with no adapter. |
| No new dependencies | Pure TS + `node:test` + `node:assert` only; `package.json` untouched. |
| Project conventions | ESM with explicit `.ts` import extensions (NodeNext + `allowImportingTsExtensions`); tabs; `strict` clean; tests are `.js` importing `.ts` via `--experimental-strip-types`. |

## Quality rubric (for judging a model's output)

### Must-pass invariants (any miss ⇒ not EXCELLENT; a hard miss ⇒ FAILING)

1. `npm test` passes, including the pre-existing `test/habit-score.test.js`.
2. Exactly six formatters exist, each in its own file under `src/formatters/`.
3. **No formatter imports another formatter** (only the registry fans in).
4. A single shared contract (`HabitView` + `Formatter`) defined once and reused.
5. Every formatter is pure & total: non-empty string for valid views, never throws.
6. Registry exposes each formatter exactly once under a unique key (no collisions).
7. JSON round-trips; CSV stable column count; markdown single valid row; sparkline stable length.
8. No new runtime/dev dependencies; `package.json` unchanged.

### Dimension scoring

**Correctness**
- EXCELLENT: All eight must-pass invariants hold; tests are deterministic and assert the *property* (round-trip, column count, length stability), not just a frozen golden string.
- MEDIOCRE: Formatters work but tests are weak (e.g. only check `typeof === "string"`), or one property invariant (round-trip / column count / length) is unasserted though the code happens to be correct.
- FAILING: A formatter throws on an edge view (empty/0/100/quotes/pipes), produces empty output, JSON doesn't parse, or existing tests break.

**Fan-out shape**
- EXCELLENT: One shared base, six sibling leaves with zero leaf-to-leaf edges, registry depends on all six, integration depends on the registry — matches the edge list above.
- MEDIOCRE: Six formatters present but one or two depend on a sibling, OR the registry doesn't depend on all six, OR fewer/more than six leaves while still parallel.
- FAILING: Formatters serialized into a chain (each builds on the previous), or collapsed into one file / one mega-formatter — the wide fan-out is gone.

**Shared-base consistency**
- EXCELLENT: `HabitView`/`Formatter` defined once; every leaf and the registry use that exact type; all six conform to `Formatter` (enforced via `satisfies`).
- MEDIOCRE: Contract duplicated/re-declared in multiple files but structurally identical, or types loosened to `any`/`string`-keyed without `satisfies`.
- FAILING: Formatters have divergent signatures (different param shapes/return types) so they aren't interchangeable.

**Determinism**
- EXCELLENT: No `Date.now()`, `Math.random()`, object-key-order hazards, locale-dependent formatting, or unstable Map/Set iteration; identical input ⇒ byte-identical output; tests assert this.
- MEDIOCRE: Deterministic in practice but relies on incidental ordering (e.g. depends on `Object.keys` order without pinning it).
- FAILING: Any nondeterministic output (timestamps, random ids, locale number formatting) reaching a test assertion.

**Minimalism**
- EXCELLENT: Each formatter is a small pure expression; the registry is a thin map; CLI change is additive; no dead code, no unused exports, no speculative options/config.
- MEDIOCRE: Extra plumbing (base classes, option bags, a CLI arg parser nobody asked for) that still works.
- FAILING: Sprawling refactor of `habit-score.ts` / `habit-insights.ts`, or rewrites unrelated files.

**No added deps**
- EXCELLENT: Standard library only (`node:test`, `node:assert`); `package.json` byte-unchanged.
- MEDIOCRE: Adds a dev-only formatting helper but keeps it isolated (still a deduction).
- FAILING: Adds any npm dependency (csv lib, table lib, chalk, etc.) or changes the test runner.

### Common small-model pitfalls

- **Serializing the leaves** (CSV importing JSON, report importing compact) — kills the fan-out; the single most common failure for this preset.
- **Collapsing into one file** with a `switch (kind)` mega-formatter instead of six independent files.
- **Re-declaring `HabitView` per file** instead of importing the shared contract, then letting the shapes drift.
- **Forgetting the explicit `.ts` import extension** — works in some toolchains but breaks NodeNext + `--experimental-strip-types` here.
- **Authoring tests as `.ts`** — the runner globs `test/*.test.js`; `.test.ts` files are silently never run.
- **Golden-string brittleness** — asserting an exact emoji string / exact JSON byte layout instead of the property, so the test is correct-but-fragile (MEDIOCRE) or wrong about key order.
- **CSV column drift** — not quoting the free-text recommendation, so a comma in the text silently adds a column and breaks the stable-count invariant.
- **Sparkline length tied to score** (e.g. `repeat(score)`) instead of a fixed width — violates "stable length for a given score… across scores" intent and can explode output.
- **Throwing on edge inputs** (score 0 or 100, empty recommendation) — violates totality.
- **Touching `package.json` / adding deps** for table or CSV formatting.
- **Modifying the existing tests or core scoring** to make things "fit."

## Acceptance

- Command: `npm test` → `node --experimental-strip-types --test test/*.test.js`.
- Pre-existing assertions still pass: `calculateHabitScore({completedDays:4,targetDays:5,streakDays:3}) === 86`; `summarizeHabitWeek(...)` deep-equals the improving summary.
- New `test/formatters.test.js` (and per-leaf tests) pass, asserting:
  - registry key set is exactly `{compact, json, csv, markdown, sparkline, report}`, unique, size 6;
  - every formatter returns a non-empty string and never throws across edge views (score 0/100, quotes, pipes);
  - JSON output `JSON.parse`s and each of `score`/`trend`/`recommendation` matches the input;
  - CSV row always has 3 columns;
  - markdown row is single-line, pipe-delimited, 4 unescaped pipes;
  - sparkline output length is constant (8) regardless of score or text.
- `npm run build` (`tsc --noEmit`) is clean under `strict`.
- `git status` shows only additions under `src/formatters/` and `test/`, plus the additive edit to `src/index.ts`; no changes to `package.json`, `tsconfig.json`, `habit-score.ts`, `habit-insights.ts`, or the existing test.
