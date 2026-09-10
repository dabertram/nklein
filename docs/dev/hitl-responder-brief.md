# The HITL responder brief

The rig's model seat (`bin/hitl-model-server.py`, `:8095`) is filled by an **agent**, not a model endpoint. This
file is the brief that agent is given. It lives here rather than in a chat history because it has been
re-derived from scratch three times, and each rediscovery cost a drive.

## The shift is BOUNDED — this is the important part

A responder answers **~25 requests, then stops and reports**, and a fresh one is spawned.

It is tempting to tell the responder to run forever, and it does not work. Two responders died mid-drive on
2026-09-08, both killed by the agent harness's stream watchdog ("no progress for 600s"). Neither was stuck in
the blocking wait — the transcripts show them working normally right up to the kill, at 1200+ transcript rows.
The cause is context: every request carries a full system prompt and up to 33 tool schemas, so a responder that
answers a hundred of them is carrying the whole drive, generation slows, the stream stalls, and the harness kills
it. **A clean hand-off after 25 is strictly better than a silent death at 100**, because a death leaves the
factory idle behind a model that has gone home, and nothing downstream can tell that apart from a slow model.

Context hygiene inside the shift matters for the same reason: read each request as a **tail slice** (the last
~12k characters) rather than in full, never paste a large file into the reply text, and keep commentary to one
line per request.

## The loop

1. `scripts/hitl-next-request.sh <mark>` — BLOCKING, returns the next unanswered id (or `NONE` after ~4 min) and
   claims it. **Never pass `--no-claim`.**
2. `NONE` ⇒ call it again immediately. An idle queue means the factory is thinking, not that the shift is over.
   (A `NONE` does not count toward the 25.)
3. An id ⇒ read the request, play the model (call the offered tools with their exact names and schemas, or reply
   with text when that is what the turn calls for), and write
   `queue/answers/<id>.json` as
   `{"content": "...", "tool_calls": [{"name": "...", "arguments": {...}}], "finish_reason": "tool_calls"|"stop"}`.
4. Back to 1.

## A `*-decompose` card's deliverable is a TASK GRAPH, not the project's work

A card whose id looks like `dev-NN-<project>-decompose` is the project's PLANNING card. Its job is to call
`decompose_project` with a task graph. It is not the place to write the tests, edit the manifest, or run
`npm test` — even when the project is small enough that doing so is obviously easier.

Measured 2026-09-09: on two consecutive drives the model did the entire project inside the decompose card —
project 39's answer reads *"the freshly written test/agent/interval.test.js (7 targeted boundary assertions) plus
tests/manifest.json (complete:true, all 7 killed with reasons) passed the REAL npm test"* — and then stopped.
Correct work, wasted: the card never produced a graph, no child cards existed, nothing settled, and the drive was
scored a stall after 47 minutes. The recording that came out of it replays as a single card and fails
verification with `left cards undrained`.

So on a decompose card: read the spec and the sources, understand the work well enough to split it, and emit
`decompose_project`. Do the implementation on the child cards it creates, when they reach you.

