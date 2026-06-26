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

---

## Small-model build guide (3B-ready)

### 1. Glossary & ground rules

**Domain terms**
- **Raw event** — the verbatim log record as received from a sensor, with a `contentHash` (SHA-256 of its serialized content) and source metadata. Raw events are immutable and stored forever.
- **Normalized event** — a derived projection of a raw event into a common schema (OCSF-aligned: `process`, `authentication`, `network`, `dns`, `cloud_audit`). References the raw event by `rawEventId`. Never mutates the raw.
- **Field-mapping record** — a record attached to each normalized event listing which raw fields were mapped, which were unmapped (the "loss report").
- **Normalized entity** — a deduplicated entity (host, user, process, IP, domain, file hash) resolved across multiple events as the join key for correlation.
- **Detection rule** — a versioned, data-driven object with a `logsource` filter, named `selections` (field-value matchers), a boolean `condition` combining them, and metadata (technique IDs, severity, version). Modeled on the Sigma rule format.
- **Alert** — the result of a rule firing on an event or window of events. Its `alertId` is a content hash of `(ruleId, ruleVersion, ordered raw event IDs, window boundaries)`. Stable across replays.
- **Incident** — a grouped set of alerts sharing common entities and proximity in time. An incident timeline item cites its raw events and normalized entities.
- **Suppression** — a scoped, owned, time-boxed exception that prevents a specific rule from alerting for specified entity/field values until the virtual clock advances past `expiresAt`.
- **Coverage cell** — one ATT&CK technique's detection status: `'protected'` (rule fires on relevant telemetry), `'partial'` (rule exists but telemetry is incomplete), or `'blind'` (no rule or no telemetry).
- **Virtual clock** — a `() => string` function returning an ISO-8601 timestamp, injected everywhere. Tests advance it by replacing the function.
- **Logical sequence** — a monotonically-increasing integer assigned to each event at ingest time, used as a tie-break when timestamps are identical. Ensures window evaluation is deterministic even with duplicate timestamps.

**Stack**
- Language: TypeScript (strict, no `any`)
- Runtime: Node.js 20+
- Test runner: Vitest (`npm test` = `vitest run`)
- Hashing: `node:crypto` SHA-256 for content hashes and alert IDs
- No live attack tools, no network, no real EVTX parsing (use plain TypeScript fixture objects shaped like EVTX)
- All fixtures in `src/fixtures/` as `export const` TypeScript objects

**Acceptance command**
```
npm test        # vitest run — green, no skipped tests
```

**Determinism rules (imperative)**
1. Never call `Date.now()`, `new Date()`, or `Math.random()` in `src/`. Inject a virtual clock.
2. All content hashes use `node:crypto` `sha256` over deterministic JSON serialization (keys sorted).
3. Event stream ordering uses `logicalSequence` as the primary sort key when timestamps tie.
4. Fixtures are static TypeScript objects, never fetched.

---

### 2. The explicit task graph for the first vertical slice

The first slice targets D11 items 1–7. Build in this exact order.

---

**`S01` — Raw event types + content hash**
dependsOn: none
files: `src/raw-event.ts`, `src/event-hash.ts`, `test/raw-event.test.ts`

interface:
```ts
// src/raw-event.ts
export type LogSourceCategory =
  | 'process_creation'
  | 'authentication'
  | 'dns_query'
  | 'proxy_request'
  | 'cloud_audit';

export interface RawEvent {
  rawEventId: string;    // contentHash — assigned at ingest
  contentHash: string;   // SHA-256 of the serialized rawFields
  source: string;        // sensor/host identifier
  ingestTimestamp: string;
  eventTimestamp: string;  // from the log source (may differ from ingest)
  logSourceCategory: LogSourceCategory;
  rawFields: Record<string, string>;   // verbatim key-value pairs; never mutated
  logicalSequence: number;             // monotonically increasing, assigned at ingest
}

// src/event-hash.ts
export function hashRawFields(fields: Record<string, string>): string;
// SHA-256 of JSON.stringify(fields, Object.keys(fields).sort()) → hex
```

