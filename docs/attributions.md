# Attributions — who we learn from, copy, and imitate

!Klein deliberately steals good ideas — and just as deliberately says so. This file is the standing home for
**mechanism-level credit**: every project whose implementations, logics, or mechanics we adopted, adapted, or
imitated is listed here with what we took and where it lives in !Klein. License-level attribution for code we
ship lives in [NOTICE](../NOTICE) and per-vendor notices; this file honors the ideas.

> Standing rule (David, 2026-07-23): when we take over implementations, logics, or mechanics from anywhere —
> or imitate them — the source is recorded here in the same change. We honor everything and everyone we learn from.

## Cline / Cline Kanban (base fork)

- **What:** the entire agent engine base (`@cline/*` SDK, vendored from source) and the original Kanban board
  this project forked from.
- **License:** Apache-2.0. Full fork attribution in [NOTICE](../NOTICE) and
  [vendor/cline-sdk/NOTICE.md](../vendor/cline-sdk/NOTICE.md) (including the patch ledger).

## little-coder (Itay Inbar) — https://github.com/itayinbarr/little-coder

A sibling project with !Klein's own thesis — scaffold–model fit over model scale, local-first on small
hardware — built on the pi substrate (Mario Zechner). Apache-2.0. Reviewed 2026-07-23 (v1.11.0).

- **Adopted — streaming reasoning-budget breach** (their `thinking-budget` extension →
  [src/core/reasoning-budget-breach.ts](../src/core/reasoning-budget-breach.ts)): watch the reasoning channel
  WHILE it streams; on breaching a per-turn budget, abort the turn immediately, disable thinking, and nudge the
  model to *commit to an implementation now* — instead of letting the whole completion budget burn on
  `reasoning_content` and classifying the failure afterwards. We kept their `ceil(chars/3.5)` token estimate and
  4096-token default for comparability, and their forced-off state rule (thinking stays off across the recovery
  chain, restored on genuine user input or a fresh session). This complements !Klein's post-turn §5.AA ladder
  (`raise_token_budget` / `thinking_disable` rungs), which reacts only after a turn has already failed.
- **Adopted — external benchmark baselines:** their published Aider Polyglot / Terminal-Bench / GAIA results for
  the same model families !Klein runs (see the external-baselines section of
  [docs/dev/repository-benchmarks.md](./dev/repository-benchmarks.md)) are recorded as honest external
  comparators for our own campaigns.
- **Noted, not (yet) adopted:** llama.cpp-first MoE-aware local serving (feeds the P17.1 runtime-adapter
  evaluation); per-turn skill/knowledge injection scoring by error recovery, recency, and intent (cross-referenced
  from §4C dynamic prompt skills); plan-mode research-only sub-coders. Several of their mechanisms are parallel
  evolution of things !Klein already has (context watchdog ≈ context-occupancy-pressure at the same ~0.8
  threshold; quality monitor ≈ !Klein's loop/turn guards + PRM watchdog; read-before-edit; evidence store ≈
  focus briefs) — convergent designs are recorded as corroboration, not adoption.

## container-use (Dagger) — https://github.com/dagger/container-use

- **Adopted — the `apply` trust level as !Klein's `stage` delivery mode (P21.13a, 2026-07-24):** container-use
  ships two delivery trust levels — `merge` (machine-authored merge commit, full history) vs `apply` (changes
  staged UNCOMMITTED so the human authors the commit). !Klein's auto-review modes gained the third option
  `stage` ([task-worktree-auto-merge.ts](../src/workspace/task-worktree-auto-merge.ts)
  `stageTaskResultUncommitted`): the reviewed result lands as staged, uncommitted changes via
  `git merge --squash`; on conflict there is deliberately no machine-authored resolution (a human-trust mode
  never receives agent conflict resolutions), and the result branch is kept as the recovery path.
- **Queued from the same source:** secrets-as-references resolved at container exec (P21.13b) and
  executed-command audit logging (P21.13c).

## "Local LLM calls a stronger model when stuck" (XDA Developers article)

