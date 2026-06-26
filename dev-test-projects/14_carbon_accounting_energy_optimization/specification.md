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