how to implement:
1. Create `src/raw-event.ts` with the interfaces.
2. Create `src/event-hash.ts`. Import `createHash` from `'node:crypto'`.
3. `hashRawFields`: sort keys, stringify, sha256, return hex.
4. A `RawEvent` is created externally; `rawEventId = contentHash = hashRawFields(rawFields)`.

acceptance: `test/raw-event.test.ts`:
- Same `rawFields` → same `contentHash`.
- Changing one field → different hash.
- `contentHash.length === 64`.
- Two events with different fields have different IDs.

---

**`S02` — Normalized event types + field-mapping record**
dependsOn: `S01`
files: `src/normalized-event.ts`, `test/normalized-event.test.ts`

interface:
```ts
export interface FieldMapping {
  rawField: string;
  normalizedField: string;
}

export interface LossReport {
  unmappedRawFields: string[];   // raw fields with no normalized equivalent
  missingNormalizedFields: string[]; // normalized fields with no raw source
}

export interface NormalizedEvent {
  normalizedEventId: string;  // same as rawEventId (1:1)
  rawEventId: string;
  category: LogSourceCategory;
  timestamp: string;          // from eventTimestamp
  logicalSequence: number;    // inherited from raw
  // Common normalized fields (subset; fill from raw via mapping):
  hostname: string | null;
  username: string | null;
  processName: string | null;
  processId: string | null;
  destinationIp: string | null;
  destinationDomain: string | null;
  fieldMappings: FieldMapping[];
  lossReport: LossReport;
  extraFields: Record<string, string>;  // any normalized fields not listed above
}
```

