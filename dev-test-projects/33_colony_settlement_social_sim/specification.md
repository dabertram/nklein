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

---

## Small-model build guide (3B-ready)

> This section exists so a ~3B local model can follow the spec mechanically. Every card below is independently implementable and verifiable with `npm test`. The 3B must **follow** these instructions, not reason about them.

### 1. Glossary & ground rules

**Domain terms**

| Term | Meaning in this project |
|---|---|
| Tick | One fixed simulation step = 1 in-game hour. Schedules, need decay, and pathfinding all read the injected tick counter. |
| FP | Fixed-point integer. Use `Q8` = integer × 256. All needs, mood, skill XP, and work progress are FP integers, never raw floats. |
| Seed | A 32-bit unsigned integer. All randomness derives from it. Same seed + same commands = same output, always. |
| Checksum | A hash of the full simulation state at a tick. Two runs from the same seed must produce identical checksums. |
| Snapshot | A serialized copy of state, used to restore mid-run. |
| Command log | The ordered list of player commands. Replay = fold command log over initial state. |
| Need | A colonist attribute that decays over time (e.g. `hunger`, `rest`, `social`). Modeled as a FP value 0–100. |
| Urgency | How pressing a need is — a number 0–100 derived from how low the need level is. High urgency = colonist wants to satisfy it. |
| Advertisement | How much satisfaction a job/object promises for each need. Job scores = Σ(urgency × advertisement). |
| Moodlet / Thought | A discrete, time-limited mood modifier. Mood = baseline + Σ(active thoughts). Each thought has a signed offset and a duration in ticks. |
| Mood | A FP value 0–100. Baseline = 50. Mental-break bands: minor risk < 35, major risk < 20, extreme risk < 7. |
| Mental break | A colonist behavior caused by low mood. Fires probabilistically based on how far below a band the colonist is. |
| Relationship edge | A directed, weighted (opinion) edge between two colonists. Feeds social thought offsets. |
| Memory | A structured record `{eventRef, tick, valence, participants, decayTick}`. Queryable by storyteller and inspector. |
| Storyteller | The system that decides when to fire incidents. Reads colony wealth to budget pressure. |
| Reasoning trace | The scored list of job/action candidates considered by the utility-AI. Rendered in the character inspector. |
| Pathfinding | A* on the tile grid with a documented deterministic tie-break. |
| Work order | A typed task generated by a blueprint or craft recipe: `{type, targetTile, requiredMaterials, assignedColonist}`. |

**Stack**

- Language: TypeScript (strict mode, no `any`)
- Runtime: Node.js 20+
- Test runner: `npm test` runs `vitest run`
- Key math helper: `src/fp.ts` — all FP arithmetic (same Q8 pattern as described; see `C02`)
- Key PRNG: `src/prng.ts` — xorshift32, one per named stream (see `C03`)
- File layout: `src/` for simulation core, `test/` for tests, `src/renderer/` for presentation, `src/adapters/` for fixture stubs

**Ground rules (imperative)**

1. Never call `Date.now()`, `Math.random()`, `setTimeout`, or `setInterval` inside `src/` core modules.
2. All needs, mood offsets, skill XP, and work progress are FP integers (Q8 scale). Never store them as raw `number` floats in the simulation state.
3. Process colonists, jobs, and items in ascending stable-id order. Never iterate a `Map` or `Set` for order-sensitive tie-breaking.
4. Every test must be self-contained. No network calls, no file I/O beyond `test/fixtures/`.
5. `npm test` must pass offline. No live LLM, no wall-clock randomness.
6. Stubs for renderer and live integrations go in `src/adapters/` with a deterministic fixture implementation alongside.
7. Acceptance = `npm test` green. Run after every card.

---

### 2. The explicit task graph for the first vertical slice

The first slice targets **E1 (kernel) + E2 (utility/needs AI with reasoning traces) + E3 (mood + mental-break model) + E4 (social graph + memory) + E5 (storyteller pressure) + E6 (construction/logistics + pathfinding) + replay test proving the backlog→social-crisis cascade**. No full renderer cards; the character inspector is part of the slice as a data structure (not a polished UI).

Cards are in strict dependency order.

---

