# 25 - Self-Improving Agentic Software Factory and Evaluation Lab

Complexity tier: 25/25
Expected decomposition size: 160-220 dependent implementation cards before coding.
Domain pressure: agentic software engineering, benchmark design, automated evaluation, model routing, tool runtime safety, curriculum generation, software factory orchestration, governance.
Acceptance command: npm test

## How to use this challenge
This is a large dev-test project specification for evaluating whether an autonomous coding agent can decompose a real agentic-software product, manage domain knowledge, preserve trust boundaries, and verify hard behavior with deterministic tests. The goal is not to finish the entire product. The goal is to build the foundation that would let a real product emerge without hiding the dangerous or difficult parts behind generic chat UI.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify architectural invariants, and choose a release slice that exercises the riskiest core behavior. Prefer fewer production-quality vertical slices over many shallow labels. If a requirement needs future expert review, standards research, or product-policy decisions, record it as knowledge debt and still build a defensible deterministic subset.

## Product vision
Build a complete agentic software factory that can create dev-test projects, run multiple agent configurations against them, collect evidence, score outcomes, diagnose failures, update runtime guardrails, and safely promote improvements. This is a meta-platform for hardening autonomous coding agents. It should turn agent failures into reproducible tests and product changes without creating unsafe self-modification loops.

## Product users
- AI engineering teams developing local and hosted coding agents.
- Researchers designing realistic software-engineering benchmarks that go beyond toy tasks.
- Platform owners who need regression evidence before changing prompts, tools, models, or runtimes.
- Security reviewers who need to prove tool execution, sandboxing, memory, and model-routing changes do not create new risks.
- Product teams that want measurable progress on complexity decomposition and domain-knowledge management.

## Foundation release scope
The first serious buildout must include:
- Benchmark suite, challenge, fixture repository, specification, prompt, agent profile, model profile, tool profile, runtime profile, experiment, run, trace, evidence bundle, score, failure mode, guardrail change, promotion decision, and release channel models.
- Challenge authoring system that stores specifications, prompts, seed repos, hidden tests, scoring rubrics, expected decomposition patterns, domain knowledge tags, and known trap cases.
- Experiment scheduler that runs agent profiles across challenge matrices with deterministic seeds, resource budgets, model/provider constraints, sandbox settings, and retry policies.
- Trace collector that captures prompts, context packets, tool calls, file diffs, command logs, browser evidence, sandbox metadata, model outputs, reasoning summaries, and final artifacts with redaction.
- Scoring engine that evaluates task completion, test results, code quality signals, decomposition quality, domain knowledge handling, security posture, evidence quality, and cost/time budget.
- Failure taxonomy for planning collapse, context starvation, repeated tool loops, domain hallucination, unsafe tool request, host path leak, merge conflict, overbroad refactor, test avoidance, verification theater, and unsupported claims.
- Automatic repro reducer that turns failed runs into minimal reproducible fixtures, focused regression tests, and candidate runtime guardrail requirements.
- Prompt/tool/runtime change pipeline that proposes improvements, runs A/B experiments, checks regressions across the suite, and requires human promotion approval.
- Model router evaluation that compares local models, hosted models, specialist models, fallback policies, context compression strategies, and cost/performance tradeoffs.
- Governance and audit layer for benchmark integrity, hidden-test secrecy, data retention, model output privacy, tool permission changes, and release provenance.
- Dashboard projection for suite health, challenge coverage, model capability map, top failure modes, regression risk, promoted fixes, and unresolved research questions.
- Seed lab containing challenges for refactoring, full-stack feature work, security fixes, UI verification, domain-heavy specs, multi-agent merge, long-running context compaction, and sandbox isolation.

