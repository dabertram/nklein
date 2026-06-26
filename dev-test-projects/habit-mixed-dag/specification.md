Extend the habit CLI with a feature slice that mixes independent parallel branches, a shared dependency, and join points (a realistic diamond-shaped DAG).

Expected capabilities:
- A shared domain/config module that several features build on.
- Two independent parallel branches built on the shared module: a goals branch and a streak-analytics branch, each with its own implementation and tests.
- A reporting feature that joins both branches.
- Broad tests and a README that depend on the reporting feature.

Module contract (the diamond — shared root, two independent arms, one join):
- Shared root `src/core/config.ts`: `interface HabitConfig { weeklyTargetDays: number }` + a validator. Both arms
  import ONLY from here, never from each other.
- Goals arm `src/goals/`: turns config into goal progress (e.g. `goalProgress(config, completedDays) -> number`).
- Streak-analytics arm `src/analytics/`: derives streak stats (e.g. `streakStats(days: number[]) -> { current; best }`).
- Reporting `src/report/`: `buildReport(goals, analytics) -> Report` — the ONLY module that imports both arms.

Invariants the tests must assert (deterministic; the two arms are independently testable in isolation):
- The goals arm and the analytics arm have no import of one another (the diamond's arms stay parallel).
- Invalid config throws a typed error from the shared validator; both arms rely on already-valid config.
- `buildReport` is a pure join: identical (goals, analytics) inputs always yield an identical Report.
- The report exposes data from BOTH arms (goal progress AND streak stats) — neither arm is dropped at the join.