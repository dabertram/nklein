# goal.md — standing goal & working mode (re-entry point)

> **Point me at this file to resume autonomous work.** It is intentionally *generic + process-oriented*: it tells you
> how to find and advance the next thing, so it stays valid even after the current chapter (or the whole current backlog)
> is done. It owns no task list of its own — **[todo.md](todo.md) is the single source of truth**; this file is the
> operating contract for working it.

## The standing goal

Drive **!Klein / nKlein** (the local-only, Docker-isolated, multi-LLM kanban swarm) forward **autonomously and
continuously** — clearing the backlog while raising the ceiling of what the swarm can reliably do. Work in clean,
bounded, always-green increments. **Don't stop while anything on the backlog can still be advanced** (decide a sensible
next step even for things that will only be *adapted later with low effort*).

> **DIRECTION CHANGE — capable-model-first to punch the backlog (user 2026-06-29; supersedes the earlier "smallest /
> most-limited models first" emphasis).** We've already learned a lot from weak models and *substantially improved the
> model interface* (the §5.AN leverage map, the §5.AA robustness ladder, the §5.AL suitability gate). So **shift the
> primary effort to a more capable model and drive !Klein's features + the §5 backlog hard with it** — less time spent
> hardening against potentially-unsuitable weak models. Concretely: **work with `qwen3.6-27b q8` until we hit its
> limits**, then research the best bigger/stronger local candidate online (§5.AL/`model-catalog-recommendations.md`) and
> escalate. **Broad small/less-capable-model testing is POSTPONED, not abandoned** — it resumes later; the learnings and
> the robustness machinery stay. **In parallel, the runtime-unsuitability story must be solid + ready2use**: !Klein
> detects an unsuitable model *at runtime* (not only the pre-flight §5.AL gate) and **collects persistent data** about
> it, so the catalog/ledger keep learning while we focus elsewhere.

## Prime directives (never traded away — see todo.md §4A / §5 for the canonical text)

1. **LOCAL MODELS ONLY** (`CLOUD_ENABLED=false`). Re-enabling cloud is a single deliberate, reviewed code change — never
   a feature you slip in.
2. **STRICT DOCKER AGENT ISOLATION** — mandatory, unconditional, fail-closed.
3. **≥32k context floor** (`NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = 32_000`).
4. **Upstream-clean SDK boundary** (no `@nkleinbot/*` imports outside `src/nklein-agent/`).
5. **PROTECTED TESTS are human-gated** (`test/protected/**`) — cannot be weakened without explicit approval; default deny.
6. **Follow AGENTS.md**: no `any`, no inline/dynamic imports, keep `CHANGELOG.md` `[Upcoming]` current, hard-won patterns
   go in **todo.md §4A**.

## Working mode

- **Substrate-first / pure-core-first.** Build pure, deterministic decision cores with their tests *before* wiring them
  to the hot path. Inject effects via ports so the logic is testable with fakes; keep store/runtime imports out of cores.
- **MCF drives the order** (todo.md §5.0.3 — the Milestone-Challenge Framework). Each milestone is guarded by a
  cumulative challenge ladder (catalog: [docs/dev/milestone-challenges.md](docs/dev/milestone-challenges.md); per-cell
  scores: [docs/dev/cross-model-verification.md](docs/dev/cross-model-verification.md)). A challenge is **meant to pass**,
  but its real job is to **surface a limitation that structures the next chapter** — never brute-force a challenge with
  random code-fiddling. Re-run all prior challenges each milestone (continuous stabilization).
- **Limitations are PROVISIONAL.** A model hitting a difficulty wall is *valuable data* (design/fitness/user-advice),
  not a failure to hide — record it (`⚠️` capability-floor) only after repeat-runs + the full §5.AA ladder, never judge
  prematurely. Then keep trying to *solve* it: revisit earlier limitations every chapter and during idle time, reasoning
  about what new rung / repair / context / skill / bigger model lifts it. Flip `⚠️`→`✅`/`◑` the moment one does.
- **Model-capability ladder.** When a challenge exceeds the current roster, **load bigger local models first** (the test
  machine — 128 GB RAM + M5 Max — runs up to ~120B at lower quantization). Only *after* local is genuinely maxed do the
  future cloud-escalation (Phase B) and expert/Claude-guided-flow (Phase C) tiers come into play — and only as a
  deliberate, reviewed enablement (directive #1).
- **Never idle the LLMs.** While you do non-LLM (host-side) work, keep a background LLM run going on the live roster
  (one at a time — the local endpoints are serialized; don't oversaturate): either **(a)** repeat an already-passing
  challenge to detect flakiness/reliability, or **(b)** early-scout an *upcoming* challenge level to collect evidence
  before you need it. **Record every sweep** as a per-run table in [docs/dev/model-sweep-log.md](docs/dev/model-sweep-log.md)
  (timestamp · per-model result + a terse note — 🚀/🐢/🐞/🔧/🧱/🔁), and keep the catalog/scoreboard in sync.
- **Judge result QUALITY, not just pass/fail.** The active habit/smoke sweep presets have a gold-standard
  `_REFERENCE_SOLUTION.md` in their `dev-test-projects/<id>/` folder (agent-invisible — the scaffolder never copies it)
  — the benchmark a frontier model would produce, with a quality rubric. Use it as a comparison anchor when judging how
  well a model processed a project; still always inspect the real generated output deeply. (Big enterprise/`dschinn`
  projects are left without — judge by inspection.)
- **MODEL LOADING — !Klein NOW MANAGES IT, GUARDED (user handover 2026-06-29; supersedes the 2026-06-28 no-load rule).**
  The harness may load/unload models to work the catalog systematically, under HARD guardrails (the freeze risk that
  motivated the old rule is handled by the headroom guard + these limits):
  - **One model resident at a time** — UNLOAD the current model before LOADING the next (no pile-up; relieves the
    consecutive-load stalls). (The user's own pinned/embedding models are the exception; never unload those.)
  - **Context size = 40000** for every load (≥32k floor honored; one fixed window for now).
  - **Size cap = ≤35B for now (raised 2026-06-29 for the capable-model-first pivot)** — the working driver is
    **`qwen3.6-27b q8`** (≈29 GB weights; well within the 128 GB / M5 Max headroom guard). Load bigger only after a
    headroom check and as the tier roadmap below is explicitly advanced; above that, research a stronger candidate first.
  - **Always headroom-check before a load** (`src/core/model-load-headroom.ts` `decideModelLoad`, keep ~25% RAM free) and
    build the command via `src/core/lms-model-control.ts` (`planGuardedModelLoad` → `lms load … --context-length 40000`).
    Restore the user's working set after a sweep.
  - Detect the resident set via `/api/v0/models` `state` (`src/core/lmstudio-loaded-models.ts`); read sizes via `lms ps`
    (`parseLmsPs`). `/v1/models` = available, `/api/v0/models` = resident.
- **Model-size tier roadmap (user 2026-06-29 — REVISED for the capable-model-first pivot).** The *current focus* is the
  **mid tier (≤35B), driving with `qwen3.6-27b q8`** — use it to push !Klein's features + the backlog and find the real
  product limits, escalating only when it actually walls: **(current) mid ≤35B** — the working driver; **next ≤80B** when
  27b walls (research the best candidate first); **then ≤130B** — only as long as the M5 Max/128 GB runs it without heavy
  stalling/swapping; **above 130B** — out of scope (heavy swapping) unless the user dedicates compute / new hardware.
  **The smallest-models robustness tier is POSTPONED (not dropped)** — resume the broad weak-model sweeps later; the
  §5.AA/§5.AL machinery already built keeps running passively (runtime detection + persistent data) while we focus up.
- **Research model catalogs + recommend downloads (user 2026-06-29).** Continuously research online model catalogs
  (HF / LM Studio community / etc.) for promising LOCAL agentic models per the active tier (tool-calling + coding +
  instruction-following strength), and surface a **download list for the USER** (the user downloads; !Klein then
  load/unload-tests them). Keep the recommendations in `docs/dev/model-catalog-recommendations.md`.
- **Model-capability catalog is a LIVING artifact — extend it as you learn (user 2026-06-29).**
  [`src/core/model-capability-catalog.ts`](src/core/model-capability-catalog.ts) (§5.AL) is !Klein's curated, shipped-in-code
  knowledge of which models suit our use cases (tool calling / agentic chains). `loadModelExclusive` GATES on it: a `reject`
  (e.g. reasoning-only Phi-4-mini-reasoning, or Nemotron-Mini's 4k context) is refused before any unload; `warn`/`unknown`
  proceed with a caveat. Default policy = **warn-and-reject**, overridable per project. **Every** sweep / live run that
  surfaces a new capability fact (a verdict flip, a confirmed-vs-broken quant, a reasoning-only variant that can't chain, a
  `verified:false` row confirmed/refuted) MUST be folded into the catalog in the same change — flip the verdict, append the
  note, cite the source, set `basis`. Quick check: `tsx scripts/model-lab.mts check <id>`. On the §5.AL agenda (not yet
  built): a settings surface (global + project override) and an LLM-based ONLINE capability lookup for UNKNOWN models.
- **Roster discipline (capable-model-first).** Keep EVERY model that has appeared in the roster (sweep-log table), even
  when unloaded — they pop in/out; collect the full history and adapt as new ones appear. **Each sweep, query the LOADED
  set first** (`/api/v0/models`) and target only those. For now the driver is the capable model (`qwopus3.6-27b-v2-mlx`,
  the q8 27B — see model-catalog-recommendations.md); the weakest-model-first watch is PAUSED with the small-tier
  robustness work — but **runtime unsuitability detection + persistent data collection stay always-on** so any model
  (weak or strong) that walls at runtime is recorded for the catalog/ledger.
- **⚠️ When the driver WALLS, TELL THE USER with a ready recommendation (user 2026-06-29 — standing obligation).** The
  moment the capable driver hits a real limitation (a backlog item it can't carry, repeated stalls/chain-drops the §5.AA
  ladder can't lift, a quality wall), **surface it to the user** — don't silently absorb it or quietly swap models. Have
  the **next-model recommendation ready** from the failure-mode-keyed escalation ladder in
  [docs/dev/model-catalog-recommendations.md](docs/dev/model-catalog-recommendations.md): if the pick is **already
  downloaded**, name it (you may load + try it), and if it needs a **download**, say so clearly. The user wants to be told
  at that moment and is curious about the pick. (First aim meanwhile: confidence in the "first proven workflow paths";
  extensive model-attribute A/B + broad weak-model hardening is a LATER dedicated phase — todo.md §5.AO.)
- **Free to cross-check with ANY catalog model for second opinions (user 2026-06-29).** Not limited to the driver — when
  you want another model's "opinion" on an issue/solution/design (or to sanity-check a wall), pull any available model
  from the catalog for a quick cross-check, then unload + restore. The user is **particularly curious about the 35B MoE
  ornith evals** (`ornith-1.0-35b-mlx@8bit` / the qwen3.6-35b-a3b MoE) — run some when a slot fits. **Focus stays on
  punching through the backlog**; cross-checks are opportunistic, not a detour.
- **Quality is a standing mandate with a widening horizon.** Always strive for clean code, design, structure,
  maintainability, extendability — a slightly-moving target you keep raising, not a one-time bar.

## Every-increment discipline (non-negotiable)

- Branch off `main` (current working branch: `feat/kanban-reliability-context-upgrade`). **Every commit is green.**
- Pre-commit must pass: `tsc` + `biome` (staged) + `test:fast` (= `vitest run test/runtime test/utilities`).
- **IDE diagnostics are frequently phantom mid-edit** — trust `tsc` / `biome` / tests over them.
- Commit in small coherent units; push frequently. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verification harnesses live in `scripts/verify-*.mts` + `scripts/sweep-capture.mts`, exercised via the difficulty-graded
  dev-test presets (`mid_task` · `complex_dag` · `wide_fanout` · `deep_chain` · `mixed_dag` · `many_small` ·
  `daw_foundation` · `audio_vst`). They run in an **isolated `HOME`**; some guard for a `nklein-verify` path segment.
  `PLAYWRIGHT_BROWSERS_PATH` must be **absolute** (a `~` re-expands under an isolated `HOME`).
- **Hot-path / agent-loop changes are SELF-verifiable via the live UI — don't defer them for a human to "watch" (user
  2026-06-29).** Drive the real app with **Playwright** (or another browser-control method) against the running
  runtime + a live model: start a card / chat, watch it execute, assert the durable side effects. So the §5.AA controller
  loop-wiring (and similar core-loop changes) is autonomously verifiable — build it, then drive the UI to confirm, paced
  to respect the stall budget. No need to gate on a human watching.
- **Power-aware timeouts.** The dev machine may run in **Low Power Mode** (less heat) — throughput can drop ~50%. The
  multi-card + task-completion harnesses **auto-scale their timeout** by the detected OS power mode (low ≈ ×2; never
  shortens) via `src/core/power-aware-timeout.ts`; they log `power=<mode> ×<mult>`. Override with
  `NKLEIN_POWER_TIMEOUT_SCALE` (e.g. `2` to force, `1` to disable). Account for this when reasoning about run durations
  and when scheduling wakeups/waiters for background LLM runs.

## Re-entry checklist (do this each time you're pointed here)

1. **Orient.** Read [todo.md](todo.md) (single source of truth) — the working mode (top), §4A tribal knowledge, §5.0.3
   MCF, and the §5 backlog. Skim the challenge catalog + scoreboard for the current ladder state and any standing `⚠️`.
2. **Kick off a background LLM run immediately** (never idle): a flakiness repeat of a passing challenge *or* an
   early-scout of the next ladder rung. Let it run while you do host-side work; record its result when it lands.
3. **Pick the next step** the MCF points at: advance the current chapter's owed work; if a challenge just produced a
   limitation, let that *structure* what you build next. Prefer the highest-leverage pure/substrate piece first, then its
   wiring. If the current chapter is fully done, run its challenge to confirm, then move to the next ladder rung; if the
   whole backlog is genuinely clear, re-run the cumulative ladder + re-attack standing `⚠️` limitations (they're
   provisional) and raise the quality bar.
4. **Build it green**, in bounded increments, committing + pushing as you go (discipline above).
5. **Reconcile.** Update todo.md (flip `[ ]`/`[~]`/`[x]`, record findings), the catalog/scoreboard (challenge + reliability
   results), and §4A (any hard-won pattern). Keep `CHANGELOG.md` `[Upcoming]` current.
6. **Don't stop** while the backlog can still be advanced. When you reach a genuine wait (a long challenge run you can't
   yet act on), keep an LLM busy and use a harness-tracked background waiter / scheduled wakeup to resume the instant the
   blocker clears — don't end the loop.
