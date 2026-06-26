# 06 - Industrial Predictive Maintenance and Historian Platform

Complexity tier: 6/20
Expected decomposition size: 22-26 dependent implementation cards before coding.
Domain pressure: industrial maintenance, time-series historians, vibration analysis, work orders, OPC UA-style tags, reliability engineering.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a maintenance intelligence platform for a small factory that collects machine telemetry, detects reliability risks, and links them to work orders and spare parts. It must treat industrial data as noisy, unit-heavy, and safety-relevant.

## Foundation release scope
The first serious buildout must include:
- Plant, line, asset, component, sensor tag, reading, alarm, failure mode, work order, spare part, technician, and downtime event models.
- Historian ingestion for mixed-rate numeric and categorical tags with unit metadata, quality flags, and late arrivals.
- Condition monitoring checks for vibration RMS, temperature drift, pressure deviation, cycle count, operating envelope, and alarm floods.
- Failure-mode library linking symptoms, thresholds, recommended inspections, required parts, and production impact.
- Work-order prioritization based on risk, safety class, production schedule, spare availability, and maintenance windows.
- Root-cause timeline that aligns telemetry, alarms, operator notes, maintenance actions, and downtime.
- Simulation fixtures for a pump bearing failure, compressor leak, conveyor misalignment, and false-positive sensor fault.
- Reports for mean time between failures, mean time to repair, recurring failure modes, and deferred risk.

## Architecture requirements
- Separate raw historian storage, derived features, alerts, and maintenance decisions.
- Use streaming-friendly pure functions for feature windows and late-arrival correction.
- Model units and tag metadata explicitly; never compare unlike units implicitly.
- Keep work-order policy configurable and testable.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Industrial telemetry includes bad quality, stale values, changing sampling rates, and tag naming chaos.
- Predictive maintenance is about decision support, not unsupported failure prophecy.
- Alarm floods require grouping and suppression logic.
- Maintenance priority must incorporate safety and production context.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Feature calculations are deterministic for irregular sample windows.
- Sensor quality failures do not create false maintenance recommendations without evidence.
- Risk ranking changes when spare parts or production windows change.
- Root-cause timelines preserve raw and derived evidence separately.
- The project passes npm test locally.

## Explicit non-goals
- Do not use ML buzzwords without deterministic algorithms and tests.
- Do not hard-code one asset type into the whole model.
- Do not discard bad readings; quarantine them with quality reasons.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single defining property of this project:** industrial telemetry is *noisy, unit-heavy, late, and safety-relevant*, so the hard problem is producing **honest, deterministic decision-support** — a vibration trend or temperature drift becomes a *cited, evidence-backed work-order recommendation* only when the data quality earns it — while **bad quality, stale values, and irregular sampling can NEVER manufacture a maintenance prophecy.** Build the historian-quality + feature spine first; the screens are downstream of trustworthy features.

## E0. Why this is the right shape of challenge

A weak swarm builds a "predictive maintenance" demo that thresholds a clean sine wave and declares a bearing dead. That is the exact anti-pattern the spec forbids ("predictive maintenance is about decision support, not unsupported failure prophecy"; "do not use ML buzzwords without deterministic algorithms"). The real domain is governed by three hard truths the grading must expose:

