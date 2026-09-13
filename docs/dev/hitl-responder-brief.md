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

## Call the claim script in the FOREGROUND — backgrounding it kills your shift

`hitl-next-request.sh` blocks for up to 240 seconds waiting for work. Run it as an ordinary synchronous command
and let it block. **Never run it with `run_in_background`**, and never wrap it in a background task you then wait
on: your turn ends when your last tool call returns, so a backgrounded claim ends the turn with nothing in hand and
the shift stops there — mid-poll, holding no request, having answered nothing.

Two shifts died this way on 2026-09-10, the second one reporting only *"waiting for the background claim call to
return the next request id — will resume as soon as it completes."* It never resumed. Between them the factory sat
idle for hours.

Blocking synchronously is the intended behaviour, not a workaround: the script's whole design is one blocking call
per turn that either hands you a request or prints NONE.

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

## The specification-coverage anchor gate scans task PROMPTS, not the top-level `spec` field

`decompose_project` can reject with *"Task graph failed specification-coverage validation... (contract coverage
2/3 required anchors). Echo 1 more of these verbatim: ..."* — a per-bullet keyword-overlap check, distinct from the
`questions[].status` and `complexity` shape errors below. It is easy to assume the top-level `spec` argument is
what gets scanned (it reads like "the specification"), and easy to over-correct by padding `spec` with fuller
obligation text. That does not help.

Live 2026-09-13, project 54 (`planning_encrypted_backup_restore`): a `spec` argument that fully restated all 18
obligations still got rejected on two of them (OBL-06, OBL-15) for missing anchors, because the *task* prompt's own
coverage of those two obligations was thinner than the others (a terse `"OBL-05 + OBL-06 -> encrypt.js"` grouping
line, versus a fuller restatement for four other obligations). Adding one sentence to the **task prompt** — not the
`spec` field — that echoed the missing anchor words verbatim (`authenticated`, `ciphertext`, `header`, `decrypt`,
`rather`, `than` for OBL-06; `written`, `down`, `how`, `long`, `cadence`, `kept` for OBL-15) fixed it on the retry.

So: **the gate reads card `prompt`/`acceptanceChecks` content, not the graph-level `spec`/`plan` markdown.** For a
decompose card producing a planning data-file deliverable, the safest move is to fold the full obligation text
(module tags, `uses` tags, and all) directly into the implementing task's own `prompt` — not just into `spec` —
before the first submission. Live 2026-09-13, projects 55 (`planning_payments_reconciliation`, 24 obligations) and
56 (`planning_fleet_telemetry_platform`, 42 obligations) both applied **clean on the first attempt** after adopting
this, where 54 needed a retry. Three decompose graphs, one retry, zero third attempts.

## Tool-schema traps that have each cost a turn

- **Re-read before anchoring an `edit_file`.** Two workers guessed a prior entry's exact `"why"` wording in
  `tests/manifest.json` instead of re-reading it, and the edit failed with "63% similar" both times. Re-reading
  fixed it both times. Anchors must come from the file as it is now, not from what a sibling branch wrote.

- **`decompose_project` clarifying questions use HYPHENATED enum values.** `questions[].status` takes
  `"assumed-default"`, not `"assumed_default"`; a snake_case value is rejected outright. Separately, a question
  marked answered needs an actual `answer` field — an `assumption` alone is not accepted.
- **Keep `complexity` at 40 or below on child cards — above ~50 the card cannot run in REPLAY at all.**
  The number is not decoration. The runtime refuses to start a card whose difficulty no connected model satisfies:
  `Task start blocked: this card needs decomposition. No connected model satisfies both difficulty 51 and the
  candidate-specific context fit guard.` Live that is harmless, because the HITL seat clears any bar. But every
  drive is recorded and must REPLAY against a simulated model with a lower ceiling — and there the card never
  starts, never issues a request, and the whole project fails as `left cards undrained`.
  Live 2026-09-11: project 53 gave its child `complexity: 55` and its replay died exactly there; project 49, which
  replays clean, used 45/25/25/25/25/20. Six projects were lost to this before the log was read.
  If you do not have a reason for a specific number, omit the field or use 30.
  **Correction, live 2026-09-13/14: "omit the field" does NOT avoid the risk — omitting lands you exactly ON the
  50 default, the same boundary value the runtime blocks on.** Confirmed four ways in one shift on projects 71-76:
  three `add_task` calls (71, 72, 73) that genuinely had no `complexity` key at all each produced a child card whose
  own prompt states `Complexity: 50/100` — the default is 50, and omitting the field does not lower it. A fourth
  `add_task` (76) that explicitly passed `complexity: 30` produced a child card showing `Complexity: 30/100`,
  confirming the field does take effect when actually set. So the real rule is: **always pass an explicit low
  number (30 worked cleanly); never rely on omission**, which silently buys you the risky default instead of safety.
  (A second shift the same day repeated the omission on projects 74 and 75 before reading this correction — both
  landed at the default 50 too. `complexity` is not in `add_task`'s documented schema at all, same as `testability`
  below; passing it anyway as an extra property is confirmed to work, exactly like `testability` is. Always pass it.)
