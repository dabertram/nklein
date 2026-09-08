# Requirements Extraction — specification brief

## The job

`input/brief.md` is the product brief the business signed off on, written in the business's own words. It is
READ-ONLY evidence. Your job is to turn every obligation it contains into a structured requirement. You are not
asked to implement, design or estimate anything, and you must not edit anything under `input/`.

An obligation is a numbered `**OB-NN**` paragraph. Everything else in the brief — the narrative, the actor
glossary, the out-of-scope section — is context. One obligation is marked **WITHDRAWN**: it is kept for contract
numbering and must not become a requirement.

## The deliverable

`spec/requirements.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "requirements": [] }
```

Each entry in `requirements` is an object with exactly these fields:

| Field | Meaning | Minimum |
|---|---|---|
| `id` | The obligation it comes from, e.g. `OB-04`. Each obligation appears at most once. | — |
| `actor` | The party the obligation is about. Must be one of the brief's actors, spelled as the glossary spells it. | 3 chars |
| `trigger` | The condition that puts the obligation in force. | 12 chars |
| `outcome` | What must be true once the trigger has fired. | 12 chars |
| `acceptance` | How someone would demonstrate the outcome actually holds — the observation that would fail if the system were wrong. | 20 chars |

The four text fields must differ from one another: restating the outcome as the trigger is not a specification.

Set `"complete": true` only when every live obligation has a requirement.

## What makes an acceptance criterion real

The acceptance criterion is the field that turns a wish into a requirement, so it is the one the verifier is
strictest about: **it may not be a verbatim slice of the obligation's own text.** An obligation says what must
happen; a criterion says what you would measure, in what conditions, to know that it did. If your criterion still
reads like the brief, it is a restatement and it will fail — name the observation, the boundary, or the timing
that would expose a violation.

## How your work is checked

`npm test` runs a verifier that re-reads the brief on every run, deriving the obligation list, the withdrawn set
and the actor glossary from it. It is a checker, not an answer key: it lists no obligation and no actor.

1. **Every requirement you record is checked immediately and strictly.** An id the brief does not carry, the
   withdrawn obligation, a duplicate id, an actor outside the glossary, a field below its minimum, two fields
   holding the same text, or an acceptance criterion copied out of the obligation all fail the suite.
2. **Coverage is required only when you set `"complete": true`.** At that point every live obligation must be
   covered exactly once, and the failure message names the ones that are not.

So the suite stays green while you work, breaks the moment you record something the brief does not support, and
breaks again if you declare completion early.

## How to plan this

Read the whole brief before writing a single requirement: the withdrawn obligation is named by the one that
replaced it, and the actor glossary is what decides several of the `actor` fields. Then decompose by actor or by
obligation range — a handful of obligations per card, each card ending with those requirements recorded and the
suite green. Do not leave the acceptance criteria to a final sweep; they are the expensive field and writing them
while the obligation is still in your head is much cheaper than reconstructing the intent later. Reserve the last
card for the completeness pass before you set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
