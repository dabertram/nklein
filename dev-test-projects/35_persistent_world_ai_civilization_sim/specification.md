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

---

## Small-model build guide (3B-ready)

> This section exists so a ~3B local model can follow the spec mechanically. Every card below is independently implementable and verifiable with `npm test`. The 3B must **follow** these instructions, not reason about them.

### 1. Glossary & ground rules

**Domain terms**

| Term | Meaning in this project |
|---|---|
| Turn | One fixed-resolution step. All faction orders for a turn are submitted asynchronously; the engine resolves them at a fixed boundary. |
| Era clock | The sequence: turn → season (4 per year) → year → era. All production, growth, migration, and events advance on this clock. |
| FP | Fixed-point integer. Use Q8 = integer × 256. All economy values, population cohorts, military strength, and stocks are FP. Never raw floats in the world state. |
| Seed | A 32-bit unsigned integer. All randomness derives from it. Same seed + same order log = identical world, always. |
| Checksum | A hash of the world state at a turn boundary. Two runs from the same seed must match every checksum. |
| Snapshot | A serialized world state at a turn boundary. Rollback = restore snapshot + replay legal orders since. |
| Order log | The append-only log of all submitted faction/player orders. Authoritative world state = fold(initial, orderLog) under the era clock. |
| Leader | The agent controlling a faction. Three implementations: `ScriptedLeader` (deterministic, all tests), `ReplayLeader` (re-emits recorded intents), `LiveLLMLeader` (production only, never `npm test`). |
| Faction knowledge | The scoped, visibility-filtered world view a leader may act on. Facts carry provenance, freshness, and visibility. Hidden map regions are simply absent. |
| Policy intent | A typed structured action emitted by a leader: `propose_treaty`, `offer_trade`, `declare_war`, `set_policy`, `sanction`, `make_claim`, `mobilize`, `send_message`. |
| Validator | The only bridge from intent to world state. Rejects hidden-fact and illegal actions with a structured reason + audit record. Prose (`send_message`) never mutates state. |
| Audit log | The complete record of accepted/rejected orders and rollbacks. Never destructively mutated — discarded orders remain. |
| Rollback | Restoring a snapshot and replaying only legal orders since that snapshot. Discarded (rolled-back) orders stay in the audit log. |
| Upcaster | A function that converts a persisted event/snapshot from schema version N to version N+1. Required for save compatibility. |
| Chronicle | The record of major events (wars, famines, treaties, disasters) with evidence links into world-state facts. Never a generated-prose substitute for simulation. |
| Conservation | Value (goods, money, population, military strength) is moved, never minted. Any non-conservation is a bug with a failing test. |

**Stack**

- Language: TypeScript (strict mode, no `any`)
- Runtime: Node.js 20+
- Test runner: `npm test` runs `vitest run`
- Key helpers: `src/fp.ts` (FP math), `src/prng.ts` (PRNG tree)
- Layout: `src/` for world simulation; `src/leaders/` for leader implementations; `src/adapters/` for LLM stubs; `src/chronicle.ts` for evidence-linked events; `test/` for tests; `test/fixtures/` for seeded scenarios and schema-migration test saves

**Ground rules (imperative)**

1. Never call `Date.now()`, `Math.random()`, `setTimeout`, or `setInterval` inside `src/` core world modules.
2. All economy, population, and military values are FP integers (Q8). Never store them as raw `number` floats in the world state.
3. Process factions, regions, and cohorts in alphabetical faction-id order, then by ascending region index within a faction. Never iterate a `Map` or `Set` for order-sensitive processing.
4. A leader may only read from a `FactionKnowledge` object (visibility-filtered). It must not receive `WorldState` directly.
5. Diplomatic prose (`send_message` intents) never mutates world state.
6. `npm test` must pass with zero live model calls. `LiveLLMLeader` is never on the `npm test` path.
7. Every accepted order and every rejected intent and every rollback has an audit record with a non-empty `auditId`.
8. Stubs for live LLM: `src/adapters/llm.fixture.ts` throws if `process.env.ENABLE_LIVE_LLM !== "true"`.

---

### 2. The explicit task graph for the first vertical slice

The first slice targets: **E1 (persistent deterministic kernel) + E2 (save persistence + first upcaster) + E3 (conserving regional economy) + E4 (population cohorts + drought cascade) + E5 (leader seam: faction knowledge + intent schema + validator) + E6 (async order submission + rollback-to-snapshot + audit) + chronicle recording drought/treaty/speech (E7) + multi-era time-machine test (E9)**. No live LLM; `ScriptedLeader` and `ReplayLeader` only.

Cards are in strict dependency order.

---