- **`decompose_project`'s `complexity` is a NUMBER 0-100 (default 50), not a word.** Sending `"medium"` or `"low"`
  fails validation for every task at once: `tasks.0.complexity: Invalid input: expected number, received string`.
- **When `decompose_project` fails validation, DO NOT resend the nested call.** The error says exactly what to do —
  *"Switch to add_task/add_dependency, then submit decompose_project without tasks"* — and it means it. Live
  2026-09-10, project 50: a responder sent string complexities, then resent the whole nested call three times
  running. `RepeatedToolCallGuard` parked the card, the board stopped issuing requests, and the project was lost
  before a single card was created. Re-sending a call the server has already rejected on shape will never succeed,
  and the guard that stops you costs the whole project, not just the turn.
- **A nested `decompose_project(tasks: [...])` call requires `plan`, not just `spec`.** Live 2026-09-13, project 57
  (`repair-ticket-triage-defects`): a call with `slug`, `title`, `summary`, `spec` (a full restatement of the
  fixture) and `tasks` was rejected outright — *"decompose_project is missing required fields: plan"* — before any
  coverage or shape validation of the tasks even ran. Rather than retry the nested call with a `plan` field bolted
  on (a second guess at what else might be required), the fix was to take the error's own advice and switch to the
  incremental protocol: `add_task` once per card (every field the nested form would have carried, `dependsOn`
  dropped from each), then `add_dependency` once per edge once all ids exist, then `decompose_project` with NO
  arguments — which auto-fills `slug`/`spec`/`plan` from the accumulated graph and applied clean. All 9 incremental
  calls (4 `add_task` + 5 `add_dependency`) can be sent as one batched turn in dependency order (tasks before the
  edges that reference them) and each is validated immediately, so a mistake surfaces on the one call it is in
  rather than after a whole resubmission. Net cost was one retry, not a lost project — but skip the nested form's
  `plan` guessing game entirely and go straight to incremental if a first nested attempt is rejected for a missing
  field you did not expect.
- **The offered tool set varies between turns of the SAME card**, and its size tells you nothing about the card's
  type: one task id was seen with both a 28-tool and a 33-tool grant in the same lineage. Read each request's own
  `tools` array every turn; never infer from a sibling.
- **Control-plane tools can work while file tools are failing.** During a sandbox outage on one card,
  `read_files` / `list_files` / `get_file_size` all failed while `decompose_project` succeeded — the control plane
  does not touch the workspace. If the card's remaining work is a control-plane operation, a dead sandbox does not
  necessarily block it.