**`C01` — Project scaffold and TypeScript config**
dependsOn: none
files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`
interface:
```ts
// src/types.ts
export type FP = number;       // Q8 integer: value × 256
export type Tick = number;     // non-negative integer
export type Seed = number;     // uint32
export type EntityId = number; // stable, monotonically assigned, never reused
export type TileIndex = number;// row-major grid index
```
how to implement: same scaffold pattern as any vitest/TypeScript project. `"test": "vitest run"` in `package.json`. `"strict": true` in `tsconfig.json`.
acceptance: `npm test` exits 0 (zero test files → vitest warns but exits 0). `tsc --noEmit` has no errors.

---

**`C02` — Fixed-point arithmetic helpers (Q8)**
dependsOn: `C01`
files: `src/fp.ts`, `test/fp.test.ts`
interface:
```ts
// src/fp.ts — Q8: integer × 256
export const FP_SCALE = 256;
export function toFP(n: number): FP      // Math.round(n * FP_SCALE)
export function fromFP(fp: FP): number   // fp / FP_SCALE
export function fpAdd(a: FP, b: FP): FP
export function fpSub(a: FP, b: FP): FP  // throws "Conservation violated" if result < 0
export function fpMul(a: FP, b: FP): FP  // Math.trunc((a * b) / FP_SCALE)
export function fpClamp(v: FP, lo: FP, hi: FP): FP
export function fpPercent(v: FP, total: FP): FP  // v * 100 / total, Q8 result
```
how to implement: integer arithmetic only. `fpSub` throws if `a < b`.
acceptance: `test/fp.test.ts` asserts `fromFP(toFP(50)) ≈ 50`; `fpAdd(toFP(1), toFP(2))` equals `toFP(3)`; `fpSub(toFP(1), toFP(2))` throws; `fpMul(toFP(0.5), toFP(10))` equals `toFP(5)`. `npm test` green.

---

**`C03` — Seeded PRNG tree**
dependsOn: `C01`
files: `src/prng.ts`, `test/prng.test.ts`
interface:
```ts
// src/prng.ts
export type PrngStream = { name: string; state: number };
export type PrngTree = {
  jobTieBreak: PrngStream;
  socialOutcome: PrngStream;
  storyteller: PrngStream;
  traitExpression: PrngStream;
  mentalBreak: PrngStream;
};
export function createPrngTree(rootSeed: Seed): PrngTree
export function nextUint32(stream: PrngStream): number
export function nextIntBelow(stream: PrngStream, n: number): number  // [0, n)
```
how to implement: xorshift32 per stream, seeded from `rootSeed + streamIndex` (0=jobTieBreak, 1=socialOutcome, …).
acceptance: two `createPrngTree(7)` produce same 100 values from `socialOutcome`. Different streams differ. `nextIntBelow(stream, 10)` always in `[0, 9]`. `npm test` green.

---

**`C04` — Colonist model and stable-id registry**
dependsOn: `C01`, `C02`
files: `src/colonist.ts`, `test/colonist.test.ts`
interface:
```ts
// src/colonist.ts
export type Trait = "kind" | "volatile" | "industrious" | "lazy" | "pessimist";
export type Skill = "construction" | "hauling" | "medicine" | "cooking";
export type Colonist = {
  id: EntityId;
  name: string;
  traits: Trait[];
  skills: Record<Skill, FP>;   // XP level, Q8
  needs: Record<NeedId, FP>;   // current level 0–100 Q8
  mood: FP;                    // 0–100 Q8
  activeThoughts: Thought[];   // see C06
  relationshipEdges: RelationshipEdge[]; // see C08
  memories: Memory[];          // see C08
  currentPlan: ReasoningTrace | null;
};
export type NeedId = "hunger" | "rest" | "recreation" | "social" | "safety";
export function createColonist(id: EntityId, name: string, traits: Trait[]): Colonist
export function nextEntityId(registry: EntityId[]): EntityId  // max(registry) + 1, or 1 if empty
```
how to implement: all needs initialize to `toFP(80)` (80% satisfied). `mood = toFP(50)` (baseline). `skills` all `toFP(0)`. `traits` stored as-is. `currentPlan = null`.
acceptance: `test/colonist.test.ts` asserts `createColonist` sets `mood === toFP(50)`, all needs at `toFP(80)`, `currentPlan === null`. `nextEntityId([1,2,3])` returns 4. `npm test` green.

---

**`C05` — Need decay and urgency curve**
dependsOn: `C02`, `C04`
files: `src/needs.ts`, `test/needs.test.ts`
interface:
```ts
// src/needs.ts
export const NEED_DECAY: Record<NeedId, FP> = {
  hunger:     toFP(0.5),   // per tick
  rest:       toFP(0.3),
  recreation: toFP(0.1),
  social:     toFP(0.08),
  safety:     toFP(0),     // set by events, not decay
};
export function decayNeeds(colonist: Colonist, ticks: number): Colonist
  // For each need: need = fpClamp(fpSub(need, fpMul(decay, toFP(ticks))), toFP(0), toFP(100))
export function urgency(needLevel: FP): FP
  // Returns 0–100 Q8. Formula: (toFP(100) - needLevel) squared / toFP(100)
  // At 100% satisfied → urgency 0. At 0% satisfied → urgency 100.
export function mostUrgentNeed(colonist: Colonist): NeedId
  // Returns the NeedId with the highest urgency(need). Tie-break: alphabetical order of NeedId.
