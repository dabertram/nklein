# further-todo.md — parked vision & framework (moved from todo.md §5, 2026-07-04)

These are the aspirational / navigation-aid sections extracted from `todo.md` §5 so the backlog
there stays focused on concrete, actionable work. They remain the standing lens/framework — moved,
not dropped. `todo.md` links back here.

---

### 5.-1 — ★ PRODUCT VISION (user 2026-07-02 — the lens EVERY §5 item is judged against; do not re-litigate)
> **The thesis: SMALL models on LIMITED hardware produce SELLABLE software quality — because !Klein's STRUCTURE, not model size, carries the quality.** Decomposition, orthogonal N-eyes review, family-diverse deliberation, evidence-gated delivery: the swarm's process compensates for what each small model lacks. Every feature must serve one of these five pillars:
>
> 1. **QUALITY floor = "sellable software."** Architecture, code, feature fulfillment, and SPEC/REQUIREMENTS understanding — not just "tests pass." The review lenses (§5.AW) must include architecture-fit and requirements-fit, and the delivery gate (§5.0.4 P0.2) must verify the card did what was ASKED, not just that it committed something. Small-model weakness is compensated by structure: tight decomposition (small, well-specified cards), hard evidence gates, diverse eyes.
> 2. **DECOMPOSITION is the #1 quality lever.** A small model can implement a small, crisply-specified card superbly; it cannot rescue a vague or oversized one. So §5.AV (valid-by-construction + quality) is not just correctness — it is THE mechanism that translates "big ambition" into "small-model-implementable units" with acceptance criteria a 4B can hit. Invest accordingly (user: "a lot of effort").
> 3. **The MAIN CHAT drives the swarm.** One conversation is the steering wheel: state a goal → !Klein plans (board = the long-term brain), executes, and reports back. The user never NEEDS the board/settings to succeed (they add depth, §5.AT/§5.AU/§5.AX); chat alone must suffice — including course-corrections mid-run ("actually, make it dark-themed") routed to the right cards/streams (§5.AU addressing).
> 4. **"A FIVE-YEAR-OLD can generate great software."** Radical simplicity of the driving experience: plain-language interaction, no jargon at the surface, sane defaults for everything, progressive disclosure for experts (§5.AX density toggle). All LIVE information reachable from chat + UI **without overloading** — layered altitude (goal → streams → cards → threads), digest-not-spam (§5.AT tiers), the fleet visible but calm (§5.AX fleet strip).
> 5. **!Klein asks the RIGHT questions — and only those.** Clarify what genuinely changes the outcome; NEVER bounce trivia. Every prospective question passes a value gate: (a) does the answer change what gets built? (b) can a sensible default be assumed instead (assume it, RECORD it, surface it as a decision the user can revisit — extends `deriveOpenQuestionDefaults`)? (c) can it be batched with others instead of interrupting? High-stakes ambiguity → ask early and precisely (cheapest moment is before decompose); low-stakes → default + document. The measure: the user is never annoyed by a question, and never surprised by an un-asked one that mattered.
>
> **Fitness test for any new work:** does it (a) raise output quality on SMALL models, (b) sharpen decomposition, (c) strengthen chat-as-driver, (d) simplify the experience, or (e) improve the question policy? If none — deprioritize. Converges: §5.AV · §5.AW · §5.AB · §5.AT/§5.AU · §5.AX · §5.S (clarify loop) · §5.0.4.

