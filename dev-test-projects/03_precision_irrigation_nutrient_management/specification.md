# 03 - Precision Irrigation and Nutrient Management Platform

Complexity tier: 3/20
Expected decomposition size: 16-20 dependent implementation cards before coding.
Domain pressure: agronomy, irrigation scheduling, soil water balance, fertigation planning, weather risk, sensor quality control.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a precision agriculture platform for specialty-crop farms that combines fields, soil zones, weather, evapotranspiration, irrigation events, and nutrient plans into decision support. The foundation must behave like a real farm operations product, not a chart demo.

## Foundation release scope
The first serious buildout must include:
- Farm, field, block, crop, soil zone, irrigation line, sensor station, weather station, nutrient product, and application event models.
- Daily soil-water balance calculation using crop coefficient, reference evapotranspiration, rainfall, irrigation, root depth, and allowable depletion.
- Sensor ingestion pipeline with plausibility checks for stuck probes, impossible jumps, missing intervals, and unit conversion.
- Irrigation recommendation engine that can explain recommended runtime, deficit, forecast rain risk, and pump capacity constraints.
- Fertigation plan that tracks nitrogen, phosphorus, potassium, product concentration, irrigation compatibility, and seasonal limits.
- Zone comparison views for under-watered, over-watered, and sensor-unreliable blocks.
- Scenario planner for heatwave, pump outage, and restricted water allocation.
- Seed data for orchards or vineyards with heterogeneous soils and partial sensor failures.

## Architecture requirements
- Put agronomic calculations in pure modules with injected clocks and weather fixtures.
- Separate raw sensor readings, quality-controlled readings, derived agronomic state, and recommendations.
- Use typed units for depth, flow, concentration, area, mass, and time to avoid silent conversion bugs.
- Make recommendation explanations stable enough for golden tests.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Evapotranspiration and crop coefficients are approximations that require visible assumptions.
- Irrigation scheduling is constrained by hydraulics, water rights, labor windows, and forecast uncertainty.
- Nutrient recommendations need mass balance and product concentration, not just textual plan items.
- Sensor data should be distrusted until quality-controlled.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Water balance tests cover rainfall, irrigation, heatwave, sensor failure, and root-depth change cases.
- Recommendations include numerical rationale and machine-readable constraints.
- Nutrient totals reconcile by crop block and season.
- Bad sensor readings are quarantined without deleting raw data.
- The project passes npm test deterministically.

## Explicit non-goals
- Do not call external weather APIs; use fixture adapters.
- Do not represent all agronomy values as strings.
- Do not hide calculation assumptions inside UI components.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single defining property of this project: it is a *conservation-law engine for water and nutrients under uncertainty*** — every drop and every gram of N/P/K must close a daily mass balance that is reconstructable from immutable events, while the inputs (ET, sensors, weather, hydraulics) are all approximate, noisy, or partially failed, and the recommendations it emits move real water under real legal and hydraulic constraints. The hard part is not the agronomy formula; it is being *honestly, auditably right* about a budget when half the meter readings are lying to you.

## E0. Thesis: why irrigation+nutrients is a deceptively hard determinism challenge

A naive build computes `ETc = Kc × ETo`, subtracts rain and irrigation, and prints a number. That demo passes a happy-path test and is **wrong in every way that matters on a real farm**: it trusts sensors that stick, ignores that ETo itself is a derived quantity with its own input chain, treats "available water" as a scalar when it is a per-zone, per-root-depth, per-soil-texture function, and emits runtimes a pump cannot physically deliver. The disciplined build treats the whole farm as **two coupled conservation systems** — a soil-water bucket model and an N/P/K mass-balance ledger — both folded deterministically from an append-only event log of (quality-controlled) observations, with **every external input behind a fixture adapter and a virtual clock**. The grading rubric is:

1. **Conservation** — does water in/out and N/P/K in/out close to within a stated tolerance every simulated day, per zone and per season, reconstructable from events?
2. **Honest uncertainty** — is every derived quantity (ETo, ETc, depletion, sensor-implied VWC, leaching) tagged with its data-quality and the assumptions behind it, so a recommendation can be refused or widened when inputs are weak?
3. **Physical & legal feasibility** — does every recommendation respect hydraulics (pump capacity, distribution uniformity), labor/water-rights windows, and forecast risk — never emitting an impossible or illegal runtime?
4. **Determinism** — does `runSeason(seed, days, scenarioPack)` produce byte-identical state and recommendations twice?

Everything below serves those four.

## E1. Research-grounded domain authenticity (the standards & the math)