```
how to implement: `decayNeeds` returns a new `Colonist` (immutable). Needs cannot go below 0. `urgency` is a pure FP function — no floats.
acceptance: `test/needs.test.ts` asserts: after 100 ticks `hunger` decreases by `100 × toFP(0.5) / FP_SCALE`; `urgency(toFP(100))` equals `toFP(0)`; `urgency(toFP(0))` equals `toFP(100)`; `mostUrgentNeed` resolves ties alphabetically; `decayNeeds` does not mutate input. `npm test` green.

---

**`C06` — Thought/moodlet model and mood computation**
dependsOn: `C02`, `C04`, `C05`
files: `src/mood.ts`, `test/mood.test.ts`
interface:
```ts
// src/mood.ts
export type Thought = {
  id: string;       // e.g. "ate_without_table", "slept_in_barracks"
  offset: FP;       // signed mood delta, Q8 (negative = bad, positive = good)
  expiresAtTick: Tick;
};
export function computeMood(colonist: Colonist, tick: Tick): FP
  // baseline toFP(50) + sum of active (non-expired) thought offsets, clamped to [0, 100]
export function addThought(colonist: Colonist, thought: Thought): Colonist
  // Appends thought to activeThoughts; removes expired thoughts (expiresAtTick <= tick)
export function pruneExpiredThoughts(colonist: Colonist, tick: Tick): Colonist
export type MentalBreakBand = "none" | "minor" | "major" | "extreme";
export function breakBand(moodFP: FP): MentalBreakBand
  // none if >= toFP(35), minor if >= toFP(20), major if >= toFP(7), extreme if < toFP(7)
export function rollMentalBreak(band: MentalBreakBand, prng: PrngStream, tick: Tick): boolean
  // none → false always
  // minor → true if nextIntBelow(prng, 2400) === 0 (approx 1/2400 per tick ≈ 1 per 100 hours)
  // major → true if nextIntBelow(prng, 720) === 0
  // extreme → true if nextIntBelow(prng, 168) === 0
```
how to implement: `computeMood` sums `offset` for all `thought.expiresAtTick > tick`. Clamp result. `addThought` prunes expired first, then appends. `breakBand` is a pure function on a FP value.
acceptance: `test/mood.test.ts` asserts:
- `computeMood` with no thoughts = `toFP(50)`.
- Adding `{offset: toFP(-10), expiresAtTick: 999}` gives mood `toFP(40)` (at tick < 999).
- Adding `{offset: toFP(-30), expiresAtTick: 999}` gives mood `toFP(20)` → `breakBand === "major"`.
- An expired thought is ignored.
- `breakBand(toFP(6))` returns `"extreme"`.
- `rollMentalBreak("none", prng, 0)` always false.
- `npm test` green.

---

**`C07` — Utility-AI job scoring and reasoning trace**
dependsOn: `C02`, `C04`, `C05`, `C06`
files: `src/utility_ai.ts`, `test/utility_ai.test.ts`
interface:
```ts
// src/utility_ai.ts
export type JobAdvertisement = {
  jobId: string;
  needSatisfaction: Partial<Record<NeedId, FP>>;  // how much each need is satisfied on completion
  distanceCost: FP;   // penalty for distance in FP units
  skillRequirement: Skill | null;
};
export type ScoredCandidate = {
  jobId: string;
  score: FP;
  breakdown: string;  // human-readable, e.g. "hunger:urgency=80*adv=60=4800 rest:0 dist_penalty=-10 total=4790"
};
export type ReasoningTrace = {
  winnerId: string;
  candidates: ScoredCandidate[];
  tick: Tick;
};
export function scoreJob(colonist: Colonist, job: JobAdvertisement, tick: Tick): ScoredCandidate
  // score = Σ(urgency(need) * needSatisfaction[need]) - distanceCost
  // breakdown describes each need's contribution
export function selectJob(colonist: Colonist, jobs: JobAdvertisement[], tick: Tick, prng: PrngStream): ReasoningTrace
  // Score all jobs. Winner = highest score. Tie-break: nextIntBelow(prng, tied_jobs.length) index into alphabetically-sorted tied ids.
  // Returns full ReasoningTrace (all candidates + winner).
