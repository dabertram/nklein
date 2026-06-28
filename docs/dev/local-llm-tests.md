# local-llm-tests.md — small-model output-robustness sweep log (todo §5.O)

> **Purpose (todo §5.O):** make !Klein **robust against the varied output of different *small* local models**. This
> file is the running log alongside the actual deliverable — **shipped code hardening + tests**. Each round records:
> *which small models were swept · what broke in their output handling · what was hardened in !Klein's code.*
>
> **In scope now:** correctness/robustness against small-model output (tool-call malformation, narration-as-tool-call,
> no-tool-call stalls, structured-output misses, reasoning runaways, repeated-call loops). **Out of scope until the
> user calls a version release-able:** any performance/efficiency comparison and the size × quant × context matrix.

## ⚠️ Round 3 correction (2026-06-24): the dev-test projects DO run small models — observe the SESSION, not the board

Round 0's Findings 3–4 ("`test-project` doesn't run the seed / can't observe output") were a **measurement error**:
I watched **board card columns**, which are decoupled from the **session** that actually executes. The correct,
working vehicle + lens (use the **dev-test projects**, as directed):

1. `projects.createDevTestProject({ preset })` (needs `NODE_ENV=development`, which `dev:full` sets) scaffolds a real
   fixture project + a **seed card in backlog** + an evidence dir, and makes it the active workspace.
2. Pin the small model (`runtime.saveNKleinProviderSettings`), then **start the seed card** with the full request
   (`taskId` + `prompt` + `baseRef:"main"`; the scenario supplies prompt/title) — `runtime.startTaskSession`.
3. **Observe via the session, not the board:** poll `workspace.getState().sessions[taskId]` for `state` /
   `reviewReason` / `latestHookActivity`, and read the captured **result branch** (`nklein/tasks/<taskId>-<hash>`) for
   what the model produced. The scaffold-time **evidence bundle** under `~/.nklein/nklein/dev-runs/<run>/` is *not*
   updated by the run (it's a scaffold artifact: `Transcripts: 0`); the live signal is the hook-activity stream + the
   result branch. (The board card may sit in `backlog` even as the session reaches `awaiting_review` — they're
   separate stores.)

**Verified live (gemma-4-e2b):** both `mid_task` ("Decompose Add habit insight summaries") and the heavier
`complex_dag` ran to `awaiting_review` (`reviewReason:"exit"`), each emitting `sandbox_patch_captured` + a coherent
result branch (`mid_task`: `specification.md` +34/−12; `complex_dag`: a captured patch in ~171s) — i.e. the 2B model
**drove real swarm+Docker tasks to captured results on two presets**. Both runs **succeeded**, so they surfaced no
new output-failure to harden — !Klein's existing hardening held for gemma on these tasks (good news for §5.O: the
robustness shipped so far is sufficient here).

**Cataloging lesson for Round 4:** *polling* `latestHookActivity` only ever captured the **terminal**
`sandbox_patch_captured` event — the per-`tool_call` activity flew by between polls. To actually catalog silent
recoveries / malformations / loops, **subscribe to the runtime's live activity stream** (the WS/event feed the UI
consumes) for the duration of the run, not poll the session snapshot. The dev-test project is the run vehicle; the
**activity-stream subscription** is the lens.

## Round 5 — the capture harness lands; gemma-4-e2b's swarm-path output is clean (2026-06-24)

Built the reusable **[scripts/sweep-capture.mts](scripts/sweep-capture.mts)** — one command pins a model, scaffolds a
dev-test project, **subscribes to the runtime's `/api/runtime/ws` activity stream**, records every `task_chat_message`
the agent emits, runs to a terminal session state, then **catalogs** the output (tool-call tally, narration-markup
leaks, genuinely-repeated calls by *full* content, role tally) and restores the model + removes the project. This is
the per-`tool_call` lens Rounds 0–4 said §5.O needs.

