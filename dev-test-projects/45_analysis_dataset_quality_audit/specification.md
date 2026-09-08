# Freight Export Data-Quality Audit — analysis brief

## The job

`input/shipments.csv` is one month of shipment records exported from a freight platform. `input/carriers.csv` is
the carrier reference table that export is supposed to agree with. Both are READ-ONLY evidence. Your job is to
measure how far the export departs from its own rules. You are not asked to clean, repair or load anything, and
you must not edit anything under `input/`.

Both files are plain CSV: a header row, then data rows, no quoted fields and no embedded commas. **Row numbers are
1-based over the data rows** — the first row after the header is row 1.

## The deliverable

`analysis/data-quality.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "violations": [] }
```

`violations` holds **one entry per rule the dataset breaks** — not one per offending row. Each entry has:

| Field | Meaning |
|---|---|
| `rule` | One of the four rule names below. Nothing else is accepted. |
| `column` | The column that rule is about (the table below fixes it). |
| `count` | The exact number of data rows that break the rule. Not an estimate, not a sample. |
| `exampleRows` | At least two distinct 1-based row numbers that really do break it. |
| `why` | At least twelve characters on what the violation costs a consumer of this data. |

Set `"complete": true` only when every rule the dataset breaks is recorded.

## The four rules

These are the only rules that count. A defect outside them is out of scope for this audit — do not report it,
because an unrecognised rule name fails the check.

| `rule` | `column` | A row breaks it when… |
|---|---|---|
| `duplicate_primary_key` | `shipment_id` | its `shipment_id` occurs more than once in the file. **Every** such row counts, so an id used three times contributes three rows, not one. |
| `out_of_range` | `weight_kg` | its numeric weight falls outside `0 < weight_kg <= 30000`. |
| `wrong_type` | `delivered_at` | the cell is non-empty and is not a full ISO-8601 UTC instant of the form `YYYY-MM-DDTHH:MM:SSZ`. An empty cell is legitimate — that shipment has not been delivered. |
| `referential_break` | `carrier_id` | its `carrier_id` is not one of the ids defined in `input/carriers.csv`. |

## How your work is checked

`npm test` runs a verifier that re-reads both CSVs and recomputes each rule's offending-row set on every run. It
is a checker, not an answer key: it stores no counts and no row numbers.

1. **Every violation you record is checked immediately and strictly.** A rule paired with the wrong column, a
   `count` that is not the exact number of offending rows, an `exampleRows` entry that is clean or out of range,
   fewer than two examples, more examples than the count admits, a repeated rule, or a thin `why` all fail the
   suite. The count failure tells you which rule is wrong — it does not tell you the answer.
2. **Coverage is required only when you set `"complete": true`.** At that point every rule the dataset breaks must
   be present, and the failure message names the rules that are missing.

So the suite stays green while you work, breaks the moment you record a number you have not actually computed, and
breaks again if you declare completion early.

## How to plan this

One card per rule is the natural decomposition, and each card should end with that rule's entry recorded and the
suite green. Resist the temptation to eyeball the file: 312 rows is exactly the size where sampling feels safe and
is not. A first card that writes a scratch script to parse the CSV once and answer "how many rows satisfy this
predicate" is worth more than four careful readings — but keep any such scratch work out of `input/`. Reserve the
last card for the completeness pass before you set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
