# 07 - Regulated Banking Ledger and Loan Servicing Platform

Complexity tier: 7/20
Expected decomposition size: 24-28 dependent implementation cards before coding.
Domain pressure: double-entry accounting, loan amortization, payments, compliance holds, statements, reconciliation, audit controls.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a banking-grade ledger and loan servicing foundation for a small credit union. It should support deposit accounts, loan schedules, payment posting, fees, holds, statements, and reconciliation with the rigor expected of financial systems.

## Foundation release scope
The first serious buildout must include:
- Customer, account, ledger journal, ledger entry, loan, amortization schedule, payment, fee, hold, statement, reconciliation batch, and compliance case models.
- Immutable double-entry ledger with balanced journals, effective dates, posting dates, reversals, and correction entries.
- Loan amortization engine supporting fixed-rate loans, extra principal, late payment, fee assessment, grace periods, and payoff quotes.
- Payment allocation policy that applies funds to fees, interest, principal, escrow, or suspense according to configurable rules.
- Statement generation with opening balance, activity, interest, fees, minimum due, and disclosure placeholders from deterministic fixtures.
- Bank-file reconciliation workflow that matches expected postings, detects duplicates, stale items, amount mismatches, and manual review cases.
- Compliance holds for KYC review, suspicious activity workflow, account freeze, and audit note retention.
- Seed portfolio with current loans, delinquent loans, reversed payments, and reconciliation breaks.

## Architecture requirements
- Make the ledger the source of truth and derive balances from entries, not mutable account totals.
- Separate loan math, posting policy, compliance workflow, and statement formatting.
- Use decimal money types or exact integer minor units; no floating point currency math.
- Make every posting decision explainable and auditable.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Financial systems need reversals and corrections; deleting transactions is unacceptable.
- Posting date and effective date can differ and both matter.
- Loan payoff and delinquency status depend on allocation policy and accrued interest.
- Reconciliation should surface uncertainty, not force unsafe matches.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Every journal balances and balance derivation is tested from entries.
- Loan schedules handle extra principal, late payments, reversals, and payoff quotes.
- Reconciliation fixtures produce matched, duplicate, stale, and review outcomes.
- Statements render deterministic machine-readable summaries.
- The project passes npm test without external banking APIs.

## Explicit non-goals
- Do not store account balance as an editable field.
- Do not use JavaScript floating point for money.
- Do not fake compliance holds as simple labels.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is *conservation of money under an immutable, append-only ledger*: across the entire history of the system, for every currency, Σ(debits) ≡ Σ(credits), every account balance is a pure fold over never-mutated entries, and *every* correction is a new compensating entry — never an edit or a delete. If that invariant can ever be broken, nothing else the platform does can be trusted.**