**`W01` — Project scaffold and TypeScript config**
dependsOn: none
files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`
interface:
```ts
// src/types.ts
export type FP = number;           // Q8: integer × 256
export type Turn = number;         // non-negative integer
export type Seed = number;         // uint32
export type EntityId = number;     // stable, monotonically assigned
export type RegionIndex = number;  // 0-based index into world.regions
export type FactionId = string;    // e.g. "nile_kingdom", "delta_merchants"
export type SchemaVersion = number;// starts at 1, incremented on breaking save changes
```
how to implement: standard scaffold. `"test": "vitest run"` in `package.json`. `"strict": true` in `tsconfig.json`.
acceptance: `npm test` exits 0. `tsc --noEmit` has no errors.

---

**`W02` — Fixed-point arithmetic helpers (Q8)**
dependsOn: `W01`
files: `src/fp.ts`, `test/fp.test.ts`
interface:
```ts
// src/fp.ts — Q8: integer × 256
export const FP_SCALE = 256;
export function toFP(n: number): FP       // Math.round(n * FP_SCALE)
export function fromFP(fp: FP): number    // fp / FP_SCALE
export function fpAdd(a: FP, b: FP): FP
export function fpSub(a: FP, b: FP): FP   // throws "Conservation violated" if result < 0
export function fpMul(a: FP, b: FP): FP   // Math.trunc((a * b) / FP_SCALE)
export function fpDiv(a: FP, b: FP): FP   // Math.trunc((a * FP_SCALE) / b); throws if b === 0
export function fpClamp(v: FP, lo: FP, hi: FP): FP
```
how to implement: integer arithmetic only.
acceptance: `fpSub(toFP(1), toFP(2))` throws; `fpMul(toFP(3), toFP(4))` = `toFP(12)`; `fpDiv(toFP(10), toFP(4))` ≈ `toFP(2.5)` within Q8 rounding. `npm test` green.

---

**`W03` — Seeded PRNG tree**
dependsOn: `W01`
files: `src/prng.ts`, `test/prng.test.ts`
interface:
```ts
// src/prng.ts
export type PrngStream = { name: string; state: number };
export type PrngTree = {
  disasters: PrngStream;
  birthDeath: PrngStream;
  migration: PrngStream;
  battle: PrngStream;
  leaderFixture: PrngStream;
};
export function createPrngTree(rootSeed: Seed): PrngTree
export function nextUint32(stream: PrngStream): number
export function nextIntBelow(stream: PrngStream, n: number): number
```
how to implement: xorshift32; each stream seeded from `rootSeed + streamIndex`.
acceptance: two `createPrngTree(77)` produce identical `disasters` sequences. Different streams differ. `npm test` green.

---

**`W04` — Era clock (turn / season / year / era)**
dependsOn: `W01`
files: `src/clock.ts`, `test/clock.test.ts`
interface:
```ts
// src/clock.ts
export type EraClock = {
  turn: Turn;
  season: "spring" | "summer" | "autumn" | "winter";
  year: number;
  era: number;
};
export const TURNS_PER_SEASON = 12;
export const TURNS_PER_YEAR = 48;
export const TURNS_PER_ERA = 480;
export function createClock(): EraClock
export function advanceClock(clock: EraClock): EraClock  // immutable, returns new clock
```
how to implement: `advanceClock` increments `turn`; derives `season` from `(turn / TURNS_PER_SEASON) % 4`; `year` from `Math.trunc(turn / TURNS_PER_YEAR)`; `era` from `Math.trunc(turn / TURNS_PER_ERA)`.
acceptance: after 12 advances, `season === "summer"`. After 48, `year === 1`. After 480, `era === 1`. Immutability: input unchanged. `npm test` green.

---

**`W05` — World model: regions, biomes, and resources**
dependsOn: `W01`, `W02`
files: `src/world.ts`, `test/world.test.ts`
interface:
```ts
// src/world.ts
export type Biome = "river_valley" | "desert" | "highlands" | "wetlands";
export type Region = {
  index: RegionIndex;
  name: string;
  biome: Biome;
  arable: FP;           // cultivable land fraction, Q8 0–1
  rainfall: FP;         // mm per year Q8 (reduced by drought)
  neighbors: RegionIndex[];
};
export type ResourceDeposit = {
  regionIndex: RegionIndex;
  type: "grain" | "timber" | "ore" | "fish";
  stockFP: FP;          // remaining stock Q8
};
export type WorldMap = {
  regions: Region[];
  deposits: ResourceDeposit[];
};
export function createTestWorld(): WorldMap
  // Returns a 4-region river-valley world for tests:
  // regions: [{index:0, name:"valley_north", biome:"river_valley", arable:toFP(0.8), rainfall:toFP(600), neighbors:[1]},
  //           {index:1, name:"valley_south", biome:"river_valley", arable:toFP(0.7), rainfall:toFP(550), neighbors:[0,2]},
  //           {index:2, name:"desert_east", biome:"desert", arable:toFP(0.2), rainfall:toFP(100), neighbors:[1]},
  //           {index:3, name:"highlands_west", biome:"highlands", arable:toFP(0.5), rainfall:toFP(400), neighbors:[0]}]
  // deposits: 1 grain per region, 1 ore at region 3
```
how to implement: hardcoded test world; use `toFP` for all FP fields.
acceptance: `createTestWorld()` returns 4 regions and 5 deposits. `regions[1].neighbors` contains 0 and 2. `npm test` green.

---

**`W06` — Faction and population cohort model**
dependsOn: `W01`, `W02`, `W04`, `W05`
files: `src/faction.ts`, `test/faction.test.ts`
interface:
```ts
// src/faction.ts
export type PopCohort = {
  regionIndex: RegionIndex;
  factionId: FactionId;
  countFP: FP;          // population count Q8
  wealthFP: FP;         // per-capita wealth Q8
  loyaltyFP: FP;        // 0–100 Q8
};
export type Faction = {
  id: FactionId;
  name: string;
  cohorts: PopCohort[];
  treasury: FP;         // liquid funds Q8
  legitimacyFP: FP;     // 0–100 Q8
};
export type WorldFactions = { factions: Faction[] };
export function createFaction(id: FactionId, name: string, startRegion: RegionIndex, popFP: FP, treasuryFP: FP): Faction
export function totalPopulation(faction: Faction): FP   // sum of cohort.countFP
export function factionInRegion(factions: WorldFactions, factionId: FactionId, regionIndex: RegionIndex): PopCohort | null
```
how to implement: `createFaction` creates one initial cohort at `startRegion`. `totalPopulation` sums `countFP` across cohorts.
acceptance: `createFaction(...)` produces one cohort. `totalPopulation` matches that cohort's `countFP`. `factionInRegion` returns `null` for a region with no cohort. `npm test` green.

---

**`W07` — Conserving regional economy**
dependsOn: `W01`, `W02`, `W05`, `W06`
files: `src/economy.ts`, `test/economy.test.ts`
interface:
```ts
// src/economy.ts
export type RegionalMarket = {
  regionIndex: RegionIndex;
  goods: Record<string, FP>;         // good type → stock Q8
  prices: Record<string, FP>;        // good type → price Q8
};
export type TradeRoute = {
  id: EntityId;
  fromRegion: RegionIndex;
  toRegion: RegionIndex;
  goodType: string;
  amountPerTurnFP: FP;
  tariffRateFP: FP;   // 0–1 Q8
};
export type EconomyState = {
  markets: RegionalMarket[];       // one per region
  tradeRoutes: TradeRoute[];
  factionTreasuries: Record<FactionId, FP>;  // faction liquid funds
};
export function produce(
  econ: EconomyState,
  regionIndex: RegionIndex,
  goodType: string,
  amountFP: FP,
): EconomyState
  // markets[regionIndex].goods[goodType] += amountFP
