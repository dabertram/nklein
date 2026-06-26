# 09 - Maritime Fleet Routing and Compliance Platform

Complexity tier: 9/20
Expected decomposition size: 28-32 dependent implementation cards before coding.
Domain pressure: voyage planning, maritime weather, fuel optimization, emissions areas, COLREG-style constraints, port operations.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a maritime fleet operations platform for regional cargo vessels. It should plan voyages, assess weather and route risk, track fuel and emissions compliance, and coordinate port calls with realistic nautical constraints.

## Foundation release scope
The first serious buildout must include:
- Vessel, voyage, waypoint, leg, port call, cargo, bunker fuel, emission zone, weather cell, notice, crew, and compliance event models.
- Route planner over deterministic nautical graph fixtures with draft limits, restricted zones, speed limits, locks, canals, and port approach windows.
- Weather and sea-state risk model that scores wind, wave height, current, visibility, and forecast uncertainty by route leg.
- Fuel consumption estimator using vessel class, displacement proxy, speed curve, sea state, hotel load, and reserve policy.
- Emissions compliance tracker for sulfur limits, emission-control zones, berth reporting, and fuel switch events.
- Port-call scheduler with ETA, berth window, pilotage, tug requirements, cargo readiness, and delay propagation.
- Operational exception workflow for diversion, missed berth, weather avoidance, and low-fuel risk.
- Seed scenario with two vessels, storm reroute, emission zone fuel switch, and port congestion cascade.

## Architecture requirements
- Separate route topology, vessel performance model, weather risk, compliance rules, and schedule state.
- Make every route recommendation explainable by constraints and tradeoffs.
- Use units for nautical miles, knots, metric tons, draft, fuel mass, and timestamps.
- Design adapters for AIS/weather/port feeds but use deterministic fixtures for tests.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- A shortest route can be invalid because of draft, weather, emissions, cargo, or port windows.
- Fuel burn is nonlinear with speed and affected by sea state.
- Port schedules create network effects across voyages.
- Compliance events need proof of timing, location, and fuel state.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Route tests reject restricted, draft-invalid, and emissions-noncompliant legs.
- Fuel estimates respond to speed, sea state, and reserve policy.
- Schedule propagation tests cover late arrival and missed berth windows.
- Compliance reports cite route leg and fuel-switch evidence.
- The project passes npm test without live map or weather APIs.

## Explicit non-goals
- Do not call live AIS or weather services.
- Do not implement a simple map marker board only.
- Do not ignore units and nautical time-zone edge cases.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.


---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single defining property of this project is *constrained physical optimization where the cheapest route is routinely illegal*:** a voyage planner must reconcile a continuous, non-linear physics layer (fuel ∝ speed³, weather-added resistance) with hard discrete legal/spatial gates (draft, ECA sulphur limits, restricted zones, tidal windows, COLREGS), and every recommendation must be explainable as *which constraint bound it and what it cost*. The shortest great-circle is the *start* of the problem, never the answer.

This section raises the base spec to master-grade by grounding it in the real maritime stack (IMO COLREGS, SOLAS/MARPOL Annex VI, IHO ECDIS/ENC + S-100, Paris MOU PSC, the propeller/Admiralty fuel law, great-circle vs rhumb-line geometry) and naming the hard seams, the determinism strategy, the adversarial fixtures, and the invariant tests. The acceptance command stays `npm test`; nothing here may touch live AIS, weather, ENC, or port feeds.

## V0. Research-grounded domain authenticity (what a master mariner / DPA will check for)

- **Voyage geometry — great-circle vs rhumb-line vs composite.** The shortest path between two points on the sphere is a **great circle** (varying course); a **rhumb line** (constant course/loxodrome) is longer but simpler; **composite great-circle** sailing caps the maximum latitude to dodge ice/weather. Great-circle savings only matter on long passages (≳ 600 NM); short coastal legs gain little. Source: https://www.marinepublic.com/blogs/training/762608-route-planning-great-circle-composite-gc-navigation and https://www.britannica.com/technology/great-circle-route — **Implication:** leg distance is a **computed spherical quantity** (haversine / great-circle with a max-latitude constraint), in **nautical miles**, and the planner must reason about the *geometry vs weather/ice* tradeoff, not just pick the shortest line.
- **The fuel/power law (the physics core).** Required power — and to first order daily fuel — scales with the **cube of speed through water**: `P ∝ V³`. The **Admiralty coefficient** `Ac = Δ^(2/3) · V³ / P` ties displacement Δ, speed V, and brake power P. A ~10% speed cut yields ~**20–27%** fuel reduction near design speed (the basis of *slow steaming*). **Caveat the experts insist on:** the clean cube law holds *near design speed*; real sensitivity off-design is lower, so the model must be a **calibrated speed–power curve per vessel class with the cube as the documented baseline**, not a universal truth. Sources: https://www.sciencedirect.com/science/article/pii/S2468013315300127 , https://greenvoyage2050.imo.org/technology/speed-management/ — **Implication:** fuel burn is the **non-linear heart** of the system; speed is the master decision variable; sea-state adds resistance on top.
- **MARPOL Annex VI — sulphur, ECAs, and the fuel-switch event.** Global cap **0.50% m/m** sulphur since 2020-01-01; **0.10%** inside **Emission Control Areas (ECAs)** since 2015; the legacy limit was 3.50%. Five operative ECAs (North America, US Caribbean, North Sea, Baltic, Mediterranean — Med added; Canadian Arctic + Norwegian Sea designated by MEPC 82). Compliance via compliant low-sulphur fuel, an **EGCS/scrubber**, or alternative fuel (LNG). A vessel must **flush and switch to ≤0.10% fuel before entering an ECA**, and **log the changeover (quantities, date, time, position)**. Sources: https://maritimeoptima.com/insights/global-sulphur-regulations-eca-seca-zones and https://www.marinepublic.com/blogs/hse/205772-marpol-annex-vi-regulation-ship-air-pollution-rule-explained — **Implication:** the **fuel-switch is a timed, geofenced, *proof-bearing* event** — the compliance report must cite the **leg, the ECA-boundary crossing time/position, and the bunker/fuel state** (this is the base spec's "compliance needs proof of timing, location, and fuel state"). Carbon intensity (**CII**) and **EEXI** further tighten Annex VI for existing ships → an annual-rating layer.
- **COLREGS (the constraint many planners omit).** The **International Regulations for Preventing Collisions at Sea, 1972** define give-way/stand-on duties: **head-on (Rule 14)** — both alter to **starboard**; **crossing (Rules 15–17)** — vessel with the other on its **starboard** side gives way, the other **stands on** until collision is imminent; **overtaking (Rule 13)** — overtaker keeps clear; **restricted visibility (Rule 19)** — *no* stand-on vessel, every vessel takes action at **safe speed**, avoid altering **to port for a vessel forward of the beam**. Encounters are assessed via **CPA/TCPA** (closest point of approach / time to it). Sources: https://www.imo.org/en/about/conventions/pages/colreg.aspx and https://en.wikipedia.org/wiki/International_Regulations_for_Preventing_Collisions_at_Sea — **Implication:** "COLREG-style constraints" become a **deterministic encounter classifier** over fixture AIS tracks: given two vessels' positions/courses/speeds, classify the encounter, compute CPA/TCPA, and emit the *required* manoeuvre side + a safe-speed/own-action flag in restricted visibility — explainable by rule, never a black box.
- **ECDIS / ENC + under-keel clearance (the spatial-safety core).** Electronic charts are **ENCs** in IHO **S-57** (legacy) → **S-101** under the **S-100** framework (IMO phase-in began 2026-01-01). The **safety contour** governs the "no-go" water: **safety contour ≈ draft + squat + required UKC − height of tide**; **squat** (bow/stern sinkage at speed in shallow water) and **heel/wave response** feed the **under-keel-clearance** calculation, and S-100 products (**S-102** bathymetry, **S-104** water-level, **S-129** UKC management) let the contour adjust to *predicted actual depth* and **tidal windows**. Sources: https://www.admiralty.co.uk/news/s-57-s-101-explaining-iho-standards-ecdis and https://www.marineinsight.com/marine-navigation/proper-use-of-ecdis-safety-settings/ — **Implication:** a leg is **draft-invalid** unless `charted_depth + tide_at_time ≥ draft + squat(speed) + min_UKC`; some legs are passable **only inside a tidal window**, which couples routing to **time** (the port-approach windows already in the base spec). Squat rises with speed, so **slowing can *create* clearance** — a beautiful cross-coupling with the fuel layer.
- **Port State Control (Paris MOU New Inspection Regime).** A vessel's **Ship Risk Profile** (Low / Standard / High) — from age, flag, **Recognized Organization**, company performance, deficiency/detention history — sets **inspection interval & scope** (HRS ~5–6 mo, SRS ~10–12 mo, LRS ~24–36 mo); **5+ deficiencies** sharply raise detention odds; PSC inspects against **SOLAS, MARPOL, STCW, MLC, Load Line, ISM, ISPS**. Sources: https://www.westpandi.com/news-and-resources/news/port-state-control-paris-mou-new-inspection-regime/ and https://north-standard.com/insights-and-resources/resources/news/marpol-emission-control-areas — **Implication:** a **PSC-readiness / risk-profile** model is a legitimate compliance-event consumer: certificate validity, open deficiencies, and a port's MOU regime feed a **detention-risk estimate** that can flag a port call before arrival.