```
how to implement: `scoreJob` iterates needs in alphabetical order (determinism). The tie-break uses `prng.jobTieBreak` stream. Build `breakdown` string from the contributions.
acceptance: `test/utility_ai.test.ts` asserts:
- A colonist with `hunger = toFP(0)` (starving) scores the `eat` job higher than `sleep` or `build`.
- A colonist with `hunger = toFP(100)`, `rest = toFP(0)` scores `sleep` job highest.
- Two runs with same seed pick the same job on a tie.
- `selectJob` returns a `ReasoningTrace` with `candidates.length === jobs.length`.
- `breakdown` string contains the hunger urgency and advertisement values.
- `npm test` green.

---

**`C08` — Social graph and memory model**
dependsOn: `C01`, `C02`, `C04`
files: `src/social.ts`, `test/social.test.ts`
interface:
```ts
// src/social.ts
export type RelationshipEdge = {
  toColonistId: EntityId;
  opinion: FP;      // -100 to +100 Q8. Positive = favorable.
  kind: "neutral" | "friend" | "rival";
};
export type Memory = {
  eventRef: string;        // e.g. "fight_tick_300"
  valence: FP;             // signed FP
  participantIds: EntityId[];
  createdTick: Tick;
  decayTick: Tick;
};
export function getOrCreateEdge(edges: RelationshipEdge[], toId: EntityId): RelationshipEdge
export function applyOpinionDelta(edge: RelationshipEdge, delta: FP): RelationshipEdge
  // opinion += delta, clamp to [-100, 100]
export function kindFromOpinion(opinion: FP): "neutral" | "friend" | "rival"
  // friend if opinion > toFP(40), rival if < toFP(-30), else neutral
export type SocialInteractionResult = {
  opinionDelta: FP;
  newMemory: Memory;
  isFight: boolean;
};
export function resolveSocialInteraction(
  initiator: Colonist,
  target: Colonist,
  tick: Tick,
  prng: PrngStream,  // socialOutcome stream
): SocialInteractionResult
  // isFight: true if initiator.opinion < toFP(-30) AND nextIntBelow(prng, 100) < 40 (40% chance)
  // opinionDelta: +toFP(5) if not fight; -toFP(15) if fight
  // newMemory: {eventRef: `interaction_${tick}`, valence: isFight ? toFP(-20) : toFP(5), ...}
```
how to implement: all FP. `applyOpinionDelta` clamps to `[-toFP(100), toFP(100)]`. `resolveSocialInteraction` draws one value from the `socialOutcome` stream; same seed = same fight outcome.
acceptance: `test/social.test.ts` asserts:
- `kindFromOpinion(toFP(50))` is `"friend"`.
- `kindFromOpinion(toFP(-50))` is `"rival"`.
- Two calls to `resolveSocialInteraction` with same colonist opinions, same seed → same `isFight`.
- A fight creates a memory with negative `valence`.
- `applyOpinionDelta` beyond ±100 is clamped.
- `npm test` green.

---

**`C09` — Simulation clock and tick driver**
dependsOn: `C01`
files: `src/clock.ts`, `test/clock.test.ts`
interface:
```ts
// src/clock.ts
export type SimClock = { tick: Tick; hour: number; day: number; season: "spring"|"summer"|"autumn"|"winter" };
export const TICKS_PER_HOUR = 1;
export const TICKS_PER_DAY = 24;
export const TICKS_PER_SEASON = 2160; // 90 days
export function createClock(): SimClock
export function advanceClock(clock: SimClock): SimClock  // immutable, returns new clock
```
how to implement: `advanceClock` increments `tick` and derives `hour = tick % 24`, `day = Math.trunc(tick / 24) % 90`, `season` from `Math.trunc(tick / 2160) % 4` → 0=spring,1=summer,2=autumn,3=winter.
acceptance: after 24 advances, `clock.day === 1`; after 2160 advances, `clock.season === "summer"`. Immutability: input unchanged. `npm test` green.

---

**`C10` — Command log and event-sourcing core**
dependsOn: `C01`, `C02`, `C04`
files: `src/commands.ts`, `test/commands.test.ts`
interface:
```ts
// src/commands.ts
export type Command =
  | { type: "setWorkPriority"; colonistId: EntityId; skill: Skill; priorityFP: FP; tick: Tick }
  | { type: "drawBlueprint"; tileIndex: TileIndex; buildingType: string; tick: Tick }
  | { type: "setSchedule"; colonistId: EntityId; hourStart: number; hourEnd: number; activity: string; tick: Tick };
export type CommandLog = Command[];
export function appendCommand(log: CommandLog, cmd: Command): CommandLog
export function commandsAtTick(log: CommandLog, tick: Tick): Command[]
```
how to implement: `appendCommand` returns `[...log, cmd]`. `commandsAtTick` filters by `cmd.tick === tick`.
acceptance: `appendCommand` does not mutate original. Filtering by tick returns correct subset. `npm test` green.

---

**`C11` — Pathfinding (A* with deterministic tie-break)**
dependsOn: `C01`, `C04`
files: `src/pathfinding.ts`, `test/pathfinding.test.ts`
interface:
```ts
// src/pathfinding.ts
export type MapGrid = { width: number; height: number; walkable: boolean[] };
export type Path = TileIndex[];  // ordered tile indices from start to goal, inclusive
export function findPath(grid: MapGrid, from: TileIndex, to: TileIndex): Path | null
  // A* on 4-connected grid.
  // Heuristic: Manhattan distance.
  // Tie-break: among equal f-score nodes, expand the one with the lower TileIndex.
  // Returns null if no path exists.
