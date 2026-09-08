# Incident Log Forensics — analysis brief

## The job

`input/incident.jsonl` is the merged application log for incident INC-4471: one JSON object per line, in collector
order. It is READ-ONLY evidence. Your job is to reconstruct the causal chain and classify the root cause. You are
not asked to fix, patch or simulate anything, and you must not edit anything under `input/`.

Line numbers are 1-based over the file, exactly as an editor shows them.

## The deliverable

`analysis/timeline.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "events": [], "rootCause": null }
```

`events` is the chain, **ordered by line number, ascending**. Each entry has:

| Field | Meaning |
|---|---|
| `line` | The 1-based line in `input/incident.jsonl`. |
| `role` | One of `trigger`, `amplification`, `failure`. Nothing else is accepted. |
| `why` | At least twelve characters saying what that record did to the system — not a restatement of the role. |

`rootCause` is `null` until you name it, then an object with `category` (from the enum below), `line` (the record
it happened on), and a `why` of at least twelve characters.

Set `"complete": true` only when the whole chain is recorded and the root cause is named.

## The three roles

These are the only roles that count. A record that looks interesting but matches none of them is out of scope —
do not record it, because an unrecognised event fails the check.

- **`trigger`** — a `config_applied` record whose numeric `to` is **less than** its numeric `from`: a limit somebody
  lowered. A `config_applied` that raises a limit is not a trigger, however suspicious its timing.
- **`amplification`** — a `retry_scheduled` record whose `backoff_ms` is exactly `0`: a client retrying with no
  spacing at all, converting one slow dependency into a load multiplier. A retry that does back off is not an
  amplification, however high its `attempt` count.
- **`failure`** — a record at `"level": "fatal"`. Records at `"level": "error"` are the symptom, not the failure;
  there are many of them and none of them count.

## The root-cause rubric

The root cause is **the earliest trigger in the log** — the one with the lowest line number. Its `category` is
decided by the configuration `key` that trigger lowered, by the first rule that matches:

| The key contains… | Category |
|---|---|
| `pool`, `capacity`, `concurrency` or `max` | `capacity_misconfiguration` |
| else `retry`, `backoff` or `attempt` | `retry_amplification` |
| else `credential`, `token` or `secret` | `credential_expiry` |
| else `upstream`, `dependency` or `endpoint` | `dependency_outage` |
| else | `code_defect` |

The verifier applies this same table to the trigger it derives, so a category that does not follow it fails even
when the narrative around it is persuasive.

## How your work is checked

`npm test` runs a verifier that re-derives the chain from the log on every run. It is a checker, not an answer
key: it contains no line numbers and no root cause.

1. **Every event you record is checked immediately and strictly.** A line outside the file, an unknown `role`, a
   duplicate line, an entry out of ascending line order, a line that plays no role, a line recorded under the
   wrong role, a thin `why`, or a root cause the rubric does not select all fail the suite.
2. **Coverage is required only when you set `"complete": true`.** At that point every trigger, amplification and
   failure must be present and `rootCause` must be filled in; the failure message names the events that are
   missing.

So the suite stays green while you work, breaks the moment you record something untrue, and breaks again if you
declare completion early.

## How to plan this

Decompose by role, not by "read the log" and "write the file" — one pass for triggers, one for amplifications, one
for failures, each ending with real events recorded and the suite green. The log is long enough that a card which
first builds a compact index of the record shapes present (`event` values, `level` values, which fields each
carries) pays for itself. Name the root cause only after the chain is complete, and reserve the final card for the
completeness pass before you set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