- **If you build `queue/answers/<id>.json` with a shell heredoc, an UNQUOTED delimiter (`<< EOF`) runs backtick
  command substitution on your own prompt text before it ever reaches the file.** A card prompt that echoes a
  fixture's own markdown (`` `limits` ``, `` `ledger.request` ``) is exactly the content that gets mangled — bash
  tries to execute the backticked word as a command, fails silently, and splices in nothing. Live 2026-09-13: one
  such prompt lost the word `limits` this way (harmless here — descriptive text, not something the coverage gate
  scanned for) but the same mechanism could just as easily eat a word the anchor-echo coverage gate is checking
  for. Quote the delimiter (`<< 'EOF'`) whenever the payload contains backticks, or escape each one (`` \` ``).

## Host-side `git log` verification does not work from inside the sandbox

Do not spend turns on it. Each per-card `/workspaces/<card>` directory is `0700`, owned by a per-task UID, and
even `docker exec -u 0` cannot read it — that is this repo's strict per-task isolation working as designed, not a
fault to report. Verify in-session instead: a fresh `read_files` plus a real `npm test`.

(The check IS available to an operator on the host, outside the sandbox, against the project's own dev-workspace
repo. That is where the earlier "no commit or branch for this card" findings came from.)

## The finished-card reopen loop — persistence resolves it, tool tricks don't obviously help

A second named loop (the custodian re-drive loop above is the first), and until now referenced elsewhere in this
file without its own section. Shape: a card whose objective is genuinely already met (deliverable written,
verified fresh, tests green) gets a bare stop scored by the outer ladder as `no_tool_call` — the same
`Already attempted: reduced_tool_set → no_tool_call (the model stopped without calling read_files)` shape as the
custodian loop — and the session reopens, alternating a reduced tool set (often just `read_files`) with the full
set demanding *some* tool call before it will accept a stop.

Live 2026-09-13, two instances on the same shift, same card shape (`verify-plan-coverage`, a review-style card
whose correct output was "no changes needed"):

- Project 54's instance ran **~11 turns** (a full quarter of a 40-request shift) cycling through bare stops,
  distinct-line-range `read_files` calls (to dodge the dedup guard), and an `update_focus_chain` marking every
  step done — every one of those got scored as `no_tool_call` just the same, until it resolved into a legitimate
  review card on its own.
- Project 55's instance, handled by doing **nothing but repeat a one-line bare stop** each time (reduced tools or
  full), resolved in **3 turns**.

That is not enough data to prove causation, but it is enough to change the default: **don't spend turns hunting
for a clever tool call to escape this loop.** A distinct-range `read_files`, a full `update_focus_chain`, and a
plain repeated bare stop all got scored as failures the same way; the plain repeat was cheapest and, in the one
head-to-head so far, fastest. Treat every reopen — reduced tools or full — as "bare stop immediately, one line,"
exactly as the custodian loop's own guidance says: make each hit maximally terse and do not re-derive anything.
It costs turns regardless; the difference is whether it also costs your context budget on invented workarounds.

## The acceptance-runner loop (EACCES / ENOENT) — and the bare stop that ends it

A third named loop, distinct from the custodian one and from the finished-card reopen. Live 2026-09-11, project 58:
a card was re-driven with `acceptance check failed... EACCES` against a harness-managed workspace whose path ends
`.../--acceptance-`. That directory is `0700` under a per-task uid and is unreadable by the card, by its reviewer,
and by `docker exec -u 0` from the host — so there is nothing you can inspect and nothing you can fix. The card's
own workspace tested green three times independently; the diff was never the problem.

It cost 20% of that shift. What it looks like: `update_focus_chain` is accepted over and over with no new
instruction, which is the custodian loop's shape, and no completion tool is offered (`resolve_result`,
`predict_output`, `request_compaction`, `begin_implementation` were all checked and absent).

**The OS error varies; the class does not.** A second variant appeared the next shift: `ENOENT`, `scandir
'.../--acceptance-5/test'` — the harness's acceptance copy missing its `test/` directory outright — on a card that
had already been approved. Treat any failure whose path contains `--acceptance-` as this loop, whatever errno it
carries: it is the runner's own workspace, not your diff.

**Unlike the custodian loop, a bare stop DOES end this one.** The next claimed request was a fresh session for the
next card in the chain, and the project was not lost. So: once you have confirmed the failure is the acceptance
runner's own workspace rather than your diff — your card tests green, the EACCES path is not one you wrote to —
stop. Do not keep cycling the focus chain.

## A fixture's own "frozen and untouched" test does NOT prove integrity

Two holes, both confirmed by actually exploiting them in a scratch copy (2026-09-13, projects 71-76):

- **`test/frozen.json` is the trust anchor and is itself unhashed.** The frozen-check test recomputes digests of
  `service/`|`harness/`, `conformance/`, the test file and `scripts/run-tests.mjs`, and compares them to expected
  values read from `test/frozen.json` — which nothing verifies. Deleting a real assertion from a conformance case
  and writing its new sha256 into `frozen.json` leaves the "untouched" test green.
- **`performance/budgets.json` is not in the frozen set at all** (72-76 digest only `harness/*`, `conformance/*`,
  the test file and the runner). With the original slow source untouched, raising `B1.maxReads` to 999999 takes the
  suite to a full green pass.

So a card can "pass" by editing the scorer rather than doing the work, and the fixture will agree with it.

**What this means for you:** never treat a project's own passing frozen/untouched test as evidence. When reviewing,
diff `test/frozen.json`, `performance/budgets.json` and every frozen path against the SEED MIRROR's raw bytes. And
never edit any of them yourself — a budget or digest you changed is the one thing that makes a green run worthless.

## The 71-76 families, in brief

**71 (integration, two-service saga)** is graded purely behaviourally — no structural metrics. You write
`src/adapter.mjs`; eight cases C01-C08 run live against fresh fake services and check final service state, not
return values. **Its trap:** C05 and C08 monkey-patch `ledger.request` AFTER the coordinator is constructed, so an
adapter that captures `ledger.request` once at construction calls the original and silently misses the injected
failure. Dereference `deps.ledger.request(...)` fresh on every call. Note C08's rule in particular — a `504` after a
server-side success is not a `no`, and must not trigger a release.

**72-76 (performance)** all share a shape: `performance/manifest.json` `{schemaVersion, complete, optimised:[]}`,
and — unlike 71 — behaviour is checked UNCONDITIONALLY on every run regardless of the manifest. Listing an
unachieved budget id is strictly worse than listing nothing; it fails by name.
- **73**: a budget's `limits` is a dict `{probeName: max}`, so one id can bound several probes at once.
- **74**: `fetchMany` throws `RangeError` above 25 ids — batching is not fetching everything — and duplicate ids are
  detected across the whole run, not per call.
- **75**: the source is pull-based, so spread/`Array.from`/array methods silently drain it. A lazy `take` that
  checks its counter BEFORE pulling reads one record too many and busts the budget. Workload W4 has no budget entry
  but is still checked for correctness, and its query can never match — it exists to catch an implementation that
  "got fast by giving up early".
- **76**: a stateful `runScript` rather than independent calls. Its trap is a correctness one: a team is in the
  report because it has ROWS, not because it has a total, so maintaining sums alone leaves a stale zero-total entry
  when a team's last row moves away. Track a per-team row count and drop the team at zero.

**All six confirmed real, live 2026-09-13/14, on the actual fixtures (not just read):** 71's dereference-fresh and
C08 504-is-not-a-release-trigger both verified by writing an adapter that gets all 8 cases green only once both are
respected. 73's dict-shaped `limits` (`{rateFor, scoreOf}` bounded by one `B3` id) confirmed by a budgets.json read.
74's 25-id `RangeError` and whole-run duplicate check confirmed by a passing chunked+deduped implementation. 75's
lazy-take trap turned out to be dodged for free by a plain `for...of` + `break` (no generic composable `take`
helper, no lookahead pull) — worth knowing if you're tempted to build one, since that is specifically where the
one-too-many pull comes from. 76's per-team row count confirmed both by design and by the other responder's shipped
`view.mjs`, which deletes the team's map entry at `rowCount === 0` rather than merely zeroing its total. **What the
recon missed:** nothing about the traps themselves — what it didn't say, because it hadn't been hit yet, is that
71-76 need the same incremental-decompose treatment as the data-file family despite being CODE fixtures with a
`worker`-role session; see the dedicated section below this one for what direct implementation costs.

## On the refactor family, a green `npm test` can mean you have done NOTHING

Projects 62+ deliver `refactor/manifest.json` + `refactor/goals.json` and are graded on two things: BEHAVIOUR
(always-checked frozen scenarios) and STRUCTURE (named metrics computed live from `src/` — e.g.
`no_duplicate_block` with `windowLines: 6`, `max_function_lines` with `limit: 30`).

**The baseline tree already passes `npm test` with an empty manifest.** The structural metrics are only evaluated
for goal ids you actually list in `addressed`, so until you claim a goal nothing reveals the violations that remain.
An empty manifest is honest, not a pass — and a green run proves only that you have not broken the behaviour you
were given.

So on these fixtures: read the verifier's metric code, list the goals, and confirm the metrics go green FOR THE
GOALS YOU CLAIM. A responder verified its candidate refactor against the real unmodified verifier in a scratch copy
first — extracting shared modules and splitting the oversized function — and only submitted once it saw 13/13 with
both goals claimed complete.

This is the general trap in its sharpest form: the number you are looking at can be true and still not be about the
thing you did.

**Structural metrics scan the FILES ON DISK, not the import graph.** Project 63's goals include `no_import_cycle`
and a `forbidden_import` rule, and the verifier walks every `.mjs`/`.js` under `src/`. Un-referencing the old module
is therefore not enough — a file nobody imports still counts against you, and the goal stays red. It has to actually
be deleted. No delete tool is offered; `run_commands` with `rm -f <path>` is the way, and a reviewer should confirm
with `list_files` that the file is genuinely gone rather than merely orphaned.

**A class is measured per-method; a closure factory is measured as ONE giant function.** The frozen verifier's
function-span detector skips past a matched function's entire body when it looks for the next span — so nested
helpers inside a factory are all swallowed into their enclosing function's line and branch counts, and a
`max_function_lines` goal is unsatisfiable however tidily you write it. A `class` declaration is invisible to that
detector, so each method is measured independently.

This decides the SHAPE of the fix, not just its quality: project 66's rate limiter had to be a class rather than
the closure-based factory that would otherwise be the natural choice, and the responder confirmed it empirically —
worst method 13 lines of 15, 3 branches of 4, green on the first real run. Check how the detector will see your
design before you commit to it.

Two smaller notes from the same family, worth knowing before you count anything by hand: 64's `no_duplicate_block`
uses `windowLines: 5` where 62 used 6, so the thresholds are per-fixture and must be read rather than assumed; and
its branch-counting regex (`\?[^.]`) also matches `??`, not just ternaries, so a nullish coalesce costs you a
branch.

## A custodian review with NO sandbox — the one loop a bare stop does not end

Distinct from the custodian REOPEN loop. Here `run_commands` fails outright with
`No Docker sandbox workspace is prepared for task main-branch-custodian::review`, and `read_files` is unproductive
too, so you cannot gather fresh evidence for the merge you are being asked to judge. Bare-stopping does NOT end it —
the card comes straight back.

**The escape that works:** submit a real `submit_review` verdict grounded in evidence you already hold. The
custodian is reviewing a merge of cards you almost certainly reviewed yourself earlier in the same shift, with the
same content; that evidence is still valid and still yours. Say in the verdict what it rests on. Live 2026-09-11 a
responder cleared two instances this way after ~3 wasted turns on the first.

What you must NOT do is approve on the shown acceptance line alone, or keep retrying dead tools. The rule against
trusting a shown line is about not inventing evidence — reusing a real test run you performed yourself is not that.

## Trust a fresh `read_files` over the focused code span — and never repeat a write

The `Focused code span` in your prompt can go STALE **within a single card's own session**. Not just across cards:
it can keep showing a version of the file that predates writes that same session already made, and it does not
necessarily refresh as they accumulate.

Live 2026-09-10, project 41 `kill-result-ordering`. A responder saw a span that did not contain its own earlier
write, wrote the same thing again, saw the same stale span, and repeated — about **nine identical `write_files`
calls**. The turn-loop guard then parked the card, which left it held in Review with capture unsettled; the board
stopped issuing requests entirely and the rail discarded the project 4 of 7 cards in.

So:

- **If the focused span and a fresh `read_files` disagree, the file is what `read_files` says.**
- **If you are about to repeat a write you have already made, stop and re-read instead.** A second identical write
  is never the fix, and the guard that stops you is expensive.
- If a write genuinely will not take, say so through a tool (`cannot_resolve` with the concrete blocker) rather
  than retrying it.

## A card with no `dependsOn` edge gets its OWN workspace — not a shared checkout

This is the fact behind several confusing sightings, and it is worth internalising before you write a graph.

Two cards with no dependency edge between them run in **fully isolated workspaces**. Writing a file on one card's
branch does not make it visible to the other: a fresh `read_files` from the sibling shows the pristine stub, no
matter what you just wrote and verified. Only a `dependsOn` edge threads one card's branch onto the next's — that
was confirmed positively on project 51, where card 2 correctly inherited card 1's output.

Live 2026-09-11: a responder accidentally created a second root card writing the same files as card 1, assumed
"whichever runs first, the other will see it", and had to write identical content twice. It merged cleanly only
because the two branches happened to be byte-identical.

Two consequences:
- **A card's prompt claiming "X already exists" is not evidence.** If a fresh `read_files` shows a stub, the stub is
  the truth for YOUR branch. Do not conclude that earlier work was lost — it may simply be on a branch you cannot
  see. (Some earlier "my verified write reverted to an empty stub" reports were probably this.)
- **The isolation extends from a decompose card to the child it spawns.** Confirmed live 2026-09-11, twice: a
  responder wrote the deliverable straight from the decompose card, and the child card's very first turn still
  showed the pristine original stub. So writing the file from the decompose card is not merely a card that fails to
  close — the child cannot see the file either, and will write it again from scratch. Two independent reasons to
  emit the graph and let the child do the writing.
- **Chain anything that shares a file.** This is the mechanical reason the sequential-decompose rule works: the
  edge is what makes the previous card's output visible at all, quite apart from avoiding `git apply` races.

## `decompose_project` validates coverage against the WHOLE project spec

Even when called from inside one stuck leaf card. A redecompose that submits only the card you are fixing fails
specification-coverage validation, because the spec's other bullets — belonging to entirely different cards — are
no longer echoed by any task.

So to redecompose one stuck card: read the existing plan (`.nklein/nklein/plans/<slug>/tasks.json` in the seed
mirror), re-add **every** card verbatim — same prompts, acceptance checks, non-goals, write scopes, content already
proven to pass this gate once — and change only what you came to change. Then `decompose_project` with no `tasks`.

## A `*-decompose` card ALWAYS closes with `decompose_project` — even when the deliverable is a data file

Some fixtures (50 `spec_conformance_suite`, 52 `planning_receipt_ingest_cli`, 53 `warehouse_stock_ledger`) are
graded by a frozen verifier against a DATA FILE — `spec/spec.json` + `conformance/suite.mjs`, or `plan/cards.json`.
It is tempting to conclude the file is the whole job and to write it straight from the decompose card. **Do not.**
The decompose card is a PLANNING card and the only thing that closes it is `decompose_project`. The harness says so
outright if you try otherwise:

> "This is a planning card, not a work card... otherwise complete the planning work this card is for."

Write the file from the decompose card and you get the worst outcome available: the deliverable is correct and
verified green, the planning card never leaves Planning, the board never settles, and the rail stalls the project
out at 45 minutes and re-queues it. **Projects 50, 52 and 53 were each lost this way more than once — 50 six
times — while their actual work was finished and passing.**

So on any `*-decompose` card: emit the graph. Let the CHILD cards write the deliverable. Understanding the frozen
verifier first is still exactly right — it tells you what the child cards must produce — but it is the input to the
graph, not a substitute for it.

**Both halves of that are true at once, and a responder pushed back on it, so be precise.** These fixtures' own
`specification.md` really does name the data file as the deliverable — that is not a misreading. What does not
follow is that the decompose card should write it. The file is the deliverable; the graph is how the card closes.
Write the file from a CHILD card and you get both. Write it from the decompose card and you get a correct file on a
board that never settles.

## The same rule applies to a `*-decompose` card whose `role` reads `"worker"` — and skipping it restarts the WHOLE PROJECT, not just the card

The section above is about the 50/52/53 DATA-FILE family. Live 2026-09-13→14, projects 71 and 72 (single-file CODE
fixtures — one adapter, one reporting module) showed the identical trap wearing a different, more misleading
disguise, and cost two whole projects before it was caught.

Both times the first attempt answered the `*-decompose` card directly — `read_files` the spec, `write_files` the
implementation, `run_commands` a real green `npm test`, then a truthful bare stop on a genuinely correct, verified
deliverable. Nothing about that turn looked wrong: the session's own `sessions.json` even records `"role": "worker"`
for the card, and `write_files` never returned the "this is a planning card" pushback the data-file family gets.
That silence is misleading — **the session's role and the harness's control-plane rule are different things**, and
apparently the board still enforces the latter regardless of the former.

The consequence is worse than a stuck card. Both times, checking back later found:

- `board.json` (the regenerated one, not the stale CRDT snapshot from container start) showing the card in
  **`trash`**, not `planning` and not `completed`.
- The patch genuinely captured as a real commit (`git cat-file -t <sha>` confirms it: `commit`) with the *exact*
  correct diff — but **dangling, on no reachable branch** (`git branch -a --contains <sha>` returns nothing; `git log
  --oneline --all` shows only the initial fixture commit).
- The whole project re-queued from scratch: a brand-new `dev-workspace` directory (fresh suffix), `git log` reset to
  just `Initial dev test fixture`, the stub back in place, `integration/manifest.json` back to `{"complete": false}`.

So: real, verified, correct work — thrown away, and the project pays for a second full drive. The fix is exactly the
incremental protocol already documented above, applied even when the project is ONE cohesive task that cannot be
usefully split (one function, one optimisation — splitting it would just produce a single child identical to what
direct implementation would have written anyway): `add_task` once (no `dependsOn`), `decompose_project` with no
arguments, THEN let the child card do the writing. Confirmed clean on projects 71 (restart), 72 (restart), 73, 74, 75
and 76 (all first attempts, once this was applied from the start) — six for six once the pattern was known.

Three more confirmed details worth carrying forward:

- **`add_task`'s published schema only lists `id`/`title`/`prompt`/`dependsOn`, but it accepts and honours more.**
  Every one of `testability`, `testabilityReason`, `writeScope`, `forbiddenPaths`, `acceptanceCommand` and
  `expectedOutputs` was sent as an extra property on `add_task` (the same field names `decompose_project`'s nested
  `tasks[]` schema documents) and came back verbatim in the child card's own prompt — `additionalProperties: true`
  is not just schema permissiveness, the values are actually read. This is the only way to declare `testability` at
  all through the incremental protocol, and it matters here for the same reason the spec/analysis section above
  gives: `test/**` is frozen and outside the card's write scope, so an undeclared-default `testable` card would hit
  the same impossible test-driven-delivery demand.
- **A successful `decompose_project` call's own result names the correct next move.** The JSON response's
  `instruction` field says outright: *"Stop this planning card now and continue by starting the newly created
  !Klein cards; do not implement this planning card directly."* When you see that string, a bare stop is not a
  guess, it is the harness telling you what it wants.
- **It is not too late to decompose after a turn or two of reading.** Project 75's first turn in a fresh session
  went straight to `read_files` (no decompose) — the same shape that lost 71 and 72. Nothing had been WRITTEN yet,
  so switching to `add_task` + `decompose_project` on the very next turn cost nothing and applied clean. The rule to
  hold onto: decompose before the first WRITE, not necessarily before the first read.

## On a spec/analysis project, declare `testability` at DECOMPOSE time

A task that omits `testability` defaults to **testable**, and the test-driven-delivery reviewer then demands a
test-file change. On the "specification job, not a build job" fixtures — where the entire acceptance is one frozen
verifier — that demand is **structurally impossible to satisfy**: `test/` is outside the card's write scope AND
digest-frozen, so adding a test there fails outright, and a test placed anywhere else is never collected by the
runner. The card cannot pass its gate and cannot legally stop.

Live 2026-09-10: this stranded project 51's `affected-requirements-pass` for six turns, and project 50's
`subtotal-and-total-formula` indefinitely — its deliverable was correct and verified 6/6 green, and the review kept
requesting changes anyway. Two responders burned their closing turns on damage control.

**So when you write a decompose graph for a spec/analysis project, put `testability: "not_testable"` with a concrete
reason on every card whose deliverable is data rather than code.** A responder did exactly this on the stuck card
via redecompose and it landed immediately.

If you are handed a card already stuck in this loop, do not keep re-submitting: the escape is a redecompose that
declares `testability`, which is a plan-level act, not a worker turn. Say so through `cannot_resolve` with the
blocker named.

## The `[module: path]` planning-fixture family: three traps that stack, not replace each other

Projects 50/52/53 established the base shape (a `plan/cards.json` graded by a frozen `test/plan.test.js` that
derives obligations from `input/specification.md` itself, so re-implementing its parsing IS the work). 54, 55 and
56 each added one more constraint on top — read the live verifier every time; do not assume last project's shape:

- **Shared-module obligations must collapse onto one card** (54 on, confirmed again on 55/56): several `OBL-NN`
  lines can carry the identical `[module: path]` tag. One card per obligation then fails "no two cards claim the
  same file" the moment two obligations sharing a module land on separate cards. Group by module first, obligation
  IDs second.
- **`[uses: path]` tags are an import graph, not a suggestion** (55 on): a verifier test — *"a card reaches the
  card that builds every module its obligations use"* — walks `dependsOn` transitively and fails if a consuming
  card cannot reach the card that builds a module it `uses`. The spec says this outright: obligation-to-obligation
  dependencies are never stated; only module-to-module `uses` edges are, and `dependsOn` must be derived from
  those, unioned across every obligation a card covers.
- **A stated `Card ceiling: <n> cards.` can look scarier than it is** (56): `deriveCardCeiling` parses that one
  line and a test fails if `plan.cards.length` exceeds it. Before inventing a coarser multi-module grouping, just
  count how many *distinct* `[module: path]` values the obligations actually use — on project 56, 42 obligations
  collapsed to exactly 29 modules against a ceiling of 30, so the same one-module-per-card rule already used for
  54/55 satisfied it with room to spare. Do the count before assuming you need to merge unrelated modules onto one
  card (which would also cost you the per-card `MAX_FILES_PER_CARD` headroom for no reason).
- **Documentation-only obligations** (`(documentation-only)`, first seen on 54, absent from 55, back on 56) must
  never share a card with a code obligation, and that card must be `not_testable`. Whether a given project has any
  depends on the spec — 55 had none at all, so every card was a "code" card; don't assume the pattern from the
  immediately preceding project carries over.

None of these subsume each other — 56 needed all four checks (module grouping, `uses`-reachability, the ceiling,
and doc-isolation) satisfied simultaneously by the same 29-card plan. Read the live `test/plan.test.js` for the
project in front of you; do not assume it matches whichever of 54/55/56 you last drove.

## Never put an edit and its verification in the same turn

A green `npm test` is not evidence your edit landed. On these fixtures it very often passes whether or not you did
the work, because the frozen verifier checks the *shape* of what is there, and what is there is the previous card's
correct output.

Live 2026-09-10, project 47's `record-returns-agent-requirements`. The worker emitted `edit_file` and
`run_commands: npm test` in ONE turn. The edit was rejected — *"edit block 1 did not match spec/requirements.json.
Closest match was 40% similar"* — and `npm test` then passed 4/4 **vacuously**, because the file was untouched and
the previous card's three entries were well-formed. The model read the green result and reported *"npm test is 4/4
green post-edit, confirming both new entries are correctly formed."* Neither entry existed. No result branch, no
commit, nothing on `main`. The card had to be re-driven a shift later.

So, without exception:

- **Re-read the file immediately before you write an anchor.** Never reconstruct the current text from memory or
  from what a sibling card wrote.
- **Make the edit, see its result, THEN verify in a later turn.** Bundling them means you interpret the test before
  you have read the edit's outcome.
- **After any edit, re-read the file and confirm your change is actually in it** before declaring anything done.
- **When reviewing, never approve on a shown acceptance line.** Do your own `read_files` and `npm test` in-session.

Two consecutive shifts followed this and shipped ten cards between them with zero unlanded work, each one confirmed
host-side with `git log --oneline --all`. It is the cheapest rule in this brief and it closes the most expensive
failure.

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

## An idle queue and a dead queue look identical — and `docker ps` does NOT tell them apart

Live 2026-09-13→14: the queue went completely dry for 25+ minutes in the middle of an otherwise-healthy shift —
every `hitl-next-request.sh` call returned `NONE`. Two shifts read the same `docker ps -a` picture as a provisioning
hang: `nklein-egress-proxy-ws-9f2194a2c4bd` up alone, with no `nklein-agent-sandbox-ws-9f2194a2c4bd-1` at any
status. Both reported it as an orphan needing host-side cleanup, and the second polled through 40 more `NONE`s
(~90 minutes) re-confirming it.

**That reading was wrong, and the ledger says why (corrected 2026-09-14 with evidence).** The telemetry for that
workspace shows `sandbox_container_retired … nklein-agent-sandbox-ws-9f2194a2c4bd-1 (occupancy 0)` at 22:45:38 and
again at 23:08:26: the pool IDLE-RETIRES a sandbox whose last placement was disposed, and keeps the egress proxy up
on purpose — the next acquire in that workspace reuses it. `proxies > sandboxes` is therefore also the normal
picture of a workspace whose cards are all done. And the cards WERE all done: 71–76 had every card approved, so the
queue was dry because the batch was complete, not because anything hung.

**What actually distinguishes a hang from an idle factory:**

1. The board: `workspace.getState` with cards still in `planning`/`in_progress`/`review` and no request for 20+
   minutes is a stall; a board with everything in `completed`/`trash` is finished. Check the board, not Docker.
2. The runtime's own record. A start that never provisions now FAILS instead of hanging: after the provisioning
   deadline (`NKLEIN_SANDBOX_PROVISION_DEADLINE_MS`, default 15 min) the ledger carries
   `sandbox_provisioning_deadline_exceeded` with the pool's state, and the single-flight claim is released
   (`start_in_flight_released_as_hung`). Those two observations ARE the hang signature; a proxy without a sandbox
   is not.
3. Never `docker rm` a proxy on the strength of `docker ps` alone — a live runtime's proxy is torn down by that
   runtime (`stopNow`), and a dead runtime's proxies are reaped by ownership at the next startup.

**What a responder should still do when the queue goes dry:** confirm the board state, say plainly in the report
whether the drive is finished or stalled (with the evidence), and end the shift after a fair number of polls rather
than re-confirming the same picture for another hour. `NONE` costs nothing, but a diagnosis that names the wrong
mechanism costs the next shift.

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
