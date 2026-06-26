# 14 - Carbon Accounting and Industrial Energy Optimization Platform

Complexity tier: 14/20
Expected decomposition size: 38-42 dependent implementation cards before coding.
Domain pressure: GHG accounting, industrial energy management, tariffs, demand response, emissions factors, measurement and verification, optimization.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a carbon and energy platform for manufacturers that connects utility meters, production schedules, emissions factors, tariffs, energy projects, and reporting. It should combine accounting rigor with operational optimization.

## Foundation release scope
The first serious buildout must include:
- Facility, meter, submeter, production line, product, energy source, tariff, emissions factor, activity data, reduction project, forecast, report, and audit evidence models.
- Scope 1 and Scope 2 accounting engine with factor versions, location-based and market-based electricity, renewable certificates, and data-quality scoring.
- Energy baseline model that normalizes consumption against production volume, weather degree days, operating hours, and shutdown periods.
- Tariff calculator for time-of-use rates, demand charges, power factor penalties, contracted capacity, and demand-response events.
- Optimization planner that proposes load shifting, peak shaving, battery dispatch, and production schedule adjustments under operational constraints.
- Measurement and verification workflow for energy projects with baseline, implementation date, savings calculation, uncertainty, and audit notes.
- Report generator with traceable totals by facility, source, scope, factor version, and evidence gaps.
- Seed manufacturer with multiple facilities, bad meter data, solar certificates, demand charge spike, and production-driven energy variance.

## Architecture requirements
- Separate accounting calculations, meter data quality, tariff simulation, optimization proposals, and report formatting.
- Use typed units for energy, power, emissions, currency, production quantity, and time intervals.
- Make factor versions immutable once used in an audited report.
- Represent optimization outputs as proposals with constraints and tradeoffs, not commands.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Carbon reports need provenance, factor versions, boundary definitions, and uncertainty.
- Energy savings require a defensible baseline, not just before/after comparison.
- Tariff economics can dominate carbon optimization and create conflicting objectives.
- Bad meter data must be estimated transparently.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Accounting tests cover factor versioning, market/location methods, missing data, and certificate allocation.
- Tariff tests cover demand charge, time-of-use, power factor, and demand response.
- Optimization fixtures produce explainable tradeoffs and reject infeasible schedules.
- Reports trace every total back to source data and factor version.
- The project passes npm test deterministically.

## Explicit non-goals
- Do not produce unverifiable greenwashing summaries.
- Do not ignore units or factor versions.
- Do not call live utility or emissions APIs in foundation tests.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single defining property of this project: it is an *audit-grade double-system* where two methodologically-distinct truths must coexist without contaminating each other* — a carbon ledger whose every gram of CO₂e is traceable to a *versioned, immutable* emission factor and a defensible boundary, AND an energy-cost optimizer whose proposals are economically optimal under tariffs that frequently *conflict* with the carbon objective. The hard part is being simultaneously (a) audit-reproducible to a regulator who asks "which factor version, what method, what evidence?", (b) honest about uncertainty and bad meter data, and (c) right about money under demand charges and ratchets that can dwarf the carbon signal — without ever producing the greenwashing summary the base spec forbids.

## E0. Thesis: why carbon+energy is a versioning, provenance, and conflicting-objective problem

A demo build multiplies kWh by a single emission factor and prints "X tonnes CO₂", then suggests "shift load off-peak to save money and carbon." It passes a happy-path test and is **indefensible**: it has no factor *version* (so last year's audited report silently changes when the factor table updates), it conflates location-based and market-based scope 2 (the two scope-2 truths the GHG Protocol *requires* be reported separately), it has no baseline (so "savings" are just weather/production noise), and it assumes carbon and cost point the same way (they routinely don't — the cheapest hour can be the dirtiest). The disciplined build is **two coupled-but-isolated systems**: an **accounting engine** (immutable factor versions, dual scope-2, data-quality scoring, full provenance from every total back to source) and an **operations engine** (tariff simulation + constrained optimization producing *proposals with tradeoffs*, never commands). The grading rubric:

1. **Provenance totality** — does every reported total trace back to source activity data **and** the exact factor version + method, reproducibly, immutably?
2. **Dual-truth integrity** — are location-based and market-based scope 2 computed and reported separately, with the market-based instrument hierarchy and no double-counting?
3. **Defensible baselines** — are energy savings measured against a normalized baseline (weather + production + operating hours), with uncertainty, not a naive before/after?
4. **Conflicting-objective honesty** — does the optimizer surface carbon-vs-cost tradeoffs explicitly and reject infeasible schedules, rather than pretending one number optimizes both?

Everything below serves those four.

## E1. Research-grounded domain authenticity (the standards & the math)

