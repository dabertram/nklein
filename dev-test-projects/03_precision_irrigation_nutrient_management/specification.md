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
