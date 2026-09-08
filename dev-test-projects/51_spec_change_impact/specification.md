# Claims Intake Change Impact — specification brief

## The job

`input/spec-v1.md` is the specification the claims intake service was built to, and that three broker integrations
are written against. `input/change-request.md` is the approved change request against it. Both are READ-ONLY
evidence — you must not edit anything under `input/`, and you are not asked to write specification v2.

Your job is the delta: what this change request does to each requirement, and which of those are breaking.

## What the evidence says, and what it only appears to say

Each v1 requirement carries a `Contract` marker — `external` (visible to somebody outside the team) or `internal`
(ours to change). Each change-request section carries an `Affects:` line and an `Action:` line.

**The `Affects:` line is authoritative.** The prose around it mentions other requirements for context — a section
will say that some requirement is *not* touched, or that a new requirement resembles an existing one. Mentioning a
requirement is not touching it, and there is more than one such mention in this document.

An `Action:` of `add` introduces a requirement v1 does not have.

## The deliverable

`spec/impact.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "impacts": [] }
```

Each entry is an object:

| Field | Meaning |
|---|---|
| `requirement` | A v1 requirement id, or one the change request adds. |
| `classification` | `added`, `changed`, `removed` or `unaffected`. |
| `breaking` | A boolean, by the rule below — not by judgement. |
| `why` | At least twelve characters on what the change does to it. **Required unless** the classification is `unaffected`, where it may be omitted. |

Set `"complete": true` only when every v1 requirement and every added requirement is classified.

## The breaking-change rule

A change is **breaking** when, and only when:

- the requirement is **removed** — an integrator relying on it has nothing to fall back to; **or**
- the requirement is **changed** and its v1 `Contract` marker is `external` — the thing that moved is a thing
  somebody outside can see.

Everything else is not breaking. A changed `internal` requirement is not breaking however large the engineering
behind it. An added requirement is never breaking: nobody is relying on behaviour that did not exist. An unaffected
requirement is never breaking.

The verifier applies exactly this rule to the classification it derives, so a `breaking` flag that reflects how
disruptive the work *feels* rather than what the rule says will fail.

## How your work is checked

`npm test` runs a verifier that re-reads both documents on every run: it derives the v1 requirement set and their
contract markers from the specification, the affected set from the change request's `Affects:` and `Action:` lines,
and the breaking flags from the rule. It is a checker, not an answer key: it names no requirement.

1. **Every impact you record is checked immediately and strictly.** A requirement neither document carries, a
   classification the change request does not support, a `breaking` flag the rule does not yield, a duplicate, or a
   missing `why` on an affected requirement all fail the suite.
2. **Coverage is required only when you set `"complete": true`.** At that point every v1 requirement and every
   added requirement must be classified — including the ones nothing happens to — and the failure message names
   what is missing.

## How to plan this

Index first: one card that tabulates every v1 requirement against its contract marker, and every change-request
section against its `Affects:` and `Action:` lines, turns the rest into a join. Then classify in two passes — the
affected requirements, which need a `why` each, and then the remainder, which are `unaffected` and cheap. Derive
`breaking` from the rule mechanically rather than from a sense of how big each change is; the two disagree in this
change request, which is the point of the rule existing. Reserve the last card for the completeness pass before
you set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