how to implement:
1. Create `src/normalized-event.ts`.
2. Types only — no normalization logic yet (that's `S03`).

acceptance: `test/normalized-event.test.ts`:
- Construct a `NormalizedEvent` from a literal; assert all fields accessible.
- TypeScript compiles clean (`tsc --noEmit`).

---

**`S03` — Source-specific normalizers**
dependsOn: `S01`, `S02`
files: `src/normalizers/process-creation.ts`, `src/normalizers/authentication.ts`, `src/normalizers/dns.ts`, `src/normalizers/index.ts`, `test/normalizers.test.ts`

interface:
```ts
// src/normalizers/index.ts
export type Normalizer = (raw: RawEvent) => NormalizedEvent;

export function getNormalizer(category: LogSourceCategory): Normalizer;
// Returns the appropriate normalizer function, or throws "unknown category".
```

Mapping rules (encode these as constants in each normalizer file):
- `process_creation` maps: `Image`→`processName`, `ProcessId`→`processId`, `User`→`username`, `Computer`→`hostname`.
- `authentication` maps: `TargetUserName`→`username`, `IpAddress`→`destinationIp`, `Computer`→`hostname`.
- `dns_query` maps: `QueryName`→`destinationDomain`, `Computer`→`hostname`.

how to implement:
1. Create `src/normalizers/process-creation.ts`. Map the fields listed above; add unmapped raw fields to `lossReport.unmappedRawFields`; add normalized fields with no raw source to `lossReport.missingNormalizedFields`.
2. Same pattern for `authentication.ts` and `dns.ts`.
3. `src/normalizers/index.ts` dispatches by `category`.

acceptance: `test/normalizers.test.ts`:
- A fixture `process_creation` event with `{ Image: "cmd.exe", ProcessId: "1234", User: "SYSTEM", Computer: "HOST1" }` normalizes to `{ processName: "cmd.exe", processId: "1234", username: "SYSTEM", hostname: "HOST1" }`.
- An unknown field in raw → appears in `lossReport.unmappedRawFields`.
- A normalized field with no raw source → appears in `lossReport.missingNormalizedFields`.
- Normalization never mutates `raw.rawFields`.

---

**`S04` — Entity resolution store**
dependsOn: `S02`
files: `src/entity-resolution.ts`, `test/entity-resolution.test.ts`

interface:
```ts
export type EntityType = 'host' | 'user' | 'process' | 'ip' | 'domain';

export interface ResolvedEntity {
  entityId: string;  // deterministic: sha256(type + ":" + canonicalKey)
  entityType: EntityType;
  canonicalKey: string;  // e.g. hostname, username, IP string
  seenInEventIds: string[];  // rawEventIds that referenced this entity
}

export interface EntityStore {
  resolveOrCreate(type: EntityType, key: string, seenInEventId: string): ResolvedEntity;
  find(type: EntityType, key: string): ResolvedEntity | null;
  all(): ReadonlyArray<ResolvedEntity>;
}

export function createEntityStore(): EntityStore;
```

how to implement:
1. Create `src/entity-resolution.ts`.
2. `entityId = sha256(type + ":" + key)` using `hashRawFields({ type, key })`.
3. `resolveOrCreate`: look up by `entityId`; if found, append `seenInEventId`; if not, create.
4. Duplicate `seenInEventId` entries should not be added twice.

acceptance: `test/entity-resolution.test.ts`:
- Same (type, key) → same `entityId` both calls.
- Different keys → different `entityId`.
- `resolveOrCreate` with same id twice → `seenInEventIds.length` doesn't grow from duplicate.
- `find` returns `null` for unknown key.

---

**`S05` — Detection rule types + field-value evaluator**
dependsOn: `S02`
files: `src/detection-rule.ts`, `src/rule-evaluator.ts`, `test/rule-evaluator.test.ts`

interface:
```ts
// src/detection-rule.ts
export type Modifier = 'contains' | 'startswith' | 'endswith' | 'equals' | 're';
export interface Selection {
  selectionId: string;
  field: string;         // normalized field name
  modifier: Modifier;
  values: string[];      // OR logic: matches if ANY value matches
}
export interface DetectionRule {
  ruleId: string;
  version: number;
  logsource: { category: LogSourceCategory };
  selections: Selection[];
  condition: string;     // e.g. "sel1 AND sel2", "sel1 OR NOT sel2"; evaluated as simple boolean AST
  severity: 'low' | 'medium' | 'high' | 'critical';
  techniqueIds: string[];  // e.g. ["T1059.001"]
  description: string;
}

// src/rule-evaluator.ts
export function evaluateSelection(sel: Selection, event: NormalizedEvent): boolean;
// Apply the modifier logic against event[sel.field].
// 'contains': field.includes(val); 'startswith': field.startsWith(val); etc.
// Returns true if ANY value in sel.values matches.

export function evaluateCondition(
  conditionExpr: string,
  selectionResults: Record<string, boolean>,
): boolean;
// Parse conditionExpr (space-separated tokens: selectionIds, AND, OR, NOT, parens).
// Substitute results, evaluate.
// Only implement: AND, OR, NOT (unary prefix), parentheses. No other operators.

export function evaluateRule(rule: DetectionRule, event: NormalizedEvent): boolean;
// 1. Check rule.logsource.category === event.category; if not, return false.
// 2. Evaluate each selection by selectionId → boolean.
// 3. Evaluate condition.
```

how to implement:
1. Create `src/detection-rule.ts` with types.
2. Create `src/rule-evaluator.ts`.
3. `evaluateSelection`: get `event[sel.field as keyof NormalizedEvent]`; apply modifier; return true if any value matches.
4. `evaluateCondition`: tokenize; recursive descent parser for `AND/OR/NOT/()` only.
5. `evaluateRule`: compose.

acceptance: `test/rule-evaluator.test.ts`:
- `contains` match: field `"powershell.exe"`, value `"powershell"` → true.
- `startswith` match: field `"cmd.exe"`, value `"cmd"` → true.
- Wrong category → `evaluateRule` returns false.
- Condition `"sel1 AND NOT sel2"` with `sel1=true`, `sel2=false` → true.
- Condition `"sel1 AND NOT sel2"` with `sel1=true`, `sel2=true` → false.

---

**`S06` — Rule versioning + alert ID computation**
dependsOn: `S05`, `S01`
files: `src/alert-identity.ts`, `test/alert-identity.test.ts`

interface:
```ts
export function computeAlertId(
  ruleId: string,
  ruleVersion: number,
  contributingRawEventIds: string[],  // sorted before hashing
  windowStart: string | null,
  windowEnd: string | null,
): string;
// SHA-256 of JSON.stringify({ ruleId, ruleVersion,
//   eventIds: [...contributingRawEventIds].sort(),
//   windowStart, windowEnd }, sortedKeys)
// → stable 64-char hex string

export interface Alert {
  alertId: string;
  ruleId: string;
  ruleVersion: number;
  severity: string;
  techniqueIds: string[];
  contributingRawEventIds: string[];
  windowStart: string | null;
  windowEnd: string | null;
  firedAt: string;  // virtual clock timestamp
}
```

how to implement:
1. Create `src/alert-identity.ts`.
2. `computeAlertId`: sort event IDs, stable JSON-stringify the object with sorted keys, sha256.
3. Export `Alert` interface.

acceptance: `test/alert-identity.test.ts`:
- Same inputs → same `alertId`.
- Reordering `contributingRawEventIds` → same `alertId` (sort is applied before hashing).
- Different `ruleVersion` → different `alertId`.
- Adding one more event ID → different `alertId`.

---

**`S07` — Single-event detection pass**
dependsOn: `S05`, `S06`, `S03`
files: `src/detection-engine.ts`, `test/detection-engine.test.ts`

interface:
```ts
export interface DetectionEngine {
  addRule(rule: DetectionRule): void;
  processEvent(event: NormalizedEvent, clock: () => string): Alert[];
  // Evaluates all rules against event.
  // For each rule that fires, compute alertId and return an Alert.
  // No threshold/window logic yet — that's S08.
}

export function createDetectionEngine(): DetectionEngine;
```

how to implement:
1. Create `src/detection-engine.ts`.
2. `addRule`: store in a `Map<ruleId, DetectionRule>`.
3. `processEvent`: for each rule where `evaluateRule(rule, event)` is true, call `computeAlertId([event.rawEventId], null, null)` and emit an `Alert`.

acceptance: `test/detection-engine.test.ts`:
- A process_creation event with `processName: "powershell.exe"` fires a rule with `contains powershell`.
- The same event processed twice produces the same `alertId` (stability).
- A non-matching event produces no alerts.
- Two different matching rules produce two different alerts with different `alertId`s.

---

**`S08` — Threshold and temporal correlation rules**
dependsOn: `S07`
files: `src/correlation-engine.ts`, `test/correlation-engine.test.ts`

interface:
```ts
export type CorrelationType = 'event_count' | 'temporal' | 'temporal_ordered';

export interface CorrelationRule {
  ruleId: string;
  version: number;
  correlationType: CorrelationType;
  subRuleIds: string[];      // ordered for temporal_ordered; unordered for others
  windowSeconds: number;
  groupByField: string;      // e.g. "hostname" — events grouped by this entity key
  threshold?: number;        // for event_count: fire when count >= threshold
  severity: string;
  techniqueIds: string[];
}

export interface CorrelationEngine {
  addCorrelationRule(rule: CorrelationRule, subRules: DetectionRule[]): void;
  processEvent(event: NormalizedEvent, clock: () => string): Alert[];
  // For each correlation rule, maintain a sliding window buffer per groupByField value.
  // event_count: count events matching any sub-rule in the window; fire at threshold.
  // temporal: fire when ALL sub-rules have at least one match within the window.
  // temporal_ordered: fire when sub-rules match IN ORDER within the window.
  // Window = events with logicalSequence in [current - windowSeconds * rate, current].
  // Use logicalSequence, not wall clock.
}

export function createCorrelationEngine(): CorrelationEngine;
```

how to implement:
1. Create `src/correlation-engine.ts`.
2. Maintain `Map<ruleId, Map<groupKey, NormalizedEvent[]>>` as window buffers.
3. On each event: add to windows for all matching sub-rules; evict entries older than the window (by comparing `eventTimestamp` lexicographically, since they are ISO-8601 strings).
4. Check firing conditions; emit alerts with `computeAlertId` over all contributing events.

acceptance: `test/correlation-engine.test.ts`:
- `event_count` rule: 3 events within window → fires at threshold=3; 4th event doesn't add a new alert.
- `temporal`: sub-rules A and B; events A then B in window → fires; A without B → no alert.
- `temporal_ordered`: B arrives before A → no alert; A arrives before B → fires.
- Window boundary: event just outside window is excluded.

---

**`S09` — Suppression engine**
dependsOn: `S07`
files: `src/suppression.ts`, `test/suppression.test.ts`

interface:
```ts
export interface Suppression {
  suppressionId: string;
  ruleId: string;
  scopeField: string;     // e.g. "hostname"
  scopeValue: string;     // e.g. "ADMIN-HOST"
  ownerId: string;
  reason: string;
  createdAt: string;
  expiresAt: string;      // virtual clock; must be non-empty (unscoped suppressions rejected)
}

export interface SuppressionStore {
  add(s: Suppression): void;
  // Throws "suppression must have explicit expiresAt" if expiresAt is empty.
  isSuppressed(ruleId: string, event: NormalizedEvent, now: string): boolean;
  // Returns true if there is an active (now < expiresAt) suppression where
  //   s.ruleId === ruleId AND event[s.scopeField] === s.scopeValue.
  active(now: string): ReadonlyArray<Suppression>;
}

export function createSuppressionStore(): SuppressionStore;
```

how to implement:
1. Create `src/suppression.ts`.
2. `add`: throw if `expiresAt` is empty string.
3. `isSuppressed`: find a suppression where `s.ruleId === ruleId`, `event[s.scopeField]` matches `s.scopeValue`, and `now < s.expiresAt`.
4. `active`: return all suppressions where `now < expiresAt`.

acceptance: `test/suppression.test.ts`:
- Active suppression on matching hostname and rule → alert suppressed.
- Suppression on different hostname → alert not suppressed.
- Expired suppression (virtual clock advanced past `expiresAt`) → alert fires.
- Suppression without `expiresAt` → throws.

---

**`S10` — Cyber-range scenario runner**
dependsOn: `S03`, `S07`
files: `src/scenario-runner.ts`, `src/fixtures/seed-scenario.ts`, `test/scenario-runner.test.ts`

interface:
```ts
export interface ScenarioStep {
  stepId: string;
  techniqueId: string;       // e.g. "T1059.001"
  logSourceCategory: LogSourceCategory;
  rawFields: Record<string, string>;
  isBenign: boolean;         // true = noise/red-herring
  hasTelemetry: boolean;     // false = telemetry intentionally missing (blind-spot step)
}

export interface Scenario {
  scenarioId: string;
  steps: ScenarioStep[];
}

export interface ScenarioRunResult {
  events: RawEvent[];        // only steps with hasTelemetry=true produce events
  missingTelemetryTechniqueIds: string[];  // steps where hasTelemetry=false
}

export function runScenario(
  scenario: Scenario,
  clock: () => string,
): ScenarioRunResult;
// For each step with hasTelemetry=true: create a RawEvent (rawFields from step, deterministic sequence).
// For each step with hasTelemetry=false: add techniqueId to missingTelemetryTechniqueIds.
// Logical sequence = step index.
```

how to implement:
1. Create `src/scenario-runner.ts`.
2. `runScenario`: iterate steps; if `hasTelemetry`, create `RawEvent`; else record technique as missing.
3. Create `src/fixtures/seed-scenario.ts` with 4 steps: true intrusion (powershell.exe execution, credential dump), a benign admin command (also using cmd.exe — the red herring), a lateral-movement step with DNS, and a missing-telemetry exfil step.

acceptance: `test/scenario-runner.test.ts`:
- Running the scenario twice produces identical event arrays (same rawEventIds).
- Missing-telemetry step → `missingTelemetryTechniqueIds` includes its technique.
- Number of events = number of hasTelemetry=true steps.

---

**`S11` — Incident grouping + evidence chain**
dependsOn: `S04`, `S07`, `S10`
files: `src/incident.ts`, `test/incident.test.ts`

interface:
```ts
export interface TimelineItem {
  itemId: string;
  alertId: string;
  rawEventIds: string[];          // must be non-empty (evidence totality invariant)
  normalizedEntityIds: string[];  // resolved entities involved
  ruleId: string;
  ruleVersion: number;
  timestamp: string;
}

export interface Incident {
  incidentId: string;
  alerts: Alert[];
  timeline: TimelineItem[];
  involvedEntityIds: string[];
}

export function groupAlertsIntoIncidents(
  alerts: Alert[],
  entityStore: EntityStore,
  rawEvents: RawEvent[],
  windowSeconds: number,
): Incident[];
// Group alerts that share at least one entity key and have timestamps within windowSeconds.
// Each timeline item must reference at least one rawEventId.
```

how to implement:
1. Create `src/incident.ts`.
2. Group by shared entity: for each alert, look up entities from `entityStore` by `seenInEventIds`; if two alerts share an entity and timestamps are within `windowSeconds`, group them.
3. Create timeline items from alerts; assert `rawEventIds.length > 0` (throw if violated — evidence totality).

acceptance: `test/incident.test.ts`:
- Two alerts on the same hostname within window → one incident.
- Two alerts on different hosts → two incidents.
- Every timeline item has `rawEventIds.length >= 1`.
- Incident without shared entity → not grouped.

---

**`S12` — Coverage mapping**
dependsOn: `S05`, `S10`
files: `src/coverage.ts`, `test/coverage.test.ts`

interface:
```ts
export type CoverageStatus = 'protected' | 'partial' | 'blind';

export interface CoverageCell {
  techniqueId: string;
  status: CoverageStatus;
  activeRuleIds: string[];
  missingTelemetrySource: boolean;  // true if this technique had a missing-telemetry step
}

export function buildCoverageMatrix(
  rules: DetectionRule[],
  scenarioResult: ScenarioRunResult,
  firedAlerts: Alert[],
  suppressionStore: SuppressionStore,
  now: string,
): CoverageCell[];
// For each techniqueId seen in rules or scenario steps:
//   'protected': rule exists AND alert fired on relevant event
//   'partial': rule exists but missingTelemetrySource=true OR currently suppressed
//   'blind': no rule covers this technique OR no telemetry
// A currently-suppressed technique is never 'protected'.
```

how to implement:
1. Create `src/coverage.ts`.
2. Collect all technique IDs from rules and scenario steps.
3. For each: check if a rule covers it; check if an alert fired; check missing telemetry; check suppression.
4. Apply the priority: blind beats partial beats protected.

acceptance: `test/coverage.test.ts`:
- Technique with a rule and a fired alert → `'protected'`.
- Technique with a rule but missing telemetry → `'partial'`.
- Technique with no rule → `'blind'`.
- Technique covered but currently suppressed → NOT `'protected'` (at most `'partial'`).

---

**`S13` — Evidence totality + replay determinism property tests**
dependsOn: `S07`, `S10`, `S11`
files: `test/evidence-totality.property.test.ts`

how to implement:
1. Create `test/evidence-totality.property.test.ts`.
2. **Evidence totality**: run the seed scenario, normalize events, fire detection rules, group into incidents. Assert every `TimelineItem.rawEventIds.length >= 1` and every `rawEventId` refers to a known raw event.
3. **Replay determinism**: run the seed scenario twice. Assert the two `ScenarioRunResult.events` arrays are deeply equal (same rawEventIds, same fields, same order).
4. **Alert-ID stability**: fire the detection engine on the event stream twice. Assert alert arrays are deeply equal (same alertIds in same order).

acceptance: All three property assertions pass on two independent runs.

---

### 3. The decomposition method for the remaining breadth

After S01–S13 are green, apply this recipe:

**Recipe for one feature cluster:**
1. Identify the feature's invariant from D10 (evidence totality, determinism, suppression safety, coverage honesty, etc.).
2. Write the acceptance assertion first: "After implementing X, D10.N must hold."
3. Split into at most 3 cards: (a) types/interfaces, (b) logic/evaluation, (c) golden fixture + integration test.
4. Every card produces a test that runs offline with `npm test`.

**Worked example 1 — ADS (Alerting & Detection Strategy) record for each rule**
- Types card `A01`: `ADSRecord = { ruleId, hypothesis, strategyAbstract, knownFalsePositives, priority, validatingScenarioId }`. Attach to `DetectionRule` as an optional field.
- Logic card `A02` dependsOn `A01`, `S07`: `validateRuleHasADS(rule)` → throws if `rule.ads === undefined`. Gate on adding a rule to production: `DetectionEngine.addRule` requires `ads` field to be present (else mark as "draft-only").
- Test: a rule without `ads` added to production engine → throws; a rule with `ads` → succeeds.

**Worked example 2 — False-positive rate tracking**
- Types card `FP01`: `FPRate = { ruleId, truePositiveCount: number, falsePositiveCount: number, fpRate: number }`.
- Logic card `FP02` dependsOn `S07`, `S11`: `recordAlertFeedback(alertId, isFalsePositive: boolean, store: FPRateStore)`. `fpRate = falsePositiveCount / (truePositiveCount + falsePositiveCount)`.
- Test: 3 TP + 1 FP → `fpRate ≈ 0.25`. Assert `fpRate` is deterministic (same order of feedback → same rate).

**Worked example 3 — Detection regression detection**
- Types card `DR01`: `DetectionDiff = { gained: string[]; lost: string[] }` (alert IDs).
- Logic card `DR02` dependsOn `S07`: `diffDetectionRuns(runA: Alert[], runB: Alert[]): DetectionDiff`. `gained = B.filter(id not in A)`; `lost = A.filter(id not in B)`.
- Test: apply a rule change that drops coverage for one technique. Assert `lost` contains the expected alert IDs. Assert `gained` is empty (no spurious new detections).

---

### 4. Per-task implementation conventions

**Folder layout**
```
src/
  raw-event.ts
  event-hash.ts
  normalized-event.ts
  normalizers/
    process-creation.ts
    authentication.ts
    dns.ts
    index.ts
  entity-resolution.ts
  detection-rule.ts
  rule-evaluator.ts
  alert-identity.ts
  detection-engine.ts
  correlation-engine.ts
  suppression.ts
  scenario-runner.ts
  incident.ts
  coverage.ts
  fixtures/
    seed-scenario.ts
test/
  raw-event.test.ts
  normalized-event.test.ts
  normalizers.test.ts
  entity-resolution.test.ts
  rule-evaluator.test.ts
  alert-identity.test.ts
  detection-engine.test.ts
  correlation-engine.test.ts
  suppression.test.ts
  scenario-runner.test.ts
  incident.test.ts
  coverage.test.ts
  evidence-totality.property.test.ts
```

**How to write a test in Vitest**
```ts
import { describe, it, expect } from 'vitest';
import { evaluateRule } from '../src/rule-evaluator.js';
import type { DetectionRule, NormalizedEvent } from '../src/detection-rule.js';

describe('rule-evaluator', () => {
  it('fires on matching process name', () => {
    const rule: DetectionRule = {
      ruleId: 'rule-ps', version: 1,
      logsource: { category: 'process_creation' },
      selections: [{ selectionId: 'sel1', field: 'processName', modifier: 'contains', values: ['powershell'] }],
      condition: 'sel1',
      severity: 'high', techniqueIds: ['T1059.001'], description: '',
    };
    const event: NormalizedEvent = {
      normalizedEventId: 'e1', rawEventId: 'e1',
      category: 'process_creation', timestamp: '2026-06-30T10:00:00Z', logicalSequence: 1,
      hostname: 'HOST1', username: 'SYSTEM', processName: 'powershell.exe',
      processId: '1234', destinationIp: null, destinationDomain: null,
      fieldMappings: [], lossReport: { unmappedRawFields: [], missingNormalizedFields: [] },
      extraFields: {},
    };
    expect(evaluateRule(rule, event)).toBe(true);
  });
});
```

**Keeping it deterministic**
- Logical sequence is the event counter at ingest time; use `let seq = 0; seq++` per event in `runScenario`.
- Alert IDs: sort `contributingRawEventIds` before hashing. Same events in any delivery order → same alertId.
- Virtual clock: inject as `() => "2026-06-30T10:00:00Z"`. Advance by returning later strings for suppression expiry tests.
- Window boundary: use lexicographic comparison on ISO-8601 strings (since they are sortable). No `Date.parse`.

**Definition of done for any card**
1. `tsc --noEmit` exits 0.
2. `npm test` green.
3. No `any` in `src/`.
4. No `Date.now()` or `Math.random()` in `src/`.
5. Every acceptance assertion from the card is a named `it(...)` block.
6. Any field that must be non-empty for an invariant (e.g. `rawEventIds`) is asserted in the function body with a throw, not just in tests.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1 — Discarding raw fields during normalization**
A 3B model will write `const normalized = { hostname: raw.rawFields.Computer }` and never store `rawFields` itself. The explicit non-goal "do not discard source-specific fields during normalization" means: the `NormalizedEvent` carries `rawEventId` pointing back to the immutable `RawEvent`; the normalizer never deletes from `rawFields`. The `lossReport` must list unmapped raw fields. The test in `S03` checks `lossReport.unmappedRawFields` explicitly.

**Pitfall 2 — Using `Date.now()` for the virtual clock**
A model will write `firedAt: new Date().toISOString()` inside `processEvent`. This makes `alertId` stable but `firedAt` non-deterministic, which makes golden alert fixtures fragile. All timestamps must come from the injected `clock` parameter.

**Pitfall 3 — Computing `alertId` from a non-sorted event ID list**
The model will compute `sha256([eventA.id, eventB.id].join(","))`. If events arrive in different order on two runs, the `alertId` changes. The spec is explicit: sort `contributingRawEventIds` before hashing. The `S06` test checks that reordering inputs → same alertId.

**Pitfall 4 — Implementing window eviction using wall-clock subtraction**
A model will write `events.filter(e => Date.now() - Date.parse(e.eventTimestamp) < windowSeconds * 1000)`. This uses real time. Instead, compare ISO-8601 strings lexicographically: `e.eventTimestamp >= windowStart` where `windowStart` is derived by subtracting `windowSeconds` from the current virtual-clock string. For simplicity, require all timestamps in tests to be of the form `"2026-06-30T10:00:00Z"` (minute-precision), and use simple string comparison.

**Pitfall 5 — Treating suppression as a display filter rather than a detection gate**
A model will suppress alerts in the UI layer but still emit them from the detection engine. The suppression check must happen inside `processEvent` (or immediately before emitting the alert). The coverage matrix must reflect that a suppressed technique is not `'protected'`. The `S09` and `S12` tests both catch this.

**Pitfall 6 — `temporal_ordered` implemented as unordered set membership**
A model will implement `temporal_ordered` the same as `temporal` (check all sub-rules fired, ignore order). The test in `S08` puts B before A in the event stream and asserts no alert fires. The model must track the order of sub-rule matches within the window (compare `logicalSequence` of the matching events against the `subRuleIds` order).

**Pitfall 7 — Missing-telemetry steps silently ignored**
A model will skip hasTelemetry=false steps without recording the technique. `ScenarioRunResult.missingTelemetryTechniqueIds` must be populated. The coverage matrix test in `S12` asserts a technique with missing telemetry cannot be `'protected'`.

**Pitfall 8 — Evidence totality violation: alert with no contributing events**
A model building correlation alerts may compute an `alertId` over an empty event set and emit an alert with `contributingRawEventIds = []`. This violates invariant D10.1. The `TimelineItem` constructor and `computeAlertId` must both throw if the event set is empty.