## V1. The hardest technical seams (named)

1. **The constraint-typed routing graph (the spine).** The nautical graph fixture carries, per node/edge: depth, restricted/TSS zones, locks/canals (with transit windows & dimensions), speed limits, ECA membership, and port-approach windows. A leg's validity is a **conjunction of typed constraints** each of which can independently *reject* with a reason: `DRAFT_INVALID`, `RESTRICTED_ZONE`, `ECA_FUEL_NONCOMPLIANT`, `OUTSIDE_TIDAL_WINDOW`, `LOCK_CLOSED`, `SPEED_LIMIT`. **A shortest path that is illegal must fail loudly with the binding constraint named** (the base spec's central demand).
2. **The vessel performance model (non-linear, calibrated).** A per-class **speed→power→fuel** curve with the **cube law as the documented baseline**, modulated by **sea-state added resistance**, **displacement proxy**, **hotel/auxiliary load**, and a **reserve policy**. Pure, unit-checked, and the single most-tested numeric module.
3. **The weather/sea-state risk layer (uncertainty-aware).** Per-leg scoring of **wind, significant wave height, current, visibility**, *and forecast uncertainty/freshness*, producing a **risk score + a recommended speed/heading adjustment** — and a **diversion trigger** when risk crosses a threshold. Weather is **time-and-space indexed fixtures** (a cell grid over a forecast horizon), so a later ETA hits a *different* weather cell — the core coupling that makes reroute decisions non-trivial.
4. **The compliance-event ledger (proof-bearing).** ECA entry/exit, fuel switch, berth reporting, and bunkering are **timed, geofenced, evidence-linked events**: each cites leg + boundary-cross time/position + fuel-tank state. The **sulphur-compliance proof** and **CII/EEXI** rating are projections over this ledger.
5. **The COLREGS encounter classifier.** Over fixture AIS tracks: classify head-on / crossing / overtaking / restricted-visibility, compute **CPA/TCPA**, emit the **rule-required action** + safe-speed flag — deterministic and explainable, a constraint on *track feasibility*, not an autopilot.
6. **The port-call scheduler with delay propagation (network effects).** ETA → **berth window / pilotage / tug / cargo-readiness** with **buffers**; a missed window **cascades** down the voyage chain and across vessels sharing a berth — the base spec's "port schedules create network effects." This is a constrained temporal scheduling problem, not a calendar.
7. **The UKC × speed × tide cross-coupling.** Because **squat grows with speed** and clearance depends on **tide-at-arrival-time**, the planner must reason jointly over *speed (fuel), arrival time (tide window), and draft* — the seam where physics, time, and legality all bind at once.

## V2. Determinism & testability strategy (acceptance stays `npm test`, no live feeds)

- **Units are types, not comments.** Nautical miles, knots, metric tons (displacement & **fuel mass**), metres (draft/UKC/Hs), and **UTC-anchored timestamps** are branded units; the base spec's "units + nautical time-zone edge cases" non-goal is enforced at the type level. Date-line crossings and local-vs-UTC port times are explicitly tested.
- **Virtual clock + seeded entropy.** ETAs, tidal windows, forecast horizons, lock schedules, and berth timelines read an **injected clock**; any within-tolerance noise (e.g. weather realization, speed-made-good) draws from one seeded PRNG so a voyage replays identically.
- **Deterministic fixture adapters, named as adapters:** `NauticalGraphAdapter` (nodes/edges + all typed constraints), `WeatherFieldAdapter` (space×time cell grid with forecast freshness), `TideAdapter` (water-level vs time per port), `AisTrackAdapter` (other-vessel tracks for COLREGS), `BunkerAdapter` (fuel grades/sulphur/BDN), `PortScheduleAdapter` (berth/pilot/tug windows), `EncMetaAdapter` (charted depths / zones). Each has a live-production sibling but the test path never reaches the network.
- **Event-sourced voyage state + snapshot/replay.** Voyage execution (position, fuel-remaining, compliance events, exceptions) is a fold over an event log; **snapshot/restore** lets a test interrupt a voyage mid-storm and rebuild identical state. **Compliance reports + route explanations are deterministic projections** ⇒ golden masters.
- **Golden masters** for: the seed two-vessel scenario (storm reroute + ECA fuel switch + port-congestion cascade), the per-leg fuel/risk breakdown, the route-rejection reasons, and the sulphur-compliance certificate trace.

## V3. Adversarial / failure / edge-case fixtures (ship the hostility in the repo)

- **The illegal shortest path** (seed-critical): the great-circle optimum crosses a **draft-shoal**, a **restricted zone**, and an **ECA where the loaded fuel is 0.50%**; the planner must reject it with **all three binding constraints named** and offer a compliant alternative with its fuel/time cost.
- **The tidal-window trap:** a port approach is passable **only** at high water; an upstream weather slowdown pushes ETA **past the window**, forcing either a **speed-up (fuel/UKC tradeoff — faster ⇒ more squat ⇒ *less* clearance)** or a **wait/anchor** — the model must surface the dilemma, not silently pick.
- **The storm reroute** (seed): a forecast cell's **Hs crosses the risk threshold** on the planned leg; rerouting to a composite (higher-latitude-capped or longer) track changes **distance, ETA, fuel, *and the weather cell newly encountered*** — assert the recommendation is explainable and the new leg is itself re-validated.
- **ECA boundary mid-leg:** the ECA edge falls **partway along a leg**; the fuel-switch event must be placed at the **crossing time/position**, and a switch logged *late* (after the boundary) is flagged **non-compliant** with the overshoot quantified.
- **COLREGS crossing conflict:** a fixture AIS target on the **starboard bow** with **TCPA inside threshold** must classify as a **give-way crossing** with a **starboard alteration**; a **restricted-visibility** variant must drop stand-on and flag safe-speed/own-action.
- **The port-congestion cascade** (seed): vessel A misses its berth window; vessel B sharing the berth and A's own next port call both **shift**, and the scheduler must propagate delays **without double-booking the berth**.
- **The low-fuel exception:** sea-state-driven over-burn erodes the **reserve below policy**; the system must raise a **low-fuel-risk exception** (bunker-port diversion vs slow-steam-to-stretch-reserve) with the numbers.
- **Stale-forecast guard:** a leg grounded on a **forecast past its freshness horizon** must be flagged as **under-grounded** (re-validate before committing) rather than treated as fact.

## V4. Rigorous acceptance criteria, incl. property-based / invariant tests

Beyond the base spec's example tests, assert **invariants** as property tests over randomized + scripted voyages:

