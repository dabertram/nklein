# Specification fixture — contradiction hunt

`input/brief.md` is the evidence. It is READ-ONLY: never edit it.

Your deliverable is `spec/conflicts.json`. It already exists in a valid, empty form, so `npm test` is green before
you start. The verifier in `test/` re-derives the clashing pairs from the brief's own constraint tails on every
run:

- **Every conflict you flag is checked strictly, immediately.** A pair that does not clash, a clash classified as
  the wrong kind, a duplicate, a clause id the brief does not carry, or an assumption against a pair that does not
  clash all fail the suite. A false conflict is worse than a missed one.
- **Coverage is only required once you set `"complete": true`.** At that point every clash must be flagged *and*
  carry a recorded assumption, and the failure message names what is missing.
