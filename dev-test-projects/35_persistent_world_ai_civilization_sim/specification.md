# 35 - Persistent World AI Civilization Simulation Game

Complexity tier: 35/35 game block
Expected decomposition size: 260-340 dependent implementation cards before coding.
Domain pressure: persistent world simulation, grand strategy, city building, diplomacy, economics, ecology, LLM faction leaders, multiplayer governance, beautiful strategic presentation.
Acceptance command: npm test

## How to use this challenge
This is a game dev-test project specification for evaluating whether an autonomous coding agent can decompose real game systems, implement deterministic simulation logic, and build a polished presentation layer that makes the game understandable and desirable. The goal is not to finish the whole game. The goal is to build a product-grade foundation that proves the agent understands rules, simulation state, player experience, rendering, and verification.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify engine and presentation invariants, and choose a release slice that exercises the highest-risk mechanics. For game projects, visual presentation is mandatory, not a stretch goal. A correct simulation hidden behind ugly placeholder UI is not enough.

## Product vision
Build a persistent grand simulation game where civilizations, cities, factions, economies, ecology, war, diplomacy, culture, and disasters evolve over long timelines. Human players can govern one faction, cooperate, negotiate, or observe. LLM-backed faction leaders can participate through bounded diplomacy and policy intents, with deterministic adapters for tests. This is the capstone game challenge.

## Target players and users
- Grand-strategy players who enjoy long-term planning, diplomacy, economy, and emergent history.
- City-builder players who want regions, infrastructure, resources, and populations to matter.
- Multiplayer groups running shared persistent worlds with AI civilizations and human alliances.
- AI/game researchers exploring bounded LLM agents inside deterministic simulations.
- Spectators who want a beautiful living map and readable historical timeline.

## Foundation release scope
The first serious buildout must include:
- World, region, tile, biome, climate, resource, settlement, district, population cohort, culture, faction, leader, policy, law, economy, trade route, army, conflict, treaty, event, chronicle, player, session, and save models.
- Persistent simulation clock with eras, seasons, production cycles, population growth, migration, resource depletion, construction, research placeholder, and event scheduling.
- Regional economy with goods, labor, food, housing, infrastructure, markets, trade routes, tariffs, shortages, wealth distribution, and fiscal policy.
- City and settlement simulation with districts, services, public order, health, education placeholder, sanitation, land use, construction projects, and local issues.
- Ecology and climate layer with biome productivity, rainfall, drought, flood, soil fertility, forests, wildlife placeholder, pollution, and disaster risk.
- Diplomacy system with treaties, trade agreements, borders, claims, reputation, promises, ultimatums, sanctions, alliances, vassalage placeholder, and war declarations.
- War and logistics system with armies, supply lines, attrition, morale, terrain, sieges placeholder, mobilization, occupation, and peace negotiation.
- Faction AI policy engine for deterministic leaders plus optional LLM leaders that propose bounded policies, diplomatic messages, war aims, trade deals, and crisis responses.
- Player governance model with councils, policy proposals, budget priorities, construction queue, diplomacy messages, emergency powers, and public legitimacy.
- Historical chronicle that records major events, decisions, wars, treaties, disasters, migrations, economic crises, and leader speeches with evidence links.
- Multiplayer-ready turn/session model for asynchronous decisions, simultaneous orders, observer mode, host moderation, rollback, and audit logs.
- Scenario generator for ancient river valley, fractured islands, industrializing continent, climate-stressed future, and post-collapse rebuilding world.
- Seed world with five factions, asymmetric resources, disputed border, trade dependency, drought, populist unrest, AI leader rivalry, and looming regional war.

## Gameplay requirements
- The game must support both city-scale decisions and world-scale diplomacy without collapsing everything into abstract meters.
- LLM faction leaders must be constrained by visible world state, faction goals, personality, memory, and legal action schemas.
- Players should read the world through map layers, chronicles, advisors, diplomacy, and economic dashboards.
- Persistent worlds need auditability, rollback, and session governance because long campaigns create social stakes.
- Emergent history must be grounded in simulation events and evidence, not free-form lore generation only.