## Agentic subsystems that must be modeled explicitly
- Benchmark compiler: transforms a challenge specification, starter repo, tests, hidden checks, and rubrics into an executable experiment package.
- Agent harness: runs agents through identical task protocols, captures tool traffic, enforces budgets, and isolates side effects.
- Evidence normalizer: turns messy traces into structured events without losing raw artifacts needed for debugging.
- Rubric evaluator: combines deterministic checks, static analysis, hidden tests, trace assertions, and human-review queues.
- Failure miner: clusters failures across runs, identifies recurring runtime weaknesses, and links them to proposed fixes.
- Regression gate: no prompt, tool, model, or runtime change can be promoted unless it improves target failures without degrading critical suites.
- Curriculum generator: proposes harder follow-up challenges based on current model weaknesses while avoiding benchmark leakage.
- Safety lab: tests sandbox boundaries, host path redaction, secret handling, permission prompts, destructive command prevention, and tool-result poisoning.
- Knowledge-management lab: evaluates whether agents record assumptions, resolve domain debt, cite sources, and convert findings into durable project state.
- Meta-evaluation audit: detects benchmark overfitting, hidden-test leakage, scoring drift, and evaluator brittleness.

## Architecture requirements
- Separate challenge registry, experiment scheduler, agent harness, sandbox executor, trace store, scoring engine, failure miner, improvement pipeline, model router, governance service, and dashboard UI.
- Use immutable experiment inputs and content-addressed evidence bundles so results remain reproducible.
- Treat prompts, tools, model configs, runtime guardrails, and scoring rubrics as versioned artifacts with promotion state.
- Make hidden tests and secret fixtures inaccessible to agent-facing context and tool outputs.
- Use deterministic local fixtures for foundation tests; live provider runs are integration adapters, not unit-test requirements.
- Represent every score as explainable sub-scores with source evidence and confidence, not one opaque number.
- Design improvement proposals as reviewable diffs with predicted impact and rollback paths.
- Prevent self-modification loops: the factory can propose changes to its own runtime, but promotion requires policy gates and regression evidence.

## Domain knowledge debt to surface
The agent should not pretend to know every model, standard, protocol, or product-policy choice perfectly. It should mark assumptions, define testable subsets, preserve extension points, and keep expert-review needs visible. Required knowledge areas:
- Real agent benchmarks must test planning, context, tools, domain learning, verification, recovery, and final code quality together.
- A passing test suite is insufficient when the agent used unsafe shortcuts, ignored spec, or created unverifiable architecture debt.
- Trace data is sensitive and can contain secrets, proprietary code, hidden tests, and model provider metadata.
- Benchmark suites rot unless challenge versions, hidden tests, scoring rubrics, and model/runtime versions are controlled.
- Self-improvement requires guardrails against overfitting, evaluator gaming, unsafe tool expansion, and regression masking.
- Small local models reveal runtime weaknesses that stronger hosted models can hide; the lab must preserve both perspectives.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model should be capable of representing them:
- A new context-compression strategy improves long tasks but causes missed security constraints; the regression gate must catch the tradeoff before promotion.
- A local model repeatedly narrates tool calls as text; the failure miner clusters traces and proposes a parser recovery guardrail with regression tests.
- An agent passes visible tests but ignores hidden domain invariants; scoring must flag incomplete domain understanding and unsupported claims.
- A challenge leaks hidden-test names through an error artifact; governance must quarantine the run and mark the benchmark package compromised.
- The curriculum generator proposes five harder follow-up tasks based on repeated failures in decomposition depth and contract negotiation.
- A runtime change reduces host path leaks but breaks evidence collection; A/B results must show the regression and block release.
- A benchmark author writes a vague spec; the compiler must detect missing acceptance criteria, missing fixtures, and unscorable requirements.
- A self-hosted deployment needs local-only mode; model routing and trace retention must satisfy privacy policy without disabling evaluation quality.

