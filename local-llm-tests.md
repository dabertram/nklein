# local-llm-tests.md — small-model output-robustness sweep log (todo §5.O)

> **Purpose (todo §5.O):** make !Klein **robust against the varied output of different *small* local models**. This
> file is the running log alongside the actual deliverable — **shipped code hardening + tests**. Each round records:
> *which small models were swept · what broke in their output handling · what was hardened in !Klein's code.*
>
> **In scope now:** correctness/robustness against small-model output (tool-call malformation, narration-as-tool-call,
> no-tool-call stalls, structured-output misses, reasoning runaways, repeated-call loops). **Out of scope until the
> user calls a version release-able:** any performance/efficiency comparison and the size × quant × context matrix.

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
