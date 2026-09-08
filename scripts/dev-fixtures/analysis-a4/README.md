# Analysis fixture — dataset quality audit

`input/` holds the dataset and its reference table. They are READ-ONLY evidence: never edit them.

Your deliverable is `analysis/data-quality.json`. It already exists in a valid, empty form, so `npm test` is green
before you start. The verifier in `test/` recomputes every count from the data on every run:

- **Every violation you record is checked strictly, immediately.** A rule paired with the wrong column, a count
  that is not the number of offending rows, an `exampleRows` entry that does not actually offend, a duplicate
  rule, or a thin `why` fails the suite. There is no credit for estimating.
- **Coverage is only required once you set `"complete": true`.** At that point every rule the dataset violates
  must be present, and the failure message names what is missing.