**GHG accounting — the GHG Protocol Corporate Standard + Scope 2 Guidance** is the spine and must be implemented as the *actual* dual-reporting model, not a single factor ([GHG Protocol Corporate Standard](https://ghgprotocol.org); [Scope 2 Guidance PDF](https://ghgprotocol.org/sites/default/files/2023-03/Scope%202%20Guidance.pdf); [Carbon Direct, electricity accounting](https://www.carbon-direct.com/insights/electricity-emissions-accounting-ghg-protocol-and-lca-explained)):
- **Scope 1** = direct emissions from owned/controlled sources (on-site fuel combustion, company vehicles, **fugitive refrigerants**). Computed as `activity_data × emission_factor`, summed over fuels/gases with **GWP-weighted CO₂e** for non-CO₂ gases.
- **Scope 2** = indirect emissions from purchased electricity/steam/heat/cooling, and it has **TWO mandated methods that must both be reported** ("dual reporting"): **location-based** (grid-average factor for the consumption region — e.g. EPA eGRID subregion) and **market-based** (supplier-specific / contractual-instrument factor). When a company holds any contractual instruments, it **shall report both, labeled by method**.
- **The market-based hierarchy** (the subtle, audit-critical part): emission rate is selected in priority order — **(1) energy attribute certificates** (RECs / Guarantees of Origin / GECs, each = 1 MWh) → **(2) supplier/utility-specific emission rates** → **(3) residual mix** (the grid average *after* certificated/claimed generation is removed, which **prevents double counting**) → **(4) location-based grid average as last resort**. The **Scope 2 Quality Criteria** for a valid instrument: tracked and **redeemed/retired only once** (no double counting), **as temporally close as possible** to the consumption period, and **sourced from the same market/grid** as consumption. This hierarchy + criteria *is* the base spec's "renewable certificates" and "market-based vs location-based" requirement — and getting the residual-mix anti-double-count right is what separates real accounting from greenwashing.
- **Scope 3** (15 value-chain categories) is out of the foundation slice but the boundary must be *explicit* (what's in/out), because boundary definition is itself an audit requirement.

**Emission factors are VERSIONED, IMMUTABLE-ONCE-USED data with their own GWP basis** ([EPA GHG Emission Factors Hub 2025](https://www.epa.gov/system/files/documents/2025-01/ghg-emission-factors-hub-2025.pdf); [EPA eGRID + AR5 GWP](https://catalog.data.gov/dataset/ipcc-ar4-ar5-and-ar6-20-100-and-500-year-gwps); [IPCC AR6 GWP values](https://greencalculus.com/data/ipcc-ar6-gwp-values/)). The base spec's "make factor versions immutable once used in an audited report" is a hard, load-bearing requirement, and the research shows *why* it's non-trivial:
- **GWP values themselves are versioned by IPCC assessment report:** CH₄ GWP-100 = 25 (AR4) → 28 (AR5, 30 fossil) → 27–30 (AR6); N₂O = 298 (AR4) → 265 (AR5) → 273 (AR6). A report must pin **which GWP set** it used, and frameworks differ on AR5 vs AR6 (some mandate AR6, some keep AR5, some allow either).
- **Double-application trap:** most published factors (EPA/DEFRA) are **pre-aggregated CO₂e** with GWP already applied; multiplying a CO₂e factor by GWP again over-counts (~30% high for gas). The factor model must record whether a factor is *per-gas* (needs GWP) or *CO₂e-aggregated* (does not) — a real correctness bug to design against.
- **eGRID factors update annually and by subregion;** location-based scope 2 must pin the eGRID year + subregion used. Re-running last year's audited report must yield the **identical** number even after the factor table updates — which means factor selection is *as-of the reporting period*, and used factor versions are frozen.

**Energy baseline & M&V — ISO 50001/50006 + IPMVP + ASHRAE Guideline 14.** "Energy savings require a defensible baseline, not just before/after" (base spec) is operationalized by real standards ([ISO 50006 EnPI/EnB](https://enercoss.com/iso-50006/); [LBNL 50001-Ready EnPI/baseline guidance](https://navigator.lbl.gov/guidance/task/11); [EVO IPMVP M&V Focus](https://evo-world.org/en/m-v-community/mv-focus/883-october-2020-m-v-focus-issue-7/1192-detecting-savings-under-10-using-ipmvp-option-c); [ASHRAE Guideline 14-2014](https://www.eeperformance.org/uploads/8/6/5/0/8650231/ashrae_guideline_14-2002_measurement_of_energy_and_demand_saving.pdf)):
- An **Energy Baseline (EnB)** is a model over a reference period; **EnPIs** are the performance indicators (a ratio or a regression model). The baseline **normalizes** consumption against **relevant variables**: **production volume**, **weather (heating/cooling degree-days with a fitted balance-point temperature)**, **operating hours**, and **shutdown periods** — exactly the base spec's normalization inputs.
- **IPMVP M&V options:** **A** (retrofit isolation, key-parameter measured, others estimated), **B** (retrofit isolation, all parameters measured), **C** (whole-facility regression — baseline model from utility data, then an **adjusted baseline** projecting the baseline model onto the *reporting-period* conditions; **avoided energy = adjusted-baseline − measured**), **D** (calibrated simulation). The foundation should implement **Option C regression** rigorously.
- **Savings are uncertain and the uncertainty is computable:** model fit is judged by **CV(RMSE)** (RMSE ÷ mean) and **NMBE** (bias); **Fractional Savings Uncertainty** is *proportional to CV(RMSE) and inversely proportional to the savings fraction* — so small savings on a noisy model are statistically indistinguishable from zero (ASHRAE G14 thresholds, commonly CV(RMSE) ≤ ~15% monthly / ~25–30% hourly). The M&V workflow must report savings **with an uncertainty band**, and **refuse to claim** savings that aren't statistically separable from baseline noise — the antidote to greenwashing.

**Tariff economics — the part that can dominate carbon.** "Tariff economics can dominate carbon optimization and create conflicting objectives" (base spec) is grounded in real rate structures ([ComparePower demand charges](https://comparepower.com/demand-charges-explained/); [EnVigilance ratchet clause](https://envigilance.com/blog/ratchet-clause/); [Energy Toolbase demand charges](https://www.energytoolbase.com/blog/resourceguide/demand-charges-what-are-they/)):
- **Demand charges** bill the **peak kW over a short (typically 15-min) interval** in the period — often the single largest line item, and **carbon-blind** (peak kW ≠ peak CO₂).
- **Ratchet clauses:** the billed demand has a floor of (e.g.) **80% of the highest peak in the prior 11 months** — so *one* bad 15-minute spike inflates bills for almost a year. This makes the optimizer's job *path-dependent across months*, not just within a day.
- **Time-of-use (TOU) energy + TOU demand** (peak/off-peak, seasonal); **power-factor penalties** (below ~0.9–0.95 → surcharge, fixable by capacitor banks); **contracted/firm capacity** limits; **coincident-peak** charges tied to the *grid's* system peak (not the site's own peak); **demand-response events** (curtail on signal for credit). All of these are deterministic, fixture-able rate-engine rules.

**Optimization — proposals, not commands** (base spec, hard requirement). Load shifting, peak shaving, battery dispatch, and production-schedule adjustment under operational constraints is a classic **MILP** ([MILP battery dispatch + degradation, ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2352152X26001751); [MDPI Li-ion degradation cost MILP](https://www.mdpi.com/1996-1073/15/9/3060); [peak-clipping vs load-shifting dispatch, ScienceDirect](https://www.sciencedirect.com/science/article/pii/S259017452300048X)): decision variables = per-interval charge/discharge/curtail/shift; constraints = **state-of-charge bounds, charge/discharge power limits, round-trip efficiency, battery degradation cost (piecewise-linearized DoD/SoC), production deadlines/throughput, contracted-capacity ceilings, ramp limits**; objective = minimize **cost** OR **carbon** (with **marginal/time-resolved emission factors**) — and these objectives **trade off**, so the output is a **Pareto-aware proposal set** with the binding constraints and the carbon-vs-cost delta named, never a single "do this" command. **Infeasible schedules (deadline can't be met within capacity) must be rejected with the binding constraint surfaced.**

## E2. The hardest technical seams (named)

1. **Immutable, as-of factor versioning (the audit spine).** A factor is keyed by `(category, region/subregion, gas-or-CO2e, GWP-basis, effective-period, source, version)`. A report computed for period P pins the factor versions valid **as-of P**; once an audited report references a factor version, that version is **frozen**. Re-running the report after the factor table updates yields the *identical* total. The system must track **GWP-applied vs per-gas** to avoid double-application. This is the seam every naive build breaks by treating factors as a mutable lookup.

2. **Dual scope-2 with a non-double-counting market-based engine.** Two parallel computations over the same electricity activity data: location-based (grid-average) and market-based (instrument-hierarchy). The market-based path must **retire each certificate once**, fall through the hierarchy (EAC → supplier rate → **residual mix** → location average), and ensure `Σ(claimed MWh) ≤ consumed MWh` per market/period with temporal+geographic matching. The **residual-mix** computation is what prevents the same clean MWh being counted by two buyers — the anti-greenwashing core.

3. **Data-quality scoring + transparent estimation of bad meter data.** "Bad meter data must be estimated transparently" (base spec). Every activity datum carries a **data-quality tier** (metered / sub-metered / utility-bill / estimated / proxy). Gaps and bad readings are **estimated by a documented method** (regression backfill, profile, proration) with the estimate **flagged and its method recorded** — never silently filled. The report's totals carry an aggregate **data-quality score and evidence-gap list** (base spec's "evidence gaps").

4. **The normalized baseline + adjusted-baseline projection (M&V core).** Fit a regression of energy on {production, HDD/CDD at a fitted balance point, operating hours, shutdown flags} over the baseline period; compute fit stats (CV(RMSE), NMBE, R²); project the **adjusted baseline** onto reporting-period independent variables; **avoided energy = adjusted-baseline − actual**, reported **with fractional savings uncertainty**. Savings below the uncertainty floor are reported as "not statistically distinguishable from zero."

5. **The tariff state machine with cross-period memory (ratchet).** A tariff engine that, given an interval load series, computes energy + demand + power-factor + coincident-peak charges, **carrying the ratchet floor across up to 11 prior months**. This path-dependence means the optimizer can't treat each day independently — a spike today raises the floor for months.

6. **The conflicting-objective optimizer producing tradeoff-explicit proposals.** A constrained (MILP-shaped) optimizer that emits **proposals** — each with the projected cost delta, carbon delta (using time-resolved factors), the constraints it respected, the constraints it's *binding* against, and an explicit note when cost-optimal and carbon-optimal diverge. Infeasibility is a first-class, explained output. **Optimization NEVER mutates the ledger or issues commands** — strict separation (base spec).

7. **Strict module isolation (accounting ⟂ operations).** Accounting calculations, meter data-quality, tariff simulation, optimization, and report formatting are **separate modules** (base spec). The optimizer may *read* accounting/tariff data but the audited ledger is downstream of physical+contractual facts only — an optimizer proposal can never appear in a carbon total.

## E3. Determinism & testability strategy

- **Virtual clock + typed units everywhere.** No `Date.now()`; reporting periods, ratchet windows, baseline/reporting periods, TOU schedules, and DR events read an injected clock. **Branded units** for energy (kWh, MWh, MJ, therm), power (kW, kVA, kVAR), emissions (kg/t CO₂e), currency, production quantity, temperature (°C/°F → degree-days), time intervals (15-min/hour) so kWh and kW (and kVA vs kW) can never be confused. (Base spec: "use typed units… make factor versions immutable.")
- **Fixture adapters at every boundary,** named as adapters and **never live in tests** (base spec: "do not call live utility or emissions APIs"): `MeterDataAdapter` (interval load + injectable bad data/gaps), `EmissionFactorAdapter` (versioned factor tables: eGRID-style location + residual-mix + GWP sets), `TariffAdapter` (rate definitions), `WeatherAdapter` (temperatures → degree-days), `CertificateRegistryAdapter` (RECs/GOs with retire-once tracking).
- **Event-sourced / append-only ledger.** Activity data, factor-version pins, certificate retirements, and report issuances are immutable events; totals are pure folds. A re-fold reproduces byte-identical reports.
- **Deterministic optimizer.** The MILP is solved by a deterministic solver (or a deterministic heuristic with a fixed tie-break + seed) so proposals are reproducible; tests assert *proposal* properties (feasibility, monotonic improvement, tradeoff disclosure), not solver internals.
- **Golden report + golden proposal outputs.** The seed manufacturer (multiple facilities, bad meter data, solar certificates, demand-charge spike, production-driven variance) yields **golden carbon reports** (per facility/source/scope/factor-version, with evidence gaps) and **golden optimization proposals** — all byte-stable.

## E4. Adversarial / failure / edge-case fixture pack (the suite that separates real from demo)

Ship these as deterministic fixtures the engine must handle correctly:

- **Factor table updates after an audited report** — eGRID year N+1 arrives; re-running the year-N audited report must yield the **identical** number (frozen version), while a *new* year-N+1 report uses the new factor. The immutability test.
- **GWP-basis change** — switching the GWP set (AR5→AR6) changes CH₄/N₂O CO₂e; the report must label which set it used and never silently mix sets within one report.
- **CO₂e double-application trap** — a fixture factor is already CO₂e-aggregated; the engine must NOT re-multiply by GWP (the ~30%-high gas bug).
- **Certificate over-claim** — RECs retired exceed MWh consumed in the market/period → reject the excess; `Σclaimed ≤ consumed`. Plus a REC from the wrong grid/year → fails temporal/geographic matching.
- **Residual-mix double-count** — two scenarios where the same clean MWh could be counted by both a certificate and the grid average; the residual-mix path must prevent it.
- **Stuck / missing / negative meter reading** — a meter flatlines, drops out, or reads negative → flagged, estimated by a documented method, the estimate marked low-quality, never silently filled; the data-quality score drops.
- **Demand-charge spike + ratchet** — a single 15-min spike sets a peak that, via the 80% ratchet, inflates demand charges for the next 11 months; the tariff engine must reflect the cross-month floor, and the optimizer must value *preventing* the spike over within-day arbitrage.
- **Power-factor penalty** — load with poor PF (kVAR-heavy) incurs a surcharge; a capacitor-bank proposal must show the penalty avoided.
- **Carbon-vs-cost divergence** — the cheapest (off-peak) hours are the *dirtiest* on the grid (or vice-versa); the optimizer must surface that minimizing cost increases carbon and present both, not a single blended lie.
- **Infeasible production schedule** — a load-shift that would miss a production deadline or exceed contracted capacity → rejected with the binding constraint named, not silently relaxed.
- **Baseline too noisy for the claimed saving** — a project whose savings fraction is below the fractional-savings-uncertainty floor for the model's CV(RMSE) → reported as "not statistically distinguishable from zero," not as a confident saving.
- **Production/weather confound** — energy rose because production rose (or it was hotter), not because efficiency fell; the normalized baseline must attribute correctly so a real regression doesn't masquerade as savings/overrun.
- **Boundary mis-scope** — an emissions source that belongs to scope 1 entered as scope 2 (or out-of-boundary) → boundary check flags it; totals never double-count across scopes.

## E5. Rigorous acceptance criteria — property-based / invariant tests

Beyond the base spec's example tests, assert **domain invariants** as property-based tests over randomized + scripted fixtures:

1. **Factor-version immutability.** For any audited report R over period P, recomputing R after any number of factor-table updates yields a **byte-identical** total; a used factor version is never mutated. Fuzz factor-table updates.
2. **Provenance totality (traceable totals).** Every reported total decomposes exactly into `Σ(activity_data_i × factor_version_i)` and each term traces to a source datum + factor version + method; the sum of traced components equals the headline total (no unexplained residual). (Base spec: "trace every total back to source data and factor version.")
3. **Scope additivity & non-overlap.** `total = scope1 + scope2 + (scope3 if in boundary)`; no source is counted in two scopes; market-based and location-based scope 2 are reported as **two distinct labeled numbers** over the same electricity.
4. **Certificate conservation / no double counting.** Per market and period, `Σ(retired certificate MWh) ≤ consumed MWh`; each certificate is retired at most once; the residual-mix path never lets a claimed MWh also count in the grid-average remainder.
5. **GWP correctness.** Per-gas factors get GWP applied exactly once with the report's pinned GWP set; CO₂e-aggregated factors are never re-multiplied. Fuzz mixed factor types.
6. **Energy conservation across sub/main meters.** Submeter readings reconcile to the main meter within a stated tolerance; unexplained difference is surfaced as an evidence gap, never absorbed.
7. **Baseline soundness.** Avoided energy = adjusted-baseline − actual; reported with fractional savings uncertainty; a savings claim below the uncertainty floor is reported as not-distinguishable-from-zero. Monotonic: a larger genuine efficiency gain (holding normalized variables fixed) yields larger reported savings.
8. **Optimization safety.** Every emitted proposal satisfies all operational constraints (SoC bounds, power/efficiency limits, production deadlines, contracted capacity); an infeasible request yields a *flagged* infeasibility naming the binding constraint, never a silent constraint relaxation; the optimizer never mutates the ledger.
9. **Tradeoff disclosure totality.** Whenever a cost-optimal proposal differs in carbon from the carbon-optimal proposal, both deltas are present in the output (no blended single number masking the conflict).
10. **Determinism.** Re-running accounting, M&V, tariff, and optimization over the same fixtures yields byte-identical reports and proposals.

## E6. Concrete first vertical slice (the on-ramp — build THIS first, ~38–42 cards as scoped)

Prove the spine end-to-end on **one facility with one main meter + two submeters, scope-1 gas + scope-2 electricity, one solar REC, one demand spike, and one efficiency project**, before breadth:

1. **Typed-unit kernel** (energy/power/emissions/currency/production/temperature/interval) + virtual clock + append-only event log.
2. **Versioned EmissionFactorAdapter** (location/eGRID-style + residual-mix + GWP sets; per-gas vs CO₂e flag) with **as-of selection + freeze-on-use**.
3. **Scope-1 + Scope-2 accounting engine** with provenance links (every total → activity datum + factor version + method).
4. **Dual scope-2**: location-based AND market-based with the **instrument hierarchy + residual mix + retire-once** certificate logic.
5. **MeterDataAdapter + data-quality scoring**: ingest interval data, detect stuck/missing/negative, **estimate transparently** with method + quality tier; submeter↔main reconciliation.
6. **Degree-day weather normalization + Option-C baseline regression** (production + HDD/CDD@balance-point + operating hours + shutdown), with **CV(RMSE)/NMBE** fit stats.
7. **M&V workflow**: baseline → implementation date → adjusted baseline → **avoided energy with fractional savings uncertainty**; refuse savings below the noise floor.
8. **TariffAdapter + tariff engine**: TOU energy + demand charge + **ratchet (cross-month floor)** + power-factor penalty + contracted capacity.
9. **Optimization planner (MILP-shaped)**: load-shift / peak-shave / battery dispatch (SoC + degradation) / production-schedule under constraints → **proposals with cost+carbon tradeoffs + binding constraints**; reject infeasible.
10. **Report generator**: traceable totals by facility/source/scope/**factor version**, with **evidence gaps + data-quality score** — golden-tested.
11. **The seed manufacturer scenario** (multiple facilities, bad meter data, solar certificates, demand-charge spike, production-driven variance) as **golden carbon report + golden proposals**, asserting the global invariants (E5) hold.
12. **The immutability test**: update the factor table → re-run the audited report → identical total; new-period report uses the new factor.

If that slice is real, more scopes, battery sizing, full IPMVP options, and multi-facility rollups are additions on a proven spine.

## E7. Domain knowledge-debt to track (surface, don't bluff)

Each debt item gets an owner, a risk level, and an **expert-review-needed** flag; several are **action-gating** (an output is withheld or labeled provisional until resolved):

- **Factor source & vintage** — eGRID subregion mapping, the chosen factor database, and the **GWP assessment-report basis (AR5 vs AR6)** are framework- and jurisdiction-dependent and legally consequential; the factor pack must be expert-reviewed and dated. *(Expert: GHG accounting / verifier; **action-gating** for audited reports.)*
- **Market-based instrument validity** — REC/GO eligibility, tracking-system retirement, and temporal/geographic matching rules vary by market and evolve; the certificate logic is a defensible default pending verifier review. *(Expert: energy-attribute/registry specialist.)*
- **Organizational boundary & consolidation** — operational vs. financial vs. equity-share consolidation, and what's in/out of the inventory boundary, is a reporting choice with audit consequences; the boundary must be explicit and reviewed. *(Expert: GHG lead; **action-gating** for scope totals.)*
- **Baseline & M&V rigor** — the right IPMVP option, independent variables, balance-point fitting, and CV(RMSE)/uncertainty thresholds are project-specific and standard-governed (ISO 50006 / ASHRAE G14); shipped thresholds are defensible defaults. *(Expert: CMVP / energy engineer; **action-gating** for savings claims.)*
- **Tariff fidelity** — real tariffs have rate riders, seasonal definitions, coincident-peak tags, and ratchet specifics that vary by utility; the rate engine is a simplified model needing the actual tariff sheet. *(Expert: utility-rate analyst.)*
- **Optimization model fidelity** — battery degradation, ramp limits, and production constraints are simplified/linearized; real dispatch needs measured battery curves and process constraints. The optimizer outputs *advisory proposals*, never control commands. *(Expert: controls/operations.)*
- **Marginal vs. average carbon for optimization** — using average grid factors for *operational* carbon optimization is a known approximation; marginal/time-resolved factors are more correct and contested. Flag which is used. *(Expert: grid-carbon methodologist.)*
- **Greenwashing / claims integrity** — any external-facing reduction or "carbon-neutral" claim is a legal/reputational risk; the system *organizes evidence*, it does not certify claims, and unverifiable summaries are refused (base non-goal). *(Expert: sustainability counsel; **action-gating** for public claims.)*

## E8. Why this is a great !Klein challenge

It is the mid-complexity proving ground for exactly what !Klein must demonstrate with weak local models: **immutability + versioning discipline as a typed property** (factor-version freeze and the as-of audit-reproduction test reward an agent that *doesn't* treat reference data as a mutable lookup — the single most common shallow mistake, and a clean fuzzable invariant), **two methodologically-distinct truths held without cross-contamination** (dual scope-2 + residual-mix anti-double-count is subtle domain reasoning a bluffing model gets wrong in a way the certificate-conservation property *catches*), **uncertainty-honest reporting** (refusing a savings claim that's below the statistical noise floor is the carbon analogue of the colossus's "weak model must prefer escalation over confident-wrong" — testable via the fractional-savings-uncertainty fixture), **conflicting-objective transparency** (carbon-vs-cost divergence forces the agent to surface a tradeoff instead of inventing a single blended number — the anti-greenwashing discipline), and **provenance totality** (every total tracing to source + factor version is a literal graph the agent must build, not a prose claim). A swarm decomposes it cleanly along the base spec's own module seams (accounting / meter-quality / tariff / optimization / reporting) behind the typed-unit + versioned-factor + event-log primitives; the accounting engine and optimization engine parallelize but stay isolated, and the reports/proposals are projections — legible work, with immutability + conservation + uncertainty tests that make the output audit-trustworthy *because a regulator will ask "prove it."*

---

## Small-model build guide (3B-ready)

### 1. Glossary & ground rules

**Domain terms:**
- **Scope 1** — Direct GHG emissions from sources owned or controlled by the organization (on-site fuel combustion, fugitive refrigerant leaks, company vehicles). Computed as `activity_data × emission_factor`.
- **Scope 2** — Indirect emissions from purchased electricity, steam, heat, or cooling. Has two required reporting methods: **location-based** (grid-average factor for the region) and **market-based** (contractual instrument factor, with instrument hierarchy).
- **Dual reporting** — Scope 2 must report both location-based and market-based values separately. They are never added together.
- **EAC** — Energy Attribute Certificate (e.g. REC, Guarantee of Origin). Each certificate represents 1 MWh of renewable electricity. Must be retired at most once; temporal and geographic matching required.
- **Residual mix** — The grid-average emission factor *after* removing the electricity claimed by EACs. Prevents double-counting when one buyer holds the EAC and another buyer uses the same grid average.
- **GWP** — Global Warming Potential. Converts non-CO₂ gases (CH₄, N₂O) to CO₂-equivalent. Values are versioned by IPCC assessment report (AR4/AR5/AR6). Pin the GWP set per report.
- **CO₂e** — CO₂-equivalent: `activity × factor × GWP` for per-gas factors; just `activity × factor` for already-CO₂e-aggregated factors.
- **Factor version** — A specific emission factor value keyed by `(category, region, gas-or-CO2e, GWP-basis, effectivePeriod, source, version)`. Immutable once used in an audited report.
- **As-of selection** — Pick the factor version whose `effectivePeriod` covers the reporting period; never pick the *current* version when re-running a past-period report.
- **EnB** — Energy Baseline. A regression model of energy consumption vs. relevant variables (production, HDD/CDD, operating hours), fit over a reference period.
- **EnPI** — Energy Performance Indicator. A ratio or regression derived from the EnB.
- **Option C M&V** — IPMVP whole-facility regression method: fit EnB on baseline data; project the **adjusted baseline** onto reporting-period independent variables; **avoided energy = adjusted-baseline − actual**.
- **CV(RMSE)** — Coefficient of Variation of RMSE: `RMSE / mean_consumption`. Measures model noise. ASHRAE Guideline 14 threshold: ≤ 15% monthly.
- **NMBE** — Normalized Mean Bias Error: `Σ(predicted - actual) / (n × mean)`. Measures systematic bias. ASHRAE G14 threshold: ≤ 5%.
- **Fractional savings uncertainty (FSU)** — `FSU ≈ 1.26 × CV(RMSE) / F_s` where `F_s = avoided_energy / baseline_energy`. If FSU > 0.5 (50%), savings are not statistically distinguishable from zero.
- **HDD/CDD** — Heating/Cooling Degree Days. `HDD = max(0, T_balance - T_daily)`, `CDD = max(0, T_daily - T_balance)` summed over days in a period. Balance point typically 65°F/18°C but is fitted.
- **Demand charge** — The utility bill line item based on peak kW in a 15-minute interval. Often the largest cost component.
- **Ratchet clause** — The billed demand has a floor of (e.g.) 80% of the highest peak in the prior 11 months. One spike inflates bills for almost a year.
- **TOU** — Time-of-Use: different energy or demand rates apply in different time windows (peak, mid-peak, off-peak).
- **Power factor (PF)** — `PF = kW / kVA`. Low PF (< ~0.9) incurs a utility penalty. Real power (kW) vs. apparent power (kVA).
- **Data quality tier** — Metered (best) → sub-metered → utility-bill → estimated → proxy (worst). Each activity datum carries its tier.
- **Provenance** — Tracing every reported total back to the exact `(activity datum, factor version, method)` that produced it.
- **Proposal** — The optimizer's output: a feasible (or declared-infeasible) schedule adjustment with cost delta, carbon delta, binding constraints, and explicit tradeoff notes. Never a command; never mutates the ledger.
- **Greenwashing** — An unverifiable or misleading claim about carbon/environmental performance. The system must refuse to emit these (base spec non-goal).

**Soil/process constants to use (not invented):**
- CH₄ GWP-100: AR5 = 28 (fossil), AR6 = 27.9 — use AR5 as default, record the choice.
- N₂O GWP-100: AR5 = 265, AR6 = 273 — use AR5 as default.
- EPA eGRID factors are region-specific; use a fixed fixture table (never live API).

**Stack (explicit):**
- Language: TypeScript (strict mode, no `any`)
- Runtime: Node.js
- Test runner: `npm test` → Vitest (or Jest — check `package.json`; if neither exists, use Vitest)
- No external services in tests; fixture adapters only
- Key patterns: branded types for units, immutable factor versions, append-only event log, pure fold for totals, virtual clock

**Acceptance command — plain steps:**
1. `cd` to the project root.
2. Run `npm test`.
3. All tests pass with exit code 0.
4. No network calls. No `Date.now()`. No live API calls to utility or emissions databases.

**Determinism rules (imperative):**
- Never call `Date.now()`, `new Date()`, `Math.random()` outside the seeded PRNG, or any network/live-API function.
- Virtual clock is injected; use it for all period boundaries, ratchet windows, and TOU schedules.
- Factor versions are keyed and looked up by their version ID; the as-of lookup is deterministic given the same factor table.
- The optimizer uses a deterministic algorithm (greedy or LP with fixed tie-break + seed); its proposals are reproducible.

---

### 2. The explicit task graph for the first vertical slice

The first vertical slice covers E6 items 1–12. Build in dependency order.

---

**C01 — Typed-unit kernel + virtual clock + append-only event log**
dependsOn: none
files: `src/units.ts`, `src/clock.ts`, `src/event-log.ts`, `test/units.test.ts`, `test/clock.test.ts`
interface:
```typescript
// src/units.ts
export type Kwh = number & { readonly __unit: 'kWh' }
export type Mwh = number & { readonly __unit: 'MWh' }
export type Kw = number & { readonly __unit: 'kW' }
export type Kva = number & { readonly __unit: 'kVA' }
export type KgCo2e = number & { readonly __unit: 'kgCO2e' }
export type TCo2e = number & { readonly __unit: 'tCO2e' }
export type Dollars = number & { readonly __unit: 'USD' }
export type DegreeDay = number & { readonly __unit: 'DD' }
export type IntervalMinutes = number & { readonly __unit: 'min_interval' }

export function kwh(v: number): Kwh
export function mwh(v: number): Mwh
export function kw(v: number): Kw
export function kva(v: number): Kva
export function kgCo2e(v: number): KgCo2e
export function tCo2e(v: number): TCo2e
export function dollars(v: number): Dollars
export function degreeDay(v: number): DegreeDay

// Conversions
export function kwhToMwh(v: Kwh): Mwh    // / 1000
export function mwhToKwh(v: Mwh): Kwh    // * 1000
export function kgToTonnes(v: KgCo2e): TCo2e  // / 1000

// src/clock.ts
export interface VirtualClock { today(): number; advance(days?: number): void; reset(): void }
export function createClock(startDay?: number): VirtualClock

// src/event-log.ts
export interface ActivityDatum {
  readonly datumId: string
  readonly facilityId: string
  readonly meterId: string
  readonly periodStartDay: number
  readonly periodEndDay: number
  readonly valueKwh: Kwh        // for electricity; use 0 for non-electric, separate therms field
  readonly valueTherms: number  // for gas
  readonly dataQualityTier: 'metered' | 'submetered' | 'bill' | 'estimated' | 'proxy'
  readonly estimationMethod: string | null  // non-null if tier === 'estimated' or 'proxy'
}

export interface ActivityLog {
  append(datum: ActivityDatum): void
  getAll(): readonly ActivityDatum[]
  getByFacility(facilityId: string): readonly ActivityDatum[]
  getByPeriod(startDay: number, endDay: number): readonly ActivityDatum[]
}
export function createActivityLog(): ActivityLog
// Idempotent on datumId
```
how to implement:
1. Brand each unit type (`type Kwh = number & { readonly __unit: 'kWh' }`); constructor casts via `as`.
2. Virtual clock: same pattern as projects 03 and 04.
3. Activity log: array store; idempotent on `datumId`; `getByPeriod` returns datums with `periodStartDay >= startDay && periodEndDay <= endDay`.
acceptance: `test/units.test.ts` asserts:
- `kwhToMwh(kwh(1000))` equals 1 (MWh)
- `mwhToKwh(mwh(1))` equals 1000 (kWh)
- `kgToTonnes(kgCo2e(1000))` equals 1 (tCO2e)
`test/clock.test.ts`: same assertions as project 03's clock test.

---

**C02 — Versioned emission factor adapter with as-of selection and freeze-on-use**
dependsOn: C01
files: `src/emission-factors.ts`, `src/adapters/factor-adapter.ts`, `src/fixtures/factor-fixtures.ts`, `test/factor-adapter.test.ts`
interface:
```typescript
// src/emission-factors.ts
export type FactorCategory = 'scope1_natural_gas' | 'scope1_diesel' | 'scope2_location' | 'scope2_residual_mix'
export type GwpBasis = 'AR4' | 'AR5' | 'AR6'
export type FactorValueType = 'per_gas' | 'co2e_aggregated'  // CRITICAL: co2e_aggregated must NOT be multiplied by GWP again

export interface EmissionFactorVersion {
  readonly versionId: string
  readonly category: FactorCategory
  readonly region: string              // e.g. 'eGRID_WECC', 'US_national'
  readonly gwpBasis: GwpBasis
  readonly factorValueType: FactorValueType
  readonly kgCo2ePerUnit: number       // kg CO2e per kWh (electricity) or per therm (gas)
  readonly unit: string                // 'kWh' or 'therm'
  readonly effectiveFrom: number       // virtual clock day (reporting period start)
  readonly effectiveTo: number         // virtual clock day (reporting period end, inclusive)
  readonly source: string              // e.g. 'EPA_eGRID_2024'
}

// src/adapters/factor-adapter.ts
export interface FactorAdapter {
  // Returns the factor version valid for the given reporting period
  // "As-of" = effectiveFrom <= periodStart AND effectiveTo >= periodEnd
  getFactorAsOf(
    category: FactorCategory,
    region: string,
    periodStartDay: number,
    periodEndDay: number,
    gwpBasis: GwpBasis
  ): EmissionFactorVersion | null

  // Returns all versions (for audit / versioning tests)
  getAllVersions(): readonly EmissionFactorVersion[]
}

export function createFixtureFactorAdapter(versions: EmissionFactorVersion[]): FactorAdapter

// Frozen factor reference — recorded when a report pins a factor version
export interface FrozenFactorRef {
  readonly reportId: string
  readonly factorVersionId: string
  readonly frozenAtDay: number
}
export interface FactorFreezeRegistry {
  freeze(ref: FrozenFactorRef): void
  getFrozenVersion(reportId: string, factorVersionId: string): EmissionFactorVersion | null
}
export function createFactorFreezeRegistry(adapter: FactorAdapter): FactorFreezeRegistry
```
how to implement:
1. Create `src/emission-factors.ts` with the interfaces.
2. `createFixtureFactorAdapter`: stores versions array; `getFactorAsOf` filters by category + region + `effectiveFrom <= periodStartDay && effectiveTo >= periodEndDay` + gwpBasis; if multiple match, return the one with the highest `effectiveFrom`.
3. `createFactorFreezeRegistry`: stores frozen refs in a map `reportId → Map<factorVersionId, EmissionFactorVersion>`; `freeze(ref)` looks up the version by `ref.factorVersionId` in the adapter and stores it; `getFrozenVersion` returns the stored version (not the current one from the adapter).
4. Create `src/fixtures/factor-fixtures.ts` with a small but complete fixture table: two eGRID years (year N and year N+1) for `scope2_location_WECC` with different `kgCo2ePerUnit`; one `scope1_natural_gas`; one `scope2_residual_mix`.
acceptance: `test/factor-adapter.test.ts` asserts:
- `getFactorAsOf('scope2_location', 'eGRID_WECC', periodY1)` returns year-N factor.
- After adding a year-N+1 factor to the fixture, requesting year-N period still returns year-N factor (as-of selection).
- `FactorFreezeRegistry.freeze(ref)` then `getFrozenVersion(reportId, versionId)` returns the frozen version even after the adapter table is updated (immutability).
- A factor with `factorValueType: 'per_gas'` has a different `kgCo2ePerUnit` than one with `'co2e_aggregated'` (just verify they're separate; the correctness test is in C03).

---

**C03 — Scope 1 + Scope 2 accounting engine with provenance**
dependsOn: C01, C02
files: `src/accounting-engine.ts`, `test/accounting-engine.test.ts`
interface:
```typescript
export interface EmissionLineItem {
  readonly datumId: string            // links to ActivityDatum
  readonly factorVersionId: string
  readonly factorCategory: FactorCategory
  readonly method: 'location_based' | 'market_based'
  readonly activityKwh: Kwh | null
  readonly activityTherms: number | null
  readonly kgCo2e: KgCo2e
  readonly gwpBasis: GwpBasis
  readonly factorValueType: FactorValueType
}

export interface ScopeTotal {
  readonly scope: 1 | 2
  readonly method: 'location_based' | 'market_based' | 'n/a'
  readonly totalKgCo2e: KgCo2e
  readonly lineItems: readonly EmissionLineItem[]
}

export function computeScope1(
  activityData: readonly ActivityDatum[],
  adapter: FactorAdapter,
  gwpBasis: GwpBasis,
  periodStartDay: number,
  periodEndDay: number
): ScopeTotal

// Computes location-based scope 2 only (no certificates)
export function computeScope2LocationBased(
  activityData: readonly ActivityDatum[],
  adapter: FactorAdapter,
  region: string,
  gwpBasis: GwpBasis,
  periodStartDay: number,
  periodEndDay: number
): ScopeTotal
```
how to implement:
1. Create `src/accounting-engine.ts`.
2. `computeScope1`: filter activityData for `periodStartDay/EndDay`; for each gas datum, call `adapter.getFactorAsOf('scope1_natural_gas', ...)`. Compute `kgCo2e`:
   - If `factor.factorValueType === 'per_gas'`: `kgCo2e = activityTherms × factor.kgCo2ePerUnit × GWP_VALUE[gas][gwpBasis]`.
   - If `factor.factorValueType === 'co2e_aggregated'`: `kgCo2e = activityTherms × factor.kgCo2ePerUnit` — do NOT multiply by GWP again.
3. `computeScope2LocationBased`: same pattern; multiply `activityKwh` by the location-based factor; `factorValueType` is typically `'co2e_aggregated'` for grid factors.
4. Build `lineItems` with the full provenance chain (datumId, factorVersionId, method, inputs, output).
5. `totalKgCo2e` is the sum of all `lineItem.kgCo2e`.
acceptance: `test/accounting-engine.test.ts` asserts:
- 1000 kWh × 0.4 kgCO₂e/kWh location-based factor = 400 kgCO₂e scope 2.
- Gas: 10 therms × per-gas factor (e.g. 5.3 kgCO₂/therm) × GWP = correct CO₂e.
- Gas with CO₂e-aggregated factor: 10 therms × factor = result; NOT multiplied by GWP again. Assert that applying GWP manually gives a different (wrong) number.
- Every `lineItem` has a non-null `datumId` and `factorVersionId`.
- `ΣlineItems.kgCo2e === totalKgCo2e`.

---

**C04 — Dual scope-2: market-based with instrument hierarchy, residual mix, retire-once**
dependsOn: C02, C03
files: `src/certificates.ts`, `src/scope2-market.ts`, `test/scope2-market.test.ts`
interface:
```typescript
// src/certificates.ts
export interface EnergyCertificate {
  readonly certId: string
  readonly facilityId: string
  readonly mwhClaimed: Mwh
  readonly grid: string               // must match consumption region
  readonly periodStartDay: number
  readonly periodEndDay: number
  readonly retired: boolean
}

export interface CertificateRegistry {
  retire(cert: EnergyCertificate): void
  isRetired(certId: string): boolean
  getRetiredMwh(facilityId: string, periodStartDay: number, periodEndDay: number): Mwh
  // Throws if cert already retired (retire-once invariant)
}
export function createCertificateRegistry(): CertificateRegistry

// src/scope2-market.ts
// Instrument hierarchy: EAC → supplier-specific rate → residual mix → location-based
export type MarketBasedMethod =
  | 'eac'               // energy attribute certificate
  | 'supplier_rate'     // utility/supplier-specific emission rate
  | 'residual_mix'      // grid residual after EAC claims
  | 'location_fallback' // last resort: same as location-based

export interface MarketBasedLineItem extends EmissionLineItem {
  readonly instrumentMethod: MarketBasedMethod
  readonly certId: string | null
}

export interface DualScope2Result {
  readonly locationBased: ScopeTotal        // from computeScope2LocationBased
  readonly marketBased: ScopeTotal          // using the instrument hierarchy
  readonly claimedEacMwh: Mwh
  readonly residualMwhFraction: number      // fraction of consumption not covered by EACs
}

export function computeScope2MarketBased(
  activityData: readonly ActivityDatum[],
  certificates: readonly EnergyCertificate[],
  certRegistry: CertificateRegistry,
  adapter: FactorAdapter,
  region: string,
  gwpBasis: GwpBasis,
  periodStartDay: number,
  periodEndDay: number
): DualScope2Result
```
how to implement:
1. Create `src/certificates.ts`: store retired certIds in a Set; `retire` throws if already retired; `getRetiredMwh` sums `mwhClaimed` for matching certs.
2. Create `src/scope2-market.ts`.
3. `computeScope2MarketBased`:
   a. Compute `locationBased` via `computeScope2LocationBased`.
   b. Total consumption = `Σ(activityData.valueKwh)`.
   c. Filter `certificates` that match `facilityId`, `grid === region`, and overlap with `periodStartDay/EndDay`.
   d. `claimedEacMwh = Σ(valid certs mwhClaimed)`. Check `Σclaimed ≤ totalConsumed` — throw or cap if over-claim.
   e. Retire each used certificate via `certRegistry.retire(cert)`.
   f. For EAC-covered MWh: use the zero-factor (EAC declares zero emissions for that MWh).
   g. For remaining MWh: use `scope2_residual_mix` factor from adapter (not the location-based).
   h. Build `marketBased` ScopeTotal from items (f)+(g).
4. `residualMwhFraction = (totalConsumed - claimedEacMwh) / totalConsumed`.
acceptance: `test/scope2-market.test.ts` asserts:
- 1000 kWh consumed, 500 kWh EAC claimed → EAC portion = 0 CO₂e; remaining 500 kWh uses residual-mix factor.
- Dual result: `locationBased.totalKgCo2e` ≠ `marketBased.totalKgCo2e` (different factors → different numbers).
- Both are returned separately; never summed together.
- Over-claim: 1100 kWh certificate against 1000 kWh consumption → throws or caps at 1000 kWh.
- Same certificate retired twice → throws (retire-once invariant).
- Certificate from wrong grid region → not applied (geographic matching).

---

**C05 — Meter data quality scoring: ingest, detect bad data, estimate transparently**
dependsOn: C01
files: `src/meter-quality.ts`, `src/adapters/meter-data-adapter.ts`, `src/fixtures/meter-fixtures.ts`, `test/meter-quality.test.ts`
interface:
```typescript
// src/meter-quality.ts
export type MeterFaultType = 'stuck' | 'missing' | 'negative' | 'submeter_reconcile_gap'

export interface MeterFaultRecord {
  readonly meterId: string
  readonly periodStartDay: number
  readonly faultType: MeterFaultType
  readonly rawValue: number | null
  readonly estimatedValue: number
  readonly estimationMethod: string   // e.g. 'profile_average', 'prior_period_average', 'regression_backfill'
  readonly qualityTier: 'estimated' | 'proxy'
}

export interface MeterQualityResult {
  readonly datumId: string
  readonly originalTier: ActivityDatum['dataQualityTier']
  readonly finalTier: ActivityDatum['dataQualityTier']
  readonly faults: MeterFaultRecord[]
  readonly finalValueKwh: Kwh
}

export function assessMeterQuality(
  data: readonly ActivityDatum[],
  mainMeterId: string,
  submeterIds: readonly string[],
  submeterReconcileToleranceKwh?: number   // default 5 kWh
): MeterQualityResult[]

// Submeter reconciliation: sum of submeters should ≈ main meter; flag gap
export function reconcileSubmeters(
  mainMeterReadings: readonly ActivityDatum[],
  submeterReadings: readonly ActivityDatum[]
): Array<{ periodStartDay: number; mainKwh: Kwh; sumSubmeterKwh: Kwh; gapKwh: Kwh; passes: boolean }>
```
how to implement:
1. Create `src/meter-quality.ts`.
2. `assessMeterQuality`: for each datum, check:
   a. **Negative**: `valueKwh < 0` → `faultType: 'negative'`; estimate using prior-period average.
   b. **Stuck**: consecutive datums with identical `valueKwh` for 3+ periods → `faultType: 'stuck'`; estimate using profile average.
   c. **Missing**: gap in `periodStartDay` sequence → `faultType: 'missing'`; estimate using prior-period average.
   d. Build a `MeterFaultRecord` for each fault; set `finalTier` to `'estimated'`.
3. `reconcileSubmeters`: group by period; compute `gapKwh = |mainKwh - sumSubmeterKwh|`; `passes = gapKwh <= tolerance`.
4. Create fixture `src/fixtures/meter-fixtures.ts` with `NORMAL_METER_DATA` (30 days, consistent 500 kWh/day for main meter, 300+200 for two submeters) and `BAD_METER_DATA` (days 5–7 stuck at same value, day 15 negative, day 20 missing).
acceptance: `test/meter-quality.test.ts` asserts:
- Stuck readings → `faultType: 'stuck'`, `finalTier: 'estimated'`, `estimationMethod` non-empty.
- Negative reading → `faultType: 'negative'`, estimated value > 0.
- Missing day → `faultType: 'missing'`, estimated value present.
- Normal readings → `faults.length === 0`, `finalTier === originalTier`.
- `reconcileSubmeters` gap < tolerance → `passes: true`; gap >= tolerance → `passes: false`.
- `faults` never removes a datum — original datum is accessible (immutability).

---

**C06 — Degree-day weather normalization + Option-C baseline regression**
dependsOn: C01
files: `src/weather-normalization.ts`, `src/baseline-regression.ts`, `test/baseline-regression.test.ts`
interface:
```typescript
// src/weather-normalization.ts
export function computeHdd(tDailyC: number, balancePointC: number): DegreeDay
// max(0, balancePointC - tDailyC)
export function computeCdd(tDailyC: number, balancePointC: number): DegreeDay
// max(0, tDailyC - balancePointC)
export function aggregateDegrees(dailyTemps: number[], balancePointC: number): { hdd: DegreeDay; cdd: DegreeDay }

// src/baseline-regression.ts
export interface RegressionDataPoint {
  periodStartDay: number
  energyKwh: Kwh               // dependent variable
  productionUnits: number
  hdd: DegreeDay
  cdd: DegreeDay
  operatingHours: number
  isShutdownPeriod: boolean    // if true, exclude from regression fit
}

export interface BaselineModel {
  readonly coefficients: {
    intercept: number
    productionUnits: number
    hdd: number
    cdd: number
    operatingHours: number
  }
  readonly cvRmse: number           // CV(RMSE) in fraction (0.15 = 15%)
  readonly nmbe: number             // NMBE in fraction
  readonly rSquared: number
  readonly baselinePeriodPoints: number
  readonly meetsAshrae14: boolean   // cvRmse <= 0.15 AND abs(nmbe) <= 0.05
}

export function fitBaselineModel(points: RegressionDataPoint[]): BaselineModel

export interface MvResult {
  readonly reportingPeriodStartDay: number
  readonly adjustedBaselineKwh: Kwh      // predicted by model on reporting-period conditions
  readonly actualKwh: Kwh
  readonly avoidedKwh: Kwh               // adjustedBaseline - actual
  readonly fractionalSavingsUncertainty: number  // FSU: 1.26 * cvRmse / (avoided/baseline)
  readonly isBelowUncertaintyFloor: boolean      // FSU > 0.5
  readonly savingsClaimKwh: Kwh | null           // null if isBelowUncertaintyFloor
}

export function computeMvSavings(
  model: BaselineModel,
  reportingPoint: RegressionDataPoint   // reporting-period conditions
): MvResult
```
how to implement:
1. Create `src/weather-normalization.ts` with the three functions.
2. Create `src/baseline-regression.ts`.
3. `fitBaselineModel`: implement ordinary least squares (OLS) multiple regression manually (no external lib needed for 4 predictors):
   - Exclude shutdown periods.
   - Build the design matrix X (Nx5: intercept=1, productionUnits, hdd, cdd, operatingHours) and y vector (energyKwh).
   - Compute `β = (X'X)⁻¹X'y` using Gaussian elimination or the normal equations.
   - Compute residuals, RMSE, CV(RMSE), NMBE, R².
   - `meetsAshrae14 = cvRmse <= 0.15 && Math.abs(nmbe) <= 0.05`.
4. `computeMvSavings`:
   - Predict `adjustedBaselineKwh` using `model.coefficients` and reporting-period independent variables.
   - `avoidedKwh = adjustedBaselineKwh - actualKwh`.
   - `FSU = 1.26 * model.cvRmse / (avoidedKwh / adjustedBaselineKwh)` (use absolute value of fraction).
   - `isBelowUncertaintyFloor = FSU > 0.50`.
   - `savingsClaimKwh = isBelowUncertaintyFloor ? null : avoidedKwh`.
acceptance: `test/baseline-regression.test.ts` asserts:
- `computeHdd(15, 18)` = 3 degree-days; `computeHdd(20, 18)` = 0.
- `fitBaselineModel` with perfectly collinear data → coefficients match the known inputs exactly (R² = 1).
- `fitBaselineModel` with noisy data → returns `cvRmse`, `nmbe`, `rSquared` as numbers.
- `computeMvSavings` with large avoidedKwh relative to baseline → `isBelowUncertaintyFloor: false`, `savingsClaimKwh` is non-null.
- `computeMvSavings` with tiny avoidedKwh (3%) and moderate cvRmse (12%) → `FSU > 0.50`, `isBelowUncertaintyFloor: true`, `savingsClaimKwh === null`.

---

**C07 — Tariff engine: TOU + demand charge + ratchet + power factor**
dependsOn: C01
files: `src/tariff-engine.ts`, `src/adapters/tariff-adapter.ts`, `src/fixtures/tariff-fixtures.ts`, `test/tariff-engine.test.ts`
interface:
```typescript
export type TouPeriod = 'peak' | 'mid_peak' | 'off_peak'

export interface TouWindow {
  period: TouPeriod
  startHour: number   // 0–23
  endHour: number     // exclusive
  dayTypes: Array<'weekday' | 'weekend'>
}

export interface TariffDefinition {
  tariffId: string
  touEnergyRates: Record<TouPeriod, number>       // $/kWh
  demandChargePerKw: number                       // $/kW for the peak kW in the billing period
  ratchetFraction: number                         // e.g. 0.80 for 80% ratchet
  ratchetLookbackMonths: number                   // e.g. 11
  powerFactorThreshold: number                    // e.g. 0.90 — below this, penalty applies
  powerFactorPenaltyPerKvar: number               // $/kVAR of reactive demand
  contractedCapacityKw: Kw                        // ceiling; if exceeded, overage charge
  contractedCapacityOveragePerKw: number          // $/kW of overage
  touWindows: TouWindow[]
}

// An interval load reading (15-min)
export interface IntervalReading {
  dayNumber: number
  intervalIndex: number   // 0–95 for 15-min intervals in a day
  kw: Kw
  kvar: number            // reactive power
}

export interface BillingPeriodResult {
  facilityId: string
  periodStartDay: number
  periodEndDay: number
  energyCostByPeriod: Record<TouPeriod, Dollars>
  peakDemandKw: Kw
  billedDemandKw: Kw       // max(peakDemandKw, ratchetFloorKw)
  ratchetFloorKw: Kw       // from prior months
  demandCharge: Dollars
  powerFactorPenalty: Dollars
  contractedCapacityOverage: Dollars
  totalBill: Dollars
}

export function computeBillingPeriod(
  facilityId: string,
  readings: readonly IntervalReading[],
  tariff: TariffDefinition,
  priorPeaksKw: readonly Kw[],   // peak kW for each of the prior ratchetLookbackMonths months
  periodStartDay: number,
  periodEndDay: number
): BillingPeriodResult
```
how to implement:
1. Create `src/tariff-engine.ts`.
2. `computeBillingPeriod`:
   a. Classify each reading into TOU period using `touWindows`.
   b. Energy by TOU period: `Σ(kw * 0.25)` per period (0.25h per 15-min interval) × rate.
   c. `peakDemandKw = max(readings.kw)`.
   d. `ratchetFloorKw = max(priorPeaksKw) * ratchetFraction`.
   e. `billedDemandKw = max(peakDemandKw, ratchetFloorKw)`.
   f. `demandCharge = billedDemandKw * tariff.demandChargePerKw`.
   g. Power factor per interval: `pf = kw / sqrt(kw² + kvar²)`. If PF < threshold, penalty applies to excess kVAR: `penalty = kvar * penaltyRate * 0.25h`.
   h. Contracted capacity: if `peakDemandKw > contractedCapacityKw` → overage charge.
   i. Sum all components.
3. Create fixture `src/fixtures/tariff-fixtures.ts` with `SAMPLE_TARIFF` and two interval-reading sets: `NORMAL_LOAD_INTERVALS` (no spike) and `DEMAND_SPIKE_INTERVALS` (one interval with very high kW on day 5).
acceptance: `test/tariff-engine.test.ts` asserts:
- No spike, prior peaks all low → `billedDemandKw === peakDemandKw` (ratchet doesn't bind).
- Spike on day 5 sets a high `peakDemandKw`; in month 2 with no spike, `billedDemandKw = max(month2_peak, 0.8 * month1_peak)` → ratchet floor is binding.
- Low power factor reading → `powerFactorPenalty > 0`.
- Good power factor → `powerFactorPenalty === 0`.
- `totalBill = energyCost + demandCharge + powerFactorPenalty + contractedCapacityOverage`.

---

**C08 — Optimization planner: load-shift + peak-shave + battery dispatch as proposals**
dependsOn: C01, C07
files: `src/optimizer.ts`, `test/optimizer.test.ts`
interface:
```typescript
export interface BatteryState {
  capacityKwh: Kwh
  socFraction: number        // 0–1 (state of charge)
  maxChargeKw: Kw
  maxDischargeKw: Kw
  roundTripEfficiency: number  // e.g. 0.90
  degradationCostPerKwhCycled: Dollars  // $/kWh of throughput
}

export interface OptimizationConstraints {
  productionDeadlines: Array<{ dayNumber: number; minLoadKw: Kw }>  // must maintain min load
  contractedCapacityKw: Kw
  maxPeakKw: Kw | null        // optional peak target (for peak shaving)
}

export interface OptimizationProposal {
  proposalId: string
  scheduledLoadKw: Kw[]       // adjusted load per interval (same length as input readings)
  batteryDispatchKw: number[] // charge (+) or discharge (-) per interval
  projectedCostDelta: Dollars       // negative = saving
  projectedCarbonDeltaKgCo2e: KgCo2e  // negative = saving
  costOptimal: boolean
  carbonOptimal: boolean
  bindingConstraints: string[]      // e.g. ['production_deadline_day5', 'contracted_capacity']
  tradeoffNote: string | null       // non-null when cost-optimal and carbon-optimal diverge
  feasible: boolean
  infeasibilityReason: string | null
}

export function runOptimizer(
  readings: readonly IntervalReading[],
  battery: BatteryState | null,
  constraints: OptimizationConstraints,
  tariff: TariffDefinition,
  marginalCarbonFactors: number[],    // kgCO2e/kWh per interval (time-resolved grid factors)
  currentBillingResult: BillingPeriodResult
): OptimizationProposal
// NEVER mutates readings or the billing ledger — output is a proposal only
// If any production deadline constraint is violated by the proposed schedule → feasible: false
```
how to implement:
1. Create `src/optimizer.ts`.
2. Implement a simple greedy optimizer (not full MILP, but deterministic and constraint-respecting):
   a. Sort intervals by demand cost priority (peak TOU first; high marginal carbon second).
   b. For each high-demand interval, attempt to shift load to an adjacent off-peak interval if production deadlines permit.
   c. Battery: if battery is available, charge during off-peak (low cost, low carbon) and discharge during peak.
   d. Compute cost and carbon deltas vs. `currentBillingResult`.
   e. Check all constraints; if any violated → `feasible: false`, `infeasibilityReason` names the binding constraint.
3. After computing cost-optimal and carbon-optimal separately: if they differ → set `tradeoffNote` explaining the conflict (e.g. "cheapest hour is grid's dirtiest").
4. The function is pure — it never calls `tariff-engine.ts` with a mutated readings array that updates any ledger.
acceptance: `test/optimizer.test.ts` asserts:
- No battery, no shift possible → proposal with `projectedCostDelta === 0`.
- Shifting a peak load to off-peak → `projectedCostDelta < 0` (saving).
- Production deadline prevents full shift → `bindingConstraints` includes the deadline; still feasible with partial shift.
- Infeasible: requested peak < minimum load needed → `feasible: false`, `infeasibilityReason` non-null.
- Carbon vs. cost conflict fixture → `tradeoffNote` is non-null, both deltas present.
- `runOptimizer` does not modify the input `readings` array (check `readings[0].kw` before and after).

---

**C09 — Report generator: traceable totals by facility/source/scope/factor-version + evidence gaps**
dependsOn: C03, C04, C05
files: `src/report-generator.ts`, `test/report-generator.test.ts`
interface:
```typescript
export interface ReportLineItem {
  facilityId: string
  scopeNumber: 1 | 2
  method: 'location_based' | 'market_based' | 'n/a'
  sourceCategory: FactorCategory
  activityKwh: Kwh | null
  activityTherms: number | null
  factorVersionId: string
  kgCo2e: KgCo2e
  dataQualityTier: ActivityDatum['dataQualityTier']
}

export interface EvidenceGap {
  facilityId: string
  meterId: string
  periodStartDay: number
  description: string           // e.g. 'meter stuck: estimated by profile_average'
  tier: ActivityDatum['dataQualityTier']
}

export interface CarbonReport {
  readonly reportId: string
  readonly facilityId: string
  readonly periodStartDay: number
  readonly periodEndDay: number
  readonly scope1TotalKgCo2e: KgCo2e
  readonly scope2LocationBasedKgCo2e: KgCo2e
  readonly scope2MarketBasedKgCo2e: KgCo2e
  readonly lineItems: readonly ReportLineItem[]
  readonly evidenceGaps: readonly EvidenceGap[]
  readonly dataQualityScore: number  // 0–1: fraction of activity data that is 'metered' or 'submetered'
  readonly frozenFactorRefs: readonly FrozenFactorRef[]  // snapshot for immutability
}

export function generateCarbonReport(
  reportId: string,
  facilityId: string,
  activityLog: ActivityLog,
  meterQualityResults: readonly MeterQualityResult[],
  factorAdapter: FactorAdapter,
  certificates: readonly EnergyCertificate[],
  certRegistry: CertificateRegistry,
  freezeRegistry: FactorFreezeRegistry,
  region: string,
  gwpBasis: GwpBasis,
  periodStartDay: number,
  periodEndDay: number
): CarbonReport
```
how to implement:
1. Create `src/report-generator.ts`.
2. Call `computeScope1`, `computeScope2LocationBased`, `computeScope2MarketBased` with the activity data and factor adapter.
3. Freeze all factor versions used via `freezeRegistry.freeze(ref)`.
4. Collect evidence gaps from `meterQualityResults` where `faults.length > 0`.
5. Compute `dataQualityScore = count(tier in ['metered','submetered']) / total activity datums`.
6. Build `lineItems` from the emission line items.
7. Never sum `scope2LocationBased` and `scope2MarketBased` — they are separate fields.
8. Return the immutable report object.
acceptance: `test/report-generator.test.ts` asserts:
- `scope1TotalKgCo2e + scope2LocationBasedKgCo2e` is the location-based total (scope 2 location).
- `scope2LocationBasedKgCo2e !== scope2MarketBasedKgCo2e` (different values for same electricity).
- Evidence gaps list non-empty when bad meter data is present.
- `dataQualityScore` is between 0 and 1.
- `Σ(lineItems.kgCo2e for scope1)` equals `scope1TotalKgCo2e` (provenance check).
- `frozenFactorRefs` non-empty (factors were frozen).

---

**C10 — Seed manufacturer golden test + the immutability test**
dependsOn: C03, C04, C05, C06, C07, C08, C09
files: `src/fixtures/seed-manufacturer.ts`, `test/seed-manufacturer.test.ts`, `test/immutability.test.ts`
interface: (no new exports — fixture + golden tests)
how to implement:
1. Create `src/fixtures/seed-manufacturer.ts`. Build a fixed scenario:
   - Facility: `PLANT-A`, region `eGRID_WECC`, 30-day period.
   - Meter data: `MAIN_METER` (500 kWh/day for 28 days, stuck on days 5–6 at 500 kWh, negative on day 15).
   - Two submeters: 300 + 195 kWh/day (gap of 5 kWh from main meter on days with bad data → reconcile gap).
   - Gas: 10 therms/day.
   - Solar REC: 5000 kWh = 5 MWh for the period (one EAC).
   - Interval load: `DEMAND_SPIKE_INTERVALS` from C07 fixture (spike on day 5).
   - Baseline regression: 90 days of baseline data with known production/HDD/CDD/hours.
   - Energy project: LED lighting, installed day 15.
2. In `test/seed-manufacturer.test.ts`:
   a. Generate a carbon report for the period.
   b. Assert: `scope1TotalKgCo2e > 0` (gas emissions).
   c. Assert: `scope2LocationBasedKgCo2e !== scope2MarketBasedKgCo2e`.
   d. Assert: EAC covers 5 MWh → market-based CO₂e is lower than location-based.
   e. Assert: evidence gaps present (stuck meter, negative reading, submeter gap).
   f. Assert: `dataQualityScore < 1` (some estimated data).
   g. Run M&V for the LED project: call `computeMvSavings` → savings claim is non-null only if FSU ≤ 0.50.
   h. Run optimizer on the demand spike period → proposal exists, tradeoff note may be present.
   i. Assert: all `lineItems` have a `factorVersionId` that maps to a frozen factor version.
3. In `test/immutability.test.ts`:
   a. Generate report for period P using factor year N.
   b. Add a new factor version for year N (same category, different `kgCo2ePerUnit`, higher version number).
   c. Re-generate report for period P → `scope2LocationBasedKgCo2e` is **identical** to step (a) (frozen factor version was used, not the new one).
   d. Generate a new report for period P+1 using the new factor → shows the new (different) CO₂e value.
acceptance: All assertions pass. `npm test` green. No network, no `Date.now()`.

---

**C11 — Determinism and tradeoff-disclosure integration test**
dependsOn: C10
files: `test/determinism.test.ts`, `test/tradeoff-disclosure.test.ts`
interface: (no new exports)
how to implement:
1. `test/determinism.test.ts`:
   a. Run `generateCarbonReport(...)` twice on identical inputs.
   b. Assert the two reports are structurally identical (same `scope1TotalKgCo2e`, `scope2MarketBasedKgCo2e`, `lineItems` length, `frozenFactorRefs`).
   c. Run `runOptimizer(...)` twice on identical inputs.
   d. Assert the two proposals have identical `projectedCostDelta`, `projectedCarbonDeltaKgCo2e`, `bindingConstraints`.
2. `test/tradeoff-disclosure.test.ts`:
   a. Build a fixture where off-peak hours are low-cost but high-carbon (grid is dirtiest at night), and on-peak hours are high-cost but low-carbon (solar peak).
   b. Run `runOptimizer` with cost objective.
   c. Assert: `costOptimal === true`; `projectedCostDelta < 0`; `projectedCarbonDeltaKgCo2e > 0` (cost saving increases carbon).
   d. Assert: `tradeoffNote` is non-null and contains a description of the conflict.
   e. Assert: both `projectedCostDelta` and `projectedCarbonDeltaKgCo2e` are present in the output (neither is null or zero as a default).
acceptance: All assertions pass.

---

### 3. The decomposition method for the rest of the spec

After the first slice (C01–C11) is green, apply this recipe to expand remaining features (Scope 3 boundary definition, full IPMVP Option A/B, multi-facility rollups, battery sizing, DR event integration) into the same card shape.

**Recipe:**
1. Identify the feature's primary output type — a new TypeScript interface or function signature.
2. Trace its inputs back to existing modules; mark each dependency as a `dependsOn`.
3. Ask: "Does this need a new versioned config?" If yes → version it like emission factors (as-of selection, freeze-on-use).
4. Ask: "Is this accounting or optimization?" They must not share mutable state. Accounting reads activity + factor data; optimization reads accounting outputs but never writes back.
5. Write the acceptance test before the implementation; include the "immutability after factor update" test pattern for any new versioned reference data.
6. One card = one new source file + its test file (exceptions: small utility + its test = one card).

**Worked example 1 — Scope 3 boundary module:**
- **S3B01** — Boundary definition: `interface Scope3BoundaryConfig { facilityId: string; categoriesInScope: Scope3Category[]; rationale: string; effectiveFrom: number }`. dependsOn: C01. files: `src/scope3-boundary.ts`, `test/scope3-boundary.test.ts`. Acceptance: a boundary that includes `'purchased_goods'` includes that category; one that doesn't returns `false` for `isInBoundary('purchased_goods', config)`.
- **S3B02** — Boundary check gate: `function assertScope3Boundary(category: Scope3Category, boundary: Scope3BoundaryConfig): void` — throws if category is not in scope (prevents out-of-boundary emissions from entering the total). dependsOn: S3B01. Acceptance: category in scope → no throw; category out of scope → throws.

**Worked example 2 — IPMVP Option B (all-parameter measured):**
Option B measures all parameters for the retrofitted equipment individually, unlike Option C (whole-facility).
- **MB01** — Option B savings: `interface OptionBMeasurement { equipmentId: string; baselineKwh: Kwh; reportingKwh: Kwh; periodStartDay: number }`. `function computeOptionBSavings(baseline: OptionBMeasurement, reporting: OptionBMeasurement): MvResult`. dependsOn: C06. files: `src/mv-option-b.ts`, `test/mv-option-b.test.ts`. Acceptance: `reportingKwh < baselineKwh` → positive `avoidedKwh`; FSU not computable (no regression model) → set `cvRmse: 0`, `isBelowUncertaintyFloor: false` always for Option B.

**Worked example 3 — Demand response event integration:**
- **DR01** — DR event record: `interface DemandResponseEvent { eventId: string; facilityId: string; startIntervalIdx: number; endIntervalIdx: number; curtailmentKw: Kw; creditPerKw: Dollars }`. dependsOn: C07. files: `src/dr-events.ts`, `test/dr-events.test.ts`. Acceptance: applying DR event to interval readings reduces kW in those intervals; `drCredit = curtailmentKw * creditPerKw`.
- **DR02** — Wire into tariff engine: `computeBillingPeriod` accepts optional `drEvents`; applies curtailment and subtracts `drCredit` from `totalBill`. dependsOn: DR01, C07. files: edit `src/tariff-engine.ts`. Acceptance: without DR → same bill as before; with DR event → `totalBill` is lower by `drCredit`.

---

### 4. Per-task implementation conventions

**File/folder layout:**
```
src/
  units.ts                # branded unit types
  clock.ts                # virtual clock
  event-log.ts            # activity log
  emission-factors.ts     # factor version types + freeze registry
  accounting-engine.ts    # scope 1 + scope 2 location-based
  certificates.ts         # EAC retire-once registry
  scope2-market.ts        # market-based scope 2 + dual result
  meter-quality.ts        # fault detection + estimation
  weather-normalization.ts
  baseline-regression.ts  # OLS + M&V Option C
  tariff-engine.ts        # TOU + demand + ratchet + PF
  optimizer.ts            # proposals with tradeoffs
  report-generator.ts
  adapters/
    factor-adapter.ts
    meter-data-adapter.ts
    tariff-adapter.ts
  fixtures/
    factor-fixtures.ts
    meter-fixtures.ts
    tariff-fixtures.ts
    seed-manufacturer.ts
test/
  units.test.ts
  clock.test.ts
  factor-adapter.test.ts
  accounting-engine.test.ts
  scope2-market.test.ts
  meter-quality.test.ts
  baseline-regression.test.ts
  tariff-engine.test.ts
  optimizer.test.ts
  report-generator.test.ts
  seed-manufacturer.test.ts
  immutability.test.ts
  determinism.test.ts
  tradeoff-disclosure.test.ts
```

**Naming conventions:**
- Source files: kebab-case (`tariff-engine.ts`).
- Test files: `<same>.test.ts`.
- Types: PascalCase (`BillingPeriodResult`).
- Functions: camelCase (`computeBillingPeriod`).
- Constants: SCREAMING_SNAKE_CASE (`SAMPLE_TARIFF`).

**How to write a test in this stack (Vitest example):**
```typescript
import { describe, it, expect } from 'vitest'
import { computeScope2LocationBased } from '../src/accounting-engine.js'
import { createFixtureFactorAdapter } from '../src/adapters/factor-adapter.js'
import { FACTOR_FIXTURES } from '../src/fixtures/factor-fixtures.js'

describe('Scope 2 accounting', () => {
  it('location-based: 1000 kWh × 0.4 factor = 400 kgCO2e', () => {
    const adapter = createFixtureFactorAdapter(FACTOR_FIXTURES)
    // ... build activityData ...
    const result = computeScope2LocationBased(activityData, adapter, 'eGRID_WECC', 'AR5', 0, 29)
    expect(result.totalKgCo2e).toBeCloseTo(400, 1)
  })
})
```

**How to keep tests deterministic:**
- Never call `Date.now()`, `new Date()`, or `Math.random()` (use seeded PRNG from `src/prng.ts` if randomness needed).
- Use `toBeCloseTo(expected, decimalPlaces)` for float comparisons; never strict `===` on floats.
- For the immutability test: always re-run on **the exact same original fixture data** — never on a mutated adapter.
- The optimizer must use the same tie-break rule on every run; never shuffle input arrays.

**How to wire a fixture adapter:**
```typescript
import { createFixtureFactorAdapter } from '../src/adapters/factor-adapter.js'
import { FACTOR_FIXTURES } from '../src/fixtures/factor-fixtures.js'
const adapter = createFixtureFactorAdapter(FACTOR_FIXTURES)
const factor = adapter.getFactorAsOf('scope2_location', 'eGRID_WECC', 0, 29, 'AR5')
```

**Definition of done for any card:**
1. All files in the card's `files` list exist.
2. All interfaces/functions in `interface` are exported; TypeScript compiles cleanly.
3. All acceptance assertions pass under `npm test`.
4. No `Date.now()`, `Math.random()`, `fetch`, or live API calls in any new source files.
5. No `any` types.
6. Accounting and optimization modules are strictly isolated — optimizer never calls `generateCarbonReport`; reporter never calls `runOptimizer`.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Treating emission factors as a mutable lookup table.**
A 3B model will write `factors['scope2_location'] = newValue` and re-run a past-period report using the new factor. Fix: factor selection is always `getFactorAsOf(category, region, periodStartDay, periodEndDay, gwpBasis)` — never a current-factor lookup. After generating an audited report, `freezeRegistry.freeze(ref)` pins the used version. The immutability test (C10) will catch this: re-run the past report after updating the factor table → identical result required.

**Pitfall 2 — Multiplying a CO₂e-aggregated factor by GWP again.**
A model may write `kgCo2e = therms * factor.kgCo2ePerUnit * GWP_METHANE`. If `factor.factorValueType === 'co2e_aggregated'`, GWP is already baked in. Re-applying it inflates gas emissions ~27–30×. Fix: the code must branch on `factorValueType`. If `'per_gas'`, apply GWP; if `'co2e_aggregated'`, do not. Test explicitly: run the same gas consumption through a per-gas factor and a CO₂e-aggregated factor — the per-gas result must equal `therms × gas_factor × GWP`; the CO₂e result must equal `therms × co2e_factor` (not multiplied again).

**Pitfall 3 — Summing location-based and market-based scope 2 together.**
A model may compute a single scope-2 total by adding both. GHG Protocol requires dual reporting — two separate labeled numbers. Fix: `CarbonReport.scope2LocationBasedKgCo2e` and `scope2MarketBasedKgCo2e` are distinct fields; the report generator must never sum them into a single total. Test: assert they are different numbers and both are present in the output.

**Pitfall 4 — Missing the ratchet cross-month memory.**
A model implements the demand charge by looking only at the current month's peak, ignoring the ratchet floor from prior months. Fix: `computeBillingPeriod` accepts `priorPeaksKw`; `ratchetFloorKw = max(priorPeaksKw) * ratchetFraction`; `billedDemandKw = max(peakDemandKw, ratchetFloorKw)`. Test: month 1 spike = 100 kW; month 2 natural peak = 50 kW; ratchet (80%) = 80 kW → `billedDemandKw` for month 2 must be 80, not 50.

**Pitfall 5 — Claiming savings below the statistical uncertainty floor.**
A model may report a 2% savings as a confident number even when CV(RMSE) is 12% (FSU > 50%). Fix: compute `FSU = 1.26 * cvRmse / (avoidedKwh / adjustedBaselineKwh)`; if `FSU > 0.50`, set `savingsClaimKwh = null` and `isBelowUncertaintyFloor: true`. Never emit a non-null savings claim in this case. Test the fixture where FSU > 0.50 explicitly.

**Pitfall 6 — Optimizer mutating the activity log or billing ledger.**
A model may call `activityLog.append(shiftedDatum)` inside the optimizer to "apply" the proposed schedule. The optimizer must be pure — it returns a proposal, never modifies the ledger. Fix: the optimizer creates a local copy of the readings for its calculations and returns the proposal; it never calls any external state-mutating function. Test: call `runOptimizer`, then check that `activityLog.getAll().length` is the same before and after.

**Pitfall 7 — Using location-based factors for the market-based EAC path.**
A model may apply the location-based grid factor to all consumption, then subtract an EAC-based credit. EAC-covered MWh should have a zero (or near-zero supplier-specific) emission factor in the market-based path, not the location-based factor minus a credit. Fix: for EAC-covered MWh, `kgCo2e = 0` (or the supplier-specific rate). Remaining MWh uses the `scope2_residual_mix` factor, not the location-based factor. Test: 1000 kWh consumed, 1000 kWh EAC → market-based CO₂e = 0; 1000 kWh consumed, 500 kWh EAC → market-based = 500 × residual-mix-factor.

**Pitfall 8 — Reporting a single blended "carbon + cost" objective from the optimizer.**
A model may compute `score = costDelta + carbonDelta * somePricePerTonne` and optimize that single blended score. This hides the tradeoff and produces greenwashing output. Fix: compute cost-optimal and carbon-optimal separately; if they differ, set `tradeoffNote` explaining the conflict and include both `projectedCostDelta` and `projectedCarbonDeltaKgCo2e` in the output.

**Pitfall 9 — OLS regression implementation bugs (normal equations).**
A 3B model implementing `(X'X)⁻¹X'y` may forget the intercept column (column of 1s), produce an ill-conditioned matrix for near-collinear variables, or divide-by-zero on small datasets. Fix: always include the intercept (constant 1) as the first column of X; if the matrix is singular (determinant ≈ 0), fall back to setting all coefficients to zero and setting `cvRmse = 1.0`, `meetsAshrae14 = false`. Test: known linear data (y = 2*x1 + 3*x2 + 5) → coefficients must match exactly.

**Pitfall 10 — Certificate retire-once silently broken by shared registry state.**
A model may create a new `CertificateRegistry` inside each test, making the retire-once check irrelevant (a fresh registry has no history). Fix: the retire-once test must use a *single* registry across two `retire()` calls for the same certificate. Test: `registry.retire(cert)` succeeds; calling `registry.retire(cert)` again with the same `certId` throws an error.
