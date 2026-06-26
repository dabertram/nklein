Extend the habit scoring CLI with INDEPENDENT, non-overlapping output formatters that can be built in parallel.

Expected capabilities:
- Add several independent formatters, each in its own file under src/formatters/ with its own test, turning a habit score into a different representation: a compact line, a JSON object, a CSV row, a markdown table row, an emoji sparkline, and a plain-text report.
- No formatter may import or depend on another formatter.
- Add a single registry card that wires every formatter into the CLI (depends on all formatters).
- Add one broad integration test card (depends on the registry).

Shared contract (define once, e.g. in src/formatters/types.ts, so every formatter is interchangeable):
- `interface HabitView { score: number; trend: 'improving' | 'declining' | 'steady'; recommendation: string }`
- `type Formatter = (view: HabitView) => string` — a pure function from the view to a string representation.

Per-formatter invariants the tests must assert (each formatter is pure and total):
- A formatter is total and pure: it returns a non-empty string for every valid HabitView and never throws.
- The JSON formatter emits valid JSON that round-trips back to the same view fields; the CSV row has a stable
  column count; the markdown row is a single valid table row; the sparkline length is stable for a given score.
- Registry invariant: the registry exposes every formatter exactly once under a unique key, with no collisions.