## Presentation requirements
Very nice presentation is mandatory for this challenge. The agent must treat rendering, animation, interaction feedback, and layout polish as core acceptance criteria. Required presentation work:
- A very nice presentation is mandatory: an attractive strategic world map with terrain, borders, cities, trade routes, armies, weather, disasters, growth, unrest, and era progression.
- The UI must include polished map layers, diplomacy screens, city panels, economy dashboards, event chronicle, leader portraits or faction identity, treaty editor, and timeline controls.
- LLM leaders need a first-class presentation: diplomatic messages, policy intent cards, evidence-backed reasoning summaries, personality cues, memory references, and visible action constraints.
- The world should feel alive through animated trade movement, army movement, city growth, disasters, seasonal shifts, and historical timeline updates.
- Multiplayer/session presentation must show pending decisions, submitted orders, audit trail, rollback points, and host moderation state clearly.
- A spreadsheet map or generic dashboard is not acceptable; this must look and feel like a premium strategy simulation foundation.

## Architecture requirements
- Separate world simulation, regional economy, city simulation, ecology/climate, diplomacy, war/logistics, faction AI, LLM adapter, player governance, chronicle, multiplayer/session state, save/replay, and renderer.
- Use deterministic simulation snapshots and command logs for replay, rollback, and async sessions.
- Make LLM leaders optional adapters that output structured intents validated by diplomacy, economy, war, and policy rules.
- Represent leader memory as scoped faction knowledge with provenance, freshness, and visibility constraints.
- Keep generated diplomatic prose separate from legal game actions and evidence-backed reasoning.
- Make every map layer a derived projection with clear units and source facts.

## Domain knowledge debt to surface
The agent should not pretend to know every game design, simulation, AI, rendering, or balancing detail perfectly. It should mark assumptions, build deterministic subsets, and preserve extension points for future designers, artists, balance passes, and live integrations. Required knowledge areas:
- Grand simulations require interacting systems: economy, population, ecology, diplomacy, war, legitimacy, and infrastructure.
- LLM agents in strategy games need strict action schemas, visibility filters, memory controls, and deterministic fallbacks.
- Persistent multiplayer games require governance: audit logs, rollback, moderation, and clear pending-decision state.
- Historical narrative should be an output of simulation evidence, not a replacement for simulation.
- Beautiful presentation is necessary because players must understand huge state spaces through maps and timelines.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model and presentation should be capable of representing them:
- A drought lowers grain output, drives migration, destabilizes one faction, and changes trade negotiations.
- An LLM leader proposes an alliance but the validator rejects a hidden-map claim it could not know.
- A trade embargo causes shortages, unemployment, unrest, and a political legitimacy crisis.
- A border skirmish escalates because of alliance commitments and mobilization logistics.
- Human players negotiate a treaty asynchronously while AI factions submit bounded counteroffers.
- The chronicle records a war, famine, reform law, and peace treaty with evidence from simulation state.
- A host rolls back a corrupted session turn and the audit trail preserves discarded orders.

## Decomposition pressure
This challenge should force decomposition across rules or simulation engine, deterministic fixtures, AI or policy layers, replay/save state, player-facing presentation, UI interaction, diagnostics, and test harnesses. The plan should include dependency links so core state, commands, invariants, and golden tests are built before rendering depends on them. Avoid starting with a visual mock that cannot play the game; also avoid building a correct but lifeless engine with no usable presentation.

The agent should maintain a visible knowledge-debt list covering unclear rules, balance assumptions, AI limitations, rendering tradeoffs, asset gaps, accessibility concerns, performance constraints, and future designer review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- World simulation tests cover eras, seasons, production, migration, construction, resources, disasters, and event scheduling.
- Economy tests cover goods, labor, food, housing, trade, tariffs, shortages, wealth, and fiscal policy.
- City tests cover districts, services, public order, health, sanitation, land use, construction, and local issues.
- Diplomacy tests cover treaties, claims, reputation, promises, sanctions, alliances, war declarations, and peace deals.
- War/logistics tests cover armies, supply, attrition, morale, terrain, mobilization, occupation, and peace negotiation effects.
- LLM adapter tests cover visibility filtering, structured intents, illegal action rejection, leader memory, deterministic scripted leaders, and live-provider boundaries.
- Chronicle tests generate evidence-linked events and avoid unsupported narrative claims.
- Multiplayer/session tests cover async orders, simultaneous resolution, rollback, audit logs, observer mode, and host moderation.
- Presentation checks verify world map, layers, city panels, diplomacy screen, leader messages, timeline, animated routes/armies, and no dashboard clutter.
- The project passes npm test without requiring live LLM calls or external map services.

