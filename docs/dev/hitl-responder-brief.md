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

## Observed throughput

**~0.7 requests/min** with Sonnet doing real work (reading files, running tests). A ~60-request project is
therefore ~90 minutes, which is what `scripts/hitl-record-run.mts --max-wait-ms` defaults to. Do not cut that
default: the failure it produces looks exactly like a model failure (see P0.SEEDSIGNAL).