**gemma-4-e2b on `mid_task` (1329 messages captured):** tool calls `update_focus_chain×4, read_files×2, write_file×2`;
**narration-markup leaks: 0**; **genuinely-repeated tool calls: 0**; terminal `awaiting_review`. So the swarm path is
**clean** for this 2B model — no leaked narration (that was a *chat-path* issue, Round 1; the swarm SDK path emits
structured calls), and the full-input-fingerprint guard correctly let the *advancing* `update_focus_chain` through (a
first coarse 120-char-prefix dedup mis-flagged it "6×" — fixed to full-content comparison, which is the guard's own
semantics). Existing hardening holds end-to-end; no new fix. (Aside: ~1062 `reasoning` messages = streaming-delta
granularity, not a runaway — the turn completed within guardrails.)

**Round 5 takeaway:** the §5.O sweep is now a **one-command capture** for any loaded model/preset. Future rounds just
run `sweep-capture.mts` across models/presets and harden anything it flags (leaks / true repeats / non-terminal
stalls). So far gemma-4-e2b is robust on `mid_task`+`complex_dag`.

## Round 8 — the sweep surfaced a real board bug + finished the gemma-e2b preset matrix (2026-06-24)

- **gemma-4-e2b on `audio_vst`:** completed (`awaiting_review`), 32 tool calls (`write_file×24`, `update_focus_chain×4`,
  `list_files×2`, `read_files×2`), **0 leaks, 0 repeats** — robust on a heavy 24-file domain task.
- **gemma-4-e2b on `daw_foundation`:** non-terminal in the 5.5-min window (read_large_file×4 + heavy reasoning), **0
  leaks, 0 repeats** — slow on a big-context task, not stuck (like qwen3, governed by the wall-time guardrail).
- **Tally clean: gemma-e2b {mid_task, complex_dag, audio_vst} + gemma-e4b {complex_dag}; qwen3-8b reasoning-heavy/slow.**

**The sweep work paid off beyond robustness: it surfaced a real board bug.** Watching the dev-test seed via
`getState().sessions` (Round 3) showed the session running while the **board card stayed in Backlog** — which the user
flagged as wrong (a card shouldn't show agent activity in Backlog). **Fixed:** `runtime.startTaskSession` now calls
`reconcileRunningTaskBoardLane` on a successful start (previously only the input/resume paths did), so a started card
moves Backlog → Planning/In-Progress regardless of entry point (web-ui, CLI, or programmatic). Live-verified (lane
`backlog` → `planning` on start) + a regression test. (The deeper "all cards through a planning/refinement lane"
workflow the user proposed is scoped separately in todo §5.B.)

## Round 7 — qwen3-8b (reasoning model): harness leak-detection refined; reasoning-heavy + slow, not stuck (2026-06-24)

Swept qwen3-8b (a **reasoning** model). First pass flagged "narration leaks", but they were **harness false positives**:
the model "thinks" `<tool_call>{…}` in its **reasoning channel** (streaming deltas), which is exactly what
`recoverNarratedToolCalls` recovers (tools executed fine). **Refined `sweep-capture.mts`** to count a *leak* only when
narration markup survives into a user-facing **`assistant`** message; reasoning-channel narration is reported
separately as informational (internal, recovered). Re-run with the fix:

- `mid_task`: **0 assistant leaks, 0 reasoning narration, 0 repeats**; tools `decompose_project×2`; 468 reasoning
  messages; **terminal not reached in 7 min**.
- `complex_dag` (earlier): tools `decompose_project×6` + `update_focus_chain×2` (all advancing — 0 true repeats); 976
  reasoning messages; **terminal not reached in 6 min**.

**Finding 7 (characterization, not a parse-recover bug):** qwen3-8b spends almost all its budget in the reasoning
channel and barely acts (2–8 tool calls, hundreds of reasoning deltas), so it **doesn't reach a terminal state in the
short sweep window** — but it's **not stuck**: no loops (0 true repeats), no user-facing leaks, and any reasoning-channel
narration is recovered. This is a model-behavior trait (reasoning-runaway / slowness), governed by the existing
**wall-time / per-turn timeout guardrails** (2h default), not a parse-and-recover gap. Out of the §5.O harden-the-output
lane (like Finding 6 grounding). *Candidate future lever (low confidence): a `/no_think`-style reasoning-budget nudge
for reasoning models on planning turns — but that's prompt-tuning, deferred.* Non-reasoning small models (gemma-e2b/
e4b) complete the same presets in ~3 min, clean.

