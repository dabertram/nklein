# Your suite goes here

Write your tests in this directory as `*.test.js` files (plain ESM, `node:test` + `node:assert/strict`, no
dependencies). Helper modules alongside them are fine.

This directory and `tests/manifest.json` are the ONLY things you may write. `src/`, `mutants/`,
`test/mutation.test.js`, `test/frozen-digests.json`, `package.json` and `scripts/` are frozen evidence and their
digests are checked on every run.

Your suite is executed twice per mutant you declare: once against the correct `src/`, where it must pass, and once
in a throwaway copy where the mutant's file has replaced its original, where it must fail. Nothing distinguishes
those two runs except the behaviour of the code, so a kill has to come from an assertion about behaviour.