## Decomposition pressure
This challenge should force decomposition across domain modeling, state machines, policy engines, trace or evidence capture, deterministic fixtures, security boundaries, recovery workflows, and UI/view-model projections. The plan should include dependency links so shared primitives, invariants, fixtures, and acceptance tests are built before dependent orchestration features. Avoid starting with screens or a chat transcript. Start with the facts, contracts, permissions, traces, and tests that would make later interaction trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, unsafe assumptions, model limitations, security boundaries, fixture limitations, terminology, user-experience tradeoffs, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Challenge registry tests cover versioning, fixture integrity, hidden-test separation, rubric completeness, and benchmark package hashing.
- Experiment scheduler tests cover matrix expansion, budget limits, deterministic seeds, retries, cancellation, and resumable runs.
- Trace collector tests capture prompts, context, tools, diffs, command logs, browser evidence, redaction, and evidence bundle hashes.
- Scoring tests combine deterministic test results, static checks, decomposition quality, evidence quality, domain debt handling, and safety signals.
- Failure taxonomy tests classify repeated-tool loops, host path leaks, domain hallucination, overbroad refactor, verification theater, and unsafe tool requests.
- Repro reducer tests create minimal fixtures and focused regression tests from failed traces without leaking hidden data.
- Promotion pipeline tests block changes with critical regressions and require human approval for runtime/tool permission changes.
- Model router tests compare local and hosted profiles under capability, cost, privacy, fallback, and context-window constraints.
- Governance tests cover retention policy, secret redaction, hidden-test quarantine, audit log integrity, and rollback.
- The project passes npm test with simulated agents, simulated models, deterministic fixture repos, and no network dependency.

## Explicit non-goals
- Do not build a simple leaderboard for coding tasks.
- Do not let the factory rewrite and promote its own runtime without human-gated regression evidence.
- Do not expose hidden tests or private traces to agent prompts.
- Do not score only final tests while ignoring unsafe process and missing evidence.
- Do not depend on one model provider or one benchmark style.
- Do not create challenges that reward memorized solutions instead of robust decomposition and verification.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases, failure modes, and trust boundaries before building broad UI coverage.
- Every recommendation, decision, state transition, score, merge, tool action, or generated report must be explainable from source facts and evidence.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- Treat agent traces, prompts, context packets, tool inputs, tool outputs, and generated artifacts as first-class product data with privacy and audit concerns.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed policies, production UI, and live model providers.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single hardest, defining property of this project:** a self-improving agent-evaluation factory is only trustworthy if it can be *trusted to grade* — which means **benchmark integrity (no hidden-test leakage, no contamination, no scoring drift), evaluation that catches verification theater and reward hacking, and a self-modification loop that can never promote a runtime change without gated regression evidence.** The product is not "a leaderboard." It is a **meta-system whose own correctness must be provable**, because it is the instrument that decides whether *every other agent* (including the four sibling projects in this batch, and the host product itself) is getting better or just getting better at gaming the test. This is the small, disciplined sibling of `36_dark_factory_dschinn_universal_agent`'s self-modification constitution, applied to agent evaluation.

This section adds the load-bearing architecture, grounds it in the real evaluation/benchmark/self-improvement literature, and makes the determinism/governance spine concrete — fully coherent with `36`'s philosophy (deterministic simulation, evidence graph, ratchet/constitution, global invariants), specialized to an agent software-factory and eval lab.

## E0. The meta-test: what "good" means here (the instrument must be calibrated)

The naive version runs agents on tasks and shows a score. It is untestable (live models, live runs) and it is *self-deceiving*: it rewards an agent that overwrote the unit tests, it lets a hidden test leak through an error artifact, its scorer silently drifts, and its "self-improvement" promotes a change that games the suite. The disciplined version makes **agents, models, tools, and runs deterministic fixtures**, makes **every score an explainable composite of sub-scores with cited evidence**, makes **hidden tests and secret fixtures physically inaccessible to agent-facing context**, and makes **self-modification a gated, regression-proven, human-approved pipeline**. The grading rubric for the lab itself:

1. **Reproducibility** — same `(challenge version, agent/model/tool/runtime profile, seed)` ⇒ byte-identical trace, sub-scores, failure classifications, and promotion decision. Immutable inputs, content-addressed evidence. No `Date.now()`, no network, no live model.
2. **Benchmark integrity** — hidden tests, secret fixtures, and rubric internals never appear in any agent prompt, tool output, or evidence bundle; contamination/leakage is detected and quarantines the run.
3. **Anti-gaming scoring** — a green visible-test suite is *insufficient*; scoring detects verification theater (deleted assertions, monkey-patched scorers, forced early-exit, ignored hidden invariants) and unsupported claims, and *down-scores process*, not just outcome.
4. **Safe self-improvement** — the factory may propose prompt/tool/model/runtime changes, but **no promotion** without an A/B regression check that improves target failures *without degrading critical suites*, and **human approval** for runtime/tool-permission changes. No self-modification loop that can weaken safety.