A real bank ledger is not a database with a `balance` column; it is the original event-sourced system. An accountant from 1494 (Pacioli) and a modern ledger engineer are describing the same machine: an append-only log of balanced movements from which all state is derived, where the *only* legal way to undo the past is to record a new, offsetting present. The double-entry ledger is "the original immutable event architecture" — corrections are compensating events, never mutations ([Modern Treasury — Immutability and Double-Entry](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v); [HN: double-entry as immutable event architecture](https://news.ycombinator.com/item?id=39493669)). This extension makes that the spine and treats the loan engine, payments, reconciliation, and compliance as *derivations that must respect it*.

## B0. The grading rubric (what actually makes this hard)

Not "how many features." It is, in priority order:

1. **Conservation & immutability** — can you *prove*, by replaying the entire entry log, that money was never created or destroyed and no posted entry was ever mutated or deleted?
2. **Exact arithmetic** — is every monetary amount an integer minor unit (or a fixed-scale decimal), with every rounding step *explicit, attributed, and conserved* (penny-perfect allocation; no silent floating-point drift)?
3. **Bitemporal correctness** — does the system distinguish *effective date* (when the economic event is deemed to occur) from *posting date* (when it was recorded), and can it answer "what did the books say as of date X, as known on date Y"?
4. **Auditability under SOX** — does *every* state-changing action carry an immutable audit record (who/what/when/why), and is segregation-of-duties enforced so the maker is never the checker?
5. **Idempotency** — can the same payment instruction be delivered twice (retry, redelivered bank file, replayed message) and post exactly once?

Everything below serves these five.

## B1. The double-entry kernel (the foundation under the foundation)

Build this before any loan or payment logic exists. It is ~the first 8 cards.

- **Entry & Journal types.** A `JournalEntry` is an append-only, immutable record: `{ entryId, journalId, accountId, direction: 'debit'|'credit', amount: MinorUnits, currency, effectiveAt, postedAt, sequence }`. A `Journal` (a.k.a. transaction) is a set of entries that **must balance per currency**: within each currency group, Σ(debits) == Σ(credits). A mixed-currency journal balances *within* each currency, never across ([Modern Treasury — balanced postings, per-currency](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v)). A journal that does not balance is *rejected at construction* — it can never enter the log.
- **Money is exact.** All amounts are integer minor units (cents) or a fixed-scale `Decimal`; floating-point currency math is a hard non-goal (already stated — now property-tested). A `Money` value object carries its currency and forbids cross-currency arithmetic without an explicit FX entry.
- **Balances are derived, never stored.** `balanceOf(accountId, asOfEffective, asKnownAt)` is a fold over entries filtered by `effectiveAt <= asOfEffective AND (discardedAt IS NULL OR discardedAt > asKnownAt)`, using **account_version / sequence** numbers to make the fold deterministic and reproducible even when many entries share a timestamp ([Modern Treasury — version-based precision](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v)). There is no `accounts.balance` field; the explicit non-goal "do not store account balance as an editable field" becomes a structural guarantee.
- **Corrections are reversals, not edits.** Two legal correction shapes: (a) **full reversal** — append a mirror journal with debits/credits swapped, linked by `reversesJournalId`; (b) **correcting entry** — reverse the wrong journal *and* post the right one, both linked. A `discardedAt` watermark marks an entry as logically reversed *as of a known time* without ever deleting it. Deleting an entry is impossible by construction (no delete path exists in the API).
- **Pending → posted lifecycle.** Entries may be `pending` (mutable, e.g. an authorization hold not yet settled) and become **immutable on posting**; once posted, the only forward path is reversal ([Modern Treasury — pending-to-posted immutability](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v)).

## B2. Bitemporality: effective date vs posting date vs known-at (the seam agents hand-wave)

This is the part a naive build gets wrong, and it is load-bearing for audit and statements.

- **Two axes of time, always.** *Effective date* = the date the economic event is deemed to occur (a payment effective 2026-06-30 received and recorded 2026-07-02). *Posting/transaction date* = when the entry actually entered the books. Both matter, both are stored, neither is derived from the other ([spec already states this; grounded in standard ledger practice](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v)).
- **Backdated and future-dated postings.** A payment can be *backdated* (effective in a closed period) — which must trigger interest recalculation from the effective date, not the posting date, and must be flagged for review if it crosses a statement boundary. A *future-dated* posting must not affect today's available balance.
- **As-of queries.** The ledger answers `balanceAsOf(effectiveDate, knownAtDate)` — "what did the books say as of June 30, as we knew it on July 5?" This is the literal definition of a bitemporal ledger and the only honest way to reproduce a historical statement after later corrections. **Property test:** a correction posted in July must change `balanceAsOf(June 30, July 31)` but must NOT change `balanceAsOf(June 30, June 30)` — the past, as known at the time, is immutable.

## B3. The loan servicing engine (real day-count conventions, penny-exact)

The amortization engine must implement *named, real* conventions, not one hard-coded formula. The choice of convention materially changes who owes what.

- **Day-count conventions as first-class strategies:** `30/360` (residential mortgages — every month treated as 30 days, year as 360), `Actual/360` (commercial loans — actual days over a 360-day year, which *overcharges* relative to nominal: a stated 6% effectively charges ~6.083% in a non-leap year), and `Actual/365 / Actual/Actual` (consumer loans) ([PropertyMetrics — 30/360 vs Actual/360 vs Actual/365](https://propertymetrics.com/blog/30-360-vs-actual-360-vs-actual-365/); [Wikipedia — Day count convention](https://en.wikipedia.org/wiki/Day_count_convention)). The same loan under three conventions yields three different principal/interest splits for an identical payment — and the engine must reproduce each.
- **Amortization math.** Standard fully-amortizing payment `M = P · i / (1 − (1+i)^(−n))`; per period, `interest = balance · periodicRate(convention)`, `principal = payment − interest`, `balance −= principal` ([Bankrate — amortization](https://www.bankrate.com/mortgages/amortization-calculator/); [hughcalc — mortgage formula](https://www.hughcalc.org/formula.php)). **Every interest accrual posts as a ledger journal** (debit interest-receivable, credit interest-income), so the loan balance is *also* derived from the ledger, not a parallel mutable number.
- **Negative amortization** as a real, bounded case: when a period's payment is less than accrued interest, the unpaid interest is **capitalized** into principal (balance grows), subject to a **neg-am cap** (commonly ≤125% of original) and a **recast** (commonly 60 months) ([Wikipedia — Negative amortization](https://en.wikipedia.org/wiki/Negative_amortization); [CFPB — what is negative amortization](https://www.consumerfinance.gov/ask-cfpb/what-is-negative-amortization-en-103/)).
- **Delinquency state machine.** Days-Past-Due drives buckets `Current → 1–29 → 30–59 → 60–89 → 90+ DPD`, with **roll-rate** transitions between buckets, derived purely from scheduled-vs-actual postings on the ledger ([Precisa — calculating DPD](https://precisa.in/blog/calculating-dpd-in-finance/); [dv01 — delinquency calculations](https://dv01.freshdesk.com/support/solutions/articles/42000103129-delinquency-calculations)). Grace periods, late-fee assessment, and re-aging are explicit transitions, each producing an audit event.
- **Payoff quotes** are a per-effective-date computation: principal + accrued-but-unposted interest to the quote date + outstanding fees − suspense balance, with a good-through date.

## B4. The payment allocation waterfall (configurable, conserving, idempotent)

Payment posting is where money meets policy. It must be a *pure, ordered allocation* whose output is a balanced journal.

- **Allocation order is a configurable policy** (e.g. fees → accrued interest → principal → escrow → suspense), not hard-coded. Different products and different regulators mandate different orders; the engine takes the order as data ([the spec's payment-allocation requirement, grounded in servicing practice](https://www.consumerfinance.gov/)). Regulation Z / TILA and Reg E shape which orders are permissible and what must be disclosed ([NCUA — TILA/Reg Z](https://ncua.gov/regulation-supervision/manuals-guides/federal-consumer-financial-protection-guide/compliance-management/lending-regulations/truth-lending-act-regulation-z); [CFPB — TILA](https://files.consumerfinance.gov/f/201503_cfpb_truth-in-lending-act.pdf)).
- **Suspense / unapplied funds.** A payment that cannot be fully allocated (partial payment, unknown loan, overpayment) lands in a **suspense account** rather than being force-fit or dropped ([camt.053 reconciliation — suspense handling](https://docs.findock.com/docs/reconciliation/processing-camt-053-files)). Suspense is a real ledger account; conservation still holds.
- **Idempotency is structural.** Every inbound payment instruction carries a client-or-source **idempotency key**; the poster checks-then-posts under a uniqueness constraint, returning the prior result on a duplicate rather than posting twice ([Medium — idempotent payment APIs](https://medium.com/codeelevation/how-to-design-idempotent-payment-apis-for-reliable-financial-transactions-24513f6420ae); [GeeksforGeeks — Airbnb idempotency, avoiding double payments](https://www.geeksforgeeks.org/system-design/airbnb-idempotency-avoiding-double-payments-in-a-distributed-payments-system/)). Exactly-once is impossible in general; **idempotency achieves "effectively once"** by making the duplicate harmless — that is the honest framing.

## B5. ISO 20022 + reconciliation (the real bank-file world)

Ground the reconciliation workflow in the *actual* messages banks exchange, behind deterministic fixtures.

- **Message fixtures, not the network.** Model `pain.001` (customer credit-transfer initiation), `pain.002` (status report), `pacs.008` (FI-to-FI credit transfer), `camt.054` (debit/credit notification), and `camt.053` (end-of-day bank-to-customer statement) as parsed fixtures ([ISO20022.org — message definitions](https://www.iso20022.org/iso-20022-message-definitions); [FedNow ISO 20022 readiness guide](https://explore.fednow.org/resources/readiness-guide-iso-20022.pdf); [Nacha pain.001 credit guide](https://www.nacha.org/system/files/2023-08/NACHA_ISO20022_Guide_pain.001_credit%2008-09-23.pdf)).
- **EndToEndId traceability is the spine of reconciliation.** The `EndToEndId`, assigned by the originator in `pain.001`, **must survive every transformation** — every internal boundary, every format conversion — all the way to the `camt.053` statement entry ([Medium — complete map of ISO 20022](https://medium.com/@amitlokare/the-complete-map-of-iso-20022-8469a57b38c4)). It is the primary reconciliation key; structured `camt.053` data lifts auto-match rates to 85–95% vs 50–60% for unstructured statements ([invoicedataextraction — MT940 vs camt.053](https://invoicedataextraction.com/blog/mt940-camt053-bank-statement-format-guide)).
- **Reconciliation outcomes are explicit and uncertainty-preserving:** `matched` (EndToEndId + amount agree), `amount-mismatch`, `duplicate` (same EndToEndId seen twice — dedupe, don't double-post), `stale` (expected posting never arrived within its window), `unmatched → suspense`, and `manual-review` (ambiguous; surfaced, never auto-resolved). The spec's rule "reconciliation should surface uncertainty, not force unsafe matches" becomes typed outcomes with reasons.

## B6. SOX-grade audit & segregation of duties (the controls spine)

Financial systems are regulated; the audit trail is a product feature, not logging.

- **Totality of audit.** *Every* state-changing action — journal post, reversal, payment allocation, fee assessment, hold placement, rate change, payoff quote, statement issuance — emits exactly one immutable audit event with actor, role, timestamp, before/after reference, reason, and approval source. SOX §§302/404/409 require an **immutable audit trail for every change: who and when** ([MetricStream — SOX IT controls](https://www.metricstream.com/insights/sox-it-controls.htm); [Pathlock — SOX compliance](https://pathlock.com/blog/sox-compliance/)).
- **Segregation of duties (maker–checker).** The user who *initiates* a high-impact action (a manual reversal, a write-off, a compliance-hold release) must not be the one who *approves* it — "the person who approves payments should not be the same person who writes the checks" ([Onapsis — SAP ITGC/SOX](https://onapsis.com/blog/mastering-sap-itgc-sox-compliance/)). Enforced as a typed authority gate, with a `four-eyes` requirement above configurable thresholds.
- **Compliance holds are real workflow, not labels** (the explicit non-goal). A KYC-review or SAR (suspicious-activity) hold is a state machine with ownership, due dates, escalation, and an audit note retention period; while held, an account's debit capability is gated. A frozen account can still *receive* but not *disburse*.

## B7. The deterministic test strategy

- **Virtual clock + seeded run.** No `Date.now()`. Accruals, DPD aging, statement cycles, hold expiries, and reconciliation windows all read an injected clock the tests advance explicitly. A "servicing day" is a tick.
- **The ledger IS the event log.** Crash-recovery and reproducibility are free: state is a fold over the entry log; a snapshot is a memoized fold; a test can replay the whole log and re-derive identical balances.
- **Golden statements + golden schedules.** Canonical fixtures: a current loan, a delinquent loan rolling 30→60→90 DPD, a loan with extra-principal payments, a reversed payment, a neg-am loan hitting its cap, and a reconciliation batch with one of each outcome (matched/duplicate/stale/mismatch/review). Each produces a machine-readable golden artifact.

## B8. Adversarial & edge-case fixture pack (ship the hard cases in the repo)

- **The duplicate bank file.** The same `camt.053` is ingested twice; not one cent double-posts (EndToEndId dedupe).
- **The retried payment.** The same payment instruction arrives three times under one idempotency key; it posts exactly once.
- **The backdated payment across a statement boundary.** A payment effective in a *closed* period; interest recalculates from the effective date and the affected statement is flagged for re-issue — without mutating the already-issued statement (a *corrected* statement is a new artifact).
- **The penny-rounding adversary.** A payment that splits across fees/interest/principal/escrow where naïve rounding would lose or create a cent; the allocator must conserve to the cent (the residual goes to a defined sink, audited).
- **The unbalanced journal.** A constructed journal whose debits ≠ credits is *rejected* and never enters the log.
- **The maker-checker bypass attempt.** A user tries to approve their own reversal above threshold; the authority gate refuses and audits the attempt.
- **The float-drift trap.** A fixture exercises amounts (e.g. 0.1 + 0.2) that would drift under floating point; the exact-money type makes it impossible.
- **The reversal-of-a-reversal.** Reversing an already-reversed journal must net to zero and remain fully traceable.

## B9. Property-based / invariant tests (the true acceptance bar)

Beyond example tests, assert these as properties over randomized sequences of operations:

1. **Conservation of money** — after *any* sequence of postings/reversals/allocations, for every currency, Σ(all debits) == Σ(all credits). Money is only ever moved between accounts, never created or destroyed ([Modern Treasury — money conservation](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v)).
2. **Per-journal balance** — every journal that exists in the log balances per currency (rejected ones never entered).
3. **Immutability** — no posted entry's amount/direction/account/effectiveAt ever changes across the run; the only mutations allowed are appending entries and setting `discardedAt`/`postedAt` watermarks. (Differential test: hash every posted entry; the hash set is append-only.)
4. **Balance = fold** — `balanceOf(account)` always equals the independent re-fold of that account's entries; there is no other source of truth.
5. **Bitemporal monotonicity of the known past** — for any `(effectiveDate, knownAt)`, once computed, the value never changes when *later* corrections are added (only `knownAt` ≥ the correction's posting time sees them).
6. **Idempotency** — replaying any payment instruction with the same idempotency key yields one posting and an identical result.
7. **Totality of audit** — every state-changing action has exactly one audit event; every audit event corresponds to a real action (differential test against the operation log).
8. **Allocation conservation** — Σ(allocated to fees/interest/principal/escrow/suspense) == payment amount, exactly, to the cent.

## B10. The concrete first vertical slice (the on-ramp — build THIS first, ~24–28 cards)

Prove the spine end-to-end before breadth:

1. **The double-entry kernel** (B1): Money value object, immutable Entry/Journal, balance-as-fold, reversal/correction, pending→posted. With invariants #1–#4 green.
2. **Bitemporal queries** (B2): effective vs posting vs known-at, `balanceAsOf`. With invariant #5.
3. **One loan, end-to-end:** originate → build amortization schedule under a *named* convention → post scheduled accruals as journals → accept a normal payment through the **allocation waterfall** (B4) → accept an extra-principal payment → miss a payment and roll a DPD bucket → reverse a payment → produce a payoff quote. The loan balance is *derived from the ledger*.
4. **Idempotent payment intake** (B4) with the retry + duplicate-file fixtures. Invariants #6, #8.
5. **One reconciliation batch** from a `camt.053` fixture (B5) producing matched/duplicate/stale/mismatch/review outcomes via EndToEndId.
6. **The audit + maker-checker spine** (B6) with the totality invariant #7 and one segregation-of-duties refusal.
7. **One golden statement** (opening balance, activity, interest, fees, minimum due) reproducible bitemporally.

If that slice holds, compliance workflows, more conventions, more message types, and the UI are all breadth on a proven, conserving spine.

## B11. Domain knowledge-debt to track (surface, don't bluff)

- **Which payment-allocation orders are legally mandated** for which product types under Reg Z/Reg E and state law — *expert-review-needed*; the engine ships configurable orders and flags that the default is illustrative ([CFPB — TILA/Reg Z](https://files.consumerfinance.gov/f/201503_cfpb_truth-in-lending-act.pdf)).
- **APR computation to TILA tolerances** — the regulatory APR (with finance-charge inclusions and rounding rules) is *not* the nominal rate; computing it to legal tolerance is its own expertise and is marked as debt, not faked ([NCUA — Reg Z](https://ncua.gov/regulation-supervision/manuals-guides/federal-consumer-financial-protection-guide/compliance-management/lending-regulations/truth-lending-act-regulation-z)).
- **SAR/CTR thresholds and KYC/BSA-AML rules** — the suspicious-activity and currency-transaction reporting thresholds are regulated and change; modeled as a rule pack with an expert-review checkpoint, never hard-coded as truth.
- **Tax/escrow treatment, charge-off and re-aging policy, statement disclosure language** — placeholders with explicit debt items.
- **Convention edge cases** (end-of-month rules for 30/360 variants; leap-year handling for Actual/Actual) — enumerated as known-uncertain and tested against published examples ([Day count convention — variants](https://en.wikipedia.org/wiki/Day_count_convention)).

## B12. Why this is a great !Klein challenge

It is the cleanest possible test of **determinism under hard invariants with weak models**. The defining property (money conservation over an immutable, bitemporal, exact-arithmetic ledger) is *unforgiving and machine-checkable*: a small local model cannot bluff a balanced journal or a penny-perfect allocation — the property test fails instantly. That makes the work **legible to decompose** (kernel → bitemporality → loan → payments → reconciliation → audit, in strict dependency order) and **safe to build with fallible models**, because every step lands against a conservation law rather than a vibe. The reward for getting the spine right is that every later feature — statements, more conventions, compliance workflows, the operator UI — is honest breadth on a foundation that *cannot* silently lose money.

---

## Small-model build guide (3B-ready)

### 1. Glossary & ground rules

**Domain terms**
- **Minor units** — integer cents (or smallest currency division). `$1.23` is stored as `123`. Never use `number` for money; use `bigint` or a fixed-scale wrapper.
- **Journal** — a balanced set of ledger entries, all belonging to one economic event. Every journal must satisfy Σ(debit amounts) = Σ(credit amounts) per currency before it is accepted. Rejected journals are never stored.
- **Entry** — one half of a double-entry move: `{ entryId, journalId, accountId, direction: 'debit'|'credit', amount: bigint, currency: string, effectiveAt: string, postedAt: string, sequence: number }`. Entries are append-only; the `amount` field is never mutated after posting.
- **Effective date** — the calendar date on which the economic event is *deemed to have occurred* (e.g. a payment the member mailed on June 28 effective June 28 even if posted July 2).
- **Posting date** — the calendar date the entry was *recorded* in the system.
- **Known-at date** — the wall-clock date at which you are querying. `balanceAsOf(effectiveDate, knownAtDate)` answers "what would the balance have been on effectiveDate, as known on knownAtDate?"
- **Reversal** — a correcting journal whose debit/credit directions are swapped vs the original, linked by `reversesJournalId`. Never deletes the original.
- **Allocation waterfall** — the ordered policy that splits a payment across fees, accrued interest, principal, escrow, and suspense. Configurable per loan product.
- **Suspense account** — a special ledger account that receives money that cannot be fully allocated (partial payment, overpayment, unknown loan). Suspense is a real account; conservation still holds.
- **Day-count convention** — the formula for computing the periodic interest rate from an annual rate: `30/360` (each month = 30 days, year = 360), `Actual/360` (real days / 360), `Actual/365` (real days / 365).
- **DPD** — days-past-due. Current = 0, 1–29, 30–59, 60–89, 90+ are the delinquency buckets.
- **Idempotency key** — a client-supplied string that uniquely identifies a payment instruction. Duplicate delivery of the same key posts exactly once.
- **EndToEndId** — an ISO 20022 identifier that travels with a payment through every message (pain.001 → camt.053). The primary reconciliation key.
- **Maker-checker** — a segregation-of-duties rule: the user who *initiates* a high-impact action cannot be the one who *approves* it.

**Stack**
- Language: TypeScript (strict mode, no `any`)
- Runtime: Node.js 20+
- Test runner: Vitest (`npm test` = `vitest run`)
- Money math: `bigint` throughout; zero `number` for currency amounts
- Date handling: ISO-8601 date strings (`"2026-06-30"`) compared lexicographically; no `Date.now()`; inject a virtual clock as a `() => string` function
- No external DB, no network calls, no live APIs in tests

**Acceptance command**
```
npm test        # runs vitest run — must be green with no skipped tests
```

**Determinism rules (imperative)**
1. Never call `Date.now()`, `new Date()`, or `Math.random()` anywhere in core modules. Use an injected clock.
2. Never use `number` for money. Use `bigint`.
3. All fixtures live in `src/fixtures/` and are plain TypeScript objects, not fetched from URLs.
4. Every test is pure: same inputs → same outputs, always.

---

### 2. The explicit task graph for the first vertical slice

The first slice targets B10 items 1–4 (double-entry kernel → bitemporality → one loan end-to-end → idempotent payments → reconciliation → audit → statement). Build in strict dependency order.

---

**`S01` — Money value object**
dependsOn: none
files: `src/money.ts`, `test/money.test.ts`

interface:
```ts
export type Currency = string; // e.g. "USD"
export type MinorUnits = bigint;
export interface Money { amount: MinorUnits; currency: Currency; }
export function money(amount: bigint, currency: Currency): Money;
export function addMoney(a: Money, b: Money): Money;  // throws if currencies differ
export function negateMoney(m: Money): Money;          // flips sign
export function zeroMoney(currency: Currency): Money;
export function moneyEq(a: Money, b: Money): boolean;
```

how to implement:
1. Create `src/money.ts`.
2. `money(amount, currency)` returns `{ amount, currency }`.
3. `addMoney` checks `a.currency === b.currency`, throws `"currency mismatch"` otherwise, returns `{ amount: a.amount + b.amount, currency: a.currency }`.
4. `negateMoney` returns `{ amount: -m.amount, currency: m.currency }`.
5. `zeroMoney` returns `{ amount: 0n, currency }`.
6. `moneyEq` returns `a.amount === b.amount && a.currency === b.currency`.
7. Export all.

acceptance: `test/money.test.ts` asserts:
- `addMoney(money(100n,"USD"), money(23n,"USD")).amount === 123n`
- `addMoney(money(10n,"USD"), money(5n,"EUR"))` throws
- `negateMoney(money(50n,"USD")).amount === -50n`
- `moneyEq(money(0n,"USD"), zeroMoney("USD")) === true`
Run `npm test` → green. No I/O, no randomness.

---

**`S02` — Ledger entry & journal types**
dependsOn: `S01`
files: `src/ledger-types.ts`, `test/ledger-types.test.ts`

interface:
```ts
export type Direction = 'debit' | 'credit';
export type EntryStatus = 'pending' | 'posted';

export interface LedgerEntry {
  entryId: string;
  journalId: string;
  accountId: string;
  direction: Direction;
  amount: bigint;       // always positive; sign is in direction
  currency: string;
  effectiveAt: string;  // ISO-8601 date "YYYY-MM-DD"
  postedAt: string;     // ISO-8601 date when recorded
  sequence: number;     // monotonically increasing global sequence
  status: EntryStatus;
  discardedAt: string | null; // set on reversal, never deleted
}

export interface Journal {
  journalId: string;
  entries: LedgerEntry[];
  reversesJournalId: string | null;
  createdAt: string;
}
```

how to implement:
1. Create `src/ledger-types.ts` with these exact interfaces, exported.
2. No logic — types only.
3. In `test/ledger-types.test.ts` import and construct a sample Journal with two entries and assert the fields are present.

acceptance: TypeScript compiles clean (`tsc --noEmit`). `test/ledger-types.test.ts` constructs a sample journal, asserts `journal.entries.length === 2`, and `journal.reversesJournalId === null`.

---

**`S03` — Journal balance validator**
dependsOn: `S01`, `S02`
files: `src/journal-validator.ts`, `test/journal-validator.test.ts`

interface:
```ts
export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateJournalBalance(entries: LedgerEntry[]): ValidationResult;
// Returns ok:true iff for every currency:
//   sum(debits) === sum(credits)
// Returns ok:false with a reason string otherwise.
```

how to implement:
1. Create `src/journal-validator.ts`.
2. Iterate `entries`, accumulate `Map<currency, bigint>` for net balance (debit adds, credit subtracts).
3. If all net balances are `0n`, return `{ ok: true }`.
4. Otherwise return `{ ok: false, reason: "unbalanced: USD net 100" }` (include currency and amount).

acceptance: `test/journal-validator.test.ts` asserts:
- Two entries (debit 100 USD, credit 100 USD) → `ok: true`
- Two entries (debit 100 USD, credit 90 USD) → `ok: false`, reason includes "USD"
- Mixed currencies: (debit 100 USD, credit 100 USD, debit 50 EUR, credit 50 EUR) → `ok: true`
- Mixed currencies, EUR unbalanced → `ok: false`

---

**`S04` — Append-only ledger store**
dependsOn: `S02`, `S03`
files: `src/ledger-store.ts`, `test/ledger-store.test.ts`

interface:
```ts
export interface LedgerStore {
  postJournal(journal: Journal): void;
  // Throws "unbalanced journal" if validateJournalBalance fails.
  // Throws "journal already posted" if journalId exists.
  // Sets all entries' status to 'posted' and assigns postedAt.
  // Never deletes or mutates a posted entry's amount/direction/accountId/effectiveAt.

  allEntries(): ReadonlyArray<LedgerEntry>;
  // Returns all posted entries in sequence order.

  entriesForAccount(accountId: string): ReadonlyArray<LedgerEntry>;
}

export function createLedgerStore(): LedgerStore;
```

how to implement:
1. Create `src/ledger-store.ts` with an in-memory array `entries: LedgerEntry[]`.
2. `postJournal`: call `validateJournalBalance`; throw if `!ok`. Check journalId uniqueness; throw if duplicate. Append entries (status = `'posted'`, `postedAt` set to clock). Mutate no field after append.
3. `allEntries`: return `[...entries]` sorted by `sequence`.
4. `entriesForAccount`: filter by `accountId`.

acceptance: `test/ledger-store.test.ts` asserts:
- Posting a balanced journal stores its entries; `allEntries().length` grows.
- Posting an unbalanced journal throws.
- Posting the same `journalId` twice throws.
- After posting, `allEntries()` returns entries with `status === 'posted'`.

---

**`S05` — Balance-as-fold (simple, then bitemporal)**
dependsOn: `S04`
files: `src/balance.ts`, `test/balance.test.ts`

interface:
```ts
export function balanceOf(
  store: LedgerStore,
  accountId: string,
  currency: string,
): bigint;
// Simple fold: sum all posted, non-discarded entries for the account+currency.
// Debit = +, Credit = - (for asset accounts; callers handle sign convention).
// If no entries, returns 0n.

export function balanceAsOf(
  store: LedgerStore,
  accountId: string,
  currency: string,
  effectiveAt: string,   // only entries with entry.effectiveAt <= effectiveAt
  knownAt: string,       // only entries with entry.postedAt <= knownAt
                         // AND (entry.discardedAt IS NULL OR entry.discardedAt > knownAt)
): bigint;
```

how to implement:
1. Create `src/balance.ts`.
2. `balanceOf`: filter entries by `accountId`, `currency`, `status === 'posted'`, `discardedAt === null`; sum with debit=+ credit=-.
3. `balanceAsOf`: same but also filter `entry.effectiveAt <= effectiveAt` and `entry.postedAt <= knownAt` and `(entry.discardedAt === null || entry.discardedAt > knownAt)`.
4. Both return `bigint`.

acceptance: `test/balance.test.ts` asserts:
- Two debit entries of 100 → `balanceOf` returns `200n`.
- `balanceAsOf` with `effectiveAt` before an entry's effectiveAt excludes that entry.
- `balanceAsOf` with `knownAt` before an entry's `postedAt` excludes it.
- After marking `discardedAt = "2026-07-05"`, `balanceAsOf(…, knownAt="2026-07-04")` still includes the entry; `knownAt="2026-07-06"` excludes it. This is the bitemporal immutability property.

---

**`S06` — Reversal / correction entry**
dependsOn: `S04`, `S05`
files: `src/reversal.ts`, `test/reversal.test.ts`

interface:
```ts
export function buildReversalJournal(
  original: Journal,
  newJournalId: string,
  postedAt: string,
  clock: () => string,
): Journal;
// Returns a new Journal with every entry's direction flipped,
// reversesJournalId = original.journalId,
// new entryIds, same accountIds/amounts/currencies/effectiveAt.

export function markDiscarded(
  store: LedgerStore,
  journalId: string,
  discardedAt: string,
): void;
// Sets discardedAt on all entries belonging to journalId.
// Does NOT delete them.
```

how to implement:
1. Create `src/reversal.ts`.
2. `buildReversalJournal`: copy each entry, swap direction, assign new `entryId` (e.g. `"rev-" + original.entryId`), set `reversesJournalId`.
3. `markDiscarded`: find entries in `store` by `journalId` and set `discardedAt`.

acceptance: `test/reversal.test.ts` asserts:
- `buildReversalJournal` returns a journal with all directions flipped.
- Posting the reversal keeps both journals in the store.
- After `markDiscarded`, `balanceOf` returns `0n` for the account (original + reversal net to zero).
- `allEntries()` still contains both the original and reversal entries (no deletion).

---

**`S07` — Idempotency key registry**
dependsOn: `S04`
files: `src/idempotency.ts`, `test/idempotency.test.ts`

interface:
```ts
export interface IdempotencyStore {
  checkAndReserve(key: string): 'new' | 'duplicate';
  // 'new' = first time seen; marks key as reserved.
  // 'duplicate' = seen before; caller should return prior result without re-posting.
}

export function createIdempotencyStore(): IdempotencyStore;
```

how to implement:
1. Create `src/idempotency.ts` with an in-memory `Set<string>`.
2. `checkAndReserve`: if key is in set return `'duplicate'`; otherwise add to set and return `'new'`.

acceptance: `test/idempotency.test.ts` asserts:
- First call with key `"pay-001"` returns `'new'`.
- Second call with same key returns `'duplicate'`.
- Different key returns `'new'`.

---

**`S08` — Loan schedule types & amortization math**
dependsOn: `S01`
files: `src/loan-types.ts`, `src/amortization.ts`, `test/amortization.test.ts`

interface:
```ts
// src/loan-types.ts
export type DayCountConvention = '30/360' | 'Actual/360' | 'Actual/365';

export interface LoanTerms {
  loanId: string;
  principalMinorUnits: bigint;
  annualRateBps: number;     // basis points, e.g. 600 = 6.00%
  termMonths: number;
  convention: DayCountConvention;
  originationDate: string;   // ISO-8601
}

export interface ScheduledPayment {
  periodNumber: number;
  dueDate: string;
  paymentMinorUnits: bigint;
  interestMinorUnits: bigint;
  principalMinorUnits: bigint;
  remainingBalanceMinorUnits: bigint;
}

// src/amortization.ts
export function buildAmortizationSchedule(terms: LoanTerms): ScheduledPayment[];
// Returns one ScheduledPayment per period.
// All arithmetic in bigint (minor units).
// Periodic rate for 30/360: annualRate / 12.
// Periodic rate for Actual/360: annualRate * (actualDaysInPeriod / 360).
// Periodic rate for Actual/365: annualRate * (actualDaysInPeriod / 365).
// Standard formula: M = P * i / (1 - (1+i)^-n), computed in floating point
//   then rounded to bigint; residual rounding error absorbed in final payment.

export function daysBetween(a: string, b: string): number;
// Returns the number of calendar days from a to b (ISO-8601 strings).
```

how to implement:
1. Create `src/loan-types.ts` with types.
2. Create `src/amortization.ts`.
3. Implement `daysBetween` using `Date.parse` difference in milliseconds divided by 86400000, floored.
4. Implement `buildAmortizationSchedule`:
   a. Compute periodic rate based on convention.
   b. Compute monthly payment `M` as a `number` using the standard formula.
   c. Loop over `termMonths`, computing `interest = balance * periodicRate` as `number`, converting to `bigint` by rounding, then `principal = payment - interest`.
   d. On the last period, set payment = remaining balance + accrued interest (absorbs rounding).
5. Each period's `dueDate` = origination + N months (use `daysBetween` helper for Actual conventions).

acceptance: `test/amortization.test.ts` asserts for a `$12,000` loan, 12% annual, 12 months, `30/360`:
- Schedule has 12 entries.
- All `paymentMinorUnits` values are within ±1 cent of each other (rounding absorbed in last).
- `remainingBalanceMinorUnits` of last entry = `0n`.
- `Σ(interestMinorUnits) + Σ(principalMinorUnits) === 12 * nominal_payment` (within ±12 cents rounding budget).

---

**`S09` — Payment allocation waterfall**
dependsOn: `S01`, `S08`
files: `src/allocation-policy.ts`, `test/allocation-policy.test.ts`

interface:
```ts
export type AllocationBucket = 'fees' | 'interest' | 'principal' | 'escrow' | 'suspense';

export interface AllocationPolicy {
  order: AllocationBucket[];  // e.g. ['fees','interest','principal','escrow','suspense']
}

export interface AllocationResult {
  buckets: Record<AllocationBucket, bigint>;
  // Each key is how many minor units went there.
  // Σ(values) === paymentAmount exactly.
}

export function allocatePayment(
  paymentAmount: bigint,
  outstanding: Partial<Record<AllocationBucket, bigint>>,
  policy: AllocationPolicy,
): AllocationResult;
// Applies paymentAmount to buckets in policy.order.
// For each bucket, takes min(paymentAmount_remaining, outstanding[bucket] ?? 0n).
// Any remainder after all buckets goes to 'suspense'.
// Conservation guarantee: Σ result === paymentAmount.
```

how to implement:
1. Create `src/allocation-policy.ts`.
2. Loop through `policy.order`; apply `min(remaining, outstanding[bucket] ?? 0n)` each time.
3. After the loop, if `remaining > 0n`, add to `suspense`.
4. Assert (in production code, not just tests) that `Σ(buckets values) === paymentAmount`; throw if violated.

acceptance: `test/allocation-policy.test.ts` asserts:
- Payment of 150, outstanding `{fees:50, interest:60, principal:200}` with order `fees→interest→principal→suspense` → `{fees:50n, interest:60n, principal:40n, suspense:0n}`.
- Payment of 50, same outstanding → `{fees:50n, interest:0n, principal:0n, suspense:0n}`.
- Payment of 500 → `{fees:50n, interest:60n, principal:200n, suspense:190n}`.
- Conservation: sum of all result buckets === payment amount for all cases.

---

**`S10` — Post a payment through the ledger**
dependsOn: `S04`, `S07`, `S09`
files: `src/payment-poster.ts`, `test/payment-poster.test.ts`

interface:
```ts
export interface PostPaymentArgs {
  idempotencyKey: string;
  paymentAmount: bigint;
  currency: string;
  effectiveAt: string;
  loanAccountId: string;
  outstanding: Partial<Record<AllocationBucket, bigint>>;
  policy: AllocationPolicy;
  actorId: string;
}

export interface PostPaymentResult {
  status: 'posted' | 'duplicate';
  journalId: string | null;
  allocation: AllocationResult | null;
}

export function postPayment(
  args: PostPaymentArgs,
  store: LedgerStore,
  idempotency: IdempotencyStore,
  clock: () => string,
): PostPaymentResult;
```

how to implement:
1. Create `src/payment-poster.ts`.
2. Check idempotency; if `'duplicate'` return early with `status: 'duplicate'`.
3. Call `allocatePayment`.
4. Build a balanced journal: for each non-zero bucket, one credit entry from `loanAccountId` + one debit to the bucket's ledger account (e.g. `"interest-income"`, `"fees-receivable"`).
5. Call `store.postJournal(journal)`.
6. Return `status: 'posted'`, journalId, allocation.

acceptance: `test/payment-poster.test.ts` asserts:
- A payment posts a journal whose entries balance.
- Same idempotency key twice returns `'duplicate'` and the store has only one journal.
- Allocation amounts match expected waterfall output.

---

**`S11` — Loan DPD state machine**
dependsOn: `S08`
files: `src/dpd.ts`, `test/dpd.test.ts`

interface:
```ts
export type DPDBucket = 'Current' | '1-29' | '30-59' | '60-89' | '90+';

export function computeDPD(
  scheduledDueDate: string,
  lastPaymentDate: string | null,
  asOfDate: string,
): number;
// Returns the number of days past due as of asOfDate.
// If lastPaymentDate >= scheduledDueDate, return 0.
// If lastPaymentDate is null, days past due = daysBetween(scheduledDueDate, asOfDate).

export function dpd_bucket(dpd: number): DPDBucket;
// 0 → 'Current', 1–29 → '1-29', 30–59 → '30-59', 60–89 → '60-89', ≥90 → '90+'
```

how to implement:
1. Create `src/dpd.ts`, import `daysBetween` from `S08`.
2. `computeDPD`: if `lastPaymentDate !== null && lastPaymentDate >= scheduledDueDate` return 0. Otherwise return `max(0, daysBetween(scheduledDueDate, asOfDate))`.
3. `dpd_bucket`: simple if/else chain.

acceptance: `test/dpd.test.ts` asserts:
- Paid on due date → DPD = 0 → `'Current'`.
- 15 days late, no payment → DPD = 15 → `'1-29'`.
- 35 days late → `'30-59'`.
- 95 days late → `'90+'`.

---

**`S12` — Payoff quote**
dependsOn: `S05`, `S08`, `S09`
files: `src/payoff.ts`, `test/payoff.test.ts`

interface:
```ts
export interface PayoffQuote {
  principalOutstanding: bigint;
  accruedInterestUnposted: bigint;
  outstandingFees: bigint;
  suspenseBalance: bigint;       // amount to credit back
  totalDue: bigint;              // principal + accrued - suspense + fees
  goodThroughDate: string;       // same as quoteDate
  quoteDate: string;
}

export function buildPayoffQuote(
  balance: LedgerStore,
  loanAccountId: string,
  scheduleInterestAccruedToDate: bigint,  // already posted accrued interest
  unpostedAccruedInterest: bigint,        // interest accrued but not yet journaled
  outstandingFees: bigint,
  suspenseBalance: bigint,
  quoteDate: string,
): PayoffQuote;
```

how to implement:
1. Create `src/payoff.ts`.
2. Derive `principalOutstanding` from `balanceOf(store, loanAccountId, "USD")`.
3. `totalDue = principalOutstanding + unpostedAccruedInterest + outstandingFees - suspenseBalance`.
4. Return the struct with all fields.

acceptance: `test/payoff.test.ts` asserts with a fixture ledger:
- `totalDue = principalOutstanding + unpostedAccruedInterest + outstandingFees - suspenseBalance`.
- No floating-point values in output.

---

**`S13` — camt.053 reconciliation engine**
dependsOn: `S07`
files: `src/reconciliation.ts`, `src/fixtures/camt053.ts`, `test/reconciliation.test.ts`

interface:
```ts
export type ReconciliationOutcome =
  | 'matched'
  | 'amount-mismatch'
  | 'duplicate'
  | 'stale'
  | 'unmatched'
  | 'manual-review';

export interface CamtEntry {
  endToEndId: string;
  amount: bigint;
  currency: string;
  valueDate: string;
}

export interface ExpectedPosting {
  endToEndId: string;
  amount: bigint;
  currency: string;
  expectedByDate: string;
}

export interface ReconciliationLineItem {
  endToEndId: string;
  outcome: ReconciliationOutcome;
  reason: string;
}

export function reconcileBatch(
  camtEntries: CamtEntry[],
  expected: ExpectedPosting[],
  processedIds: Set<string>,  // previously seen EndToEndIds
  asOfDate: string,
): ReconciliationLineItem[];
```

how to implement:
1. Create `src/reconciliation.ts`.
2. Build a map of `expected` by `endToEndId`.
3. For each `camtEntry`:
   - If `processedIds.has(endToEndId)` → `'duplicate'`.
   - If not in expected → `'unmatched'`.
   - If amounts differ → `'amount-mismatch'`.
   - If `asOfDate > expectedByDate + 30 days` → `'stale'`.
   - Else → `'matched'`.
4. Any expected entry with no matching camt entry → `'stale'` if past due date.
5. Create `src/fixtures/camt053.ts` with at least 5 fixture entries covering all 5 outcomes.

acceptance: `test/reconciliation.test.ts` asserts:
- The fixture batch produces exactly: 1 matched, 1 amount-mismatch, 1 duplicate, 1 stale, 1 unmatched.
- Running the same fixture twice produces identical outcomes (replay determinism).

---

**`S14` — Audit event log**
dependsOn: `S04`
files: `src/audit.ts`, `test/audit.test.ts`

interface:
```ts
export interface AuditEvent {
  eventId: string;
  actorId: string;
  actionType: string;       // e.g. "POST_JOURNAL", "REVERSE_JOURNAL", "PLACE_HOLD"
  targetId: string;         // journalId, loanId, etc.
  timestamp: string;
  reason: string;
  beforeRef: string | null; // reference to prior state (journalId, snapshotId)
  afterRef: string;         // reference to new state
}

export interface AuditLog {
  append(event: AuditEvent): void;
  all(): ReadonlyArray<AuditEvent>;
  forTarget(targetId: string): ReadonlyArray<AuditEvent>;
}

export function createAuditLog(): AuditLog;
```

how to implement:
1. Create `src/audit.ts` with an in-memory array.
2. `append` pushes to the array (no deduplication, no mutation).
3. `all` returns a copy.
4. `forTarget` filters by `targetId`.

acceptance: `test/audit.test.ts` asserts:
- After 3 appends, `all().length === 3`.
- `forTarget` returns only the matching events.
- Appended events are never mutated (deep-equal the original object).

---

**`S15` — Maker-checker authority gate**
dependsOn: `S14`
files: `src/maker-checker.ts`, `test/maker-checker.test.ts`

interface:
```ts
export interface AuthorityGate {
  submitForApproval(
    initiatorId: string,
    actionType: string,
    targetId: string,
    reason: string,
  ): string; // returns pendingActionId

  approve(
    approverId: string,
    pendingActionId: string,
    audit: AuditLog,
    clock: () => string,
  ): { ok: true } | { ok: false; reason: string };
  // Returns ok:false if approverId === initiatorId (self-approval blocked).
  // On success, appends an audit event.
}

export function createAuthorityGate(): AuthorityGate;
```

how to implement:
1. Create `src/maker-checker.ts`.
2. Store pending actions in a `Map<string, { initiatorId, actionType, targetId, reason }>`.
3. `approve`: look up pending action; if `approverId === initiatorId`, return `{ ok: false, reason: "self-approval not permitted" }`; otherwise emit audit event and remove from pending.

acceptance: `test/maker-checker.test.ts` asserts:
- Approver different from initiator → `ok: true`.
- Approver same as initiator → `ok: false`, reason includes "self-approval".
- Approved action appears in audit log.

---

**`S16` — Golden statement fixture**
dependsOn: `S05`, `S08`, `S14`
files: `src/statement.ts`, `src/fixtures/statement-fixture.ts`, `test/statement.test.ts`

interface:
```ts
export interface Statement {
  loanId: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: bigint;
  closingBalance: bigint;
  interestCharged: bigint;
  feeCharged: bigint;
  paymentsReceived: bigint;
  minimumDue: bigint;       // 0n for now; mark as debt to compute
  activityLines: Array<{ date: string; description: string; amount: bigint }>;
}

export function generateStatement(
  store: LedgerStore,
  loanAccountId: string,
  periodStart: string,
  periodEnd: string,
  knownAt: string,
): Statement;
```

how to implement:
1. Create `src/statement.ts`.
2. Opening balance = `balanceAsOf(store, loanAccountId, "USD", periodStart, knownAt)`.
3. Closing balance = `balanceAsOf(store, loanAccountId, "USD", periodEnd, knownAt)`.
4. Activity lines = entries where `effectiveAt >= periodStart && effectiveAt <= periodEnd && postedAt <= knownAt`.
5. Sum interest/fee/payment lines by `actionType` annotation on entry (use `journalId` prefix convention or a tag field on the entry).
6. `minimumDue = 0n` — mark as knowledge debt.

acceptance: `test/statement.test.ts`:
- Uses `src/fixtures/statement-fixture.ts` (a fixture ledger with known entries).
- Asserts `openingBalance`, `closingBalance`, `activityLines.length` against known values.
- Running the same fixture twice produces identical output (determinism check).

---

**`S17` — Conservation property test**
dependsOn: `S04`, `S10`
files: `test/conservation.property.test.ts`

interface: N/A — this is a property test.

how to implement:
1. Create `test/conservation.property.test.ts`.
2. Write a function `runRandomLedgerSequence(seed: number)`:
   - Build a deterministic sequence of 20–50 journals (using a simple LCG seeded PRNG), each balanced.
   - Post them all.
   - Assert Σ(all debit amounts) === Σ(all credit amounts) for each currency.
3. Run with 5 different seeds in the test.
4. Also test that posting one *unbalanced* journal (debits ≠ credits) is rejected before any entry is stored.

acceptance: All 5 seeds pass; unbalanced journal throws. No I/O, no randomness outside the seeded PRNG.

---

### 3. The decomposition method for the remaining breadth

After the first slice (S01–S17) is green, use this recipe for every remaining feature:

**Recipe for one feature cluster:**
1. Identify the feature's inputs (what domain types does it consume?).
2. Identify the feature's output (what does it produce — a new type, a new store entry, a new report?).
3. Check which existing cards define those types. List them as `dependsOn`.
4. Split the feature into at most 3 cards: (a) types-only, (b) pure logic, (c) ledger-wired integration + test.
5. Write the interface section first (exact TypeScript). Then write the numbered recipe. Then write the acceptance test assertions.
6. Every card must have an acceptance test that runs with `npm test` without any live system.

**Worked example 1 — Compliance hold state machine (B6)**
- Types card `C01`: `HoldStatus = 'under-review'|'frozen'|'released'`; `ComplianceHold = { holdId, accountId, status, ownerId, reason, placedAt, expiresAt, auditNoteRetentionDate }`.
- Logic card `C02` dependsOn `C01`, `S14`: `placeHold(store, audit, clock)`, `releaseHold(holdId, approverId, …)` — `releaseHold` requires maker-checker (from `S15`); a frozen account's debit gate returns `{ allowed: false }`.
- Integration card `C03` dependsOn `C02`, `S10`: `postPayment` checks hold status before posting; test that a frozen account's payment is blocked with a reason.

**Worked example 2 — Delinquency roll-rate report (B3)**
- Types card `R01`: `DelinquencySnapshot = { loanId, asOfDate, dpd: number, bucket: DPDBucket }`.
- Logic card `R02` dependsOn `S11`, `S05`: `buildPortfolioDelinquencyReport(loans, store, asOfDate)` → `DelinquencySnapshot[]`. Pure function — no DB, no I/O.
- Test card (integrated into `R02`): fixture with a current loan, a 30-DPD loan, a 90-DPD loan. Assert bucket assignments and count.

**Worked example 3 — Negative amortization cap check (B3)**
- Types extension (add to `LoanTerms`): `negAmCapPct: number` (e.g. 125 means 125% of original principal), `recastAtMonth: number`.
- Logic card `N01` dependsOn `S08`: `checkNegAmCap(terms, currentBalance): { breached: boolean; action: 'recast'|'none' }`. When `currentBalance > terms.principalMinorUnits * BigInt(terms.negAmCapPct) / 100n`, set `breached: true`.
- Test: fixture loan with a tiny payment that causes neg-am; assert balance grows; at cap, assert `breached: true`.

---

### 4. Per-task implementation conventions

**Folder layout**
```
src/
  money.ts
  ledger-types.ts
  ledger-store.ts
  journal-validator.ts
  balance.ts
  reversal.ts
  idempotency.ts
  loan-types.ts
  amortization.ts
  allocation-policy.ts
  payment-poster.ts
  dpd.ts
  payoff.ts
  reconciliation.ts
  audit.ts
  maker-checker.ts
  statement.ts
  fixtures/
    camt053.ts
    statement-fixture.ts
test/
  money.test.ts
  ledger-types.test.ts
  ... (one test file per src file)
  conservation.property.test.ts
```

**How to write a test in Vitest**
```ts
import { describe, it, expect } from 'vitest';
import { money, addMoney } from '../src/money.js';

describe('money', () => {
  it('adds same currency', () => {
    const result = addMoney(money(100n, 'USD'), money(23n, 'USD'));
    expect(result.amount).toBe(123n);
  });
  it('throws on currency mismatch', () => {
    expect(() => addMoney(money(10n, 'USD'), money(5n, 'EUR'))).toThrow('currency mismatch');
  });
});
```

**Keeping it deterministic**
- Inject `clock: () => string` everywhere a timestamp is needed. In tests, pass `() => "2026-06-30"`.
- No `Date.now()`, `new Date()`, or `Math.random()` in any `src/` file.
- Use a seeded LCG for the conservation property test (provide the implementation in the test file itself, no external library needed):
```ts
function lcg(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return s; }; }
```

**Definition of done for any card**
1. TypeScript compiles clean: `tsc --noEmit` exits 0.
2. `npm test` is green, including the new test file.
3. No `any` types in `src/`.
4. No `number` used for a money amount in `src/`.
5. No `Date.now()` or `Math.random()` in `src/`.
6. The test file contains at least the assertions listed in the card's acceptance section.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1 — Using `number` for money**
A 3B model will reach for `number` because it is familiar. The test catches it only if the fixture uses amounts that reveal floating-point drift (e.g. `0.1 + 0.2 !== 0.3`). Precaution: enforce `bigint` in the `Money` interface (TypeScript's type system prevents accidental `number` assignment). In `S01`, the type signature `amount: MinorUnits` where `MinorUnits = bigint` means the compiler rejects `number`. Never accept `number` in any function that touches currency.

**Pitfall 2 — Storing balance as a field instead of deriving it**
The model will want to write `account.balance += payment`. The `LedgerStore` interface deliberately has no `account` object with a `balance` field. The model must write `balanceOf(store, accountId, currency)` — a fold. Reinforce this by making `LedgerStore` not expose any mutable `account` type at all.

**Pitfall 3 — Confusing effective date and posting date in the bitemporal query**
A model will conflate the two axes and write `entry.effectiveAt <= knownAt` instead of the two-axis filter. The `S05` acceptance test is explicit: an entry with `effectiveAt = "2026-06-28"` and `postedAt = "2026-07-02"` must appear in `balanceAsOf("2026-07-31", "2026-07-31")` but NOT in `balanceAsOf("2026-06-30", "2026-06-30")`.

**Pitfall 4 — Forgetting to validate journal balance at write time**
A model may validate balance in the test only, not in `postJournal`. The `LedgerStore.postJournal` must call `validateJournalBalance` and throw — so an unbalanced journal can never enter the log, ever, from any call site.

**Pitfall 5 — Implementing allocation order as a hard-coded if/else chain**
The waterfall order must be data-driven (the `AllocationPolicy.order` array). Hard-coding `fees then interest then principal` breaks the "configurable" requirement and will fail a test that uses a different order. Make `allocatePayment` loop over `policy.order`.

**Pitfall 6 — Forgetting the conservation assertion inside `allocatePayment`**
After the loop, `Σ(result buckets)` must exactly equal `paymentAmount`. A model will forget this guard. Add the assertion inside the function body (throw if violated), not just in the test.

**Pitfall 7 — Not handling the `30/360` convention correctly for month-end dates**
Under `30/360`, both month-end dates (28th, 29th, 30th, 31st) have special handling. For the first slice, use the simple formula: treat every month as exactly 30 days and the year as 360. Mark full end-of-month rules as knowledge debt (B11). Do not attempt to implement the ISDA 30/360 variant in the first slice.

**Pitfall 8 — Implementing `camt.053` parsing from scratch**
Fixtures should be plain TypeScript `CamtEntry[]` objects, not XML strings. The spec says "model as parsed fixtures" — never write an XML parser. The fixture in `src/fixtures/camt053.ts` exports a `const` array.

**Pitfall 9 — Forgetting the `discardedAt` check in `balanceOf`**
The simple `balanceOf` (not bitemporal) should also exclude entries whose `discardedAt` is non-null. A model will write the filter for `status === 'posted'` but omit `discardedAt === null`. The reversal test (`S06`) catches this only if the assertion checks `balanceOf` *after* marking the reversal as discarded.

**Pitfall 10 — Missing conservation in the property test seed loop**
A model will write the conservation test using only a few hard-coded journals. The point is to generate 20–50 journals from a seed so the invariant is tested over many configurations. Use the LCG provided in the conventions section and parameterize the loop count.
