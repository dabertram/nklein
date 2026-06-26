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