export function consume(
  econ: EconomyState,
  regionIndex: RegionIndex,
  goodType: string,
  amountFP: FP,
): EconomyState
  // fpSub on goods stock — throws "Conservation violated" if insufficient
export function resolveTradeRoute(econ: EconomyState, route: TradeRoute): EconomyState
  // from.goods[type] -= amountPerTurnFP (fpSub — throws if insufficient)
  // to.goods[type] += amountPerTurnFP * (1 - tariffRateFP)
  // tariff portion (amountPerTurnFP * tariffRateFP) → to-region's faction treasury
export function checkConservation(before: EconomyState, after: EconomyState): boolean
  // totalGoods + totalTreasury is invariant (equal within 1 FP unit)
```
how to implement: all immutable returns. `fpSub` is the conservation guard. `checkConservation` sums all `goods` values + all treasury values and compares before and after.
acceptance: `test/economy.test.ts` asserts:
- `produce` then `consume` of same amount returns to original stock.
- `consume` beyond stock throws.
- `checkConservation` is `true` after any sequence of produce/consume/trade operations.
- Trade route tariff goes to the correct treasury.
- `npm test` green.

---

**`W08` — Population growth, migration, and drought cascade**
dependsOn: `W01`, `W02`, `W04`, `W05`, `W06`, `W07`
files: `src/demography.ts`, `test/demography.test.ts`
interface:
```ts
// src/demography.ts
export type DroughtState = {
  affectedRegions: RegionIndex[];
  strengthFP: FP;   // 0–1 Q8: rainfall reduction fraction
};
export function applyDrought(world: WorldMap, drought: DroughtState): WorldMap
  // For each affected region: region.rainfall = fpMul(region.rainfall, fpSub(toFP(1), drought.strengthFP))
export function computeGrainYield(region: Region, econ: EconomyState): FP
  // yield = region.arable * region.rainfall / toFP(1000) * toFP(100)
  // (simplified: arable × rainfall-scaled factor, all FP)
export function growPopulation(cohort: PopCohort, yield_: FP, turnFP: FP): PopCohort
  // if yield_ > toFP(50): countFP += fpMul(countFP, toFP(0.02)) per year (growth)
  // if yield_ < toFP(20): countFP -= fpMul(countFP, toFP(0.05)) per year (famine)
  // clamp countFP to [toFP(0), toFP(1e6)]
export function migrateCohort(
  cohort: PopCohort,
  world: WorldMap,
  prng: PrngStream,   // migration stream
): { updated: PopCohort; migrants: PopCohort[] }
  // If cohort is in a drought-affected region (rainfall < toFP(200)):
  //   move 10% of countFP to a random neighboring region (via prng.migration)
  //   return migrants as a new cohort in the neighbor region
```
how to implement: all FP. Migration uses `nextIntBelow(prng, region.neighbors.length)` to pick the destination. `growPopulation` uses approximate annual rates divided by `TURNS_PER_YEAR`.
acceptance: `test/demography.test.ts` asserts:
- `applyDrought` reduces `rainfall` by the correct fraction.
- `computeGrainYield` is proportional to `arable × rainfall`.
- `growPopulation` with adequate yield increases `countFP`.
- `growPopulation` with famine decreases `countFP`.
- `migrateCohort` in a low-rainfall region produces migrants; same seed → same destination.
- `npm test` green.

---

**`W09` — Order log, command event sourcing**
dependsOn: `W01`, `W02`, `W04`, `W06`
files: `src/orders.ts`, `test/orders.test.ts`
interface:
```ts
// src/orders.ts
export type PolicyOrder =
  | { kind: "set_tax_rate"; factionId: FactionId; regionIndex: RegionIndex; rateFP: FP; turn: Turn }
  | { kind: "construct_building"; factionId: FactionId; regionIndex: RegionIndex; buildingType: string; turn: Turn }
  | { kind: "mobilize_army"; factionId: FactionId; regionIndex: RegionIndex; strengthFP: FP; turn: Turn };
export type DiplomacyIntent =
  | { kind: "propose_treaty"; fromFactionId: FactionId; toFactionId: FactionId; terms: string; turn: Turn }
  | { kind: "offer_trade"; fromFactionId: FactionId; toFactionId: FactionId; goodType: string; amountFP: FP; turn: Turn }
  | { kind: "declare_war"; fromFactionId: FactionId; toFactionId: FactionId; turn: Turn }
  | { kind: "send_message"; fromFactionId: FactionId; toFactionId: FactionId; prose: string; turn: Turn };