## Round 6 — gemma-4-e4b on the heavier complex_dag: also clean (2026-06-24)

`sweep-capture.mts --model google/gemma-4-e4b-m5max --preset complex_dag`: **5514 messages**, 24 tool calls
(`read_files×10, edit_file×8, update_focus_chain×4, list_files×2`), **0 narration leaks, 0 true repeated calls**,
terminal `awaiting_review`. So a heavier task (24 tool calls incl. 8 real `edit_file`s) on the 4B model also completes
cleanly through the swarm path — the existing hardening holds. (Aside: 4602 `reasoning` messages — gemma is verbose in
its reasoning channel, but the turn stayed within guardrails.) **Tally so far: gemma-4-e2b {mid_task, complex_dag} +
gemma-4-e4b {complex_dag} — all clean, no new fix needed.** Remaining one-command runs: qwen3-8b + the `wide_fanout`/
`many_small` presets.

## Methodology (how to run a round)

The agent that small models drive lives in the **runtime swarm** (decomposition + Docker task agents). To sweep one
small model:

1. **Pin the model** the swarm uses. The runtime resolves its model from the **NKlein provider settings**
   (`providerId` / `modelId` / `baseUrl`), not just live discovery — verified 2026-06-24: the settings had
   `qwen/qwen3-8b-m5max` pinned even though `~/.nklein/nklein/config.json` listed no model. Set it with the
   `runtime.saveNKleinProviderSettings` tRPC (`{ providerId: "lmstudio", modelId: "<loaded id>", baseUrl:
   "http://127.0.0.1:1234/v1" }`) against the running runtime, and **restore the original afterwards** (capture it
   first via `runtime.getConfig`). `lms ps` lists the loaded LM Studio ids.
2. **Run a dev-test** against a **fresh** workspace: `nklein dev test-project --preset <p> --project-path <fresh git
   repo> --max-wait-ms <bounded>`. Use a throwaway repo, **not** a workspace with pre-existing cards (see Finding 1).
3. **Mine** the classified outcome + the evidence bundle / telemetry for the model's **output** failure modes.
4. **Harden** !Klein (parse-and-recover at the `afterModel` seam, guardrails, prompt/budget) + add a regression test.
5. Append the round here.

## Round 0 — methodology shakedown (2026-06-24, model: google/gemma-4-e2b ~2B)

Goal of this round was to stand up the sweep loop end-to-end against the smallest loaded model. It surfaced two
**harness** frictions (not yet model-output findings) that must be fixed for clean rounds:

- **Finding 1 — stale-board short-circuit.** `dev test-project` against the **!Klein repo's own workspace** classified
  `completed` in **1 poll** because that board already had 4 completed cards from earlier runs — the seed never ran a
  fresh decomposition, so we observed nothing about the model. **Fix for the harness:** always sweep against a fresh
  throwaway workspace (now in the methodology), or clear the board first.
