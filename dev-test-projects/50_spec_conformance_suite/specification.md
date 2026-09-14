# Basket Quoting Engine — specification and conformance suite

## The job

`input/brief.md` states six rules the quoting engine must obey — loosely, the way the business states them.
`candidates/conforming/` is the **oracle**: the implementation everyone agrees is correct, so where the prose is
vague, it decides. `candidates/nonconforming/` is another team's attempt: it breaks exactly one of the six rules,
and the brief does not say which. All of that is READ-ONLY evidence — never edit `input/` or `candidates/`.

You produce two things: the specification, and a suite that can tell a conforming implementation from a
non-conforming one.

## The deliverables

**1. `spec/spec.json`** — the rules, pinned down. It already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "rules": [] }
```

Each entry is `{ "id", "statement" }`. `id` is one of the brief's `R-NN` ids. `statement` is at least thirty
characters and must **settle** what the brief left open — the threshold and whether it is inclusive, the rounding
direction, the order of operations. Repeating the brief's own sentence fails: the brief's looseness is the problem
you were given.

**2. `conformance/suite.mjs`** — the suite. It ships as a stub that exports the contract:

- `export const RULES` — the rule ids this suite checks. Every one must be stated in `spec/spec.json`.
- `export function checkConformance(subject)` — handed an implementation's module namespace (`subject.quote`,
  `subject.validate`), returns an array of `{ rule, ok, detail }` with **at least one entry per declared rule**.
  `ok: false` means the subject violates that rule; `detail` records what was observed. Throwing is allowed and
  counts as rejecting the subject.

**Never import anything from `candidates/`.** Comparing an implementation against the oracle is a diff, not a
conformance suite, and the check rejects it.

Set `"complete": true` only when the specification states every rule and the suite discriminates.

## What is frozen

`input/`, `candidates/`, everything under `test/`, and `scripts/run-tests.mjs` are **evidence, not workspace**.
`npm test` recomputes their content digests on every run and fails if any of them moved. Your deliverables are
`spec/spec.json` and `conformance/suite.mjs`; nothing else in the tree is yours to change.

This matters more here than it looks. The verifier DERIVES its truth from the evidence on every run, so deleting a
problem from the input would shrink the truth set and let a short answer pass as complete. Editing the verifier
would do the same in one line. And `candidates/conforming/` is the oracle every check you write is measured
against, so an oracle you could edit would agree with any check at all — which would make the one gate that
catches a wrong check useless. None of these is a shortcut; they simply fail.

## How your work is checked

`npm test` derives the rule ids from the brief, loads both candidates and your suite, and runs your suite against
them. There is no answer key: it does not know which rule the non-conforming candidate breaks, and neither does
this brief.

**Immediately and strictly, on every run:**

1. A rule id the brief does not name, a duplicate, a statement under thirty characters, or a statement copied from
   the brief fails.
2. A `RULES` entry that `spec/spec.json` does not state fails; so does a declared rule the suite never returns a
   result for.
3. An import from `candidates/` fails.
4. **Any check that fails the ORACLE fails the build.** The oracle is correct by definition, so a check it cannot
   pass is a bug in your understanding, and it is caught before it can be used to catch anything else.

**Only once you set `"complete": true`:**

5. Every rule the brief names must be stated, and every stated rule must be checked.
6. Your suite must **reject** `candidates/nonconforming/`. A suite that passes both is worthless.
7. Your suite must **reject** a do-nothing implementation the verifier builds by replacing every one of the
   oracle's exports with a function returning `undefined`. A suite that cannot tell the engine from nothing at all
   is not checking anything — this is what catches a check written to be lenient rather than right.

## How to plan this

The oracle is documentation you can execute; read it before you write a sentence of spec. Then decompose rule by
rule: for each one, settle the boundary in `spec/spec.json` and write its check in the same card, ending with the
suite green. Gate 4 makes this order the cheap one — each check is validated against the oracle the moment you
add it, so a misunderstanding surfaces on the card that created it rather than five cards later.

Spend your thinking on the boundaries, because that is where the other team went wrong and where a lazy suite goes
blind: the brief's closing section is a list of the exact questions that decide it. In particular, a rule about a
ceiling is invisible to any test built from a basket small enough that the ceiling never binds. Reserve the last
card for the discrimination pass — run the suite against the non-conforming candidate yourself, satisfy yourself
that it fails for the right reason, and only then set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