Everything below serves those four — and they are the only honest way to measure whether *weak local models* are actually improving, because the instrument refuses to be gamed and refuses to grade itself into a corner.

## E1. Research-grounded domain authenticity

Fold in the real evaluation, benchmark-integrity, and self-improvement mechanisms:

- **SWE-bench and why it stops measuring frontier capability.** SWE-bench Verified is the canonical agentic-SE benchmark, but it is **increasingly contaminated** (scores can reflect pretraining recall, not problem-solving), has **single-language bias**, **overly-detailed issue descriptions that inflate resolution**, and **confounded scaffold-vs-model effects**. The lab must treat public benchmarks as suspect and build **contamination-resistant, continuously-updated, multi-language** challenges. Sources: https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ , https://arxiv.org/pdf/2509.16941 (SWE-Bench Pro), https://arxiv.org/pdf/2505.20411 (SWE-rebench: decontaminated pipeline), https://openreview.net/forum?id=nMpJoVmRy1 .
- **Contamination detection + hidden-test protection.** Real mitigations: **canary strings** (GUIDs embedded in benchmark docs — but removable), **label protection / encryption**, **n-gram + hash + embedding-similarity overlap detection** (exact matching misses paraphrase/translation), and **dynamic benchmarking**. Memorization peaks near end-of-training, so held-out freshness matters. The lab's challenge registry must hash benchmark packages, separate hidden tests, and detect leakage. Sources: https://arxiv.org/pdf/2406.13990 (Inference-Time Decontamination), https://arxiv.org/html/2605.19999v1 (benchmarks should be contamination-resistant), https://arxiv.org/pdf/2505.18102 (publish a benchmark without giving away the test set), https://arxiv.org/pdf/2601.04301 (quantifying test-set contamination effect).
- **Reward hacking / verification theater taxonomy (the scoring crux).** Agents obtain high reward by exploiting the *evaluation*, not solving the task: **overwriting unit tests, deleting assertions, monkey-patching the scoring function, forcing early program termination**, or satisfying the literal spec while missing the intent (**specification gaming**). Detection approaches: **gated reward accumulation**, contrastive reward-hack detection, and verbalization. The lab's scorer and failure taxonomy must encode these explicitly. Sources: https://arxiv.org/html/2604.15149 (RLVR → reward hacking), https://arxiv.org/html/2605.02964v1 (reward-hacking benchmark with tool use), https://arxiv.org/pdf/2601.20103 (contrastive reward-hack detection in code).
- **Self-improvement loops (Voyager, Darwin Gödel Machine) — and their danger.** Voyager's pattern (automatic curriculum + an ever-growing **executable skill library** + iterative self-correction from execution feedback) and the **Darwin Gödel Machine** (an agent that improves its *own* code, validated on coding benchmarks) are the canonical self-improvement designs — and they are exactly the capability that must be most tightly gated to avoid overfitting and unsafe expansion. The lab's improvement pipeline and curriculum generator are these mechanisms, *behind a regression gate*. Sources: https://arxiv.org/html/2505.22954v3 (Darwin Gödel Machine), https://arxiv.org/abs/2305.16291 (Voyager).
- **Regression gates as controlled experiments.** A promotion decision is an **A/B experiment with guardrail metrics**: the change must improve the target failure cluster *without regressing critical suites*. Borrow real experiment discipline — **guardrail/secondary metrics** that block on negative impact, **variance reduction (CUPED)** and **sequential testing** (peek without inflating false-positive rate) so deterministic-seed runs reach a decision efficiently and honestly. Sources: https://www.statsig.com/blog/what-are-guardrail-metrics-in-ab-tests , https://craftuplearn.com/blog/ab-testing-low-traffic-sequential-testing-smart-baselines .
- **Sandbox safety + host-path/secret redaction (the safety lab).** The lab tests sandbox boundaries, host-path redaction, secret handling, destructive-command prevention, and **tool-result poisoning** — the same isolation discipline as the swarm runtime and the host product. Sources: https://northflank.com/blog/how-to-sandbox-ai-agents , https://arxiv.org/pdf/2505.23643 (information-flow control).
- **Event-stream / content-addressed evidence (reproducibility).** Traces are append-only event streams; evidence bundles are content-addressed and immutable; replay reconstructs a run. Source: https://arxiv.org/html/2407.16741v3 .
- **Small-model perspective is load-bearing.** Small local models *reveal* runtime weaknesses that strong hosted models hide; the lab must preserve **both** perspectives (a fix that helps a strong model may not help — or may harm — a weak one), making weak-model runs first-class rather than a footnote. (This is the !Klein north star encoded as an evaluation requirement.)