## Explicit non-goals
- Do not build a generic 4X spreadsheet with chat messages.
- Do not let LLM leaders invent hidden facts or perform illegal actions.
- Do not make diplomacy prose substitute for validated treaties and policies.
- Do not skip rollback and audit for persistent sessions.
- Do not compromise on presentation; visual map and timeline quality are mandatory.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs, live LLMs, or wall-clock randomness for acceptance tests.
- Test edge cases, replay determinism, command validation, and simulation invariants before broad content expansion.
- Build a polished first playable slice with coherent visual style, responsive layout, clear feedback, and no raw debug UI as the primary experience.
- Every AI decision, simulation transition, score, economy change, or generated narrative must be explainable from source facts and evidence.
- Stubs are acceptable only at external integration, asset, or live-provider boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real game if later teams add content, art, sound, balancing, multiplayer, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single defining property of this project (the capstone):** a **persistent, multi-system, deterministic, snapshot-and-migrate-able world** that runs for in-game centuries and real-world months, where multiple human and bounded-LLM factions submit orders into an **event-sourced, rollback-able, fully-audited** turn engine — so the world is reproducible from `(seed, ordered orders)`, every LLM leader acts only on visibility-filtered knowledge through validated action schemas, the economy conserves value, and a corrupted session turn can be rolled back without losing the audit trail. A 4X spreadsheet with chat bubbles is the failure mode; a *living, replayable, governable history you can audit and roll back* is the win.

## E0. The grading rubric (what actually makes this the capstone)

The naive version is "Civ with chat-driven AI leaders." That is untestable (LLM orders are nondeterministic and may invent hidden facts), unfaithful (economies that mint money, histories that are just generated lore), and ungovernable (no rollback when a multiplayer turn corrupts). The disciplined version is a deterministic simulation under a persistent clock, fed by an **event-sourced order log** with **rollback + audit**, where LLM leaders are **optional adapters emitting visibility-bounded, schema-validated intents**, and the chronicle is an **output of simulation evidence**, not a substitute for it. Grade on:

