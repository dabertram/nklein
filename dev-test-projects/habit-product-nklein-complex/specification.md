Turn the tiny habit scoring CLI into a more complete, well-typed habit-insights product slice.

Domain entities (define these as typed TypeScript interfaces):
- `HabitScoreInput { completedDays, targetDays, streakDays }` and the existing `calculateHabitScore`.
- `GoalSettings { weeklyTargetDays: number; minStreakForBonus: number }` — validated user configuration.
- `TrendClass = 'improving' | 'declining' | 'steady' | 'insufficient-data'`.
- `ScoreBand = 'low' | 'fair' | 'good' | 'excellent'` derived from the 0-100 score.
- `Recommendation { text: string; reason: string }` derived from (band, trend, goal).

Expected product capabilities:
- Document the current habit score domain model and extension points.
- Add configurable weekly goal settings with validation.
- Extract reusable trend classification with improving, declining, steady, and insufficient-data outcomes.
- Classify the 0-100 score into bands (low/fair/good/excellent) with documented, non-overlapping thresholds.
- Make recommendations depend on score band, trend, and goal configuration.
- Update the CLI text output to print score, trend, and recommendation.
- Add a --json output mode without adding dependencies.
- Expand tests for improving, declining, steady, invalid-input, and perfect-score capped scenarios.
- Add README usage notes for text and JSON output.
- Keep each generated task independently reviewable and machine-checkable.

Validation rules (must be enforced and tested):
- `weeklyTargetDays` is an integer in 1..7; `minStreakForBonus` is an integer >= 0. Invalid settings throw a
  typed error with a clear message — they never silently clamp.
- `insufficient-data` is returned only when there is no prior week to compare against; otherwise the trend is
  one of improving/declining/steady from the completion delta.

Invariants the acceptance test must assert (deterministic — no randomness, no clock, no network):
- 0 <= score <= 100 for every input; a perfect week (completedDays === targetDays) is exactly 100.
- Score bands partition 0..100 with no gaps and no overlaps; every score maps to exactly one band.
- Text output and --json output describe the SAME underlying summary for the same input (no divergence).
- Every public function is pure: identical input always yields identical output (stable recommendation text).