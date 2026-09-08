# Notification routing — refactor brief

## The job

`src/notifications.mjs` routes an event to at most one channel for a subscriber. It is correct and it is
unreadable: one function holds four event kinds, each with its own channel preference order and its own reason
text, and `src/audit.mjs` carries a copy of the reachability computation.

Restructure it so a new event kind or a new channel is an addition rather than another branch. Do not change a
single routing decision.

## What you may change

Everything under `src/`, and `refactor/manifest.json`. New files are fine and expected.

`src/index.mjs` must keep exporting `routeNotification`, `routeAll`, `CHANNELS` and `auditRoutability`.

## What is frozen

`scenarios/`, `test/refactor.test.js` and `scripts/run-tests.mjs` are evidence, not workspace. `npm test`
recomputes their content digests on every run and fails if any of them moved.

## The behaviour, stated

Read it here and confirm it against the scenarios; do not infer it from the shape of the code.

- A result is always `{ channel, reason, subscriberId, reachableSummary }`. `channel` is `null` when nothing is
  chosen, and `reason` always explains why.
- **Reachable channels**, in this fixed precedence order: `sms` when the subscriber has a phone **and** is
  verified; `push` with a push token; `webhook` with a webhook URL; `email` with an email address.
  `reachableSummary` joins them with `|`, or is the string `none`.
- **Quiet hours** suppress `mention` and `digest`. They do **not** suppress `security_alert` or `billing`.
- **Preference order per kind**: `security_alert` → sms, then email. `billing` → email only. `mention` → push,
  then email. `digest` → webhook, then email. The first reachable channel in that order wins.
- An unknown event kind routes nowhere, and the reason names the kind.
- A missing or kind-less event, and a missing or id-less subscriber, throw `TypeError`.
- Every reason string is part of the behaviour and must be reproduced exactly.

## The deliverable

`refactor/manifest.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "addressed": [] }
```

## The goals that count

Listed in full, with reasons, in `refactor/goals.json`. Nothing outside this list is measured.

- **`G1` — no function has more than 6 branch points.** Counted as `if`, `case`, ternary, `&&`, `||` and `catch`.
- **`G2` — no function is longer than 25 meaningful lines.**
- **`G3` — no logic is duplicated across modules.** No five substantive lines may appear in two files under
  `src/`; pure punctuation and trivial one-liners are ignored.

## How your work is checked

1. **Behaviour first.** Every frozen scenario must still pass, whatever your manifest says.
2. **Every goal you list is checked immediately and strictly**, and the failure names the offending function or
   pair of files. Claiming a goal you have not met is strictly worse than claiming nothing.
3. **Coverage is required only when you set `"complete": true`.**

The untouched fixture passes `npm test`. A green baseline means the acceptance signal reports *your* work rather
than a pre-existing failure.
