# Repair fixture — two regressions, one shared cause

`src/` is the code. Two separate features misbehave, and they misbehave for **one** reason. Repair it.

`scenarios/` and `test/` are **frozen evidence, not workspace.** They define the behaviour the repair is judged by,
and the verifier recomputes their content digest on every run: edit, add or delete anything in there and `npm test`
fails and names the file.

Your deliverable is `repair/manifest.json`, which already exists in a valid, empty form, so `npm test` is green
before you start:

```json
{ "schemaVersion": 1, "complete": false, "repaired": [], "rootCause": "" }
```

- **Nothing is asserted until you claim it.** `repaired` holds the ids of the frozen scenarios you have fixed. An
  empty list asserts nothing.
- **Every claim is checked immediately and strictly.** A scenario you list is *run*; if it still fails, the suite
  fails and prints its assertion. Unknown and duplicate ids fail.
- **`rootCause` is checked as soon as it is non-empty.** It must cite a `src/…​.mjs` file that exists and that you
  actually changed, name something declared in that file, and be an explanation rather than a label.
- **Coverage later.** `"complete": true` requires every scenario this fixture defines *and* a recorded `rootCause`.

Run `npm test` to see the scenario ids this fixture defines — list an id you have not fixed and the failure prints
them all.
