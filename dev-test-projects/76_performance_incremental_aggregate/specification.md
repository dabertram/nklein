# Report view — performance brief

## The job

`src/view.mjs` runs a script of updates and queries and answers every query correctly, by rebuilding the report
from scratch each time. Maintain it instead. Change nothing it returns.

## How cost is measured

Two instrumented probes, both pure and deterministic:

- **`dataset.at(index)`** — reads one original row. Counted.
- **`folder.add(total, delta)`** — combines one number into a running total. Counted.

A budget is a number of calls. Counts are exact and identical on every machine, which is why they are the budget
and wall time is not.

## What you may change

Everything under `src/`, and `performance/manifest.json`. `src/index.mjs` must keep exporting `runScript`.

## What is frozen

`harness/`, `conformance/`, `test/performance.test.js` and `scripts/run-tests.mjs` are evidence, not workspace.
`npm test` recomputes their content digests on every run. Each workload's expected answers are produced by
replaying its script against a plain map, written as the rules read — not copied from a run of the current code.

## The behaviour, stated

`runScript(dataset, folder, steps)` walks `steps` in order and returns the answers to the query steps, in order.

- **`{ kind: "update", row }`** — the row with that `id` replaces any existing row with the same id, or is added.
  It produces no answer.
- **`{ kind: "totals" }`** — one entry per team **that has at least one row**, `{ team, totalMinor }`, sorted by
  team name.
- **`{ kind: "top" }`** — the name of the team with the highest total, ties broken by team name ascending, or
  `null` when there are no rows at all.

**The detail that decides correctness:** a team is in the report because it has rows, not because it has a total. A
team whose last row moves to another team must vanish from `totals()`. Maintaining sums alone cannot express that —
a maintained view needs to know how many rows each team holds.

## The budgets

Listed in full, with reasons, in `performance/budgets.json`.

- **`B1`** — `W1` in at most **60** dataset reads and **100** fold operations. Sixty rows read once, then at most
  two folds per update: take the old amount out of its team, put the new one in.
- **`B2`** — `W2`, the same, with top-team queries. The top team is a fact about totals you already hold.
- **`B3`** — `W3` in at most **60** reads and **140** folds, with forty updates and twenty interleaved queries.

Note what the budgets allow: a query may cost **zero** folds. That is the shape being asked for.

## The deliverable

`performance/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "optimised": [] }
```

## How your work is checked

1. **Behaviour is checked on every run**, whatever your manifest says. A maintained view that drifts from the
   rebuild fails here first, and drifting is the characteristic failure of this design.
2. **Every budget you list is MEASURED**, and the failure prints both counts against their limits.
3. **Every budget is demanded only when you set `"complete": true`.**

The untouched fixture passes `npm test`, because an empty manifest claims nothing while the answers are already
correct.
