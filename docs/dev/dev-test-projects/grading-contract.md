# Dev-test grading contract

Every dev-test project is graded by ONE shell command (`npm test`) running offline, with no model judging the
result. That constraint is what makes these projects worth anything, and it is also what makes the non-build
families hard: a findings list, a spec, a refactor and a test suite are not naturally checkable by a test runner.

This document is the contract every project outside the original *build* family follows. Read it before authoring
one. The reference implementation is `scripts/dev-fixtures/analysis-a1` + `dev-test-projects/21_analysis_unchecked_error_audit`.

## 1. The deliverable is a structured artifact

Not prose. A JSON file (findings, requirements, a plan, a repair manifest) that the fixture ships in a **valid,
empty** form. Prose may accompany it, but the graded object is the artifact.

## 2. The verifier derives its truth from the input, at run time

Never write expected line numbers, counts, ids or answers into the test. A reader of the verifier must not be able
to read the answers off it. Re-implementing its rules must amount to doing the work itself.

This is the difference between a checker and an answer key, and it is not negotiable: an answer key in the fixture
turns every one of these projects into a copying exercise.

## 3. The base tree is GREEN, and progress is manifest-driven

This is the rule that costs the most to get right, and the reason is mechanical.

A repair or refactor project "naturally" starts red — that is the whole task. But nklein's acceptance gate samples
the BASE tree when acceptance fails (`P0.LAZYBASELINE`) and waives failures it finds there as pre-existing, so the
card is then delivered on the reviewer's verdict alone. A project that starts red therefore grades nothing: every
card is waived, and a worker that fixes nothing still merges.

> **Since 2026-09-08 the waiver also records INHERITED DEBT** (`src/core/inherited-debt.ts`): the breakage is owned,
> counted, fed to the architect as required work, and closed only when the command genuinely goes green. That fixes
> the *product* behaviour — nklein no longer carries pre-existing shortcomings silently. It does not change this
> rule for FIXTURES: a graded fixture still starts green, because grading needs the acceptance signal to mean "this
> agent's work is correct" rather than "this workspace owes debt". Keep the two apart.

So every project starts green, and the agent's own declarations drive what gets enforced:

- The empty deliverable is valid ⇒ `npm test` passes on the untouched fixture.
- **Strict now:** anything the agent records is validated immediately and unforgivingly. A wrong location, an
  unknown enum value, a duplicate, a thin justification, or a claim the derivation does not support fails the suite.
  A wrong entry must be strictly worse than a missing one.
- **Coverage later:** the full requirement set is demanded only when the agent sets `"complete": true`, and the
  failure message must name exactly what is missing.

For a repair-shaped family this means the frozen suite is driven by the manifest: scenarios the agent lists as
attempted are asserted for real; `"complete": true` demands all of them.

## 4. Fairness: the brief enumerates what counts

The verifier can only detect what its rules cover. If the input contains a genuine problem the verifier cannot see,
an agent that finds it gets failed for being right. That is a bug in the fixture, not a hard mode.

So: the brief names the exact classes, categories or scenario ids that count, and the input contains no genuine
instance outside them. The reference fixture had one such case seeded and it was removed for this reason.

## 5. Anti-tamper in EVERY family, not only where the grader ships tests

The first cut of this rule said anti-tamper was needed "where the fixture ships the tests that grade the work
(repair, refactor, test-authoring)". That was wrong, and the gap was live in ten fixtures until 2026-09-08.

**Every** fixture ships its verifier, so weakening the verifier is always a one-line pass. And any family whose
verifier DERIVES its truth from shipped evidence — analysis and specification, by rule 2 — has a second, quieter
hole: deleting a problem from the evidence shrinks the truth set, so a short answer passes as complete. Proven on
`analysis-a1`: changing `parseInt(raw)` to `parseInt(raw, 10)` in the input made the unguarded verifier pass 3/3
with that defect no longer required.