1. **Data has quality, units, and time you cannot trust.** A value carries a **quality code** (OPC-style Good/Bad/Uncertain), a **unit**, a **source timestamp**, and may arrive **late and out of order** at a changing sample rate. [OPC UA / Sparkplug B carry value + datatype + source-timestamp + **quality code** as a unit, not a bare number — https://www.hivemq.com/resources/iiot-protocols-opc-ua-mqtt-sparkplug-comparison/] A feature computed over Bad/stale samples must be **quarantined, not silently averaged in**.
2. **Condition monitoring is a layered pipeline, not a threshold.** The internationally-standard decomposition is **ISO 13374 / MIMOSA OSA-CBM**: Data Acquisition → **Data Manipulation** (signal processing) → **State Detection** (normal/abnormal) → **Health Assessment** (rate + diagnose) → **Prognostic Assessment** (predict RUL) → **Advisory Generation** (recommend action). Each block has *typed inputs and outputs* and must be separable. [https://www.mimosa.org/mimosa-osa-cbm/ ; ISO 13374-2:2007] Collapsing these into one function is the failure.
3. **Maintenance priority is a safety + production decision, not a severity number.** The same alarm ranks differently if the asset is safety-classed, the spare is on the shelf vs. 6-weeks out, and the next maintenance window is tonight vs. next quarter. Risk ranking must **change when spares or production windows change** (an explicit acceptance criterion).

## E1. Research-grounded domain authenticity (what a reliability engineer will check for)

- **Historian semantics, done right (the non-negotiable foundation):**
  - **Tags carry metadata:** engineering unit, data type (numeric *or* categorical/discrete), expected sample interval (and that rates are **mixed and changing**), and a **quality flag**. Tag naming is chaotic across vendors — model a **tag identity** distinct from its display name; never compare unlike units implicitly. [https://ifactoryapp.com/greenfield-consulting/opc-ua-mqtt-data-architecture-smart-factory]
  - **Quality codes** map to an OPC-style lattice: **Good / Uncertain / Bad** (with sub-reasons: sensor-fault, out-of-range, stale/last-known-value, comm-loss, calibration-suspect). Derived features inherit the *worst* quality of their inputs (quality propagation).
  - **Late arrivals & out-of-order** are normal; ingestion is **append-only with source-timestamp ordering**, and feature windows must **correct deterministically** when a late sample lands inside an already-computed window (re-fold the affected window, mark it revised). [Sparkplug B sequence numbering / report-by-exception — https://www.symestic.com/en-us/what-is/mqtt-sparkplug-b]
  - **Unified-Namespace / Sparkplug topic shape** (`spBv1.0/group/message_type/edge_node/device`) and **birth/death certificates** inform the ingestion adapter contract (a device "death" = comm-loss = subsequent reads are stale, not zero). The live transport is a production adapter; tests use a deterministic fixture stream.
- **Condition-monitoring math with real standards and formulas:**
  - **Vibration severity (ISO 20816, successor to ISO 10816):** broadband **RMS velocity in mm/s over 10–1000 Hz**, classified into **zones A/B/C/D** by machine class/mount. Concrete example (medium pump, rigid mount): **≤1.12 = A (new), ≤2.8 = B (long-term OK), ≤7.1 = C (remedial action), >7.1 = D (danger/shutdown)**. Zone boundaries are **data-driven per asset class**, never a global constant. [https://vibromera.eu/glossary/iso-10816-3/ ; https://wertek.ai/engineering/vibration/iso-20816-severity/]
  - **Bearing defect frequencies** are *computable from geometry + RPM*: **BPFO, BPFI, BSF, FTF**. Early defects hide in the raw FFT and surface only under **envelope (demodulation) analysis** — bandpass around a resonance, rectify, re-FFT — where energy at BPFO/BPFI is the condition indicator; **BPFI shows sidebands at shaft speed** (amplitude modulation as the defect enters/leaves the load zone). [https://iotbearings.com/bearing-defect-frequencies-bpfo-bpfi-bsf-ftf-explained/ ; https://vibromera.eu/glossary/bearing-fault-frequencies/] Determinism requirement: the FFT/envelope features must be computed by a **deterministic algorithm over a fixed numeric series** (a recorded waveform fixture), not a black box.
  - **Other CM checks** the spec names, each a pure feature: temperature drift (slope over a window), pressure deviation (vs. operating envelope), cycle counting, operating-envelope breach, **alarm-flood detection**.
- **Reliability engineering frame (the "why" behind recommendations):**
  - **RCM / P-F curve:** point **P** = potential failure first detectable; point **F** = functional failure; the **P-F interval** is the actionable window. An on-condition recommendation is only *valid* if the P-F interval is long enough to schedule + execute before F — so a recommendation must carry an *estimated P-F window*, not just "bad now." [https://www.uesystems.com/understanding-the-p-f-curve-and-its-impact-on-reliability-centered-maintenance/]
  - **FMEA / FMECA:** the failure-mode library is an FMEA in disguise — each failure mode scored on **Severity × Occurrence × Detection = RPN**, linking **symptoms → thresholds → recommended inspections → required parts → production impact**. [https://www.symestic.com/en-us/what-is/reliability-centered-maintenance]
  - **Prognostics / RUL** done *honestly*: a degradation model (e.g. trend-to-threshold, or a **Weibull**-based remaining-life estimate) yields RUL **with a confidence/interval**, and explicitly **degrades to "insufficient evidence" when data quality or history is poor** — never a point prophecy. [https://pmc.ncbi.nlm.nih.gov/articles/PMC7512544/]
  - **Reliability reports:** **MTBF**, **MTTR**, recurring-failure-mode Pareto, deferred-risk backlog — all computed from the downtime-event + work-order log.
- **Alarm management grounded in ISA-18.2 / EEMUA 191 (the alarm-flood requirement):**
  - **Chattering alarm** = transitions normal↔active **≥3 times in 60 s**; suppress with **deadband (typically 2–5% of setpoint)**, time-delay, or hysteresis. [https://www.linkedin.com/pulse/reducing-chattering-alarms-using-deadbands-zak-kann]
  - **Alarm flood** = **>10 alarms in a 10-minute window**; floods require **grouping + suppression** (first-out / cause-effect grouping), and the standard targets **<10 standing alarms**. The grouping logic is a deterministic, testable function. [https://www.isa.org/getmedia/55b4210e-6cb2-4de4-89f8-2b5b6b46d954/PAS-Understanding-ISA-18-2.pdf]

## E2. The hardest technical seam #1 — quality-propagating, late-correcting feature windows

This is the spine. Build it as **streaming-friendly pure functions** with these contracts:

- **Quality is a first-class output, not a side note.** Every derived feature returns `{ value, unit, quality, contributingSampleQualities, windowRevision }`. Quality propagates by a **worst-of lattice**: a window containing any Bad sample (above a configurable Bad-fraction) yields a **quarantined** feature whose `quality = Bad(reason)` and which is **ineligible to ground a recommendation** (the State-Detection/Health-Assessment blocks must *refuse* it). This is how "sensor quality failures do not create false maintenance recommendations without evidence" becomes mechanical.
- **Irregular & changing sample rate.** Windows are defined in **time** (e.g. trailing 10 s / 1 h), not in sample count; the feature math (RMS, slope, count, FFT-on-resampled) must be **deterministic for irregular spacing** — explicit, documented resampling/interpolation with the interpolation itself marked as Uncertain-quality where it fills gaps.
- **Late-arrival correction is deterministic re-folding.** When a sample with an older source-timestamp arrives after its window was computed, the affected window(s) **re-fold** and emit a **revised** feature (monotone revision counter); downstream state/health/advisory recompute. **Property:** the final feature set is **identical regardless of arrival order** of the same sample multiset — the determinism acceptance test.
- **Separation of layers (ISO 13374):** raw historian store → derived features → state detection → health/diagnosis → prognosis → advisory are **separate modules with typed boundaries** (an explicit architecture requirement). You can snapshot and test each block in isolation against a fixed input.

## E3. The hardest technical seam #2 — context-aware, explainable work-order prioritization

A recommendation is not "bearing bad → fix it." It is an **evidence-backed, context-weighted, explainable decision**:

```
prioritize(candidateWorkOrders, context) → rankedList   // each item explainable to source facts
   inputs: risk(severity×likelihood from FMEA/RPN + current health),
           safetyClass(asset),
           sparePartAvailability(on-hand | lead-time),
           productionSchedule(running | window-tonight | next-quarter),
           maintenanceWindowFit (does the task fit before P-F's F point?),
           evidenceQuality (Good features vs. quarantined)
```

- **Risk ranking must change with spares and windows** (explicit acceptance criterion): the *same* health state produces a *different* rank when the spare goes from on-shelf to 6-weeks-out, or when the production window moves. Test both directions.
- **Safety + production dominate severity:** a safety-classed asset's failure mode outranks a higher-RPN but non-safety one. Configurable, testable policy — *no hard-coded single asset type* (explicit non-goal).
- **Every recommendation is explainable from source facts:** it cites the **feature(s)** (with their quality), the **FMEA failure-mode** matched, the **threshold/zone** crossed (ISO 20816 zone, BPFO envelope amplitude), the **spare + window context**, and the **estimated P-F window**. A recommendation grounded only on **quarantined (Bad-quality)** features is **refused** and surfaced as "insufficient evidence — investigate sensor," not issued as a work order.
- **Alarm-flood grouping feeds prioritization, not noise:** during a flood (>10/10 min), correlated alarms are **grouped to a probable root** (first-out + asset/cause grouping) so the work-order engine sees *one root candidate*, not 40 chattering symptoms.

## E4. Determinism & testability strategy

- **Virtual clock** for all windows, drift slopes, alarm dwell/chatter timers, P-F scheduling, MTBF/MTTR accounting. No wall-clock.
- **Seeded entropy** for any sampled ordering / fixture noise injection; runs reproducible from `(seed, ingestion-log)`.
- **Event-sourced ingestion:** the historian is an **append-only log of readings** (source-timestamped, quality-stamped); features/states/health/advisories are **projections** that re-fold deterministically — including under late arrivals.
- **Fixture adapters, named, deterministic:** the **historian stream** (replays recorded mixed-rate numeric + categorical tags with quality flags, late arrivals, comm-loss/death certs), recorded **vibration waveforms** (real-shaped series so FFT/envelope features are exercised on genuine signals, not toy sines), a **clock**, a **CMMS/work-order sink** (records would-be work orders), a **spare-parts inventory** fixture, and a **production-schedule** fixture. `npm test` touches no live OPC/MQTT server, no network, no real sensors.
- **The four named simulation fixtures are the flagship scenarios** (build their data deterministically): **pump bearing failure** (BPFO/BPFI envelope growth crossing ISO zones over time), **compressor leak** (pressure-deviation + temperature trend), **conveyor misalignment** (vibration signature + cycle context), and the **false-positive sensor fault** (a Bad-quality spike that **must NOT** generate a work order — the negative test that proves honesty).

## E5. Adversarial, failure, and edge-case scenarios (ship them as fixtures)

1. **The false-positive sensor fault.** A transmitter glitches to full-scale for 3 samples (quality Bad: out-of-range). The naive system raises a critical vibration alarm and a work order. The correct system **quarantines** the samples, marks the feature Bad-quality, **issues no work order**, and instead raises a *sensor-health* advisory. This is the headline negative test.
2. **The stale last-known-value.** Comm-loss (device death cert); the historian keeps reporting the last value. Without quality awareness this reads as "perfectly stable, healthy." The system must treat post-death reads as **stale/Uncertain**, *not* as evidence of health, and flag the data gap.
3. **The late sample that flips a verdict.** A window computed as Zone-B-OK; a late-arriving high-amplitude sample lands inside it. Re-fold pushes it to Zone-C; the recommendation and its rank update — and the revision is auditable (old → new, with the triggering late sample cited).
4. **The unit trap.** Two tags both "temperature" but one in °C and one in °F (or pressure in bar vs. psi). An implicit comparison or threshold reuse across units is a **hard error**; the model must refuse to compare unlike units. [explicit requirement: "never compare unlike units implicitly"]
5. **The alarm flood / chatter.** A process upset trips 30 alarms in 4 minutes, three of them chattering (≥3 transitions/60 s). The system **deadbands** the chatterers, **groups** the flood to a probable root, and presents one prioritized item — not 30.
6. **The spare-availability flip.** A medium-severity bearing recommendation ranks low while the spare is on-shelf; the spare gets consumed by another line → lead-time 6 weeks → the **same health state now ranks higher** (act before the window closes). Tested both directions.
7. **The P-F-too-short case.** A degradation whose estimated P-F interval is *shorter* than the soonest maintenance window → the advisory escalates to "cannot be addressed on-condition; consider run-to-failure mitigation / production change," rather than scheduling a task that can't be executed in time.
8. **The category-tag event.** A discrete/categorical tag (e.g. run/stop, valve open/closed) participates in the root-cause timeline; the feature engine must handle **non-numeric** tags without coercing them to numbers.

## E6. Rigorous acceptance criteria (invariant + property-based)

Beyond the base criteria:

- **Order-independence of features (property):** the projected feature/state/health set is **identical** for any seeded permutation of the same reading multiset (out-of-order + late + duplicate readings). *This is the central determinism guarantee.*
- **No-prophecy-without-evidence (invariant):** **no** work-order recommendation exists whose supporting feature set includes a quarantined (Bad-quality) feature as a *load-bearing* input. (Differential test against the evidence links.) The false-positive sensor fixture yields **zero** work orders.
- **Quality monotonicity (property):** a derived feature's quality is never *better* than the worst load-bearing input above the Bad-fraction; fuzz the input qualities.
- **No implicit unit comparison (invariant):** every comparison/threshold application asserts unit compatibility; a unit mismatch raises rather than silently computing.
- **Context-sensitivity (example + property):** flipping spare-availability or production-window strictly reorders the priority list in the documented direction; the rank delta is explainable to the changed fact.
- **Raw/derived separation in timelines (invariant):** root-cause timelines store **raw evidence and derived features separately** and never overwrite raw with derived; re-folding reproduces both.
- **Totality of explanation:** redact prose; the structured record alone answers "why this work order, at this rank, from which features (and their quality), matched to which FMEA mode, under which spare/window context."
- **Reliability-metric correctness:** MTBF/MTTR computed from the downtime/work-order log match hand-worked fixtures exactly.

## E7. The concrete first vertical slice (the on-ramp — ~22–26 cards, build THIS first)

Prove honesty + determinism on **one asset (the pump bearing)** end-to-end before breadth:

1. **Domain core + historian log:** typed entities (Plant→Line→Asset→Component, SensorTag w/ unit+quality+rate metadata, Reading, Alarm, FailureMode, WorkOrder, SparePart, Technician, DowntimeEvent) + append-only source-timestamped reading log + virtual clock + seeded PRNG. (~5 cards)
2. **Quality-propagating feature engine (E2):** time-windowed RMS-velocity + temperature-slope + the **FFT/envelope** bearing-frequency features over a **recorded waveform fixture**, with worst-of quality propagation, deterministic irregular-spacing handling, and **late-arrival re-folding** with revision counters. (~5 cards)
3. **ISO 20816 zone classifier + bearing-defect (BPFO/BPFI) matcher** as data-driven, per-asset-class rules returning cited zone/frequency reasons. (~3 cards)
4. **FMEA failure-mode library** (symptom→threshold→inspection→parts→impact, with S×O×D RPN) for bearing modes, wired to State-Detection/Health-Assessment. (~3 cards)
5. **Context-aware work-order prioritizer (E3):** risk × safety-class × spare-availability × production-window × P-F-fit, fully explainable, **refusing** quarantined-evidence recommendations. (~3 cards)
6. **Root-cause timeline** (raw + derived separated) + **MTBF/MTTR** report + the deterministic test battery: order-independence property, no-prophecy invariant (the **false-positive sensor fixture → zero work orders**), unit-mismatch invariant, and the spare/window context-flip tests — green on all four named simulation fixtures. (~4 cards)

If that slice holds, the compressor/conveyor scenarios are *FMEA + feature breadth on a proven, honest engine*; ISA-18.2 alarm-flood grouping and the broader dashboards are projections of trustworthy features.

## E8. Domain knowledge-debt to track (surface, don't bluff)

- **ISO 20816 zone boundaries** depend on machine class, power, and mounting (rigid/flexible); the fixtures encode *defensible per-class* tables, flagged as expert-review-needed — not a single universal mm/s threshold.
- **Bearing geometry** (pitch diameter, ball diameter, ball count, contact angle) drives BPFO/BPFI; where geometry is unknown, the system must flag "defect-frequency estimate uncertain," not invent numbers.
- **RUL / prognostic models** are genuinely model-dependent and data-hungry; implement a transparent trend-to-threshold (and optionally Weibull) baseline with **confidence intervals**, and mark anything beyond it as future expert/ML work — never present a point RUL as fact (the anti-"failure prophecy" stance).
- **Quality-code semantics** vary by historian/vendor (OPC DA vs. UA vs. Sparkplug); the lattice here is a defensible normalization, flagged for mapping review per integration.
- **Alarm rationalization** (priority/limit/cause/consequence/corrective-action per ISA-18.2) is a plant-specific engineering exercise; the engine supports data-driven alarm config but the *rationalized values* are expert-supplied.
- **Safety classification** of assets (which failure modes are safety-critical) is a process-safety judgment (and may intersect IEC 61511/SIL); model the flag, defer the determination to experts.
- **P-F interval estimates** are empirical per failure mode; record the assumption + its source, flag low-confidence estimates.

## E9. Why this is a great !Klein challenge

The temptation for a weak model is to *bluff competence* — threshold a clean signal and declare a failure. This spec, made rigorous, **rewards honesty over confidence**: the headline tests are *negative* (a Bad-quality spike must produce **zero** work orders; a stale value must not read as health) and *context-sensitive* (the same health ranks differently as spares/windows change). All of it is deterministic (virtual clock + order-independent re-folding over recorded waveforms), so a swarm of small local models is graded on **building the right quality-propagating, evidence-gated pipeline and refusing to prophesy** — exactly the discipline (decision-support, not magic) that separates a real reliability platform from an ML demo, and exactly what !Klein's governed-decomposition thesis is meant to deliver at this tier.

---

## Small-model build guide (3B-ready)

This section makes the spec mechanically buildable by a ~3B parameter local model. Every card below is small enough to implement and verify in isolation. Follow the dependency order exactly — do not skip ahead.

### 1. Glossary & ground rules

**Domain terms:**

- **Plant** — top-level entity; contains lines.
- **Line** — a production line within a plant; contains assets.
- **Asset** — a piece of equipment (e.g. "Pump P-101"); has an id, name, lineId, safetyClass (`'standard' | 'safety-critical'`), and a `failureModeIds[]`.
- **Component** — a sub-unit of an asset (e.g. "drive-end bearing"); has an id, assetId, name.
- **SensorTag** — a data source attached to a component or asset; carries: id, assetId, componentId?, `unit: string`, `dataType: 'numeric' | 'categorical'`, `expectedIntervalMs: number`, `displayName: string`. Tag identity is separate from display name.
- **Reading** — a single data point from a tag: id, tagId, `sourceTimestamp: number` (device-reported, trusted for ordering), `receivedAt: number` (historian clock), `value: number | string`, `quality: Quality`.
- **Quality** — `{ code: QualityCode; subReason?: QualitySubReason }`. Code values: `'Good' | 'Uncertain' | 'Bad'`. Bad sub-reasons: `'sensor-fault' | 'out-of-range' | 'stale-last-known' | 'comm-loss' | 'calibration-suspect'`. Uncertain sub-reasons: `'interpolated' | 'low-confidence'`.
- **QualityLattice** — worst-of ordering: Bad < Uncertain < Good. A derived feature's quality is the worst of its input qualities (above a configurable `badFraction` threshold).
- **FeatureWindow** — a computed feature over a time window of readings; carries: tagId, `windowStart: number`, `windowEnd: number`, `value: number`, `unit: string`, `quality: Quality`, `contributingSampleCount: number`, `badSampleCount: number`, `windowRevision: number` (monotone, increments on late-arrival re-fold).
- **Virtual clock** — injected `Clock` with `now(): number`; used for all window boundaries, drift slopes, alarm dwell, P-F scheduling. Never `Date.now()`.
- **ISO 20816 zone** — vibration severity band: `'A' | 'B' | 'C' | 'D'`; thresholds are per-asset-class data, not global constants.
- **BPFO/BPFI** — Ball Pass Frequency Outer/Inner race; bearing defect frequencies computed from geometry + RPM. In the fixture, these are supplied as pre-computed values (no geometry solver needed in slice 1).
- **FailureMode** — an FMEA entry: id, assetId, name, severity (1–10), occurrence (1–10), detection (1–10), `rpn: number` (S×O×D), symptoms (`string[]`), thresholds (`ThresholdSpec[]`), recommendedInspections (`string[]`), requiredPartIds (`string[]`), productionImpact (`string`), estimatedPFIntervalMs: number.
- **WorkOrderCandidate** — a prioritization input: id, assetId, failureModeId, healthState (`HealthState`), supportingFeatures (`FeatureWindow[]`), spareAvailability (`'on-shelf' | 'lead-time'`), leadTimeMs?: number, productionWindowState (`'running' | 'window-tonight' | 'next-quarter'`), safetyClass (`Asset['safetyClass']`).
- **PrioritizedWorkOrder** — output of the prioritizer: workOrderCandidateId, rank (integer), score (number), explanation (`ExplanationRecord`), refused: boolean, refusedReason?: string.
- **ExplanationRecord** — `{ featureIds: string[], qualityUsed: QualityCode, fmeaMode: string, thresholdCrossed: string, spareContext: string, windowContext: string, pfWindow: string }`.
- **AlarmEvent** — `{ id, tagId, alarmType, triggeredAt, clearedAt?: number, quality: Quality, value: number }`.
- **P-F interval** — Point-P (first detectable failure sign) to Point-F (functional failure); a `number` in milliseconds, derived from the FailureMode; used to test whether a task can fit before F.
- **MTBF** — Mean Time Between Failures = total operating time / number of failures.
- **MTTR** — Mean Time to Repair = total repair time / number of repairs.
- **DowntimeEvent** — `{ id, assetId, startAt, endAt?, type: 'planned' | 'unplanned', workOrderId? }`.

**Stack:**

- Language: TypeScript (strict, no `any`).
- Runtime: Node.js 20+.
- Test runner: Vitest (`npm test` = `vitest run`).
- No build step for tests; `vitest.config.ts` handles TypeScript via Vite.
- No runtime dependencies beyond Node built-ins and `vitest`; all domain logic is pure functions.
- Fixture data in `src/fixtures/*.ts` (typed constants, no JSON files).
- Adapter interfaces in `src/adapters/`; deterministic implementations in `src/adapters/fixture/`.

**Acceptance command (exact steps):**

```
cd <project-root>
npm install        # first time only
npm test           # vitest run — must exit 0 with all suites green
```

No network, no live OPC/MQTT, no live sensors, no wall-clock, no ML models.

**Determinism rules (imperative):**

1. Never call `Date.now()` or `Math.random()` in domain modules. Use injected `Clock` and `SeededRng`.
2. All windows are in **time** (ms), not sample count. Feature math must handle irregular spacing explicitly.
3. A feature whose `badFraction` threshold is exceeded returns `quality: 'Bad'`; never average Bad samples silently.
4. A work-order recommendation over a Bad-quality feature is **refused**, not issued.
5. The historian is append-only. Projections (features, states, health, advisories) re-fold deterministically.
6. Late-arriving samples trigger a re-fold of affected windows; the `windowRevision` counter increments.

---

### 2. The explicit task graph for the first vertical slice

The first vertical slice covers E7 items 1–6: domain core + historian, quality-propagating feature engine, ISO 20816 + BPFO/BPFI classifier, FMEA library, context-aware work-order prioritizer, root-cause timeline + MTBF/MTTR + invariant test battery. Build exactly these 23 cards in order.

---

**`M01` — Project scaffold and virtual clock**

dependsOn: none

files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/lib/clock.ts`, `test/lib/clock.test.ts`

interface:
```ts
export interface Clock { now(): number }
export class ManualClock implements Clock {
  constructor(private _now: number) {}
  now() { return this._now }
  advance(ms: number) { this._now += ms }
  set(ts: number) { this._now = ts }
}
```

how to implement: same pattern as the Construction project `S01`. `package.json` with `vitest`, `typescript`; `tsconfig.json` strict; `vitest.config.ts` empty `defineConfig({})`.

acceptance: `ManualClock(1000).now() === 1000`; `advance(500)` → 1500; `set(0)` → 0. `npm test` → green.

---

**`M02` — Seeded PRNG**

dependsOn: `M01`

files: `src/lib/prng.ts`, `test/lib/prng.test.ts`

interface:
```ts
export class SeededRng {
  constructor(seed: number) {}
  next(): number             // [0,1) deterministic
  nextInt(max: number): number
  shuffle<T>(arr: T[]): T[]
}
```

how to implement: LCG `state = (state * 1664525 + 1013904223) >>> 0`. Same implementation as Construction `S02`.

acceptance: same two assertions (seed stability + known permutation for seed 99). `npm test` → green.

---

**`M03` — Core domain types**

dependsOn: `M01`

files: `src/domain/types.ts`, `test/domain/types.test.ts`

interface (write all fields from glossary; excerpt below):
```ts
export type QualityCode = 'Good' | 'Uncertain' | 'Bad'
export type QualitySubReason =
  | 'sensor-fault' | 'out-of-range' | 'stale-last-known' | 'comm-loss' | 'calibration-suspect'
  | 'interpolated' | 'low-confidence'

export interface Quality { code: QualityCode; subReason?: QualitySubReason }

export interface SensorTag {
  id: string; assetId: string; componentId?: string; unit: string
  dataType: 'numeric' | 'categorical'; expectedIntervalMs: number; displayName: string
}

export interface Reading {
  id: string; tagId: string; sourceTimestamp: number; receivedAt: number
  value: number | string; quality: Quality
}

export interface FeatureWindow {
  id: string; tagId: string; windowStart: number; windowEnd: number
  value: number; unit: string; quality: Quality
  contributingSampleCount: number; badSampleCount: number
  windowRevision: number
}

export interface Asset {
  id: string; lineId: string; name: string
  safetyClass: 'standard' | 'safety-critical'
  failureModeIds: string[]
}

export interface FailureMode {
  id: string; assetId: string; name: string
  severity: number; occurrence: number; detection: number; rpn: number
  symptoms: string[]; thresholds: ThresholdSpec[]
  recommendedInspections: string[]; requiredPartIds: string[]
  productionImpact: string; estimatedPFIntervalMs: number
}

export interface ThresholdSpec {
  featureType: string; unit: string; zone?: string
  lowerBound?: number; upperBound?: number; citedStandard: string
}

export interface DowntimeEvent {
  id: string; assetId: string; startAt: number; endAt?: number
  type: 'planned' | 'unplanned'; workOrderId?: string
}

export interface WorkOrderCandidate {
  id: string; assetId: string; failureModeId: string
  healthState: HealthState; supportingFeatures: FeatureWindow[]
  spareAvailability: 'on-shelf' | 'lead-time'; leadTimeMs?: number
  productionWindowState: 'running' | 'window-tonight' | 'next-quarter'
  safetyClass: Asset['safetyClass']
}

export type HealthState = 'normal' | 'abnormal' | 'degraded' | 'critical'
```

acceptance: compile check with `tsc --noEmit`; a trivial test constructs one `Reading` literal with `satisfies Reading`. `npm test` → green.

---

**`M04` — Quality lattice**

dependsOn: `M03`

files: `src/domain/quality.ts`, `test/domain/quality.test.ts`

interface:
```ts
export function worstQuality(qualities: Quality[]): Quality
  // returns the worst quality in the array; Bad beats Uncertain beats Good
export function isEligibleForRecommendation(q: Quality): boolean
  // returns true only if q.code === 'Good'
export function propagateQuality(
  inputQualities: Quality[],
  badFractionThreshold: number   // e.g. 0.1 = 10%
): Quality
  // if fraction of Bad inputs > threshold, returns Bad; else worst of others
```

how to implement:
1. Define quality rank: `Bad = 0, Uncertain = 1, Good = 2`.
2. `worstQuality`: return the element with the lowest rank; preserve its `subReason`.
3. `isEligibleForRecommendation`: `q.code === 'Good'`.
4. `propagateQuality`: count Bad inputs; if `badCount / total > badFractionThreshold`, return `{ code: 'Bad', subReason: 'sensor-fault' }`; else return `worstQuality(inputQualities)`.

acceptance: `test/domain/quality.test.ts`:
- `worstQuality([Good, Bad, Uncertain])` → `Bad`.
- `worstQuality([Good, Good])` → `Good`.
- `propagateQuality([Good, Bad, Good, Good, Good], 0.1)` → `Bad` (1/5 = 20% > 10%).
- `propagateQuality([Good, Uncertain], 0.5)` → `Uncertain` (0 Bad).
- `isEligibleForRecommendation(Bad)` → false.
`npm test` → green.

---

**`M05` — Append-only historian reading log**

dependsOn: `M03`

files: `src/domain/historian.ts`, `test/domain/historian.test.ts`

interface:
```ts
export class HistorianLog {
  append(reading: Reading): void
  readingsForTag(tagId: string): readonly Reading[]
    // sorted by sourceTimestamp ascending
  readingsInWindow(tagId: string, windowStart: number, windowEnd: number): readonly Reading[]
    // readings where sourceTimestamp in [windowStart, windowEnd]
  allTags(): readonly string[]
}
```

how to implement:
1. Private `Map<string, Reading[]>` keyed by tagId.
2. `append`: push to the tag's array; mark the log dirty for that tag.
3. `readingsForTag`: return a copy sorted by `sourceTimestamp` (use `sort` on a slice).
4. `readingsInWindow`: filter from `readingsForTag`.
5. No mutation of existing readings — append-only.

acceptance: `test/domain/historian.test.ts`:
- Append 3 readings for tag-1 in reverse sourceTimestamp order; `readingsForTag('tag-1')` returns them sorted by sourceTimestamp ascending.
- `readingsInWindow` returns only readings within the window boundary.
- Appending a reading for tag-2 does not affect tag-1 results.
- Total reading count after 4 appends is 4 (no deduplication — each append is a new log entry).
`npm test` → green.

---

**`M06` — Time-windowed RMS feature (numeric, irregular spacing)**

dependsOn: `M04`, `M05`

files: `src/domain/features/rms.ts`, `test/domain/features/rms.test.ts`

interface:
```ts
export interface RmsOptions {
  tagId: string; windowStart: number; windowEnd: number
  badFractionThreshold: number   // default 0.1
}
export function computeRmsVelocity(
  log: HistorianLog,
  opts: RmsOptions,
  clock: Clock
): FeatureWindow
```

how to implement:
1. Get readings in window via `log.readingsInWindow(opts.tagId, opts.windowStart, opts.windowEnd)`.
2. If zero readings, return FeatureWindow with `quality: { code: 'Bad', subReason: 'sensor-fault' }`, `value: 0`, `contributingSampleCount: 0`.
3. Filter numeric readings (skip categorical values).
4. Compute RMS: `Math.sqrt(readings.reduce((sum, r) => sum + (r.value as number) ** 2, 0) / readings.length)`.
5. Propagate quality with `propagateQuality(readings.map(r => r.quality), opts.badFractionThreshold)`.
6. Return FeatureWindow with id `"rms-<tagId>-<windowStart>"`, `windowRevision: 0`.

acceptance: `test/domain/features/rms.test.ts`:
- 4 Good readings `[1, 2, 3, 4]` → RMS = `Math.sqrt((1+4+9+16)/4) = Math.sqrt(7.5) ≈ 2.739`; assert `Math.abs(result.value - 2.739) < 0.001`; quality `Good`.
- 4 readings where 2 are `Bad` (fraction = 0.5 > threshold 0.1) → result quality `Bad`.
- Zero readings → quality `Bad`, value `0`.
- Irregular spacing (readings at t=1, t=10, t=100 inside a window) — the RMS is over the values, not time-weighted; assert the result is the same regardless of spacing (it is a pure value-average, not an integral).
`npm test` → green.

---

**`M07` — Temperature slope feature (drift over window)**

dependsOn: `M04`, `M05`

files: `src/domain/features/temp-slope.ts`, `test/domain/features/temp-slope.test.ts`

interface:
```ts
export function computeTemperatureSlope(
  log: HistorianLog,
  tagId: string,
  windowStart: number,
  windowEnd: number,
  clock: Clock
): FeatureWindow   // value = slope in units/ms (positive = rising)
```

how to implement:
1. Get readings in window; filter to Good/Uncertain; if fewer than 2, return Bad feature.
2. Compute simple linear regression slope: `(n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)` where x = sourceTimestamp, y = value.
3. Use `propagateQuality` on the contributing readings.
4. Return FeatureWindow with unit `"<tag-unit>/ms"`, windowRevision 0.

acceptance: `test/domain/features/temp-slope.test.ts`:
- Readings at t=0→value=10, t=100→value=20, t=200→value=30 (all Good) → slope = `0.1` units/ms; assert `Math.abs(result.value - 0.1) < 0.0001`; quality Good.
- 1 reading → quality Bad (insufficient data).
- All readings are `Uncertain` → result quality `Uncertain`.
`npm test` → green.

---

**`M08` — Late-arrival re-folding with revision counter**

dependsOn: `M05`, `M06`

files: `src/domain/features/feature-store.ts`, `test/domain/features/feature-store.test.ts`

interface:
```ts
export class FeatureStore {
  constructor(private log: HistorianLog, private clock: Clock) {}
  trackWindow(spec: { tagId: string; windowStart: number; windowEnd: number; featureType: 'rms' | 'slope' }): void
  onReadingAppended(reading: Reading): void
  getFeature(tagId: string, windowStart: number): FeatureWindow | undefined
  allFeatures(): readonly FeatureWindow[]
}
```

how to implement:
1. Maintain a `Map<string, FeatureWindow>` keyed by `"<tagId>-<windowStart>"`.
2. `trackWindow`: store the spec; compute initial feature; store it with `windowRevision: 0`.
3. `onReadingAppended(reading)`: for each tracked window where `windowStart <= reading.sourceTimestamp <= windowEnd` and `tagId === reading.tagId`, re-compute the feature and store with `windowRevision += 1`.
4. `getFeature`: lookup by key.

acceptance: `test/domain/features/feature-store.test.ts`:
- Track window [0, 1000] for tag-A RMS. Append 3 Good readings in window → feature computed, revision 0.
- Append a **late-arriving** reading with `sourceTimestamp = 500` (inside window) after the window was already computed → `onReadingAppended` triggers re-fold; new feature has `windowRevision === 1`.
- Order-independence: append readings [t=300, t=100, t=200] for tag-B; then append [t=100, t=300, t=200] for tag-C (same values, different order) → after all appends, both tags' features have identical `value` (the RMS does not depend on arrival order, only on the values present).
`npm test` → green.

---

**`M09` — Fixtures: pump bearing scenario**

dependsOn: `M03`

files: `src/fixtures/pump-bearing.ts`

interface: exports typed constants for the pump bearing slice.

```ts
export const CLOCK_EPOCH = 1_700_000_000_000

export const ASSET_PUMP: Asset = {
  id: 'asset-pump-101', lineId: 'line-1', name: 'Pump P-101',
  safetyClass: 'safety-critical', failureModeIds: ['fm-bpfo-1']
}

export const TAG_VIB: SensorTag = {
  id: 'tag-vib-de', assetId: 'asset-pump-101', componentId: 'comp-de-bearing',
  unit: 'mm/s', dataType: 'numeric', expectedIntervalMs: 1000, displayName: 'Drive-End Vibration RMS'
}

export const TAG_TEMP: SensorTag = {
  id: 'tag-temp-bearing', assetId: 'asset-pump-101',
  unit: 'degC', dataType: 'numeric', expectedIntervalMs: 5000, displayName: 'Bearing Temperature'
}

// ISO 20816-3 Zone thresholds for medium pumps, rigid mount (mm/s RMS velocity)
export const ISO20816_PUMP_ZONES = {
  A_max: 1.12, B_max: 2.8, C_max: 7.1   // >7.1 = Zone D
}

// BPFO frequency for the fixture bearing (pre-computed, no geometry solver needed)
// At 1500 RPM: BPFO = 87.3 Hz (fixture value; real calc would use geometry)
export const BEARING_BPFO_HZ = 87.3
export const BEARING_BPFI_HZ = 112.7  // BPFI at same speed

// Failure mode: BPFO outer-race defect
export const FM_BPFO: FailureMode = {
  id: 'fm-bpfo-1', assetId: 'asset-pump-101',
  name: 'Outer Race Bearing Defect (BPFO)',
  severity: 8, occurrence: 4, detection: 3, rpn: 96,
  symptoms: ['elevated-vibration-rms', 'bpfo-envelope-energy'],
  thresholds: [
    { featureType: 'rms-velocity', unit: 'mm/s', zone: 'C', lowerBound: 2.8, citedStandard: 'ISO 20816-3' },
    { featureType: 'envelope-bpfo', unit: 'g', lowerBound: 0.05, citedStandard: 'internal-fixture' }
  ],
  recommendedInspections: ['bearing-inspection', 'lubrication-check'],
  requiredPartIds: ['part-bearing-6205'],
  productionImpact: 'Pump trip → line shutdown, estimated 4h downtime',
  estimatedPFIntervalMs: 30 * 24 * 3600 * 1000  // 30 days
}

// Good readings: Zone A (healthy, RMS < 1.12 mm/s)
export const READINGS_ZONE_A: Reading[] = [
  { id: 'r1', tagId: 'tag-vib-de', sourceTimestamp: CLOCK_EPOCH + 0, receivedAt: CLOCK_EPOCH + 0,
    value: 0.8, quality: { code: 'Good' } },
  { id: 'r2', tagId: 'tag-vib-de', sourceTimestamp: CLOCK_EPOCH + 1000, receivedAt: CLOCK_EPOCH + 1000,
    value: 0.9, quality: { code: 'Good' } },
]

// Zone C readings: degraded (RMS > 2.8 mm/s)
export const READINGS_ZONE_C: Reading[] = [
  { id: 'r3', tagId: 'tag-vib-de', sourceTimestamp: CLOCK_EPOCH + 2000, receivedAt: CLOCK_EPOCH + 2000,
    value: 3.5, quality: { code: 'Good' } },
  { id: 'r4', tagId: 'tag-vib-de', sourceTimestamp: CLOCK_EPOCH + 3000, receivedAt: CLOCK_EPOCH + 3000,
    value: 4.1, quality: { code: 'Good' } },
]

// False-positive: sensor glitch — Bad quality out-of-range spike
export const READINGS_BAD_SPIKE: Reading[] = [
  { id: 'r5', tagId: 'tag-vib-de', sourceTimestamp: CLOCK_EPOCH + 4000, receivedAt: CLOCK_EPOCH + 4000,
    value: 999.9, quality: { code: 'Bad', subReason: 'out-of-range' } },
  { id: 'r6', tagId: 'tag-vib-de', sourceTimestamp: CLOCK_EPOCH + 5000, receivedAt: CLOCK_EPOCH + 5000,
    value: 999.9, quality: { code: 'Bad', subReason: 'out-of-range' } },
  { id: 'r7', tagId: 'tag-vib-de', sourceTimestamp: CLOCK_EPOCH + 6000, receivedAt: CLOCK_EPOCH + 6000,
    value: 999.9, quality: { code: 'Bad', subReason: 'out-of-range' } },
]

// Stale: comm-loss death cert — last-known-value trap
export const READINGS_STALE: Reading[] = [
  { id: 'r8', tagId: 'tag-vib-de', sourceTimestamp: CLOCK_EPOCH + 7000, receivedAt: CLOCK_EPOCH + 7000,
    value: 0.85, quality: { code: 'Uncertain', subReason: 'stale-last-known' } },
]
```

acceptance: compile check (`tsc --noEmit`); a trivial import test. `npm test` → green.

---

**`M10` — ISO 20816 zone classifier**

dependsOn: `M03`, `M09`

files: `src/domain/condition/iso20816.ts`, `test/domain/condition/iso20816.test.ts`

interface:
```ts
export type VibrationZone = 'A' | 'B' | 'C' | 'D'
export interface ZoneClassification {
  zone: VibrationZone
  rmsValue: number
  unit: 'mm/s'
  citedStandard: 'ISO 20816-3'
  thresholds: { A_max: number; B_max: number; C_max: number }
}
export function classifyVibrationZone(
  rmsVelocityMmPerS: number,
  thresholds: { A_max: number; B_max: number; C_max: number }
): ZoneClassification
```

how to implement:
1. If `rmsVelocityMmPerS <= thresholds.A_max` → zone `'A'`.
2. Else if `<= B_max` → `'B'`.
3. Else if `<= C_max` → `'C'`.
4. Else → `'D'`.
5. Always include the input thresholds in the result (they came from per-asset-class data, not a global constant).

acceptance: `test/domain/condition/iso20816.test.ts` using `ISO20816_PUMP_ZONES`:
- `0.8` → `'A'`; `2.0` → `'B'`; `3.5` → `'C'`; `8.0` → `'D'`.
- The classification at the exact boundary: `1.12` → `'A'` (i.e. `<= A_max` is `'A'`).
`npm test` → green.

---

**`M11` — BPFO envelope energy feature (deterministic over fixture waveform)**

dependsOn: `M04`, `M05`, `M09`

files: `src/fixtures/bearing-waveform.ts`, `src/domain/features/envelope.ts`, `test/domain/features/envelope.test.ts`

interface:
```ts
// src/fixtures/bearing-waveform.ts
// A pre-recorded 256-point acceleration waveform at 25.6kHz sample rate
// representing a bearing with developing BPFO defect.
// Values are in g (gravitational acceleration units).
export const HEALTHY_WAVEFORM: number[] = [/* 256 near-zero values computed by formula */]
export const DEFECTIVE_WAVEFORM: number[] = [/* 256 values with BPFO tone computed by formula */]
export const SAMPLE_RATE_HZ = 25600
export const BPFO_HZ = 87.3   // matches BEARING_BPFO_HZ fixture

// src/domain/features/envelope.ts
export interface EnvelopeFeature {
  tagId: string; windowId: string
  bpfoEnergyG: number           // amplitude at BPFO in envelope spectrum
  quality: Quality
}

export function computeEnvelopeFeature(
  waveform: number[],          // raw acceleration time series
  sampleRateHz: number,
  bpfoHz: number,
  quality: Quality             // quality of the source readings
): EnvelopeFeature
```

how to implement:
1. In `src/fixtures/bearing-waveform.ts`: generate `HEALTHY_WAVEFORM` as 256 values of `0.01 * Math.sin(2 * Math.PI * 10 * i / SAMPLE_RATE_HZ)` for `i` in 0..255 (10 Hz harmonic, no BPFO component); generate `DEFECTIVE_WAVEFORM` as the healthy signal plus `0.15 * Math.sin(2 * Math.PI * BPFO_HZ * i / SAMPLE_RATE_HZ)` (a BPFO tone). These are deterministic — compute them in the module body using a plain loop.
2. In `computeEnvelopeFeature`:
   a. Compute the DFT (use a simple O(n²) DFT for correctness over performance): for each frequency bin `k` from 0 to N-1, `X_re[k] = sum(waveform[n] * cos(2π*k*n/N))` and `X_im[k] = -sum(waveform[n] * sin(2π*k*n/N))`.
   b. Find the bin closest to `bpfoHz`: `bin = Math.round(bpfoHz * N / sampleRateHz)`.
   c. `bpfoEnergyG = Math.sqrt(X_re[bin]**2 + X_im[bin]**2) / N * 2` (two-sided to one-sided amplitude).
   d. Propagate `quality` as-is.
3. Return `{ tagId: 'fixture', windowId: 'fixture', bpfoEnergyG, quality }`.

acceptance: `test/domain/features/envelope.test.ts`:
- `computeEnvelopeFeature(HEALTHY_WAVEFORM, SAMPLE_RATE_HZ, BPFO_HZ, Good)` → `bpfoEnergyG < 0.02`.
- `computeEnvelopeFeature(DEFECTIVE_WAVEFORM, SAMPLE_RATE_HZ, BPFO_HZ, Good)` → `bpfoEnergyG >= 0.1`.
- Bad quality input → result quality `Bad`; `isEligibleForRecommendation(result.quality) === false`.
`npm test` → green.

---

**`M12` — State detection: health state from zone + envelope**

dependsOn: `M10`, `M11`, `M03`

files: `src/domain/condition/state-detection.ts`, `test/domain/condition/state-detection.test.ts`

interface:
```ts
export interface StateDetectionResult {
  healthState: HealthState
  citedFeatures: Array<{ featureType: string; value: number; zone?: VibrationZone; threshold?: number }>
  quality: Quality
  refusedDueToQuality: boolean
}

export function detectBearingHealth(
  rmsFeature: FeatureWindow,
  envelopeFeature: EnvelopeFeature,
  zoneThresholds: { A_max: number; B_max: number; C_max: number },
  envelopeThreshold: number,
  clock: Clock
): StateDetectionResult
```

how to implement:
1. **Quality gate:** if either input quality is `'Bad'`, return `{ healthState: 'normal', refusedDueToQuality: true, quality: { code: 'Bad' }, citedFeatures: [] }`.
2. Classify zone from `rmsFeature.value` and thresholds.
3. Check envelope: if `envelopeFeature.bpfoEnergyG >= envelopeThreshold`, mark as `bpfo-detected`.
4. Map zone + envelope to health: Zone A + no bpfo → `normal`; Zone B + no bpfo → `normal`; Zone B + bpfo → `abnormal`; Zone C → `degraded`; Zone D → `critical`.
5. Propagate quality as `worstQuality([rmsFeature.quality, envelopeFeature.quality])`.

acceptance: `test/domain/condition/state-detection.test.ts`:
- Zone A, no envelope → `normal`, `refusedDueToQuality: false`.
- Zone C, good quality → `degraded`.
- Zone D, good quality → `critical`.
- Bad-quality RMS → `refusedDueToQuality: true`.
- Envelope above threshold in Zone B → `abnormal`.
`npm test` → green.

---

**`M13` — FMEA failure-mode matching**

dependsOn: `M03`, `M09`, `M12`

files: `src/domain/health/fmea-matcher.ts`, `test/domain/health/fmea-matcher.test.ts`

interface:
```ts
export interface FmeaMatch {
  failureMode: FailureMode
  matchedSymptoms: string[]
  matchedThresholds: ThresholdSpec[]
  rpn: number
}

export function matchFailureMode(
  stateResult: StateDetectionResult,
  rmsValue: number,
  envelopeBpfo: number,
  failureModes: FailureMode[]
): FmeaMatch[]   // sorted by RPN descending; empty if refusedDueToQuality
```

how to implement:
1. If `stateResult.refusedDueToQuality === true`, return `[]`.
2. For each failure mode, check if any threshold is crossed (rms >= lowerBound for rms-velocity threshold; envelope >= lowerBound for envelope-bpfo threshold).
3. Collect matched thresholds; include mode if any matched.
4. Sort by `rpn` descending.

acceptance: `test/domain/health/fmea-matcher.test.ts`:
- Zone C rms=3.5, envelope=0.1, good quality, FM_BPFO → `[FM_BPFO]` matched.
- Zone A rms=0.8, envelope=0.01 → empty array.
- `refusedDueToQuality: true` → empty array.
`npm test` → green.

---

**`M14` — Context-aware work-order prioritizer**

dependsOn: `M12`, `M13`, `M03`

files: `src/domain/advisory/prioritizer.ts`, `test/domain/advisory/prioritizer.test.ts`

interface:
```ts
export interface PrioritizedWorkOrder {
  candidateId: string; rank: number; score: number
  refused: boolean; refusedReason?: string
  explanation: ExplanationRecord
}

export interface ExplanationRecord {
  featureIds: string[]; qualityUsed: QualityCode
  fmeaMode: string; thresholdCrossed: string
  spareContext: string; windowContext: string; pfWindow: string
}

export function prioritizeWorkOrders(
  candidates: WorkOrderCandidate[],
  clock: Clock
): PrioritizedWorkOrder[]
```

how to implement:
1. Quality gate: if any `supportingFeatures` item has `quality.code === 'Bad'`, mark `refused: true`.
2. Base score from healthState: `critical=100, degraded=50, abnormal=20, normal=5`.
3. Safety class multiplier: `safety-critical = × 1.5`.
4. Spare modifier: `lead-time = +20`.
5. Production window modifier: `window-tonight = +30`; `next-quarter = -10`.
6. Build explanation from inputs.
7. Sort non-refused by score descending; assign rank 1, 2, 3...

acceptance: `test/domain/advisory/prioritizer.test.ts`:
- Critical safety-critical + lead-time + window-tonight → high score, rank 1.
- Same health state standard class + on-shelf → lower score.
- Spare flip: on-shelf → lead-time → score increases by 20.
- Bad-quality feature → `refused: true`; zero non-refused results.
- Safety-critical outranks higher-RPN non-safety.
`npm test` → green.

---

**`M15` — Alarm chatter deadband and flood grouping**

dependsOn: `M03`, `M05`

files: `src/domain/alarms/alarm-manager.ts`, `test/domain/alarms/alarm-manager.test.ts`

interface:
```ts
export interface AlarmConfig {
  tagId: string; threshold: number; deadbandFraction: number
  chatterWindowMs: number; chatterCount: number
}
export interface FloodConfig {
  windowMs: number; maxAlarms: number
}
export interface AlarmManagerResult {
  activeAlarms: AlarmEvent[]
  chatterers: string[]
  floodDetected: boolean
  groupedRootCandidates: string[]
}
export function evaluateAlarms(
  newReading: Reading,
  previousAlarms: AlarmEvent[],
  config: AlarmConfig,
  floodConfig: FloodConfig,
  clock: Clock
): AlarmManagerResult
```

how to implement:
1. Threshold check with deadband: alarm if `value > threshold * (1 + deadbandFraction)`; clear if `value < threshold * (1 - deadbandFraction)`.
2. Chatter: count transitions for tagId in previousAlarms within chatterWindowMs; if >= chatterCount, add to chatterers.
3. Flood: count previousAlarms with `triggeredAt >= clock.now() - floodConfig.windowMs`; if >= maxAlarms, set floodDetected; first alarm is the root candidate.

acceptance:
- Threshold exceeded → one active alarm.
- Three rapid transitions in 60s → tagId in chatterers.
- 11 alarms in 10min → floodDetected: true; groupedRootCandidates has one entry.
- Deadband prevents spurious re-alarm.
`npm test` → green.

---

**`M16` — Root-cause timeline builder**

dependsOn: `M03`, `M05`, `M12`, `M13`

files: `src/domain/timeline/root-cause.ts`, `test/domain/timeline/root-cause.test.ts`

interface:
```ts
export interface RootCauseTimeline {
  assetId: string
  rawReadings: readonly Reading[]
  derivedFeatures: readonly FeatureWindow[]
  alarms: readonly AlarmEvent[]
  operatorNotes: string[]
  maintenanceActions: string[]
  stateDetections: StateDetectionResult[]
  fmeaMatches: FmeaMatch[]
  downtimeEvents: readonly DowntimeEvent[]
}

export function buildRootCauseTimeline(
  assetId: string,
  historian: HistorianLog,
  featureStore: FeatureStore,
  alarms: AlarmEvent[],
  downtimeEvents: DowntimeEvent[],
  operatorNotes: string[],
  maintenanceActions: string[],
  stateDetections: StateDetectionResult[],
  fmeaMatches: FmeaMatch[]
): RootCauseTimeline
```

how to implement: assemble all inputs; raw and derived stored separately; no computation.

acceptance:
- Append readings; compute RMS feature; build timeline → rawReadings.length > 0 and derivedFeatures.length > 0; they are separate arrays.
- Re-fold with same inputs → deep-equal result.
`npm test` → green.

---

**`M17` — MTBF/MTTR reliability report**

dependsOn: `M03`

files: `src/domain/reports/reliability.ts`, `test/domain/reports/reliability.test.ts`

interface:
```ts
export interface ReliabilityReport {
  assetId: string; observationPeriodMs: number
  totalDowntimeMs: number; totalUptimeMs: number
  failureCount: number; repairCount: number
  mtbfMs: number | null
  mttrMs: number | null
}

export function computeReliability(
  assetId: string,
  downtimeEvents: DowntimeEvent[],
  observationStart: number,
  observationEnd: number
): ReliabilityReport
```

how to implement:
1. Filter to assetId + window.
2. Sum unplanned durations for totalDowntimeMs.
3. mtbfMs = totalUptimeMs / failureCount (or null).
4. mttrMs = totalDowntimeMs / repairCount (or null).

acceptance:
- 3 unplanned events × 1h over 100h → mtbfMs ≈ 32.33h (within 1ms tolerance).
- Zero failures → mtbfMs === null.
- Hand-computed integer fixture asserts exact match.
`npm test` → green.

---

**`M18` — Order-independence property test**

dependsOn: `M05`, `M06`, `M08`, `M02`

files: `test/domain/features/order-independence.test.ts`

how to implement: create 10 readings; shuffle with SeededRng(99); append to two separate HistorianLogs in original and shuffled order; compare RMS feature values.

acceptance: both features have identical value (within 1e-10) and identical quality.code. `npm test` → green.

---

**`M19` — No-prophecy invariant test (false-positive sensor fixture → zero work orders)**

dependsOn: `M09`, `M06`, `M08`, `M12`, `M13`, `M14`

files: `test/domain/advisory/no-prophecy.test.ts`

how to implement: append READINGS_BAD_SPIKE; run full pipeline; assert refused === true and zero non-refused work orders.

acceptance: test passes. `npm test` → green.

---

**`M20` — Unit mismatch invariant test**

dependsOn: `M03`

files: `src/domain/units.ts`, `test/domain/units.test.ts`

interface:
```ts
export function assertUnitCompatible(unitA: string, unitB: string): void
export function applyThreshold(value: number, unit: string, threshold: ThresholdSpec): boolean
```

how to implement:
1. `assertUnitCompatible`: throw `Error("Unit mismatch: ${unitA} vs ${unitB}")` if different.
2. `applyThreshold`: call `assertUnitCompatible` first; then compare value against bounds.

acceptance:
- Same units → no throw.
- Different units → throws with "Unit mismatch" in message.
- Wrong-unit threshold application → throws.
`npm test` → green.

---

**`M21` — Stale-last-known-value test (comm-loss trap)**

dependsOn: `M05`, `M09`, `M12`

files: `test/domain/condition/stale-comm-loss.test.ts`

how to implement: append READINGS_STALE; run RMS; assert quality Uncertain/stale-last-known; assert isEligibleForRecommendation returns false.

acceptance: test passes. Stale values do not read as health. `npm test` → green.

---

**`M22` — Spare-availability and production-window context-flip test**

dependsOn: `M14`

files: `test/domain/advisory/context-flip.test.ts`

how to implement: create degraded safety-critical candidate; scoreA = on-shelf/running; scoreB = lead-time/running; scoreC = on-shelf/window-tonight. Assert scoreB > scoreA and scoreC > scoreA.

acceptance: test passes. Same health state produces different rank. `npm test` → green.

---

**`M23` — Integration test: all four simulation fixtures, full invariant battery**

dependsOn: `M09`–`M22`

files: `src/fixtures/simulation-scenarios.ts`, `test/integration/simulation-fixtures.test.ts`

interface: `src/fixtures/simulation-scenarios.ts` exports four named scenario builders:
- `buildPumpBearingScenario()` — Zone A → Zone C progression; one work order expected.
- `buildFalsePositiveSensorScenario()` — Bad-spike only; zero work orders.
- `buildCompressorLeakScenario()` — temperature slope rising + pressure deviation; one work order.
- `buildConveyorMisalignmentScenario()` — elevated RMS + categorical run/stop tag.

test assertions:
1. Pump: at least one non-refused work order.
2. False-positive: zero non-refused work orders.
3. Compressor: work order cites both feature types.
4. Conveyor: categorical tag value is `typeof 'string'` in raw readings.
5. Order-independence across all four scenarios (shuffle seed 7).
6. Unit-mismatch guard throws on wrong-unit threshold.

acceptance: all pass. `npm test` → all suites green.

---

### 3. The decomposition method for the remaining breadth

After the first slice is green, expand to compressor/conveyor FMEA modes, ISA-18.2 alarm rationalization, MTBF/MTTR dashboards, and the full P-F prognostic model using this repeatable recipe:

**Recipe for any new card cluster:**

1. **State the invariant:** what must this feature never do? (e.g., "must never recommend on Bad-quality inputs"; "must not compare unlike units").
2. **Write the type first:** define the function signature and return type before implementation.
3. **Write the negative test first:** what bad input should produce zero work orders / throw / return refused?
4. **Wire to quality propagation:** every new feature function must call `propagateQuality` and return a `FeatureWindow` or equivalent with a `quality` field.
5. **Use per-asset-class data, not global constants:** thresholds always come from a `ThresholdSpec[]` on the FailureMode or a zone-table fixture — never a magic number in the function body.

**Worked example A — Pressure deviation feature (for compressor scenario):**

> Compressor leak manifests as pressure below setpoint by > N% sustained over a window.

- `C01` — Add `TAG_PRESSURE` to compressor fixtures. `SensorTag` with `unit: 'bar'`. dependsOn: `M03`.
- `C02` — `computePressureDeviation(log, tagId, setpointBar, windowStart, windowEnd, clock): FeatureWindow`. Value = mean pressure deviation from setpoint over the window. Quality propagated from readings. dependsOn: `M04`, `M05`.
- `C03` — Add a `ThresholdSpec` for pressure (`{ featureType: 'pressure-deviation', unit: 'bar', lowerBound: -0.5 }`) to a compressor FailureMode. Wire into `matchFailureMode`. Test: deviation = -0.6 → match; deviation = -0.2 → no match. dependsOn: `C02`, `M13`.

**Worked example B — Nelson rule 5 (6-in-a-row trend) SPC check:**

> Rule 5 fires when 6 consecutive points are all increasing or all decreasing.

- `N01` — `checkNelsonRule5(series: number[]): boolean`. Pure function. True if last 6 values are all strictly increasing or all strictly decreasing. dependsOn: none.
- `N02` — `evaluateSpcRules(series, controlLimits, clock)` dispatcher for all 8 Nelson rules. Test: rising series trips rule 5 but not rule 1. dependsOn: `N01`.
- `N03` — Integration: pump temperature series (gradually rising, no limit breach) → rule 5 fires; flat series fires nothing. dependsOn: `N02`, `M09`.

**Worked example C — P-F interval fit check (advisory escalation):**

> If the P-F interval is shorter than time to next maintenance window, escalate.

- `P01` — `computePFWindowFit(healthState, failureMode, productionWindowState, clock): { fitsInWindow: boolean; estimatedTimeToFMs: number; urgencyNote: string }`. dependsOn: `M03`.
- `P02` — Wire into `prioritizeWorkOrders`: if `!fitsInWindow`, add urgency note and +15 to score; if past F, refuse. dependsOn: `P01`, `M14`.

---

### 4. Per-task implementation conventions

**File/folder layout:**
```
src/
  lib/             # clock.ts, prng.ts
  domain/
    features/      # rms.ts, temp-slope.ts, envelope.ts, feature-store.ts
    condition/     # iso20816.ts, state-detection.ts
    health/        # fmea-matcher.ts
    advisory/      # prioritizer.ts
    alarms/        # alarm-manager.ts
    timeline/      # root-cause.ts
    reports/       # reliability.ts
  fixtures/        # pump-bearing.ts, bearing-waveform.ts, simulation-scenarios.ts
  adapters/
    fixture/
test/
  lib/
  domain/
    features/
    condition/
    health/
    advisory/
    alarms/
    timeline/
    reports/
  integration/
```

**Naming:** source files `kebab-case.ts`; test files `<source-name>.test.ts`; functions `camelCase`; types `PascalCase`; fixture constants `SCREAMING_SNAKE_CASE`.

**How to write a test (minimal template):**
```ts
// test/domain/condition/iso20816.test.ts
import { describe, it, expect } from 'vitest'
import { classifyVibrationZone } from '../../../src/domain/condition/iso20816.js'
import { ISO20816_PUMP_ZONES } from '../../../src/fixtures/pump-bearing.js'

describe('classifyVibrationZone', () => {
  it('classifies Zone C for 3.5 mm/s on medium pump', () => {
    const result = classifyVibrationZone(3.5, ISO20816_PUMP_ZONES)
    expect(result.zone).toBe('C')
    expect(result.citedStandard).toBe('ISO 20816-3')
  })
})
```

**Definition of done for any card:**
1. `tsc --noEmit` passes (no `any`).
2. `npm test` → green.
3. No `Date.now()`, `Math.random()`, or network calls.
4. Every feature function returns a `quality` field.
5. No global threshold constants — thresholds come from `ThresholdSpec` data.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Issuing a work order from a Bad-quality feature.**
A 3B will see RMS = 999.9 mm/s and generate a "critical bearing failure" work order. The quality gate in `M12` and `M14` prevents this. The no-prophecy test (`M19`) directly asserts zero non-refused work orders from Bad-spike readings. Mitigation: `StateDetectionResult` has `refusedDueToQuality: boolean`; prioritizer checks it before scoring; `matchFailureMode` returns `[]` if refused.

**Pitfall 2 — Using sample count instead of time windows.**
A 3B will compute RMS over "the last 100 readings" rather than "the last 10 seconds." With irregular sampling, these are completely different. Feature functions take `windowStart` and `windowEnd` as time arguments; the irregular-spacing test in `M06` verifies readings at t=1, t=10, t=100 all contribute regardless of spacing.

**Pitfall 3 — Not re-folding on late arrivals.**
A 3B will compute a feature, store it, and never revisit it when a late reading arrives. The `FeatureStore.onReadingAppended` triggers re-fold, and the late-arrival test in `M08` verifies `windowRevision` increments. A model that ignores late arrivals will have all features stuck at revision 0.

**Pitfall 4 — Global ISO 20816 threshold constants.**
A 3B will write `const ZONE_C_THRESHOLD = 7.1` at module top and use it everywhere. The `classifyVibrationZone` function signature requires thresholds as a parameter — it cannot be called with a global constant. Mitigation: thresholds always come from fixture data (`ISO20816_PUMP_ZONES`) passed in.

**Pitfall 5 — Coercing a categorical tag value to a number.**
A 3B will convert `run/stop` to `1/0`. `Reading.value` is `number | string`; feature functions skip non-numeric values via `typeof r.value === 'number'` filter. The conveyor integration test asserts `typeof value === 'string'` for the categorical tag.

**Pitfall 6 — Treating stale last-known-value as evidence of health.**
A 3B will see value 0.85 mm/s with `Uncertain/stale-last-known` quality and call the bearing healthy. The stale test (`M21`) checks that `Uncertain` propagates and `isEligibleForRecommendation` returns false. Comm-loss readings always carry `Uncertain/stale-last-known` quality.

**Pitfall 7 — Comparing thresholds without unit checking.**
A 3B will compare a temperature reading in °C against a threshold in °F. `assertUnitCompatible` in `M20` (called by `applyThreshold`) throws if units differ. The unit-mismatch test asserts it throws. Never compare value to threshold.lowerBound without calling this guard.

**Pitfall 8 — Forgetting the P-F fit check.**
A 3B will issue a work order for a bearing where the P-F interval is 2 days but the next maintenance window is 3 weeks away. The P-F fit logic in `M14` (and worked example C) checks `estimatedTimeToFMs < maintenanceWindowMs` and escalates or refuses. The `explanation.pfWindow` field is always populated and the test validates it.
