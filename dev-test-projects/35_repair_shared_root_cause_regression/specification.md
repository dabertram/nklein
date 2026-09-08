# Shared-root-cause repair — brief

## The job

`src/` holds a reporting feature and an export feature over a shared options module. Two regressions have been
reported against it:

- **REG-1:** a report built with custom options changes what the *next* report gets, and grows a duplicated column
  every time it runs.
- **REG-2:** a custom report changes what an *export* returns afterwards, even though the export asked for nothing.

They look like two bugs in two features. They are one defect. A correct repair removes both at once, and it is the
kind of repair you can point at: one place, one reason.

Repair the code. Do not rewrite the modules, do not change their exported names, and do not weaken the suite.

## What is frozen

`scenarios/` and `test/` are **evidence, not workspace.** They are the behaviour specification. The verifier
recomputes a content digest of every frozen file on each run and compares it with the digest recorded when the
fixture was built; editing, adding or deleting anything in there fails the suite immediately and names the file.

## The deliverable

`repair/manifest.json`, which already exists in a valid, empty form:

```json
{ "schemaVersion": 1, "complete": false, "repaired": [], "rootCause": "" }
```

| Field | Meaning |
|---|---|
| `schemaVersion` | Always `1`. |
| `repaired` | The ids of the frozen scenarios you have actually fixed. |
| `complete` | Set to `true` only when every scenario this fixture defines is repaired. |
| `rootCause` | One paragraph naming the single cause behind both regressions. |

### What `rootCause` has to be

It is checked as soon as it is a non-empty string, and it is required once `complete` is `true`. To be accepted it
must:

- cite the source file the cause lives in, written as a path — `src/<file>.mjs`;
- cite a file that **exists** and that you have **actually changed** from the tree you were given;
- **name** something declared in that file — the function, constant or class that was wrong;
- be an explanation, not a label: at least 80 characters, and at least fifteen words that are not part of the path.

Say what the code did, and what that caused. "Shared state bug" is a label. "`withDefaults` merged each caller's
overrides into the shipped `DEFAULTS` object and returned that object, so every call rewrote the defaults for every
later call in both features" is a root cause.

## How your work is checked

`npm test` runs a verifier that reads the scenario set out of `scenarios/` at run time. It holds no expected values
of its own — the scenarios are the specification.

1. **The base tree is green.** An empty `repaired` list and an empty `rootCause` assert nothing.
2. **Strict now.** Every id you list is executed on every run. An unknown id fails and prints the valid ids. A
   duplicate id fails. A `rootCause` that does not meet the bar above fails and says which rule it broke.
3. **Coverage later.** `"complete": true` demands every scenario the fixture defines *and* a recorded `rootCause`.
4. **Anti-tamper.** The frozen digest check runs first, on every run.

One of the frozen scenarios is green on the shipped tree. It is there to catch a repair that fixes the leak by
throwing the caller's overrides away, so keep it listed and keep it green.

## How to plan this

Resist a card per regression. Reproduce both, find the one place they meet, fix it, and confirm both regressions
close together. Reserve the last card for the completeness pass: list every scenario id, write the `rootCause`, and
set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