export function pathDistance(path: Path): number  // path.length - 1 (number of steps)
```
how to implement: standard A* with a priority queue (min-heap or sorted array). The tie-break (`lower TileIndex` wins) must be applied consistently — this is the determinism guarantee. Use a plain array for open set, sort by `f` then by `tileIndex`.
acceptance: `test/pathfinding.test.ts` asserts:
- Straight corridor of 5 tiles: `findPath` returns path of length 5.
- Blocked corridor: `findPath` returns `null`.
- Two calls on same grid/from/to produce identical paths (determinism — no tie-break ambiguity).
- `pathDistance([0,1,2,3])` equals 3.
- `npm test` green.

---

**`C12` — Work order system and job queue**
dependsOn: `C01`, `C02`, `C04`, `C10`, `C11`
files: `src/workorders.ts`, `test/workorders.test.ts`
interface:
```ts
// src/workorders.ts
export type WorkOrder = {
  id: EntityId;
  type: "haul" | "construct" | "cook" | "mine";
  targetTile: TileIndex;
  requiredSkill: Skill | null;
  progressFP: FP;     // 0–100 FP: how much work has been done
  totalWorkFP: FP;    // FP units of work required to complete
  assignedColonistId: EntityId | null;
};
export type WorkQueue = WorkOrder[];
export function createWorkOrder(id: EntityId, type: WorkOrder["type"], targetTile: TileIndex, totalWorkFP: FP): WorkOrder
export function assignOrder(queue: WorkQueue, orderId: EntityId, colonistId: EntityId): WorkQueue
export function progressOrder(queue: WorkQueue, orderId: EntityId, workDoneFP: FP): WorkQueue
  // progressFP += workDoneFP; clamp to totalWorkFP
export function isComplete(order: WorkOrder): boolean  // progressFP >= totalWorkFP
export function pendingOrders(queue: WorkQueue): WorkOrder[]  // progressFP < totalWorkFP
```
how to implement: all immutable returns. `progressOrder` finds the order by id, returns a new queue with the updated order. Never modify in place.
acceptance: `test/workorders.test.ts` asserts: `isComplete` when `progressFP === totalWorkFP`; `pendingOrders` excludes completed; `assignOrder` does not mutate the original queue. `progressOrder` beyond `totalWorkFP` is clamped. `npm test` green.

---

**`C13` — Storyteller pressure budget**
dependsOn: `C01`, `C02`, `C03`, `C04`
files: `src/storyteller.ts`, `test/storyteller.test.ts`
interface:
```ts
// src/storyteller.ts
export type ColonyWealthSnapshot = {
  buildingCount: number;
  colonistCount: number;
  foodStockFP: FP;
  recentDeathCount: number;  // in last 720 ticks
};
export type Incident = {
  type: "raid" | "illness" | "trade" | "accident" | "celebration" | "breakdown";
  intensityFP: FP;  // 0–100 FP
  evidenceRefs: string[];  // which colony state facts drove this
};
export function computePressureBudget(wealth: ColonyWealthSnapshot): FP
  // budget = toFP(wealth.buildingCount * 5 + wealth.colonistCount * 10) - toFP(wealth.recentDeathCount * 20)
  // clamp to [toFP(0), toFP(200)]
export function selectIncident(
  budget: FP,
  wealth: ColonyWealthSnapshot,
  tick: Tick,
  prng: PrngStream,  // storyteller stream
): Incident
  // Select incident type based on wealth state:
  // - foodStockFP < toFP(20): illness or breakdown (50/50 from prng)
  // - budget > toFP(100): raid
  // - else: trade or accident (50/50 from prng)
  // intensityFP = fpMul(budget, toFP(0.5))
  // evidenceRefs: list the colony state facts that drove the selection (e.g. ["foodStock_low", "budget_high"])
```
how to implement: all FP. `selectIncident` draws one value from the storyteller stream for any 50/50 choice. `evidenceRefs` is a string array naming the actual state conditions checked.
acceptance: `test/storyteller.test.ts` asserts:
- `computePressureBudget({buildingCount:10, colonistCount:5, foodStockFP:toFP(100), recentDeathCount:0})` > `toFP(0)`.
- With `foodStockFP < toFP(20)`, `selectIncident` returns `illness` or `breakdown` (never `raid`).
- `evidenceRefs` is non-empty.
- Two calls with same seed pick same incident type.
- `npm test` green.

---

**`C14` — SimState, checksum, and snapshot/restore**
dependsOn: `C01`–`C13`
files: `src/snapshot.ts`, `test/snapshot.test.ts`
interface:
```ts
// src/snapshot.ts
export type SimState = {
  clock: SimClock;
  colonists: Colonist[];      // sorted by id
  workQueue: WorkQueue;
  commandLog: CommandLog;
  prngTree: PrngTree;
  incidents: Incident[];      // fired incidents, append-only
};
export function checksumState(state: SimState): string
  // djb2 hash of JSON.stringify({tick, colonist_moods, work_pending_count, incident_count})