export type Order = PolicyOrder | DiplomacyIntent;
export type OrderLog = Order[];
export function appendOrder(log: OrderLog, order: Order): OrderLog
export function ordersForTurn(log: OrderLog, turn: Turn): Order[]
export function ordersForFaction(log: OrderLog, factionId: FactionId): Order[]
```
how to implement: immutable array operations.
acceptance: `appendOrder` does not mutate original. Filter by turn/faction returns correct subsets. `npm test` green.

---

**`W10` — Faction knowledge and visibility filter**
dependsOn: `W01`, `W02`, `W05`, `W06`, `W09`
files: `src/knowledge.ts`, `test/knowledge.test.ts`
interface:
```ts
// src/knowledge.ts
export type KnownRegion = {
  regionIndex: RegionIndex;
  observedAtTurn: Turn;
  rainfall: FP;           // stale if observedAtTurn < currentTurn
  knownFactions: FactionId[];
};
export type KnownFaction = {
  factionId: FactionId;
  lastContactTurn: Turn;
  perceivedLegitimacy: FP;
};
export type FactionKnowledge = {
  ownerFactionId: FactionId;
  currentTurn: Turn;
  knownRegions: KnownRegion[];     // only regions the faction has visited or borders
  knownFactions: KnownFaction[];   // only factions the owner has interacted with
  ownCohorts: PopCohort[];         // always fully known
  ownTreasury: FP;
};
export function buildFactionKnowledge(
  ownerFactionId: FactionId,
  worldState: WorldState,          // full ground truth
  currentTurn: Turn,
): FactionKnowledge
  // Include only: regions adjacent to the faction's own cohort regions + own regions.
  // Exclude: interior regions of other factions with no shared border.
  // Exclude: treasury/cohort details of other factions (only include faction names and last-contact turn).
  // "Hidden map regions are simply absent."
export function verifyKnowledgeContainsNoHiddenFacts(
  knowledge: FactionKnowledge,
  groundTruth: WorldState,
  ownerFactionId: FactionId,
): { ok: boolean; violations: string[] }
  // Check that no KnownRegion references a region the faction could not legally observe.
  // Returns violations as a list of human-readable strings.
```
how to implement: `buildFactionKnowledge` traverses cohort regions, collects their `neighbors`, and includes only those. The faction's own cohort details are included fully; other factions' details are redacted to name + last-contact only.
acceptance: `test/knowledge.test.ts` asserts:
- A faction with a cohort in region 0 sees region 0 and its neighbors, but not a non-adjacent region 3.
- `verifyKnowledgeContainsNoHiddenFacts` returns `{ ok: true, violations: [] }` on a valid knowledge object.
- A knowledge object manually set to include a non-adjacent region fails the verify check.
- `npm test` green.

---

**`W11` — Leader intent schema and validator**
dependsOn: `W01`, `W02`, `W09`, `W10`
files: `src/leaders/intents.ts`, `src/leaders/validator.ts`, `test/validator.test.ts`
interface:
```ts
// src/leaders/intents.ts
export type LeaderIntent =
  | { kind: "propose_treaty"; toFactionId: FactionId; terms: string }
  | { kind: "offer_trade"; toFactionId: FactionId; goodType: string; amountFP: FP }
  | { kind: "declare_war"; toFactionId: FactionId }
  | { kind: "set_policy"; policyType: string; valueFP: FP }
  | { kind: "sanction"; targetFactionId: FactionId }
  | { kind: "make_claim"; regionIndex: RegionIndex }
  | { kind: "mobilize"; regionIndex: RegionIndex; strengthFP: FP }
  | { kind: "send_message"; toFactionId: FactionId; prose: string };  // presentation only
export type SubmittedIntent = { factionId: FactionId; intent: LeaderIntent; submittedAtTurn: Turn };
export type ValidatedOrder = SubmittedIntent & { auditId: string };
export type RejectedIntent = SubmittedIntent & { reason: string; auditId: string };

// src/leaders/validator.ts
export type ValidationResult =
  | { ok: true; validated: ValidatedOrder }
  | { ok: false; rejection: RejectedIntent };
let _auditCounter = 0;  // module-level counter for auditId generation (reset in tests via resetAuditCounter)
export function validateIntent(
  intent: SubmittedIntent,
  knowledge: FactionKnowledge,
  worldState: WorldState,
  turn: Turn,
): ValidationResult
// Rejection rules:
// 1. "hidden_fact_violation": intent references a region/faction not in knowledge.knownRegions/knownFactions
// 2. "insufficient_treasury": economic intents exceed ownTreasury
// 3. "malformed_intent": intent.kind not in the schema
// 4. "war_without_border": declare_war on a faction not in knownFactions
// Every rejection has auditId = `rej_${turn}_${++_auditCounter}`
export function resetAuditCounter(): void  // for test isolation
```
how to implement: each rule is a guard clause with early return. Hidden-fact check: for `make_claim`, `declare_war`, `mobilize`, verify the referenced region/faction is in `knowledge.knownRegions`/`knowledge.knownFactions`. `send_message` is always accepted (prose never mutates state; it is presentation). `auditId` uses the module-level counter reset by `resetAuditCounter()`.
acceptance: `test/validator.test.ts` asserts:
- `make_claim` on a non-adjacent hidden region is rejected with `"hidden_fact_violation"`.
- `offer_trade` with insufficient treasury is rejected with `"insufficient_treasury"`.
- `send_message` is always accepted (even with obviously fictional content).
- `declare_war` on an unknown faction is rejected with `"war_without_border"`.
- Every rejection has a non-empty `auditId`.
- No state mutation for any rejected intent.
- `npm test` green.

---

**`W12` — ScriptedLeader, ReplayLeader, and Commander interface**
dependsOn: `W01`, `W11`
files: `src/leaders/leader.ts`, `src/leaders/scripted.ts`, `src/leaders/replay.ts`, `test/leaders.test.ts`
interface:
```ts
// src/leaders/leader.ts
export interface Leader {
  factionId: FactionId;
  act(knowledge: FactionKnowledge, turn: Turn): LeaderIntent[];
  // Must never receive WorldState directly — only FactionKnowledge.
}

// src/leaders/scripted.ts
export function createScriptedLeader(factionId: FactionId, prng: PrngStream): Leader
  // Phase logic: turn < 50 → offer_trade to known factions; turn 50–100 → set_policy; turn > 100 → make_claim on bordering regions.
  // Uses prng for any tie-breaks.

