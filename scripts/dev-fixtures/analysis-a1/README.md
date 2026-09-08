# Analysis fixture — unchecked-error audit

`input/` is the artifact under analysis. It is READ-ONLY evidence: never edit it.

Your deliverable is `analysis/findings.json`. It already exists in a valid, empty form, so `npm test` is green
before you start. The verifier in `test/` checks it on every run:

- **Every finding you record is checked strictly, immediately.** A finding whose `file`/`line` does not exist, whose
  `kind` is not in the enum, that duplicates another, or that points at a line which does not actually exhibit the
  defect, fails the suite. There is no credit for guessing.
- **Coverage is only required once you set `"complete": true`.** At that point every seeded defect must be present.

So: adding a wrong finding breaks the build immediately; declaring completion while a defect is missing breaks it too.