- **Finding 2 — cross-process lock contention.** Running `dev test-project` against a **fresh** `--project-path`
  while `npm run dev:full` is also running failed with **"Failed to start !Klein: Lock file is already being held"**:
  `loadWorkspaceContext(freshPath, { autoCreateIfMissing: true })` + the CLI's runtime touch contends with the
  long-running dev-server's lock (the cross-process `proper-lockfile`, not the in-process mutex the swarm uses). **Fix
  for the harness:** sweep with the shared dev server **stopped** (let the CLI own the runtime), or run the sweep
  runtime under an **isolated `HOME`** so the locks don't overlap. *(Candidate code hardening to evaluate next round:
  a clearer, retrying acquire + a "another !Klein is already running for this home" message instead of the raw
  lockfile error — tracked under §5.O.)*

After fixing 1+2 (pre-register a fresh throwaway repo via `projects.add` → empty board, no registry-write
contention; runtime kept up so the `test-project` *client* has something to connect to), two **deeper** findings
made it clear `test-project` is the wrong instrument for §5.O:

- **Finding 3 — `test-project` classifies board OUTCOMES, not model OUTPUT.** It polls board card counts and reports
  `completed`/`failed`/`incomplete`. §5.O needs the agent's **raw output stream** (tool calls, narration, malformed
  args, stalls) — which board counts can't show. With an empty board the run even classifies `completed` vacuously
  ("0 non-trash cards → all completed").
- **Finding 4 — the dev-test seed doesn't actually run via the CLI client path.** `executeDevTestPreset` seeds by
  calling `runtime.startTaskSession` for a **card-less** `devtest-<scenario>-<ts>` task, then polls the board. In
  this CLI-client setup it returned **`started: true` but nothing executed**: gemma-4-e2b stayed **IDLE** (`lms ps`)
  and **no** session/activity files were written under `~/.nklein/nklein` in the run window. So there was no model
  output to observe at all. *(Root cause not yet traced — candidate: a session started for a taskId with no board
  card isn't picked up by the swarm / isn't reflected in `workspace.getState`. Tracked for Round 1.)*

**Conclusion → the sweep needs a purpose-built observation harness (todo §5.O "option A").** Rather than the
board-classifying `test-project`, Round 1 should drive the agent directly and **capture its raw output**: either
(a) a small isolated-runtime harness that starts a real task and tails the NKlein **session activity / evidence**
for the seeded task, or (b) exercise the agent loop against the pinned small model through a path that surfaces every
`tool_call` / content chunk (the chat tool-using loop already does this for its 3 tools and is the cheapest first
lens, even if it doesn't hit the swarm's `recoverNarratedToolCalls` seam). **No gemma-4-e2b output failure modes
catalogued yet** — Round 0 established that the *instrument* must change first.

## Round 1 — gemma-4-e2b via the chat tool-using lens (2026-06-24)

