# Analysis fixture — cross-module structure audit

`input/` is the package under analysis. It is READ-ONLY evidence: never edit it.

Your deliverable is `analysis/structure.json`. It already exists in a valid, empty form, so `npm test` is green
before you start. The verifier in `test/` rebuilds the import graph from the evidence on every run:

- **Every finding you record is checked strictly, immediately.** An unknown `kind`, a module that does not exist,
  a symbol the named module does not export, a duplicate, or a claim the import graph does not support fails the
  suite. There is no credit for guessing.
- **Coverage is only required once you set `"complete": true`.** At that point every structural defect the graph
  yields must be present, and the failure message names what is missing.
