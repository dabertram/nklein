# Habit Tracker CLI (smoke fixture)

A tiny, real TypeScript CLI for habit scoring. It is the shared starting point for several !Klein dev-test
scenarios (the requested change differs per run).

**`specification.md` is the authoritative product specification** for the requested change — entities,
validation rules, invariants, and acceptance criteria. Read it first and build to it.

## Domain (starting point)

- `src/habit-score.ts` — `calculateHabitScore({ completedDays, targetDays, streakDays }) -> number`: an integer
  0-100 (completion ratio plus a capped streak bonus).
- `src/habit-insights.ts` — `summarizeHabitWeek(...) -> { score, trend, recommendation }`: a reusable weekly
  summary.
- `src/index.ts` — the CLI entry point that prints a summary.

## Ground rules for any change here

- **Deterministic.** Every public function is pure — identical input always yields identical output. No
  randomness, no clock, no network. The acceptance command (`npm test`) must pass offline.
- **Typed.** No `any`. Define entities as TypeScript interfaces and keep functions total.
- **Dependency-ordered, reviewable cards.** Build foundations first (scoring, validation, classification),
  then features that consume them, then CLI output, then tests and docs that depend on what they cover.
- **No new dependencies.** The toolchain is Node's built-in test runner with type stripping.
- **Test-file syntax must match the extension.** Tests may be plain JavaScript (`test/**/*.test.js`) or
  TypeScript (`test/**/*.test.ts`). A `.test.js` file must not contain TypeScript-only syntax such as
  `import type`, `interface`, `type`, `: Type`, `as Type`, or generics. If a test needs TypeScript syntax,
  name it `.test.ts`.
- **Import product code from source.** Test files under `test/` import product modules from `../src/*.ts`.

Run tests with:

```sh
npm test
```
