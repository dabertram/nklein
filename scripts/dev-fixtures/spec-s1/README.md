# Specification fixture — requirements extraction

`input/brief.md` is the evidence. It is READ-ONLY: never edit it.

Your deliverable is `spec/requirements.json`. It already exists in a valid, empty form, so `npm test` is green
before you start. The verifier in `test/` re-reads the brief on every run:

- **Every requirement you record is checked strictly, immediately.** An id the brief does not carry, a withdrawn
  obligation, a duplicate, an actor outside the glossary, a field that says nothing, two fields holding the same
  text, or an acceptance criterion copied verbatim out of the obligation all fail the suite.
- **Coverage is only required once you set `"complete": true`.** At that point every live obligation must be
  covered exactly once, and the failure message names what is missing.