1. **Constraint soundness & completeness.** A route the planner accepts has **every** leg passing **every** typed constraint at its scheduled time; a route it rejects names **at least one** binding constraint with the facts that bound it. (Fuzz random routes; no accepted-but-illegal leg, no rejected-without-reason.)
2. **Fuel monotonicity & physics sanity.** With sea-state fixed, **fuel(speed) is strictly increasing and convex** over the curve's valid band; sea-state worsening never *decreases* burn at fixed speed; reserve policy is always honored or an exception fires. (Property-tested across the speed grid.)
3. **Conservation of fuel mass.** Over any executed voyage, `fuel_loaded − Σ(leg_burn) − fuel_remaining == 0` (within rounding); fuel is never created or destroyed, only consumed/bunkered, and every bunkering is a logged event.
4. **Sulphur-compliance totality.** Every moment a vessel is inside an ECA, the **in-use fuel sulphur ≤ 0.10%** (or a scrubber is active), or a **non-compliance event exists** with the overshoot — no silent violations; every fuel-switch event cites leg + time + position + tank state.
5. **UKC safety ratchet.** No accepted leg ever has `available_depth(time) < draft + squat(speed) + min_UKC`; tightening squat (higher speed) can only *reduce* clearance, never the model's *reported* clearance vs the truth.
6. **Schedule causality.** Delay propagation never lets two vessels occupy one berth in overlapping windows; a downstream ETA is always ≥ upstream completion + transit; cascades are deterministic.
7. **COLREGS determinism.** The encounter classifier is **total** (every track pair → exactly one encounter class + action) and **pure**; the documented Rule 13/14/15/19 cases are pinned.
8. **Determinism.** The seed two-vessel scenario yields **byte-identical** compliance reports + route explanations across two runs from the same seed, and the structured record alone (prose redacted) answers a fixed battery of compliance/audit queries.

## V5. Concrete first vertical slice (the on-ramp — build THIS first, ~28–32 cards)

Do not start with a map board. Prove the spine on one fully-worked voyage:

1. **Unit-typed domain model + branded units + UTC time** (NM, knots, tonnes, metres, fuel mass) with date-line/timezone tests.
2. **Event log + virtual clock + seeded entropy + snapshot/restore** (the kernel).
3. **The constraint-typed nautical graph + route validator** (draft / restricted / ECA / tidal-window / lock / speed) that **rejects illegal legs with the binding reason** — *this single seam de-risks the whole "shortest ≠ legal" thesis.*
4. **The vessel performance model** (cube-law baseline + sea-state added resistance + reserve policy), pure and unit-checked.
5. **The weather/sea-state risk layer** over the space×time fixture, with a **diversion trigger**.
6. **The UKC × tide × squat cross-coupling** wired into leg validity (the time-coupled clearance check).
7. **The compliance-event ledger** with the **ECA fuel-switch proof** (leg + boundary time/position + tank state) and a **sulphur-compliance certificate** projection.
8. **The seed two-vessel scenario end-to-end** — storm reroute + ECA fuel switch + port-congestion cascade — with **golden compliance reports** and **the illegal-shortest-path + tidal-window-trap adversarial fixtures** surviving.

If that slice is real, the COLREGS classifier breadth, full port-call scheduler, PSC-readiness model, and operator UI are breadth on a proven, explainable spine.

## V6. Domain knowledge-debt to track (surface, do not bluff)

- **Speed–power curve fidelity:** the cube law is a **calibration baseline**, not truth off-design; real curves need sea-trial/noon-report data → mark `numerical-assumption + expert-review (naval architect)`; the curve must be data-replaceable per class.
- **Weather-routing models** (added-resistance in waves, seakeeping limits) are an active research area; the fixture risk model is a **defensible approximation**, not a met-ocean engine → `fixture-limitation` debt.
- **MARPOL Annex VI currency:** ECA boundaries, the CII/EEXI rating curves, and FuelEU-Europe-style rules **evolve** (MEPC keeps amending) → `standards-currency`; the ECA set + rating thresholds are a versioned rule pack.
- **COLREGS are judgement-laden law**, not a pure algorithm (the "ordinary practice of seamen," Rule 2); the classifier is a **decision-support approximation**, explicitly *not* an autopilot or a legal authority → `legal/safety expert-review`.
- **ENC licensing + S-100 transition:** real ENCs are licensed IHO data and the **S-57→S-101/S-104** transition is mid-flight → fixture charts are synthetic; mark `licensing + standards-currency`.
- **PSC risk-profile weights** are regime-specific (Paris vs Tokyo MOU differ) → make the Ship-Risk-Profile formula a **configurable rule pack**, not a universal constant.
- **Bunker quality & BDN trust:** real sulphur content can differ from the Bunker Delivery Note (fuel-quality disputes are common) → model BDN as a **claim with provenance**, not ground truth.

## V7. Why this is a great !Klein challenge

It is the canonical "the obvious answer is wrong" domain: a small-local-LLM swarm that naively returns the shortest great-circle **fails**, and the spec *forces* the disciplined decomposition — a **constraint-typed graph** + a **non-linear-but-calibrated physics module** + a **proof-bearing compliance ledger** + **time-coupled spatial safety (UKC/tide/squat)** — where correctness is *checkable* (no accepted-illegal leg; fuel conservation; sulphur totality; UKC ratchet) rather than asserted. The hard parts are legible and dependency-ordered (units → kernel → constraint validator → performance/weather → UKC coupling → compliance ledger → seed scenario), the invariants are property-testable, and "every recommendation explainable by which constraint bound it and what it cost" turns governance into enforced types — the same north star as exemplar 36, sized to a 28–32-card foundation.

---

## Small-model build guide (3B-ready)

> This section is written for a ~3B parameter local model following !Klein's `decompose_project` workflow. Every term is defined, every card is spelled out step-by-step, and every acceptance check is a deterministic assertion that can run offline with `npm test`. The 3B should **follow**, not figure out.

---

### 1. Glossary & ground rules

**Domain terms**

| Term | Plain meaning |
|------|---------------|
| NM | Nautical mile — the unit of all distances in this project (1 NM ≈ 1852 m) |
| Knot | Unit of speed: 1 knot = 1 NM per hour |
| Displacement (Δ) | Vessel mass in metric tonnes — the weight of water displaced |
| Draft | Depth of the vessel's hull below the waterline in metres |
| UKC | Under-Keel Clearance — minimum depth between keel and seabed, in metres |
| Squat | Additional sinkage (metres) caused by vessel speed in shallow water; increases with speed |
| ECA | Emission Control Area — a sea zone where sulphur ≤ 0.10% m/m is required |
| MARPOL Annex VI | IMO regulation capping sulphur content of bunker fuel; global cap 0.50% since 2020 |
| Rhumb line | Constant-compass-bearing course between two points; longer than great-circle on long passages |
| Great-circle | Shortest path on the sphere; course varies continuously |
| Haversine | Formula for great-circle distance between two lat/lon points |
| BDN | Bunker Delivery Note — legal document proving fuel grade and sulphur content at bunkering |
| COLREGS | International Regulations for Preventing Collisions at Sea |
| CPA / TCPA | Closest Point of Approach / Time to CPA — metrics for collision risk between two vessels |
| AIS | Automatic Identification System — vessel position broadcast |
| Constraint rejection | A leg the route validator refuses, with the reason named (e.g. `DRAFT_INVALID`) |
| Compliance event | A timed, geofenced, proof-bearing event: ECA entry/exit, fuel switch, bunkering |
| Nautical graph fixture | In-repo JSON/TS map: nodes (ports/waypoints), edges (legs with typed constraints); no live map API |
| Event log / virtual clock | Same pattern as all specs: append-only log + injected clock; never `Date.now()` in tests |
| Branded unit | A TypeScript type alias that makes `NauticalMiles` incompatible with `Knots` at compile time |
| Golden master | Committed expected-output file; test asserts byte-equality of computed output against it |
| Knowledge-debt comment | `// KNOWLEDGE-DEBT: <tag> — <explanation>` inline marker |

**Stack**

- Language: **TypeScript**
- Runtime: **Node.js**
- Test runner: **Vitest** (`npm test` runs `vitest run`)
- No external HTTP calls anywhere in `src/` or `test/`
- All random values drawn from a seeded PRNG (`src/lib/prng.ts`)

**Acceptance command (plain steps)**

1. `npm test` — runs `vitest run`
2. Every test must pass; any `FAIL` is a blocker
3. No network calls; no `Date.now()`; no `Math.random()` in core
4. Golden-master files live in `test/golden/`; regenerate with `REGEN_GOLDEN=1 npm test`, then commit

**Determinism rules (imperative)**

