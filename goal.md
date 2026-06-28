# goal.md — standing goal & working mode (re-entry point)

> **Point me at this file to resume autonomous work.** It is intentionally *generic + process-oriented*: it tells you
> how to find and advance the next thing, so it stays valid even after the current chapter (or the whole current backlog)
> is done. It owns no task list of its own — **[todo.md](todo.md) is the single source of truth**; this file is the
> operating contract for working it.

## The standing goal

Drive **!Klein / nKlein** (the local-only, Docker-isolated, multi-LLM kanban swarm) forward **autonomously and
continuously** — clearing the backlog while raising the ceiling of what the swarm can reliably do, **especially from the
smallest / most-limited local models**, while pushing the biggest/best models to their absolute maximum. Work in clean,
bounded, always-green increments. **Don't stop while anything on the backlog can still be advanced** (decide a sensible
next step even for things that will only be *adapted later with low effort*).

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
  before you need it. Record results as a reliability column in the catalog / scoreboard.
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
