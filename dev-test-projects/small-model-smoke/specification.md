Fix a scoring bug in this tiny TypeScript habit-tracker CLI.

Domain:
- `calculateHabitScore({ completedDays, targetDays, streakDays })` in src/habit-score.ts returns an integer
  0-100. It is the completion ratio (completedDays / targetDays) plus a small streak bonus, scaled to 100.

The bug:
- When a user completes every day AND has a long streak, the streak bonus pushes the score above 100.
  A score over 100 is meaningless and breaks downstream display. The score must be capped at 100.

Required invariant (the acceptance test must assert it):
- For every input, 0 <= calculateHabitScore(...) <= 100.
- A perfect week (completedDays === targetDays) with any streakDays still returns exactly 100, never more.
- An empty or zero target (targetDays <= 0) returns 0 (already handled; keep it).

Constraints:
- Touch only src/habit-score.ts and test/habit-score.test.js. Do not add dependencies.
- Keep the existing passing tests green; add the perfect-score-capped case.