export function takeSnapshot(state: SimState): string  // JSON.stringify(state)
export function restoreSnapshot(snap: string): SimState // JSON.parse(snap)
```
how to implement: `checksumState` hashes a minimal projection. `takeSnapshot`/`restoreSnapshot` are JSON round-trips (all values are FP integers, serialize cleanly).
acceptance: `checksumState` is deterministic (same result twice). `restoreSnapshot(takeSnapshot(state))` produces same checksum. `npm test` green.

---

**`C15` — Seed colony fixture: five colonists, food shortage, social crisis**
dependsOn: `C01`–`C14`
files: `src/scenarios/seed_colony.ts`, `test/seed_colony.test.ts`
interface:
```ts
// src/scenarios/seed_colony.ts
export type ScenarioResult = {
  checksums: string[];           // one per 24-tick (day) checkpoint
  incidentLog: Array<{ tick: Tick; type: string; cause: string }>;
  colonistDecisionLog: Array<{ colonistId: EntityId; tick: Tick; winnerId: string; trace: ReasoningTrace }>;
};
export function runSeedColonyScenario(seed: Seed, days: number): ScenarioResult
// Colony setup:
//   5 colonists: ids 1–5; colonist 3 has skill medicine=toFP(80), colonist 1 has trait "volatile"
//   colonist 1 and 2 have opinion edge: opinion=-toFP(40) (rivals)
//   initial foodStock = toFP(15) (scarce — triggers illness/breakdown storyteller branch)
//   work queue: one construct order (totalWork=toFP(50)), one cook order (totalWork=toFP(20))
// Simulate `days` days (each day = 24 ticks):
//   - Decay all colonist needs each tick
//   - Select jobs via utility-AI each tick; record decision if winner changes
//   - Run social interactions if two colonists are on the same tile (simplified: pairs checked each tick)
//   - Compute mood for all colonists; roll for mental break on extreme band
//   - Run storyteller every 720 ticks (30 days)
//   - Record checksum each 24 ticks
```
how to implement: wire all prior modules. The story of "rival colonists fight, injuring the doctor" should emerge naturally if the `resolveSocialInteraction` fight path fires (colonist 1 with volatile trait has a mood modifier — add thought `{id: "volatile_temper", offset: toFP(-5), expiresAtTick: Infinity}` for colonist 1 from the start). Simulate and record.
acceptance: `test/seed_colony.test.ts` asserts:
- `runSeedColonyScenario(42, 60)` completes without error.
- `result.checksums` has 60 entries.
- Two calls with seed=42 produce identical `checksums`.
- `result.incidentLog` is non-empty (at least one incident fires in 60 days).
- `result.colonistDecisionLog` contains at least one entry where the `hunger` job wins over a `construct` job.
- `npm test` green.

---

**`C16` — Replay determinism and backlog→crisis test**
dependsOn: `C15`, `C14`
files: `test/replay_determinism.test.ts`
interface: (test file only)
how to implement:
1. Run `runSeedColonyScenario(42, 60)` twice. Assert all 60 checksums are identical.
2. Mid-run snapshot/restore: run 30 days, take snapshot, run 30 more → checksums[30..59]. Restore snapshot, run 30 more → assert checksums[30..59] match.
3. Assert the `colonistDecisionLog` records at least one `construct` job assignment and at least one tick where the builder switched away from `construct` (decision changed from prior tick) because a higher-urgency need won.
4. Assert that `incidentLog` events have non-empty `cause` strings.
acceptance: all assertions green, `npm test` green.

---

### Summary of first-slice cards

| id | title |
|---|---|
| C01 | Project scaffold and TypeScript config |
| C02 | Fixed-point arithmetic helpers (Q8) |
| C03 | Seeded PRNG tree |
| C04 | Colonist model and stable-id registry |
| C05 | Need decay and urgency curve |
| C06 | Thought/moodlet model and mood computation |
| C07 | Utility-AI job scoring and reasoning trace |
| C08 | Social graph and memory model |
| C09 | Simulation clock and tick driver |
| C10 | Command log and event-sourcing core |
| C11 | Pathfinding (A* with deterministic tie-break) |
| C12 | Work order system and job queue |
| C13 | Storyteller pressure budget |
| C14 | SimState, checksum, and snapshot/restore |
| C15 | Seed colony fixture |
| C16 | Replay determinism and backlog→crisis test |

**16 first-slice cards.**

---

### 3. The decomposition method for the rest

After the first slice passes, expand features using this recipe:

**Step 1 — Identify the new system's invariant (what must always be true).**
Example: room evaluation → invariant: room score is a pure function of tile state, never a manually-maintained value.

**Step 2 — Types-and-interface card first.**
One small card producing the types and function signatures only. No implementation logic yet.

**Step 3 — Pure-function implementation card.**
Implement the logic. No I/O, no `Math.random()`, no floats for FP quantities.

**Step 4 — Conservation/invariant test card.**
Assert the invariant holds before and after a step. Include at least one property test (fuzz inputs).

**Step 5 — Wire into SimState and the tick loop.**
Add the new state field to `SimState`, call the new step in the tick loop, ensure `checksumState` covers it.

**Step 6 — Scenario fixture card.**
A function in `src/scenarios/` that drives the mechanic to the expected outcome and records events.

---

**Worked example 1: Room quality evaluation**
- `R01` — `src/room.ts` types: `RoomScore {beauty: FP, crowding: FP, cleanliness: FP, overall: FP}`. Function `evaluateRoom(tiles: Tile[], occupants: number): RoomScore`. dependsOn: C02, C04.
- `R02` — Implement `evaluateRoom`: `beauty = mean(tile.aesthetics)`, `crowding = fpMul(toFP(occupants / tiles.length), toFP(100))`, `overall = (beauty + cleanliness - crowding) / 3`. All FP. dependsOn: R01.
- `R03` — Test: a 4-tile room with 8 occupants has `crowding === toFP(200)` (overcrowded); `overall` of an empty beautiful room > `toFP(50)`. dependsOn: R02.
- `R04` — Add `roomScores: Map<string, RoomScore>` to `SimState`; compute in tick loop from tile state; wire `computeMood` to add `"slept_in_poor_room"` thought when `overall < toFP(30)`. dependsOn: R03, C14.

**Worked example 2: Construction logistics**
- `L01` — `src/logistics.ts` types: `ItemStack {itemType: string; countFP: FP}`, `Stockpile {tileIndex: TileIndex; stacks: ItemStack[]}`. dependsOn: C01, C02.
- `L02` — Implement `haulItem(from: Stockpile, to: Stockpile, itemType: string, amountFP: FP)`: deducts from source (fpSub — throws if insufficient), adds to destination. Conservation: items are never minted. dependsOn: L01.
- `L03` — Test: hauling more than available throws "Conservation violated". Hauling 10 units moves exactly 10. dependsOn: L02.
- `L04` — `generateHaulOrders(workQueue, stockpiles)`: for each pending construct order, create haul orders for missing materials. Wire into job pool for utility-AI to score. dependsOn: L03, C12.

**Worked example 3: Storyteller incident — celebration**
- `ST01` — `src/incidents/celebration.ts`: `fireCelebration(state: SimState, prng: PrngStream, tick: Tick): SimState`. Consumes `toFP(5)` food from the stockpile (fpSub — throws if insufficient), adds positive thought `{id: "celebrated", offset: toFP(15), expiresAtTick: tick + 720}` to all colonists. Returns new state. dependsOn: C06, C13, C14.
- `ST02` — Test: after `fireCelebration`, all colonists have `"celebrated"` thought; food stock decreased by `toFP(5)`; mood of all colonists increased. dependsOn: ST01.
- `ST03` — Scenario fixture: run 10 days, fire celebration, assert colony morale rises, then verify next storyteller selection sees elevated wealth (morale boost → higher pressure budget). dependsOn: ST02.

---

### 4. Per-task implementation conventions

**File/folder layout**
```
src/
  types.ts          — FP, Tick, Seed, EntityId, TileIndex
  fp.ts             — fixed-point math (Q8)
  prng.ts           — PRNG tree
  colonist.ts       — Colonist, NeedId, Trait, Skill
  needs.ts          — need decay, urgency curve
  mood.ts           — Thought, computeMood, breakBand, rollMentalBreak
  utility_ai.ts     — JobAdvertisement, scoreJob, selectJob, ReasoningTrace
  social.ts         — RelationshipEdge, Memory, resolveSocialInteraction
  clock.ts          — SimClock, advanceClock
  commands.ts       — Command, CommandLog
  pathfinding.ts    — A* with deterministic tie-break
  workorders.ts     — WorkOrder, WorkQueue
  storyteller.ts    — pressure budget, selectIncident
  snapshot.ts       — SimState, checksum, snapshot/restore
  scenarios/        — one file per scenario
  adapters/         — renderer stub, live-data stubs
