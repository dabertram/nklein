# Unchecked-Error Audit — analysis brief

## The job

`input/order-service.mjs` is one module lifted from an order service after a money-loss incident. It is READ-ONLY
evidence. Your job is to find the defects it contains and record them as structured findings. You are not asked to
fix anything, and you must not edit anything under `input/`.

## The deliverable

`analysis/findings.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "findings": [] }
```

Each entry in `findings` is an object with exactly these fields:

| Field | Meaning |
|---|---|
| `file` | Always `input/order-service.mjs`. |
| `line` | The 1-based line that exhibits the defect — the line a reviewer should look at, not the function header. |
| `kind` | One of the four classes below. Nothing else is accepted. |
| `why` | At least twelve characters explaining the consequence, not restating the class name. |

Set `"complete": true` only when you believe every defect of these four classes is recorded.

## The four defect classes

These are the only classes that count. A real problem outside them is out of scope for this audit — do not report
it, because an unrecognised finding fails the check.

- **`unchecked_find`** — a value bound from `Array.prototype.find(...)` is dereferenced without first proving it is
  not `undefined`. The defect is on the dereferencing line.
- **`floating_promise`** — a call to a locally declared `async` function whose promise is neither awaited nor
  returned, so failures vanish and ordering is not guaranteed. The defect is on the calling line.
- **`missing_radix`** — `parseInt` called with a single argument, so the base depends on the input's prefix.
- **`float_money`** — a value held in integer minor units is pushed through floating-point arithmetic, so money
  gains a fractional part that cannot be represented exactly.

## How your work is checked

`npm test` runs a verifier that derives the defect set from the evidence on every run. It is a checker, not an
answer key: it contains no line numbers.

1. **Every finding you record is checked immediately and strictly.** A finding whose line does not exhibit the class
   you claim fails the suite, as does a bad line number, an unknown `kind`, a duplicate, or a thin `why`.
2. **Coverage is required only when you set `"complete": true`.** At that point every defect the verifier derives
   must be present, and the failure message names what is missing.

So the suite stays green while you work, breaks the moment you record something untrue, and breaks again if you
declare completion early. Adding a finding you are unsure about is strictly worse than leaving it out until you have
read the code that proves it.

## How to plan this

Decompose by defect class or by region of the file, not by "read" and "write" phases — each card should end with
real findings recorded and the suite green. Reserve the last card for the completeness pass: re-read the module
end to end, confirm nothing of the four classes is missing, then set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
