# Subscription Commerce Platform — consolidated policy brief

This is the merged policy brief for the replatform. It was assembled from four sources — the 2024 commerce policy,
the security review's standing requirements, the finance team's retention memo, and the current campaign's
promises — and nobody has yet reconciled them with each other. That reconciliation is the job.

Every numbered clause carries a machine-readable constraint in backticks at the end of it, in the form
`` `[key = value]` ``. The key is the thing the clause constrains; the value is what this clause says it must be.
The keys were normalised when the sources were merged, so two clauses that carry the same key really are talking
about the same setting — that normalisation is the only thing anybody has done to these documents so far.

A value of `unspecified` means the source deliberately left the setting open.

## Clauses

**C-01** Every customer-facing page must answer within 400 ms at the 95th percentile, measured at the edge.
`[page.p95_latency_ms = 400]`

**C-02** Delivery is free once the basket reaches £49. `[shipping.free_threshold_minor = 4900]`

**C-03** A customer may hold at most three active subscriptions at one time. `[subscription.max_active = 3]`

**C-04** Refunds below £50 are approved automatically, with no human in the loop, because the review queue was the
single largest source of customer complaints. `[refund.auto_approve.max_minor = 5000]`

**C-05** An order confirmation email goes out within one minute of payment capture.
`[email.confirmation_delay_s = 60]`

**C-06** A password must be at least twelve characters long. `[password.min_length = 12]`

**C-07** A session is closed after fifteen minutes without activity. `[session.idle_timeout = 15m]`

**C-08** Search results are ordered by relevance and never by paid placement. `[search.paid_placement = false]`

**C-09** The free-delivery threshold is £49 — the figure printed on the packaging, on the website footer and in
the app. `[shipping.free_threshold_minor = 4900]`

**C-10** A gift card may be split across at most five orders. `[giftcard.max_splits = 5]`

**C-11** No refund may leave the platform without a named reviewer approving it first. This was written after the
2024 incident and the security review considers it non-negotiable. `[refund.auto_approve.max_minor = 0]`

**C-12** Order records are kept for ninety days and then deleted. `[data.retention_days = 90]`

**C-13** A basket that has not changed for thirty days is emptied. `[basket.abandon_after = 30d]`

**C-14** Delivery is free once the basket reaches £25 — the figure the current campaign promises, in print, until
the end of the quarter. `[shipping.free_threshold_minor = 2500]`

**C-15** Stock figures shown to customers may be up to five minutes stale. `[stock.max_staleness = 5m]`

**C-16** How long a session may sit idle before it is closed is a decision for the security review, which has not
reported. `[session.idle_timeout = unspecified]`

**C-17** A customer may request their data at any time and must receive it within thirty days.
`[dsar.response_days = 30]`

**C-18** Finance keeps order records for thirteen months, because the year cannot be closed without them.
`[data.retention_days = 400]`

**C-19** Password length is whatever the identity provider enforces; we have never written our own figure down.
`[password.min_length = unspecified]`

**C-20** Every price shown to a customer includes VAT. `[price.vat_included = true]`

## Notes from the merge

These are notes, not clauses, and they constrain nothing. The finance memo behind C-18 predates the retention
policy behind C-12 by about a year, and neither team has seen the other's document. The campaign behind C-14 was
signed off by marketing on the assumption that the threshold in C-02 was a technical default rather than a
commitment. The security review that C-16 defers to is the same review that produced C-11. None of that tells you
what the answer should be; it tells you who has to be in the room.
