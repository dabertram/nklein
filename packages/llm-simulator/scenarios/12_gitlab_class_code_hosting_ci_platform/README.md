# Scenario set: 12_gitlab_class_code_hosting_ci_platform

GENERATED baseline (scripts/generate-scenario-sets.mts, 2026-07-10) conforming to `packages/llm-simulator/src/scenario/track-types.ts` — the scaled sibling of the hand-authored set 01. This README records scenario provenance; all remaining simulator work is tracked only in `todo.md` H7.4 and D10.5.

- **perfect-run.json** — 1 decompose (38 dependency-linked cards from the spec's foundation scope + hardest-seam sections), per-card worker tracks (read → write real zero-dependency ESM modules + node:test files → run `npm test` → text), per-card review tracks (submit_review approve with summary; a seeded ~8% bounce once with request_changes), 1 chat, any-fallback.
- **flaky-run.json** — decompose reduced to 10 cards; 5 failure tracks (catalog ids in each track's provenance) with scripted recovery; control workers; per-card reviews; any-fallback.

	Wire truths encoded (see packages/llm-simulator/test/request-classifier.test.ts): decompose is class **any** keyed on the seed-only product phrase; worker/review tracks are per-card (sequenceIndex is per-fixture); submit_review carries non-empty `summary`; every tool ladder closes with text. Review bounces use a round-1-specific request-changes track followed by a generic approval track because auxiliary reviewer state resets between rounds.

Generated card content is deliberately dependency-free ESM JavaScript verified by `node --test`, so acceptance is green offline with no install step.
