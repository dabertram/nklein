# The repair family (projects 57–61)

Five projects whose deliverable is a **repair manifest**, not code the agent designed. A working repository ships
with seeded defects and a frozen behaviour suite; the agent fixes `src/` until the scenarios it claims pass.

Read `grading-contract.md` first — this note only records what is specific to the family.

## The grading mechanism

A repair project would naturally start red, and a red base tree grades nothing (contract §3). So the shipped suite
is **manifest-driven**: `test/repair.test.js` reads `repair/manifest.json` and asserts only the scenario ids listed
in `repaired`. The untouched fixture lists none, so `npm test` is green before the agent starts.

| Rule | Where it lives |
|---|---|
| Strict now | every id in `repaired` is *executed* on each run; an unknown or duplicated id fails and prints the valid ids |
| Coverage later | `"complete": true` demands every scenario the fixture defines, and names the ones missing |
| Anti-tamper (§5) | a sha256 digest over `scenarios/**`, `test/repair.test.js` and `scripts/run-tests.mjs` is recomputed first, on every run, and compared with `test/frozen.json` |
| No answer key (§2) | the verifier holds no expected values: the scenario set, its ids and its assertions are all imported from `scenarios/` at run time |

Scenarios drive the public API over swept or seeded-generated inputs, never one magic value, so a defect cannot be
papered over by special-casing whatever an assertion looks at.

## Re-freezing after an intentional edit

`test/frozen.json` is generated. After deliberately editing a frozen file:

```sh
node scripts/dev-fixtures/repair-freeze.mjs repair-r3     # or --all
```

The tool lives outside the fixtures on purpose — a fixture is copied into the agent's workspace by folder name, so
the agent never receives the thing that would let it re-record the digests. It also records the shipped `src/`
digests, which `repair-r5`'s verifier uses to check that a claimed root cause cites a file the agent really changed.

## The five

| # | Fixture | Difficulty comes from |
|---|---|---|
| 57 | `repair-r1` | three independent defects in one module: an off-by-one, an exclusive comparison where the contract is inclusive, a default argument that contradicts the exported constant |
| 58 | `repair-r2` | three modules whose defects interact — an in-place mutation is *hiding* a stale read, so two green scenarios go red the moment the mutation is fixed alone |
| 59 | `repair-r3` | async: a floating promise, a lost update and a swallowed error. Determinism comes from an injected `io` seam whose `yield()` parks callers the scenario releases one at a time — no timers, no sleeps, no flake |
| 60 | `repair-r4` | boundaries: money that does not conserve, UTF-8 truncation by string unit, a day key that ignores the UTC offset. Three scenarios are green **for the wrong reason** and go red under the obvious shallow patch |
| 61 | `repair-r5` | two regressions in two features with one shared cause. The manifest carries a `rootCause` the verifier checks is specific: it must cite a `src/*.mjs` that exists **and differs from the shipped baseline**, name a declaration from that file, and be prose rather than a label |