(The "do real work, verify by execution" rule below still holds — it is about not fabricating evidence, not about
doing every card's work in the first card that offers you a shell.)

## A bare stop ENDS the session — never use it on a card that still has work

The system prompt says it outright: *"Response without tool calls will be considered as completed with final
answer."* So an answer with `finish_reason: "stop"` and no `tool_calls` does not mean "I have nothing useful to
add this turn". It means **the card is done**. The session ends, the card stays in whatever lane it was in, and
nothing re-drives it.

Measured 2026-09-09: of the eight long silences in a recording batch, **seven followed a bare stop** (the eighth
followed a legitimate `submit_review`). Each one stranded its card in Planning while the rail waited out a
45-minute deadline against a session that had already ended, and every one of those projects was then re-queued
as "stalled". This was the single largest cause of lost drives — and it came from a well-meant instruction in an
earlier brief telling responders to "stop truthfully rather than re-probe".

The rule:

- **Card's objective met** (decomposition applied, acceptance green, verdict submitted) → a bare stop is correct.
- **Card still has work** and you cannot do it → do NOT bare-stop. Make a real, truthful tool call that records
  the situation (`update_focus_chain` naming the blocker is the usual one), or use whatever tool the card's
  protocol provides for declaring failure. A card that cannot proceed should be visibly blocked, not silently
  abandoned.

This also reframes the re-prompting that earlier shifts reported as harassment: for a card that has NOT met its
objective, re-prompting is the system correctly trying to recover. Repeated re-prompts of a card that IS finished
are a separate, real defect (P1.SETTLEDNUDGE).

## The custodian re-drive loop, and the one move that breaks it

`main-branch-custodian::review` re-opens after its verdict is accepted. FIVE shifts have hit it; three of them
lost **45%, 40% and 40%** of their turns to it. Request ids are a GLOBAL counter shared across every card the
factory is driving, so the same stuck thread reappears under unrelated-looking ids — do not read a new id as a
new problem. The cycle, now precisely characterised:

1. `submit_review(approve)` succeeds, returns `ok:true`, and says *"Stop now; do not make further tool calls."*
2. The bare stop that honours that is scored by the outer ladder as
   `Already attempted: reduced_tool_set → no_tool_call (the model stopped without calling read_files)` — a
   FAILURE, not a completion.
3. The session reopens under a reduced tool set demanding `read_files`, which then either hits a sandbox error or
   is refused as a duplicate read.
4. Repeat.

**Nothing a responder can do ends it.** An earlier version of this section claimed re-submitting the identical
verdict breaks the cycle; that was written from ONE shift and the next shift disproved it — it tried
`submit_review(approve)` (20+ times, every one `ok:true`), `read_files`, `run_commands`, a harness-forced
single-tool retry, and legitimate bare stops, and the card kept reopening under fresh ids regardless of the
action.

So the guidance is damage control, not a cure: **make each hit maximally terse.** One line, no re-derivation, no
re-reading files you have already read. Do not spend a verification pass on a card whose verdict is already
recorded — protect the budget for real work. If you want one line in the record, an `update_focus_chain` saying
the card is already approved and the loop is re-driving it is enough.

This is a harness defect (tracked as P1.SETTLEDNUDGE), not an unresolved review. Do not go looking for something
wrong with the diff.

## A third error shape that is NOT an outage

`Blocked read_files: this exact file content was already read successfully in this task` is a **dedup guard**, not
a sandbox failure. It reads like one and has been mistaken for one. Treat it as "you already have this — use it".

## Tool-schema traps that have each cost a turn

- **Re-read before anchoring an `edit_file`.** Two workers guessed a prior entry's exact `"why"` wording in
  `tests/manifest.json` instead of re-reading it, and the edit failed with "63% similar" both times. Re-reading
  fixed it both times. Anchors must come from the file as it is now, not from what a sibling branch wrote.

- **`decompose_project` clarifying questions use HYPHENATED enum values.** `questions[].status` takes
  `"assumed-default"`, not `"assumed_default"`; a snake_case value is rejected outright. Separately, a question
  marked answered needs an actual `answer` field — an `assumption` alone is not accepted.
- **The offered tool set varies between turns of the SAME card**, and its size tells you nothing about the card's
  type: one task id was seen with both a 28-tool and a 33-tool grant in the same lineage. Read each request's own
  `tools` array every turn; never infer from a sibling.
- **Control-plane tools can work while file tools are failing.** During a sandbox outage on one card,
  `read_files` / `list_files` / `get_file_size` all failed while `decompose_project` succeeded — the control plane
  does not touch the workspace. If the card's remaining work is a control-plane operation, a dead sandbox does not
  necessarily block it.

## Derive ground truth from the sandbox's read-only seed mirror

The live per-card sandbox bind-mounts a **read-only host directory** that mirrors the exact seed/evidence tree.
Find it with:

```bash
docker inspect <container> --format '{{json .Mounts}}'
```

Read the spec, the frozen verifier test, and the actual CSV / log / source files from there, and hand-derive the
real answer **before** writing a decompose graph or an edit — run the frozen verifier's logic against the actual
inputs rather than eyeballing them.

This is not a nicety. Live 2026-09-10, `dev-45-analysis-dataset-quality-audit-decompose` arrived with **five prior
failed attempts** logged against it (four `aborted before producing output`, one `other_failure`). The sixth
attempt succeeded, and what it did differently was read the spec and the frozen verifier from the seed mirror and
derive the full decomposition by hand first. Five attempts had been guessing at a shape that could have been read.

When a card arrives with prior attempts logged, treat that count as an instruction to go and read, not as a reason
to try harder at the same approach.

## `begin_implementation` is not gate-enforced

Observed 2026-09-10: work lands without it. Do not spend a turn hunting for it when it is absent from a request's
`tools` array, and do not treat its absence as evidence that the card is in the wrong state. (See also the
refinement-stall note — ~21% of `--no-plan` sessions write files without ever calling it.)

## Ground rules

- One request at a time, in order; never answer an id you did not just claim.
- Never invent a tool name or an argument the schema does not have.
- **Never fabricate test output or file contents.** A drive becomes a permanent aimock system test; a plausible
  invented result poisons it forever and nothing downstream will ever catch it.
- A card that looks already satisfied still needs the EVIDENCE it asks for — run its acceptance command rather
  than replying "already done". (See P1.RESPONDERLEADS lead (a): the gate is satisfied only by the command
  actually running.)
- No commits, and no edits to the nklein repo itself. Writes go to the drain workspace the request names and to
  the queue's answers directory.
- Never enter credentials, tokens, or passwords anywhere.

## Two responders, deliberately

Two claiming responders are run at once — **for redundancy, not throughput**. The endpoint is serial, so a second
answerer adds no capacity; what it adds is survival. The agent in the seat has died five times (harness
no-progress watchdog ×2, an API connection error, a silent stop after two requests, one unexplained), each death
idling the whole factory until someone noticed, once for 46 minutes.

This deliberately softens the older "a second responder is worse than none" rule, which was written after two
responders raced an UNCLAIMED queue. Claiming removes that race structurally. What remains is that a card's
consecutive turns can land on different responders — so **never rely on your own memory of a card's state**;
re-read the files and re-run the tests before asserting anything about it.

## Why claiming is on by default

The queue is strictly serial — one request in flight — so a second responder adds no throughput, only races.
Two responders raced this queue for an hour on 2026-09-08 because the documented invocation did not pass
`--claim`; their overlapping ranges orphaned answers and one card took five review rounds as each kept undoing
the other's fix. `mkdir` is atomic, so exactly one caller wins each id. Opt-in safety is not safety.

## Timing constants, and why they are what they are

| Constant | Default | Why |
| --- | --- | --- |
| wait per call (`$2`) | 240s | Well inside the agent harness's 600s no-progress watchdog. The binding limit is not the tool timeout — it is how long an agent may go without PRODUCING anything, and a blocking call produces nothing until it returns. |
| `HITL_STALE_MINUTES` | 30 | A request older than this has no session listening for its answer. Answering one wastes a whole turn on a conversation nobody is in. |
| `HITL_CLAIM_ABANDONED_MINUTES` | 20 | Long enough for any real turn, short enough that a dead responder's claim does not wedge the seat. It was 60, and 60 minutes is not a margin, it is the outage. |

## Watching for a dead seat

The responder dies — twice to its own harness's no-progress watchdog, once to an API connection error. It is the
single most common way a drive is lost, so something must notice, and the obvious signal is the wrong one.

**Do not alarm on the age of the youngest unanswered request.** The runtime emits fresh requests continuously
(retries, sibling cards), so the youngest is always young. A monitor built that way stayed silent through a full
hour of a dead responder — the exact failure it existed to catch.

**Alarm when the OLDEST request that arrived after the last answer has itself been waiting more than 15 minutes.**
That is the fact — a request nobody picked up — and it does not care how busy or quiet the factory is.

It took four tries to state that, and the failures are more instructive than the answer. Every one of them
measured something that merely CORRELATES with a dead seat:

| Gate | Why it failed |
| --- | --- |
| the youngest pending request is old | the runtime emits requests continuously, so the youngest is always young — slept through a full hour of an empty seat |
| the last answer is old, and some request is newer than 30 min | an arbitrary window that goes blind exactly when the queue is briefly quiet — took 37 minutes to fire once, silent again right after a restart |
| the last answer is old, and a request arrived after it | fires when the FACTORY is quiet: the last answer ages harmlessly while there is nothing to answer. One 46-minute false alarm with a responder demonstrably working |
| **the oldest request waiting since the last answer is itself old** | measures the request's wait, not the answer's age — the thing that actually matters |

The lesson generalises past this monitor: *the age of the last success is not the age of the current failure.*

Also: do not put a changing number (a minute count) in whatever string the monitor dedups on, or the same alarm
re-fires on every tick. Dedup on a state flag; print the number.

## Observed throughput

**~0.7 requests/min** with Sonnet doing real work (reading files, running tests). A ~60-request project is
therefore ~90 minutes, which is what `scripts/hitl-record-run.mts --max-wait-ms` defaults to. Do not cut that
default: the failure it produces looks exactly like a model failure (see P0.SEEDSIGNAL).
