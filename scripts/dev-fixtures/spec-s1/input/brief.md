# Parcel Returns Desk — product brief

We run a returns desk on behalf of about four hundred small merchants. Today it is three spreadsheets, a shared
inbox and one very patient person; next quarter it has to be a service. This brief is what the business signed off
on. It is written in the language the business uses, which is not the language the system will use — turning it
into something buildable is the job that follows.

Everything below that is numbered is an obligation the desk must meet. Everything else is context: useful for
understanding *why* an obligation exists, but not itself a promise to anybody.

## Actors

These are the only parties the desk recognises. Every obligation belongs to exactly one of them — the party whose
action or need the obligation is about.

- **Shopper** — the person who bought the parcel and wants to send it back.
- **Returns Agent** — one of our staff, working the inspection bay or the exceptions queue.
- **Carrier** — the delivery company that physically moves the parcel and reports scans.
- **Finance System** — the merchant's payment platform, which we call to move money.
- **Auditor** — an internal or external reviewer who reads, but never changes, what the desk did.

## Obligations

**OB-01** When a Shopper opens a return request within thirty days of the delivery scan, the desk issues a prepaid
return label for the parcel and makes it available to the Shopper immediately. Thirty days is the merchant-agreed
window; a handful of merchants have asked for sixty and have been told no.

**OB-02** When a Returns Agent inspects a returned parcel, the desk records a condition grade for it before the
parcel is allowed to leave the inspection bay. Ungraded parcels are how the old spreadsheet lost fourteen thousand
pounds of stock last year.

**OB-03** When the Carrier reports a scan for a parcel travelling on one of our labels, the desk advances that
return's tracking state to match the scan within one minute of receiving it. Shoppers refresh the tracking page
constantly and a stale state generates a support contact almost every time.

**OB-04** When the Finance System accepts an approved refund, the desk pays it back to the payment instrument the
Shopper originally used, and not as store credit — unless the Shopper explicitly asked for store credit when
opening the return.

**OB-05** When a Shopper opens a return request more than thirty days after the delivery scan, the desk declines
the request and tells the Shopper which rule declined it. A decline that does not say why is the single largest
driver of angry replies to the shared inbox, and OB-06 exists because of it.

**OB-06** When a Returns Agent overrides a declined return, the desk records the override against the return with
the agent's identity and the reason they typed. Overrides are legitimate and common; unattributed overrides are
neither.

**OB-07** When an Auditor asks for the history of a return, the desk produces every event that return has ever
had, in the order they happened, including the overrides from OB-06. "Every event" is not negotiable — a partial
history is worse than no history, because it looks complete.

**OB-08** When the Carrier has not scanned a labelled parcel within fourteen days of the label being issued, the
desk cancels that label and tells the Shopper it has been cancelled. Uncancelled labels are a standing liability:
we are billed for them the moment they are finally used.

**OB-09** WITHDRAWN. This obligation described a per-merchant returns cap and has been superseded by OB-11; it is
kept here only so the numbering in the merchant contracts still lines up. Nothing in the system should implement
it.

**OB-10** When the Finance System rejects a refund, the desk puts that refund back on the queue to be retried, and
after the second rejection raises it to a Returns Agent instead of retrying again. The old process retried
forever, quietly.

**OB-11** When a Shopper has opened more than six returns in a rolling ninety-day window, the desk routes their
next return to manual review by a Returns Agent rather than approving it automatically. This is the obligation
that replaced the withdrawn one.

**OB-12** When an Auditor exports a month of returns, the desk leaves the payment instrument details out of the
export entirely. Auditors have never needed them and asking for a redaction pass afterwards is how they end up in
a mailbox.

## Out of scope

**NB-01** Nothing here is an obligation, so nothing here needs a requirement. We are not building the merchant's
storefront, the Carrier's tracking network, or the Finance System. We are not deciding refund eligibility rules
beyond the window in OB-01 and OB-05 — those are the merchant's, and they change without telling us.