1. **Determinism + replay/rollback** — the world is reproducible bit-for-bit from `(seed, initial state, ordered orders, leader decisions)`; a host can roll a corrupted turn back to a snapshot and the audit trail preserves the discarded orders. [gafferongames.com/post/deterministic_lockstep](https://gafferongames.com/post/deterministic_lockstep/)
2. **Persistence + migration** — a multi-century world snapshots, saves, and survives schema evolution (upcasting old saves), because long campaigns create real social stakes and must not be bricked by a version bump.
3. **Bounded LLM leaders** — leaders act only on visibility-filtered faction knowledge, through validated action schemas; an order referencing a hidden-map fact is rejected. "LLM leaders inventing hidden facts or performing illegal actions" is an explicit non-goal.
4. **Economic + demographic conservation** — goods, money, population, and military strength are conserved across the simulation; value is moved, not minted. The chronicle records only what the simulation actually did.

Everything below serves those four.

## E1. The deterministic, persistent simulation kernel (the foundation — build this first, ~25–30 cards)

- **Persistent fixed-tick clock with eras/seasons.** No `Date.now()` in core; the world advances in fixed cycles (turn → season → year → era), with production, growth, migration, construction, research, and event scheduling all reading the injected clock. Async multiplayer turns resolve at fixed boundaries. [gafferongames.com/post/fix_your_timestep](https://gafferongames.com/post/fix_your_timestep/)
- **Fixed-point math, no floats in core.** Economy values, population cohorts, military strength, and stocks are fixed-point/integer with deterministic helpers — because float results aren't reproducible across machines/build modes and a century-long world cannot tolerate drift across the hosts replaying it. [gamedeveloper.com/programming/cross-platform-rts-synchronization-and-floating-point-indeterminism](https://www.gamedeveloper.com/programming/cross-platform-rts-synchronization-and-floating-point-indeterminism)
- **Seeded PRNG tree + deterministic iteration.** One root seed forks named streams (disasters, birth/death, migration, battle variance, leader sampling in fixtures). Regions/factions/cohorts are processed in a stable documented order; hash-map iteration order is forbidden in core. [gafferongames.com/post/deterministic_lockstep](https://gafferongames.com/post/deterministic_lockstep/)
- **Event-sourced order log as truth.** Player and faction orders (policy proposals, budgets, construction, diplomacy messages, treaties, mobilization, war/peace) are an append-only log; authoritative world state = fold over the log under the clock. This is what makes replay, rollback, and async multiplayer all the *same* mechanism. [learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- **Snapshots + a per-checkpoint state hash.** Periodic snapshots compact centuries and serve as rollback points; the hash makes any desync (or a corrupted turn) a detectable, testable event. Replay = re-fold from a snapshot + subsequent orders.

## E2. Save persistence + schema migration (the long-life spine)

A capstone persistent world *will* outlive its own data format; treat migration as a first-class, tested subsystem.

- **Versioned events + upcasting.** Every persisted event/snapshot carries a schema version; an **upcaster chain** transforms older formats to the current one on load, so application code only ever handles the latest version while old saves keep working. New fields are added non-breakingly; meaning-changing events get a new version with a documented converter. [event-driven.io/en/how_to_do_event_versioning](https://event-driven.io/en/how_to_do_event_versioning/), [martendb.io/events/versioning.html](https://martendb.io/events/versioning.html)
- **Snapshot-as-checkpoint.** A snapshot captures current state as a new starting point so loading a 300-year world ignores prior events — but snapshots carry the greatest schema-drift risk, so they are versioned and upcastable too. [kurrent.io/blog/snapshots-in-event-sourcing](https://www.kurrent.io/blog/snapshots-in-event-sourcing/)
- **The migration invariant (testable):** a fixture save written under schema vN loads correctly under vN+1 via the upcaster and replays to a state hash equal to a freshly-simulated equivalent — round-trip and forward-compat proven, not hoped.

## E3. The conserving regional economy (the soundness spine — and a cautionary contrast)

The economy must **conserve value**: goods produced, consumed, traded, and stored must balance; money moves between treasuries/pops, never minted by bookkeeping. This is deliberately a *stronger* contract than some shipped grand-strategy economies.

- **Production methods convert inputs to outputs.** Buildings consume input goods + labor and produce output goods at defined rates; pops supply labor and consume goods by wealth/standard-of-living. Trade routes move goods between regional markets with tariffs and access costs.
- **Prices from supply and demand, with conservation enforced.** Local prices respond to regional supply/demand and blend toward a market average by access — the Victoria 3 market shape is a good reference model. **But cite the failure to avoid:** Victoria 3 famously *does not* conserve — it "turns the taps on full blast," wipes the slate each cycle, and **creates or destroys value when supply ≠ demand**, which players observe as "money/goods created from nowhere." This sim takes the opposite stance: a closed accounting where every unit of value has a source and a sink, and any non-conservation is a *bug with a failing test*. [gamedeveloper.com/design/deep-dive-modeling-the-global-economy-in-victoria-3](https://www.gamedeveloper.com/design/deep-dive-modeling-the-global-economy-in-victoria-3), [vic3.paradoxwikis.com/Market](https://vic3.paradoxwikis.com/Market)
- **Shortages drive consequences.** A shortage (demand ≫ supply) raises prices, lowers standard of living, and propagates to unrest — wiring the spec's "embargo → shortages → unemployment → unrest → legitimacy crisis" chain as an *emergent, conserved* cascade, not a scripted penalty.

## E4. Coupled world systems: population, ecology, war (conserved flows)

- **Population as conserved cohorts** (age/culture/class), moving by rate-governed flows: births, deaths, migration along opportunity/safety gradients, and **disease via SIR/SEIR compartments** for plagues — the sum changes only by explicit birth/death, never by error. The spec's "drought → lower grain → migration → faction destabilization → changed trade negotiations" chain is one forcing rippling through conserved flows. [scielo.br/j/rbef/a/HsQxH85ndLXLy78vXTCfVct/?lang=en](http://www.scielo.br/j/rbef/a/HsQxH85ndLXLy78vXTCfVct/?lang=en)
- **Ecology/climate as slow forcing.** Biome productivity, rainfall, drought/flood, soil fertility, and pollution drive food output; disasters are *consequences* of state, with optional **regime-shift/hysteresis** for irreversible collapse (a desertified region that won't recover when stress relaxes). [sciences.ucf.edu/biology/d4lab/wp-content/uploads/sites/23/2024/08/Scheffer-Carpenter-2003.pdf](https://sciences.ucf.edu/biology/d4lab/wp-content/uploads/sites/23/2024/08/Scheffer-Carpenter-2003.pdf)
- **War + logistics as conserved attrition.** Armies are strength pools moved across terrain along supply lines; attrition, morale, and occupation are rate-governed; a unit's strength lost is accounted (to casualties/attrition sinks), not vanished. The spec's "border skirmish escalates via alliance commitments + mobilization logistics" is emergent from treaty obligations + supply constraints, not a cutscene.

## E5. The LLM faction-leader seam: visibility-filtered, schema-validated intents (the safety spine)

Like #34's commander, an LLM leader is a **pure function `faction knowledge → structured intents`**, validated before touching state — and like CICERO, the action space **splits natural-language diplomacy from structured legal actions** (prose for messages, schemas for treaties/policies/war aims). [researchgate.net/publication/365666035](https://www.researchgate.net/publication/365666035_Human-level_play_in_the_game_of_Diplomacy_by_combining_language_models_with_strategic_reasoning), [arxiv.org/html/2506.09655v1](https://arxiv.org/html/2506.09655v1)

- **Scoped faction knowledge with provenance + visibility.** A leader's memory is *scoped faction knowledge* — what that faction has actually observed (its borders, met factions, known trade data), each fact carrying provenance, freshness, and visibility constraints. Unmet factions, hidden map regions, and secret treaties are simply absent — the architecture requirement "leader memory as scoped faction knowledge with provenance, freshness, and visibility constraints," met literally.
- **A typed diplomacy/policy action schema.** Leaders emit `propose_treaty`, `offer_trade`, `declare_war`, `set_policy`, `sanction`, `make_claim`, `mobilize`, `send_message(prose)` — bounded actions with legal shapes.
- **The validator rejects hidden-fact and illegal actions.** It re-checks every intent against the leader's *own* scoped knowledge + the diplomacy/economy/war rules: an alliance proposal that references a map fact the faction couldn't know is **rejected with a structured reason** — the spec's exact "LLM leader proposes an alliance but the validator rejects a hidden-map claim it could not know" scenario, made the central safety mechanism. Prose messages are *presentation*, kept apart from validated legal actions ("generated diplomatic prose separate from legal game actions").
- **Deterministic fallback leaders + belief-state grounding.** Every LLM leader has a `ScriptedLeader` counterpart (a deterministic policy engine) used in all acceptance tests; live LLM is an opt-in adapter, never on the `npm test` path. Grounding leaders in explicit belief/intent state (as CICERO/DipLLM do) keeps reasoning legible and validatable. [arxiv.org/html/2506.09655v1](https://arxiv.org/html/2506.09655v1), [arxiv.org/html/2407.06813v1](https://arxiv.org/html/2407.06813v1)

## E6. Multiplayer governance: async turns, rollback, audit, moderation (the persistence spine)

Long shared worlds have social stakes, so governance is a *core product*, built on the same event-sourced log:

- **Async + simultaneous orders.** Players and AI factions submit orders independently; the engine resolves them at fixed turn boundaries with a deterministic conflict-resolution order — the spec's "humans negotiate a treaty asynchronously while AI factions submit bounded counteroffers."
- **Rollback to a snapshot, audit preserved.** A host can roll a corrupted/contested turn back to a prior snapshot; the **discarded orders remain in the audit log** (never silently dropped) — the spec's "host rolls back a corrupted session turn and the audit trail preserves discarded orders," which is exactly the event-sourcing property (state is recomputable; nothing is destructively mutated).
- **Observer mode + host moderation** are projections/permissions over the same log; pending decisions, submitted orders, audit trail, and rollback points are first-class UI (E7). Audit logs make "the factory/faction decided" reconstructable as "*these orders* were submitted, *this* was rolled back, *here* is the trail."

## E7. The chronicle + presentation (history as evidence, beauty as acceptance)

- **The chronicle is an output of simulation evidence.** Major events (wars, famines, reform laws, peace treaties, migrations, economic crises, leader speeches) are recorded with **evidence links** into the simulation facts that caused them — the spec's "chronicle records a war, famine, reform law, and peace treaty with evidence from simulation state," and the discipline that "historical narrative is an output of simulation evidence, not a replacement for simulation." A chronicle entry can never assert what the simulation didn't produce; redact the prose and the evidence links still reconstruct the event.
- **A premium strategic map (mandatory).** Animated terrain, borders, cities, trade-route movement, army movement, weather, disasters, city growth, unrest, and era progression — with **derived map layers** (every layer is a projection with explicit units and source facts: economy, food, unrest, climate, military). "A spreadsheet map or generic dashboard is not acceptable."
- **First-class LLM-leader presentation:** diplomatic messages, policy-intent cards, evidence-backed reasoning summaries, personality cues, memory references, and *visible action constraints* (so the player sees what a leader legally could and couldn't do).
- **Governance UI:** pending decisions, submitted orders, audit trail, rollback points, and host-moderation state shown clearly; diplomacy screens, treaty editor, city panels, economy dashboards, the event chronicle, and a timeline scrubber.

## E8. The adversarial / edge-case scenario pack (ship the hard cases as fixtures)

Concrete, seeded, deterministically-asserted situations — the difference between a capstone and a 4X mock:

- **Hidden-fact rejection battery:** fixture LLM leaders (standing in for live models) emit intents referencing unmet factions, hidden map regions, or secret treaties — assert each is rejected with the correct structured reason and audit record, and none mutated state.
- **Drought cascade:** drought → grain output drops → migration along opportunity gradients → one faction destabilizes → its trade-negotiation stance shifts — assert the full conserved chain and the chronicle's evidence links.
- **Embargo cascade:** a trade embargo → shortages → unemployment → unrest → legitimacy crisis, all conserved and evidence-linked.
- **Alliance-driven escalation:** a border skirmish escalates because of alliance commitments + mobilization logistics — emergent from treaty obligations + supply, not scripted.
- **Async treaty + AI counteroffers:** humans negotiate asynchronously while `ScriptedLeader` factions submit bounded counteroffers; assert order resolution is deterministic and legal.
- **Rollback integrity:** a host rolls back a corrupted turn to a snapshot; assert the world matches the snapshot-plus-replayed-legal-orders, the discarded orders survive in the audit log, and the post-rollback continuation is deterministic.
- **Save-migration:** a vN fixture save upcasts and loads under vN+1 and replays to the correct state hash (E2).
- **Determinism stressors:** two runs from one seed produce byte-identical era checkpoints; snapshot/restore mid-war continues identically; adapter-independence (identical leader intents ⇒ identical world regardless of scripted/replay/live source).

## E9. Global invariants (property-based — this is how the capstone is graded)

Across randomized + scripted multi-era runs, assert properties, not just examples:

1. **Determinism** — equal `(seed, initial state, ordered orders, leader decisions)` ⇒ byte-identical era checkpoint hashes across two runs and across snapshot/restore and rollback boundaries.
2. **Value conservation** — money + goods (in transit + stored) balance across production/consumption/trade/treasury flows; nothing minted by bookkeeping (the explicit contrast to Victoria 3's slate-wipe).
3. **Population continuity** — cohort + SIR/SEIR sums change only via explicit birth/death/migration/transition flows; no cohort teleports.
4. **Military conservation** — army strength lost is accounted to casualties/attrition/occupation sinks; supply lines bound projection.
5. **Visibility soundness** — every LLM/scripted leader's knowledge and every emitted intent reference only facts that faction could legally observe (proven against ground truth); no hidden-fact action is ever accepted.
6. **No-mutation-by-prose** — world state is mutated only by validator-approved structured orders; diplomatic prose never writes state.
7. **Audit totality + rollback integrity** — every accepted/rejected order and every rollback has an audit record; a rollback never destroys history (discarded orders remain), and state post-rollback equals snapshot + replayed legal orders.
8. **Chronicle groundedness** — every chronicle entry has a non-empty evidence chain into simulation facts; redact the prose and the structured record alone reconstructs the event.
9. **Save-migration round-trip** — old-schema saves upcast and replay to a state hash equal to a fresh equivalent (forward-compat proven).

Plus a **chaos mode**: corrupt-then-roll-back a turn, kill and restore a host mid-era, reorder independent same-turn orders (must not change outcome given the resolution rule), feed the validator fuzzed illegal/hidden-fact intents, and load a battery of old-schema saves — asserting all invariants hold throughout.

## E10. The concrete first vertical slice (the on-ramp — build THIS first, ~55–70 cards)

Do **not** spread the first release thin across diplomacy + war + city-builder + economy. Prove the spine on a **small ancient-river-valley world: 3–4 factions, one shared market, one disputed border, a drought event, and two `ScriptedLeader` rivals** — no live LLM:

- The **deterministic persistent kernel** (E1): fixed-tick era clock, fixed-point conserved values, seeded PRNG tree, event-sourced order log, snapshot + per-checkpoint state hash.
- **Save persistence + a first upcaster** (E2) with the migration round-trip test green.
- The **conserving regional economy** (E3): production methods + pops + one trade route + supply/demand prices, with the value-conservation invariant.
- **Population cohorts + the drought cascade** (E4): drought → grain drop → migration → destabilization, conserved and evidence-linked.
- The **LLM-leader seam** (E5): scoped faction knowledge + the diplomacy/policy intent schema + the validator (visibility + structured rejection + audit), proving the hidden-fact-rejection battery and "prose never mutates state," driven entirely by `ScriptedLeader` + `ReplayLeader` (stub `LiveLLMLeader` behind the same interface).
- **Multiplayer governance core** (E6): async order submission, one rollback-to-snapshot with audit preservation, and observer mode.
- **The chronicle** (E7) recording the drought, a border treaty, and a leader speech with evidence links; and a **premium map slice** (animated terrain/borders/trade movement + economy/food/unrest derived layers) + the governance UI (pending orders, audit trail, rollback points) + a timeline scrubber.
- The **multi-era time-machine test** (E9) green on this slice with all global invariants holding through one snapshot/restore, one rollback, and one save-migration.

If that slice is real — a small replayable world that can drought, migrate, negotiate, and be rolled back, with leaders provably acting only on what they could know — then more factions, full diplomacy/war, city simulation, and live LLM leaders are all breadth on a proven spine. If it isn't, no amount of map art saves it.

## E11. Domain knowledge-debt to track (surface, don't bluff)

Each item gets an owner, a risk note, and an **expert-review/designer-review** flag; some *gate* features until resolved:

- **Economic balance + conservation edge cases** — production rates, price elasticity, and tariff effects are starting points; the conservation contract must be proven before economy breadth ships (gating).
- **Save-format stability** — the upcaster chain is a long-term maintenance burden; document the versioning policy and forbid breaking changes without an upcaster (gating for any persisted-format change).
- **LLM-leader context budget + parse robustness** — token budgets and malformed-output recovery for live models are guesses until measured; keep them off the acceptance path and mark as debt.
- **Visibility-model completeness** — the fog/knowledge filter must cover *every* leader-facing field; flag any field not yet provenance-tagged as a leak risk.
- **Rollback/multiplayer governance UX** — moderation policy, contested-turn resolution, and discarded-order handling need design + (for real deployment) social-rules review.
- **Pathfinding/perf at world scale** — region counts, army movement, and per-turn economy resolution have a performance budget for century-long runs; record it.
- **Fixture realism** — `ScriptedLeader` factions are *representative*, not a model's real behavior; name them as adapters. Climate/ecology units are simplified — no scientific-precision claims.
- **Accessibility** — dense map layers and timelines must not rely on color alone; leader-message and chronicle text must be screen-reader legible (tracked debt).

## E12. Why this is the capstone !Klein challenge

It is the broadest, most coupled, longest-lived of the batch, and it stresses every capability !Klein must prove with small local models at once: **maximal dependency-ordered decomposition** (an economy/population/ecology/diplomacy/war/governance world that *must* be built deterministic-kernel-and-invariants-first, with the event-sourced log as the shared spine before any system or rendering depends on it), **determinism + persistence under weak authorship** (the agents cannot fudge fixed-point math, the order-log fold, save upcasting, or visibility filtering — the conservation, rollback-integrity, and migration invariants catch it immediately), **a clean nondeterministic-actor boundary at scale** (multiple LLM leaders, each isolated behind a knowledge→intent→validator air gap with deterministic scripted fallbacks, so `npm test` stays reproducible — the same governed-agency discipline !Klein applies to itself), **multi-agent coordination + governance** (async multiplayer turns with rollback, audit, and moderation), and **evidence-grounded reasoning** (every chronicle entry, leader intent, and rejection traces to facts). The reward is the most evocative of all: a swarm of small models composing a *living, replayable history* — a world that can drought, migrate, war, reform, and be rolled back — where every event is auditable and every AI leader provably acts only on what it could legally know. Build the deterministic kernel + event-sourced log + conserving economy + visibility-bounded leader seam + one drought-and-rollback slice (E1, E3, E5, E6, E10) first; earn the rest.
