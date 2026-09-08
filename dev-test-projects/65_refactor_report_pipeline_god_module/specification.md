# Expense reporting — refactor brief

## The job

`src/reporting.mjs` turns lines of text into an expense report. It works. It is one function doing five jobs, and
its money formatter has a verbatim twin in `src/receipts.mjs`.

Split it into stages. Change nothing it produces.

## What you may change

Everything under `src/`, and `refactor/manifest.json`. New files are expected.

`src/index.mjs` must keep exporting `buildReport`, `exportReportCsv`, `CATEGORIES` and `renderReceipt`.

## What is frozen

`scenarios/`, `test/refactor.test.js` and `scripts/run-tests.mjs` are evidence, not workspace. `npm test`
recomputes their content digests on every run and fails if any of them moved.

## The behaviour, stated

Confirm each point against the scenarios rather than inferring it from the code.

- Input is one record per line, `category,who,amount`, with surrounding whitespace trimmed. A blank line or one
  starting with `#` is **skipped**, not rejected.
- **Rejection rules, in this reporting order**: wrong field count → `expected three fields`; category not in
  `CATEGORIES` → `unknown category <name>`; empty owner → `missing owner`; amount not matching an optional sign,
  digits and at most two decimals → `bad amount <text>`; a negative amount without `allowRefunds` → `refunds are
  not allowed`. Each rejection carries a **1-based** line number.
- Amounts are held in **minor units**. `options` is optional in every form (absent, `undefined`, `{}`).
- Aggregates come back in `CATEGORIES` order, each with `totalMinor`, `count`, sorted unique `owners`, and
  `averageMinor` rounded to the nearest minor unit.
- The table pads each label to the width of the longest name in `CATEGORIES`, then two spaces, the amount
  right-aligned in 10, two spaces, the count right-aligned in 3. A `TOTAL` row always follows, counting **accepted**
  rows.
- The CSV export has a `category,total,count,owners` header and space-joined owners.
- A receipt is category padded to 8, owner padded to 12, amount right-aligned in 10; a missing category throws
  `TypeError`.

## The deliverable

`refactor/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "addressed": [] }
```

## The goals that count

Listed in full, with reasons, in `refactor/goals.json`. Nothing outside this list is measured.

- **`G1` — no module is longer than 40 meaningful lines.**
- **`G2` — no function is longer than 20 meaningful lines.**
- **`G3` — no function has more than 5 branch points** (`if`, `case`, ternary, `&&`, `||`, `catch`).
- **`G4` — no logic is duplicated across modules** (no five substantive lines shared by two files under `src/`).

Comments and blank lines never count toward a length limit, so reformatting satisfies nothing.

## How your work is checked

1. **Behaviour first.** Every frozen scenario must still pass, whatever your manifest says.
2. **Every goal you list is checked immediately and strictly**, naming the offending module, function or file pair.
   Claiming a goal you have not met is strictly worse than claiming nothing.
3. **Coverage is required only when you set `"complete": true`.**

The untouched fixture passes `npm test`, so the acceptance signal reports *your* work rather than a pre-existing
failure.