- Never call the network; use the fixture adapter in `src/adapters/`
- Never call `Date.now()`; accept a `Clock` parameter
- Never call `Math.random()`; use `createPrng(seed)`
- Branded units enforce dimensional correctness at compile time; never pass a raw `number` where a branded unit is required
- The ECA boundary set and sulphur limits are a versioned rule pack (`src/rule-packs/`), not hardcoded numbers

---

### 2. The explicit task graph for the first vertical slice

The first slice maps to V5 of this spec (items 1–8). It has **22 cards** (`S01`–`S22`).

---

**`S01` — TypeScript project scaffold**
dependsOn: none
files: `package.json`, `tsconfig.json`, `vitest.config.ts`

interface: (standard scaffold — see project-05 S01 for the exact template)

how to implement:
1. `package.json`: `"type":"module"`, `vitest` dev-dep, `"test":"vitest run"`.
2. `tsconfig.json`: `"strict":true`, `"module":"NodeNext"`.
3. `vitest.config.ts`: `test: { environment: "node" }`.

acceptance: `npm test` exits 0 (no tests yet; "No test files found" is OK).

---

**`S02` — Virtual clock + seeded PRNG**
dependsOn: `S01`
files: `src/lib/clock.ts`, `src/lib/prng.ts`, `test/lib/clock.test.ts`, `test/lib/prng.test.ts`

interface:
```ts
// src/lib/clock.ts
export interface Clock { now(): number; advance(ms: number): void; }
export function createClock(startMs?: number): Clock;

// src/lib/prng.ts
export function createPrng(seed: number): () => number;
```

how to implement: identical to project-05 `S02` (mulberry32 PRNG, simple mutable clock).

acceptance: clock advances correctly; same PRNG seed always produces the same sequence.

---

**`S03` — Branded units + core domain types**
dependsOn: `S01`
files: `src/types/units.ts`, `src/types/domain.ts`, `test/types/units.test.ts`

interface:
```ts
// src/types/units.ts
declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type NauticalMiles = Brand<number, "NauticalMiles">;
export type Knots          = Brand<number, "Knots">;
export type MetricTons     = Brand<number, "MetricTons">;
export type Metres         = Brand<number, "Metres">;
export type FuelMassKg     = Brand<number, "FuelMassKg">;
export type UtcMs          = Brand<number, "UtcMs">;
export type SulphurPct     = Brand<number, "SulphurPct">;

export function nm(v: number): NauticalMiles;
export function kts(v: number): Knots;
export function mt(v: number): MetricTons;
export function m(v: number): Metres;
export function fuelKg(v: number): FuelMassKg;
export function utcMs(v: number): UtcMs;
export function sulphurPct(v: number): SulphurPct;

// src/types/domain.ts
export type NodeId   = string;
export type VesselId = string;
export type VoyageId = string;
export type LegId    = string;

export type ConstraintViolationReason =
  | "DRAFT_INVALID"
  | "RESTRICTED_ZONE"
  | "ECA_FUEL_NONCOMPLIANT"
  | "OUTSIDE_TIDAL_WINDOW"
  | "LOCK_CLOSED"
  | "SPEED_LIMIT";

export interface LegConstraintResult {
  ok: boolean;
  violations: Array<{ reason: ConstraintViolationReason; detail: string }>;
}
```

how to implement:
1. Implement the brand pattern: `export function nm(v: number): NauticalMiles { return v as NauticalMiles; }` etc.
2. The `test/types/units.test.ts` checks that branded values round-trip: `nm(5) === 5 as NauticalMiles` is true at runtime.

acceptance: TypeScript compiles; `nm(5) + nm(3)` works at runtime (brands are erased); TypeScript rejects `const x: Knots = nm(5)` (brands prevent mixing at compile time).

---

**`S04` — Event log + snapshot/restore**
dependsOn: `S02`, `S03`
files: `src/core/event-log.ts`, `test/core/event-log.test.ts`

interface:
```ts
// src/core/event-log.ts
export interface VoyageEvent {
  seq: number;
  type: string;
  payload: unknown;
  clockMs: number;
}
export interface EventLog {
  append(type: string, payload: unknown): VoyageEvent;
  all(): readonly VoyageEvent[];
  snapshot(): readonly VoyageEvent[];
  restore(events: readonly VoyageEvent[]): void;
}
export function createEventLog(clock: Clock): EventLog;
```

how to implement: identical to project-05 `S04` (append-only array, seq counter, deep-clone snapshot).

acceptance: appended events have ascending `seq`; snapshot/restore produces identical `all()` output.

---

**`S05` — Nautical graph fixture + leg-constraint types**
dependsOn: `S03`
files: `src/fixtures/nautical-graph.ts`, `src/adapters/nautical-graph.ts`, `test/adapters/nautical-graph.test.ts`

interface:
```ts
// src/adapters/nautical-graph.ts
export interface GraphNode {
  id: NodeId;
  lat: number; lon: number;
  portName?: string;
}
export interface GraphEdge {
  id: LegId;
  from: NodeId; to: NodeId;
  distanceNm: NauticalMiles;
  maxDraftMetres: Metres;          // depth minus required UKC minimum
  restricted: boolean;
  ecaMember: boolean;
  speedLimitKts?: Knots;
  lockWindowsUtcMs?: Array<{ openMs: UtcMs; closeMs: UtcMs }>;
}
export interface NauticalGraph { nodes: GraphNode[]; edges: GraphEdge[]; }

export interface NauticalGraphAdapter {
  getEdge(legId: LegId): GraphEdge | undefined;
  edgesFromNode(nodeId: NodeId): GraphEdge[];
  shortestPath(from: NodeId, to: NodeId): { path: LegId[]; totalDistanceNm: NauticalMiles } | null;
}
export function createNauticalGraphAdapter(graph: NauticalGraph): NauticalGraphAdapter;
```

how to implement:
1. Dijkstra over edges using `distanceNm` as cost.
2. Fixture in `src/fixtures/nautical-graph.ts`: 8+ nodes, 12+ edges; at least one edge with `restricted:true`, one with `ecaMember:true`, one with `maxDraftMetres` that is shallow, one with a lock window.
3. The "illegal shortest path" from the seed scenario should cross the shallow/restricted/ECA edge — design the fixture so the shorter path is the illegal one.

acceptance (`test/adapters/nautical-graph.test.ts`):
- `shortestPath` returns non-null for connected nodes.
- Returns `null` for disconnected nodes.
- `edgesFromNode` returns only edges leaving that node.

---

**`S06` — Leg constraint validator**
dependsOn: `S03`, `S05`
files: `src/core/leg-validator.ts`, `test/core/leg-validator.test.ts`

interface:
```ts
// src/core/leg-validator.ts
export interface LegValidationContext {
  edge: GraphEdge;
  vesselDraftMetres: Metres;
  vesselSpeedKts: Knots;
  inUseFuelSulphurPct: SulphurPct;
  currentClockMs: UtcMs;
  hasEgcsScrubber?: boolean;   // if true, ECA sulphur limit is waived
}

export function validateLeg(ctx: LegValidationContext): LegConstraintResult;
// Returns ok:false with all binding violations named if any constraint fires.
// A leg that is both restricted AND draft-invalid returns BOTH violations.
```

how to implement (check each constraint independently, collect all violations):
1. If `edge.restricted` → push `RESTRICTED_ZONE`.
2. If `vesselDraftMetres > edge.maxDraftMetres` → push `DRAFT_INVALID` with detail showing the gap.
3. If `edge.ecaMember && !hasEgcsScrubber && inUseFuelSulphurPct > 0.10` → push `ECA_FUEL_NONCOMPLIANT` with detail showing the actual sulphur %.
4. If `edge.speedLimitKts && vesselSpeedKts > edge.speedLimitKts` → push `SPEED_LIMIT`.
5. If `edge.lockWindowsUtcMs?.length > 0` → check if `currentClockMs` falls in any window; if not → push `OUTSIDE_TIDAL_WINDOW`.
6. `ok = violations.length === 0`.

