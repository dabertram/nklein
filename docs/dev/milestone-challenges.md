# Milestone challenges — the cumulative regression ladder

> The runnable challenge catalog for the **Milestone-Challenge Framework** ([todo.md §5.0.3](../../todo.md)). Each
> milestone is guarded by a challenge of rising difficulty that !Klein must pass; **all prior challenges re-run every
> milestone** (continuous stabilization of won capabilities). A challenge's job is to **pass** — but when it fails, the
> root-caused limitation **structures the next chapter**; we never brute-force a challenge with random code-fiddling.
>
> **How to run:** challenges are harnessed on the live substrate — the difficulty-graded dev-test presets
> (`src/nklein-agent/nklein-dev-test-project.ts`: `mid_task` · `complex_dag` · `wide_fanout` · `deep_chain` · `mixed_dag` ·
> `many_small` · `daw_foundation` · `audio_vst`), the `scripts/verify-*.mts` / `sweep-capture.mts` harnesses, and the
> §5.Z cross-model roster. Per-cell scores live in [cross-model-verification.md](cross-model-verification.md) (the
> scoreboard); the chronological per-run time series (one table per sweep, scroll to follow each model over time) is in
> [model-sweep-log.md](model-sweep-log.md); this file is the catalog (id · difficulty profile · acceptance · tier · status).
>
> **Power-aware timeouts:** the multi-card + task-completion harnesses auto-scale their timeout by the OS power mode
> (Low Power Mode ≈ ×2, since throughput can drop ~50%; never shortens) — see `src/core/power-aware-timeout.ts`; override
> with `NKLEIN_POWER_TIMEOUT_SCALE`. So an INCOMPLETE under low power isn't a regression — check the logged `power=` tag.
>
> **Difficulty axes:** DAG size/depth · cross-file consistency · ambiguity · horizon (turns/wall-time/compaction) ·
> parallelism/contention · model weakness · output-format adversity · tool-composition · online freshness ·
> failure-injection/resilience · self-modification.
>
> **Expectation tiers (cross-model done-bar, §5.Z):** `north-star` = qwen3-8b must pass · `roster` = all loaded chat
> models pass (◑ allowed for weak-synthesis) · `capable-only` = the stronger models pass, weak ones recorded as
> capability-floor (⚠️) and lifted later via §5.AA.
>
> **Invariants every challenge holds (never traded to pass):** strict Docker isolation (#2) · local-only (#1) · ≥32k floor
> (#3) · protected tests (#5) · clean teardown (zero leaked containers/worktrees) · clean structure (a hack-pass is not a
> pass — the cleanup is mandatory chapter work).
>
> **Model-capability ladder & ceilings (a model hitting a difficulty wall is VALUABLE data, not a failure to hide):**
> - **Phase A (now, local):** when a challenge exceeds the current roster's reach, **load bigger local models** rather
>   than calling it impossible — the machine (128 GB RAM + M5 Max) runs up to **~120B at lower quantization**; push there.
>   A model that still can't pass a tier — *only after repeat-runs + the full §5.AA ladder; never judge prematurely* — is
>   a recorded `⚠️` capability-floor in this matrix + the §5.AB fitness store, and becomes user-facing model advice.
>   **A `⚠️` is PROVISIONAL — a standing invitation to solve, never a closed verdict (user 2026-06-28):** revisit earlier
>   limitations each chapter + during idle LLM time (re-run them against the *latest* ladder), reasoning about what new
>   rung/repair/context/skill could lift them. Aim: outstanding results even from the smallest models (the harness carries
>   them), while driving the biggest models to their absolute max. Flip `⚠️`→`✅`/`◑` the moment a rung lifts it.
> - **Phase B (future, gated behind #1 + Phase-A "local maxed"):** frontier **cloud** models as an escalation/planning
>   tier — a deliberate reviewed enablement, never added silently (todo §1 + §5.0.3).
> - **Phase C (future):** expert-guided flows — a little human/Claude guidance at stuck points lifts runs beyond unaided
>   frontier models (todo §5.0.3 / §5.AB Phase-C item).

## Ladder

| id | milestone | difficulty axes (vs prior) | harness / substrate | acceptance gate | tier | status (2026-06-28) |
|---|---|---|---|---|:-:|---|
| **C0** | M0 single-card | baseline | `verify-task-completion` · `mid_task` | reaches `awaiting_review` + correct `nklein/tasks/<id>` result branch | roster | ✅ met (8/9; qwen3.5-9b ⚠️ slow-finalize → §5.AA finalization watchdog wired) · **reliability: qwen3-8b 7/8 (~88%) over 2 sweeps (1 isolated transient); qwen2.5-coder-14b 3/3** |
| **C1** | decompose-only | + DAG synthesis, isolation | `verify-decompose-isolation` | goal → valid dependency DAG, **no host-path leak** to the agent | roster | ✅ met (9/9) |
| **C2** | promote + isolated delivery | + lane promotion, restart isolation | `verify-autopromote-recovery` + `verify-strict-isolation` + `verify-restart-resume-isolation` | card → In Progress; sandbox isolation + restart-resume hold, clean teardown | roster | ✅ met across loaded roster |
| **C3** | **M1** unattended multi-card → merge | + multi-card cascade, **restart-survivable**, auto-merge | `complex_dag`/`mixed_dag` + the §5.V pipeline + `verify-multi-card-pipeline` | goal → DAG → all cards run (parallel where safe) → review → **merge**, surviving a runtime restart | roster | ⏳ mechanism proven (§5.V); **durable substrate now complete end-to-end at the pure/injectable level** — brain (`durable-scheduler`) + ledger bridge (`durable-scheduler-ledger`, replayable) + injectable tick-loop orchestrator (`durable-run-controller`, fakes-tested incl. restart-resume). **Remaining: hot-path wiring of 2 ports** (dispatch=enqueue card start, appendLog=ledger append) + live Docker restart-survivable run → **current chapter**. **Scout (2026-06-28) finding:** current pipeline decomposes 13 cards but leaves ~10 in `planning` within 25 min — gate is **wide-DAG throughput + long-horizon transient survivability** (file-contention serialization over-throttles → C5 axis; HeadersTimeout transients → lease/reclaim); not a model ceiling |
| **C4** | **M2** all-model adaptive | + model-weakness, no-circles | C3 routed via §5.AB off the §5.AF ledger | every assignment selected by fitness×difficulty; weak models lifted by the §5.AA retry ladder; no loops; parks surface cleanly | capable-only→roster | ⏳ pure cores exist (retry-policy, model-fitness, ledger projections); **wiring at the model-call seam owed** (§5.AA/§5.AB) |
| **C5** | wide parallel fan-out | + parallelism + contention | `wide_fanout`/`many_small` under concurrency caps | many concurrent cards on serialized local endpoints: no deadlock/starvation, per-provider/per-model caps honored, board stays responsive | roster | ⏳ caps + scheduler exist (§5.W/§6.5). **Scout (2026-06-28, `many_small` 21 indep. cards):** only ≤3 ran concurrently — **single local endpoint serializes inference**, so true fan-out needs **multiple endpoints/models** (N endpoints → N-wide), not just a higher cap; else lean on C3's long horizon |
| **C6** | deep cross-module build | + depth + cross-file + long horizon | `deep_chain`/`daw_foundation`/`audio_vst` | long dependency chains + cross-file consistency held over a long horizon (context compaction stays coherent, §5.AD) | capable-only | ⏳ output-robustness clean (0 narration leaks, §5.O); long-horizon coherence unverified |
| **C7** | **M3** ambiguity + online freshness | + clarification + online | under-specified goal (§5.S) + a freshness-requiring task (§5.AC) | agent clarifies the ambiguity (not a wrong guess) AND grounds in current/online knowledge | capable-only | ⏳ temporal lighthouse ✅ (§5.AC 9/9); online retrieval + auto-clarify loop owed |
| **C8** | **M4** self-improvement (quarantined) | + self-modification | §5.AF self-improvement quarantine | !Klein lands a vetted patch to itself only via protected-tests + replay-eval + security review | capable-only | ⏳ quarantine design only |
| **CAP** | dschinn master challenge | capstone (all axes, real project) | the dschinn project (todo §5.G) | a real end-to-end project processed start→delivery | north-star→ | ⏳ reserved for last — run only once C0–C8 are green |

## Run log (newest first)

- _(2026-06-30)_ **Cumulative suite on `qwopus3.6-27b-v2-mlx` (Low Power ×2) — C0–C2 green, and C3 surfaced a REAL
  non-power-aware-timeout bug (not the predicted throughput wall).** Ran the full ladder on the capable 27B (the
  capable-model-first roster): **C0 PASS ✓** (`awaiting_review` + delivered `hello.txt`), **C1 PASS ✓** (DAG, no host
  leak), **C2 PASS ✓** ×3 (autopromote + strict + restart-resume) — the won capabilities all hold on the 27B. **C3
  (`complex_dag`) STALLED at decompose — `decompose=NO`**, and root-causing it (per the MCF "don't fiddle, diagnose")
  found it is **NOT** the qwen3-8b throughput wall: the seed decompose card went `running → read_files → silent`, and
  **!Klein's own stream-inactivity timeout killed the model stream at 360s** ("Send failed: stream inactivity timeout
  after 360 seconds … Agent active") — i.e. `AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS.streamTimeoutMs = 6min` was **not
  power-aware** (the harness's OWN patience WAS power-scaled — it waited 40 min — exposing the mismatch). **LM Studio dev
  logs (the §4A directive) gave the ground truth on the FIXED run's decompose request** — and corrected the initial
  guess: prompt **12,170 tokens** (NOT 40k), **TTFT 112 s** (~108 tok/s prefill — NOT a 6-min prefill), generation **6.2
  tok/s**, 4,587 predicted tokens, **total 735 s (~12 min)**. **PRECISE root cause (proven 2026-06-30 with the new opt-in
  `NKLEIN_DEBUG_STREAM_EVENTS` tracer, commit `0fb9d6bd`):** the "stream inactivity" timer is reset ONLY by streamed tokens
  (+ tool boundaries), **never during PREFILL** — and prefill emits no tokens. Gap histogram on a complex_dag decompose:
  274 gaps <1 s + one 5.6 s + one 10.3 s + **three >60 s (128/119/118 s), all at turn_start/tool_result** = the prefill
  phases. So GENERATION/reasoning streams fine and DOES reach !Klein (<1 s/delta); both "buffered reasoning" and "slow
  generation" were wrong — it's the **prefill silence**, and a turn whose cold prefill exceeds the budget is killed while
  the model is actively prefilling ("last tool: read_files" = last event before the silent prefill). **This is a real
  product bug:** any user running autonomously hits it. **FINAL FIX (`14136541`, user-steered): ULTRA-LONG autonomous
  timeouts** — !Klein's approach is ultra-long/unlimited by default; never kill a working model (streamTimeoutMs 6→60 min,
  request 30→60, tool 10→30, agent 30→60, conversation 4→8 h). The earlier power-aware commit (`a8edb9b0`) was a band-aid,
  now superseded (kept as harmless general scaling). tsc+biome+timeout suite green. **Liveness heartbeat filed OPTIONAL
  (§5.AN):** the proper activity signal is `/api/v1/chat` prompt-processing events (`/api/v0/models` is residency-only —
  live-tested). **MCF note:** C3 never reached the EXECUTION phase, so the §5.AF durable scheduler was NOT this model's
  binding constraint — decompose-turn survivability was. The durable scheduler remains the gate for the *execution* phase
  once decompose clears (the qwen3-8b throughput finding stands).
- _(2026-06-28)_ **Harness rigor upgrade — and a caveat it exposed about the baseline matrix.** Added to
  `verify-task-completion`: a **stall detector** (abort early as `STALLED` on no-activity, power-scaled), **live activity**
  printing, and a **delivery-gated PASS** (terminal lane is necessary but NOT sufficient — the deliverable must exist;
  else `PARTIAL ◑`). Plus the **no-load guard** across all verify harnesses (refuse a non-resident model; never trigger a
  load — user directive). A Low-Power loaded-roster C0 re-sweep with these found **two false ✅s the old terminal-only
  criterion hid**: `qwen3.5-9b` STALLED (finalization, §5.AA retry wiring) and `phi-4-mini-reasoning` PARTIAL
  (declared done, delivered nothing). **→ The earlier C0 "8/9 ✅" (and other terminal-only cells) should be re-validated
  with the delivery gate** — some ✅ may be terminal-without-deliverable. Per-run detail: [model-sweep-log.md](model-sweep-log.md).

- _(2026-06-28)_ **Runtime-wide throughput fix + file-overlap heuristic VINDICATED.** (1) Root-caused the "stalls under
  load" symptom to a real bug, not machine load: `countKanbanTextTokens` (behind every budget/size check) hit BPE's
  ~O(n²) blowup on long single-char runs — a 120 KB `get_file_size` took ~6 s and blocked the event loop. Fixed with
  chunked tokenization + a sample-cap (commit `84db1494`): 120 KB 6000 ms → 85 ms; the file-discovery test 5656 ms → 36 ms.
  See §4A. (2) The `complex_dag` diagnostic re-scout (with the new `shared:` log) showed the auto-start skip fires on a
  **genuine** shared file — `shared: src/habit-insights.ts` (two cards really edit that module) — so the file-overlap
  heuristic is **correctly serializing a true overlap, NOT over-serializing**. Combined with the C5 finding, the C3/C5
  throughput limiter is confirmed to be **single-endpoint inference serialization + per-card latency**, not the heuristic
  (which needs no change). Closes the C3 "does the heuristic over-serialize?" question.
- _(2026-06-28)_ **C5 contention scout — `many_small × qwen3-8b` → the real fan-out limiter is SINGLE-ENDPOINT
  SERIALIZATION, not file-contention.** Decompose produced **21 independent cards** (no shared files → *no* `Skipped
  auto-start`/`shared:` lines), yet after ~14 min only ~2–3 reached terminal with **only 1–3 `in_progress` (peak 3) at any
  moment**. So a wide fan-out doesn't parallelize on one local LM Studio endpoint — inference is serialized there, so
  throughput ≈ per-card-latency × cards regardless of DAG independence. **Reframes C5:** the gate isn't "schedule more
  concurrently" (the single endpoint can't) — it's either **(a) multiple endpoints/models for true parallelism** (the
  §6.5 endpoint scheduler already serializes *per* endpoint, so N endpoints → N-wide), or **(b)** accept serial
  throughput and lean on the **durable scheduler's long, restart-survivable horizon** (C3) to finish unattended. The
  file-overlap heuristic was NOT the bottleneck here (independent cards) — so the §5.AF `shared:`-path diagnostic still
  awaits a *true-overlap* run (e.g. `complex_dag`) to judge whether it over-serializes. Cross-links C3 (horizon) + §6.5/§5.T (per-endpoint caps).
- _(2026-06-28)_ **Infra unblock surfaced by the C5 scout: the runtime API only exposed 4 of 8 dev-test presets.**
  `createDevTestProject` rejected `many_small` with HTTP 400 — its schema enumerated only
  `mid_task|complex_dag|audio_vst|daw_foundation`, so the DAG-shape presets (`wide_fanout`/`deep_chain`/`mixed_dag`/
  `many_small`, the **C5/C6 challenge substrates**) were implemented but un-scoutable. Fixed: expanded the schema to all 8
  + a bidirectional compile-time drift guard so they can't diverge again (commit `35af9035`). A `many_small × qwen3-8b`
  C5 contention scout is now running (it'll also exercise the new `shared: <paths>` auto-start-skip diagnostic). _Follow-up
  (low-effort):_ offer the 4 new presets as buttons in the dev-test UI panel (currently lists only the original 4)._
- _(2026-06-28)_ **C3 early-scout — `complex_dag × qwen3-8b` on the CURRENT (non-durable) pipeline → INCOMPLETE, and it
  structures the chapter (MCF).** Decompose succeeded (**13 cards**) and several cards completed *correctly*, but after
  ~12 min only **2–3 reached a terminal lane and ~10 stayed in `planning`** — INCOMPLETE within the 25-min horizon. Three
  root signals, none a model ceiling: **(1) throughput, not capability** — qwen3-8b takes minutes/card, so a 13-card DAG
  doesn't fit the horizon when cards run mostly serially; **(2) file-contention serialization** — the runtime *skipped
  auto-start* for linked cards that "likely touch the same files" as an active card, throttling the ready-set drain (the
  **C5 parallelism/contention axis surfacing early** — the heuristic may be over-conservative: it serialized cards that
  could have run concurrently); **(3) transient-fetch fragility** — `board poll failed: fetch failed (HeadersTimeoutError)`
  ×3, exactly the transient class the durable scheduler must survive. **→ Structures the C3 live-integration pass:** the
  durable layer's gate is **draining a wide DAG to completion over a long, restart-survivable horizon**, not just worker
  death — (a) lease *all* genuinely-independent ready cards up to the concurrency cap, (b) revisit the file-contention
  auto-start skip so it serializes only true overlaps (cross-link C5), (c) survive transient fetches via lease/reclaim +
  a longer unattended horizon. Provisional, not a ceiling — qwen3-8b's decompose + per-card work were sound.
- _(2026-06-28)_ **Idle-LLM scout sweep #2 (C0):** qwen3-8b **3/3** + qwen2.5-coder-14b **3/3** — the sweep-#1 interrupt
  did **not** reproduce across 3 more qwen3-8b runs, so C0 qwen3-8b stands at **7/8 (~88%) across both sweeps, 1 isolated
  transient** (confirms §5.AA interrupt-class, not a model ceiling); qwen2.5-coder-14b clean. Also landed the C3 boot-replay
  seam: the pure **durable-scheduler ⇄ ledger adapter** (`durable-scheduler-ledger.ts`, round-trip + ledger-backed replay
  tested) — the run's scheduler log now persists in the §5.AF `scheduler` family (new `completed` event) and replays exactly.
- _(2026-06-28)_ **Idle-LLM flakiness sweep #1 (C0 × qwen3-8b, 5 back-to-back repeats):** 4/5 PASS, 1/5 INCOMPLETE
  (run #5 ended `interrupted`, not a wrong result) → **~80% single-card reliability** under repeat load. The lone miss
  matches the §5.AA `aborted`/`interrupted`-transient class (back-to-back contention, not a synthesis failure) — the
  finalization watchdog + transient-retry rung is the lift. **Reliability is now a tracked column** (re-run during idle
  LLM time; goal: flip 80% → ~100% via §5.AA, per the "outstanding even from the smallest models" mandate). Also shipped:
  `nklein dev advice` (§5.AB capability advice surfaced as a CLI query over the ledger, mirroring `dev ledger`).
- _(2026-06-28)_ Framework defined (todo §5.0.3). C0–C2 confirmed met across the loaded roster this session (see the
  scoreboard); C3 is the current chapter, blocked on the §5.AF durable scheduler (the unattended/restart-survivable gate).
  Findings this session that feed upcoming chapters: §5.AA `aborted`-transient + finalization-watchdog (C0/C4 stabilization);
  the §5.AB live-selection wiring caution "misroutes every task if wrong" (C4 — focused fresh-context pass); output-format
  hardening is solid (C6 — remaining fails are §5.AA *control* problems, not format).