**Reference evapotranspiration — FAO-56 Penman-Monteith** is the anchor and must be implemented from the actual equation, not a black box ([FAO Irrigation & Drainage Paper 56, ch.2/ch.4](https://www.fao.org/4/x0490e/x0490e06.htm); [revised FAO-56 guidance, MDPI Water 2026](https://www.mdpi.com/2073-4441/18/7/793)):

> `ETo = [0.408·Δ·(Rn − G) + γ·(900/(T+273))·u₂·(es − ea)] / [Δ + γ·(1 + 0.34·u₂)]`  (mm·day⁻¹)

with `Rn` net radiation (MJ·m⁻²·day⁻¹), `G` soil heat flux (≈0 daily), `T` mean 2 m air temp (°C), `u₂` 2 m wind (m·s⁻¹), `es−ea` vapour-pressure deficit (kPa), `Δ` slope of the saturation-vapour-pressure curve (kPa·°C⁻¹), `γ` psychrometric constant. The **reference surface is the hypothetical 0.12 m grass, surface resistance 70 s·m⁻¹, albedo 0.23**. ETo is itself a *derived node* — its inputs (radiation, humidity, wind) come from a weather fixture and each carries data-quality; the spec must make ETo's provenance explicit (this is exactly the "ET is an approximation requiring visible assumptions" debt the base spec names).

**Crop coefficient — single AND dual Kc.** Single: `ETc = Kc · ETo`. The richer, research-grade method is the **dual crop coefficient** `Kc = Kcb + Ke`, splitting plant transpiration (basal `Kcb`) from soil-surface evaporation (`Ke`), with `Ke` driven by a separate topsoil evaporation layer that wetting events (rain/irrigation) reset ([FAO-56 dual-Kc annex, NV Div. of Water Resources](https://water.nv.gov/mapping/et/Docs/Annex_1.pdf)). Dual Kc matters because **fertigation and drip wet only part of the surface**, and a single-Kc model systematically misestimates losses right after irrigation. Build single-Kc first; make the evaporation layer a clean extension point for dual-Kc (a great decomposition seam).

**Soil-water balance — the bucket model with the real thresholds** ([UMN Extension water-balance method](https://extension.umn.edu/irrigation/evapotranspiration-based-irrigation-scheduling-or-water-balance-method); [CSU Extension checkbook/water-balance, no.4.707](https://irrigationtoolbox.com/ReferenceDocuments/BasicWaterManagement/checkbook_method_CSU_no.4.707.pdf); [Clemson, checkbook vs FAO-56](https://lgpress.clemson.edu/publication/irrigation-scheduling-methods-checkbook-vs-fao-56/)):
- **Total Available Water** `TAW = (θ_FC − θ_WP) · Zr` — field-capacity minus wilting-point volumetric water content over root depth `Zr`.
- **Readily Available Water** `RAW = p · TAW`, where `p` is the depletion fraction (crop/ET-dependent, commonly 0.4–0.6).
- **Daily root-zone depletion** `Dr,today = Dr,yesterday + ETc − (P − RO) − I − CR + DP`, where `P` precip, `RO` runoff, `I` net irrigation, `CR` capillary rise, `DP` deep percolation. Depletion is bounded `0 ≤ Dr ≤ TAW`; the amount above TAW that a wetting event would add is **deep percolation `DP`** (this is the leaching driver, and it is NOT optional — it's where over-irrigation becomes nitrate loss).
- **Irrigation trigger:** irrigate when `Dr ≥ RAW` (i.e. management-allowable-depletion `MAD` reached); the **net irrigation requirement** is the depth to refill to field capacity (`Dr` mm), and the **gross/applied depth** = `net / (DU or application efficiency)`.

The physical constants are well-established and must live in a **soil-texture table**, not magic numbers: θ_FC at −0.033 MPa (field capacity), θ_WP at −1.5 MPa (permanent wilting point); sandy ≈ FC 15–25 % / WP 5–10 %, loam ≈ FC 35–45 % / WP 10–15 %, clay ≈ FC 45–55 % / WP 15–20 % ([Cornell NRCCA soil hydrology](https://nrcca.cals.cornell.edu/soil/CA2/CA0212.1-3.php); [METER Group soil-moisture sensing](https://metergroup.com/measurement-insights/soil-moisture-sensors-how-they-work-why-some-are-not-research-grade/)).

**Sensor physics & QC.** Soil-moisture sensors are not interchangeable: **TDR/FDR/capacitance** report apparent dielectric → VWC and **need site/soil calibration** and are salinity-sensitive; **tensiometers / matric-potential** sensors report tension (kPa) directly and are calibration-free but read a different quantity that must be mapped to depletion via the **soil-water characteristic (retention) curve** ([UCANR soil-moisture sensors](https://ucanr.edu/site/irrigation-and-nutrient-management/soil-moisture-sensors); [Nebraska CropWatch SWC vs SMP triggers](https://cropwatch.unl.edu/2019/SWC-SMP-irrigation-trigger-values/)). The ingestion pipeline must therefore carry a **sensor type + calibration model + units** and convert into a *common depletion space* — a unit/semantic conversion bug here silently corrupts the whole balance, which is exactly why the base spec demands typed units.

**Nutrient mass balance — a real N/P/K budget, not a checklist.** Fertigation injects nutrients through irrigation; the budget must track **applied vs. crop-uptake-removal vs. losses**, with the three N loss pathways modeled distinctly — **leaching** (NO₃⁻ moving below the root zone with deep-percolation water — a *physical* event tied directly to `DP` from the water balance), **denitrification** (anaerobic NO₃⁻→N₂O/N₂ when soil is saturated ≥2–3 days), and **volatilization** (NH₃ loss from urea/ammonium surface applications) ([UMN Understanding N in soils](https://extension.umn.edu/nitrogen/understanding-nitrogen-soils); [PSU nutrient-management N efficiency](https://extension.psu.edu/nutrient-management-to-improve-nitrogen-efficiency-and-reduce-environmental-loss); [NLEAP model description](https://www.researchgate.net/publication/300328755_Nitrate_Leaching_and_Economic_Analysis_Package_NLEAP_Model_Description_and_Application)). The **leaching fraction couples the two conservation systems**: over-irrigation (water-balance `DP`) *is* the nutrient-loss driver (nutrient-balance leaching) — getting that coupling right is the most agronomically authentic thing the build can do. Product concentration math (N-P-K guaranteed analysis %, fertilizer salt → elemental conversion, injection ratio, EC/compatibility of mixed stock solutions) must be elemental and conservative ([NRCS 590 Nutrient Management standard](https://www.nrcs.usda.gov/sites/default/files/2022-09/NRCS_590_Standard.pdf); [Coupling P-fertilizer type & drip fertigation, ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0378377423004675)).

**Hydraulics & uniformity gate recommendations.** A runtime is only valid if the system can deliver it: **Distribution Uniformity** `DU = (avg of low-quarter applied) / (avg applied)` and **Christiansen CU** characterize how evenly water lands; drip targets DU ≥ 90–95 %, and **emitter clogging** degrades DU over the season ([ScienceDirect, drip uniformity vs emitter type/pressure](https://www.sciencedirect.com/science/article/pii/S0378377425001325)). The **gross application depth = net ÷ DU**, pump **flow capacity** (zone area × precipitation rate) bounds the achievable depth-per-window, and runtime = required gross depth ÷ system precipitation rate. A recommendation that exceeds the pump's deliverable depth in the available labor/legal window must be **flagged infeasible with the binding constraint named**, not silently emitted.

**Data interchange / interoperability** is real and should be an extension point, not invented: **ISOBUS / ISO 11783** (Part 10 Task Controller, TC-GEO variable-rate + as-applied logging, ISO-XML) and **AgGateway ADAPT** (the cross-vendor farm-data standard, v1.0 released 2024) are how application events and management zones move between equipment and FMIS ([ISO 11783-10](https://www.iso.org/standard/61581.html); [Wikipedia ISO 11783](https://en.wikipedia.org/wiki/ISO_11783); [AgGateway ADAPT](https://adaptframework.org/)). The application-event model should be shaped so an ISO-XML/ADAPT import-export adapter slots in later without a rewrite.

## E2. The hardest technical seams (named)

1. **The four-layer state separation (the load-bearing decomposition).** The base spec demands it; v2 makes it a hard contract: **(L0) raw observations** (immutable, append-only — every sensor reading, weather record, manual entry, application event, exactly as received) → **(L1) quality-controlled observations** (QC verdicts attached, *never mutating L0*; quarantine is a label + reason, not a delete) → **(L2) derived agronomic state** (ETo, ETc, per-zone depletion, N/P/K balance — a pure fold over L1 at a virtual-clock date) → **(L3) recommendations** (runtime, deficit, deferral, fertigation plan, each with rationale + machine-readable binding constraints). L2 must be a **pure function of L1 + config + clock**; replaying the same L1 yields the same L2 (golden-testable). This is the seam most builds get wrong by mutating readings in place or computing recommendations off raw data.

2. **Typed units & dimensional safety.** Depth (mm), volume (L, m³, acre-inch), flow (L·h⁻¹, gpm), area (m², ha, acre), concentration (mg·L⁻¹, %, ppm, meq·L⁻¹), mass (kg, g), EC (dS·m⁻¹), pressure/tension (kPa, MPa, bar), VWC (m³·m⁻³, %), time (virtual-clock days/intervals). A **branded-type unit system** (or a vetted library) so `mm` and `m³` can never be added; conversions are explicit, audited, and total. The base spec's "do not represent agronomy values as strings" is a *hard* requirement: a stringly-typed concentration is the canonical silent-corruption bug.

3. **Sensor → depletion reconciliation (two estimates of the same truth).** The model has **two independent estimates of root-zone water**: the *water-balance bucket* (ETc-driven) and the *sensor-implied* VWC (calibrated reading → depletion). These will disagree. The system must **reconcile**, not pick blindly: weight by data-quality, detect drift (sensor says wet, balance says dry → either a sensor fault or an unlogged irrigation/rain), and surface the discrepancy as a first-class signal. "Sensor-unreliable block" in the base spec's zone-comparison view *is* this reconciliation surfacing a low-confidence zone.

4. **Coupling the water and nutrient ledgers through deep percolation.** Deep-percolation `DP` from the water balance is the *input* to the nutrient leaching term. They cannot be computed independently. The fold must compute water first, emit `DP`, then drive nutrient leaching from it — an ordering dependency the decomposition must encode (nutrient module depends on water module).

5. **Forecast-risk-aware recommendation under a virtual clock.** "Should I irrigate today?" depends on **forecast rain** (seeded weather fixture) and its uncertainty. The engine must trade off irrigating now vs. deferring for likely rain — and be **conservative when forecast confidence is low** — emitting a deferral recommendation with the probability/quantity it is betting on. Heatwave and pump-outage scenarios (base spec) stress this directly.

6. **Idempotent, replayable ingestion.** Re-ingesting the same sensor batch (duplicate delivery, retried import) must not double-count. Observations are keyed by `(station, channel, timestamp)`; ingestion is idempotent; the L2 fold is deterministic. This makes the whole pipeline crash-safe and test-replayable.

## E3. Determinism & testability strategy

- **Virtual clock everywhere.** No `Date.now()`/`setTimeout`. Daily balance steps, decay of sensor trust, forecast horizons, season boundaries, and labor windows all read an injected clock. `runSeason(seed, days)` advances it deterministically.
- **Seeded fixtures for every external input** behind named adapters: `WeatherAdapter` (seeded daily ETo inputs + a forecast with controllable error vs. realized weather), `SensorAdapter` (seeded VWC/tension streams with injectable faults), `MarketWaterAllocationAdapter` (water-rights/quota), `PumpHydraulicsAdapter` (capacity, DU degradation). The acceptance command (`npm test`) **never touches the network**.
- **Event-sourced L0/L1.** Observations and application events are an append-only log; L2/L3 are projections. Snapshot/restore at any virtual day; kill-and-resume must reproduce identical L2.
- **Golden recommendation outputs.** Recommendation rationale strings + machine-readable constraint objects are golden-tested (the base spec asks for "stable enough for golden tests"); the structured constraint object is the contract, the prose is rendered from it.
- **Seeded-weather + sensor-fixture scenario packs** ship in-repo: `normal_season`, `heatwave_week`, `pump_outage`, `restricted_allocation`, `sensor_failure_mixed`, `forecast_misses_rain`.

## E4. Adversarial / failure / edge-case fixture pack (the QC suite is the point)

Ship these as deterministic fixtures the engine must survive correctly — they separate a real farm tool from a chart demo:

- **Stuck probe** — a sensor reports the identical VWC for N intervals across a rain event the balance expected to move it → flagged stuck, quarantined (raw preserved), zone falls back to balance estimate, confidence lowered.
- **Impossible jump** — VWC leaps beyond physical infiltration/drainage rate between intervals → flagged, quarantined, not allowed to drive a recommendation.
- **Missing intervals / gaps** — a station goes dark for hours/days → gap detected, balance carries forward on ETc alone with rising uncertainty, recommendation widens or defers to manual confirmation.
- **Unit/calibration mismatch** — a station delivers tension where VWC expected, or an uncalibrated raw count → conversion guard catches the dimensional mismatch rather than silently mis-scaling the budget.
- **Sensor-vs-balance contradiction** — sensor says field capacity, balance says MAD reached (unlogged irrigation or a faulty probe) → reconciliation surfaces the discrepancy; does not blindly trust either.
- **Over-irrigation / leaching event** — a runtime that exceeds refill-to-FC drives `DP > 0` and a nutrient-leaching debit; the engine must *predict and warn* about the nutrient loss before recommending it, and the nutrient ledger must still balance.
- **Pump cannot deliver** — required gross depth in the labor window exceeds pump capacity × DU → infeasible recommendation with the binding constraint named (capacity vs. window vs. uniformity).
- **Water-rights curtailment** — allocation adapter cuts the seasonal/seasonal-to-date quota mid-season (SGMA-style) → recommendations re-plan under the cap, prioritize highest-stress zones, and never recommend exceeding the legal allocation ([SGMA overview](https://water.ca.gov/programs/groundwater-management/sgma-groundwater-management); [Water Education Foundation SGMA](https://www.watereducation.org/aquapedia-background/sustainable-groundwater-management-act-sgma)).
- **Forecast miss** — fixture forecast predicts rain that does not arrive (and vice-versa); deferral logic must degrade gracefully and the post-hoc balance must still close.
- **Fertigation incompatibility** — two stock solutions that precipitate when mixed (e.g. Ca + phosphate/sulfate) or push EC past a crop limit → plan flags incompatibility and refuses the co-injection.
- **Root-depth change** — a growth-stage transition increases `Zr`, changing TAW/RAW mid-season; the balance must handle the step without conservation leaking (the base spec's "root-depth change" water-balance case).

## E5. Rigorous acceptance criteria — property-based / invariant tests

Beyond the base spec's example tests, assert **domain invariants** as property-based tests over randomized + scripted seeds:

1. **Water conservation (per zone, per day, per season).** `Σ(inputs: rain + irrigation + capillary rise) − Σ(outputs: ETc + runoff + deep percolation) == ΔStorage` to within a stated tolerance ε. Fuzz weather + irrigation schedules; the bucket may never create or destroy water. Storage stays bounded `0 ≤ Dr ≤ TAW`.
2. **Nutrient (N/P/K) mass conservation.** `applied − crop_removal − (leaching + denitrification + volatilization) == ΔSoilPool` per element, per block, per season — the base spec's "nutrient totals reconcile by crop block and season" promoted to a fuzzed invariant. Elemental, never stringly.
3. **Water↔nutrient coupling consistency.** Whenever water-balance `DP > 0`, nutrient leaching for that day/zone is `> 0` (and zero when `DP == 0`) — the two ledgers cannot disagree about whether percolation happened.
4. **Raw-immutability / quarantine totality.** No QC verdict ever mutates or deletes an L0 reading; every quarantined reading has exactly one verdict with a reason code; the raw count is invariant across QC. (Differential test L0-before vs L0-after QC.)
5. **Recommendation feasibility.** Every emitted runtime satisfies pump-capacity, DU, labor-window, and water-rights constraints simultaneously; an infeasible request yields a *flagged* recommendation naming the binding constraint, never a silent impossible number.
6. **Explanation totality.** Every recommendation's rationale traverses only to first-party facts (QC'd observations, config, fixtures) — no recommendation grounded in a quarantined/low-quality leaf may clear without an explicit low-confidence flag (mirrors the base spec's "explainable from source facts").
7. **Idempotent ingestion.** Re-delivering an observation batch leaves L2 byte-identical; `(station, channel, timestamp)` dedup holds under fuzzing.
8. **Determinism.** `runSeason(seed, days)` twice → identical L0/L1/L2/L3.
9. **Monotonicity sanity.** With irrigation and rain held at zero, depletion is non-decreasing day over day under positive ETc (no spontaneous re-wetting).

## E6. Concrete first vertical slice (the on-ramp — build THIS first, ~16–20 cards as scoped)

Prove the spine end-to-end on **one field with two heterogeneous soil zones (one drip-fed orchard block, one with a partially failed sensor)** before any breadth:

1. **Typed-unit kernel** (depth/volume/flow/area/concentration/mass/EC/tension/VWC/time) + conversions with tests.
2. **Virtual clock + seeded PRNG** + event-log primitive (append-only L0).
3. **WeatherAdapter + SensorAdapter** fixtures (one normal season + one with injected stuck/missing faults; a forecast stream with controllable error).
4. **ETo (FAO-56 Penman-Monteith)** pure module with explicit input-provenance, golden-tested against a worked FAO-56 example.
5. **Single-Kc ETc + soil-water bucket** (TAW/RAW/MAD, `Dr` recursion with DP) per zone, with the **soil-texture FC/WP table**.
6. **QC pipeline** (stuck / impossible-jump / missing-gap / unit-mismatch) producing L1 without mutating L0; quarantine + reason codes.
7. **Sensor↔balance reconciliation** producing per-zone water state + confidence.
8. **Irrigation recommendation engine**: trigger at MAD, net→gross via DU, runtime via pump capacity, forecast-rain deferral, **infeasibility flagging** — emit rationale + machine-readable constraints (golden).
9. **N/P/K fertigation mass balance** coupled to `DP` for leaching, with elemental product-concentration math and EC/compatibility check.
10. **Zone-comparison view-model** (under-/over-watered/sensor-unreliable) as a pure projection of L2/L3.
11. **Three scenario tests**: `heatwave_week`, `pump_outage`, `restricted_allocation` — each asserting the global invariants (E5) hold.
12. **The season-replay test**: `runSeason(seed, 30 days)` deterministic, water + nutrient conservation never broken, one sensor-failure and one over-irrigation survived correctly.

If that slice is real, scenario planner breadth, dual-Kc, and ISO-XML/ADAPT import are additions on a proven spine.

## E7. Domain knowledge-debt to track (surface, don't bluff)

Each debt item gets an owner, a risk level, and an **expert-review-needed** flag; some are **action-gating** (a recommendation is withheld or widened until resolved):

- **ETo input fidelity** — net-radiation `Rn` is often estimated from sunshine/temperature, not measured; the estimation method and its error must be visible, and a low-quality weather day must lower recommendation confidence. *(Expert: agronomist.)*
- **Crop-coefficient locality** — `Kc`/`Kcb` curves are crop-, climate-, and management-specific; the shipped table is a defensible default needing regional calibration. *(Expert: extension agronomist / local Kc rule pack.)*
- **Soil-texture defaults vs. measured retention** — FC/WP from texture class are coarse; real fields need lab retention curves. Flag zones running on defaults. *(Expert: soil scientist.)*
- **Sensor calibration** — VWC sensors need soil-specific calibration and are salinity-sensitive; an uncalibrated stream is lower-trust. *(Expert: instrumentation.)*
- **Nutrient-loss coefficients** — denitrification/volatilization/leaching rates are model approximations (NLEAP-class); the chosen coefficients are placeholders for an expert-reviewed rule pack. *(Expert: nutrient-management planner; regulatory.)*
- **Water-rights & nutrient regulation** — allocation/curtailment regimes (SGMA, prior-appropriation, nitrate-vulnerable-zone limits) are jurisdiction-specific and **legally binding**; the seasonal-N-cap and allocation logic must be an expert-reviewed, region-pluggable rule pack, and recommendations must hard-stop at legal caps. *(Expert: water/ag-law; **action-gating**.)*
- **Hydraulic model fidelity** — pump curves, DU, and emitter clogging are simplified; real systems need measured DU and pressure-flow curves. *(Expert: irrigation engineer.)*
- **Interoperability conformance** — ISO-XML/ADAPT round-trip fidelity is unverified until tested against real FMIS exports. *(Expert: integration; ADAPT/ISOBUS conformance.)*

## E8. Why this is a great !Klein challenge

It is the *small-scale* sibling of the master colossus and stresses exactly the capabilities !Klein needs to prove with weak local models: **strict dependency-ordered decomposition** (units → clock/log → ETo → balance → QC → reconciliation → recommendation → nutrient coupling — get the order wrong and conservation leaks), **determinism under noisy inputs** (the whole value is being honestly right about a budget when sensors lie — exactly the regime where a small model must *parse-and-recover and tag uncertainty* rather than bluff a confident number), **conservation-law invariants as the test spine** (water and N/P/K mass balance are natural, fuzzable property tests that a weak agent cannot fake its way past), and **honest knowledge-debt + action-gating** (refusing to recommend past a legal water cap or on quarantined data is the agronomic analogue of the colossus's authority gates). A swarm can carve this cleanly: the pure agronomic core (ETo, balance, nutrient ledger) parallelizes behind the typed-unit + event-log primitives, the adapters are independent fixtures, and the recommendation/view layers are projections — legible work, with conservation tests that make the output trustworthy.

---

## Small-model build guide (3B-ready)

### 1. Glossary & ground rules

**Domain terms:**
- **ETo** — Reference evapotranspiration (mm/day): the FAO-56 Penman-Monteith estimate of water use by a hypothetical 0.12 m grass reference surface. It is a *derived* quantity computed from weather inputs (temp, humidity, wind, radiation).
- **ETc** — Crop evapotranspiration (mm/day): `ETc = Kc × ETo`. The actual water demand of a specific crop.
- **Kc** — Crop coefficient (dimensionless). Adjusts ETo for a specific crop and growth stage. Build single-Kc first.
- **TAW** — Total Available Water (mm): `(θ_FC − θ_WP) × Zr`. Water held between field capacity and wilting point over root depth Zr.
- **RAW** — Readily Available Water (mm): `p × TAW`. The fraction a crop extracts without stress. `p` ≈ 0.4–0.6.
- **Dr** — Root-zone depletion (mm). How empty the bucket is. Computed daily: `Dr_today = Dr_yesterday + ETc − (P − RO) − I − CR + DP`. Bounded `0 ≤ Dr ≤ TAW`.
- **DP** — Deep percolation (mm/day). Water draining below root zone when irrigation + rain exceeds field capacity. **Drives nutrient leaching.** `DP = max(0, I + P − CR − ETc − Dr_yesterday)` (equivalently, the amount that would push Dr below 0).
- **MAD** — Management Allowable Depletion. Irrigate when `Dr ≥ RAW`. Net irrigation need = Dr mm.
- **DU** — Distribution Uniformity (fraction 0–1). Drip target ≥ 0.90. Gross depth = net / DU.
- **VWC** — Volumetric Water Content (m³/m³). Sensor reading type.
- **L0** — Raw (immutable) observation log. Never mutated.
- **L1** — Quality-controlled observations: QC verdicts applied to L0, quarantine labels added.
- **L2** — Derived agronomic state: ETo, ETc, Dr, DP, N/P/K balances — a pure fold over L1.
- **L3** — Recommendations: irrigation runtimes, fertigation plans, with rationale.
- **FC** — Field capacity (volumetric water content at −0.033 MPa).
- **WP** — Permanent Wilting Point (volumetric water content at −1.5 MPa).
- **Fertigation** — Applying dissolved fertilizer through the irrigation system.

**Soil texture defaults (must live in a table, not magic numbers):**
| Texture | θ_FC | θ_WP |
|---------|------|------|
| Sandy   | 0.18 | 0.07 |
| Loam    | 0.38 | 0.12 |
| Clay    | 0.48 | 0.17 |

**Stack (explicit):**
- Language: TypeScript (strict mode, no `any`)
- Runtime: Node.js
- Test runner: `npm test` → Vitest (or Jest — check `package.json`; if neither exists, use Vitest)
- No external services in tests; fixture adapters only
- Key patterns: branded types for units, pure functions for calculations, injected clock, append-only event log

**Acceptance command — plain steps:**
1. `cd` to the project root.
2. Run `npm test`.
3. All tests must pass with exit code 0.
4. No network calls. No `Date.now()`. No randomness without a seeded PRNG.

**Determinism rules (imperative):**
- Never call `Date.now()`, `new Date()`, `Math.random()`, or any network API inside core modules or tests.
- Every external input (weather, sensor readings) must come through a named adapter interface with a deterministic fixture implementation.
- The virtual clock is injected; advance it by calling `clock.advance(days)`.
- All physical constants (θ_FC, θ_WP, FAO-56 coefficients) live in named constant tables.
- Use the seeded PRNG in `src/utils/prng.ts` (a simple mulberry32 or similar) for any needed randomness in tests.

---

### 2. The explicit task graph for the first vertical slice

The first vertical slice covers E6 items 1–12 exactly. Each card below is independently implementable and verifiable. Build them in order; only start a card when all its `dependsOn` cards are green.

---

**S01 — Typed-unit kernel**
dependsOn: none
files: `src/units.ts`, `test/units.test.ts`
interface:
```typescript
// Branded scalars — these types cannot be accidentally mixed
export type Mm = number & { readonly __unit: 'mm' }
export type CubicMeters = number & { readonly __unit: 'm3' }
export type LitersPerHour = number & { readonly __unit: 'L/h' }
export type Hectares = number & { readonly __unit: 'ha' }
export type SquareMeters = number & { readonly __unit: 'm2' }
export type MgPerLiter = number & { readonly __unit: 'mg/L' }
export type Kilograms = number & { readonly __unit: 'kg' }
export type DsPerMeter = number & { readonly __unit: 'dS/m' }
export type Kpa = number & { readonly __unit: 'kPa' }
export type VwcFraction = number & { readonly __unit: 'VWC' }  // 0–1
export type DayNumber = number & { readonly __unit: 'day' }

export function mm(v: number): Mm
export function cubicMeters(v: number): CubicMeters
export function litersPerHour(v: number): LitersPerHour
export function hectares(v: number): Hectares
export function squareMeters(v: number): SquareMeters
export function mgPerLiter(v: number): MgPerLiter
export function kilograms(v: number): Kilograms
export function dsPerMeter(v: number): DsPerMeter
export function kpa(v: number): Kpa
export function vwcFraction(v: number): VwcFraction
export function dayNumber(v: number): DayNumber

// Safe conversions — explicit, total
export function mmToLitersPerHectare(depth: Mm): number   // 1 mm * 1 ha = 10,000 L
export function litersPerHectareToMm(v: number): Mm
```
how to implement:
1. Create `src/units.ts`.
2. For each type, define a branded alias: `type Mm = number & { readonly __unit: 'mm' }`.
3. For each constructor function, use a cast: `export const mm = (v: number): Mm => v as Mm`.
4. For conversions, implement the formulas with explicit doc comments showing the formula.
5. Create `test/units.test.ts` with the assertions below.
acceptance: `test/units.test.ts` asserts:
- `mm(25)` has value `25`
- `mmToLitersPerHectare(mm(1))` equals `10000`
- TypeScript compilation passes (no runtime check needed for brand safety; the type system enforces it)
- Run `npm test` → green.

---

**S02 — Virtual clock and seeded PRNG**
dependsOn: S01
files: `src/clock.ts`, `src/prng.ts`, `test/clock.test.ts`
interface:
```typescript
// src/clock.ts
export interface VirtualClock {
  today(): DayNumber        // current virtual day (integer, starts at 0)
  advance(days?: number): void  // default 1 day
  reset(): void
}
export function createClock(startDay?: number): VirtualClock

// src/prng.ts
export interface SeededPrng {
  next(): number  // returns [0, 1)
}
export function createPrng(seed: number): SeededPrng
```
how to implement:
1. `createClock(startDay = 0)`: store current day in a mutable variable; `today()` returns it; `advance(n=1)` adds n; `reset()` sets back to startDay.
2. `createPrng(seed)`: implement mulberry32 — `seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296`.
3. Create `test/clock.test.ts`.
acceptance: `test/clock.test.ts` asserts:
- `clock.today()` starts at 0
- After `clock.advance()`, `clock.today()` is 1
- After `clock.advance(5)`, `clock.today()` is 6
- `createPrng(42).next()` equals a fixed expected value (pin it in the test after first run)
- Same seed produces the same sequence of 3 calls

---

**S03 — Append-only event log (L0)**
dependsOn: S01, S02
files: `src/event-log.ts`, `test/event-log.test.ts`
interface:
```typescript
export type ObservationKind = 'sensor_reading' | 'weather_record' | 'application_event' | 'manual_entry'

export interface RawObservation {
  readonly id: string                  // deterministic: `${stationId}-${channel}-${dayNumber}`
  readonly stationId: string
  readonly channel: string
  readonly dayNumber: DayNumber
  readonly rawValue: number
  readonly rawUnit: string             // e.g. 'VWC', 'kPa', 'mm', 'mm/day'
  readonly kind: ObservationKind
}

export interface EventLog {
  append(obs: RawObservation): void
  getAll(): readonly RawObservation[]
  getByStation(stationId: string): readonly RawObservation[]
  getByDay(day: DayNumber): readonly RawObservation[]
}

export function createEventLog(): EventLog
// Idempotent: appending an obs with duplicate id is a no-op (not an error)
```
how to implement:
1. Create `src/event-log.ts`.
2. Store observations in an array internally.
3. `append`: check for duplicate id (by `obs.id`); if duplicate, skip silently.
4. `getAll()`: return a frozen copy (`[...store]`).
5. `getByStation`, `getByDay`: filter the array.
6. Never mutate an appended observation.
acceptance: `test/event-log.test.ts` asserts:
- Appending 3 unique observations → `getAll().length === 3`
- Appending a duplicate id → `getAll().length` stays 3 (idempotency)
- `getByStation('s1')` returns only s1's records
- `getByDay(dayNumber(2))` returns only day-2 records

---

**S04 — Weather and Sensor fixture adapters**
dependsOn: S01, S02, S03
files: `src/adapters/weather-adapter.ts`, `src/adapters/sensor-adapter.ts`, `src/fixtures/weather-fixtures.ts`, `src/fixtures/sensor-fixtures.ts`, `test/adapters.test.ts`
interface:
```typescript
// src/adapters/weather-adapter.ts
export interface DailyWeather {
  day: DayNumber
  tMin: number        // °C
  tMax: number        // °C
  tMean: number       // °C
  rhMin: number       // % relative humidity min
  rhMax: number       // % relative humidity max
  u2: number          // m/s wind at 2m height
  Rs: number          // MJ/m²/day incoming solar radiation
  Ra: number          // MJ/m²/day extraterrestrial radiation (for Rn estimation)
  n: number           // actual sunshine hours
  N: number           // max possible sunshine hours
  forecastRainMm: number    // forecast rain (mm, may be 0)
  forecastConfidence: number // 0–1
}
export interface WeatherAdapter {
  getDay(day: DayNumber): DailyWeather
  getForecast(day: DayNumber, lookahead: number): DailyWeather[]
}
export function createFixtureWeatherAdapter(records: DailyWeather[]): WeatherAdapter

// src/adapters/sensor-adapter.ts
export type SensorType = 'TDR' | 'capacitance' | 'tensiometer'
export interface SensorReading {
  stationId: string
  channel: string
  day: DayNumber
  rawValue: number
  rawUnit: string    // 'VWC' | 'kPa'
  sensorType: SensorType
  calibrationModel: string   // e.g. 'default_loam', 'uncalibrated'
}
export interface SensorAdapter {
  getReadings(stationId: string, fromDay: DayNumber, toDay: DayNumber): SensorReading[]
}
export function createFixtureSensorAdapter(readings: SensorReading[]): SensorAdapter
```
how to implement:
1. Create both adapter files with the interfaces above.
2. Create `src/fixtures/weather-fixtures.ts`: export `NORMAL_SEASON_WEATHER` — an array of 30 `DailyWeather` records with realistic but fixed values. At minimum days 0–29. Use fixed values, not `Math.random()`.
3. Create `src/fixtures/sensor-fixtures.ts`: export `NORMAL_SEASON_SENSORS` — 30 days of VWC readings for stationId `'z1'`, channel `'vwc'`; and `STUCK_PROBE_SENSORS` where days 5–10 all report the same VWC value despite a rain event on day 7.
4. Fixture adapters: `getDay(day)` finds the matching record in the array; throws if not found.
acceptance: `test/adapters.test.ts` asserts:
- `createFixtureWeatherAdapter(NORMAL_SEASON_WEATHER).getDay(dayNumber(0))` returns a valid record
- `createFixtureSensorAdapter(NORMAL_SEASON_SENSORS).getReadings('z1', dayNumber(0), dayNumber(2))` returns 3 items
- `STUCK_PROBE_SENSORS` days 5–10 all have the same `rawValue`

---

**S05 — ETo (FAO-56 Penman-Monteith) pure module**
dependsOn: S01, S04
files: `src/eto.ts`, `test/eto.test.ts`
interface:
```typescript
export interface EToInputs {
  tMean: number    // °C
  tMin: number     // °C
  tMax: number     // °C
  rhMin: number    // %
  rhMax: number    // %
  u2: number       // m/s
  Rs: number       // MJ/m²/day solar radiation
  Ra: number       // MJ/m²/day extraterrestrial radiation
  elevation: number  // m above sea level (for psychrometric constant)
  dayOfYear: number  // 1–365 (for Rn estimation)
  latitude: number   // degrees (for Rn estimation)
}

export type DataQuality = 'measured' | 'estimated' | 'low'

export interface EToResult {
  eto: Mm                  // mm/day
  dataQuality: DataQuality
  assumptions: string[]    // e.g. ['G assumed 0 for daily step', 'Rn estimated from Rs/Ra']
}

export function computeETo(inputs: EToInputs): EToResult
// FAO-56 Penman-Monteith:
// ETo = [0.408·Δ·(Rn−G) + γ·(900/(T+273))·u2·(es−ea)] / [Δ + γ·(1+0.34·u2)]
// G = 0 (daily step assumption)
// es = (e°(tMax) + e°(tMin)) / 2  where e°(T) = 0.6108 * exp(17.27*T / (T+237.3))
// ea = (e°(tMin)*rhMax/100 + e°(tMax)*rhMin/100) / 2
// Δ = 4098 * e°(tMean) / (tMean+237.3)²
// γ = 0.000665 * P  where P = 101.3 * ((293 - 0.0065*elevation)/293)^5.26  (kPa)
// Rn = Rns - Rnl  (net radiation)
// Rns = (1 - 0.23) * Rs  (albedo 0.23)
// Rnl from FAO-56 eq. 39 (Stefan-Boltzmann, temperature, ea, sunshine fraction)
```
how to implement:
1. Create `src/eto.ts`.
2. Implement each sub-formula as a private named function (e.g. `saturationVapourPressure(T)`, `slopeSaturationCurve(T)`, `psychrometricConstant(elevation)`).
3. For `Rn`: compute `Rns = 0.77 * Rs` (net shortwave, albedo 0.23 → reflectance coefficient 1 − 0.23 = 0.77). For `Rnl` use FAO-56 eq. 39: `Rnl = σ * ((tMax+273.16)^4 + (tMin+273.16)^4)/2 * (0.34 - 0.14*sqrt(ea)) * (1.35*(Rs/(0.75*Ra)) - 0.35)` where σ = 4.903e-9 MJ/m²/day.
4. `dataQuality = 'estimated'` if Rs was derived (not measured); add an assumption string.
5. Add `assumptions` array — always include `'G assumed 0 for daily step'`.
6. Export `computeETo`.
acceptance: `test/eto.test.ts` asserts:
- FAO-56 Table 1 worked example: Inputs: tMin=19.5, tMax=25.5, tMean=22.5, rhMin=42, rhMax=72, u2=2.08, Rs=22.07, Ra=40.55, elevation=0, dayOfYear=135, latitude=45. Expected ETo ≈ 5.0 mm/day (±0.2 mm tolerance). (This is the classic FAO-56 chapter 4 example.)
- `computeETo(...)` returns an object with `eto`, `dataQuality`, `assumptions`.
- `assumptions` array is non-empty.

---

**S06 — Soil texture table and single-Kc ETc + water bucket**
dependsOn: S01, S05
files: `src/soil.ts`, `src/water-balance.ts`, `test/water-balance.test.ts`
interface:
```typescript
// src/soil.ts
export type SoilTexture = 'sandy' | 'loam' | 'clay'
export interface SoilHydraulic {
  thetaFC: VwcFraction   // field capacity
  thetaWP: VwcFraction   // wilting point
}
export const SOIL_TEXTURE_TABLE: Record<SoilTexture, SoilHydraulic>
// { sandy: {thetaFC:0.18, thetaWP:0.07}, loam: {thetaFC:0.38, thetaWP:0.12}, clay: {thetaFC:0.48, thetaWP:0.17} }

// src/water-balance.ts
export interface ZoneConfig {
  zoneId: string
  soilTexture: SoilTexture
  rootDepthMm: number           // Zr in mm
  depletionFraction: number     // p, typically 0.4–0.6
  kc: number                    // single crop coefficient
  areaHa: Hectares
}

export interface DailyBalanceInputs {
  day: DayNumber
  etoMm: Mm
  rainMm: Mm                    // gross precipitation
  runoffFraction: number        // 0–1, fraction of rain that runs off (default 0)
  irrigationNetMm: Mm           // net irrigation applied (mm)
  capillaryRiseMm: Mm           // CR; typically 0
}

export interface DailyBalanceResult {
  day: DayNumber
  zoneId: string
  etcMm: Mm
  dpMm: Mm                      // deep percolation (mm) — nutrient leaching driver
  drMm: Mm                      // root-zone depletion at end of day (mm)
  tawMm: Mm
  rawMm: Mm
  madReached: boolean           // Dr >= RAW
  storageChangeMm: Mm           // for conservation check: should == inputs - ETc - DP - runoff
}

export function computeDailyBalance(
  zone: ZoneConfig,
  prevDrMm: Mm,               // Dr from previous day (0 on first day = field capacity)
  inputs: DailyBalanceInputs
): DailyBalanceResult
```
how to implement:
1. Create `src/soil.ts` with `SOIL_TEXTURE_TABLE`.
2. Create `src/water-balance.ts`.
3. `computeDailyBalance`: (a) `TAW = (thetaFC - thetaWP) * rootDepthMm`; (b) `RAW = p * TAW`; (c) `ETc = kc * etoMm`; (d) `P_net = rainMm * (1 - runoffFraction)`; (e) `Dr_new = prevDrMm + ETc - P_net - irrigationNetMm - capillaryRiseMm`; (f) `DP = max(0, -Dr_new)` (if Dr_new < 0, water exceeds FC by that amount → it percolates); (g) `Dr_final = clamp(Dr_new + DP, 0, TAW)`; (h) `madReached = Dr_final >= RAW`.
4. Compute `storageChangeMm` as the implied change: `-(Dr_final - prevDrMm)` (positive = storage increased).
acceptance: `test/water-balance.test.ts` asserts:
- With `prevDr=0`, `ETc=4mm`, `rain=0`, `irrigation=0` → `Dr = 4`, `DP = 0`, `madReached` based on RAW.
- With `prevDr=5`, `ETc=3mm`, `rain=20mm` (all percolates beyond refill) → `DP > 0`.
- Conservation check: for any valid input set, `|storageChangeMm - (P_net + irrigationNetMm + capillaryRiseMm - ETc - DP)| < 0.001` (water in = water out + storage change + DP).
- Root-depth increase scenario: changing `rootDepthMm` from 300 to 400 mid-season → TAW/RAW recalculate; Dr remains bounded by new TAW.

---

**S07 — QC pipeline (L0 → L1)**
dependsOn: S01, S03
files: `src/qc-pipeline.ts`, `test/qc-pipeline.test.ts`
interface:
```typescript
export type QCVerdict = 'pass' | 'quarantine'
export type QCReasonCode =
  | 'stuck_probe'         // identical value across N intervals spanning a wetting event
  | 'impossible_jump'     // change exceeds physical rate
  | 'missing_interval'    // gap in expected time series
  | 'unit_mismatch'       // declared unit doesn't match station config

export interface QCResult {
  readonly observationId: string         // references L0 RawObservation.id
  readonly verdict: QCVerdict
  readonly reasonCode: QCReasonCode | null
  readonly reason: string                // human-readable
}

export interface QCConfig {
  stationId: string
  expectedUnit: string                   // 'VWC' or 'kPa'
  maxJumpPerDay: number                  // e.g. 0.10 for VWC sensors
  stuckWindowDays: number               // e.g. 3
}

// Returns one QCResult per observation (never mutates L0)
export function runQCPipeline(
  observations: readonly RawObservation[],
  config: QCConfig,
  rainEventDays: readonly DayNumber[]    // days on which rain > threshold (for stuck-probe detection)
): QCResult[]
```
how to implement:
1. Create `src/qc-pipeline.ts`.
2. For each observation:
   a. **Unit mismatch**: if `obs.rawUnit !== config.expectedUnit` → quarantine, `unit_mismatch`.
   b. **Stuck probe**: for each obs, look at the `stuckWindowDays` window. If all values in the window are within 0.001 of each other AND a `rainEventDay` falls in that window → quarantine, `stuck_probe`.
   c. **Impossible jump**: compare this obs to the previous day's value for the same station/channel. If `abs(delta) > config.maxJumpPerDay` → quarantine, `impossible_jump`.
   d. **Missing interval**: sort obs by day; if a gap of > 1 day exists, insert a synthetic quarantine record with `observationId = '<station>-gap-<day>'` and `missing_interval`.
3. If no rule triggers → `verdict: 'pass'`, `reasonCode: null`.
4. Never modify the input `observations` array.
acceptance: `test/qc-pipeline.test.ts` asserts:
- Normal readings all pass.
- Stuck-probe fixture: days 5–10 same VWC, rain event on day 7 → days 5–10 quarantined with `stuck_probe`.
- Impossible-jump: day N=0.20 VWC, day N+1=0.60 VWC (jump > 0.10) → day N+1 quarantined with `impossible_jump`.
- Unit mismatch: obs with `rawUnit='kPa'` when `config.expectedUnit='VWC'` → quarantined.
- Raw L0 observations array is identical before and after calling `runQCPipeline` (immutability check).
- Missing gap: observations for days 0,1,5 → a `missing_interval` entry is present for the gap.

---

**S08 — Sensor–balance reconciliation (L1 → L2 zone water state)**
dependsOn: S06, S07
files: `src/reconciliation.ts`, `test/reconciliation.test.ts`
interface:
```typescript
export type ZoneConfidence = 'high' | 'medium' | 'low'

export interface ZoneWaterState {
  day: DayNumber
  zoneId: string
  balanceDrMm: Mm              // Dr from water-balance bucket
  sensorDrMm: Mm | null        // Dr implied by sensor VWC (null if quarantined/absent)
  reconciledDrMm: Mm           // weighted combination used for recommendation
  confidence: ZoneConfidence
  discrepancyMm: Mm | null     // |balanceDr - sensorDr| if both present
  notes: string[]              // e.g. ['sensor quarantined: stuck_probe; using balance estimate']
}

// Convert a VWC fraction reading to root-zone depletion in mm
export function vwcToDepletion(vwc: VwcFraction, zone: ZoneConfig): Mm
// Formula: Dr = (thetaFC - vwc) * rootDepthMm  (clamped to [0, TAW])

export function reconcileZoneWater(
  balanceResult: DailyBalanceResult,
  sensorReading: RawObservation | null,   // null if no reading for this day
  sensorQC: QCResult | null,
  zone: ZoneConfig
): ZoneWaterState
```
how to implement:
1. Create `src/reconciliation.ts`.
2. `vwcToDepletion(vwc, zone)`: `Dr = (thetaFC - vwc) * rootDepthMm`; clamp to `[0, TAW]`.
3. `reconcileZoneWater`:
   a. If `sensorReading === null` or `sensorQC?.verdict === 'quarantine'`: `sensorDrMm = null`, `reconciledDrMm = balanceDrMm`, `confidence = 'low'` (no sensor data), add a note.
   b. If sensor passes QC: compute `sensorDrMm = vwcToDepletion(sensorReading.rawValue, zone)`.
   c. Compute `discrepancyMm = |balanceDrMm - sensorDrMm|`.
   d. If `discrepancyMm > 10mm`: `confidence = 'medium'`, `reconciledDrMm = (balanceDrMm + sensorDrMm) / 2`, add note about discrepancy.
   e. If `discrepancyMm <= 10mm`: `confidence = 'high'`, `reconciledDrMm = sensorDrMm` (trust calibrated sensor over model).
acceptance: `test/reconciliation.test.ts` asserts:
- Quarantined sensor → `sensorDrMm === null`, `confidence === 'low'`, reconciled = balance value.
- Close agreement (< 10mm) → `confidence === 'high'`, reconciled = sensor value.
- Large discrepancy (> 10mm) → `confidence === 'medium'`, reconciled = average, note present.
- `vwcToDepletion(vwcFraction(0.35), loamZone)` = `(0.38 - 0.35) * rootDepthMm`.

---

**S09 — Irrigation recommendation engine**
dependsOn: S08
files: `src/irrigation-recommendation.ts`, `test/irrigation-recommendation.test.ts`
interface:
```typescript
export interface PumpConfig {
  flowRateLitersPerHour: LitersPerHour
  distributionUniformity: number          // DU, 0–1
  laborWindowHours: number               // hours available for this zone per day
  waterRightsDailyCapMm: Mm | null       // null = no cap
}

export interface ForecastRainRisk {
  forecastRainMm: Mm
  confidence: number   // 0–1
}

export type RecommendationStatus = 'irrigate' | 'defer_for_rain' | 'deferred_low_confidence' | 'infeasible' | 'no_action'

export interface IrrigationRecommendation {
  day: DayNumber
  zoneId: string
  status: RecommendationStatus
  netIrrigationMm: Mm
  grossIrrigationMm: Mm     // netIrrigationMm / DU
  runtimeHours: number      // grossDepth (mm) / systemPrecipitationRate
  rationale: string         // prose explanation
  bindingConstraint: string | null  // e.g. 'pump_capacity', 'water_rights', 'labor_window'
  inputDrMm: Mm
  inputRawMm: Mm
}

export function recommendIrrigation(
  state: ZoneWaterState,
  pump: PumpConfig,
  zone: ZoneConfig,
  forecast: ForecastRainRisk,
  currentDay: DayNumber
): IrrigationRecommendation
```
how to implement:
1. Create `src/irrigation-recommendation.ts`.
2. If `state.reconciledDrMm < state.reconciledDrMm` (Dr < RAW, no stress) → `status = 'no_action'`.
3. Compute `netIrrigationMm = reconciledDrMm` (refill to FC).
4. Apply forecast rain deferral: if `forecastRainMm * confidence > 0.5 * netIrrigationMm` → `status = 'defer_for_rain'`.
5. `grossIrrigationMm = netIrrigationMm / pump.distributionUniformity`.
6. `systemPrecipRateMmPerHour = (pump.flowRateLitersPerHour / 10000) / zone.areaHa * 1000`. (Convert L/h to mm/h over area: flow[L/h] ÷ area[m²] × 1000 mm/m = mm/h; note 1 ha = 10000 m².)
7. `runtimeHours = grossIrrigationMm / systemPrecipRateMmPerHour`.
8. Feasibility checks — flag infeasible with binding constraint:
   a. If `runtimeHours > pump.laborWindowHours` → `infeasible`, `bindingConstraint = 'labor_window'`.
   b. If `pump.waterRightsDailyCapMm !== null && grossIrrigationMm > pump.waterRightsDailyCapMm` → `infeasible`, `bindingConstraint = 'water_rights'`.
9. Build `rationale` string: include Dr, RAW, forecast info, binding constraint if any.
10. `status = 'irrigate'` if feasible and MAD reached, `'no_action'` otherwise.
acceptance: `test/irrigation-recommendation.test.ts` asserts:
- Dr < RAW → `status = 'no_action'`.
- Dr >= RAW, no rain, feasible pump → `status = 'irrigate'`, `runtimeHours > 0`, `rationale` non-empty.
- Forecast rain likely → `status = 'defer_for_rain'`.
- Runtime exceeds labor window → `status = 'infeasible'`, `bindingConstraint === 'labor_window'`.
- Water-rights cap breached → `status = 'infeasible'`, `bindingConstraint === 'water_rights'`.
- Pump cannot deliver (zero or near-zero flow) → infeasible.

---

**S10 — N/P/K fertigation mass balance**
dependsOn: S06
files: `src/nutrient-balance.ts`, `test/nutrient-balance.test.ts`
interface:
```typescript
export interface NutrientProduct {
  productId: string
  name: string
  nPct: number      // % elemental N by weight (guaranteed analysis)
  pPct: number      // % P₂O₅ by weight → multiply by 0.436 to get elemental P
  kPct: number      // % K₂O by weight → multiply by 0.830 to get elemental K
  densityKgPerL: number
}

export interface FertigationEvent {
  day: DayNumber
  zoneId: string
  productId: string
  volumeLiters: number
  injectionRatio: number    // e.g. 0.01 = 1L stock per 100L water
}

export interface DailyNutrientBalance {
  day: DayNumber
  zoneId: string
  nAppliedKg: Kilograms
  pAppliedKg: Kilograms
  kAppliedKg: Kilograms
  nLeachedKg: Kilograms       // driven by dpMm from water balance
  seasonNTotalAppliedKg: Kilograms  // running total
  balanceNotes: string[]
}

// N leaching: estimate nLeached = nConcentrationInSoilWater * dpMm * zone.areaHa * 10
// (simplified: nConc estimated as nApplied / (TAW * areaHa * 10) for same day; placeholder for NLEAP)
export function computeDailyNutrientBalance(
  event: FertigationEvent | null,
  product: NutrientProduct | null,
  dpMm: Mm,
  zone: ZoneConfig,
  prevSeasonNTotalKg: Kilograms,
  soilNConcentrationMgL: number   // estimated or measured N in soil water (mg/L)
): DailyNutrientBalance
```
how to implement:
1. Create `src/nutrient-balance.ts`.
2. If `event` is null → `nAppliedKg = 0` etc.
3. If event present: `nAppliedKg = event.volumeLiters * product.densityKgPerL * product.nPct / 100`. Convert P₂O₅ to elemental P: × 0.436. Convert K₂O to elemental K: × 0.830.
4. N leaching: `nLeachedKg = (soilNConcentrationMgL / 1000) * dpMm * zone.areaHa * 10000 / 1e6`. (dpMm mm × 10 L/m² → liters; × areaHa × 10000 m²/ha = total liters; × mg/L / 1e6 = kg).
5. Note: add a `balanceNote` string marking the leaching calculation as a simplified estimate (NLEAP-class; see E7 knowledge debt).
6. `seasonNTotalAppliedKg = prevSeasonNTotalKg + nAppliedKg`.
acceptance: `test/nutrient-balance.test.ts` asserts:
- No event, dpMm=0 → all zeros.
- Event with 100L of 10% N product → `nAppliedKg ≈ product.densityKgPerL * 100 * 0.10` (check formula).
- `dpMm > 0` → `nLeachedKg > 0`.
- `dpMm === 0` → `nLeachedKg === 0` (coupling invariant: no percolation → no leaching).
- Running total accumulates correctly over two days.
- `balanceNotes` mentions "simplified estimate".

---

**S11 — Zone comparison view-model**
dependsOn: S09, S10
files: `src/zone-view-model.ts`, `test/zone-view-model.test.ts`
interface:
```typescript
export type ZoneStatus = 'under_watered' | 'over_watered' | 'optimal' | 'sensor_unreliable'

export interface ZoneSummary {
  zoneId: string
  day: DayNumber
  status: ZoneStatus
  reconciledDrMm: Mm
  tawMm: Mm
  rawMm: Mm
  depletionPct: number              // reconciledDrMm / tawMm * 100
  confidence: ZoneConfidence
  pendingRecommendation: RecommendationStatus
}

// Pure projection of L2/L3 state
export function buildZoneSummaries(
  states: readonly ZoneWaterState[],
  recommendations: readonly IrrigationRecommendation[],
  zones: readonly ZoneConfig[]
): ZoneSummary[]
```
how to implement:
1. Create `src/zone-view-model.ts`.
2. For each `ZoneWaterState`, find the matching `ZoneConfig` and `IrrigationRecommendation`.
3. Status logic: if `confidence === 'low'` → `'sensor_unreliable'`; else if `reconciledDrMm > tawMm * 0.8` → `'under_watered'`; else if `reconciledDrMm < 5` → `'over_watered'` (nearly full, excess risk); else `'optimal'`.
4. This is a pure projection — no I/O, no side effects.
acceptance: `test/zone-view-model.test.ts` asserts:
- Low confidence → `status === 'sensor_unreliable'`.
- High Dr relative to TAW → `'under_watered'`.
- Very low Dr → `'over_watered'`.
- `depletionPct` computed correctly.
- `buildZoneSummaries` is pure (calling it twice with same args returns structurally identical results).

---

**S12 — Scenario tests and season-replay integration test**
dependsOn: S05, S06, S07, S08, S09, S10, S11
files: `test/scenarios/heatwave.test.ts`, `test/scenarios/pump_outage.test.ts`, `test/scenarios/restricted_allocation.test.ts`, `test/scenarios/season-replay.test.ts`
interface: (no new exports — integration tests only)
how to implement:
1. **heatwave.test.ts**: Set up fixtures for a 7-day period where ETo is 2× normal (simulate high temp/radiation). Assert: water balance Dr increases rapidly; recommendation status becomes `'irrigate'` by day 3; water conservation invariant holds (`Σin - Σout = ΔStorage ± 0.01` over all days).
2. **pump_outage.test.ts**: Set pump `flowRateLitersPerHour = 0`. Assert: any recommendation where Dr ≥ RAW returns `status === 'infeasible'` with `bindingConstraint === 'labor_window'` or handle zero-rate as infeasible.
3. **restricted_allocation.test.ts**: Set `waterRightsDailyCapMm = mm(5)`. Assert: when net irrigation need > 5mm → `status === 'infeasible'`, `bindingConstraint === 'water_rights'`. Recommendation never claims applying more than the cap.
4. **season-replay.test.ts**: Run 30-day season twice with identical seed/fixtures. Assert: L2 water balance results are byte-identical between runs. Assert: N/P/K totals are identical. Assert: `dpMm > 0` days have `nLeachedKg > 0` (coupling). Assert at least one stuck-probe is detected by QC pipeline over the season.
acceptance: All four test files pass `npm test` with no network calls and no `Date.now()`.

---

### 3. The decomposition method for the rest of the spec

After the first slice (S01–S12) is green, apply this recipe to expand each remaining feature area (E6 items not yet covered: dual-Kc, scenario planner breadth, ISO-XML/ADAPT, full fertigation plan, seed orchard data) into the same card shape.

**Recipe:**
1. Identify the feature's primary *output type* (a new TypeScript interface or function signature).
2. Identify what *inputs* it needs — trace back to existing modules; mark each dependency as a `dependsOn`.
3. Ask: "Is this one pure function, or does it need new state?" If new state → split into (a) state model card and (b) calculation card.
4. Write the interface first (types + function signatures). Do not start implementation until the interface is stable.
5. Write the acceptance test *before* the implementation. The test is the spec.
6. Keep each card to one file created or one file edited (exceptions: a pure module + its test always count as one card).

**Worked example 1 — Dual-Kc extension:**
The spec says build single-Kc first, make dual-Kc a "clean extension point." Decompose into:
- **DK01** — Topsoil evaporation layer model: `interface TopsoilEvaporationLayer { depletion: Mm; maxEvaporableWater: Mm }` and `function stepTopsoilLayer(prev, wettingMm, kepMax): TopsoilEvaporationLayer`. dependsOn: S01, S06. files: `src/dual-kc.ts`, `test/dual-kc.test.ts`. Acceptance: wetting event resets the layer; layer never exceeds max.
- **DK02** — Dual-Kc ETc: `function computeEtcDualKc(kcb, ke, eto): Mm`. dependsOn: DK01. files: edit `src/water-balance.ts` to accept an optional `keDailyFn` parameter. Acceptance: `computeEtcDualKc(0.7, 0.2, mm(5)) === mm(4.5)`.

**Worked example 2 — Scenario planner (heatwave expansion):**
The existing heatwave *test* (S12) uses a fixture. The planner card generates a *scenario recommendation set*:
- **SP01** — Scenario fixture pack: export `HEATWAVE_WEATHER_FIXTURE`, `PUMP_OUTAGE_FIXTURE`, `RESTRICTED_ALLOCATION_FIXTURE` from `src/fixtures/scenario-fixtures.ts`. dependsOn: S04. Acceptance: each exports an array of DailyWeather records; heatwave ETo is ≥ 1.5× normal-season ETo on days 0–6.
- **SP02** — `runScenario(scenarioName, days, zoneConfig, pumpConfig)` returning `ScenarioResult[]` (one per day). dependsOn: S12, SP01. Acceptance: heatwave scenario → recommendation is `'irrigate'` more than once; restricted scenario → at least one `'infeasible'` recommendation; all results pass water conservation invariant.

**Worked example 3 — Fertigation plan with N/P/K seasonal cap:**
The base spec requires seasonal nutrient limits.
- **NP01** — Seasonal cap config: `interface SeasonalNutrientCap { zoneId: string; maxNKgPerHa: number; maxPKgPerHa: number; maxKKgPerHa: number }`. dependsOn: S10. files: `src/nutrient-limits.ts`. Acceptance: types only; compilation passes.
- **NP02** — Cap check function: `function checkSeasonalCap(balance: DailyNutrientBalance[], cap: SeasonalNutrientCap): CapCheckResult`. dependsOn: NP01. Acceptance: if `seasonNTotalAppliedKg / zone.areaHa > maxNKgPerHa` → returns a violation with `element: 'N'`; otherwise `{ violation: false }`.

---

### 4. Per-task implementation conventions

**File/folder layout:**
```
src/
  units.ts          # branded types + conversions
  clock.ts          # virtual clock
  prng.ts           # seeded PRNG
  event-log.ts      # L0 append-only log
  eto.ts            # FAO-56 ETo
  soil.ts           # texture table
  water-balance.ts  # bucket model
  qc-pipeline.ts    # L0 → L1 QC
  reconciliation.ts # L1 → L2 zone water state
  irrigation-recommendation.ts
  nutrient-balance.ts
  zone-view-model.ts
  adapters/
    weather-adapter.ts
    sensor-adapter.ts
  fixtures/
    weather-fixtures.ts
    sensor-fixtures.ts
    scenario-fixtures.ts
test/
  units.test.ts
  clock.test.ts
  event-log.test.ts
  adapters.test.ts
  eto.test.ts
  water-balance.test.ts
  qc-pipeline.test.ts
  reconciliation.test.ts
  irrigation-recommendation.test.ts
  nutrient-balance.test.ts
  zone-view-model.test.ts
  scenarios/
    heatwave.test.ts
    pump_outage.test.ts
    restricted_allocation.test.ts
    season-replay.test.ts
```

**Naming conventions:**
- Source files: kebab-case, e.g. `water-balance.ts`.
- Test files: same name + `.test.ts`.
- Types: PascalCase, e.g. `DailyBalanceResult`.
- Functions: camelCase, e.g. `computeDailyBalance`.
- Constants: SCREAMING_SNAKE_CASE, e.g. `SOIL_TEXTURE_TABLE`.

**How to write a test in this stack (Vitest example):**
```typescript
import { describe, it, expect } from 'vitest'
import { computeETo } from '../src/eto.js'
import { mm } from '../src/units.js'

describe('ETo', () => {
  it('matches FAO-56 worked example within 0.2 mm', () => {
    const result = computeETo({
      tMean: 22.5, tMin: 19.5, tMax: 25.5,
      rhMin: 42, rhMax: 72, u2: 2.08,
      Rs: 22.07, Ra: 40.55,
      elevation: 0, dayOfYear: 135, latitude: 45
    })
    expect(result.eto).toBeCloseTo(5.0, 0)  // within 0.5 of expected
  })
})
```

**How to keep tests deterministic:**
- Import the virtual clock; never call `new Date()` or `Date.now()` inside any source module.
- Import the fixture adapters; never call `fetch`, `fs.readFileSync` on a path not in the repo, or any network function.
- Use `toBeCloseTo(expected, decimalPlaces)` for floating-point comparisons; never strict `===` on floats.
- For conservation invariants, use tolerance `< 0.001` (mm-level precision is sufficient).

**How to wire/seed a fixture adapter:**
```typescript
import { createFixtureWeatherAdapter } from '../src/adapters/weather-adapter.js'
import { NORMAL_SEASON_WEATHER } from '../src/fixtures/weather-fixtures.js'
const weather = createFixtureWeatherAdapter(NORMAL_SEASON_WEATHER)
const day0 = weather.getDay(dayNumber(0))
```

**Definition of done for any card:**
1. All files listed in the card's `files` exist.
2. All interfaces/functions listed in `interface` are exported.
3. TypeScript compiles with no errors (`tsc --noEmit`).
4. All acceptance assertions in the card's `acceptance` section pass when running `npm test`.
5. No `Date.now()`, `Math.random()`, `fetch`, `import.meta`, or `process.env` in the new source files (only in adapters + fixtures).
6. No `any` types in the new source files.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Skipping the unit brands and treating numbers as plain `number`.**
A 3B model tends to define `type Mm = number` (an alias, not a brand) or skip typed units entirely and use plain `number` everywhere. This compiles but silently allows adding `Mm + LitersPerHour`. Fix: every unit type must be `type Mm = number & { readonly __unit: 'mm' }` and every constructor must cast: `const mm = (v: number): Mm => v as Mm`. If the model writes `type Mm = number`, reject the card — the brand is missing.

**Pitfall 2 — Mutating L0 during QC or reconciliation.**
The model may "simplify" by filtering out bad readings rather than attaching verdict objects. This destroys the audit trail. Fix: the QC pipeline returns a *separate* `QCResult[]` array; the original `observations` array must be identical before and after the call. Test this explicitly: `expect(observations).toEqual(observationsBefore)` after calling `runQCPipeline`.

**Pitfall 3 — Computing the water balance in the wrong direction (sign errors on Dr).**
A 3B model frequently gets the sign of `Dr` backwards (treating it as "storage" instead of "deficit"). The invariant to pin: **Dr = 0 means field capacity (full); Dr = TAW means wilting point (empty)**. If the model sets `Dr = TAW - currentStorage`, it usually gets this backwards. Check: after a rain event that fully refills the zone, `Dr` must be 0 (or near 0 after DP). After 5 days of ETc with no rain, `Dr` must increase.

**Pitfall 4 — Forgetting deep percolation or getting its sign wrong.**
DP is the amount by which irrigation + rain would push Dr below zero. A weak model often sets `DP = 0` always (ignoring over-irrigation) or computes it as `max(0, Dr)` (treating Dr as the thing that percolates). Fix: DP = max(0, -(Dr_before_clamping)). Test: large irrigation event on a nearly-full zone must produce `DP > 0`; a moderate irrigation on a dry zone must produce `DP === 0`.

**Pitfall 5 — Forgetting the water–nutrient coupling (N leaching when DP = 0).**
A model may compute N leaching independently of DP, producing `nLeachedKg > 0` even when `dpMm === 0`. This breaks the coupling invariant. Fix: `nLeachedKg` must be exactly 0 whenever `dpMm === 0`. Assert this as an explicit test case.

**Pitfall 6 — ETo formula: using the wrong Rn formula or skipping Rnl.**
A 3B model often approximates Rn as `0.77 * Rs` (net shortwave only), completely omitting the net longwave term `Rnl`. This overestimates ETo on warm/humid days. Fix: implement FAO-56 eq. 39 for Rnl explicitly. Test against the FAO-56 worked example; if the result is ≥ 0.5 mm/day off, the Rn computation is wrong.

**Pitfall 7 — Using `Date.now()` or `new Date()` in fixture data construction.**
A model building fixture arrays often writes `day: Date.now()` or uses the current date as a day number. This makes tests non-deterministic. Fix: every fixture record must use `dayNumber(N)` with a hard-coded integer N. Review all fixture files for any `Date` reference.

**Pitfall 8 — Forgetting the idempotency requirement on the event log.**
A model may append a duplicate observation and then fail a test because the count is wrong. Fix: in `EventLog.append`, check if an obs with the same `id` already exists; if so, skip. Test: append the same observation twice → `getAll().length === 1`.

**Pitfall 9 — Reconciliation trusting the sensor unconditionally.**
A weak model may skip the reconciliation and always use the sensor VWC directly. This means quarantined sensors still drive recommendations. Fix: `reconcileZoneWater` must check `sensorQC?.verdict === 'quarantine'` and fall back to the balance estimate, setting `confidence = 'low'`.

**Pitfall 10 — Recommendation emitting an impossible runtime.**
A model may forget to check whether `runtimeHours > laborWindowHours` and emit a recommendation that physically requires more time than the labor window allows. Fix: the feasibility check must come *after* computing `runtimeHours`; if infeasible, set `status = 'infeasible'` and `bindingConstraint`, and do not emit a positive `runtimeHours` as a "recommendation." Set `runtimeHours = 0` or `runtimeHours = pump.laborWindowHours` (the max deliverable) in the infeasible case.