// src/leaders/replay.ts
export function createReplayLeader(factionId: FactionId, recordedIntents: SubmittedIntent[]): Leader
  // Replays recorded intents at the exact turns they were submitted.

// src/adapters/llm.fixture.ts
export function createLiveLeader(factionId: FactionId): Leader
  // Throws "LiveLLMLeader: not available in test mode" unless process.env.ENABLE_LIVE_LLM === "true"
```
how to implement: `ScriptedLeader` checks `knowledge.ownCohorts.length` and `turn` to select intents. `ReplayLeader` filters `recordedIntents` by `submittedAtTurn === turn`.
acceptance: `test/leaders.test.ts` asserts:
- `ScriptedLeader` produces `offer_trade` in turns 0–49.
- Two ScriptedLeaders with same seed produce identical intent sequences.
- `ReplayLeader` emits the exact same intents as the ScriptedLeader that recorded them.
- `createLiveLeader` throws in test mode.
- `npm test` green.

---

**`W13` — WorldState, checksum, snapshot/restore, and order fold**
dependsOn: `W01`–`W12`
files: `src/worldstate.ts`, `test/worldstate.test.ts`
interface:
```ts
// src/worldstate.ts
export type WorldState = {
  clock: EraClock;
  map: WorldMap;
  factions: WorldFactions;
  economy: EconomyState;
  droughtState: DroughtState;
  prngTree: PrngTree;
  orderLog: OrderLog;           // append-only; only grows
  auditLog: AuditEntry[];       // append-only; includes accepted, rejected, rollback records
  chronicle: ChronicleEntry[];  // append-only
  schemaVersion: SchemaVersion;
};
export type AuditEntry =
  | { kind: "accepted"; auditId: string; order: Order; turn: Turn }
  | { kind: "rejected"; auditId: string; intent: SubmittedIntent; reason: string; turn: Turn }
  | { kind: "rollback"; auditId: string; rollbackToTurn: Turn; discardedOrders: Order[]; turn: Turn };
export type ChronicleEntry = {
  turn: Turn;
  eventType: string;         // e.g. "drought_onset", "trade_treaty_signed", "faction_destabilized"
  description: string;       // prose summary (presentation only)
  evidenceRefs: string[];    // structured facts from worldState that caused this entry (non-empty)
};
export function checksumWorld(state: WorldState): string
  // djb2 hash of {turn, faction_treasuries, total_population, drought_strength, chronicle_count}
export function takeSnapshot(state: WorldState): string    // JSON.stringify(state)
export function restoreSnapshot(snap: string): WorldState  // JSON.parse(snap)
export function applyOrder(state: WorldState, order: Order, auditId: string): WorldState
  // Routes order to the correct subsystem; appends to auditLog; returns new state.
export function rollbackToSnapshot(
  current: WorldState,
  snapshotString: string,
  reason: string,
): WorldState
  // Restores snapshot; appends a rollback AuditEntry to the *current* auditLog that is merged into the restored state.
  // Discarded orders (orders in current.orderLog after snapshot.clock.turn) are recorded in the AuditEntry.
```
how to implement: `applyOrder` dispatches by `order.kind`. `rollbackToSnapshot` parses the snapshot, then appends the rollback audit entry to the restored state's `auditLog` — the discarded orders must survive.
acceptance: `test/worldstate.test.ts` asserts:
- Same state → same checksum twice.
- `restoreSnapshot(takeSnapshot(state))` has identical checksum.
- `rollbackToSnapshot` produces a state with checksum equal to the snapshot's checksum.
- After rollback, discarded orders are present in `auditLog` with `kind === "rollback"`.
- `npm test` green.

---

**`W14` — Save schema versioning and first upcaster**
dependsOn: `W13`
files: `src/migration.ts`, `test/migration.test.ts`
interface:
```ts
// src/migration.ts
export type VersionedSave = {
  schemaVersion: SchemaVersion;
  data: unknown;
};
export type Upcaster = (old: unknown) => unknown;
export const UPCASTERS: Record<SchemaVersion, Upcaster> = {
  1: upcastV1toV2,   // the first upcaster
};
export function loadAndUpcast(versioned: VersionedSave): WorldState
  // Applies upcasters in sequence from versioned.schemaVersion to the current version.
  // Throws if schemaVersion > current or if an upcaster is missing.
function upcastV1toV2(old: unknown): unknown
  // V1 → V2: adds `droughtState: { affectedRegions: [], strengthFP: toFP(0) }` if absent.
  // This is the first schema migration: V1 did not have droughtState; V2 does.
export const CURRENT_SCHEMA_VERSION: SchemaVersion = 2;
```
how to implement: `loadAndUpcast` loops from `versioned.schemaVersion` to `CURRENT_SCHEMA_VERSION - 1`, applying each upcaster in turn. `upcastV1toV2` checks if `(old as any).droughtState === undefined` and adds it.
acceptance: `test/migration.test.ts` asserts:
- A V1 fixture save (a JSON string missing `droughtState`) loads via `loadAndUpcast` and produces a valid `WorldState` with `droughtState !== undefined`.
- A V2 save loaded via `loadAndUpcast` is unchanged.
- A save with `schemaVersion = 99` throws.
- `npm test` green. The V1 fixture save is stored at `test/fixtures/v1_save.json`.

---

**`W15` — Async turn submission and conflict resolution**
dependsOn: `W09`, `W13`
files: `src/session.ts`, `test/session.test.ts`
interface:
```ts
// src/session.ts
export type PendingTurn = {
  turn: Turn;
  submittedOrders: Map<FactionId, Order[]>;  // faction → its submitted orders for this turn
  resolvedAt: Turn | null;
};
export type SessionState = {
  pendingTurns: PendingTurn[];
  resolvedHistory: Turn[];
  hostFactionId: FactionId;
};
export function submitOrder(session: SessionState, factionId: FactionId, order: Order, turn: Turn): SessionState
  // Appends order to pendingTurns[turn].submittedOrders[factionId]