acceptance (`test/core/leg-validator.test.ts`):
- Compliant leg → `{ ok:true, violations:[] }`.
- Draft exceeds max → `DRAFT_INVALID` violation.
- ECA with 0.50% fuel → `ECA_FUEL_NONCOMPLIANT`.
- Both draft and ECA violated simultaneously → two violations returned (not just the first).
- Lock closed → `OUTSIDE_TIDAL_WINDOW`.

---

**`S07` — Vessel performance model (fuel/power curve)**
dependsOn: `S03`
files: `src/core/vessel-performance.ts`, `test/core/vessel-performance.test.ts`

interface:
```ts
// src/core/vessel-performance.ts
export interface VesselClass {
  id: string;
  designSpeedKts: Knots;
  designPowerKw: number;
  displacementTons: MetricTons;
  // Speed-power curve: array of {speedKts, powerKw} calibration points, sorted ascending by speed.
  // Curve must cover design speed. Cube law is the extrapolation baseline outside calibrated range.
  speedPowerCurve: Array<{ speedKts: number; powerKw: number }>;
}

export interface FuelBurnInput {
  vesselClass: VesselClass;
  speedKts: Knots;
  legDistanceNm: NauticalMiles;
  seaStateAddedResistanceFactor: number;  // multiplier ≥ 1.0; calm=1.0, rough=1.25
  hotelLoadKw: number;
  fuelDensityKgPerL: number;             // typically ~0.85 for HFO
  specificFuelConsumptionGPerKwh: number; // g/kWh
}

export interface FuelBurnResult {
  legBurnKg: FuelMassKg;
  legDurationHrs: number;
  effectivePowerKw: number;
  assumptions: string[];   // list knowledge-debt assumptions
}

export function computeFuelBurn(input: FuelBurnInput): FuelBurnResult;
```

how to implement:
1. Interpolate `speedPowerCurve` at `input.speedKts`; if outside range, extrapolate using cube law: `P = P_design × (V/V_design)³`.
2. Apply sea-state factor: `effectivePower = interpolatedPower × seaStateAddedResistanceFactor + hotelLoadKw`.
3. `legDurationHrs = legDistanceNm / speedKts`.
4. `legBurnKg = effectivePower × legDurationHrs × specificFuelConsumptionGPerKwh / 1000 × fuelDensityKgPerL`.
5. Add assumption strings: `"// KNOWLEDGE-DEBT: cube-law extrapolation outside calibrated speed range"`.

acceptance (`test/core/vessel-performance.test.ts`):
- At design speed, sea state 1.0: `effectivePowerKw` equals the design-speed calibration point (within 1%).
- Higher speed → more fuel (strictly increasing over the calibrated range).
- Higher sea state → more fuel at same speed.
- `legBurnKg > 0` for all valid inputs.
- Reserve policy test: if `legBurnKg > fuelRemaining - reserveKg`, that is checked by the caller (the function just returns burn; the voyage manager checks reserve).

---

**`S08` — Weather/sea-state risk layer**
dependsOn: `S02`, `S03`
files: `src/adapters/weather-field.ts`, `src/fixtures/weather-field.ts`, `src/core/weather-risk.ts`, `test/core/weather-risk.test.ts`

interface:
```ts
// src/adapters/weather-field.ts
export interface WeatherCell {
  nodeId: NodeId;           // closest graph node
  forecastForUtcMs: UtcMs;
  forecastCreatedUtcMs: UtcMs;
  windKts: Knots;
  significantWaveHeightM: Metres;
  currentKts: Knots;
  visibilityNm: NauticalMiles;
}
export interface WeatherFieldAdapter {
  cellAt(nodeId: NodeId, atUtcMs: UtcMs): WeatherCell | undefined;
}
export function createFixtureWeatherFieldAdapter(cells: WeatherCell[]): WeatherFieldAdapter;
// Returns the cell with the closest forecastForUtcMs to atUtcMs for the given node.

// src/core/weather-risk.ts
export interface WeatherRiskResult {
  riskScore: number;              // 0.0–1.0
  seaStateResistanceFactor: number; // ≥1.0, feeds vessel-performance
  diversionTriggered: boolean;    // true when riskScore ≥ 0.8
  forecastStale: boolean;         // true when forecast age > 6 hours
  contributingFactors: string[];
}
export function assessWeatherRisk(cell: WeatherCell, atUtcMs: UtcMs): WeatherRiskResult;
```

how to implement (`assessWeatherRisk`):
1. `forecastStale = (atUtcMs - cell.forecastCreatedUtcMs) > 6*3600*1000`.
2. Score components (each 0–1): wind score = `min(1, windKts/50)`, wave score = `min(1, significantWaveHeightM/6)`, vis score = `1 - min(1, visibilityNm/5)`.
3. `riskScore = (windScore*0.4 + waveScore*0.4 + visScore*0.2)`.
4. `seaStateResistanceFactor = 1.0 + waveScore * 0.3` (calm→1.0, 6m waves→1.3).
5. `diversionTriggered = riskScore >= 0.8`.
6. `contributingFactors`: list any factor scoring above 0.6.

acceptance (`test/core/weather-risk.test.ts`):
- Calm conditions (wind 5 kts, waves 0.5m, vis 10nm) → `riskScore < 0.2`, `diversionTriggered:false`.
- Storm (wind 50 kts, waves 7m, vis 0nm) → `diversionTriggered:true`.
- Forecast 7 hours old → `forecastStale:true`.
- Same inputs always produce same output (pure function, no randomness).

---

**`S09` — UKC × tide × squat cross-coupling**
dependsOn: `S03`, `S05`
files: `src/adapters/tide.ts`, `src/fixtures/tide.ts`, `src/core/ukc.ts`, `test/core/ukc.test.ts`

interface:
```ts
// src/adapters/tide.ts
export interface TideLevel { nodeId: NodeId; atUtcMs: UtcMs; waterLevelMetres: Metres; }
export interface TideAdapter { waterLevelAt(nodeId: NodeId, atUtcMs: UtcMs): Metres; }
export function createFixtureTideAdapter(levels: TideLevel[]): TideAdapter;
// Returns the level with closest atUtcMs for the given node.

// src/core/ukc.ts
export interface UkcContext {
  charted_depth_m: Metres;        // from the edge (maxDraftMetres acts as proxy)
  vessel_draft_m: Metres;
  vessel_speed_kts: Knots;
  tide_water_level_m: Metres;     // from TideAdapter at arrival time
  min_ukc_m: Metres;              // policy minimum (e.g. 0.5m)
}
export interface UkcResult {
  available_depth_m: Metres;      // charted_depth_m + tide_water_level_m
  squat_m: Metres;                // estimated squat: 0.05 × speed_kts (simplified)
  effective_draft_m: Metres;      // vessel_draft_m + squat_m
  clearance_m: Metres;            // available_depth_m - effective_draft_m
  ukc_met: boolean;               // clearance_m >= min_ukc_m
  detail: string;                 // human-readable breakdown
}
export function computeUkc(ctx: UkcContext): UkcResult;
```

how to implement (`computeUkc`):
1. `available_depth = charted_depth + tide_water_level`.
2. `squat = 0.05 × vessel_speed_kts` (simplified; add KNOWLEDGE-DEBT comment for real Barras formula).
3. `effective_draft = vessel_draft + squat`.
4. `clearance = available_depth - effective_draft`.
5. `ukc_met = clearance >= min_ukc`.

acceptance (`test/core/ukc.test.ts`):
- At speed 0: squat = 0, clearance = available_depth − draft.
- At speed 10 kts: squat = 0.5m, effective draft increases.
- High speed can create `ukc_met:false` even when a slow transit would be `ukc_met:true` (the cross-coupling test).
- Positive tide adds to available depth; negative tide subtracts.
- `clearance < min_ukc` → `ukc_met:false`.

---

**`S10` — Route validator (all constraints combined)**
dependsOn: `S05`, `S06`, `S08`, `S09`
files: `src/core/route-validator.ts`, `test/core/route-validator.test.ts`

