# 33 - Colony Settlement Social Simulation

Complexity tier: 33/35 game block
Expected decomposition size: 175-215 dependent implementation cards before coding.
Domain pressure: colony management, agent needs, social simulation, construction, schedules, jobs, psychology, storytelling, presentation-rich simulation.
Acceptance command: npm test

## How to use this challenge
This is a game dev-test project specification for evaluating whether an autonomous coding agent can decompose real game systems, implement deterministic simulation logic, and build a polished presentation layer that makes the game understandable and desirable. The goal is not to finish the whole game. The goal is to build a product-grade foundation that proves the agent understands rules, simulation state, player experience, rendering, and verification.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify engine and presentation invariants, and choose a release slice that exercises the highest-risk mechanics. For game projects, visual presentation is mandatory, not a stretch goal. A correct simulation hidden behind ugly placeholder UI is not enough.

## Product vision
Build a colony settlement simulation where individual colonists have needs, skills, relationships, memories, schedules, jobs, traits, conflicts, and stories. The game should support construction, logistics, survival, and emergent drama with presentation that makes the colony feel inhabited.

## Target players and users
- Colony-sim players who care about emergent stories and practical base management.
- Simulation players who want work planning, logistics, and social dynamics to interact.
- Designers tuning needs, traits, events, and story generation.
- Spectators who enjoy readable character drama and settlement evolution.

## Foundation release scope
The first serious buildout must include:
- World, map tile, room, building, job, work order, stockpile, item, recipe, colonist, skill, trait, need, mood, memory, relationship, schedule, event, threat, story beat, and save models.
- Colonist AI with needs, priorities, pathfinding, job selection, skill effects, schedule blocks, rest, recreation, hunger, injury, stress, and task interruption.
- Social simulation with relationships, conversations, conflicts, friendships, rivalries, leadership, morale, shared memories, and social event outcomes.
- Construction and logistics system for blueprints, materials, hauling, crafting, farming, cooking, power placeholder, storage rules, and work queues.
- Room and environment evaluation for beauty, crowding, temperature placeholder, cleanliness, noise, ownership, safety, and work efficiency.
- Storyteller event system that generates raids, illness, weather, trade, migration, accidents, celebrations, breakdowns, and moral dilemmas from colony state.
- Incident and recovery workflows for injury, fire, food shortage, social fight, work backlog, housing shortage, and leadership crisis.
- Character inspector and colony timeline with memories, relationships, mood reasons, recent events, and future risks.
- Replay/save system that records player commands, random seeds, colonist decisions, and story events.
- Seed colony with five colonists, incompatible traits, scarce food, unfinished shelter, work priority conflict, and a social crisis during a storm.

## Gameplay requirements
- Colonists must feel like agents with understandable motives, not anonymous workers.
- Base-building, logistics, and social simulation must interact directly.
- The player should set priorities and policies rather than micromanage every action.
- Stories should be grounded in simulation state and memories, not random flavor text.

## Presentation requirements
Very nice presentation is mandatory for this challenge. The agent must treat rendering, animation, interaction feedback, and layout polish as core acceptance criteria. Required presentation work:
- The colony must look inhabited: animated colonists, job actions, carried items, construction progress, room states, weather, lights, alerts, and expressive character status.
- Character panels need portrait/style treatment, mood breakdown, needs, traits, skills, relationships, memories, and current plan in a polished readable layout.
- The map UI must include build tools, stockpile zones, job overlays, room quality overlays, path previews, schedules, and event timeline.
- Story events should be presented with strong visual hierarchy, character references, consequences, and evidence from simulation state.
- No raw agent tables or generic task list UI should be the primary presentation.

## Architecture requirements
- Separate map/world, colonist AI, pathfinding, job system, construction/logistics, needs/mood, social simulation, storyteller events, timeline/replay, and renderer.
- Use deterministic seeded decisions with inspectable reasoning traces for colonist choices.
- Represent memories and relationships as structured simulation facts, not generated prose only.
- Keep story generation grounded in state queries and event templates.

