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

**Alarm when the last ANSWER is older than 15 minutes AND a request arrived after it.** That is what a dead seat
actually is: work came in and nobody answered it. Fifteen minutes is comfortable at the observed throughput below.

The GATE is the part that keeps being got wrong, so the failed versions are worth recording:

| Gate | Why it failed |
| --- | --- |
| youngest pending request is old | the runtime emits requests continuously, so the youngest is always young — this slept through a full hour of an empty seat |
| a request newer than 30 min exists | an arbitrary window that goes blind exactly when the queue is briefly quiet — took 37 minutes to fire once, and went silent right after a restart |
| a request arrived after the last answer | no window, and it states the condition directly |

Also: do not put a changing number (a minute count) in whatever string the monitor dedups on, or the same alarm
re-fires on every tick. Dedup on a state flag; print the number.

## Observed throughput

**~0.7 requests/min** with Sonnet doing real work (reading files, running tests). A ~60-request project is
therefore ~90 minutes, which is what `scripts/hitl-record-run.mts --max-wait-ms` defaults to. Do not cut that
default: the failure it produces looks exactly like a model failure (see P0.SEEDSIGNAL).
