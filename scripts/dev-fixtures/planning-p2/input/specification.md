# Warehouse Stock Ledger — service specification

An append-only stock ledger for a single warehouse: goods in, picks out, adjustments, reservations and the
valuation report the finance team signs off on. One process, one embedded store, no external services.

Every obligation below names the module its implementation belongs in, written as `[module: <path>]`. That
annotation is part of the design, not decoration: two obligations that name the same module are two facets of one
piece of code, and they are built together or they are built twice.

## Obligations

- **OBL-01** — Quantities MUST be held as integers in the item's stocking unit; a fractional quantity is rejected
  at the boundary, never rounded. [module: src/stock/quantity.js]
- **OBL-02** — Adding two quantities of different stocking units MUST fail with both units named in the error.
  [module: src/stock/quantity.js]
- **OBL-03** — Subtracting below zero MUST fail rather than produce a negative on-hand; the shortfall is reported.
  [module: src/stock/quantity.js]
- **OBL-04** — Unit conversion (each ↔ case ↔ pallet) MUST be exact, and a conversion that would not divide evenly
  MUST fail rather than truncate. [module: src/stock/quantity.js]
- **OBL-05** — A bin location MUST be identified by aisle, bay and level, and MUST compare equal only when all
  three match. [module: src/stock/location.js]
- **OBL-06** — A location MUST declare whether it is pickable or reserve storage, and picks from reserve storage
  MUST be refused. [module: src/stock/location.js]
- **OBL-07** — The movement ledger MUST be append-only: an existing entry is never rewritten, and a correction is a
  new compensating entry. [module: src/stock/ledger.js]
- **OBL-08** — Every ledger entry MUST carry a monotonic sequence number, and a gap in the sequence MUST be
  detectable on read. [module: src/stock/ledger.js]
- **OBL-09** — On-hand for an item and location MUST be derived by folding the ledger, never by reading a cached
  total that could drift. [module: src/stock/ledger.js]
- **OBL-10** — A reservation MUST hold stock for a named order without moving it, and MUST expire after a
  configurable window. [module: src/stock/reservation.js]
- **OBL-11** — Available-to-promise MUST be on-hand minus live reservations, and MUST never go negative.
  [module: src/stock/reservation.js]
- **OBL-12** — When available-to-promise for an item falls below its reorder point, a replenishment suggestion MUST
  be raised exactly once per crossing. [module: src/stock/replenish.js]
- **OBL-13** — A cycle count MUST record counted quantity against derived on-hand and produce a variance, without
  itself changing stock. [module: src/stock/cyclecount.js]
- **OBL-14** — Approving a cycle-count variance MUST post a compensating adjustment through the ledger, attributed
  to the approver. [module: src/stock/cyclecount.js]
- **OBL-15** — The goods-in endpoint MUST accept a purchase-order line, validate the location is receivable, and
  post a receipt movement. [module: src/api/receipts.js]
- **OBL-16** — The pick endpoint MUST refuse a pick that exceeds available-to-promise, naming the shortfall.
  [module: src/api/picks.js]
- **OBL-17** — The adjustment endpoint MUST require a reason code from a closed list and reject an unknown code.
  [module: src/api/adjustments.js]
- **OBL-18** — Valuation MUST support weighted average cost, recomputed from the ledger for the reporting period.
  [module: src/report/valuation.js]
- **OBL-19** — The valuation report MUST be reproducible: the same period over the same ledger MUST produce a
  byte-identical report. [module: src/report/valuation.js]
- **OBL-20** — Every mutating operation MUST write an audit record naming the actor, the operation and the ledger
  sequence it produced. [module: src/audit/trail.js]

## Non-goals

Multi-warehouse transfers, carrier integration, customs paperwork and a picking UI are all out of scope.
