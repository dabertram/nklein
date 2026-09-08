# Repair fixture — boundary defects in money, encoding and local days

`src/` holds three modules that are right in the middle of their range and wrong at the edges. Repair them.

Some frozen scenarios are already green. They pass for the WRONG reason, and the obvious partial fix will take them
red — when that happens the patch is wrong, not the scenario.

`scenarios/` and `test/` are **frozen evidence, not workspace.** They define the behaviour the repair is judged by,
and the verifier recomputes their content digest on every run: edit, add or delete anything in there and `npm test`
fails and names the file. Weakening the suite is the one way to fail this task outright.

Your deliverable is `repair/manifest.json`, which already exists in a valid, empty form, so `npm test` is green
before you start:

```json
{ "schemaVersion": 1, "complete": false, "repaired": [] }
```

- **Nothing is asserted until you claim it.** `repaired` holds the ids of the frozen scenarios you have fixed. An
  empty list asserts nothing, so the untouched fixture is green.
- **Every claim is checked immediately and strictly.** A scenario you list is *run*; if it still fails, the suite
  fails and prints its assertion. An unknown id fails. A duplicate id fails. Claiming a scenario you have not fixed
  is worse than leaving it out.
- **Coverage is required only when you set `"complete": true`.** At that point every scenario this fixture defines
  must be listed, and the failure message names the ones that are not.

Run `npm test` to see the scenario ids this fixture defines — list an id you have not fixed and the failure prints
them all.
