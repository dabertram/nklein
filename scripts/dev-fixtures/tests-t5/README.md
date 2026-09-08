# Test-authoring fixture — mutation-graded

`src/` already works. There are no tests. Your deliverable is the suite under `test/agent/`, and it is graded by
**mutation testing**: `mutants/<id>/` each holds one copy of a source file with exactly one behavioural change.

`npm test` runs the frozen verifier in `test/mutation.test.js`. For every mutant you list in `tests/manifest.json`
it runs your suite twice — once against the correct `src/`, where it must PASS, and once in a throwaway copy where
that mutant's file has replaced its original, where it must FAIL. A suite that passes both cannot tell correct code
from broken code, and the verifier says so by name.

```json
{ "schemaVersion": 1, "complete": false, "killed": [] }
```

- The untouched fixture is green: an empty `killed` list demands nothing.
- **Strict now.** Every mutant you list is executed. A listed mutant that survives fails the suite, and so does a
  suite that fails against the correct `src/`.
- **Coverage later.** `"complete": true` demands every mutant in `mutants/`, and the failure names the ones missing.

You may write only under `test/agent/` and `tests/manifest.json`. `src/`, `mutants/`, `test/mutation.test.js`,
`test/frozen-digests.json`, `package.json` and `scripts/` are frozen: their SHA-256 digests are recorded in
`test/frozen-digests.json` and re-checked on every run. They are evidence, not workspace.

Your suite must also be a *behavioural* suite. It may not import `node:fs`, `node:child_process`, `node:vm`,
`node:module` or `node:worker_threads`, may not mention a `mutants/` path, may not assert on `Function.toString()`,
and may not use real timers or the real clock. Every one of those is a way to fake a kill without testing anything.