## Domain knowledge debt to surface
The agent should not pretend to know every game design, simulation, AI, rendering, or balancing detail perfectly. It should mark assumptions, build deterministic subsets, and preserve extension points for future designers, artists, balance passes, and live integrations. Required knowledge areas:
- Colony sims depend on believable agent priorities and explainable failure states.
- Social systems need memory, relationship change, mood effects, and event causality.
- Logistics and work queues create the practical constraints behind emergent stories.
- Presentation must let players understand why colonists behave as they do.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model and presentation should be capable of representing them:
- A skilled builder skips construction because hunger and storm fear override work priority.
- Two colonists with bad memories fight, injuring the colony doctor during a food shortage.
- A cramped dirty barracks lowers sleep quality, causing mood collapse and slower work.
- A celebration improves morale but consumes scarce food and delays defenses.
- A replay shows exactly why a work backlog caused a cascade into social crisis.

## Decomposition pressure
This challenge should force decomposition across rules or simulation engine, deterministic fixtures, AI or policy layers, replay/save state, player-facing presentation, UI interaction, diagnostics, and test harnesses. The plan should include dependency links so core state, commands, invariants, and golden tests are built before rendering depends on them. Avoid starting with a visual mock that cannot play the game; also avoid building a correct but lifeless engine with no usable presentation.

The agent should maintain a visible knowledge-debt list covering unclear rules, balance assumptions, AI limitations, rendering tradeoffs, asset gaps, accessibility concerns, performance constraints, and future designer review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Colonist AI tests cover needs, priorities, schedules, job selection, pathfinding, interruption, injury, and rest.
- Social tests cover relationships, memories, conversations, conflicts, morale, and leadership effects.
- Construction/logistics tests cover blueprints, hauling, crafting, stockpiles, farming, cooking, and work queues.
- Storyteller tests generate events from colony state and cite causal evidence.
- Replay tests reproduce colonist decisions and event timeline from seed and commands.
- Presentation checks verify animated colony, character inspector, build tools, overlays, event timeline, and no panel overlap.
- The project passes npm test without live AI services.

## Explicit non-goals
- Do not build a base builder with anonymous units only.
- Do not generate story text disconnected from simulation state.
- Do not hide colonist decision reasons.
- Do not ship an unpolished management-table interface as the game.

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

> Added 2026-06-26 via deep domain research. **The single defining property of this project:** the colony is a *generator of explainable emergent drama* — its worth is not the base-building but the fact that every colonist action, mood swing, fight, and story beat is **a deterministic, replayable function of structured simulation facts (needs, traits, memories, relationships, environment)**, so the player can always ask "why did they do that?" and get an honest, evidence-grounded answer. A colony of anonymous units obeying a task queue is the failure mode; a colony of *legible agents whose tragedies you can replay and understand* is the win.

## E0. The grading rubric (what actually makes this master-grade)

The naive version is "units that haul and build, plus random flavor text." That is unreadable (decisions look arbitrary), ungrounded (stories are bolted-on lorem ipsum), and unreproducible. The disciplined version makes **the agent's reasoning a first-class, inspectable, deterministic data structure** and makes **stories an output of simulation evidence**, never a parallel text generator. Grade on:

