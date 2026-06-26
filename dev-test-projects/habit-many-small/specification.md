Add a large number of tiny, independent, single-purpose helpers to the habit CLI to stress parallel execution.

Expected capabilities:
- Add at least twenty tiny pure helper functions (e.g., clamp, percent, round-half-up, day-of-week, streak-bucket, label-for-band, ...), each in its own small file under src/helpers/ with one focused test.
- Each helper is independent — no helper imports another.
- Add a single barrel card that re-exports every helper (depends on all of them).

Helper contract (every helper is a small, pure, total function with a typed signature and a documented domain):
- e.g. `clamp(value: number, lo: number, hi: number) -> number`, `percent(part: number, whole: number) -> number`,
  `roundHalfUp(value: number) -> number`, `dayOfWeek(index: number) -> string`, `streakBucket(days: number) -> string`,
  `labelForBand(score: number) -> string`. Each helper lives in its own file under src/helpers/ with one focused test.

Invariants the tests must assert (each helper is independently checkable; the barrel just re-exports):
- Every helper is pure and total: defined for its whole documented input domain and never throws on valid input.
- No helper imports another helper (verifiable by inspecting each file's imports) — they are fully parallelizable.
- The barrel re-exports every helper exactly once with no name collisions, and importing the barrel pulls in all of them.