- **Source:** https://www.xda-developers.com/taught-local-llm-call-fable-5-gets-stuck-changed-everything/
  (reviewed 2026-07-23; brought in by David). The author gave a local 7B an `ask_fable` TOOL gated by three
  explicit stuck-conditions; the stronger model answers a scoped question and the answer returns into the live
  session as a tool result.
- **Adopted — model-initiated peer consultation**
  ([src/core/model-consult.ts](../src/core/model-consult.ts)): the in-session consult tool pattern, the three
  stuck-conditions (kept nearly verbatim in the tool description), and the scoped four-field request shape
  (problem / attempts / error / relevant context). !Klein's adaptations: the consultant is the strongest
  ELIGIBLE **local** model (loaded + idle + materially stronger — the local-only prime directive; the article's
  cloud consultant maps to the hard-gated Phase 14), the stuck-gate is additionally HARNESS-enforced (admission
  after ≥2 recorded failed attempts, per-card consult budget — never trust a prompt rule alone), and answers come
  back explicitly advisory. This complements the harness-driven §5.AA `cross_model_carry` rung by avoiding its
  overhead: no session teardown, no cold prompt cache, no redone work.

## DeepSeek Harness (dsh) — https://github.com/deepseek-ai/deepseek-harness

An open-source agent harness by DeepSeek AI (MIT, Aug 2026), built on Cordis with an "everything is a plugin"
architecture. Reviewed 2026-08-16 (developer preview; brought in by David). We are grateful for a design that
states its invariants out loud — the architecture doc alone sharpened how we talk about our own session model.

- **Adopting — "model-visible means logged"** (their session subsystem → !Klein session runtime, tracked as the
  log-derived-prompts slice): the session log as the SOURCE of model context — `deriveMessages()` projects every
  request's history from an append-only event log, with a runtime invariant that anything model-visible is
  reconstructable from it. For !Klein this directly attacks the green-signal class we keep re-finding (prompt
  drift; sim matchers recorded against stale seeds): log-derived prompts make every prompt-shape change
  replayable and let aimock scenarios be recorded from the log deterministically.
- **Adopting — session fork at a step boundary** (`ctx.sessions.fork(source, boundary)` → §5.AW adjacency): a
  cheaper best-of-N than !Klein's `::spec` full-restart mirror, and checkpoint-retry for risky steps.
- **Adopting — evidence bed, not code: scaffold-vs-scaffold** (their `dsh-headless` bundle + OpenAI-compat
  adapter pointed at LM Studio): the same task run under dsh-scaffold vs !Klein-scaffold on the SAME local model
  isolates how much of a model's failure is scaffold-dependent; where their prompt-section and tool-schema
  shapes win, we harvest them (with credit back here).
- **Adopted in spirit already, reinforced by their doc:** a rejected first claim still logs a durable zero-step
  turn ("the log records the attempt") — the same observation-truth principle as !Klein's spawn-skip and
  redecompose-rung records; and their inbox-claim discipline (injected context never lands mid-step) mirrors
  what our queued-input path should guarantee and now names.
- **Noted, not adopted:** the Cordis profile/bundle/patch composition (configuration-first composability — !Klein
  is deliberately code-first); capability seams and the goals service are parallel evolution of !Klein's sandbox
  tool executors and focus-chain/re-anchor — recorded as corroboration.

## opencode-swarm — https://github.com/sst/opencode

- **What:** five cores ported 2026-07-15 into !Klein's delivery/watchdog/audit seams (placeholder + quality
  gates at the delivery seam, PRM-style watchdog, gate-audit CLI, memory-lifecycle pass), per David's "pick
  everything that benefits" green light.
- **Where:** the §opencode-swarm port entries in [done.md](../done.md).

## Research-derived mechanisms

Phases 12 and 15–23 of the backlog adopt mechanisms from published research and named competitor post-mortems
(METR, Cursor, Fusion, Cognition, container-use, wit, Roo/Kilo Code, and the primary sources cited inline).
Each adoption names its source in the corresponding `todo.md` / `done.md` entry; entries graduate into this file
as they ship.
