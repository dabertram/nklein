Implement a mid-complexity habit insights feature in this TypeScript CLI project.

Domain model (existing):
- `calculateHabitScore({ completedDays, targetDays, streakDays }) -> number` (src/habit-score.ts): an integer
  0-100, completion ratio plus a capped streak bonus.
- `summarizeHabitWeek({ ...score input, previousCompletedDays }) -> { score, trend, recommendation }`
  (src/habit-insights.ts): the reusable weekly summary you are extending.

Goal:
- Make `calculateHabitScore` clamp its result to 0-100 (a perfect week with a long streak must return 100).
- Classify the week's `trend` from the completion delta (`completedDays - previousCompletedDays`):
  `improving` when the delta is positive, `declining` when negative, `steady` when zero.
- Produce a short, deterministic `recommendation` string keyed off the trend.
- Update the CLI output (src/index.ts) to print score, trend, and recommendation in a compact human-readable form.

Invariants the acceptance test must assert (deterministic, no randomness):
- 0 <= score <= 100 for every input; a perfect week is exactly 100.
- trend is exactly one of improving | declining | steady and matches the sign of the completion delta.
- The same input always yields the same summary (pure function, stable recommendation text).

Constraints:
- Keep the implementation small and maintainable. Prefer pure functions with typed inputs/outputs.
- Touch src/habit-score.ts, src/habit-insights.ts, src/index.ts, and test/habit-score.test.js.
- Do not add dependencies.