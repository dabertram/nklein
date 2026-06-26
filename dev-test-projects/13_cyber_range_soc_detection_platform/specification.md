# 13 - Cyber Range and SOC Detection Engineering Platform

Complexity tier: 13/20
Expected decomposition size: 36-40 dependent implementation cards before coding.
Domain pressure: security operations, telemetry normalization, detection rules, attack emulation, incident response, MITRE-style tactics, evidence chains.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a platform for security teams to run deterministic cyber-range scenarios, ingest simulated telemetry, evaluate detection rules, and manage incident response. It must challenge agents on adversarial thinking, data normalization, and evidence-driven workflows.

## Foundation release scope
The first serious buildout must include:
- Tenant, asset, identity, log source, event, normalized entity, detection rule, alert, incident, timeline item, evidence, playbook, exercise, and purple-team finding models.
- Telemetry normalization pipeline for endpoint, authentication, DNS, proxy, cloud audit, and process events with source-specific fields and loss tracking.
- Detection rule engine supporting sequence, threshold, join, suppression, allowlist, severity mapping, and rule versioning over deterministic event streams.
- Cyber-range scenario runner that emits scripted attack telemetry for phishing, credential theft, lateral movement, exfiltration, and noisy benign admin work.
- Incident triage workflow with alert grouping, scope expansion, evidence tagging, containment actions, and post-incident lessons.
- Coverage mapping against tactics, techniques, assets, log sources, and known blind spots.
- False-positive management with suppression expiry, exception ownership, and regression tests.
- Seed exercise with one true intrusion, one red herring, missing telemetry, and a detection regression.

## Architecture requirements
- Separate raw events, normalized events, detection evaluation, alert correlation, and incident workflow.
- Make detection rules data-driven and versioned with test fixtures.
- Represent time windows and entity joins explicitly.
- Keep attack scenario generation deterministic and auditable.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- SOC tools must preserve raw evidence while normalizing for detection.
- Detection quality depends on coverage, false positives, blind spots, and regression tests.
- Attack chains require temporal and entity correlation across log sources.
- Suppression rules can create dangerous blind spots if not scoped and expired.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Detection tests cover sequence, threshold, join, suppression, and missing-data behavior.
- Incident timelines cite raw events and normalized entities.
- Coverage reports show protected, partially covered, and blind tactics.
- Scenario replay is deterministic and produces stable alert IDs.
- The project passes npm test without real attack tooling.

## Explicit non-goals
- Do not include exploit code or instructions for real intrusion.
- Do not implement a generic log viewer only.
- Do not discard source-specific fields during normalization.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is *evidence totality with deterministic, replayable detection*: raw telemetry is preserved losslessly forever, every alert and every incident-timeline item is reconstructible to the exact raw events and normalized entities that produced it, and the *same* scripted attack scenario replayed against the *same* rule pack yields byte-identical alerts and stable alert IDs — so coverage, false-positives, and blind spots become measurable facts rather than opinions.** A SOC platform's job is to turn an ocean of telemetry into a *defensible, auditable narrative of what happened*; if the narrative can't be traced back to raw evidence, or if detection isn't reproducible, it is theater.

