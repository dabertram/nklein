# Claims Intake Service — specification v1.4

This is the specification the service was built to and the one three broker integrations are written against. It
has been stable for eleven months.

Each requirement carries a `Contract` marker. `external` means the requirement is visible to somebody outside this
team — a broker integration, the customer app, the regulator's export. `internal` means it is ours: we can change
how it works without anybody outside noticing, as long as the external behaviour above it is preserved.

## Requirements

**REQ-01** A claim submission is accepted over HTTPS only, and a submission over plain HTTP is refused before any
of its body is read.
`Contract: external`

**REQ-02** Every accepted submission is written to the intake journal before the response is sent, so a claim that
was acknowledged is never lost to a crash.
`Contract: internal`

**REQ-03** A submission is acknowledged with a claim reference of the form `CLM-` followed by ten digits, and that
reference is stable for the life of the claim.
`Contract: external`

**REQ-04** Submissions are de-duplicated on the broker's own idempotency key for twenty-four hours; a repeat within
that window returns the original claim reference rather than creating a second claim.
`Contract: internal`

**REQ-05** A claim carries a policy number, a loss date, a loss description and between zero and twenty
attachments.
`Contract: external`

**REQ-06** Attachments are virus-scanned before they are made available to a handler, and a claim whose attachment
fails the scan is held rather than rejected.
`Contract: internal`

**REQ-07** The intake service assigns a claim to a handling queue using the policy's product code and the loss
date.
`Contract: internal`

**REQ-08** A broker may poll a claim's status and receives one of `received`, `in_assessment`, `settled` or
`declined`.
`Contract: external`

**REQ-09** Claims received outside business hours are queued and assigned when the next business day opens.
`Contract: internal`

**REQ-10** The intake journal is retained for seven years and is append-only.
`Contract: internal`

**REQ-11** A broker without an API integration may submit a claim by fax to the intake bureau, which keys it in on
the broker's behalf.
`Contract: external`

**REQ-12** A submission larger than 50 MB in total is refused with a size error naming the offending attachment.
`Contract: external`

**REQ-13** Every state transition of a claim is recorded with the actor that caused it and the time it happened.
`Contract: internal`

**REQ-14** The regulator's monthly export contains every claim received in the month, with attachments excluded.
`Contract: internal`
