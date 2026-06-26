# 24 - Agentic Swarm IDE and Distributed Runtime

Complexity tier: 24/25
Expected decomposition size: 125-150 dependent implementation cards before coding.
Domain pressure: multi-agent coding, distributed task orchestration, sandboxing, repository isolation, merge arbitration, model routing, evidence collection, live verification.
Acceptance command: npm test

## How to use this challenge
This is a large dev-test project specification for evaluating whether an autonomous coding agent can decompose a real agentic-software product, manage domain knowledge, preserve trust boundaries, and verify hard behavior with deterministic tests. The goal is not to finish the entire product. The goal is to build the foundation that would let a real product emerge without hiding the dangerous or difficult parts behind generic chat UI.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify architectural invariants, and choose a release slice that exercises the riskiest core behavior. Prefer fewer production-quality vertical slices over many shallow labels. If a requirement needs future expert review, standards research, or product-policy decisions, record it as knowledge debt and still build a defensible deterministic subset.

## Product vision
Build a swarm-oriented agentic IDE where multiple specialized coding agents can decompose a large engineering goal, work in isolated sandboxes, share evidence, negotiate interfaces, merge results, and recover from failed branches. This should be a real product foundation for autonomous software work, with strong boundaries around trust, concurrency, and verification.

## Product users
- Engineering teams that want several agents working on related tasks without corrupting the main workspace.
- Maintainers who need visibility into branch state, evidence, merge risks, and verification quality.
- Developers using small local models that need decomposition, context routing, and recovery support.
- Platform teams that need sandbox isolation, model/provider management, and policy-driven autonomy.

## Foundation release scope
The first serious buildout must include:
- Workspace, goal, decomposition graph, task card, agent profile, model profile, sandbox, branch, patch, interface contract, evidence bundle, merge candidate, verification run, conflict, and decision models.
- Hierarchical decomposition engine that turns a goal into planning, research, interface design, implementation, verification, and integration cards with dependencies and risk labels.
- Agent role system for architect, domain researcher, implementer, test author, reviewer, integrator, security reviewer, and release verifier, each with scoped tools and context policies.
- Sandbox manager abstraction for per-task workspaces, command execution, file reads, patch capture, artifact capture, resource limits, and teardown evidence.
- Context router that gives each agent only relevant files, contracts, prior decisions, tool results, and domain notes while preventing unrelated workspace leakage.
- Interface contract board where agents publish expected APIs, data shapes, migration contracts, test fixtures, and ownership before implementation branches diverge.
- Merge arbitration engine that compares patches, detects overlapping edits, validates contracts, ranks merge candidates, and can request targeted rework.
- Cross-agent memory with provenance, task scope, confidence, expiration, contradiction detection, and promotion to project-level knowledge only after review.
- Verification matrix that maps each task to unit tests, type checks, lint, integration tests, UI checks, sandbox evidence, and unresolved risk.
- Swarm telemetry UI projection for task graph, running agents, blocked tasks, repeated-tool loops, model failures, merge conflicts, verification status, and human decisions.
- Seed monorepo challenge with frontend, backend, runtime service, SDK boundary, failing tests, overlapping files, changing API contract, weak-model malformed tool calls, and one malicious or unsafe tool request fixture.

## Agentic subsystems that must be modeled explicitly
- Decomposition governance: tasks need explicit dependencies, acceptance criteria, ownership, and promotion gates from research to implementation.
- Sandbox trust boundary: agents can operate inside isolated workspaces but cannot see host paths, secrets, or unrelated branches.
- Contract negotiation: agents must publish and consume interface contracts instead of discovering incompatibility only at merge time.
- Merge judge: integration should combine deterministic checks with structured evidence review, not blindly accept the largest patch.
- Model capability router: route planning, code editing, review, and summarization to appropriate local or remote model profiles with fallback behavior.
- Loop and failure recovery: detect repeated reads, repeated tool calls, hallucinated files, bad patches, and failed commands, then redirect or quarantine work.
- Evidence promotion: local task findings can become project knowledge only with source, scope, confidence, and reviewer decision.
- Autonomy policy: each goal can define allowed tools, approval points, max parallelism, verification requirements, and stop conditions.

## Architecture requirements
- Separate orchestration graph, agent runtime, sandbox runtime, context router, memory service, contract registry, merge engine, verification runner, model router, and UI state projection.
- Use event-sourced task and agent state so swarm runs can be replayed and audited.
- Represent patches and merge candidates structurally with file hashes, base commits, touched symbols, test evidence, and conflict metadata.
- Never allow agent-facing prompts, tool outputs, or evidence to leak host filesystem paths or secret values.
- Make all long-running operations cancellable and resumable without losing branch evidence.
- Design for local-model weakness: malformed tool calls, repeated file reads, poor planning granularity, and incomplete domain understanding are expected failure modes.

## Domain knowledge debt to surface
The agent should not pretend to know every model, standard, protocol, or product-policy choice perfectly. It should mark assumptions, define testable subsets, preserve extension points, and keep expert-review needs visible. Required knowledge areas:
- Multi-agent coding is mostly coordination, isolation, and evidence management, not just launching many chats.
- Parallel branches create interface drift unless contracts are explicit and tested early.
- Sandboxes are security and correctness boundaries; host leakage changes agent behavior and breaks trust.
- Small local models require runtime guardrails that parse, repair, constrain, and recover instead of relying on perfect instruction following.
- Merge decisions must account for behavior, tests, architecture, and user intent, not just textual conflicts.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model should be capable of representing them:
- The swarm decomposes a feature into API, UI, SDK, tests, and docs; two implementers edit overlapping files and the merge engine must arbitrate safely.
- A small model repeatedly reads the same files and never progresses; loop detection must inject a synthesis or reassign the task.
- One agent proposes an API contract that conflicts with another task; contract negotiation must detect it before implementation merges.
- A sandboxed agent sees a host path in an error fixture; the runtime must redact and recover to workspace-relative paths.
- An implementation passes unit tests but violates an architecture policy; the reviewer role must block integration with evidence.
- A branch produces useful partial work but fails verification; the integrator must salvage safe patches and quarantine risky ones.

## Decomposition pressure
This challenge should force decomposition across domain modeling, state machines, policy engines, trace or evidence capture, deterministic fixtures, security boundaries, recovery workflows, and UI/view-model projections. The plan should include dependency links so shared primitives, invariants, fixtures, and acceptance tests are built before dependent orchestration features. Avoid starting with screens or a chat transcript. Start with the facts, contracts, permissions, traces, and tests that would make later interaction trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, unsafe assumptions, model limitations, security boundaries, fixture limitations, terminology, user-experience tradeoffs, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Decomposition graph tests cover dependencies, promotion gates, blocked tasks, cycles, and risk labels.
- Sandbox tests ensure tool inputs, outputs, errors, prompts, and evidence never expose host paths or secrets.
- Context routing tests prove agents receive relevant scoped context and cannot access unrelated task memory.
- Contract registry tests catch incompatible API/data-shape changes before merge.
- Merge arbitration tests cover non-overlap, textual conflict, semantic contract conflict, partial salvage, and failed verification.
- Loop recovery tests cover repeated reads, repeated tool calls, hallucinated files, malformed tool calls, and command failure spirals.
- Verification matrix tests require green checks and recorded evidence before integration status can become accepted.
- The project passes npm test with all agents, models, sandboxes, and repositories simulated by deterministic fixtures.

## Explicit non-goals
- Do not build a UI that launches several independent chat panels.
- Do not let agents share an uncontrolled working tree.
- Do not merge patches without contract, policy, and verification evidence.
- Do not assume models follow instructions perfectly; runtime recovery is part of the product.
- Do not hide failed branches, partial evidence, or discarded work.

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

> Added 2026-06-26 via deep domain research. **The single hardest, defining property of this project:** a swarm of coding agents is defined not by *running many models* but by **coordination under isolation** — keeping parallel branches from drifting via *explicit, tested interface contracts*, keeping each sandboxed agent's *view of the world host-leak-free*, and merging concurrent work *only* on deterministic contract+verification evidence — all while individual agents are weak local models that emit malformed tool calls and loop. The product is a **deterministic, event-sourced orchestration kernel with hard isolation and evidence-gated merges**. Get the contract board, the sandbox view-boundary, the merge judge, and the loop-recovery right; the rest is breadth.

This section adds the load-bearing architecture, grounds it in real multi-agent/distributed-systems practice, and makes the determinism/governance spine concrete — coherent with the master-challenge philosophy in `36_dark_factory_dschinn_universal_agent` (deterministic simulation, capability/taint model, event sourcing, idempotency-across-failover, global invariants), specialized to a swarm IDE and distributed runtime. It is also the member of this batch closest to the host product (!Klein) itself — sandbox isolation, host-path redaction, contract-then-implement, merge arbitration, weak-model loop recovery — so it should be especially rigorous about those exact seams.

