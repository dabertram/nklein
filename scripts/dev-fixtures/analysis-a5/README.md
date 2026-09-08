# Analysis fixture — security audit with severity

`input/` is the evidence: four handler modules and the route table that registers them. It is READ-ONLY: never
edit it, and note that `routes.mjs` is what makes the severity rubric decidable.

Your deliverable is `analysis/security.json`. It already exists in a valid, empty form, so `npm test` is green
before you start. The verifier in `test/` re-derives both the findings and their severities on every run:

- **Every finding you record is checked strictly, immediately.** A line that does not exhibit the class you claim,
  an unknown `kind`, a duplicate, a thin `why`, or a severity the rubric does not yield fails the suite. There is
  no credit for a plausible rating.
- **Coverage is only required once you set `"complete": true`.** At that point every finding must be present and
  correctly rated, and the failure message names what is missing.
