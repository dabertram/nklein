Build a strictly linear habit-data processing pipeline where each stage consumes the previous stage's typed output.

Expected pipeline (each stage depends on the one before it):
- parse raw entries -> normalize -> validate -> score -> classify trend -> derive recommendation -> format output -> emit summary.
- Each stage lives in its own file and consumes the type produced by the previous stage, so the work cannot be parallelized.
- Add a final end-to-end test that runs the whole pipeline (depends on the last stage).

Stage contract (each stage is a pure function `(input: PrevOutput) => NextOutput`, types living in src/pipeline/):
- parse: `string[] -> RawEntry[]`; normalize: `RawEntry[] -> NormalizedEntry[]`; validate: `NormalizedEntry[] ->
  ValidEntry[]` (drops/flags malformed rows, never throws on bad input); score: `ValidEntry[] -> number` (0-100);
  classifyTrend: `number history -> 'improving' | 'declining' | 'steady'`; recommend: `(score, trend) -> string`;
  format: `Summary -> string`; emit: `string -> { ok: true; output: string }`.

Invariants the end-to-end test must assert (deterministic — same input string array always yields the same summary):
- The pipeline is a total function on well-formed input and degrades gracefully (no throw) on malformed rows.
- The final score is always 0-100; the trend is exactly one of improving/declining/steady.
- Each stage's output type is exactly the next stage's input type — the chain type-checks end to end with no `any`.
- Running the whole pipeline twice on the same input produces identical output (purity / referential transparency).