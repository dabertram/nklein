# Specification fixture — change impact

`input/spec-v1.md` and `input/change-request.md` are the evidence. They are READ-ONLY: never edit them.

Your deliverable is `spec/impact.json`. It already exists in a valid, empty form, so `npm test` is green before
you start. The verifier in `test/` re-derives the affected set from the change request's own `Affects:` and
`Action:` lines on every run, and re-applies the breaking-change rule:

- **Every impact you record is checked strictly, immediately.** An unknown requirement, a classification the
  change request does not support, a `breaking` flag the rule does not yield, a duplicate, or a missing `why` on
  an affected requirement fails the suite.
- **Coverage is only required once you set `"complete": true`.** At that point every v1 requirement and every
  added one must be classified, and the failure message names what is missing.
