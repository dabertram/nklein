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