test/
  *.test.ts         — vitest tests mirroring src/ names
  fixtures/         — static JSON seed files for golden tests
```

**Naming**
- All FP variables end in `FP` (e.g., `hungerFP`) when the name would otherwise imply a float.
- Immutable-update functions return a new value, never modify in place.
- `PrngStream` is always an explicit argument — never module-level state.

**Writing a test (vitest snippet)**
```ts
// test/mood.test.ts
import { describe, it, expect } from "vitest";
import { toFP, fromFP } from "../src/fp.js";
import { computeMood, addThought, breakBand } from "../src/mood.js";
import { createColonist } from "../src/colonist.js";

describe("mood computation", () => {
  it("baseline mood with no thoughts is 50", () => {
    const c = createColonist(1, "Alice", []);
    expect(fromFP(computeMood(c, 0))).toBeCloseTo(50, 1);
  });
  it("bad thought lowers mood", () => {
    const c = createColonist(1, "Alice", []);
    const c2 = addThought(c, { id: "slept_cold", offset: toFP(-10), expiresAtTick: 9999 }, 0);
    expect(fromFP(computeMood(c2, 0))).toBeCloseTo(40, 1);
  });
});
```

**Determinism rules**
- Pass `PrngStream` as an argument; never capture it in a closure or module variable.
- Sort `Colonist[]` by `id` before iterating for any colony-wide operation.
- In `selectJob`, sort job candidates by `jobId` alphabetically before scoring — this ensures tie-breaking is stable even if the caller provides jobs in a different order.

**Fixture adapter wiring**
- Renderer stub: `src/adapters/renderer.fixture.ts` exports `renderFrame(state: SimState): void { /* no-op */ }`.
- Any live integration (e.g., sound, asset loader) has a fixture counterpart.

**Definition of done (any card)**
1. `npm test` is green.
2. `tsc --noEmit` has zero errors.
3. At least one test asserts the key invariant (mood = baseline + thoughts, items conserved, etc.).
4. No `Math.random()`, `Date.now()`, or raw floats for FP quantities.
5. No `any` types.
6. Functions that take `PrngStream` never capture it globally.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1: Using floats for mood and need values**
The model will write `colonist.mood -= 5.3` or `colonist.hunger += 0.5 * dt`. This breaks the checksum determinism on different machines. Fix: all mood offsets and need decay rates are `FP` constants in `src/mood.ts` and `src/needs.ts`. Compute with `fpAdd`/`fpSub`/`fpMul` only. The `fpSub` conservation guard also catches a negative need level.

**Pitfall 2: Nondeterministic colonist iteration order**
The model may store colonists in a `Map<EntityId, Colonist>` and iterate with `.forEach()`. Map insertion order is deterministic in JS, but if colonists are inserted in different orders across runs (e.g., after a snapshot restore), the order changes. Fix: always sort `Colonist[]` by `id` before any colony-wide loop. The replay test (C16) will catch this.

**Pitfall 3: Job tie-break not using the PRNG**
The model may resolve equal-score jobs by array index (first job wins). This depends on the order jobs are passed to `selectJob`, which is fragile. Fix: when scores are tied, collect tied job ids, sort them alphabetically, then call `nextIntBelow(prng.jobTieBreak, tied.length)` to pick. Any change in job-list order will then not affect the outcome.

**Pitfall 4: Mood not equal to baseline + sum of active thoughts**
The model may store mood as a separate field that is independently updated and drift from the correct value. Fix: `mood` is a *derived* field — always computed by `computeMood(colonist, tick)` on demand, not stored and mutated. `SimState` colonists carry their `activeThoughts[]`; the mood value is computed fresh each time it is needed. The invariant test in C16 asserts `mood === computeMood(c, tick)` for every colonist.

**Pitfall 5: Story beats with no evidence reference**
The model may generate an incident description like "a fight broke out" without recording which colonist relationship edge, which stress level, and which tick caused it. Fix: `selectIncident` always populates `evidenceRefs` with the actual state facts it checked. Any incident with an empty `evidenceRefs` array fails the groundedness invariant check in C16.

**Pitfall 6: Snapshot restore does not reconstruct PRNG state**
The model may serialize `SimState` but omit the `prngTree` (or serialize it as an opaque object whose state is lost). After restore, the PRNG streams start from a different point, producing different outcomes. Fix: `PrngStream` is a plain `{name, state}` object — it serializes cleanly with `JSON.stringify`. Confirm the restore test (C16 step 2) produces identical checksums after restore before adding new serializable state.

**Pitfall 7: Forgetting that mental-break thresholds are documented bands, not magic**
The model may implement mental breaks as `if mood < randomThreshold → break`. Fix: use the explicit bands from `C06`: `breakBand(mood)` returns the band deterministically; `rollMentalBreak(band, prng, tick)` uses the PRNG with documented per-tick probabilities. Both functions are pure and testable. The invariant test asserts a colonist at `mood = toFP(6)` is in the `"extreme"` band.
