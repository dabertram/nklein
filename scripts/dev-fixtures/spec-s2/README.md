# Specification fixture — API specification

`input/brief.md` is the evidence. It is READ-ONLY: never edit it.

Your deliverable is `spec/api.json`. It already exists in a valid, empty form, so `npm test` is green before you
start. The verifier in `test/` checks the specification against itself on every run:

- **Everything you record is checked strictly, immediately.** An entity with no identity field, a type that
  resolves to nothing, a duplicate name, an operation with no error case, or a capability the brief does not list
  fails the suite. The specification must be internally consistent at every point, not only at the end.
- **Coverage is only required once you set `"complete": true`.** At that point every domain noun must be modelled
  and every capability served, and the failure message names what is missing.