export function resolveTurn(
  session: SessionState,
  worldState: WorldState,
  turn: Turn,
  leaders: Map<FactionId, Leader>,
  knowledge: Map<FactionId, FactionKnowledge>,
  prng: PrngStream,
): { session: SessionState; world: WorldState }
  // 1. Collect all orders from pendingTurns[turn]
  // 2. Also collect intents from leaders (each calls leader.act(knowledge[id], turn))
  // 3. Validate all intents via validateIntent
  // 4. Apply validated orders to worldState in faction alphabetical order (determinism)
  // 5. Mark turn as resolved; return updated session + worldState
```
how to implement: process factions in alphabetical order. All rejected intents are appended to `worldState.auditLog`. Return new session and new worldState (immutable).
acceptance: `test/session.test.ts` asserts:
- Two factions submitting orders for the same turn: both orders are applied in alphabetical order.
- A turn with one valid and one invalid order: valid applied, invalid rejected with audit record.
- `resolveTurn` is deterministic (same seed → same resolved state).
- `npm test` green.

---

**`W16` — Chronicle recorder (evidence-linked events)**
dependsOn: `W01`, `W13`
files: `src/chronicle.ts`, `test/chronicle.test.ts`
interface:
```ts
// src/chronicle.ts
export function recordDrought(state: WorldState, affectedRegions: RegionIndex[]): WorldState
  // Appends a ChronicleEntry: {eventType: "drought_onset", description: "...", evidenceRefs: ["region_${r}_rainfall_${v}" for each affected region]}
export function recordTreaty(state: WorldState, fromId: FactionId, toId: FactionId, terms: string, turn: Turn): WorldState
  // Appends: {eventType: "treaty_signed", evidenceRefs: [`intent_turn_${turn}_${fromId}`]}
export function recordFactionDestabilized(state: WorldState, factionId: FactionId, cause: string): WorldState
  // Appends: {eventType: "faction_destabilized", evidenceRefs: [cause]}
export function verifyChronicleGroundedness(state: WorldState): { ok: boolean; violations: string[] }
  // For each chronicle entry, assert evidenceRefs is non-empty.
  // Returns violations as a list of entries with empty evidenceRefs.