Used the **chat tool-using agent** (`nklein chat --workspace --model google/gemma-4-e2b-m5max [--allow-write]`) as the
observation lens (per Round 0's conclusion) — it takes an explicit `--model`, surfaces every tool call + the final
reply, and needs no Docker/dev-server/swarm. Caveat: LM Studio normalizes the model's tool calls into the structured
`tool_calls` API, so this lens tests gemma *driving* tools (not the swarm's raw-output `recoverNarratedToolCalls`
seam). Two tasks against a tiny 2-file workspace:

- **Read task** ("which functions are in math.js?") — **clean**: gemma called `list_dir` → `read_file` and answered
  accurately (`add`, `subtract`). No loop, no malformation.
- **Write task** ("create greet.js…") — the write **executed correctly** (file written), but gemma's **final**
  (tools-disabled) reply was a **narrated tool call** leaking raw markup to the user:
  `"<|tool_call>call:write_file\nfile_name: greet.js\ncontent: |\n  function greet(name) {…"`. The action was done; the
  model just narrated another call as its "answer" (a non-JSON, YAML-ish body — `parseNarratedToolCalls` can't even
  parse it).

**Finding 5 (output failure) → HARDENED.** Weak models narrate a tool call as text in their final answer instead of
confirming. Added [`stripNarratedToolCallMarkup`](src/nklein-agent/nklein-narrated-tool-call.ts) (reuses the existing
narration-marker regexes: `<tool_call>`/`<|tool_call|>`/`<function_call>`/`<|python_tag|>`/`[TOOL_CALLS]`/
`<function=…>`): it cuts from the first opener marker to end-of-text, keeping only the natural-language prose before
it. `runChatAgentTurn` ([chat-agent-turn.ts](src/chat/chat-agent-turn.ts)) cleans the final reply with it and, when
nothing readable remains but tools ran, substitutes a brief `Done. (used: …)` confirmation. Unit-tested (the exact
gemma string → `""`; prose-before-markup kept; no-op for plain prose) + the turn-level confirmation fallback.
**Re-verified live**: the same gemma-4-e2b write task now replies `"Done. (used: write_file)"` (no markup leak; file
still created). Unlike `recoverNarratedToolCalls` (which *executes* narrated calls in the swarm path), this only
cleans *display* text on the final tools-disabled turn.

*Next:* gemma-4-e4b + qwen3-8b through the same lens; then the swarm/`recoverNarratedToolCalls` path (which needs the
Round-0 observation harness, since `test-project` can't surface raw output).

## Round 2 — gemma-4-e4b + qwen3-8b via the chat lens (2026-06-24)

- **Write task (both models): clean.** Each called `write_file` once and the file was written correctly; the
  narration fix from Round 1 held (no markup leak). *(Their `--json` replies weren't captured cleanly here — the
  stdin confirm prompt is printed on the same line as the JSON `{`, a capture-grep artifact, not a model issue.)*
- **Finding 6 (observed, NOT a parse-and-recover fix) — grounding failure on the read task.** Both models called
  `read_file` but then **ignored the result** and answered from priors: qwen3-8b confabulated about the famous
  *mathjs.org* library ("over 250 functions…"), gemma-4-e4b gave a vague "math.js is a library available… the
  snippets are very limited" non-answer — neither listed the file's actual `add`. This is a **model-capability /
  grounding** weakness, not an output *format* issue, so it's **out of the parse-and-recover lane** (the §5.O
  principle is "recover in !Klein, don't teach the model" — and you can't parse a model into using its tool result).
  Candidate soft mitigation to weigh later (low confidence on weak models): a more imperative framing of the folded
  tool result (e.g. "Answer ONLY from this tool output:") instead of the current neutral `Tool result (id): …` note.
  Logged, not implemented (no speculative prompt-tuning). Interesting that the *smallest* model (e2b) grounded
  correctly on the read while the larger e4b/qwen3-8b drifted — reinforces "robustness ≠ size; test the behavior."

## Hardening already shipped this session that pre-empts known small-model output failures

These landed via §5.M/§5.O work and directly serve the sweep's goal (recorded here as the running tally):

- **Repeated identical tool-call de-dup** in the chat agent loop (`chat-agent-loop.ts`) — small coder models re-issued
  the same `read_file`/`write_file` 4–6× until the iteration cap; now the call runs once and the loop short-circuits
  to a clean answer (re-verified live: 4–6 steps → 1). Mirrors the NKlein agent's full-input-fingerprint guard.
- **Narrated / non-OpenAI tool-call recovery** (`nklein-narrated-tool-call.ts`) covers Hermes/Qwen `<tool_call>`,
  Llama `<|python_tag|>`, Mistral `[TOOL_CALLS][…]`, OpenAI-nested `function:{…}`, and Functionary `<function=…>`
  shapes — weak/quantized models that *narrate* a tool call instead of emitting a structured one still dispatch.
- **`read_large_file` pure-iteration** (`cursor: "next"`) — small models no longer have to compose `read:`/`stitch:`
  cursors, removing a frequent malformed-arg failure mode.
- **Confirm-gate as a backstop** — even when a flaky small model spams a mutating tool, only confirmed calls execute
  (live-verified: a spammed `write_file` ran once, the rest were refused + audited).
