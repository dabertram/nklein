# Change request CR-2026-Q2 — "Broker Direct"

Six changes, signed off by the product board on 2026-04-02, to be delivered together. Each section states which
requirements of specification v1.4 it touches and what it does to them. **The `Affects:` line is the authoritative
list** — the prose around it often mentions other requirements for context, and mentioning one is not touching it.

An `Action:` of `add` introduces a requirement that specification v1.4 does not have.

### CR-1 — Same-day collection window

Affects: REQ-03, REQ-04
Action: change

Brokers want to quote a collection slot at the point of submission, which means the acknowledgement has to carry
more than a reference. The claim reference format is extended to carry a regional prefix, and the de-duplication
window shortens from twenty-four hours to four, because a broker re-submitting after a slot has been quoted is
asking a different question than one re-submitting a minute later.

### CR-2 — Retire the fax channel

Affects: REQ-11
Action: remove

The intake bureau closes at the end of Q3 and the fax line goes with it. Two brokers still use it; both have been
given a migration date. The keyed-in claims themselves are ordinary claims once they exist, so nothing about how a
claim is journalled or assigned changes — REQ-09's out-of-hours queueing, in particular, is untouched by this and
stays exactly as it is.

### CR-3 — Carrier capacity ceiling

Affects: REQ-15
Action: add

A new requirement: the intake service refuses a submission when the handling queue it would be assigned to is
already over its declared daily ceiling, and tells the broker which queue is full. This is deliberately not folded
into the existing assignment requirement, because the ceiling is a commercial figure that changes monthly and the
assignment rule is not.

### CR-4 — Status vocabulary

Affects: REQ-08
Action: change

Two new statuses, `awaiting_documents` and `withdrawn`, join the four a broker can already see. Every existing
integration switches on this vocabulary, which is the whole reason this change request exists rather than being
done quietly.

### CR-5 — Journal fsync

Affects: REQ-02
Action: change

The journal write becomes an fsync rather than a buffered write. Slower per submission, and the only way to make
the durability claim honest on the new hardware. Nothing outside the service can observe the difference except in
the latency numbers.

### CR-6 — Broker-supplied loss adjuster

Affects: REQ-16
Action: add

A new requirement: a broker may nominate a loss adjuster on submission, and the nomination is carried through to
the handler. This looks similar to REQ-07's queue assignment and was originally drafted as an amendment to it, but
the board split it out because a nomination is advisory and an assignment is not.