So: `input/` (or whatever holds the evidence — `spec-s4` also keeps its conformance oracle under `candidates/`,
and an oracle that can be edited will agree with any check you write), everything under `test/`, and
`scripts/run-tests.mjs` have their content digests recorded in `test/frozen.json` and recomputed on every run. The
guard lives in its own `test/frozen.test.js` and is inside its own frozen set, so editing the guard changes the
guard's digest.

Keeping the guard in its own file is what lets it survive a *deleted* evidence file: the verifier dies on `ENOENT`
while it is still importing, but `node --test` runs each file in its own process, so the guard still reports which
path went missing.

What no file in the workspace can do is defend itself. Everything `npm test` executes — the guard, the verifier,
the runner, `package.json` — is writable by the agent, so replacing those files with no-ops passes: proven
2026-09-14 on every contract fixture, 42 of 42, with the evidence doctored underneath. The in-tree digest catches an
agent that edits the evidence and leaves the guard alone; it cannot catch one that rewrites the guard.

So the anchor lives outside the workspace (P1.SELFGRADED). Before any acceptance command runs, the acceptance
verifier reads the manifest — `test/frozen.json`, or test authoring's `test/frozen-digests.json` — **on the task's
base commit**, and refuses a delivery that changes any path it lists, the manifest itself, `package.json` or
`scripts/run-tests.mjs`, as `frozen_evidence_modified` (`src/core/frozen-evidence-guard.ts`). The runtime records
that commit before the agent starts, and git objects are content-addressed, so nothing the agent does can move it.
With the guard, the verifier and the runner provably untouched, the in-tree guard is trustworthy again, and it
catches what no manifest can list: a file added under a frozen directory.

That makes the manifest mandatory: **every contract fixture ships one naming each grader it ships and its runner,
with current digests**, and `test/runtime/dev-fixture-frozen-manifests.test.ts` refuses a fixture without it. One
residual stays open, and no file-level check pretends otherwise: a family that executes the agent's deliverable
inside the grader cannot stop that code from subverting the grader in-process.

State it in the brief, and say *why* — an agent who understands that the evidence is the thing being reasoned
about will not want to edit it anyway.

## 6. Offline and dependency-free

Plain ESM, `node:test` + `node:assert/strict`, run by the fixture's copied `scripts/run-tests.mjs`. Never add a
dependency; the sandbox has no network and never will.

## 7. `project.json` is strict

Exactly `id, title, acceptanceCommand, agentId, startInPlanMode, fixtureTemplate, tier, tags`. An extra key is
rejected by the registry schema. `id` must equal the folder name and `acceptanceCommand` must be `npm test`.

## 8. Prove four states before you call a fixture done

Not three. Paste the command output:

1. untouched fixture ⇒ green;
2. a deliberately WRONG entry ⇒ fails, with a message naming what is wrong;
3. a correct partial entry ⇒ green;
4. `"complete": true` with something missing ⇒ fails, naming what is missing.

Then restore the empty deliverable.

## The families

| Family | Deliverable | What the verifier derives |
|---|---|---|
| Build | Working code + tests | The suite the agent wrote, plus the project's own acceptance |
| Analysis | Findings artifact | The defect/anomaly set, recomputed from the evidence |
| Specification | Requirements / API / delta artifact | Coverage of the brief's obligations, internal consistency |
| Repair | Repair manifest | Frozen scenarios pass, and the frozen suite is untampered |
| Test authoring | The agent's own suite | The suite must PASS the correct implementation and FAIL every shipped mutant |
| Refactor | Refactor manifest | Behaviour pinned by a frozen golden suite, plus structural assertions |
| Integration | Adapter implementation | A shipped fake service + conformance suite, including error paths |
| Planning | Card-plan artifact | Coverage of the spec's obligations, acyclicity, sizing limits |
| Performance | Optimised implementation | Instrumented operation/allocation COUNTS against a budget, never wall time |