interface:
```ts
// src/core/route-validator.ts
export interface RouteValidationContext {
  legIds: LegId[];
  vessel: { draftMetres: Metres; speedKts: Knots; inUseFuelSulphurPct: SulphurPct; hasEgcsScrubber?: boolean };
  departureUtcMs: UtcMs;
  graphAdapter: NauticalGraphAdapter;
  tideAdapter: TideAdapter;
  weatherAdapter: WeatherFieldAdapter;
  clock: Clock;
}
export interface RouteValidationResult {
  valid: boolean;
  legResults: Array<{ legId: LegId; result: LegConstraintResult; ukc?: UkcResult; weather?: WeatherRiskResult }>;
  summary: string;   // lists all binding constraints
}
export function validateRoute(ctx: RouteValidationContext): RouteValidationResult;
```

how to implement:
1. For each leg: call `validateLeg`, compute `computeUkc` (using tide at estimated arrival time), call `assessWeatherRisk`.
2. Combine: if any constraint fires, include its violation in `legResults`.
3. `valid = true` only if every leg passes every check.
4. Estimate arrival time at each leg: accumulate `legDistanceNm / speedKts` hours from departure.

acceptance (`test/core/route-validator.test.ts`):
- All-valid route → `{ valid:true }`.
- Route with one shallow leg → `{ valid:false }` with `DRAFT_INVALID` in that leg's violations.
- "Illegal shortest path" from seed fixture (shallow + restricted + ECA) → `{ valid:false }` with all three violations named.
- Diversion-triggering weather on one leg → that leg's `weather.diversionTriggered:true` visible in `legResults`.

---

**`S11` — Compliance-event ledger + ECA fuel-switch proof**
dependsOn: `S03`, `S04`
files: `src/core/compliance-ledger.ts`, `test/core/compliance-ledger.test.ts`

interface:
```ts
// src/core/compliance-ledger.ts
export type ComplianceEventType =
  | "ECA_ENTRY" | "ECA_EXIT"
  | "FUEL_SWITCH"
  | "BUNKERING"
  | "BERTH_REPORT";

export interface ComplianceEvent {
  id: string;
  type: ComplianceEventType;
  vesselId: VesselId;
  legId?: LegId;
  positionNodeId: NodeId;
  clockMs: UtcMs;
  fuelGradeSulphurPct?: SulphurPct;
  bunkeredKg?: FuelMassKg;
  detail: string;
}

export interface ComplianceLedger {
  record(event: Omit<ComplianceEvent,"id">): ComplianceEvent;
  forVessel(vesselId: VesselId): ComplianceEvent[];
  sulphurCertificate(vesselId: VesselId): {
    compliant: boolean;
    violations: Array<{ clockMs: UtcMs; detail: string }>;
  };
}

export function createComplianceLedger(log: EventLog): ComplianceLedger;
```

how to implement:
1. `record`: append a `COMPLIANCE_EVENT` to the event log; return the stored event.
2. `sulphurCertificate`: scan all `ECA_ENTRY` events for the vessel; for each, find the preceding `FUEL_SWITCH`; if no switch or `fuelGradeSulphurPct > 0.10`, add a violation.
3. Never delete; always append.

acceptance (`test/core/compliance-ledger.test.ts`):
- ECA entry with prior fuel switch to 0.08% → `sulphurCertificate` compliant.
- ECA entry without fuel switch (still on 0.50%) → non-compliant violation with the clockMs cited.
- Bunkering events appear in `forVessel(vesselId)`.
- All events are in the event log; `log.all()` grows on each `record`.

---

**`S12` — Voyage fuel tracker (conservation invariant)**
dependsOn: `S03`, `S04`, `S07`, `S11`
files: `src/core/voyage-fuel.ts`, `test/core/voyage-fuel.test.ts`

interface:
```ts
// src/core/voyage-fuel.ts
export interface FuelState {
  onboardKg: FuelMassKg;
  reserveKg: FuelMassKg;
  inUseSulphurPct: SulphurPct;
}

export interface VoyageFuelTracker {
  bunker(amountKg: FuelMassKg, sulphurPct: SulphurPct, clock: Clock): void;
  consumeLeg(legBurnKg: FuelMassKg, clock: Clock): void;
  switchFuel(newSulphurPct: SulphurPct, clock: Clock): void;
  current(): FuelState;
  checkReserve(): { ok: boolean; shortfallKg: FuelMassKg };
  // Conservation check:
  totalLoaded(): FuelMassKg;
  totalConsumed(): FuelMassKg;
  // Invariant: totalLoaded - totalConsumed == current().onboardKg (within rounding)
}

export function createVoyageFuelTracker(initial: FuelState, log: EventLog): VoyageFuelTracker;
```

how to implement:
1. Each method appends to `log`: `"FUEL_BUNKERED"`, `"FUEL_CONSUMED"`, `"FUEL_SWITCHED"`.
2. `totalLoaded` and `totalConsumed` are computed by scanning the log (event-sourced).
3. `checkReserve`: `ok = onboardKg >= reserveKg`.

acceptance (`test/core/voyage-fuel.test.ts`):
- Bunker 100 t, consume 30 t: `current().onboardKg = 70 t`.
- Conservation invariant: `totalLoaded - totalConsumed === current().onboardKg` after any sequence.
- Fuel below reserve: `checkReserve().ok === false`.
- Switch fuel: `current().inUseSulphurPct` updates.

---

**`S13` — Seed nautical fixture (two vessels + adversarial scenario)**
dependsOn: `S05`, `S08`, `S09`
files: `src/fixtures/seed-voyage.ts`

interface:
```ts
// src/fixtures/seed-voyage.ts
export const SEED_GRAPH: NauticalGraph;          // 10+ nodes; the illegal shortest path crosses shallow+restricted+ECA
export const SEED_VESSEL_A: { id: VesselId; class: VesselClass; draftM: Metres; fuelState: FuelState };
export const SEED_VESSEL_B: { id: VesselId; class: VesselClass; draftM: Metres; fuelState: FuelState };
export const SEED_WEATHER: WeatherCell[];        // includes a storm cell on the shorter route
export const SEED_TIDES: TideLevel[];            // includes a shallow-port tidal window
export const SEED_ILLEGAL_SHORT_PATH: LegId[];   // the short route through shallow+restricted+ECA
export const SEED_COMPLIANT_LONG_PATH: LegId[];  // the longer compliant route
export const DEPARTURE_UTC_MS: UtcMs;
```

how to implement:
1. Design the graph so the direct path has `restricted:true`, `ecaMember:true`, and `maxDraftMetres` less than vessel draft.
2. The compliant path goes around; it is 20–30% longer in NM.
3. Vessel A uses 0.50% fuel; Vessel B starts with 0.08% ECA-compliant fuel.
4. Include a port node with a tidal window that the storm scenario pushes ETA past.

acceptance: file compiles; import test asserts `SEED_ILLEGAL_SHORT_PATH.length >= 2` and `SEED_COMPLIANT_LONG_PATH.length > SEED_ILLEGAL_SHORT_PATH.length`.

---

**`S14` — Adversarial: illegal shortest path rejection**
dependsOn: `S10`, `S13`
files: `test/adversarial/illegal-shortest-path.test.ts`

how to implement the test:
1. Import `SEED_GRAPH`, `SEED_VESSEL_A`, `SEED_ILLEGAL_SHORT_PATH`, etc.
2. Create adapters; call `validateRoute` with vessel A's 0.50% fuel on `SEED_ILLEGAL_SHORT_PATH`.
3. Assert `result.valid === false`.
4. Assert `result.legResults` contains violations for `DRAFT_INVALID`, `RESTRICTED_ZONE`, and `ECA_FUEL_NONCOMPLIANT` (all three).
5. Call `validateRoute` with `SEED_COMPLIANT_LONG_PATH` and 0.08% fuel → `result.valid === true`.

acceptance: both assertions pass; `npm test` green.

---

**`S15` — Adversarial: tidal-window trap**
dependsOn: `S09`, `S10`, `S13`
files: `test/adversarial/tidal-window-trap.test.ts`

how to implement the test:
1. The SEED_TIDES fixture has a port approach passable only in a 2-hour window.
2. Create a scenario where normal transit ETA arrives outside the window (clock advancement puts it after window close).
3. Assert `validateRoute` returns `OUTSIDE_TIDAL_WINDOW` for that leg.
4. Advance clock so ETA falls inside the window → assert `valid:true` for that leg.
5. Speed-up scenario: increase speed → squat increases → `ukc_met:false` even though tidal window is open. Assert both are surfaced.

