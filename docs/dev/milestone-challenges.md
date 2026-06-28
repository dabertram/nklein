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
> scoreboard); this file is the catalog (id · difficulty profile · acceptance · expectation tier · status).
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
| **C0** | M0 single-card | baseline | `verify-task-completion` · `mid_task` | reaches `awaiting_review` + correct `nklein/tasks/<id>` result branch | roster | ✅ met (8/9; qwen3.5-9b ⚠️ slow-finalize → §5.AA finalization watchdog wired) |
| **C1** | decompose-only | + DAG synthesis, isolation | `verify-decompose-isolation` | goal → valid dependency DAG, **no host-path leak** to the agent | roster | ✅ met (9/9) |
| **C2** | promote + isolated delivery | + lane promotion, restart isolation | `verify-autopromote-recovery` + `verify-strict-isolation` + `verify-restart-resume-isolation` | card → In Progress; sandbox isolation + restart-resume hold, clean teardown | roster | ✅ met across loaded roster |
| **C3** | **M1** unattended multi-card → merge | + multi-card cascade, **restart-survivable**, auto-merge | `complex_dag`/`mixed_dag` + the §5.V pipeline + `verify-multi-card-pipeline` | goal → DAG → all cards run (parallel where safe) → review → **merge**, surviving a runtime restart | roster | ⏳ mechanism proven (§5.V); the unattended/restart-survivable gate needs the **§5.AF durable scheduler** → **current chapter** |
| **C4** | **M2** all-model adaptive | + model-weakness, no-circles | C3 routed via §5.AB off the §5.AF ledger | every assignment selected by fitness×difficulty; weak models lifted by the §5.AA retry ladder; no loops; parks surface cleanly | capable-only→roster | ⏳ pure cores exist (retry-policy, model-fitness, ledger projections); **wiring at the model-call seam owed** (§5.AA/§5.AB) |
| **C5** | wide parallel fan-out | + parallelism + contention | `wide_fanout`/`many_small` under concurrency caps | many concurrent cards on serialized local endpoints: no deadlock/starvation, per-provider/per-model caps honored, board stays responsive | roster | ⏳ caps + scheduler exist (§5.W/§6.5); needs a contention challenge run |
| **C6** | deep cross-module build | + depth + cross-file + long horizon | `deep_chain`/`daw_foundation`/`audio_vst` | long dependency chains + cross-file consistency held over a long horizon (context compaction stays coherent, §5.AD) | capable-only | ⏳ output-robustness clean (0 narration leaks, §5.O); long-horizon coherence unverified |
| **C7** | **M3** ambiguity + online freshness | + clarification + online | under-specified goal (§5.S) + a freshness-requiring task (§5.AC) | agent clarifies the ambiguity (not a wrong guess) AND grounds in current/online knowledge | capable-only | ⏳ temporal lighthouse ✅ (§5.AC 9/9); online retrieval + auto-clarify loop owed |
| **C8** | **M4** self-improvement (quarantined) | + self-modification | §5.AF self-improvement quarantine | !Klein lands a vetted patch to itself only via protected-tests + replay-eval + security review | capable-only | ⏳ quarantine design only |
| **CAP** | dschinn master challenge | capstone (all axes, real project) | the dschinn project (todo §5.G) | a real end-to-end project processed start→delivery | north-star→ | ⏳ reserved for last — run only once C0–C8 are green |

## Run log (newest first)

- _(2026-06-28)_ Framework defined (todo §5.0.3). C0–C2 confirmed met across the loaded roster this session (see the
  scoreboard); C3 is the current chapter, blocked on the §5.AF durable scheduler (the unattended/restart-survivable gate).
  Findings this session that feed upcoming chapters: §5.AA `aborted`-transient + finalization-watchdog (C0/C4 stabilization);
  the §5.AB live-selection wiring caution "misroutes every task if wrong" (C4 — focused fresh-context pass); output-format
  hardening is solid (C6 — remaining fails are §5.AA *control* problems, not format).
