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