## E0. The meta-test: what "good" means here

The naive version launches several chat panels over a shared working tree. It is untestable (live models, live sandboxes, live FS races) and it *corrupts*: branches drift into incompatible interfaces, an agent sees a host path and starts an alternate-access loop, a weak model thrashes re-reading files, and the merger blindly accepts the largest patch. The disciplined version makes **agents, models, sandboxes, and the repo all deterministic fixtures**, makes the **task/agent state an event-sourced log**, and makes **merges a function of contract + verification evidence, never of patch size or model confidence**. The grading rubric:

1. **Determinism & replay** — same `(seed, goal fixture, agent/model fixtures, fixture repo)` ⇒ identical decomposition graph, branch states, merge decisions, and final integration. Event-sourced, so any swarm run replays bit-for-bit. No `Date.now()`, no network, no live model, no FS race.
2. **Isolation integrity** — no agent-facing prompt, tool input/output, error, or evidence ever exposes a host filesystem path or a secret. Each agent sees only its workspace-relative view and only its scoped context.
3. **Contract-before-divergence** — parallel implementation branches consume/publish typed interface contracts; incompatibilities are caught at the contract board, not at merge time.
4. **Evidence-gated merge** — a patch integrates only with passing deterministic checks (types/tests/lint/contract conformance) *and* structured review evidence; partial work is salvaged or quarantined, never silently dropped.

Everything below serves those four — and they are exactly what makes a *swarm of weak local models* produce trustworthy software: the kernel coordinates, isolates, contracts, and gates; no single model is trusted.

## E1. Research-grounded domain authenticity

Fold in the real mechanisms from multi-agent SE and distributed systems:

- **Structured documents, not dialogue, between agents (MetaGPT).** The decisive lesson from MetaGPT is that agents should communicate via **structured outputs (interface designs, sequence diagrams, schemas)** — "documents containing all necessary information" — rather than chat, encoding **Standard Operating Procedures** so roles (PM → Architect → Engineer → Reviewer → Tester) hand off *typed artifacts*. This is exactly the interface-contract-board model: publish a typed contract before implementing against it. ChatDev's role pipeline (CEO→CPO→CTO→Programmer→Reviewer→Tester→Designer) is the alternative dialogue style; prefer MetaGPT's structured hand-offs for testability. Sources: https://arxiv.org/html/2308.00352v7 , https://github.com/FoundationAgents/MetaGPT .
- **Sandbox isolation taxonomy (containers → gVisor → microVM).** Real agent sandboxing is defense-in-depth: hardened containers for trusted code, **gVisor** (user-space syscall interception) for stronger isolation without a full VM, **Firecracker/Kata microVMs** (dedicated kernel per workload, ~150ms cold start) for the strongest boundary; plus resource limits, network controls, permission scoping, monitoring. Google's **Agent Sandbox** (KubeCon NA 2025, CNCF) provides a declarative API for isolated stateful sandbox pods. The *boundary* matters because **host leakage changes agent behavior** — a leaked host path makes models misdiagnose the sandbox and start alternate-access loops. Sources: https://northflank.com/blog/how-to-sandbox-ai-agents , https://manveerc.substack.com/p/ai-agent-sandboxing-guide .
- **Semantic / entity-level merge, not line merge (Weave).** Git invents **false conflicts** when independent agents edit the same file in non-overlapping ways; entity-level merge (functions/classes via tree-sitter) "only conflicts on actual semantic collisions," reducing false conflicts ~95%. A real semantic conflict (both branches change the same entity incompatibly) must still block. Selecting low-dependency code blocks for concurrent tasks keeps edit-intersection under ~5%. Sources: https://github.com/ataraxy-labs/weave , https://git-scm.com/docs/git-merge .
- **DAG decomposition + critical-path scheduling + idempotency.** The decomposition graph is a DAG; **topological order** respects dependencies, **critical-path** tasks schedule first, and distributed execution is **at-least-once + application-level idempotency** for safe retries. Sources: https://www.systemdesignhandbook.com/guides/design-a-distributed-job-scheduler/ , https://arxiv.org/html/2604.11378v1 (scheduler-theoretic framework for LLM agent execution).
- **Consensus, leases, fencing tokens (distributed runtime correctness).** When the runtime owns task leases across workers/agents, the failure modes are **split-brain** (two owners of one task) and **stale leaseholders** (a paused agent whose lease expired but keeps writing). The textbook fixes: **majority quorum** for ownership, **leases with expiry**, and **monotonic fencing tokens** that downstream state rejects from stale writers. This is precisely how the swarm guarantees "kill an active agent mid-task; the standby resumes without re-firing a committed side effect." Sources: https://www.pixperk.tech/blog/lowkey-distributed-lock-service , https://raft.github.io/ .
- **ACI discipline + weak-model recovery.** Per-agent reliability comes from interface design: windowed file viewers, lint-before-apply, scoped search. And small local models *will* malform tool calls, re-read the same files, hallucinate files, and spiral on failed commands — these are **expected failure modes the runtime parses, repairs, constrains, and recovers from**, not things to be re-prompted away. Sources: https://swe-agent.com/0.7/background/aci/ , https://arxiv.org/pdf/2604.03515 .
- **Event-stream-as-source-of-truth (OpenHands).** Each agent's actions/observations and the orchestration graph state are append-only events; replay reconstructs the whole swarm run — the basis for audit, resume, and the determinism invariant. Source: https://arxiv.org/html/2407.16741v3 .
- **Indirect prompt injection across the swarm.** A malicious tool-result or a poisoned shared-evidence note is untrusted input; the defense is architectural trust separation + taint labels, not model good behavior — and promotion of local findings to project knowledge must require provenance + review. Source: https://arxiv.org/pdf/2505.23643 .

## E2. The hardest technical seams (named)