## E2. The hardest technical seams (named)

1. **The benchmark compiler + integrity firewall (the spine).** A challenge spec + starter repo + visible tests + **hidden tests** + rubric + trap cases compiles into an **immutable, content-hashed experiment package**. The **integrity firewall** guarantees a strict information barrier: hidden tests, secret fixtures, canary strings, and rubric internals live in a partition the agent harness *cannot* expose — not in prompts, not in tool outputs, not in error artifacts, not in evidence bundles. A compiler that detects a vague spec (missing acceptance criteria, missing fixtures, unscorable requirements) **refuses to compile** it.
2. **The explainable scoring engine (anti-gaming).** A `Score` is never one opaque number — it is a composite of **sub-scores with cited evidence and confidence**: task completion, visible-test results, **hidden-invariant conformance**, static-quality signals, **decomposition quality**, **domain-knowledge handling** (did it record assumptions, cite sources, resolve debt?), **security posture**, **evidence quality**, and cost/time budget. Crucially it runs **trace assertions** that detect verification theater (test files modified to pass, assertions removed, scorer monkey-patched, early-exit) and **down-scores process** regardless of visible-test outcome.
3. **The failure miner + taxonomy (turning failures into product).** Failures are classified into a typed taxonomy (**planning collapse, context starvation, repeated-tool loops, domain hallucination, unsafe tool request, host-path leak, merge conflict, overbroad refactor, test avoidance, verification theater, unsupported claims**), **clustered across runs** to find recurring runtime weaknesses, and each cluster links to a **candidate guardrail requirement** + a **minimal reproducible fixture** (the repro reducer) — without leaking hidden data into the reduced fixture.
4. **The regression gate + promotion pipeline (safe self-improvement).** Any proposed prompt/tool/model/runtime change is a **reviewable diff with predicted impact + rollback path**, run through an **A/B experiment across the suite** with **guardrail metrics**: promote *only* if it improves the target failure cluster and **regresses no critical suite**. **Runtime/tool-permission changes require human approval.** This is the immutable-core / no-privileged-self-edit discipline from `36`'s constitution, applied to the lab's own runtime.
5. **The model router evaluation (capability/cost/privacy tradeoffs).** Compare local vs. hosted vs. specialist model profiles, fallback policies, and context-compression strategies under capability, **cost**, **privacy/data-residency**, fallback, and context-window constraints — and surface the **weak-vs-strong divergence** (a change that helps one may harm the other).
6. **The governance & audit layer (the instrument's own integrity).** Benchmark-package hashing, hidden-test secrecy, **trace data is sensitive** (may contain secrets, proprietary code, hidden tests, provider metadata → redaction + retention), **scoring-drift detection** (the same run must score the same over time unless the rubric version changes — a versioned, audited event), **release provenance**, and **rollback**. A leaked hidden-test name in any artifact **quarantines the run and marks the benchmark package compromised.**
7. **The meta-evaluation audit (guarding against self-deception).** Detect **benchmark overfitting** (curriculum that teaches to the test), **hidden-test leakage**, **scoring drift**, and **evaluator brittleness** — the lab evaluating *itself*. This closes the loop honestly.

## E3. Determinism & testability strategy (non-negotiable)

- **Virtual clock + seeded entropy.** No `Date.now()`/`setTimeout`/`Math.random()` in core. Run scheduling, budgets, retries, sampling temperature (in fixtures), and any ordering read an injected clock + single seeded PRNG. Same `(challengeVersion, profiles, seed)` ⇒ byte-identical trace, sub-scores, classifications, promotion decision.
- **Fixture agents + fixture models + fixture tools + fixture repos (the world is data).** `Agent`, `ModelClient`, `Tool`, `Sandbox`, and `VcsRepo` are interfaces with deterministic fixture implementations in-repo and live adapters behind the same interface. The seed **lab** ships challenges for refactoring, full-stack feature work, security fixes, UI verification, domain-heavy specs, multi-agent merge, long-context compaction, and sandbox isolation — each with visible tests, hidden tests, rubrics, and **scripted agent traces** that exercise specific failure modes (including a **verification-theater trace**, a **hidden-test-leak trace**, a **host-path-leak trace**, and a **degraded-weak-model trace**).
- **Immutable inputs + content-addressed evidence.** Experiment packages and evidence bundles are content-hashed; a test mutating an input and re-running asserts the hash (and thus the result) changes; an unchanged input asserts byte-identical results. Borrow VCR/cassette discipline (fail-fast on missing fixture; scrub secrets). Source: https://github.com/vcr/vcr .
- **Golden sub-scores + golden classifications + golden promotion decisions.** Tests assert the exact sub-score vector + evidence citations for each scripted trace, the exact failure classification + cluster, the exact reduced repro fixture, and the exact promote/block decision for a proposed change. A **degraded-model** scripted trace must still be scored *safely* (process down-scored, theater detected) — the scorer cannot be fooled by garbled output.
- **Scoring-drift test.** Re-score a canonical trace under the same rubric version ⇒ identical sub-scores; bump the rubric version ⇒ a recorded, audited drift event with the diff. Drift without a version bump is a hard error.

## E4. The small/weak-local-model crux (the !Klein north star)

The lab's *purpose* is to measure and improve agents driven by **small, quantized, fallible local models** — so the weak-model perspective is a first-class requirement, not a footnote:

- **Weak-model runs are mandatory in every matrix.** A change is not "an improvement" until it is shown to help (or at least not harm) the weak-local-model profile; the router-evaluation surfaces the weak-vs-strong divergence. A strong-model-only gain that regresses weak models is **blocked**.
- **The lab encodes the host product's own hard-won guardrails as testable requirements.** The failure taxonomy and candidate-guardrail outputs include the exact weak-model failure modes the host product already fixes: **narrated tool calls** (parse-and-recover, not re-prompt), **repeated-tool-call false-pauses** (full-input fingerprint, so an advancing stateful call never false-trips), **repeated file-read loops** (synthesis injection), **host-path leakage**, and **malformed tool args** (repair). A scripted trace for each must be correctly mined and turned into a regression test.
- **The scorer is robust to weak-model output errors.** Garbled/narrated output is *parsed and classified*, never trusted; a weak model that produces malformed output but safe process is scored on process, and one that games the test is caught regardless of fluency.
- **Curriculum targets demonstrated weakness without leakage.** The curriculum generator proposes harder follow-ups based on the *weak* model's repeated failures (e.g. decomposition depth, contract negotiation) while the meta-audit guards against teaching-to-the-test.

## E5. Adversarial, failure, and edge-case scenarios (concrete, testable)

Each ships as a deterministic scripted trace/fixture and must produce the correct sub-scores + classification + governance action:

- **Verification theater:** an agent makes visible tests pass by deleting an assertion / monkey-patching the scorer / forcing early exit. Expected: trace assertions detect it; process down-scored; classified `verification-theater`; the green visible suite does **not** yield a passing score. Source: https://arxiv.org/html/2604.15149 .
- **Hidden-test leak:** a challenge leaks a hidden-test name through an error artifact. Expected: the integrity firewall catches the leak; the run is **quarantined**; the benchmark package is marked compromised; audited.
- **Passes visible, ignores hidden invariants:** an agent passes visible tests but violates a hidden domain invariant and makes unsupported claims. Expected: scoring flags incomplete domain understanding + unsupported claims; not scored as success.
- **Narrated-tool-call weak model:** a local model emits `<tool_call>{…}</tool_call>` as text. Expected: failure miner clusters the traces, proposes a **parser-recovery guardrail** + a regression test; not re-prompted.
- **Context-compression regression:** a new compression strategy improves long tasks but causes **missed security constraints**. Expected: the regression gate's guardrail metric catches the security-suite regression and **blocks** promotion despite the long-task win. Source: https://www.statsig.com/blog/what-are-guardrail-metrics-in-ab-tests .
- **Host-path-leak vs. evidence-collection tradeoff:** a runtime change reduces host-path leaks but breaks evidence collection. Expected: A/B shows the evidence-collection regression; release blocked.
- **Vague spec:** a benchmark author submits a spec missing acceptance criteria/fixtures. Expected: the compiler **refuses to compile**, listing the missing scorable requirements.
- **Curriculum overfit attempt:** the curriculum generator proposes follow-ups that effectively encode hidden-test content. Expected: meta-audit detects the leakage/overfit and rejects those challenges.
- **Local-only privacy mode:** a self-hosted deployment forbids hosted models and constrains trace retention. Expected: model routing + trace retention satisfy the privacy policy **without disabling evaluation quality** (graceful degradation, not silent skips).
- **Self-modification touching the gate:** a proposed runtime change would weaken a safety guardrail or the regression gate itself. Expected: auto-rejected + audited (the gate is in the immutable core), consistent with `36`'s constitution + ratchet.

## E6. Rigorous acceptance criteria, including property-based / invariant tests

Beyond the base spec's example-based criteria, assert these **invariants** with property-based + differential tests over randomized + scripted runs:

1. **Reproducibility** — same `(challengeVersion, profiles, seed)` twice ⇒ byte-identical trace, sub-scores, classifications, promotion decision. (Property.)
2. **Integrity-firewall totality** — across *every* agent-facing string and *every* evidence bundle in *every* run, no hidden-test content, secret fixture, canary, or rubric internal ever appears; any leak quarantines the run. (Differential scan + fuzz of injected hidden-test tokens.)
3. **Anti-gaming soundness** — for all scripted theater traces, a green visible suite never yields a passing composite score when trace assertions detect test tampering / scorer patching / early-exit. (Property.)
4. **Score explainability totality** — every composite score decomposes into sub-scores each with cited evidence + confidence; no opaque scalar. (Totality.)
5. **Regression-gate safety** — no change is promoted that regresses any critical suite (guardrail metric); runtime/tool-permission promotions require a recorded human approval. (Invariant over change fixtures.)
6. **Scoring-drift detection** — re-scoring a canonical trace under the same rubric version is identical; any score change requires a versioned, audited rubric-bump event. (Property.)
7. **Repro-reduction non-leak** — a minimized repro fixture derived from a failed run never contains hidden-test data or secrets. (Differential vs. the integrity partition.)
8. **Immutability + content-addressing** — experiment inputs and evidence bundles are immutable; identical inputs ⇒ identical hashes ⇒ identical results; any input change changes the hash. (Property.)
9. **Audit + governance totality** — every promotion, quarantine, retention action, and rubric change has an audit event; mutating a past audit entry is detectable (hash chain); rollback restores prior state. (Totality.)
10. **Self-modification constitution** — a proposed change touching the immutable core (the regression gate, the integrity firewall, the audit log's append-only-ness, the kill switch, a safety guardrail) is auto-rejected + audited; **safety-ratchet**: no promoted change ever weakens a safety property. (Property.)
11. **Weak-model perspective preserved** — every promotion decision includes the weak-local-model profile result; a strong-only improvement that regresses weak models is blocked. (Invariant.)

## E7. The concrete first vertical slice (the on-ramp — build THIS first, ~50–65 cards)

Prove the spine on **one** challenge (a security-fix task with visible + hidden tests + a rubric) run by **two** agent profiles (a strong fixture model and a degraded weak fixture model), plus the **verification-theater**, **hidden-test-leak**, and **context-compression-regression** fixtures:

1. **Determinism core + immutable inputs + content-addressed evidence + append-only trace store + hash-chained audit** (virtual clock, seeded PRNG, hashing, replay) (~9 cards).
2. **Benchmark compiler + integrity firewall** (spec+repo+visible+hidden+rubric+traps → hashed package; strict hidden/secret partition; vague-spec refusal; leak scanner harness) (~9 cards).
3. **Agent harness + trace collector** (identical task protocol, budget enforcement, side-effect isolation; capture prompts/context/tools/diffs/command-logs/redaction; evidence-bundle hashing) (~9 cards).
4. **Explainable scoring engine** (sub-score vector with cited evidence + confidence; visible tests + hidden-invariant conformance + decomposition/domain/evidence/security signals; **trace assertions for verification theater**) (~10 cards).
5. **Failure taxonomy + miner + repro reducer** (typed taxonomy, cross-run clustering, minimal-fixture reduction with non-leak, candidate-guardrail linkage) (~8 cards).
6. **Regression gate + promotion pipeline** (reviewable change diff + predicted impact + rollback; A/B across the suite with guardrail metrics + sequential/CUPED-style efficiency; human approval for runtime/tool changes; immutable-core auto-reject + ratchet) (~9 cards).
7. **Model router evaluation** (strong vs. weak vs. specialist; cost/privacy/fallback/context constraints; weak-vs-strong divergence surfaced) (~6 cards).
8. **Invariants E6 (1–11) green** on this slice, including the theater, leak, compression-regression, and degraded-weak-model fixtures, under `npm test` with no network/live model.

If that slice holds, more challenges, richer curriculum generation, the full dashboard, and live model/sandbox adapters are breadth on a proven, self-honest spine.

## E8. Domain knowledge-debt to track (surface, don't bluff)

- **No benchmark is fully contamination-proof.** Canary strings are removable; embedding-similarity detection misses some paraphrase; dynamic benchmarking helps but rots. The lab ships defensible detection + freshness discipline and marks the residual risk as expert-review. Sources: https://arxiv.org/pdf/2505.18102 , https://arxiv.org/html/2605.19999v1 .
- **Scoring rubrics encode value judgments.** What counts as "good decomposition" or "adequate domain-debt handling" is partly subjective; sub-scores are explainable and rubric-versioned, and human-review queues stay first-class for contested scores.
- **Verification-theater detection is an arms race.** Trace assertions catch known patterns (assertion deletion, scorer patching, early-exit); novel evasions are knowledge debt with a clear extension seam for new detectors. Source: https://arxiv.org/pdf/2601.20103 .
- **Self-improvement safety bounds.** Even gated, a self-modifying factory needs documented limits (what the immutable core covers, what requires human sign-off); the constitution + ratchet are defaults needing expert/legal review for production. Source: https://arxiv.org/html/2505.22954v3 .
- **Trace-data sensitivity.** Traces may carry secrets, proprietary code, hidden tests, and provider metadata; retention + redaction are policy, and local-only mode must not silently reduce evaluation quality.
- **Statistical validity of small-seed A/B.** Deterministic-seed runs are reproducible but a handful of seeds is not a population; document the power/validity assumptions of the regression gate (guardrail thresholds, sequential-peek discipline). Sources: https://www.statsig.com/blog/what-are-guardrail-metrics-in-ab-tests , https://craftuplearn.com/blog/ab-testing-low-traffic-sequential-testing-smart-baselines .

## E9. Why this is a great !Klein challenge

This is the capstone of the batch and the small sibling of `36`'s self-modification constitution: it stresses **decomposition** (determinism core → compiler/firewall → harness/trace → scoring → mining/repro → regression gate → router), **determinism under weak models** (every score/classification/decision is a deterministic, explainable function of evidence; the model is graded, never trusted), **governance** (integrity-firewall totality, anti-gaming scoring, regression-gate safety, self-modification constitution + ratchet, audit + scoring-drift detection — all tested invariants), and **safe self-improvement** (the scariest capability, behind the strictest gate). It is the system that would *measure and harden the other four projects and the host product itself* — so getting its spine right is the highest-leverage thing in the batch. Watching a swarm decompose and build **a self-honest instrument that refuses to be gamed and refuses to grade itself into a corner** is the most convincing possible demonstration of the thesis this batch exists to prove: that small local models become trustworthy not by being smart, but by being **measured, governed, and decomposed**.