1. **Determinism + replay** — `simulate(seed, commands)` reproduces every colonist decision and story beat bit-for-bit; a replay can be scrubbed to *the exact tick* a backlog tipped into a social crisis. Only inputs + seed are stored; behavior is recomputed. [gafferongames.com/post/deterministic_lockstep](https://gafferongames.com/post/deterministic_lockstep/)
2. **Decision legibility** — every job selection, schedule override, and mental break exposes its scored reasoning trace (which needs/thoughts/threats drove it). "Hidden colonist decision reasons" is an explicit non-goal.
3. **Story groundedness** — every story beat cites the simulation facts and memories that caused it (an evidence chain), not free-form prose. "Story text disconnected from simulation state" is an explicit non-goal.
4. **Emergence under weak authorship** — fights, mood collapses, and celebrations *emerge* from needs/traits/memory/logistics interacting, not from scripted triggers. The storyteller *escalates pressure*; the simulation *produces the drama*.

Everything below serves those four.

## E1. The deterministic agent kernel (build this first, ~15–20 cards)

- **Logical fixed-tick clock.** No `Date.now()`/`setTimeout` in core; the colony advances in fixed ticks (e.g. an in-game hour), with schedules, need decay, work progress, and pathing all reading the injected clock. Render interpolates between simulation snapshots (Fix Your Timestep); the simulation never reads wall time. [gafferongames.com/post/fix_your_timestep](https://gafferongames.com/post/fix_your_timestep/)
- **Seeded PRNG tree.** One root seed forks named sub-streams (job tie-breaks, social-interaction outcomes, storyteller selection, trait expression). No `Math.random()`; ordering of draws is contractual so two runs agree.
- **Deterministic iteration + tie-breaking.** Colonists, jobs, and items are processed in a stable documented order (stable entity id), and *every* "pick the best" step (highest-utility job, nearest hauler, shortest path) has an explicit deterministic tie-break — the most common colony-sim desync is two equally-good choices resolved by hash-map order. Forbid nondeterministic iteration in core. [gafferongames.com/post/deterministic_lockstep](https://gafferongames.com/post/deterministic_lockstep/)
- **Event-sourced command + snapshot model.** Player inputs (set work priorities, draw a blueprint, set a schedule, designate a stockpile, forbid an item) are an append-only log; authoritative state = fold over the log under the clock. Periodic snapshots compact long colonies; a **state checksum** every checkpoint makes desync a failing test. Replay = re-fold; the timeline is authoritative from `(initial, seed, commands)`.
- **Fixed-point for accumulating quantities.** Need levels, mood, skill XP, and work progress are fixed-point/integer, not floats, so long colonies don't drift across machines/build modes. [gamedeveloper.com/programming/cross-platform-rts-synchronization-and-floating-point-indeterminism](https://www.gamedeveloper.com/programming/cross-platform-rts-synchronization-and-floating-point-indeterminism)

## E2. The needs + utility-AI core (grounded in The Sims) — the behavioral spine

Colonist behavior is a **utility/needs-based AI**, the architecture pioneered by *The Sims*: each need has a decaying satisfaction level and an *urgency curve*; each available action/object *advertises* how much it satisfies each need; the colonist scores actions as **urgency × advertised satisfaction** (plus distance/skill/priority modifiers) and picks the highest. This is what makes a hungry, exhausted builder *correctly* abandon construction to eat — the spec's exact required scenario — and it is fully deterministic and explainable. [docs.gamecreator.io/behavior/utility-ai](https://docs.gamecreator.io/behavior/utility-ai/), [en.wikipedia.org/wiki/Utility_system](https://en.wikipedia.org/wiki/Utility_system), [arxiv.org/pdf/2008.11258](https://arxiv.org/pdf/2008.11258)

- **Needs** (hunger, rest, recreation, comfort, social, safety, health) decay over time and are restored by advertised actions; unmet needs depress mood and can *interrupt* the current job (the interruption itself is a scored decision with a trace).
- **Consider a hybrid with goal-oriented planning (GOAP) for multi-step tasks** (cook requires haul-ingredients → use-stove → carry-meal): GOAP chains actions to reach a goal, utility scores *which* goal to pursue. The combination — utility selects the goal, GOAP sequences the steps, behavior-tree/skill modifiers shape execution — is the modern, documented pattern. [tonogameconsultants.com/game-ai-planning](https://tonogameconsultants.com/game-ai-planning/), [jmis.org/archive/view_article?pid=jmis-10-4-321](https://www.jmis.org/archive/view_article?pid=jmis-10-4-321)
- **Every decision emits a reasoning trace**: the top-N scored candidates with their urgency/advertisement/modifier breakdown. The character inspector renders this verbatim — that *is* the "why are they doing that" answer.

## E3. The mood model (RimWorld-grounded, numeric, testable) — the drama spine

The emotional system is the precise, citable engine that turns logistics into stories. Model it on RimWorld's mechanics:

- **Mood is the sum of active thoughts (moodlets).** Mood is a 0–100 value = baseline + Σ(active thought offsets). Thoughts are discrete, time-limited memories with signed offsets (e.g. "ate without a table" −3, "slept in the cold" −5, "slept in a barracks" small negative scaling with crowding, "attended a party" positive, "my friend died" large negative with a long decay). Many small penalties **stack into large effects** — the documented reason a cramped, dirty barracks cascades into mood collapse (the spec's required scenario). [rimworldwiki.com/wiki/Mood](https://rimworldwiki.com/wiki/Mood)
- **Mental-break thresholds are explicit bands, not a hidden score.** For a normal colonist: **minor break risk below ~35% mood, major below ~20%, extreme below ~5%** — and these scale by trait. Internally the major threshold is **4/7** and the extreme **1/7** of the colonist's mental-break-threshold stat. Below a band, a break fires on a *mean-time* basis (minor ≈ every 10 days, major ≈ 3 days, extreme ≈ 0.7 days), drawn from the seeded stream. The low-mood bands correspond to readable states ("Stressed", "On edge", "About to break"). This gives an *exact, testable* relationship between accumulated thoughts and emergent breakdowns. [rimworldwiki.com/wiki/Mental_break](https://rimworldwiki.com/wiki/Mental_break), [rimworldwiki.com/wiki/Mental_Break_Threshold](https://rimworldwiki.com/wiki/Mental_Break_Threshold)
- **Expectations / adaptation** modulate baseline so the same conditions feel worse to a colonist used to comfort — a slow-moving driver layered over fast thoughts.
- **Traits shift thresholds and thought offsets** (a "kind" colonist, a "volatile" one, a "psychopath" who lacks certain penalties), so identical situations produce *different* individuals' breaks — character, not noise.

## E4. The social graph + memory model (structured facts, not prose)

Relationships and memories are **structured simulation facts**, the explicit architecture requirement — DF's emergent-narrative power comes precisely from agents who *reference past events* held as data (grudges, friendships, shared experiences), not from a text generator. [grokipedia.com/page/Dwarf_Fortress](https://grokipedia.com/page/Dwarf_Fortress), [if50.substack.com/p/2006-dwarf-fortress](https://if50.substack.com/p/2006-dwarf-fortress)

- **Relationships** are typed, weighted edges (opinion value, kind: friend/rival/lover/family) that *change* from interaction outcomes and shared/clashing memories. Opinion feeds social thought offsets (E3), closing the loop between drama and mood.
- **Memories** are structured records (event ref, valence, participants, decay), queryable by the storyteller and the inspector. "Two colonists with bad memories fight" is then an *emergent* outcome of a low-opinion edge + a social-interaction roll under stress, with the injured doctor and the food-shortage context all coming from live state — exactly the spec's required scenario.
- **Social interactions** are deterministic events: pick interlocutors by proximity + relationship, roll outcome from the seeded stream weighted by traits/mood/opinion, then *write back* opinion deltas and memories. Conflicts, friendships, and leadership effects all flow from this one mechanism.

## E5. The storyteller (escalation, not authorship) — grounded in RimWorld's design

The storyteller controls *pressure and pacing*; the simulation produces the *content*. Model it on RimWorld's AI Storytellers and their famous **wealth → threat feedback loop**:

- **State-driven incident selection.** The storyteller reads colony state — wealth (buildings + items + colonists), population, recent deaths/injuries, time since the last major event — to budget the next incident's intensity. RimWorld converts "storyteller wealth" into **raid points** on an increasing curve (roughly +1 raid point per ~160 wealth in the mid-range), so prosperity *itself* escalates danger — a procedural argument that unbounded growth invites collapse. Reproduce this as a tunable, testable pressure budget. [rimworldwiki.com/wiki/AI_Storytellers](https://rimworldwiki.com/wiki/AI_Storytellers), [rimworldwiki.com/wiki/Raid_points](https://rimworldwiki.com/wiki/Raid_points)
- **Selectable storyteller personalities** as distinct pacing policies: a Cassandra-style rising-tension curve (push → breathe → push, ~1–2 major threats per quadrum with a cooldown), a Phoebe-style long-calm builder, and a Randy-style high-variance roll (±50–150% on each incident's points). Each is a deterministic policy over the seeded stream, not a different content set. [rimworldwiki.com/wiki/AI_Storytellers](https://rimworldwiki.com/wiki/AI_Storytellers)
- **Incidents are seeds, not scripts.** A raid, illness, trade caravan, migration, accident, or moral dilemma sets up *conditions*; the resulting drama emerges from how the colony's needs/logistics/social graph respond. The "celebration improves morale but consumes scarce food and delays defenses" scenario is the storyteller seeding an opportunity and the simulation paying its real costs.
- **Every story beat is evidence-linked.** A generated beat ("A brawl broke out in the mess hall") carries its causal chain: the low-opinion edge, the stress level, the food-shortage thought, the tick it fired — renderable as the beat's "evidence" so a beat can never assert something the simulation didn't produce.

## E6. Construction, logistics, and pathfinding (the practical constraints behind the drama)

- **Work as a typed job graph.** Blueprints generate material requirements → hauling jobs → construction jobs; crafting/cooking/farming are recipe-driven (inputs → station → time → outputs). Stockpile rules and forbid flags shape the queue. Logistics scarcity (no hauler free, ingredient stuck across the map) is what *creates* the backlog that the storyteller's pressure turns into crisis — the spec's "replay shows exactly why a work backlog caused a cascade" scenario.
- **Deterministic pathfinding.** Use grid A* with an explicit, documented tie-breaking rule (or Jump Point Search, which breaks path symmetry by expanding only canonical paths — fewer equal-cost ambiguities and a natural determinism win on uniform grids); flow-field/hierarchical options for many haulers. Tie-breaks must be deterministic or replay desyncs. [arxiv.org/pdf/2501.14816](https://arxiv.org/pdf/2501.14816), [ithy.com/article/jump-point-search-algorithm-summary-9hqxrz71](https://ithy.com/article/jump-point-search-algorithm-summary-9hqxrz71)
- **Room/environment evaluation** (beauty, cleanliness, crowding, light, temperature placeholder, ownership) is a derived score per room that *feeds back* into thoughts (E3) — a dirty cramped barracks is computed, then lowers sleep-quality mood, then degrades work. No magic; a closed, traceable loop.

## E7. Presentation that makes minds legible (mandatory, derived, never hand-maintained)

Beauty is acceptance, and the discipline is that **every panel is a pure projection of simulation facts.**

- **An inhabited colony:** animated colonists performing job actions, carried items, construction progress, room states, weather, lighting, alerts, and *expressive status* (a colonist about to break looks like it).
- **The character inspector is the keystone:** portrait/style, a **mood breakdown that lists each active thought and its offset** (E3), needs bars, traits, skills, the relationship graph, recent memories, and the *current plan with its scored reasoning trace* (E2). This panel is where "why are they doing that?" is answered from data, every time.
- **The map UI:** build tools, stockpile zones, job/priority overlays, room-quality overlay, path previews, schedules, and a **scrubbable event timeline** where each story beat expands to its evidence chain (E5).
- **Story beats get strong visual hierarchy** with character references and consequences shown — never a raw task table or generic agent grid as the primary experience (explicit non-goal).

## E8. The adversarial / edge-case scenario pack (ship the hard cases as fixtures)

Concrete, seeded, deterministically-asserted situations — the difference between a colony sim and a base-builder with flavor text:

- **Priority override:** a skilled builder with passion *skips* construction because hunger + storm-fear thoughts push those needs' urgency above the build's utility — assert the scored trace shows exactly why, and that lowering hunger restores the build choice.
- **Social tragedy under pressure:** two colonists with a low-opinion edge fight during a food shortage and injure the doctor; assert the fight is caused by (opinion edge + stress thoughts + seeded roll), the doctor's injury propagates to a medical-capacity problem, and the timeline links it all.
- **Environment cascade:** a cramped, dirty, dark barracks lowers sleep quality → "slept in poor environment" thoughts stack → mood crosses the minor-break band → slower work → backlog. Assert the *numeric* path from room score to break-band crossing.
- **Costly celebration:** a party raises morale (positive thoughts) but consumes scarce food and delays a defensive build, worsening the next storyteller threat — assert the tradeoff is real, not cosmetic.
- **Backlog → crisis replay:** a logistics shortfall produces a work backlog that, under storyteller pressure, tips into a social crisis; assert the *replay* reproduces the exact decision sequence and the timeline pinpoints the tipping tick.
- **Determinism stressors:** snapshot/restore mid-storm with identical continuation; two runs from one seed with byte-identical decision logs; a tie-break stress case (two equally-good jobs, two equally-near haulers) that must resolve identically every run.
- **Mental-break-band fuzz:** randomized thought stacks asserting the break-band relationship (a colonist whose summed thoughts sit below the 1/7 extreme threshold reaches extreme-break risk; one just above the 4/7 line does not) — the mood model's invariant, fuzzed.

## E9. Global invariants (property-based — this is how the colony is graded)

Across randomized + scripted runs, assert properties, not just examples:

1. **Determinism** — equal `(seed, command log)` ⇒ byte-identical decision logs, story-beat sequences, and checkpoint hashes, including across a snapshot/restore boundary.
2. **Decision totality + groundedness** — *every* colonist action has a non-empty reasoning trace terminating in needs/traits/memories/environment facts; no action without a scored cause.
3. **Story groundedness** — *every* story beat has a non-empty evidence chain into simulation facts; redact the prose and the structured record alone must still explain the beat.
4. **Mood = Σ(thoughts)** — mood always equals baseline + the sum of active thought offsets; no hidden mood term, and removing a thought changes mood by exactly its offset.
5. **Break-band monotonicity** — break *risk* is monotone in low mood (lower mood ⇒ same-or-higher break severity band); thresholds scale only by documented trait modifiers.
6. **Conservation of items/labor** — items are conserved across hauling/crafting/consumption (inputs+outputs balance per recipe; nothing minted by bookkeeping); a colonist-hour is spent on exactly one job at a time.
7. **Relationship/memory causality** — every opinion delta and new memory traces to a specific interaction event; opinions don't drift without a cause.

Plus a **chaos mode**: kill and restore from snapshot mid-crisis, reorder independent same-tick decisions (must not change outcome given the ordering rule), and run extreme inputs (zero food, all-incompatible traits) asserting graceful, conserved, still-explainable degradation rather than crashes or ungrounded behavior.

## E10. The concrete first vertical slice (the on-ramp — build THIS first, ~45–60 cards)

Do **not** spread the first release across all systems shallowly. Prove the spine with the **seed colony** (five colonists, incompatible traits, scarce food, unfinished shelter, a work-priority conflict, a social crisis during a storm) end-to-end:

- The **deterministic agent kernel** (E1): fixed-tick clock, seeded PRNG tree, deterministic tie-breaking, command log, state checksum, snapshot/restore.
- The **utility/needs AI** (E2) with reasoning traces — enough to drive the "hungry builder abandons construction" scenario with a visible scored trace.
- The **RimWorld-grounded mood + mental-break model** (E3) with stacking thoughts and the threshold bands, driving the "barracks → mood collapse" cascade numerically.
- The **structured social graph + memory** (E4) and **storyteller pressure** (E5) sufficient to fire the "bad-memory fight during food shortage injures the doctor" beat with its evidence chain.
- **Construction/logistics + deterministic pathfinding** (E6) sufficient to produce a real work backlog.
- **Presentation** (E7): the inhabited colony view + the **character inspector with the mood breakdown and current-plan trace** + the map overlays + the scrubbable timeline whose beats expand to evidence.
- The **replay test** proving the backlog → social-crisis cascade reproduces exactly and the timeline pinpoints the tipping tick, with all global invariants holding through one snapshot/restore.

If that slice is real — five colonists whose every breakdown, fight, and bad decision you can *replay and explain from facts* — every later system (more jobs, threats, story beats, larger colonies) is breadth on a proven spine. If it isn't, no amount of portrait art saves it.

## E11. Domain knowledge-debt to track (surface, don't bluff)

Each item gets an owner, a risk note, and an **expert-review-needed/designer-review** flag:

- **Mood/break tuning** — the threshold bands and thought offsets are starting points modeled on RimWorld; flag for a designer balance pass and never present them as fixed truth.
- **Utility-curve + advertisement tuning** — need urgency curves and object advertisements determine *all* behavior; document them as data and mark for tuning.
- **Pathfinding performance** — A*/JPS cost scales with map size and hauler count; record the resolution/colony-size performance budget and the deterministic tie-break rule chosen.
- **Story-beat coverage limits** — the first slice covers a handful of incident archetypes; mark uncovered scenarios as future content, not as shipped.
- **Fixture realism** — seeded trait/event packs are *plausible*, not exhaustive; name them as adapters.
- **Accessibility** — overlays and status must not rely on color alone; mood-breakdown text must be screen-reader legible (tracked debt).

## E12. Why this is a great !Klein challenge

It stresses precisely what !Klein must prove with small local models: **deep, dependency-ordered decomposition** (needs/mood/social/storyteller/logistics are tightly coupled and *must* be built core-and-invariants-first, before any rendering depends on them), **determinism under weak authorship** (the agents cannot fudge tie-breaking, float drift, or nondeterministic iteration — the replay and decision-log invariants catch it immediately), **explainable reasoning as a build requirement** (every decision and story beat must be evidence-grounded, mirroring !Klein's own evidence discipline — a model that bluffs a story beat fails the groundedness invariant), and **long-running stateful correctness** (event-sourced colonies with snapshot/restore and scrub-to-the-tick replay). The payoff is a joy to watch: a swarm of small models composing a *living colony* whose tragedies — the doctor injured in a brawl during a famine — are always replayable and always explainable from facts. Build the kernel + utility-AI + mood model + one social-crisis slice (E1–E3, E10) first; earn the rest.