> Everything shipped/finished now lives in **[done.md](done.md)** (the `## 6. SHIPPED` archive + the completed `§5`
> sections), so an agent knows what exists and doesn't rebuild it. The items below are what's **left**. Each is
> independently landable.
>
> **★ DONE → `done.md`, in the SAME commit that ships the code (2026-06-27, user — STANDING, do NOT re-litigate).**
> `todo.md` holds only **not-yet-finished** work; **finished work moves to [done.md](done.md)**. When a top-level item
> or a whole section becomes fully `[x]` (delivered + verified), **move that whole subtree — keeping its `§x.y` id and
> nesting — into `done.md` in the SAME change that delivers the code** (the same commit that flips it green also moves
> it, next to the `CHANGELOG.md` `## [Upcoming]` bullet). Anti-chaos rules so this stays smooth:
> - **Migration unit = a *top-level* `[x]` item, a fully-`[x]` section, OR a completed cohesive *sub-tree*** (e.g. a finished
>   per-file decomposition) **even under a still-`[~]` umbrella** (user, 2026-06-27 — *move finished sub-trees early* to keep
>   `todo.md` lean instead of letting `[x]` detail pile up under a long-open umbrella). Move the complete subtree; never half of one.
> - **A `[~]` umbrella stays in `todo.md`** (it's still open), but **its fully-done cohesive sub-trees migrate to `done.md` as
>   they complete** — leave a one-line stub in place; keep only the `[x]` context the open siblings genuinely still lean on.
>   `[-]` deferred/superseded items also stay here (deferred ≠ done).
> - **Preserve `§`-ids on the move** so cross-file references keep resolving (a completed `§5.x`/`§6.x` keeps its id in
>   `done.md`). Leave a **one-line stub** in `todo.md` at the moved section's place (`### 5.x — … ✅ COMPLETE → moved to
>   done.md`) so the numbering still reads continuously and "where did it go?" is answered in place.
> - **`done.md` is an append-only archive** — group by the same ids; don't rewrite a migrated item except to fix a cross-ref.
> - **The ready/blocked greps below count `todo.md` only**; `done.md` is not counted. (So moving done work out keeps the
>   "ready work left" count honest — that's the point.)
>
> **★ `todo.md` IS SELF-CONTAINED — integrate details INLINE, never cross-reference for them (2026-06-27, user —
> STANDING, do NOT re-litigate).** `todo.md` is **THE ONE guiding document for *future* work**; `done.md` is the archive
> of what's *already done* (and `CHANGELOG.md` = user-facing release notes). **Every actionable detail an item needs in
> order to be worked MUST live in `todo.md` itself.** Do **NOT** defer the *what / how* of an item to an external
> `docs/**` memo (or any other file) via a "see doc §X for the detail" cross-reference — **cross-referencing for
> details creates circular dependencies and loses detail when those docs drift or are forgotten.** A `docs/**` doc
> MAY exist as deep background / derivations / sources, and you may cite it purely as **provenance** (e.g.
> "(background + sources: …)") — but a reader must be able to **execute the item from `todo.md` alone, without opening
> it**. When you touch an existing item that defers detail to a doc, **integrate that detail inline** as part of that
> work. (Citing `done.md`/§-ids for *already-shipped context* is fine — that's the done-archive split, not detail-deferral.)
>
> **Tracking convention (2026-06-23): use nested checkbox lists, up to ~6 levels deep, so progress is visible at a
> glance** — a multi-commit effort becomes a tree of `[x]`/`[~]`/`[ ]` sub-items, NOT prose under one checkbox. As
> work lands, **flip the nested boxes** (and tag each with its short commit hash) rather than appending DONE-notes;
> the verbose per-commit detail belongs in CHANGELOG `## [Upcoming]` + git, not here. §5.A is the worked example.
> Once a whole top-level item's tree is `[x]`, it graduates from "flip in place" to "move to `done.md`" (the rule above).
>
> **Cross-model verification convention (2026-06-26, user — standing, do NOT re-litigate): every task that involves
> real LLM interactivity must be verified on EVERY loaded local model, not just the one it was first proven on.** This
> is a **retro-verification** obligation for already-`[x]` done tasks (the user asked to run these "at the next best
> opportunity") AND part of the **done-bar** for open LLM-interactive tasks. The model roster, the deepseek
> crash-resilience caveat (a model that vanishes mid-run is recorded DROPPED and the sweep continues with the rest),
> the methodology, and the enumerated per-flow sweep checkboxes all live in **[§5.Z](#5z)** — the single source of
> truth. Rather than editing every task line, a task's single-model live proof (e.g. "verified on qwen3-8b") keeps its
> text and its cross-model obligation is tracked as a §5.Z checkbox + a row in
> [cross-model-verification.md](docs/dev/cross-model-verification.md).
>
> **★ DIRECTION CHANGE — CAPABLE-MODEL-FIRST: punch the backlog with a strong model (2026-06-29, user — STANDING,
> supersedes the "smallest-models-first robustness" emphasis where they conflict).** We've learned a lot from weak
> models and *substantially improved the model interface* (§5.AN leverage map · §5.AA robustness ladder · §5.AL gate).
> So **shift the primary effort to driving !Klein's features + this backlog with a more capable model**, spending less
> time hardening against potentially-unsuitable weak ones. Operating rules:
> - **Driver = `qwen3.6-27b q8`** (load/unload-managed, one-resident, headroom-checked; size cap raised to ≤35B — see
>   goal.md). Work it **until it walls** on a real backlog item; that wall is the signal to **research the best
>   bigger/stronger local candidate online** (§5.AL + `docs/dev/model-catalog-recommendations.md`) and escalate the tier.
> - **Broad small/less-capable-model sweeps are POSTPONED, not abandoned** — the §5.O/§5.Z/§5.AA weak-model robustness
>   work resumes later; nothing built is removed. The cross-model-verification obligation above is **relaxed to the
>   active driver model for now** (re-broaden when the small-tier sweeps resume).
> - **Runtime unsuitability detection + persistent data stays ALWAYS-ON (the ready2use safety net) — see [§5.AL](#5al)**:
>   even while we focus on a strong model, !Klein keeps detecting an unsuitable model *at runtime* (not just the
>   pre-flight gate) and persisting that evidence so the catalog/ledger keep learning passively.
> - **Net effect on "what next":** when picking the next step, prefer **!Klein feature/backlog depth** that the stronger
>   model now unlocks over weak-model hardening. The MCF still drives order; the ladder just runs against the capable driver.
> - **Immediate aim = confidence in the "first proven workflow paths" (user 2026-06-29).** Keep punching through !Klein's
>   basic core until the core workflow paths are reliably green on the capable driver. Extensive model-attribute A/B
>   testing + broad weak-model hardening are a LATER dedicated phase — see **[§5.AO](#5ao)** (parked with its un-park trigger).
> - **⚠️ STANDING OBLIGATION — when the driver WALLS, TELL THE USER with a ready recommendation (user 2026-06-29, explicit).**
>   The moment the capable driver hits a real limitation (a backlog item it can't carry, repeated stalls/chain-drops the
>   §5.AA ladder can't lift, a quality wall), **surface it to the user** — don't silently absorb it. Have the **next-model
>   recommendation ready** from [`docs/dev/model-catalog-recommendations.md`](docs/dev/model-catalog-recommendations.md)
>   (the failure-mode-keyed escalation ladder): if the pick is **already downloaded**, name it (and you may just load + try
>   it), and if it needs a **download**, say so clearly. The user wants to be told at that moment and is curious about the pick.

---

### 5.0.2 — Milestone ladder + substrate-first sequencing *(2026-06-26, from an external spec audit — navigation aid, do NOT re-litigate)*
> **→ Operationalized by [§5.0.3](#503--milestone-challenge-framework-mcf--the-engine-that-drives-klein-forward) (the Milestone-Challenge Framework, 2026-06-28).** This section is the *dependency rationale* (why the arcs sit on §5.AF);
> §5.0.3 is the *engine* (the dense challenge ladder C0–C8+CAP that turns these milestones into runnable, cumulative,
> difficulty-rising gates whose failures structure each chapter). The M0–M4 below are the macro-arc; the C-rungs in §5.0.3
> are how we actually advance + regress-stabilize them.
> An external audit of this file (459 §5 items) made a correct structural point: the new ambition arcs (§5.AA adaptive
> robustness, §5.AB role→model selection, §5.AC online+temporal, §5.AD context, §5.AE dynamic skills) are individually
> strong but **all depend on the same missing substrate** — a per-attempt evidence stream — and the spec lacked a
> machine-readable milestone/dependency structure, making task-selection expensive. The disciplined response (NOT more
> feature sections): one substrate section (**[§5.AF](#5af)**), this milestone callout, an operator-UX section
> (**[§5.AG](#5ag)**), and a **tiered** cross-model done-bar (§5.Z). Full reasoning + the system component map + the
> Attempt-Ledger schema + the tool-capability-manifest facets live in
> **§5.AF**.
>
> **Milestone ladder (the progress backbone):**
> - **M0 — single-card reliable** — one card → implement → `awaiting_review` → correct result branch, across the roster.
>   **DONE** (§5.Z verify-task-completion 8/9).
> - **M1 — decompose → multi-card → merge, unattended** — a goal → DAG → cascade → all cards → review → merge, surviving
>   restarts. Mechanism PROVEN (§5.V); the unattended/restart-survivable run needs the **§5.AF durable scheduler**.
> - **M2 — all-model adaptive** — the §5.AA retry ladder + §5.AB selection driving every assignment off the **§5.AF
>   ledger**; weak models lifted, no circles. Needs the ledger + profile persistence (the pure cores exist, unfed).
> - **M3 — online freshness** — §5.AC temporal (DONE) + online retrieval + freshness cache in the research roles.
> - **M4 — self-improving (quarantined)** — !Klein proposes patches to itself, gated by protected-tests + replay-eval +
>   security review before landing (the §5.AF self-improvement quarantine).
>
> **Substrate-first rule:** M2/M3/M4 all sit on §5.AF. Build the **Agent Attempt Ledger** first → make
> `ModelBehaviorProfile` (§5.AA) / MCSR (§6.4) / the §5.Z matrix / `ModelFitness` (§5.AB) **projections** of it → then the
> ambition arcs have real data instead of being parallel dreams. Don't widen the ambition fronts before the substrate is real.
>
> **Small-LLM optimization research addendum (2026-06-27):** a 12-agent online research pass (concurrency-capped at 6;
> requested ceiling was "up to 50") is folded into §5.AA–§5.AF (inline). It
> validates the substrate-first order and sharpens the main correction: the ledger should be a **workflow event log +
> attempt evidence stream** (leases, admission/resource events, idempotency/replay boundaries, tool results, and model
> attempts), because small models need the harness to own long-horizon state. Follow-on backlog ideas should be folded
> into existing sections, not added as new ambition fronts: deterministic repair kernels (§5.B/§5.AA), BFCL-style tool
> probes + repeat-run reliability (§5.V/§5.Z), `ProceduralSkillBank` as validated/quarantined skill memory (§5.AE),
> `RetrievedEvidence` + citation verification (§5.AC), provenance/taint + egress/MCP policy (§5.L/security), and
> confidence/resource-aware routing (§5.AB).

### 5.0.3 — Milestone-Challenge Framework (MCF) — the engine that drives !Klein forward *(2026-06-28, user — STANDING, do NOT re-litigate; supersedes ad-hoc "what next" picking)*
> **The mandate (user, 2026-06-28):** drive !Klein with **dense milestones**, each guarded by a **challenge** of rising
> complexity/difficulty that !Klein must pass before the next chapter. The challenges are meant to **pass** — but their
> real job is to **uncover limitations** that then **structure the next chapter**, instead of us brute-forcing a challenge
> with random code-fiddling. Challenges are **cumulative**: every milestone re-runs ALL prior challenges (continuous
> stabilization of won capabilities) while adding new difficulty. The user is happy to spend large LLM runtime here — it
> is **mandatory** given how much dynamic self-adjustment !Klein is gaining. And throughout, hold the bar on clean code,
> design, structure, maintainability, extendability — the vision is a *moving target with a widening horizon*, so the
> structure must stay ready for the next milestone, not just the current one.
>
> **The MCF loop (run it for every milestone — this IS the working order; §5.0.1 step "pick the highest-value item" now
> means "advance the current chapter toward its milestone challenge"):**
> 1. **Define the challenge** for milestone `M_n` — a concrete, **runnable, machine-checkable** end-to-end
>    project-processing task, strictly harder than `M_{n-1}` along one or more **difficulty axes** (below). It gets an id,
>    a difficulty profile, an acceptance gate, and a cross-model expectation tier (§5.Z).
> 2. **Run the cumulative suite** `C_1…C_n` (oldest first = regression/stabilization, then the new one), on the live
>    substrate (dev-test presets + `scripts/verify-*.mts` + the §5.Z roster). The suite + scores live in
>    [docs/dev/cross-model-verification.md](docs/dev/cross-model-verification.md) (the regression scoreboard) and
>    [docs/dev/milestone-challenges.md](docs/dev/milestone-challenges.md) (the challenge catalog — id · difficulty profile ·
>    acceptance · expectation tier · last result).
> 3. **On a failure, DO NOT fiddle to force it through.** Root-cause it into a **structured limitation** (the §5.Z/§5.V
>    discipline: a real diagnosis, not a guess), then **file it into the upcoming chapter** and **re-arrange the chapter**
>    so the most-blocking limitations come first. The challenge's purpose is to **decide what to build next** — capturing a
>    limitation and routing it cleanly is the *perfect* outcome, not a detour.
> 4. **Pass `M_n`** when the challenge's core acceptance holds at its expectation tier. A milestone **MAY pass with known,
>    non-blocking limitations recorded** for later chapters — we do **not** get stuck perfecting one milestone. Because the
>    challenge is now permanent, any unpaid limitation re-surfaces until it clears (so "pass + defer" never silently rots).
> 5. **Lock the challenge into the permanent regression suite.** Every later milestone re-runs it. **A regression (a
>    previously-passing challenge that breaks) is a STOP-THE-LINE event** — fix it before adding new difficulty.
> 6. **The next chapter** = work toward `M_{n+1}`, its content = (a) the limitations the last challenge surfaced (highest
>    priority) **interleaved with** (b) the relevant §5 backlog arcs (below). Then go to step 1.
>
> **NEVER IDLE THE LOCAL LLMs (2026-06-28, user — standing).** The local endpoint serializes requests, so while the agent
> does **non-LLM work** (coding, reasoning, docs, refactors) the GPUs would otherwise sit idle. Keep them busy with
> **background** harness runs (`run_in_background` / a `Monitor` watch) that produce durable data:
> 1. **Flakiness / reliability** — re-run **already-passing** challenges across the roster. A single pass is not proof
>    (reliability is itself a §5.AB fitness signal); repeat-runs catch stochastic flakiness and feed per-model variance.
> 2. **Early scouting** — run **upcoming** challenge levels ahead of their chapter to collect findings early, so the next
>    chapter is shaped by real data before it starts (the MCF's "limitations decide what's next", pre-fetched).
> Record results in the scoreboard ([cross-model-verification.md](docs/dev/cross-model-verification.md)) +
> [milestone-challenges.md](docs/dev/milestone-challenges.md) (a `repeats: N/M` reliability column / scout rows). Keep it
> non-contending (don't fire foreground LLM work that races the background sweep) and clean (isolated HOME, teardown,
> restore the user's model selection). This is free throughput — the user is happy to spend it; use it continuously.
>
> **Difficulty axes (so each challenge is meaningfully harder, not just "more of the same"):** DAG size + dependency depth ·
> cross-file / cross-module consistency · goal ambiguity (needs clarification/inference, §5.S) · horizon length (turns /
> wall-time / context-compaction pressure, §5.AD) · parallelism + shared-resource contention (§5.W/§6.5) · **model weakness**
> (weaker/smaller models must still pass via the §5.AA ladder + §5.AB selection) · output-format adversity (§5.O) ·
> tool-composition breadth (§5.M capstone) · online freshness (§5.AC) · failure-injection / resilience (restart mid-run,
> sandbox loss, transient aborts — §5.AA/§5.AF) · self-modification (M4, quarantined).
>
> **Invariants a challenge may NEVER trade away to pass:** strict Docker isolation (#2), local-only (#1), ≥32k floor (#3),
> protected tests (#5), clean teardown (zero leaked containers/worktrees), and **clean structure** — a challenge "passed"
> via a hack that degrades maintainability is **NOT passed**: the cleanup is mandatory chapter work (the clean-structure
> clause below).
>
> **Clean-structure clause (the widening-horizon rule):** each chapter MUST leave the codebase ready for the *next*
> milestone — refactor-as-you-go (the §5.U/§5.X decomposition discipline), small single-responsibility modules, the
> biome-enforced SDK boundary (#4) intact, extend a seam rather than bolt on. Capability added while structure degrades is
> debt the next challenge will expose; pay it in-chapter. New observations/ideas from watching !Klein run are filed as §5
> items tagged to the chapter/challenge that should absorb them.
>
> **Model-capability ladder & ceilings (2026-06-28, user — a model hitting a difficulty wall is VALUABLE data, not a
> failure to hide):** as challenge difficulty rises, some models will stop passing past a complexity/difficulty level.
> That is **expected and perfectly valuable** — it is material for !Klein's design, the §5.AB fitness store, and
> **user-facing advice** (which model suits which work). Handle it with discipline:
> - **Don't judge prematurely:** before recording a ceiling, give the model repeat-runs (reliability is itself a signal,
>   §5.AB) AND the full §5.AA ladder (tool-set reduction, prompt-variation, constrained decoding, reason-then-act,
>   endpoint iteration). A capability-floor verdict is final only AFTER the ladder is exhausted.
> - **Recognize + record it properly:** a confirmed ceiling is a `⚠️` cell in the §5.Z matrix and a per-(model × role ×
>   difficulty × context) entry in the **§5.AB fitness store** — the durable record that drives selection AND the
>   user-advice projection. The "failing-LLM list" is the projection of below-bar cells, never a hand-list (§5.AB).
> - **Ceilings are PROVISIONAL — keep solving them, never leave a limitation standing (2026-06-28, user).** A recorded
>   `⚠️` is a *standing invitation to solve it*, not a closed verdict. Every chapter, **revisit earlier limitations** and
>   reason about what could now lift them — a new §5.AA rung (reduced tools / constrained decoding / reason-then-act /
>   endpoint iteration / prompt variation), a deterministic repair kernel (§5.O), a context strategy (§5.AD), a skill
>   bundle (§5.AE), or a harness fix. **Re-attack them during idle LLM time** (the "never idle" rule above — re-run earlier
>   failures against the *latest* ladder, since the cumulative challenge suite re-runs them anyway). The ambition is
>   **outstanding results even from the smallest, most-limited models** — the harness does the heavy lifting so a weak
>   model is carried over the bar (the §5.AA thesis) — **while simultaneously driving the biggest/best models to their
>   absolute maximum** (never under-utilize a strong model: give it the hardest difficulty tiers, the broadest tool
>   composition, the deepest reasoning loops). A ceiling clears the moment some rung lifts it; flip the `⚠️` → `✅`/`◑` then.
> - **Grow the roster to meet the ladder (Phase A — local, now):** when a challenge's difficulty exceeds what the current
>   loaded models can reach, **introduce bigger/better local models** rather than declaring the challenge impossible. The
>   test machine (128 GB RAM + a powerful M5 Max) can run **up to ~120B at lower quantization** — push toward that ceiling
>   as challenges demand. On the way we learn the small-model limitations + the LLM-landscape diversity — itself valuable
>   user guidance. Local-only (#1) holds throughout Phase A.
> - **Phase B — frontier cloud escalation (FUTURE; gated behind #1 + "local maxed"):** only AFTER we've maxed what this
>   machine can reach, integrate frontier **cloud** models for escalation / planning / other "flows" (a deliberate,
>   reviewed enablement per #1 — see the #1 note; never a silently-added feature). Record now as the roadmap target, do
>   not build before Phase A is genuinely exhausted.
> - **Phase C — expert-guided flows (FUTURE):** a *small amount* of expert guidance at stuck points (human, or a frontier
>   model such as Claude advising the run) can make !Klein's projects succeed **beyond what even the latest frontier cloud
>   models reach unaided**. Design the escalation/guidance seam (ties §5.AG "get through the wall" + the §5.AA Layer-2
>   escalation) so a guided flow drops in cleanly. This is the long-horizon payoff of the whole MCF.
>
> **Dense challenge ladder (built on the EXISTING difficulty-graded substrate — dev-test presets + verify harnesses +
> the §5.Z roster + the dschinn capstone; reconciles the M0–M4 macro-arc in §5.0.2):**
> - **C0 · single-card** (`verify-task-completion`, preset `mid_task`) → `awaiting_review` + correct result branch. **= M0, met** (§5.Z 8/9).
> - **C1 · decompose-only** (`verify-decompose-isolation`) → goal → valid DAG, no host leak. **Met** (§5.Z 9/9).
> - **C2 · promote + single-card delivery under isolation** (`verify-autopromote-recovery` + strict/restart-resume isolation). **Met** across the loaded roster (§5.Z).
> - **C3 · decompose → multi-card → review → MERGE, unattended + restart-survivable** (preset `complex_dag`/`mixed_dag`; the §5.V pipeline). **= M1.** Mechanism proven; the unattended/restart-survivable gate needs the **§5.AF durable scheduler** → that is the current chapter's spine.
> - **C4 · all-model adaptive** — C3 but every assignment routed via §5.AB off the §5.AF ledger, weak models lifted by the §5.AA ladder, no loops/circles (axis: model weakness + resilience). **= M2.**
> - **C5 · wide parallel fan-out under contention** (`wide_fanout`/`many_small`) — many concurrent cards on serialized local endpoints without deadlock/starvation, caps honored (§5.W/§6.5). (axis: parallelism)
> - **C6 · deep cross-module build** (`deep_chain`/`daw_foundation`/`audio_vst`) — long dependency chains + cross-file consistency over a long horizon (axes: depth + cross-file + horizon/compaction).
> - **C7 · ambiguity + online freshness** — under-specified goal needing clarification (§5.S) + a task requiring current/online knowledge (§5.AC). **≈ M3.**
> - **C8 · self-improvement (quarantined)** — !Klein lands a vetted patch to itself through protected-tests + replay-eval + security review (§5.AF quarantine). **= M4.**
> - **CAP · dschinn "master challenge"** (todo §5.G) — the capstone end-to-end real project; run only once the ladder below it is green (reserved for last per the dschinn note).
>
> **Backlog reconciliation (how §5 "perfectly fits"):** the big arcs are the **chapter material**, ordered by the
> substrate-first rule (§5.0.2): **§5.AF ledger/scheduler** (unblocks C3/C4) → **§5.AA robustness + §5.AB selection** (C4) →
> **§5.W/§6.5 concurrency** (C5) → **§5.AD context + §5.O output** (C6) → **§5.S clarify + §5.AC online** (C7) → **§5.AF
> self-improvement quarantine** (C8). Each chapter draws its items from these arcs PLUS the prior challenge's findings;
> a found limitation is filed under its arc with a `(challenge: C_n)` origin tag so the scoreboard and the backlog stay
> in sync. **NEXT ACTION when unsure what to do:** run the cumulative challenge suite, take the first failing/weakest
> challenge, and work its root-caused limitations as the current chapter (substrate-first when they collide). The
> first build target the ladder points at is the **§5.AF durable scheduler** (the C3 unattended/restart gate).
>
> **NEAR-TERM USER STEER (2026-06-29):** in parallel with the §5.AF scheduler spine, stand up the **≥3-agent multi-model
> swarm** — a suitable model per role (strong reasoning → plan/review; strong+fast coder → worker; per-task fit as
> skills attach), with **3–5+ models resident + used concurrently** (loading guarded + user-greenlit). This pulls **C4
> (all-model adaptive)** forward to interleave with C3. The user **ACCEPTS the lower per-model throughput** — raise the
> timeouts; the bar is a *slow human developer*, quality over speed, unattended-autonomous is the point. See the ★ item
> at the top of [§5.AB](#5ab--automatic-rolemodel-selection--a-model-evaluation-harness-2026-06-26-user--active).
>
> **NEAR-TERM USER STEER #2 (2026-06-29) — per-MACHINE concurrency pools:** LM Studio links models from OTHER machines
> into the local server, so the real parallelism lever is **multiple machines/endpoints**. Model each machine as a POOL
> with its own concurrency cap and OFFLOAD small/easy cards to the secondary machines (m4mini-24gb, legion-5pro
> 4070m-8gb) so the m5max-128gb stays free for hard/large cards — a big throughput win. Implement early; ties §6.5
> (endpoint scheduler), §5.AF (durable lease/admission), §5.AB (pool-aware routing). See the ★ per-machine-pools item in §5.AB.