acceptance: all three assertions pass.

---

**`S16` — COLREGS encounter classifier**
dependsOn: `S03`
files: `src/core/colregs.ts`, `src/adapters/ais-track.ts`, `src/fixtures/ais-tracks.ts`, `test/core/colregs.test.ts`

interface:
```ts
// src/core/colregs.ts
export type EncounterClass = "HEAD_ON" | "CROSSING_GIVE_WAY" | "CROSSING_STAND_ON" | "OVERTAKING" | "RESTRICTED_VISIBILITY";
export interface VesselTrack { courseDegreesTrue: number; speedKts: Knots; posLat: number; posLon: number; }
export interface ColregsResult {
  encounterClass: EncounterClass;
  cpaNm: NauticalMiles;
  tcpaHrs: number;
  requiredAction: string;   // e.g. "alter to starboard", "safe speed / own action"
  bindingRule: string;      // e.g. "Rule 14 head-on", "Rule 15 crossing"
}
export function classifyEncounter(ownVessel: VesselTrack, target: VesselTrack, restrictedVisibility: boolean): ColregsResult;
```

how to implement:
1. Compute relative bearing of target from own vessel.
2. Head-on: relative bearing within ±6° of dead ahead on both vessels → `HEAD_ON`, alter to starboard, Rule 14.
3. Crossing: target on own starboard bow (0–112.5°) → own vessel gives way → `CROSSING_GIVE_WAY`, Rule 15.
4. Crossing: target on own port bow → own vessel stands on → `CROSSING_STAND_ON`, Rule 16–17.
5. Overtaking: target within ±6° of own stern → `OVERTAKING`, Rule 13.
6. If `restrictedVisibility` → all become `RESTRICTED_VISIBILITY`, action = "safe speed / own action", Rule 19.
7. CPA/TCPA: project both vessels at constant course/speed; find minimum separation; compute time to it. (Simple Euclidean approximation over degrees is acceptable for the fixture scale — add KNOWLEDGE-DEBT comment.)

acceptance (`test/core/colregs.test.ts`):
- Exact head-on: `HEAD_ON`, action "alter to starboard", Rule 14.
- Target on own starboard bow, TCPA positive: `CROSSING_GIVE_WAY`.
- Target on own port bow: `CROSSING_STAND_ON`.
- `restrictedVisibility:true`: any of the above becomes `RESTRICTED_VISIBILITY`, action contains "own action".
- COLREGS function is total: every track pair returns exactly one `EncounterClass` (no throw).

---

**`S17` — Port-call scheduler with delay propagation**
dependsOn: `S03`, `S04`
files: `src/core/port-call-scheduler.ts`, `test/core/port-call-scheduler.test.ts`

interface:
```ts
// src/core/port-call-scheduler.ts
export interface PortCall {
  id: string;
  vesselId: VesselId;
  portNodeId: NodeId;
  etaUtcMs: UtcMs;
  berthWindowOpenMs: UtcMs;
  berthWindowCloseMs: UtcMs;
  pilotRequiredMinutes: number;
  tugRequiredMinutes: number;
  cargoReadyMs: UtcMs;
}
export type PortCallStatus = "scheduled" | "arrived" | "delayed" | "missed_window";

export interface PortCallScheduler {
  schedule(portCall: PortCall): void;
  reportArrival(portCallId: string, actualArrivalMs: UtcMs): { status: PortCallStatus; windowMissed: boolean };
  propagateDelay(portCallId: string, delayMs: number): Array<{ portCallId: string; newEtaMs: UtcMs }>;
  // Returns all downstream port calls for this vessel that need rescheduling.
  getAll(): PortCall[];
}
export function createPortCallScheduler(log: EventLog): PortCallScheduler;
```

