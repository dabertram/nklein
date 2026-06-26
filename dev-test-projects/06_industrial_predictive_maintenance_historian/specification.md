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
