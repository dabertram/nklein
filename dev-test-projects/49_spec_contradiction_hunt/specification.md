# Consolidated Policy Brief — contradiction hunt

## The job

`input/brief.md` is the merged policy brief for a subscription commerce replatform. It was assembled from four
sources — a commerce policy, a security review, a finance retention memo, and a live campaign — and nobody has
reconciled them. It is READ-ONLY evidence. Your job is to find every place where the brief contradicts itself or
leaves a settled question open, and to record the assumption you would proceed on. You must not edit anything
under `input/`, and you are not asked to rewrite the brief.

Each numbered clause ends with a machine-readable constraint in backticks: `` `[key = value]` ``. The keys were
normalised during the merge, so **two clauses carrying the same key really are talking about the same setting**.
A value of `unspecified` means that source deliberately left the setting open.

## What counts as a clash

Only this. A conflict exists between **two clauses that carry the same key and different values** — nothing else
in the brief counts, however uncomfortable it reads.

| The two values… | `kind` |
|---|---|
| are different, and neither is `unspecified` | `contradiction` — both cannot hold |
| are different, and one of them is `unspecified` | `ambiguity` — one source fixed the setting, the other refused to |
| are the same | **not a conflict at all** — two sources agreeing is agreement |

That last row is the one that costs people the build. A key carried by three clauses produces three pairs, and
they do not all have to clash.

## The deliverable

`spec/conflicts.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "conflicts": [], "assumptions": [] }
```

A **conflict** is `{ "clauses": ["C-04", "C-11"], "kind": "...", "why": "..." }` — exactly two distinct clause ids,
a `kind` from the table above, and a `why` of at least twelve characters saying what breaks if both are honoured.

An **assumption** is `{ "conflict": ["C-04", "C-11"], "resolution": "..." }` — the pair it settles, and at least
twenty characters stating what you are proceeding on and why that side wins. One assumption per conflict.

Set `"complete": true` only when every clash is flagged *and* every one carries an assumption.

## How your work is checked

`npm test` runs a verifier that re-reads the brief on every run, groups the clauses by their constraint keys and
derives the clashing pairs itself. It is a checker, not an answer key: it names no clause, no key and no pair, and
it knows nothing about which clauses share a key until it reads them.

1. **Everything you record is checked immediately and strictly.** A pair that does not clash, a real clash filed
   under the wrong `kind`, a clause id the brief does not carry, a pair flagged twice, a thin `why`, an assumption
   against a pair that does not clash, or two assumptions on one pair all fail the suite.
2. **Coverage is required only when you set `"complete": true`.** At that point every clash must be flagged and
   every one resolved; the failure messages name the pairs that are unflagged and the pairs that are unresolved,
   separately.

So the suite stays green while you work, breaks the moment you flag something that does not clash, and breaks
again if you declare completion early.

## How to plan this

Index before you judge: one card that reads every clause and tabulates `clause -> key -> value` turns the whole
job into a lookup, and it is the only way to be sure you have not missed a key carried by clauses fifteen pages
apart. Then work key by key. Do the assumptions in the same card as the conflict they settle — the reason one side
wins is usually sitting in the prose you have just read, and it is much harder to reconstruct later. Reserve the
last card for the completeness pass before you set `"complete": true`.

The brief's closing notes say who wrote what and when. They constrain nothing, but they are where most of the
material for a defensible assumption lives.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
