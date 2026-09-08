# Payments Reconciliation Service — specification

A daily reconciliation between three views of the same money: the bank statement, the card processor's settlement
report, and our own ledger. It matches what it can, ages what it cannot, and hands finance an exception list.

Every obligation names the module its implementation belongs in, written `[module: <path>]`. An obligation whose
implementation consumes another module also says so, written `[uses: <path>]`. Those `uses` annotations are the
import graph of the finished service: whoever builds the consumer needs the module it imports to exist first.

## Obligations

- **OBL-01** — Amounts MUST be held as integer minor units with an explicit currency; arithmetic across currencies
  MUST fail rather than coerce. [module: src/money/amount.js]
- **OBL-02** — Rounding MUST be half-even and applied once, at the point a fractional rate is applied, never
  accumulated across a batch. [module: src/money/amount.js]
- **OBL-03** — A settlement window MUST be a half-open interval in the processor's timezone, and MUST skip
  weekends and configured bank holidays. [module: src/time/window.js]
- **OBL-04** — Every record MUST carry a stable reference id derived from its source and native identifier, so the
  same record read twice yields the same id. [module: src/model/identifiers.js]
- **OBL-05** — The bank statement reader MUST accept the fixed-width export, reject a file whose control totals do
  not match its rows, and name the first offending row.
  [module: src/ingest/bank-statement.js] [uses: src/money/amount.js]
- **OBL-06** — A bank credit and its reversal MUST be read as two records, never netted at ingest.
  [module: src/ingest/bank-statement.js] [uses: src/money/amount.js]
- **OBL-07** — The processor report reader MUST split gross, fee and net, and MUST fail when gross minus fee does
  not equal net. [module: src/ingest/processor-report.js] [uses: src/money/amount.js]
- **OBL-08** — Chargebacks and representments MUST be read with their original transaction reference preserved.
  [module: src/ingest/processor-report.js] [uses: src/model/identifiers.js]
- **OBL-09** — The internal ledger reader MUST read only posted entries, and MUST refuse a period that is still
  open. [module: src/ingest/internal-ledger.js] [uses: src/money/amount.js] [uses: src/model/identifiers.js]
- **OBL-10** — Exact matching MUST pair records that agree on reference id, amount and currency, and MUST pair each
  record at most once. [module: src/match/exact.js] [uses: src/model/identifiers.js]
- **OBL-11** — An exact match MUST record which two sources it joined, so a three-way agreement is visible as two
  pairings, not one. [module: src/match/exact.js] [uses: src/model/identifiers.js]
- **OBL-12** — Fuzzy matching MUST pair records that agree on amount within a configured tolerance and fall in the
  same settlement window. [module: src/match/fuzzy.js] [uses: src/money/amount.js] [uses: src/time/window.js]
- **OBL-13** — A fuzzy match MUST carry a confidence and MUST never be applied where an exact match was available.
  [module: src/match/fuzzy.js] [uses: src/match/exact.js]
- **OBL-14** — Many-to-one settlement MUST be supported: a batch payout MUST be matchable against the set of
  transactions that sum to it. [module: src/match/grouping.js] [uses: src/money/amount.js]
- **OBL-15** — Every unmatched record MUST become an exception carrying its source, amount, age and the closest
  candidate considered. [module: src/recon/exceptions.js] [uses: src/match/exact.js] [uses: src/match/fuzzy.js]
- **OBL-16** — An exception MUST be resolvable with a reason from a closed list, and resolution MUST be
  idempotent. [module: src/recon/exceptions.js] [uses: src/model/identifiers.js]
- **OBL-17** — Exceptions MUST be aged in business days since their source date, not calendar days.
  [module: src/recon/aging.js] [uses: src/time/window.js]
- **OBL-18** — A write-off MUST require an approver, MUST be capped by a configured threshold, and MUST post a
  balancing entry. [module: src/recon/writeoff.js] [uses: src/money/amount.js]
- **OBL-19** — The daily report MUST state matched value, unmatched value and write-off value, and the three MUST
  reconcile to the day's total. [module: src/report/daily-recon.js] [uses: src/recon/exceptions.js]
- **OBL-20** — The daily report MUST break exceptions down by age bucket.
  [module: src/report/daily-recon.js] [uses: src/recon/aging.js]
- **OBL-21** — The exceptions endpoint MUST page deterministically and MUST not repeat or drop a record across
  pages. [module: src/api/exceptions-endpoint.js] [uses: src/recon/exceptions.js]
- **OBL-22** — The upload endpoint MUST accept a statement or a processor report, and MUST reject a second upload
  of the same file as a duplicate.
  [module: src/api/upload.js] [uses: src/ingest/bank-statement.js] [uses: src/ingest/processor-report.js]
- **OBL-23** — Every write-off and every exception resolution MUST be recorded with actor, timestamp and prior
  state. [module: src/audit/recon-trail.js] [uses: src/recon/writeoff.js]
- **OBL-24** — A day MUST be replayable from the stored source files, producing an identical matching outcome.
  [module: src/ops/replay.js] [uses: src/ingest/internal-ledger.js] [uses: src/match/grouping.js]

## Non-goals

Multi-entity consolidation, FX revaluation, a finance UI and real-time streaming reconciliation are out of scope.