how to implement:
1. `reportArrival`: if `actualArrivalMs > berthWindowCloseMs` → `missed_window`; else `arrived`.
2. `propagateDelay`: add `delayMs` to all future port calls for the same vessel (those with `etaUtcMs > portCall.etaUtcMs`).
3. Never double-book: if two vessels have the same `portNodeId` with overlapping windows, flag (but don't auto-resolve — raise a conflict event).

acceptance (`test/core/port-call-scheduler.test.ts`):
- Arrival within window → `arrived`.
- Arrival after window close → `missed_window`.
- Delay propagation: 2-hour delay on call A shifts all subsequent calls for the same vessel by 2 hours.
- Two vessels at same port with non-overlapping windows: no conflict.

---

**`S18` — Voyage event projector (after-action report)**
dependsOn: `S04`, `S11`, `S12`
files: `src/core/voyage-projector.ts`, `test/core/voyage-projector.test.ts`

interface:
```ts
// src/core/voyage-projector.ts
export interface VoyageTimelineEntry {
  seq: number; clockMs: UtcMs; eventType: string; summary: string; payload: unknown;
}
export function projectVoyageTimeline(log: EventLog): VoyageTimelineEntry[];
export function renderVoyageReport(timeline: VoyageTimelineEntry[]): string;
// Deterministic: same log ⇒ identical string. No Date.now().
```

how to implement: identical pattern to project-05 `S18` (switch over event types, join as text lines).

acceptance: same log → identical `renderVoyageReport` output across two calls; golden master test.

---

**`S19` — Adversarial: ECA mid-leg fuel switch**
dependsOn: `S11`, `S13`
files: `test/adversarial/eca-boundary-mid-leg.test.ts`

how to implement the test:
1. Create a leg fixture that enters an ECA partway through.
2. Record a `FUEL_SWITCH` event timestamped *after* the ECA boundary crossing → `sulphurCertificate` reports a non-compliant window.
3. Record the fuel switch *before* the boundary → `sulphurCertificate` is compliant.
4. The "late switch" case must cite the overshoot (how many seconds late).

acceptance: both cases produce the correct `compliant` value; late switch cites the overshoot.

---

**`S20` — Adversarial: storm reroute**
dependsOn: `S10`, `S08`, `S13`
files: `test/adversarial/storm-reroute.test.ts`

how to implement the test:
1. The seed weather fixture has a storm cell on the direct route.
2. `validateRoute` on the direct path with the storm cell → `diversionTriggered:true` on that leg.
3. The alternative (longer) route has calm weather → `diversionTriggered:false`.
4. Assert that the alternative route is itself re-validated: it passes all constraint checks (not just weather).
5. Assert the reroute adds distance (in NM) and the difference is explained in `summary`.

acceptance: all assertions pass.

---

**`S21` — Adversarial: low-fuel exception**
dependsOn: `S12`, `S07`, `S08`
files: `test/adversarial/low-fuel-exception.test.ts`

how to implement the test:
1. Set up a voyage with fuel loaded that exactly covers the planned route.
2. Apply a storm (sea-state factor 1.25) → `computeFuelBurn` returns a higher burn.
3. After consuming the storm leg, `checkReserve().ok === false`.
4. Assert that the event log contains a `FUEL_CONSUMED` event for the storm leg with a higher-than-planned `legBurnKg`.

acceptance: reserve check fails; event log proves the over-burn.

---

**`S22` — Seed scenario end-to-end**
dependsOn: `S13`, `S14`, `S15`, `S16`, `S17`, `S18`, `S19`, `S20`, `S21`
files: `test/integration/seed-voyage.test.ts`, `test/golden/seed-voyage-report.txt`

how to implement the test:
1. Import all seed fixtures.
2. Script the two-vessel scenario (advance clock in steps):
   - t=0: Create voyage for vessel A; reject `SEED_ILLEGAL_SHORT_PATH` with all three violations.
   - t=1h: Accept `SEED_COMPLIANT_LONG_PATH`; validate it fully.
   - t=3h: Storm cell encountered; reroute triggered; new path validated.
   - t=6h: Vessel A approaches ECA; fuel switch logged at the boundary; compliance certificate checked.
   - t=10h: Vessel B misses berth window (port-congestion cascade); delay propagated to next port call.
   - t=12h: Low-fuel exception on vessel A (storm over-burn); reserve check fails.
   - t=15h: Close voyage; render report.
3. On `REGEN_GOLDEN=1` write to `test/golden/seed-voyage-report.txt`.
4. On normal run assert equality to golden file.

acceptance: all assertions pass; golden master matches; `npm test` green.

---

### 3. The decomposition method for the rest

After `S01`–`S22` pass, apply this recipe to expand the remaining breadth:

**Recipe**

1. **Pure physics/calculation first** (no I/O): the module is a function `(inputs) → result` with no side effects.
2. **Wire to event log second**: if the result changes voyage state, emit the right event type.
3. **Adversarial fixture third**: one test file per invariant violation the spec lists.
4. **Adapter last**: fixture implementation first, live-production interface as a stub with a KNOWLEDGE-DEBT comment.

---

**Worked example A — CII/EEXI annual rating**

Larger feature: "Compute annual CII carbon-intensity rating from voyage events."

Break into:

- **C01** — `CiiRatingInput` type (totalFuelConsumedTons, voyageDistanceNm, vesselCapacityTons). dependsOn: `S03`.
- **C02** — `computeCiiRating(input): { attainedCii: number; requiredCii: number; rating: "A"|"B"|"C"|"D"|"E" }`. Pure function; add KNOWLEDGE-DEBT for MEPC-currency. dependsOn: `C01`.
- **C03** — Wire: scan voyage log for `FUEL_CONSUMED` events; compute `totalFuelConsumedTons`; call `computeCiiRating`. dependsOn: `C02`, `S04`.
- **C04** — Pin tests: vessel that consumed 2000 t over 10 000 NM gets a specific rating; changing consumption changes rating deterministically. dependsOn: `C03`.

**Worked example B — PSC risk-profile model**

Larger feature: "Estimate port-state-control detention risk before a port call."

Break into:

- **P01** — `VesselRiskProfile` type (age, flagState, roPerformanceScore, openDeficiencies, lastInspectionUtcMs). dependsOn: `S03`.
- **P02** — `computePscRisk(profile): { riskTier: "LOW"|"STANDARD"|"HIGH"; detentionProbabilityPct: number; drivingFactors: string[] }`. Pure; add KNOWLEDGE-DEBT for Paris/Tokyo MOU regime differences. dependsOn: `P01`.
- **P03** — Trigger: when a port call is scheduled at a port in the Paris-MOU fixture, compute risk and emit `PSC_RISK_ASSESSED` event. dependsOn: `P02`, `S17`, `S04`.
- **P04** — Pin tests: old vessel, high-flag risk, 6 open deficiencies → `HIGH` tier; recent clean vessel → `LOW`. dependsOn: `P03`.

**Worked example C — Berth reporting compliance event**

Larger feature: "Berth-arrival reporting must be logged as a compliance event with proof."

Break into:

- **B01** — `recordBerthReport(ledger, vesselId, portNodeId, arrivalMs, berthId)` → records `BERTH_REPORT` event with all fields. dependsOn: `S11`.
- **B02** — `berth-report-missing.test.ts`: create a port call and mark arrival without calling `recordBerthReport`; assert `sulphurCertificate` notes the missing berth report in its detail. dependsOn: `B01`, `S11`.

---

### 4. Per-task implementation conventions

**File/folder layout**
```
src/
  types/        units.ts, domain.ts
  lib/          clock.ts, prng.ts
  core/         leg-validator.ts, vessel-performance.ts, weather-risk.ts, ukc.ts,
                route-validator.ts, compliance-ledger.ts, voyage-fuel.ts,
                colregs.ts, port-call-scheduler.ts, voyage-projector.ts
  adapters/     nautical-graph.ts, weather-field.ts, tide.ts, ais-track.ts, bunker.ts, port-schedule.ts
  fixtures/     nautical-graph.ts, seed-voyage.ts, weather-field.ts, tide.ts, ais-tracks.ts
  rule-packs/   eca-zones-v1.ts, sulphur-limits-v1.ts   (versioned rule packs, not hardcoded)
test/
  lib/          clock, prng
  types/        units, domain
  core/         one file per core module
  adapters/     one file per adapter contract
  adversarial/  illegal-shortest-path, tidal-window-trap, eca-mid-leg, storm-reroute, low-fuel
  integration/  seed-voyage
  golden/       seed-voyage-report.txt
```

**Named adapters (rule)**
Every file in `src/adapters/` exports an interface and a `createFixture<X>Adapter` factory. The live sibling is a stub with `// KNOWLEDGE-DEBT: live-production — <what it would connect to>`.

**How to write a test in this stack (snippet)**
```ts
// test/core/leg-validator.test.ts
import { describe, it, expect } from "vitest";
import { validateLeg } from "../../src/core/leg-validator.js";
import { nm, kts, m, sulphurPct, utcMs } from "../../src/types/units.js";

describe("leg-validator", () => {
  it("rejects draft-invalid leg", () => {
    const result = validateLeg({
      edge: { id: "L1", from:"A", to:"B", distanceNm: nm(50), maxDraftMetres: m(8), restricted:false, ecaMember:false },
      vesselDraftMetres: m(9),
      vesselSpeedKts: kts(12),
      inUseFuelSulphurPct: sulphurPct(0.50),
      currentClockMs: utcMs(0),
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some(v => v.reason === "DRAFT_INVALID")).toBe(true);
  });
});
```

**Definition of done for any card**
- All files listed exist; TypeScript compiles with `strict:true`; no raw `number` where a branded unit is required; `npm test` green; no `Date.now()`, `Math.random()`, or HTTP.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1 — Returning the shortest path without validating it**
The most common failure: the model implements Dijkstra and returns the route without running `validateLeg` on each edge. The entire spec hinges on rejecting the shortest path when it violates a constraint. `S06` (leg validator) must be built before `S10` (route validator) and called for every leg. The test in `S14` ensures this: it must fail if validation is skipped.

**Pitfall 2 — Using raw `number` types for units**
The model will mix NM with km, knots with m/s, or kg with metric tons. The branded units in `S03` prevent this at compile time. If the model removes brands ("to simplify"), TypeScript will stop catching dimension errors and tests become meaningless. Never strip the brand wrappers; always use the constructor functions (`nm()`, `kts()`, `m()`, etc.).

**Pitfall 3 — Hardcoding ECA boundaries instead of a rule pack**
ECA boundaries are defined in `src/rule-packs/eca-zones-v1.ts` and read by the leg validator. The model will often hardcode `if (legId === "X") { ecaMember = true }`. This breaks the swappable-rule-pack invariant. The graph fixture carries `ecaMember:boolean` per edge; the validator reads the edge's property; the rule pack defines which node pairs are ECA members (used when building the fixture).

**Pitfall 4 — Fuel burn as a linear function of distance**
`burn = distance × fuelPerNm` is wrong; it ignores speed and sea state. The Admiralty coefficient model (`S07`) makes burn a function of `P × duration`, where `P` grows as `V³`. The monotonicity acceptance test (`fuel(higher speed) > fuel(lower speed)`) catches a linear model immediately because the cube-law shape is steeper than linear at high speed.

**Pitfall 5 — Forgetting the tidal-window time-coupling**
UKC depends on `tide_water_level` at the *estimated arrival time*, not at departure. The model often computes UKC at departure (tide = baseline) and misses that a 4-hour delay shifts the tidal phase. `S09`'s `TideAdapter.waterLevelAt(nodeId, atUtcMs)` takes the arrival timestamp; always pass the computed arrival time, not the departure time.

**Pitfall 6 — Compliance events without proof fields**
A `FUEL_SWITCH` event without `{ legId, positionNodeId, clockMs, fuelGradeSulphurPct }` is not a compliance record — it is a status change. The `sulphurCertificate` projection checks that every ECA entry has a prior switch event with the full proof fields. The model often emits a bare event; the `S19` adversarial test catches a switch recorded without timing.

**Pitfall 7 — `COLREGS` as a lookup table instead of a rule**
The model will hardcode a few cases and miss others (e.g., overtaking from astern). The classifier must be total: every track pair returns exactly one `EncounterClass`. Write one test assertion per COLREGS rule case in `S16`; if a case throws or returns `undefined`, the totality test fails.

**Pitfall 8 — Port-call delay propagation not cascading downstream**
`propagateDelay` must shift all subsequent port calls for the same vessel, not just the next one. The model often only updates the immediately next call. The acceptance test in `S17` chains three consecutive port calls; the delay must ripple to all three.