```
how to implement: all `record*` functions return new `WorldState` with the entry appended to `chronicle`. `verifyChronicleGroundedness` filters for entries with `evidenceRefs.length === 0`.
acceptance: `test/chronicle.test.ts` asserts:
- `recordDrought` with 2 affected regions produces an entry with 2 evidenceRefs.
- `verifyChronicleGroundedness` on a state with all entries having refs returns `{ok: true}`.
- A manually appended entry with empty `evidenceRefs` fails the check.
- `npm test` green.

---

**`W17` — Drought cascade scenario fixture**
dependsOn: `W01`–`W16`
files: `src/scenarios/drought_cascade.ts`, `test/drought_cascade.test.ts`
interface:
```ts
// src/scenarios/drought_cascade.ts
export type ScenarioResult = {
  checksums: string[];          // one per era checkpoint (every TURNS_PER_ERA turns)
  auditLog: AuditEntry[];
  chronicle: ChronicleEntry[];
  finalPopulations: Record<FactionId, FP>;
};
export function runDroughtCascadeScenario(seed: Seed, turns: number): ScenarioResult
// Setup (use createTestWorld, 2 factions: "nile_kingdom" and "delta_merchants"):
//   nile_kingdom: cohort at region 0 (valley_north), pop=toFP(1000), treasury=toFP(500)
//   delta_merchants: cohort at region 1 (valley_south), pop=toFP(800), treasury=toFP(400)
//   1 trade route: nile→delta, grain, toFP(10) per turn, tariff=toFP(0.05)
//   DroughtState: {affectedRegions: [0,1], strengthFP: toFP(0.4)}  (40% rainfall reduction)
//   ScriptedLeader for each faction
// Each turn:
//   1. Apply drought to rainfall
//   2. Compute grain yield per region
//   3. Grow/shrink population
//   4. Migrate if rainfall < toFP(200)
//   5. Resolve trade routes
//   6. Run leader intents → validate → apply → record
//   7. Record chronicle entries for significant events
//   8. Checksum every TURNS_PER_ERA turns
```
how to implement: wire all prior modules. The drought should cause grain shortfall → population shrinkage → migration → faction destabilization (legitimacy drops below toFP(30)) → chronicle entry.
acceptance: `test/drought_cascade.test.ts` asserts:
- `runDroughtCascadeScenario(42, 200)` completes without error.
- Two calls with seed=42 produce identical checksums.
- After 200 turns, at least one faction's population is lower than its starting value (drought impact).
- `chronicle` contains at least one `"drought_onset"` and one `"faction_destabilized"` entry.
- All chronicle entries have non-empty `evidenceRefs` (groundedness).
- All `rejectedIntents` in `auditLog` have non-empty `reason` and `auditId`.
- `npm test` green.

---

**`W18` — Determinism + rollback + save-migration integration test**
dependsOn: `W17`, `W14`, `W13`
files: `test/integration.test.ts`
interface: (test file only)
how to implement:
1. Run `runDroughtCascadeScenario(42, 200)` twice. Assert all era checksums are identical.
2. Snapshot/restore: run 100 turns, take snapshot, run 100 more → `checksums[1]`. Restore snapshot, run 100 more → assert `checksums[1]` matches.
3. Rollback test: run 50 turns, snapshot, run 50 more, rollback to snapshot. Assert world checksum equals the snapshot's checksum. Assert discarded orders are in the restored `auditLog`.
4. Save-migration: serialize the scenario's final state as a "V1" save (strip `droughtState`), load via `loadAndUpcast`, assert the loaded state has a valid `droughtState` and the checksum matches a freshly-simulated equivalent state.
5. Assert all conservation invariants at every era checkpoint: `checkConservation` returns `true` before and after each turn.
acceptance: all assertions green, `npm test` green.

---

### Summary of first-slice cards

| id | title |
|---|---|
| W01 | Project scaffold and TypeScript config |
| W02 | Fixed-point arithmetic helpers (Q8) |
| W03 | Seeded PRNG tree |
| W04 | Era clock (turn / season / year / era) |
| W05 | World model: regions, biomes, and resources |
| W06 | Faction and population cohort model |
| W07 | Conserving regional economy |
| W08 | Population growth, migration, and drought cascade |
| W09 | Order log, command event sourcing |
| W10 | Faction knowledge and visibility filter |
| W11 | Leader intent schema and validator |
| W12 | ScriptedLeader, ReplayLeader, and Leader interface |
| W13 | WorldState, checksum, snapshot/restore, and order fold |
| W14 | Save schema versioning and first upcaster |
| W15 | Async turn submission and conflict resolution |
| W16 | Chronicle recorder (evidence-linked events) |
| W17 | Drought cascade scenario fixture |
| W18 | Determinism + rollback + save-migration integration test |

**18 first-slice cards.**

---

### 3. The decomposition method for the rest

After the first slice passes, expand features with this recipe:

**Step 1 — Identify the new system's invariant and its conservation rule.**
Example: diplomacy treaties → invariant: a treaty is only binding when both factions have submitted `accept_treaty` orders; no treaty is unilaterally applied. State this before writing code.

**Step 2 — Types-and-interface card.**
One card with exported types and function signatures. No implementation yet.

**Step 3 — Pure-function implementation card.**
All FP, no floats, no `Math.random()`. Reference `fp.ts` and `prng.ts`. All state changes are immutable returns.

**Step 4 — Invariant test card.**
Assert the invariant holds before and after. Include at least one fuzz loop (random inputs, assert no crashes and conservation holds).

**Step 5 — Validator guard card (if the feature has legal-action implications).**
Add a rejection rule to `validateIntent` for any new intent kind. Test it fires on the right inputs.

**Step 6 — Wire into WorldState and the turn loop.**
One card adds the new state field to `WorldState`, wires it into `resolveTurn`, and ensures `checksumWorld` covers it.

**Step 7 — Chronicle recording card.**
Add a `record*` function to `chronicle.ts` for the new event type, with `evidenceRefs` populated from actual state facts.

**Step 8 — Scenario fixture card.**
A function in `src/scenarios/` that drives the feature end-to-end and records events for the integration test.

---

**Worked example 1: Diplomacy treaty system**
- `D01` — `src/diplomacy.ts` types: `Treaty {id: string; parties: FactionId[]; terms: string; signedAtTurn: Turn; status: "proposed"|"active"|"broken"}`. dependsOn: W01, W06.
- `D02` — Implement `proposeTreaty(state, from, to, terms)` → appends a proposed treaty. `acceptTreaty(state, from, treatyId)` → makes it active if the other party already proposed. Conservation: no treasury change until a trade treaty is accepted. dependsOn: D01, W07.
- `D03` — Test: two proposals from both parties create one active treaty. A unilateral proposal stays "proposed". dependsOn: D02.
- `D04` — Validator rule: `propose_treaty` for an unknown faction → `"hidden_fact_violation"`. dependsOn: D03, W11.
- `D05` — Chronicle: `recordTreatyActivated(state, treatyId)` with `evidenceRefs: [proposal_turn, acceptance_turn]`. dependsOn: D04, W16.
- `D06` — Scenario fixture: two scripted leaders exchange a trade treaty; assert treaty becomes active and chronicle records it with evidence. dependsOn: D05.

**Worked example 2: Military mobilization and attrition**
- `M01` — `src/military.ts` types: `Army {factionId: FactionId; regionIndex: RegionIndex; strengthFP: FP; moraleFF: FP}`. Function `attritionStep(army, supplyFP)` → if `supplyFP < toFP(1)`, reduce `strengthFP` by `toFP(0.02)` per turn. dependsOn: W01, W02.
- `M02` — `moveArmy(army, toRegion, worldMap)`: validate `toRegion` is adjacent; move army. dependsOn: M01, W05.
- `M03` — Test: army without supply attrites monotonically. Moving to non-adjacent region throws. dependsOn: M02.
- `M04` — Wire into `resolveTurn`: call `attritionStep` for each army; update `WorldState.armies`. dependsOn: M03, W13.
- `M05` — Validator: `mobilize` intent for a non-owned region → `"hidden_fact_violation"`. `mobilize` beyond treasury → `"insufficient_treasury"`. dependsOn: M04, W11.

**Worked example 3: City district public order**
- `C01` — `src/city.ts` types: `District {regionIndex: RegionIndex; factionId: FactionId; type: "housing"|"market"|"barracks"; publicOrderFP: FP}`. `computePublicOrder(district, popCohort, econ): FP` — lower food stock → lower order. dependsOn: W01, W06, W07.
- `C02` — `applyPublicOrderEffects(faction, districts)`: low public order reduces `legitimacyFP` by `toFP(0.01)` per turn per district below `toFP(30)`. dependsOn: C01, W06.
- `C03` — Test: a district with `foodStock = 0` drives `publicOrderFP` to 0 and reduces legitimacy. dependsOn: C02.
- `C04` — Chronicle: `recordUnrest(state, regionIndex, publicOrderFP)` — evidence = current food stock and legitimacy. dependsOn: C03, W16.

---

### 4. Per-task implementation conventions

**File/folder layout**
```
src/
  types.ts              — FP, Turn, Seed, EntityId, RegionIndex, FactionId, SchemaVersion
  fp.ts                 — Q8 fixed-point math
  prng.ts               — PRNG tree
  clock.ts              — EraClock
  world.ts              — WorldMap, Region, Biome, ResourceDeposit
  faction.ts            — Faction, PopCohort
  economy.ts            — EconomyState, RegionalMarket, TradeRoute
  demography.ts         — drought, growth, migration
  orders.ts             — Order types, OrderLog
  knowledge.ts          — FactionKnowledge, buildFactionKnowledge
  leaders/
    leader.ts           — Leader interface
    intents.ts          — LeaderIntent, SubmittedIntent, ValidatedOrder, RejectedIntent
    validator.ts        — validateIntent
    scripted.ts         — ScriptedLeader
    replay.ts           — ReplayLeader
  adapters/
    llm.fixture.ts      — LiveLLMLeader stub
  worldstate.ts         — WorldState, AuditEntry, applyOrder, rollbackToSnapshot
  migration.ts          — versioned saves, upcasters
  session.ts            — PendingTurn, SessionState, resolveTurn
  chronicle.ts          — ChronicleEntry, record* functions
  scenarios/            — one file per scenario