A real detection platform sits on three pillars: **lossless normalization** (preserve raw, derive normalized — never destroy source fidelity), a **data-driven detection engine** (rules as versioned data, evaluated over event streams with temporal + entity correlation), and **measured coverage** (mapped to MITRE ATT&CK, with honest blind spots). The detection content itself is engineered like software ("detection-as-code"), documented with a hypothesis, tested, tuned, and retired ([Palantir — Alerting & Detection Strategy framework](https://github.com/palantir/alerting-detection-strategy-framework/blob/master/ADS-Framework.md); [Medium — detection engineering / DAC / ADS](https://medium.com/@tahirbalarabe2/%EF%B8%8Fwhat-is-detection-engineering-detection-as-a-code-dac-palantirs-alerting-and-detection-ads-f3fede2792d2)). This extension grounds all three in real standards and makes them deterministically testable.

## D0. The grading rubric (what actually makes this hard)

1. **Evidence totality** — can *every* alert and timeline item be traced to the exact raw events and normalized entities, with raw fidelity never lost in normalization?
2. **Deterministic detection** — does replaying a scenario against a rule version produce identical alerts and *stable* alert IDs, every time?
3. **Correlation correctness** — do sequence/threshold/join detections handle time windows, entity joins, and out-of-order/missing events correctly?
4. **Coverage honesty** — does the platform report protected / partially-covered / **blind** ATT&CK techniques truthfully, including where telemetry is missing?
5. **Suppression safety** — are suppressions scoped, owned, and *expiring*, so a tuning decision can never silently become a permanent blind spot?

## D1. The normalization pipeline: lossless, two-layer (preserve raw, derive normalized)

"SOC tools must preserve raw evidence while normalizing for detection" and "do not discard source-specific fields" (the spec) — make this structural.

- **Two immutable layers.** Layer 1: the **raw event**, stored verbatim with a content hash and source metadata (sensor, host, ingest time). Layer 2: the **normalized event**, a *derived* projection into a common schema — with an explicit **field-mapping record** and a **loss/coverage report** for fields that don't map ([spec's "loss tracking" requirement]). Normalization never mutates raw; it *references* it.
- **Ground the common schema in OCSF / ECS.** Use a normalized model aligned to the **Open Cybersecurity Schema Framework** (vendor-agnostic, now a Linux Foundation project) or **Elastic Common Schema** — real, published taxonomies for process, authentication, network, DNS, and cloud-audit events ([OCSF — ocsf.io](https://ocsf.io/); [Splunk — OCSF explained](https://www.splunk.com/en_us/blog/learn/open-cybersecurity-schema-framework-ocsf.html); [Apriorit — adopting OCSF](https://www.apriorit.com/dev-blog/open-cybersecurity-schema-framework-implementation-guide)). The key difference to surface as a design note: ECS is product-tied; OCSF is vendor-neutral and leaves transport/orchestration to other layers ([Elastic discuss — OCSF vs ECS](https://discuss.elastic.co/t/open-cybersecurity-schema-framework/320290)).
- **Source-specific normalizers** for endpoint (process creation — e.g. Sysmon/EVTX-shaped), authentication (logon events), DNS, proxy/web, and cloud audit, each declaring which raw fields it consumes, which it maps, and which it *cannot* represent (the loss report). Windows event logs in **EVTX** are the canonical endpoint source; ground fixtures in real, published EVTX→ATT&CK sample sets ([EVTX-to-MITRE-Attack — labeled EVTX samples](https://github.com/mdecrevoisier/EVTX-to-MITRE-Attack)).
- **Normalized entities** (the join keys): host, user/identity, process, IP, domain, file-hash. Entities are *resolved and deduplicated* across sources so correlation can join an auth event and a process event on the same identity.

## D2. The detection engine: Sigma-grounded, data-driven, versioned

Model the engine on **Sigma**, the real open standard for portable detection rules — "make detection rules data-driven and versioned" (the spec) becomes "evaluate Sigma-like rules."

- **Rule structure (Sigma):** `logsource` (category / product / service), a `detection` block of named **search identifiers** (selections), a `condition` combining them with boolean logic, **field-value modifiers** (`contains`, `startswith`, `endswith`, `all`, `re`, `base64`, …), `level`/severity, and metadata ([SigmaHQ — sigma-specification](https://github.com/SigmaHQ/sigma-specification); [Graylog — TDIR with ATT&CK + Sigma](https://graylog.org/post/tdir-mitre-attck-and-sigma-rules-2/)). Each rule maps to one or more **ATT&CK technique IDs** (e.g. PowerShell → T1059.001 under Execution).
- **Correlation / aggregation as first-class rule types**, per Sigma's correlation spec: `event_count` (threshold), `value_count` (cardinality, e.g. distinct hosts), `temporal` (a set of sub-rules within a window), and `temporal_ordered` (the sub-rules must occur *in sequence*) — plus `near`/aggregation over a time window keyed by an entity ([SigmaHQ — correlation rules](https://github.com/SigmaHQ/sigma-specification); [mdecrevoisier — 350+ Sigma rules mapped to ATT&CK](https://github.com/mdecrevoisier/SIGMA-detection-rules)). This is exactly the spec's `sequence`, `threshold`, and `join` requirement — give them real Sigma semantics.
- **Suppression / allowlist / severity-mapping / rule versioning** are the spec's other requirements; in Sigma terms, allowlists are negative selections and suppression is a scoped, time-boxed exception. **Every rule is versioned**; an alert records the *exact rule version* that fired it, so a detection regression is diff-able.
- **Time windows and entity joins are explicit, not implicit** (the spec's architecture rule): a `temporal_ordered` rule over a 10-minute window keyed by `host+user` is a typed object — window, key, ordered sub-pattern — evaluated deterministically over the event stream.

## D3. Deterministic, stable alert identity (the replay spine)

"Scenario replay is deterministic and produces stable alert IDs" is the load-bearing acceptance criterion — design for it from the start.

- **Alert ID is a content hash**, not a sequence number: a deterministic function of `(ruleId, ruleVersion, ordered set of contributing raw-event IDs, window boundaries)`. Re-running the same scenario against the same rule version produces the same alert ID; changing the rule changes the version, hence the ID — so a *regression* (an alert that used to fire and now doesn't, or vice-versa) is a clean diff.
- **Deterministic event ordering.** Events carry a logical sequence (and a tie-break key) so a window's contents are order-stable even when timestamps collide. The detection pass is a pure fold over the ordered stream.
- **Virtual clock.** Windows, suppression expiry, and "aging" of incidents read an injected clock the scenario advances; no wall-clock.

## D4. The cyber-range scenario runner (deterministic adversary emulation)

Ground attack generation in the real purple-team toolchain — but emit *telemetry*, never run exploits ("do not include exploit code"; explicit non-goal).

- **Scenarios are scripted ATT&CK kill-chains** emitting normalized-ready telemetry for phishing → credential theft → lateral movement → exfiltration, plus **noisy benign admin work** as the false-positive generator (the seed exercise: one true intrusion, one red herring, missing telemetry, one detection regression). Model the *technique sequence* the way **CALDERA** abilities and **Atomic Red Team** tests do — as discrete, repeatable, technique-tagged procedures — but the runner outputs *log events*, not commands ([MITRE CALDERA — automated adversary emulation](https://github.com/apache/caldera); [Red Canary — Atomic Red Team](https://redcanary.com/blog/testing-and-validation/atomic-red-team/comparing-red-team-platforms/); [MITRE ATT&CK — adversary emulation & red teaming](https://attack.mitre.org/resources/get-started/adversary-emulation-and-red-teaming/)). This is the legal, deterministic, fixture-safe analog of a purple-team exercise.
- **Seeded benign noise** is essential: realistic admin activity (PsExec-like remote admin, bulk DNS, service installs) that *looks* like attacks, so false-positive management has something real to suppress. Without noise, detection metrics are meaningless.
- **Missing-telemetry injection.** A scenario can *omit* a log source (e.g. no DNS logging on a host) so the platform must detect what it can and **report the blind spot**, not pretend coverage.

## D5. Coverage mapping & detection-engineering discipline (measured, honest)

Detection quality "depends on coverage, false positives, blind spots, and regression tests" (the spec) — make each a measured artifact.

- **ATT&CK coverage matrix.** For each technique: `protected` (a rule exists and fires on the relevant telemetry), `partial` (rule exists but telemetry is incomplete), or `blind` (no rule, or no telemetry). Render as an ATT&CK-Navigator-style heatmap; the honest cell is the *blind* one, especially where telemetry is missing ([CISA — best practices for ATT&CK mapping](https://www.cisa.gov/sites/default/files/2023-01/Best%20Practices%20for%20MITRE%20ATTCK%20Mapping.pdf); [Medium — ATT&CK as SIEM use-case standard](https://medium.com/@imanvanpersien/mitre-att-ck-framework-as-a-standard-for-developing-siem-use-cases-d7dc7db4e1ba)).
- **Detection-as-code lifecycle.** Each detection carries an **ADS-style record**: goal/hypothesis (what adversary behavior, which technique), the strategy abstract, validation (the scenario that proves it fires), known false-positives, and priority — required *before* it goes to production ([Palantir — ADS framework](https://github.com/palantir/alerting-detection-strategy-framework/blob/master/ADS-Framework.md); [Palantir blog — ADS](https://blog.palantir.com/alerting-and-detection-strategy-framework-52dc33722df2)). This is the difference between a tuned detection and alert sludge.
- **False-positive economics are real.** Default, untuned rules generate high FP rates and cause **alert fatigue** — desensitized analysts miss real threats; Level-0 SOCs reportedly burn 60–70% of analyst time triaging false positives ([Medium — reducing false positives](https://medium.com/@tahirbalarabe2/how-to-reduce-false-positive-alerts-in-threat-detection-sharpening-security-detections-d8382b93915a); [decryptiondigest — detection-engineering maturity model](https://www.decryptiondigest.com/blog/detection-engineering-maturity-model)). The platform must track **FP rate per rule** and surface rules that no longer earn their slot.

## D6. Suppression safety (the dangerous-blind-spot guard)

"Suppression rules can create dangerous blind spots if not scoped and expired" (the spec) — this is a safety invariant, not a feature.

- Every suppression is **scoped** (which rule, which entity/field values), **owned** (a named owner), **justified** (a reason linked to a finding), and **time-boxed** (an explicit expiry on the virtual clock). An unscoped or never-expiring suppression is *rejected*.
- **Suppression coverage is shown on the heatmap:** a technique that is "covered" but whose detections are currently suppressed for some entities is rendered as a *partial/at-risk* cell, never a clean green. A regression test re-fires the suppressed scenario after expiry to prove the blind spot closed.

## D7. The incident response & evidence-chain spine

"Incident timelines cite raw events and normalized entities" — the timeline is a provenance graph, not a text log.

- **Alert → incident grouping** by shared entities and time proximity; **scope expansion** pulls in related events along entity edges (same host, same identity, same C2 domain).
- **Every timeline item cites its evidence:** raw event IDs (with hashes) + normalized entities + the rule version that surfaced it. **Containment actions** (isolate host, disable account) are recorded as audited workflow steps with before/after state. **Chain-of-custody** is preserved: evidence is tagged, never altered, and the timeline is reconstructible from the citations alone.
- **Post-incident lessons** feed back as new detections or tuning, closing the loop — and a *detection regression* discovered post-incident becomes a regression test.

## D8. The deterministic test strategy

- **Fixtures all the way down.** Telemetry, EVTX-shaped samples, scenario scripts, and rule packs are in-repo fixtures; `npm test` runs no real attack tooling and touches no network (explicit non-goal). Ground samples in published labeled corpora ([EVTX-to-MITRE-Attack](https://github.com/mdecrevoisier/EVTX-to-MITRE-Attack)).
- **Virtual clock + seeded scenario PRNG** so benign-noise generation and event interleaving replay identically.
- **Golden alerts, golden timelines, golden coverage reports.** Each canonical scenario produces machine-readable golden artifacts; a rule change that alters them is a reviewable diff.

## D9. Adversarial & edge-case fixture pack (ship the hard cases)

- **The red herring.** Benign admin activity (legit PsExec, a bulk DNS sweep by an asset scanner) that a naïve rule flags; the platform must *not* raise a true-positive incident — and the FP must be suppressible with a scoped, expiring exception.
- **The missing-telemetry intrusion.** A real attack on a host with DNS logging disabled; the platform detects via other sources and **reports the DNS blind spot**, never claiming full coverage.
- **The out-of-order events.** A `temporal_ordered` sequence whose events *arrive* out of timestamp order; ordering by logical sequence must still detect (or correctly *not* detect) the pattern.
- **The window-edge straddle.** Two events that fall just inside vs just outside a correlation window boundary — deterministic inclusion/exclusion.
- **The suppression-induced blind spot.** A suppression that, if unscoped, would hide a *different* real attack; the scoping rules prevent over-broad suppression, and expiry re-opens detection.
- **The detection regression.** A rule edit (new version) that silently stops firing on a previously-caught technique; the stable-alert-ID diff catches it.
- **The entity-collision join.** Two different users with the same display name across sources; entity resolution must not false-join them into one attacker.
- **The alert-storm.** A noisy technique that fires thousands of times; threshold/aggregation collapses it to one incident rather than flooding the queue.

## D10. Property-based / invariant tests (the true acceptance bar)

1. **Evidence totality** — every alert and every timeline item references at least one raw event (by hash) and the resolved entities; no alert is "sourceless." (Differential test against the raw store.)
2. **Raw immutability / no-loss** — normalization never mutates raw events; the loss report fully accounts for every unmapped source field. (Re-derive normalized from raw → identical.)
3. **Replay determinism** — replaying a scenario against a fixed rule-pack version yields identical alerts and identical alert IDs.
4. **Alert-ID stability under reordering** — shuffling the *delivery* order of events (within logical-sequence ties) does not change the set of alerts or their IDs.
5. **Window correctness** — an event exactly on a window boundary is included/excluded by a single, documented rule, consistently.
6. **Suppression safety** — no suppression is unscoped or non-expiring; after expiry, the suppressed detection fires again. (Property over randomized suppressions.)
7. **Coverage monotonicity & honesty** — removing a log source can only *lower* or hold coverage (never raise it); a technique with no telemetry is always `blind`, never `protected`.
8. **Regression detection** — for any rule-version change, the set of alerts that gained/lost coverage is exactly reported.

## D11. The concrete first vertical slice (the on-ramp — build THIS first, ~36–40 cards)

1. **The two-layer telemetry store** (D1): raw (hashed, immutable) + normalized (OCSF/ECS-aligned) + field-mapping + loss report, with entity resolution. Invariants #1, #2.
2. **The Sigma-like detection engine** (D2): logsource, selections, condition, modifiers, severity, **rule versioning** — plus the three correlation types (`event_count`, `temporal`, `temporal_ordered`). Invariant #5.
3. **Deterministic alert identity** (D3): content-hash alert IDs, logical event ordering, virtual clock. Invariants #3, #4.
4. **One cyber-range scenario** (D4): a phishing→cred-theft→lateral-movement→exfil kill-chain + benign noise + a missing-telemetry host, all deterministic.
5. **The incident timeline + evidence chain** (D7): alert→incident grouping, scope expansion, every item citing raw events + entities + rule version.
6. **Coverage mapping + suppression safety** (D5, D6): ATT&CK matrix with protected/partial/blind, FP-rate tracking, scoped+expiring suppressions. Invariants #6, #7.
7. **The seed exercise green** end-to-end (one true intrusion detected and reconstructed, one red herring *not* escalated, the missing-telemetry blind spot reported, the detection regression caught). Invariant #8.

If that slice holds, more log sources, more techniques, playbooks, and the analyst UI are breadth on a provable evidence-and-detection spine.

## D12. Domain knowledge-debt to track

- **Which ATT&CK techniques are realistically detectable from the modeled telemetry** — coverage claims must be honest about telemetry gaps; this is expert-review territory, not a checkbox ([CISA — ATT&CK mapping best practices](https://www.cisa.gov/sites/default/files/2023-01/Best%20Practices%20for%20MITRE%20ATTCK%20Mapping.pdf)).
- **Full Sigma modifier/correlation parity** — model the common modifiers and the four correlation types; exotic backends/pipelines and the full taxonomy are flagged debt ([SigmaHQ — sigma-specification](https://github.com/SigmaHQ/sigma-specification)).
- **OCSF vs ECS schema choice and version drift** — both evolve; the normalized schema is a versioned rule pack with an expert checkpoint ([OCSF — ocsf.io](https://ocsf.io/)).
- **Legal/ethical line on attack content** — the runner emits *telemetry*, never exploit code or intrusion instructions (hard non-goal); any future live-emulation integration (CALDERA/Atomic) is a production adapter requiring an authorization-and-scope review ([MITRE CALDERA](https://github.com/apache/caldera)).
- **False-positive thresholds and severity mappings** are organization-specific rule packs, not universal truth.

## D13. Why this is a great !Klein challenge

It is an unusually clean test of **adversarial thinking + determinism + evidence discipline** — three things small models do badly when unsupervised and well when *governed by structure*. The defining invariants (every alert traces to raw evidence; identical replay → identical stable alert IDs; coverage is honest about blind spots) are crisp and machine-checkable, so a weak model cannot bluff a detection or hand-wave coverage — the property test fails. It decomposes cleanly in strict dependency order (raw/normalized store → detection engine → deterministic alert identity → scenario runner → incident timeline → coverage/suppression), each step landing against a hard invariant rather than a vibe. And it teaches the most important SOC lesson structurally: a detection you can't reproduce, or coverage you can't honestly measure, is worse than none — exactly the kind of legible, determinism-first, evidence-grounded system !Klein exists to prove buildable with fallible models.