1. **The interface-contract board (the anti-drift spine).** Before implementation branches diverge, agents publish typed **InterfaceContracts**: `{name, version, apiShape, dataSchemas, migrationContract, fixtures, owner, status ∈ proposed|accepted|deprecated}`. Implementers *consume accepted contracts*; a producer that changes a contract bumps its version and triggers **contract-conformance checks** on every consumer. Conflicts (two tasks proposing incompatible shapes) are detected **at the board**, deterministically, before any merge — the single biggest cause of multi-branch failure. (MetaGPT's structured-document insight, made testable.)
2. **The sandbox view-boundary (isolation spine).** A `Sandbox` is per-task; the agent's *entire perceived world* is workspace-relative (`/workspaces/<taskId>`). A **host-path/secret recovery layer** rewrites any host path or secret that would otherwise surface — in the agent's working-directory prompt, in tool-call **arguments it's nudged toward**, in tool **outputs**, in **error messages**, and in **evidence shown back** — to the workspace-relative form (raw command strings like `cd /private/var/.../T/x && …` → `cd . && …`). Host paths remain fine *host-side* (orchestrator logs, evidence bundles); the rule is about the *agent's* perception. This mirrors the host product's hardest, most-relitigated boundary.
3. **The merge judge (evidence-gated integration spine).** Patches and merge candidates are **structural**: `{baseCommit, fileHashes, touchedSymbols, testEvidence, contractConformance, conflictMetadata}`. The judge ranks candidates by *evidence*, not size: it does **entity-level overlap detection** (semantic conflict vs. false line-conflict), validates contract conformance, runs the verification matrix, and either accepts, requests targeted rework, **salvages safe non-overlapping patches**, or **quarantines** risky/failing ones. It never blindly accepts the largest patch.
4. **The decomposition-governance DAG (the legibility spine).** A goal becomes a DAG of cards (planning → research → interface-design → implementation → verification → integration) with explicit dependencies, acceptance criteria, ownership, risk labels, and **promotion gates** (research→implementation requires an accepted contract; implementation→integration requires green verification). Cycles are detected; blocked tasks surface. Schedule by topological order + critical path.
5. **The context router (no cross-task leakage).** Each agent receives only its relevant files, the contracts it consumes, prior decisions in scope, its own tool results, and scoped domain notes — and **cannot read another task's memory or branch**. Cross-task leakage is a tested failure, not a convenience.
6. **Loop & failure recovery (weak-model survival).** Detect **repeated reads**, **repeated identical tool calls** (full-input fingerprint, not lossy summary, so an *advancing* stateful call never false-trips), **hallucinated files**, **malformed tool calls** (parse-and-repair), and **command-failure spirals**; respond by injecting a synthesis, reassigning, or quarantining — deterministically.
7. **Idempotent failover with fencing (distributed correctness).** Task ownership uses leases + monotonic fencing tokens; a killed/paused agent's stale writes are rejected; a standby resumes from durable branch evidence **without re-firing** a committed side effect. Stale-lock cleanup is automatic.
8. **Evidence promotion gate.** A local task finding becomes project-level knowledge only with `{source, scope, confidence, reviewerDecision}` — never auto-promoted from a single agent's claim.

## E3. Determinism & testability strategy (non-negotiable)

- **Virtual clock + seeded entropy.** No `Date.now()`/`setTimeout`/`Math.random()` in core. Scheduling jitter, lease timers, backoff, and any ordering read an injected clock + single seeded PRNG. Same `(seed, goal, agent/model fixtures, repo fixture)` ⇒ byte-identical run.
- **Fixture agents + fixture models + fixture sandboxes + fixture repo (the world is data).** `Agent`, `ModelClient`, `Sandbox`, and `VcsRepo` are interfaces with deterministic fixture implementations in-repo and live adapters behind the same interface. The seed **monorepo** ships: frontend + backend + runtime-service + SDK-boundary, failing tests, **overlapping files** (two tasks edit the same file non-overlappingly *and* overlappingly), a **changing API contract**, **weak-model malformed-tool-call** scripts, a **host-path-in-error** fixture, and a **malicious tool-request** fixture. Sandboxes in tests use scripted, seeded command results (including failures/partial outages).
- **Event-sourced swarm log + replay test.** The decomposition graph, agent actions/observations, contract events, merge decisions, and human decisions are append-only events; a `replaySwarm(seed)` reconstructs the entire run; two runs from the same seed produce **byte-identical event logs**. Model on the OpenHands event stream. Source: https://arxiv.org/html/2407.16741v3 .
- **Golden decompositions + golden merges.** Tests assert the exact DAG (nodes, deps, promotion gates) for a goal fixture, and the exact merge decision (accept/rework/salvage/quarantine) for each overlap fixture. A **degraded-agent** fixture (malformed tool calls, repeated reads) must still yield a *safe* outcome: loop broken, task reassigned/quarantined, no corrupt merge.
- **Sandbox leak scanner (the isolation test).** A test harness intercepts *every* agent-facing string (prompt, tool input, tool output, error, evidence) and asserts **no host path and no secret** appears — across the host-path-in-error fixture and a fuzz of injected host paths.

## E4. The small/weak-local-model crux (the !Klein north star)

The swarm is built to coordinate **small, quantized, fallible local models** and still ship correct software:

- **No single agent is trusted.** Correctness lives in contracts + the verification matrix + the merge judge, not in any model. A hallucinated patch fails verification/contract checks and is quarantined.
- **Loop recovery is first-class and deterministic.** Repeated-read/repeated-tool-call/hallucinated-file/malformed-call/command-spiral detection is built in; the repeated-call guard keys on a **lossless full-input fingerprint** so a genuinely advancing stateful call (e.g. a cursor-advancing read, a decomposition resolving one open question per turn) never collapses to a false pause.
- **Decomposition granularity is a knob, not a model virtue.** Poor planning granularity from a weak model is expected; the decomposition engine enforces card size/dependency hygiene and promotion gates so the DAG is legible regardless of model quality.
- **Weak-model output errors are parsed and recovered, not re-prompted** (narrated tool calls → real tool call, malformed args → repaired), consistent with the host product. A test runs the *entire* swarm with degraded agents and asserts all four rubric properties (determinism, isolation, contract-before-divergence, evidence-gated merge) still hold.

## E5. Adversarial, failure, and edge-case scenarios (concrete, testable)

Each ships as a deterministic fixture and must produce the correct outcome + evidence + audit:

- **Overlapping edits:** two implementers edit the same file — once non-overlappingly (false line-conflict) and once overlappingly (true semantic conflict). Expected: entity-level merge auto-resolves the false conflict; the true conflict blocks with structured evidence and a rework request.
- **Repeated-read loop:** a small model re-reads the same file batch and never progresses. Expected: loop detected → synthesis injected or task reassigned; no thrash; the run still terminates deterministically.
- **Contract conflict:** task A proposes an API shape incompatible with task B's accepted contract. Expected: detected at the contract board *before* implementation merges; consumers flagged; rework requested.
- **Host-path leak:** a sandboxed agent hits an error fixture containing `/private/var/folders/.../T/nklein-…`. Expected: redacted to workspace-relative; the agent never perceives the host path; it recovers (`cd .`), does not start an alternate-access loop; host-side logs may retain the real path.
- **Policy violation despite green tests:** an implementation passes unit tests but violates an architecture/layering policy. Expected: the reviewer role blocks integration with cited evidence (green tests ≠ accepted).
- **Partial salvage:** a branch produces useful non-overlapping work but fails verification overall. Expected: the integrator salvages the safe patches and quarantines the risky ones; nothing is silently dropped or silently merged.
- **Malicious/unsafe tool request:** an agent (or injected tool result) requests an unsafe/destructive action or attempts authority escalation. Expected: refused, evidence preserved, source quarantined, audited.
- **Failover idempotency:** kill the agent owning task T mid-side-effect; a standby resumes from durable branch evidence. Expected: the committed side effect is **not** re-fired (fencing token rejects the stale writer); the run completes; the event log proves single execution.
- **Stale lease:** a paused agent's lease expires and it later attempts a write. Expected: rejected by fencing token; no corruption.

## E6. Rigorous acceptance criteria, including property-based / invariant tests

Beyond the base spec's example-based criteria, assert these **invariants** with property-based + differential tests over randomized + scripted swarm runs:

1. **Determinism / replay** — `replaySwarm(seed)` twice ⇒ byte-identical event logs and identical final integration. (Property.)
2. **Isolation totality** — across every agent-facing string in every run, **no host path and no secret** ever appears. (Differential scan + fuzz of injected host paths.)
3. **Context non-leak** — no agent ever reads another task's memory or branch; scoped context only. (Totality.)
4. **Contract-before-merge** — no implementation merges that violates an accepted contract; incompatibilities are surfaced at the board pre-merge. (Invariant over contract fixtures.)
5. **Merge soundness** — no merge candidate with a true semantic conflict, a failing verification-matrix cell, or a contract-conformance failure is ever accepted; false line-conflicts on independent edits are auto-resolved. (Property over overlap fixtures.)
6. **No-silent-drop** — every patch is accepted, reworked, salvaged, or quarantined with recorded evidence; discarded work and failed branches are visible, never hidden. (Totality.)
7. **Failover idempotency** — for any kill point during a side-effecting task, the standby never re-fires a committed side effect; the event log shows exactly-once. (Property across kill points + fencing tokens.)
8. **DAG well-formedness** — the decomposition graph is acyclic with valid promotion gates; cycles and ungated promotions are rejected. (Property.)
9. **Loop-recovery termination** — every degraded-agent run (malformed calls, repeated reads, command spirals) terminates with a safe outcome; the full-input fingerprint never false-pauses an advancing stateful call. (Property.)
10. **Verification-gated integration** — a task's integration status becomes `accepted` only with green required checks *and* recorded evidence. (Totality.)

Plus a **chaos mode**: inject sandbox outages, agent crashes, stale leases, corrupted-branch recovery, and stale-lock cleanup, and assert invariants 1–10 still hold.

## E7. The concrete first vertical slice (the on-ramp — build THIS first, ~45–60 cards)

Prove the spine on **one** goal fixture decomposed into API + UI + SDK + tests, with the **overlap**, **contract-conflict**, **host-path-leak**, and **degraded-agent** fixtures:

1. **Determinism core + event-sourced swarm kernel + replay** (virtual clock, seeded PRNG, append-only graph/agent/contract/merge events, `replaySwarm`) (~8 cards).
2. **Decomposition-governance DAG** (goal → typed cards with deps/acceptance/ownership/risk + promotion gates + cycle detection + topological/critical-path scheduling) (~8 cards).
3. **Sandbox abstraction + view-boundary** (per-task workspace, scripted command results, host-path/secret recovery layer, leak scanner harness) (~9 cards).
4. **Context router** (scoped per-agent context; cross-task isolation enforced + tested) (~6 cards).
5. **Interface-contract board** (typed contracts, versioning, accept/deprecate, conformance checks on consumers, conflict detection) (~8 cards).
6. **Merge judge + verification matrix** (structural patches, entity-level overlap detection, contract conformance, types/tests/lint cells, accept/rework/salvage/quarantine) (~9 cards).
7. **Loop & failure recovery + idempotent failover** (repeated-read/tool-call full-input fingerprint, malformed-call repair, command-spiral guard; leases + fencing tokens; stale-lock cleanup) (~8 cards).
8. **Invariants E6 (1–10) + chaos mode green** on this slice, including the overlap, contract-conflict, host-path-leak, malicious-tool, failover, and degraded-agent fixtures, under `npm test` with no network/live model/real sandbox.

If that slice holds, more roles, more model profiles, richer telemetry UI, and live model/sandbox/VCS adapters are breadth on a proven spine.

## E8. Domain knowledge-debt to track (surface, don't bluff)

- **Semantic merge is language-specific and imperfect.** Entity-level merge reduces false conflicts but the AST/entity model is per-language and can still mis-handle moves/renames; ship a defensible default + mark deeper semantic merge as expert-review extension. Source: https://github.com/ataraxy-labs/weave .
- **Sandbox boundary choice is a real tradeoff.** Containers vs. gVisor vs. microVM trade isolation strength against cold-start/overhead; the fixture sandbox abstracts this, but production sandbox selection is a security decision needing review. Source: https://northflank.com/blog/how-to-sandbox-ai-agents .
- **Contract negotiation protocol.** How agents *negotiate* (not just publish) contracts — versioning policy, deprecation windows, who owns a shared schema — is a product decision; ship publish+conformance now, mark richer negotiation as debt. Source: https://arxiv.org/html/2308.00352v7 .
- **Distributed-correctness assumptions.** Fencing-token/lease parameters and the quorum model assume a particular failure model; document it and mark the production consensus choice (Raft vs. external lock service) as expert-review. Source: https://raft.github.io/ .
- **Merge-judge intent.** Beyond tests/contracts, "does this match user intent" is partly judgment; keep the human-decision queue first-class for ambiguous merges.
- **Benchmark caveat.** Multi-agent SE benchmarks are young and contamination-prone; prefer in-repo fixtures + invariants as ground truth. Source: https://arxiv.org/pdf/2509.16941 .

## E9. Why this is a great !Klein challenge

It is the batch's purest test of **multi-agent coordination, isolation, and determinism** — the exact problems the host product solves. It stresses **decomposition** (kernel → DAG → sandbox → router → contracts → merge → recovery), **determinism under weak models** (deterministic replay of a whole swarm; coordination logic owns correctness, not any model), **governance and safety** (host-path/secret isolation totality, evidence-gated merges, idempotent failover with fencing, no-silent-drop), and **long-running distributed correctness** (event sourcing + chaos mode). It demonstrates the thesis that **many weak local agents become a trustworthy software factory only when an isolated, contract-driven, evidence-gated, event-sourced kernel coordinates them** — and watching a swarm decompose and build *that* is exactly the showcase this batch exists to produce.

---

## Small-model build guide (3B-ready)

This section makes the project mechanically buildable by a 3B local model with minimal reasoning. The model follows; this guide does the thinking. All acceptance tests run offline with zero live dependencies.

### 1. Glossary & ground rules

**Domain terms**
- **TaskCard**: a unit of work with `{id, type, status, dependsOn, acceptanceCriteria, ownerAgentId, riskLabel, promotionGate}`.
- **PromotionGate**: the condition a task must meet before it can advance (e.g., "implementation requires an accepted InterfaceContract").
- **InterfaceContract**: `{name, version, apiShape, dataSchemas, owner, status: proposed|accepted|deprecated}`. Published before implementation branches diverge. The anti-drift spine.
- **Sandbox**: a per-task isolated workspace with scripted, seeded command results. Agents see only `/workspaces/<taskId>` — never a host path.
- **Host path**: any path containing `/private/`, `/var/folders/`, `/tmp/`, `/home/`, `~`, or the install directory. Must never appear in agent-facing strings.
- **Workspace-relative path**: a path starting with `.` or a relative segment (e.g., `./src/app.ts`). The only path format agents see.
- **FencingToken**: a monotonically increasing integer. A task write is rejected if the writer's token < the current token for that task.
- **MergeCandidate**: `{patches, baseCommit, fileHashes, touchedSymbols, testEvidence, contractConformance, conflictMetadata}`.
- **EntityOverlap**: two patches modify the same function/class (true semantic conflict) vs. just the same file at different lines (false line-conflict).
- **Fixture agent**: a deterministic implementation of `Agent` that returns scripted actions from JSON files, keyed by `(agentId, turn)`.
- **Fixture sandbox**: a scripted `Sandbox` that returns canned command results from JSON files, never executes real commands.
- **Loop fingerprint**: `sha256Hex(JSON.stringify(sortedToolInputFields))` — the FULL input, not a lossy summary. Two inputs collide only if genuinely identical.

**Stack**
- Language: TypeScript (strict mode, no `any`)
- Runtime: Node.js 20+
- Test runner: Vitest (`npm test` = `vitest run`)
- Key libraries: `tree-sitter` + `tree-sitter-typescript` for entity-level overlap; `zod` for schemas; `fast-check` for property tests
- No live agents, no live sandboxes, no network, no `Date.now()`, no `Math.random()` in core.

**Acceptance command**: `npm test` from project root. Must exit 0, all tests green.

**Determinism rules (imperative)**
1. Never call `Date.now()`, `new Date()`, `setTimeout`, or `Math.random()` in `src/`. Use injected `Clock` and `Prng`.
2. Never import a live agent, sandbox, or model in `src/orchestration/`, `src/sandbox/`, `src/contracts/`, `src/merge/`. Use adapter interfaces.
3. All fixture files live in `test/fixtures/`. Throw on missing fixture (never fetch).
4. Same `(seed, goal, agent/model fixtures, repo fixture)` ⇒ byte-identical event log and merge decisions.
5. `npm test` passes from a cold clone with no environment variables.
6. NEVER use host paths in agent-facing strings. Run the leak scanner after every change to `src/sandbox/`.

---

### 2. The explicit task graph for the FIRST vertical slice

The first slice (≈ 51 cards) proves the spine on **one goal fixture** (API + UI + SDK + tests) with the **overlap**, **contract-conflict**, **host-path-leak**, and **degraded-agent** fixtures. Build in order; do not start a card until all `dependsOn` are green.

---

**`S01` — Core types & interfaces**
dependsOn: none
files: `src/types.ts`
interface:
```typescript
export type TaskStatus = "pending"|"in-progress"|"done"|"failed"|"quarantined"|"cancelled";
export type ContractStatus = "proposed"|"accepted"|"deprecated";
export type MergeDecision = "accepted"|"rework-requested"|"salvaged"|"quarantined";
export type LoopKind = "repeated-read"|"repeated-tool-call"|"hallucinated-file"|"malformed-call"|"command-spiral";
export interface Clock { now(): number; }
export interface Prng { next(): number; }
export interface TaskCard {
  id: string; type: "planning"|"research"|"interface-design"|"implementation"|"verification"|"integration";
  status: TaskStatus; dependsOn: string[]; acceptanceCriteria: string[];
  ownerAgentId: string | null; riskLabel: "low"|"medium"|"high"|"critical";
  promotionGate: string | null;
}
export interface InterfaceContract {
  name: string; version: string; apiShape: object; dataSchemas: object;
  migrationContract: string | null; owner: string; status: ContractStatus;
}
export interface Patch {
  taskId: string; fileHashes: Record<string, string>; touchedSymbols: string[];
  testEvidence: string[]; content: string;
}
export interface FencingToken { taskId: string; token: number; }
```
how to implement: create `src/types.ts`; define all above; export all. Smoke test.
acceptance: `test/types.test.ts` imports all; `npm test` green.

---

**`S02` — Virtual clock & seeded PRNG**
dependsOn: `S01`
files: `src/clock.ts`, `src/prng.ts`
interface: same as prior projects (FixedClock + SeededPrng xorshift32).
acceptance: deterministic sequence asserted.

---

**`S03` — Content hash utility**
dependsOn: none
files: `src/hash.ts`, `test/hash.test.ts`
interface: `sha256Hex(s: string): string`. Same as prior projects.
acceptance: same string → same hash; different strings → different hashes.

---

**`S04` — Event-sourced swarm kernel**
dependsOn: `S01`, `S02`, `S03`
files: `src/orchestration/swarm-kernel.ts`, `test/swarm-kernel.test.ts`
interface:
```typescript
export type SwarmEvent =
  | { type: "task-created"; payload: TaskCard; ts: number }
  | { type: "task-status"; payload: { taskId: string; status: TaskStatus }; ts: number }
  | { type: "contract-published"; payload: InterfaceContract; ts: number }
  | { type: "contract-status"; payload: { name: string; version: string; status: ContractStatus }; ts: number }
  | { type: "patch-submitted"; payload: Patch; ts: number }
  | { type: "merge-decision"; payload: { patchId: string; decision: MergeDecision; reason: string }; ts: number }
  | { type: "loop-detected"; payload: { agentId: string; kind: LoopKind; fingerprint: string }; ts: number }
  | { type: "lease-acquired"; payload: { taskId: string; agentId: string; token: number; expiresAt: number }; ts: number }
  | { type: "lease-expired"; payload: { taskId: string; token: number }; ts: number }
  | { type: "fencing-rejected"; payload: { taskId: string; attemptedToken: number; currentToken: number }; ts: number };
export class SwarmKernel {
  constructor(private clock: Clock) {}
  append(event: Omit<SwarmEvent, "ts">): void {}
  events(): readonly SwarmEvent[] {}
  replay(events: readonly SwarmEvent[]): void {}  // reconstruct state from log
  currentTasks(): readonly TaskCard[] {}  // fold
  currentContracts(): readonly InterfaceContract[] {}  // fold
}
```
how to implement:
1. Private array with timestamps; fold methods.
2. `replay`: reset internal state, replay events one by one.
3. Test: create 2 tasks, update 1 status, replay → same state.
4. Test: two calls to `replay(same events)` produce identical `currentTasks()`.
acceptance: replay produces identical state; deterministic.

---

**`S05` — Decomposition-governance DAG**
dependsOn: `S01`, `S04`
files: `src/orchestration/dag.ts`, `test/dag.test.ts`
interface:
```typescript
export function detectCycles(tasks: TaskCard[]): string[][] {}
// returns list of cycles (each cycle is an array of task ids), empty array if none

export function topologicalOrder(tasks: TaskCard[]): TaskCard[] {}
// throws if cycle detected; returns tasks in dependency order

export function criticalPath(tasks: TaskCard[]): TaskCard[] {}
// longest dependency chain; schedule these first
```
how to implement:
1. `detectCycles`: DFS with grey/black coloring; collect back edges.
2. `topologicalOrder`: Kahn's algorithm (BFS with in-degree tracking); throws on cycle.
3. `criticalPath`: dynamic programming over the DAG.
4. Test: 4 tasks with `A→B→C`, `A→D`; topological order has A first; critical path is A→B→C.
5. Test: adding a cycle `C→A` causes `detectCycles` to return `[["A","B","C"]]` and `topologicalOrder` to throw.
acceptance: cycle detection and topological order work; throws on cycle.

---

**`S06` — Promotion gate checker**
dependsOn: `S01`, `S04`, `S05`
files: `src/orchestration/promotion-gate.ts`, `test/promotion-gate.test.ts`
interface:
```typescript
export function checkPromotionGate(task: TaskCard, contracts: InterfaceContract[]): boolean {}
// "implementation" type requires an accepted contract with the same name as task.promotionGate
// "integration" type requires task.status === "done" (green verification)
export function blockUngatedPromotion(task: TaskCard, contracts: InterfaceContract[]): void {
  // throws Error("promotion-gate-failed: ...") if gate not satisfied
}
```
how to implement:
1. For `type === "implementation"`: gate passes if `contracts.some(c => c.name === task.promotionGate && c.status === "accepted")`.
2. Test: implementation task with accepted contract → gate passes.
3. Test: implementation task with only `proposed` contract → gate fails.
acceptance: research→implementation requires accepted contract; ungated promotion blocked.

---

**`S07` — Host-path recovery layer**
dependsOn: `S03`
files: `src/sandbox/host-path-recovery.ts`, `test/host-path-recovery.test.ts`
interface:
```typescript
export const HOST_PATH_PATTERNS = [
  /\/private\/var\/folders\/[^\s]*/g,
  /\/var\/folders\/[^\s]*/g,
  /\/tmp\/nklein-[^\s]*/g,
  /\/home\/[^/\s]+\/[^\s]*/g,
  /~\/[^\s]*/g,
];
export function redactHostPaths(text: string): string {
  // replace all matches with workspace-relative equivalent: "cd /private/var/.../T/foo && cmd" → "cd . && cmd"
}
export function containsHostPath(text: string): boolean {}
```
how to implement:
1. `containsHostPath`: test any pattern matches.
2. `redactHostPaths`: for each match, replace `cd <hostpath> &&` with `cd . &&`; replace bare host paths with the filename/basename only.
3. Test: `"cd /private/var/folders/abc123/T/nklein-task1 && ls"` → `"cd . && ls"`.
4. Test: a normal workspace-relative path `"./src/app.ts"` → unchanged.
acceptance: host paths are redacted; workspace-relative paths pass through.

---

**`S08` — Leak scanner harness**
dependsOn: `S07`
files: `src/sandbox/leak-scanner.ts`, `test/leak-scanner.test.ts`
interface:
```typescript
export function scanForLeaks(agentFacingStrings: string[]): Array<{index: number; match: string}> {}
// returns all host-path matches across all strings with their index
export function assertNoLeaks(agentFacingStrings: string[]): void {
  // throws Error("HOST_PATH_LEAK_DETECTED: ...") if any match found
}
```
how to implement:
1. `scanForLeaks`: iterate strings; apply `containsHostPath`; collect all matches.
2. `assertNoLeaks`: throw if any match.
3. Test: a set of strings containing a host path → throws.
4. Test: a set of workspace-relative strings → no throw.
acceptance: any host path in agent-facing strings is detected and rejected.

---

**`S09` — Fixture sandbox**
dependsOn: `S07`, `S08`
files: `src/adapters/sandbox-fixture-adapter.ts`, `test/fixtures/sandboxes/task-api/commands.json`, `test/fixtures/sandboxes/task-ui/commands.json`
interface:
```typescript
export interface Sandbox {
  taskId: string; workspaceRoot: string;  // always "/workspaces/<taskId>" — never a host path
  execute(command: string): Promise<SandboxResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(): Promise<string[]>;
}
export interface SandboxResult { stdout: string; stderr: string; exitCode: number; }
export class SandboxFixtureAdapter implements Sandbox {
  constructor(public taskId: string, private commandFixtures: Record<string, SandboxResult>) {}
  get workspaceRoot(): string { return `/workspaces/${this.taskId}`; }
  // throws if command not in fixtures
}
```
how to implement:
1. Create `test/fixtures/sandboxes/task-api/commands.json`: `{"npm test": {"stdout":"All tests passed","stderr":"","exitCode":0}, "tsc": {"stdout":"","stderr":"","exitCode":0}}`.
2. Create `test/fixtures/sandboxes/task-ui/commands.json` similarly.
3. `execute`: look up command; throw if missing; run `assertNoLeaks([result.stdout, result.stderr])` on output (redact before returning to agent).
4. `workspaceRoot` always returns the workspace-relative form.
5. Test: `execute("npm test")` returns canned result; `workspaceRoot` does not contain `/private/`.
acceptance: sandbox never exposes host paths; commands return canned results.

---

**`S10` — Fixture agent adapter**
dependsOn: `S01`, `S03`, `S09`
files: `src/adapters/agent-fixture-adapter.ts`, `test/fixtures/agents/implementer-api.json`, `test/fixtures/agents/implementer-ui.json`, `test/fixtures/agents/degraded-agent.json`
interface:
```typescript
export interface AgentAction {
  type: "read-files"|"write-file"|"execute-command"|"submit-patch"|"publish-contract"|"request-context"|"done";
  payload: object;
}
export interface Agent {
  id: string; roleType: "implementer"|"architect"|"reviewer"|"integrator"|"test-author";
  nextAction(context: AgentContext): Promise<AgentAction>;
}
export interface AgentContext { taskId: string; scopedFiles: string[]; turn: number; }
export class AgentFixtureAdapter implements Agent {
  constructor(public id: string, public roleType: Agent["roleType"], private fixturePath: string) {}
  // key = `turn-${context.turn}`; returns scripted action; throws if missing
}
```
how to implement:
1. Create `test/fixtures/agents/implementer-api.json`: `{"turn-0": {"type":"read-files","payload":{"paths":["src/api.ts"]}}, "turn-1": {"type":"submit-patch","payload":{"content":"..."}}, "turn-2": {"type":"done","payload":{}}}`.
2. Create `test/fixtures/agents/degraded-agent.json`: `{"turn-0": {"type":"read-files","payload":{"paths":["src/api.ts"]}}, "turn-1": {"type":"read-files","payload":{"paths":["src/api.ts"]}}, "turn-2": {"type":"read-files","payload":{"paths":["src/api.ts"]}}}` (same request 3 times = loop).
3. Test: turn-0 returns `read-files`; turn-2 returns `done`.
acceptance: scripted actions returned; missing turn throws.

---

**`S11` — Context router**
dependsOn: `S01`, `S09`, `S10`
files: `src/orchestration/context-router.ts`, `test/context-router.test.ts`
interface:
```typescript
export function routeContext(opts: {
  taskId: string; agentId: string; requestedPaths: string[];
  allTaskIds: string[]; taskOwnerships: Map<string, string>;  // taskId → ownerAgentId
  availablePaths: string[];
}): { allowedPaths: string[]; deniedPaths: string[]; reason: Record<string, string> } {}
```
how to implement:
1. An agent may only access files in its own task's workspace OR files in `contracts/` (shared).
2. Files in another task's workspace → denied; reason: `"cross-task-isolation"`.
3. `deniedPaths`: all paths not in `allowedPaths`.
4. Test: agent A requests its own files → all allowed.
5. Test: agent A requests a file belonging to task B → denied.
6. Test: agent A requests `contracts/api-v1.json` → allowed (shared).
acceptance: cross-task isolation enforced; no agent reads another task's branch.

---

**`S12` — Interface contract board**
dependsOn: `S01`, `S04`
files: `src/contracts/contract-board.ts`, `test/contract-board.test.ts`
interface:
```typescript
export class ContractBoard {
  constructor(private kernel: SwarmKernel) {}
  publish(contract: InterfaceContract): void {}
  accept(name: string, version: string): void {}
  deprecate(name: string, version: string): void {}
  detectConflicts(contracts: InterfaceContract[]): Array<{a: InterfaceContract; b: InterfaceContract; reason: string}> {}
  conformanceCheck(patch: Patch, contractName: string): { conformant: boolean; violations: string[] } {}
}
```
how to implement:
1. `publish`: append `contract-published` event.
2. `accept`/`deprecate`: append `contract-status` events.
3. `detectConflicts`: compare `apiShape` of all `proposed` contracts; flag if two contracts with different `version` claim the same endpoint/shape with incompatible schemas (simple: same `name`, different `apiShape` keys overlap).
4. `conformanceCheck`: check if the patch's `touchedSymbols` include any symbol referenced in the contract's `apiShape`; if so, verify the patch content contains the expected function signature (simple string search).
5. Test: two contracts claiming the same API name with conflicting schemas → conflict detected.
6. Test: a patch touching the contract's API entry point with the correct signature → conformant.
7. Test: a patch with the wrong signature → non-conformant.
acceptance: conflicts caught before merge; conformance check works.

---

**`S13` — Entity-level overlap detection**
dependsOn: `S03`
files: `src/merge/entity-overlap.ts`, `test/entity-overlap.test.ts`
interface:
```typescript
export interface EntityRange { entityName: string; startLine: number; endLine: number; file: string; }
export function extractEntityRanges(fileContent: string, filePath: string): EntityRange[] {}
// uses tree-sitter to find function/class ranges

export function detectOverlap(
  patchA: Patch, patchB: Patch,
  fileContents: Record<string, string>
): { kind: "false-line-conflict" | "true-semantic-conflict" | "no-overlap"; entities: string[] } {}
```
how to implement:
1. `extractEntityRanges`: tree-sitter walk for `function_declaration`, `class_declaration`, `method_definition`; return name + line range.
2. `detectOverlap`:
   - If neither patch touches the same file → `"no-overlap"`.
   - If they touch the same file: compare entity ranges. If same entity (same `entityName` in same `file`) modified by both → `"true-semantic-conflict"`.
   - If same file, different entities (no entity range overlap) → `"false-line-conflict"`.
3. Test: two patches modify `function handleRequest` in the same file → `"true-semantic-conflict"`.
4. Test: patch A modifies `function handleRequest`, patch B modifies `function sendResponse` in the same file → `"false-line-conflict"`.
5. Test: patches touch different files → `"no-overlap"`.
acceptance: semantic conflict vs. false conflict correctly distinguished.

---

**`S14` — Merge judge**
dependsOn: `S01`, `S04`, `S12`, `S13`
files: `src/merge/merge-judge.ts`, `test/merge-judge.test.ts`
interface:
```typescript
export function judgePatches(opts: {
  patches: Patch[]; fileContents: Record<string, string>;
  contracts: InterfaceContract[]; verificationResults: Record<string, "passed"|"failed">;
}): Array<{patch: Patch; decision: MergeDecision; reason: string; savedPatches?: Patch[]}> {}
```
how to implement:
1. For each patch:
   - Run `conformanceCheck` against relevant contracts → if non-conformant → `"rework-requested"`.
   - Check `verificationResults[patch.taskId]` → if `"failed"` → attempt salvage (separate non-overlapping parts), else `"quarantined"`.
   - Run `detectOverlap` between this patch and all others → if `"true-semantic-conflict"` → `"rework-requested"`.
   - If `"false-line-conflict"` → auto-resolve (both accepted).
   - If all checks pass → `"accepted"`.
2. Test: conformance failure → `"rework-requested"`.
3. Test: verification failure → `"quarantined"` or `"salvaged"`.
4. Test: false-line-conflict → both patches `"accepted"`.
5. Test: true semantic conflict → `"rework-requested"`.
acceptance: no true semantic conflict or conformance failure is ever `"accepted"`.

---

**`S15` — Loop & failure recovery**
dependsOn: `S01`, `S03`, `S04`
files: `src/orchestration/loop-recovery.ts`, `test/loop-recovery.test.ts`
interface:
```typescript
export function computeToolFingerprint(toolInput: object): string {
  // sha256Hex of key-order-independent JSON: sort all keys recursively
}
export class LoopGuard {
  constructor(private kernel: SwarmKernel, private threshold: number) {}
  record(agentId: string, kind: LoopKind, fingerprint: string): void {}
  isLooping(agentId: string, fingerprint: string): boolean {}
  // threshold consecutive identical fingerprints for the same agent → looping
}
export function repairMalformedToolCall(rawText: string): object | null {
  // attempt to extract JSON from narrated tool call text like "<tool_call>{...}</tool_call>"
  // returns parsed object or null if unrecoverable
}
```
how to implement:
1. `computeToolFingerprint`: `JSON.stringify(sortObjectKeys(input))` where `sortObjectKeys` recursively sorts all object keys; then `sha256Hex`.
2. `LoopGuard.record`: append `loop-detected` event; track consecutive count per agent.
3. `LoopGuard.isLooping`: return `count >= threshold`.
4. `repairMalformedToolCall`: try `JSON.parse(rawText.replace(/<tool_call>/g,"").replace(/<\/tool_call>/g,""))`.
5. Test: same fingerprint 3 times → `isLooping` returns `true`.
6. Test: `computeToolFingerprint({b:1,a:2})` === `computeToolFingerprint({a:2,b:1})` (key-order-independent).
7. Test: `repairMalformedToolCall('<tool_call>{"action":"read"}</tool_call>')` → `{action:"read"}`.
8. Test degraded-agent fixture: 3 consecutive read-files with same paths → loop detected; NOT a false pause (different paths = different fingerprints).
acceptance: loop detected at threshold; full-input fingerprint; advancing calls never false-trigger.

---

**`S16` — Fencing token & lease manager**
dependsOn: `S01`, `S04`
files: `src/orchestration/lease-manager.ts`, `test/lease-manager.test.ts`
interface:
```typescript
export class LeaseManager {
  constructor(private kernel: SwarmKernel, private clock: Clock) {}
  acquire(taskId: string, agentId: string, durationMs: number): FencingToken {}
  // returns token; appends lease-acquired event; increments token
  validate(taskId: string, token: FencingToken): boolean {}
  // returns false (fencing rejection) if token < current token for task
  expire(taskId: string): void {}
  // marks lease expired; increments token; appends lease-expired event
  currentToken(taskId: string): number {}
}
```
how to implement:
1. Maintain per-task token counter (fold over kernel events).
2. `acquire`: increment token; append `lease-acquired`; return new token.
3. `validate`: compare token against current; if lower → append `fencing-rejected`; return `false`.
4. `expire`: increment token; append `lease-expired`.
5. Test: acquire token 1; validate token 1 → `true`. Expire task; validate token 1 → `false` (new token is 2).
6. Test: two agents: agent A holds token 1; A expires; agent B acquires token 2; A tries to write with token 1 → rejected.
acceptance: stale writer always rejected; exactly-once semantics enforced.

---

**`S17` — Host-path leak fixture**
dependsOn: `S07`, `S09`
files: `test/fixtures/sandboxes/host-path-error/commands.json`
interface: none (fixture)
how to implement:
1. Create `test/fixtures/sandboxes/host-path-error/commands.json` with a canned error output containing a host path: `{"npm test": {"stdout":"", "stderr":"Cannot find module '/private/var/folders/abc/T/nklein-task99/node_modules'", "exitCode":1}}`.
2. The `SandboxFixtureAdapter.execute` calls `redactHostPaths` on stderr before returning to the agent.
3. Test: the returned `stderr` does NOT contain `/private/`; it contains a workspace-relative form.
acceptance: host path in canned error output is redacted before reaching the agent.

---

**`S18` — Contract conflict fixture**
dependsOn: `S12`
files: `test/fixtures/contracts/api-v1.json`, `test/fixtures/contracts/api-v1-conflicting.json`
interface: none (fixtures)
how to implement:
1. `api-v1.json`: `{name:"UserApi", version:"1.0", apiShape:{getUser: {input:"id:string", output:"User"}}, status:"proposed"}`.
2. `api-v1-conflicting.json`: `{name:"UserApi", version:"1.0", apiShape:{getUser: {input:"id:number", output:"UserRecord"}}, status:"proposed"}` — same name+version, different types.
3. Test: `detectConflicts([load(api-v1), load(api-v1-conflicting)])` → 1 conflict.
acceptance: incompatible contracts detected before merge.

---

**`S19` — Overlap fixture (false-conflict + true-conflict)**
dependsOn: `S13`
files: `test/fixtures/patches/patch-api-v1.json`, `test/fixtures/patches/patch-api-v2-false.json`, `test/fixtures/patches/patch-api-v2-true.json`, `test/fixtures/repo/src/api.ts`
interface: none (fixtures)
how to implement:
1. `test/fixtures/repo/src/api.ts`: a file with two functions: `function handleRequest(...)` and `function sendResponse(...)`.
2. `patch-api-v1.json`: touches `handleRequest` in `src/api.ts`.
3. `patch-api-v2-false.json`: touches `sendResponse` only → false conflict.
4. `patch-api-v2-true.json`: also touches `handleRequest` → true semantic conflict.
5. Test with `S13` assertions.
acceptance: fixtures are committed; tests use them without network.

---

**`S20` — Malicious tool request fixture**
dependsOn: `S11`, `S15`
files: `test/fixtures/agents/malicious-agent.json`
interface: none (fixture)
how to implement:
1. Create `test/fixtures/agents/malicious-agent.json`: `{"turn-0": {"type":"execute-command","payload":{"command":"rm -rf /"}}}`.
2. The context router and tool scope policy must reject this.
3. Add a `ToolPolicy` that blocks destructive shell commands: any command matching `/rm\s+-rf/` or `/sudo/` → reject.
4. Test: the malicious action is refused by the policy; kernel records a `fencing-rejected`-style event.
acceptance: unsafe action rejected; kernel records denial; audit preserved.

---

**`S21` — Integration test: swarm decomposes goal → DAG**
dependsOn: `S04`, `S05`, `S06`, `S10`
files: `test/integration/goal-decomposition.test.ts`
interface: none
how to implement:
1. Define a goal: "Implement UserApi + UI + SDK + tests".
2. Create 6 task cards (one per type: planning, research, interface-design, implementation[api], implementation[ui], verification). Set dependencies.
3. Load into kernel; run `topologicalOrder`; assert planning comes first; assert both implementations depend on interface-design.
4. Run `checkPromotionGate` for each implementation → fails (no accepted contract yet).
5. Accept the contract; re-run → gates pass.
6. Assert no cycles.
acceptance: DAG is well-formed; promotion gates work; no ungated promotions.

---

**`S22` — Integration test: context isolation (no cross-task leak)**
dependsOn: `S11`, `S21`
files: `test/integration/context-isolation.test.ts`
interface: none
how to implement:
1. Create 2 tasks: `task-api` and `task-ui` with distinct workspaces.
2. Agent for `task-api` requests files in `task-ui`'s workspace.
3. Assert: router denies; `deniedPaths` contains the cross-task file.
4. Agent requests `contracts/api-v1.json` (shared) → allowed.
5. Assert: no denied path appears in the agent's context.
acceptance: cross-task isolation holds.

---

**`S23` — Integration test: host-path leak → redacted**
dependsOn: `S17`, `S09`, `S08`
files: `test/integration/host-path-leak.test.ts`
interface: none
how to implement:
1. Create a `SandboxFixtureAdapter` with the host-path-error fixture.
2. Execute `npm test`.
3. Run `assertNoLeaks([result.stderr])` — no throw.
4. Assert: the agent-facing `stderr` does NOT contain `/private/`.
5. Assert: the agent recovers (no alternate-access loop started).
acceptance: host path redacted from agent-facing output; leak scanner confirms.

---

**`S24` — Integration test: contract conflict → rework before merge**
dependsOn: `S12`, `S18`, `S21`
files: `test/integration/contract-conflict.test.ts`
interface: none
how to implement:
1. Publish `api-v1.json` and `api-v1-conflicting.json` to the board (both proposed).
2. Run `detectConflicts` → 1 conflict returned.
3. Assert: the conflicting contract is NOT accepted.
4. Assert: a `rework-requested` decision is in the kernel for the consumer task.
acceptance: conflict detected before implementation merges.

---

**`S25` — Integration test: false-conflict → auto-resolved; true-conflict → rework**
dependsOn: `S13`, `S14`, `S19`
files: `test/integration/overlap-merge.test.ts`
interface: none
how to implement:
1. Load `patch-api-v1` and `patch-api-v2-false`; run `judgePatches`.
2. Assert: both decisions are `"accepted"` (false line-conflict → auto-resolved).
3. Load `patch-api-v1` and `patch-api-v2-true`; run `judgePatches`.
4. Assert: one decision is `"rework-requested"` (true semantic conflict).
acceptance: entity-level merge distinguishes correctly.

---

**`S26` — Integration test: degraded agent → loop detected → synthesis injected**
dependsOn: `S15`, `S10`
files: `test/integration/loop-recovery.test.ts`
interface: none
how to implement:
1. Use the `degraded-agent.json` fixture (same read-files request 3 turns in a row).
2. Run the agent for 3 turns.
3. Assert: `LoopGuard.isLooping` returns `true` on turn 3.
4. Assert: the kernel has a `loop-detected` event.
5. Assert: a synthesis is injected (implement `injectSynthesis` as a stub that returns a canned summary string, record it in the kernel).
6. Assert: the agent does NOT make a 4th identical request (the run terminates safely).
acceptance: loop detected; synthesis injected; no thrash; deterministic.

---

**`S27` — Integration test: failover idempotency with fencing**
dependsOn: `S16`, `S04`
files: `test/integration/failover-idempotency.test.ts`
interface: none
how to implement:
1. Agent A acquires a lease for `task-api` (token=1); writes a patch; commits a side-effect event to kernel.
2. Simulate kill: `leaseManager.expire("task-api")` (token increments to 2).
3. Agent B acquires the lease (token=2).
4. Agent A (stale) tries to write another patch with token=1 → `validate` returns `false`; kernel records `fencing-rejected`.
5. Assert: no second side-effect event in kernel (idempotent).
6. Agent B continues from durable branch evidence; completes.
acceptance: stale writer rejected by fencing; no duplicate side effects.

---

**`S28` — Integration test: malicious tool request → refused + audited**
dependsOn: `S20`, `S11`
files: `test/integration/malicious-tool.test.ts`
interface: none
how to implement:
1. Run the `malicious-agent.json` fixture for 1 turn.
2. Assert: the `rm -rf /` command is blocked by tool policy.
3. Assert: the kernel has a denial event.
4. Assert: the agent's action is quarantined.
5. Assert: no actual command was executed (sandbox fixture not called).
acceptance: unsafe action refused; audited; sandbox untouched.

---

**`S29` — Property test: determinism/replay**
dependsOn: `S04`
files: `test/property/swarm-determinism.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate random sequences of task/contract/patch events.
2. Append to kernel; serialize events; call `replay`; compare `currentTasks()` and `currentContracts()`.
3. Assert `JSON.stringify(a)` === `JSON.stringify(b)`.
4. Run with 200 examples.
acceptance: byte-identical replay in all 200 cases.

---

**`S30` — Property test: isolation totality**
dependsOn: `S07`, `S08`
files: `test/property/isolation-totality.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate random strings including injected host path patterns.
2. Call `redactHostPaths` on each.
3. Assert `containsHostPath(redacted)` is `false`.
4. Run with 500 examples.
acceptance: no host path survives redaction.

---

**`S31` — Property test: context non-leak**
dependsOn: `S11`
files: `test/property/context-non-leak.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate random task/agent assignments.
2. For each agent, call `routeContext`; assert no path from another task's workspace is in `allowedPaths`.
3. Run with 200 examples.
acceptance: cross-task isolation holds across fuzz.

---

**`S32` — Property test: contract-before-merge**
dependsOn: `S06`, `S12`
files: `test/property/contract-before-merge.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate implementation tasks with random contracts (mix of proposed/accepted).
2. Assert: `checkPromotionGate` passes only when there is an accepted contract with the matching name.
3. Run with 200 examples.
acceptance: no implementation merges without an accepted contract.

---

**`S33` — Property test: merge soundness**
dependsOn: `S14`
files: `test/property/merge-soundness.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate pairs of patches with true semantic conflicts.
2. Assert `judgePatches` never returns `"accepted"` for a true-semantic-conflict pair.
3. Run with 200 examples.
acceptance: no true conflict ever accepted.

---

**`S34` — Property test: no-silent-drop**
dependsOn: `S04`, `S14`
files: `test/property/no-silent-drop.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate patch submissions; some pass, some fail verification.
2. Assert: every patch has exactly one `merge-decision` event in the kernel (accepted/rework/salvaged/quarantined).
3. Run with 200 examples.
acceptance: no patch is ever silently discarded.

---

**`S35` — Property test: failover idempotency**
dependsOn: `S16`
files: `test/property/failover-idempotency.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate random kill points in a task execution.
2. At each kill point: expire lease; simulate stale-writer attempt.
3. Assert: `validate(staleToken)` always returns `false` after expiry.
4. Assert: the kernel never has more than 1 side-effect event per unique `(taskId, inputHash)`.
5. Run with 200 examples.
acceptance: exactly-once semantics across all kill points.

---

**`S36` — Property test: DAG well-formedness**
dependsOn: `S05`
files: `test/property/dag-well-formedness.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate random DAGs (acyclic by construction); occasionally inject a cycle.
2. Assert: acyclic DAGs → `detectCycles` returns `[]`; `topologicalOrder` succeeds.
3. Assert: cyclic DAGs → `detectCycles` returns non-empty; `topologicalOrder` throws.
4. Run with 200 examples.
acceptance: cycle detection and topological order work for all fuzz cases.

---

**`S37` — Property test: loop-recovery termination**
dependsOn: `S15`
files: `test/property/loop-recovery-termination.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate agent action sequences with repeated fingerprints (degraded) and advancing fingerprints (healthy).
2. Assert: repeated sequences trigger loop at threshold; advancing sequences never trigger false loop.
3. Run with 300 examples.
acceptance: full-input fingerprint never false-pauses an advancing agent.

---

**`S38` — Property test: verification-gated integration**
dependsOn: `S14`
files: `test/property/verification-gated-integration.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate patches with random verification results.
2. Assert: a patch whose `verificationResults[taskId] === "failed"` is never `"accepted"` (only `"quarantined"` or `"salvaged"`).
3. Run with 200 examples.
acceptance: failing verification always blocks acceptance.

---

**`S39` — Chaos mode: inject sandbox outage + assert invariants**
dependsOn: `S04`–`S38`
files: `test/integration/chaos-mode.test.ts`
interface: none
how to implement:
1. Create a sandbox fixture that fails on the first 2 commands, then succeeds.
2. Run the swarm through the failing fixture.
3. Assert invariants E6(1-10) from the spec still hold after the chaos run:
   - (1) Replay produces identical event log.
   - (2) No host paths in any agent-facing string.
   - (3) No cross-task memory access.
   - (4) No merge of a contract-violating patch.
   - (5) No true semantic conflict ever accepted.
   - (7) No duplicate side effects after failover.
4. The chaos run must terminate deterministically.
acceptance: all invariants hold under chaos; no non-termination.

---

**`S40` — Integration test: partial salvage**
dependsOn: `S14`
files: `test/integration/partial-salvage.test.ts`
interface: none
how to implement:
1. Create a patch with 2 independent file changes: one passes verification, one fails.
2. Run `judgePatches`.
3. Assert: the good change is in `decision.savedPatches`; overall decision is `"salvaged"`.
4. Assert: the risky/failing change is quarantined.
5. Assert: nothing is silently dropped.
acceptance: salvage produces safe parts; risky parts quarantined; no silent drop.

---

**`S41` — npm test wiring**
dependsOn: `S01`–`S40`
files: `package.json`, `vitest.config.ts`, `tsconfig.json`
how to implement: `npm test` = `vitest run`; strict TypeScript; exits 0.
acceptance: all tests pass; no skipped tests.

---

**`S42` — Knowledge-debt register**
dependsOn: `S41`
files: `KNOWLEDGE_DEBT.md`
how to implement: list the 6 items from E8 (semantic merge language-specificity, sandbox boundary choice, contract negotiation protocol, distributed-correctness assumptions, merge judge intent, benchmark caveat) with risk level and mitigation.
acceptance: file exists; `npm test` still green.

---

### 3. The decomposition method for the rest

**Recipe** (same as prior projects):
1. New types (N+0). 2. Fixture (N+1). 3. Core function (N+2). 4. Unit test (N+3). 5. Property test (N+4). 6. Wire into integration (N+5). Explicit `dependsOn` always.

**Worked example A — Architect role**
- `AR01` — Add `architect` to `AgentRoleType` in `src/types.ts`. dependsOn: `S01`.
- `AR02` — Create `test/fixtures/agents/architect.json` with scripted decompose+contract-publish actions. dependsOn: `S10`.
- `AR03` — Implement `ArchitectAgent implements Agent` that publishes a contract on turn 1. dependsOn: `AR01`, `AR02`, `S12`.
- `AR04` — Integration test: architect publishes contract; implementation task gate passes. dependsOn: `AR03`, `S21`.

**Worked example B — More language support (Python entity overlap)**
- `PY01` — Add tree-sitter-python grammar; implement `extractEntityRanges` for Python files. dependsOn: `S13`.
- `PY02` — Create `test/fixtures/repo/src/handler.py` with 2 functions. dependsOn: `S19`.
- `PY03` — Test: overlap detection works for Python patches. dependsOn: `PY01`, `PY02`.

**Worked example C — Telemetry UI projection**
- `TU01` — Define `SwarmSnapshot` type: `{runningAgents, blockedTasks, loopingAgents, mergeQueue}`. dependsOn: `S01`.
- `TU02` — Implement `projectSnapshot(kernel: SwarmKernel): SwarmSnapshot`. dependsOn: `TU01`, `S04`.
- `TU03` — Test: after the goal-decomposition integration test, snapshot contains 6 tasks and 0 loops. dependsOn: `TU02`, `S21`.

---

### 4. Per-task implementation conventions

**File layout**
```
src/
  types.ts; clock.ts; prng.ts; hash.ts
  orchestration/swarm-kernel.ts, dag.ts, promotion-gate.ts, context-router.ts, loop-recovery.ts, lease-manager.ts
  sandbox/host-path-recovery.ts, leak-scanner.ts
  contracts/contract-board.ts
  merge/entity-overlap.ts, merge-judge.ts
  adapters/sandbox-fixture-adapter.ts, agent-fixture-adapter.ts
test/
  fixtures/sandboxes/, agents/, contracts/, patches/, repo/
  integration/
  property/
  *.test.ts
```

**Test snippet (lease + fencing)**
```typescript
// test/lease-manager.test.ts
import { describe, it, expect } from "vitest";
import { LeaseManager } from "../src/orchestration/lease-manager.js";
import { SwarmKernel } from "../src/orchestration/swarm-kernel.js";
import { FixedClock } from "../src/clock.js";

describe("LeaseManager", () => {
  it("rejects stale token after expiry", () => {
    const kernel = new SwarmKernel(new FixedClock(1000));
    const lm = new LeaseManager(kernel, new FixedClock(1000));
    const token = lm.acquire("task-api", "agent-a", 5000);
    lm.expire("task-api");
    expect(lm.validate("task-api", token)).toBe(false);
  });
});
```

**Definition of done**: `npm test` green; no `any`; no live agents/sandboxes/network; all fixtures committed; explicit return types; single responsibility.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1 — Using a lossy loop-detection fingerprint**
A 3B model may key loop detection on the `type` field only (e.g., `"read-files"`), so any two `read-files` calls with different paths collide. This false-pauses advancing agents.
Fix: `computeToolFingerprint` hashes the ENTIRE input with sorted keys. Two calls fingerprint-collide only when ALL input fields are identical. The `S37` property test fuzzes this.

**Pitfall 2 — Exposing host paths in agent-facing strings**
A 3B model may write `workspaceRoot = process.cwd()` in `SandboxFixtureAdapter`. This leaks the host path.
Fix: `workspaceRoot` always returns `/workspaces/${this.taskId}`. Run `assertNoLeaks` on every agent-facing string in `S30`. This is the most-relitigated boundary in the codebase.

**Pitfall 3 — Accepting a merge with a true semantic conflict**
A 3B model may implement `judgePatches` to accept the first patch and rework the second without checking entity-level overlap first.
Fix: entity overlap detection runs BEFORE merge decision. `"true-semantic-conflict"` always results in `"rework-requested"` for at least one patch. The `S33` property test enforces this.

**Pitfall 4 — Forgetting promotion gates**
A 3B model may set an `"implementation"` task to `"in-progress"` without checking that an accepted contract exists.
Fix: `blockUngatedPromotion` is called before any status change to `"in-progress"` for implementation tasks. The `S32` property test enforces this.

**Pitfall 5 — Re-firing a committed side effect after failover**
A 3B model may implement failover as "re-run the agent from scratch", causing side effects to fire twice.
Fix: the `IdempotentRunner` pattern from project 23 applies here: before executing, check if the `(taskId, inputHash)` pair already has an event in the kernel. The `S35` property test enforces exactly-once semantics.

**Pitfall 6 — Silently dropping a failed branch**
A 3B model may simply delete a quarantined patch from the kernel without recording why.
Fix: every patch decision is recorded in the kernel as a `merge-decision` event with `reason`. The `S34` property test asserts that every submitted patch has exactly one decision event.

**Pitfall 7 — Generating fixture files at test runtime**
A 3B model may try to generate `test/fixtures/agents/implementer-api.json` by running an agent. This requires a live model and breaks CI.
Fix: all fixture files in `test/fixtures/` are committed to the repo. `AgentFixtureAdapter` throws on a missing turn. Never generate fixtures at test time.