test/
  *.test.ts
  fixtures/
    v1_save.json        — V1 schema fixture for migration test
```

**Naming**
- FP fields end in `FP` (e.g. `treasuryFP`, `countFP`).
- `Leader.act` always receives `FactionKnowledge`, never `WorldState`.
- `send_message` intents never appear in `WorldState.orderLog` that feeds the simulation — they are routed to a separate `chatLog` structure excluded from checksums.

**Writing a test (vitest snippet)**
```ts
// test/economy.test.ts
import { describe, it, expect } from "vitest";
import { toFP, fromFP } from "../src/fp.js";
import { produce, consume, checkConservation } from "../src/economy.js";
import { createTestEconomy } from "./helpers.js";

describe("economy conservation", () => {
  it("produce then consume preserves total goods", () => {
    const before = createTestEconomy();
    const after = consume(produce(before, 0, "grain", toFP(50)), 0, "grain", toFP(30));
    expect(checkConservation(before, after)).toBe(true);
  });
});
```

**Determinism rules**
- Process factions in alphabetical `factionId` order in all world-wide loops.
- Pass `PrngStream` as explicit arguments; never module-level singletons.
- Sort `Map` contents to arrays by key before serialization in `takeSnapshot`.

**The LLM adapter boundary (critical)**
- `LiveLLMLeader` throws unless `process.env.ENABLE_LIVE_LLM === "true"`.
- Test code only imports `Leader` from `src/leaders/leader.ts` — never the live adapter.
- `send_message` intents are presentation only and must not appear in `WorldState.orderLog`.

**Definition of done (any card)**
1. `npm test` is green.
2. `tsc --noEmit` has zero errors.
3. At least one test asserts the key invariant (conservation, determinism, visibility soundness, chronicle groundedness).
4. No `Math.random()`, `Date.now()`, or raw floats in world-state computations.
5. No `any` types.
6. No `Leader` receives `WorldState` directly — only `FactionKnowledge`.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1: Using floats for economy or population values**
The model will write `faction.treasury += grainRevenue * 0.95`. On different machines this produces different rounding, breaking the century-long replay checksum. Fix: all economy math uses `fpMul`, `fpSub`, `fpAdd`. The conservation test in `W07` will immediately catch any float arithmetic that causes a balance mismatch.

**Pitfall 2: Leader receiving WorldState instead of FactionKnowledge**
The model may pass `worldState` directly to `leader.act(worldState, turn)` to avoid writing `buildFactionKnowledge`. This breaks the hidden-fact invariant. Fix: always call `buildFactionKnowledge(factionId, worldState, turn)` first; pass only the result to `act`. The validator's `"hidden_fact_violation"` test will catch any intent that references a region/faction absent from `knowledge.knownRegions`.

**Pitfall 3: send_message mutating world state**
The model may add the text of a `send_message` intent to a `messageLog` field inside `WorldState`, which the checksum then hashes. A live LLM producing different prose would produce a different checksum, making replays fail. Fix: `send_message` intents are validated as legal (accepted) but routed to a `chatLog` structure that is **excluded from `checksumWorld`** and **excluded from the `orderLog`** that drives the world simulation.

**Pitfall 4: Rollback destructively dropping discarded orders**
The model may implement `rollbackToSnapshot` as: parse snapshot, return it directly. This loses the discarded orders. Fix: `rollbackToSnapshot` must append a `{kind: "rollback", discardedOrders: [...]}` entry to the *restored* state's `auditLog`. The integration test (W18) asserts the discarded orders survive.

**Pitfall 5: Nondeterministic faction resolution order**
The model may iterate `worldState.factions.factions` in insertion order, which varies after snapshot restore (if the array was serialized differently). Fix: always sort factions by `factionId` (alphabetical) before any world-wide resolution loop. The determinism test (W18) will catch any ordering bug.

**Pitfall 6: Missing upcaster for a new save field**
When a new field is added to `WorldState`, old saves won't have it. The model may add the field directly and forget to write an upcaster, causing old saves to fail to load. Fix: any time `WorldState` gains a field, increment `CURRENT_SCHEMA_VERSION` and add an upcaster in `UPCASTERS` that adds the field's default value. The migration test (W18) will catch the absence of the upcaster.

**Pitfall 7: Chronicle entries with empty evidenceRefs**
The model may write `recordDrought(state, [])` (empty regions) or forget to populate `evidenceRefs`. This fails the chronicle groundedness invariant. Fix: every `record*` function in `chronicle.ts` must produce at least one `evidenceRef` string citing an actual state fact (e.g., the rainfall value at the time). The `verifyChronicleGroundedness` function in W16 and the W18 test will catch empty refs.
