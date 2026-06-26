# Small-LLM agent optimization research

Date: 2026-06-27

Scope: online research plus two focused waves of subagents on how to make small/local LLMs work efficiently on very hard, long-horizon software tasks. The tool-enforced subagent concurrency cap was 6, so this pass used 12 focused research agents rather than a single 50-agent fan-out. The result below is meant to feed `todo.md`, especially sections 5.AA through 5.AG, without adding yet another large parallel ambition section.

## Executive thesis

The consistent finding is that small LLMs do not become capable by being given more freedom. They become capable when the harness:

1. Owns the global process as an explicit, durable state machine.
2. Narrows each model call to a small, state-local job.
3. Restricts the tool menu aggressively.
4. Converts every run into durable evidence.
5. Uses external feedback, not self-belief, as the repair signal.
6. Learns reusable procedures only after validation and quarantine.

The current `todo.md` is already unusually aligned with this direction. It has the right invariants, planning/refinement lane, focus chains, local-only model policy, strict Docker isolation, cross-model verification, dynamic context, dynamic skills, and the planned Agent Attempt Ledger. The biggest correction from this research is that the planned ledger should become a workflow event log plus attempt evidence stream, not only a model-attempt table. That one change unlocks durable scheduling, replay, model routing, skill learning, operator UX, and security auditability.

## What the current spec already gets right

- Strict Docker isolation and local-only model dispatch are the right foundation. Most current agent security guidance assumes prompt injection eventually succeeds and therefore focuses on limiting side effects.
- The Planning/Refinement lane is the right place to keep small models from implementing stale or oversized work.
- Decomposition into dependency-linked cards is correct, but only if the controller owns repair and downstream invalidation.
- Focus chains are a strong small-model affordance: visible current step, context re-anchor, reviewer-visible progress, and telemetry.
- Cross-model verification in section 5.Z is stronger than typical one-model smoke testing.
- Section 5.AF is correctly identified as the keystone. Adaptive robustness, model fitness, context learning, dynamic skills, replay, and operator reporting should all read from the same substrate.
- Section 5.AE is correctly pointed toward dynamic skills and just-in-time context, but it should grow into validated procedural memory, not stop at prompt-fragment routing.
- Section 5.AD is directionally right: 32k is a minimum capability gate, not a fill target.

## Highest-value missing or under-covered ideas

### 1. Make the Attempt Ledger a workflow event log, not just an attempt table

Current spec: per-attempt append-only records for model/model-output/tool/outcome.

Research correction: durable systems such as Temporal-style workflows and actor runtimes record event history, leases, admissions, retries, tool results, and idempotency boundaries. A model attempt is only one event family inside the workflow.

Add to 5.AF:

- `workflowId`, `jobId`, `leaseId`, `workerId`, `idempotencyKey`, `resumeCursor`.
- Scheduler events: `queued`, `dequeued`, `lease_acquired`, `heartbeat`, `lease_expired`, `reclaimed`, `retry_backoff`, `cancelled`, `dependency_unblocked`.
- Resource admission events: sandbox slot, endpoint slot, model-load request, queue depth, VRAM/RAM/disk headroom, priority, background-vs-interactive.
- Tool replay events: tool input hash, result hash/ref, replayability, whether replay should reuse, simulate, skip, or reconfirm.
- Merge/review events: review started/finished, merge join started/finished, dependency cascade, downstream invalidation.
- Rollover/compaction for long histories, similar to "continue as new" patterns in durable workflow systems.

Why it matters for small models: if the controller cannot resume exactly and explain exactly what happened, it will re-ask a weak model to rediscover state. That wastes the model's weakest resource: coherent long-horizon memory.

Relevant sources:

- Temporal durable execution and event history: https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal
- LangGraph durable orchestration overview: https://docs.langchain.com/oss/python/langgraph/overview
- Runtime behind production deep agents: https://www.langchain.com/blog/runtime-behind-production-deep-agents

### 2. Add a first-class finite-state controller

The outer loop should not be free-form ReAct. ReAct is useful as a bounded inner loop for local tool use, but small models should not own global process transitions.

Suggested card/run states:

```text
intake
plan
validate_plan
localize
execute_step
observe
evaluate
repair
retry_or_split
review
merge_or_escalate
done
```

Controller responsibilities:

- Select state-specific context and tools.
- Set max tool calls and max wall time per state.
- Decide retry, split, replan, park, or escalate from evidence.
- Record every transition in the ledger.
- Prevent the model from skipping to repo mutation before localization/refinement when that phase is required.

This strengthens 5.AF and 5.AA rather than creating a new architecture track.

Relevant sources:

- ReAct: https://arxiv.org/abs/2210.03629
- StateFlow: https://arxiv.org/abs/2403.11322
- Anthropic, Building Effective Agents: https://www.anthropic.com/engineering/building-effective-agents
- Plan-and-Solve: https://arxiv.org/abs/2305.04091
- ReWOO: https://arxiv.org/abs/2305.18323
- LLMCompiler: https://arxiv.org/abs/2312.04511

### 3. Add deterministic repair kernels for bugfix-style cards

For bugfixes and regression repairs, research strongly supports a constrained pipeline over general agency:

```text
reproduce -> localize -> generate N candidates -> validate -> rank -> refine
```

Add as a 5.B or 5.AA work item:

- Reproduction tests as first-class artifacts: fail-before/pass-after where possible.
- AST/symbol/import/call-graph localization tools.
- Optional spectrum-based fault localization when tests exist.
- Patch candidates, not a single patch.
- Candidate ranking by repro pass, regression pass, typecheck/lint, diff size, touched-file plausibility, reviewer evidence, and learned priors.
- Phase-gated tools: localization cannot edit; patching sees chosen context; validation sees commands and structured failures.
- Ledger fields for localization candidates, patch candidates, validator results, refinement deltas, and final ranking rationale.

Why it matters: small models often fail by wandering. A deterministic repair kernel moves the hard orchestration into the harness and gives the model only narrow generative subtasks.

Relevant sources:

- SWE-agent ACI: https://arxiv.org/abs/2405.15793
- AutoCodeRover: https://arxiv.org/abs/2404.05427
- Agentless: https://arxiv.org/abs/2407.01489
- CodeAct: https://arxiv.org/abs/2402.01030

### 4. Strengthen per-card contracts and node-local repair semantics

The current DAG and graph validation are strong, but primitive cards need a richer contract so a small model can execute locally without rediscovering the global plan.

Add fields to generated card specs:

- `preconditions`
- `inputs`
- `expectedOutputs`
- `acceptanceChecks`
- `nonGoals`
- `filesLikelyTouched`
- `dependencyOutputsConsumed`
- `rollbackOrRepairHints`
- `downstreamInvalidationRules`

Add controller semantics:

- Retry same node.
- Refine node spec.
- Split node.
- Add missing dependency.
- Invalidate affected downstream nodes.
- Re-run reviewer.
- Global re-decompose only when local repair cannot restore coherence.

Relevant sources:

- HTN/SHOP2 planning: https://www.jair.org/index.php/jair/article/view/10362
- Task-Decoupled Planning: https://arxiv.org/html/2601.07577v1
- GoalAct hierarchical planning: https://arxiv.org/html/2504.16563v2

### 5. Narrow the tool interface for small models

Tool count and tool ambiguity are major failure drivers. The current spec has tool robustness and a tool manifest planned, but small-model optimization needs the manifest to drive a smaller offered tool set and better feedback.

Add:

- Two-phase tool use: first select `none | one_tool | plan_needed` from short tool cards, then reveal only the selected schema.
- Tool cards generated from the manifest: name, one-line purpose, use-when, do-not-use-when, examples, common recovery.
- Typed action-plan IR for multi-step tool workflows:

```json
{
  "stepId": "s1",
  "action": "read_file",
  "args": { "path": "src/foo.ts" },
  "dependsOn": [],
  "completionCriteria": "identify exported function signature"
}
```

- Result handles instead of bulk text: `result://search/42`, `result://test-output/7`.
- Semantic error contracts:

```json
{
  "code": "missing_required_field",
  "field": "path",
  "expected": "workspace-relative file path",
  "received": null,
  "retryable": true,
  "minimalValidExample": { "path": "src/index.ts" },
  "suggestedNextAction": "call read_file with a relative path"
}
```

- Grammar-constrained decoding for internal action IR where local runtime supports it.
- Provider/runtime schema profiles: smallest safe schema subset for LM Studio, llama.cpp grammar, OpenAI-compatible local servers, and fallback JSON repair.

Relevant sources:

- BFCL: https://proceedings.mlr.press/v267/patil25a.html
- Less is More tool reduction: https://arxiv.org/html/2411.15399v1
- TinyAgent: https://arxiv.org/html/2409.00608v3
- JSONSchemaBench: https://arxiv.org/html/2501.10868v1
- Anthropic tool design: https://www.anthropic.com/engineering/writing-tools-for-agents
- MCP tools spec: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- NVIDIA grammar-constrained Bash for small models: https://developer.nvidia.com/blog/improving-bash-generation-in-small-language-models-with-grammar-constrained-decoding/

### 6. Treat skills as validated procedural memory, not only prompt fragments

Section 5.AE currently frames skills mostly as prompt/context/tool bundles. That is useful, but the higher leverage for small models is a validated procedural skill bank built from successful and failed-then-repaired attempts.

Add a `ProceduralSkillBank`:

- `id`, `version`, `status: candidate | quarantined | active | deprecated`
- `sourceAttemptIds`
- `producerModel`
- `validatedConsumerModels`
- `roleScope`
- `taskFingerprint`
- `applicability`
- `activationConditions`
- `terminationConditions`
- `representation: lesson | workflow | script | patch_template | program_function`
- `requiredTools`
- `capabilityManifest`
- `validationSuite`
- effectiveness stats and false-activation stats

Pipeline:

```text
ledger attempts -> offline distillation -> candidate skill -> quarantine/eval -> scoped activation -> measure delta -> promote/deprecate
```

Rules:

- Never auto-activate generated skills.
- Promote only after deterministic replay/dev-test/protected-test validation and positive delta against no-skill baseline.
- Track negative transfer aggressively.
- Prefer executable helpers for repeatable repo analysis and validation; text playbooks are advisory and easier for weak models to ignore.
- Store cross-model transfer results, because procedural memory generated by stronger models can help weaker models if abstracted correctly.

Relevant sources:

- Voyager skill library: https://arxiv.org/abs/2305.16291
- Reflexion: https://arxiv.org/abs/2303.11366
- MemP procedural memory: https://arxiv.org/abs/2508.06433
- LightMem: https://arxiv.org/html/2604.07798v1
- AFTER procedural skill transfer benchmark: https://arxiv.org/html/2606.23127v1

### 7. Upgrade verification from pass/fail gates to diagnostic oracles

The current gates are good. The missing layer is diagnostic richness and flake/reliability measurement.

Add to 5.V / 5.O / 5.Z:

- Repeat-run reliability: 3 to 5 runs for selected small-model tasks, report `pass_all`, `pass_any`, flake rate, terminal-state failures.
- BFCL-style local tool probes for both chat and swarm paths: tool name, exact normalized args, no-call cases, irrelevant-tool avoidance, malformed format recovery.
- Hidden dev-test splits:
  - `fail_to_pass` for requested behavior.
  - `pass_to_pass` for regressions.
  - visible acceptance for developer ergonomics.
- Code retrieval qrels for selected dev-test projects: expected files/snippets, precision@k, recall@k, MRR, retrieved-vs-gold downstream success.
- WebArena-lite fixtures: self-hosted pages with forms/search/login/state and Playwright validators.
- Long-memory evals: update stale facts, preserve project constraints across restarts, abstain when evidence is missing.
- Failure injection: flaky command, missing dependency, bad URL, Docker restart, model drop, final-answer loop after successful work.
- Property-based checks on dev-test invariants where practical.
- Mutation testing or differential/metamorphic checks before self-improvement and backend-port-level milestones.
- Evidence-constrained reviewer verdicts: checks run, artifacts inspected, unresolved risks, hidden/protected/impact/property checks passed.

Relevant sources:

- SWE-bench: https://arxiv.org/abs/2310.06770
- SWE-bench Verified: https://www.swebench.com/verified.html
- AgentBench: https://arxiv.org/abs/2308.03688
- ToolBench: https://github.com/OpenBMB/ToolBench
- StableToolBench: https://arxiv.org/abs/2403.07714
- tau-bench: https://arxiv.org/abs/2406.12045
- WebArena: https://arxiv.org/abs/2307.13854
- OSWorld: https://arxiv.org/abs/2404.07972
- CORE-Bench: https://arxiv.org/html/2606.11864v1
- CodeRAG-Bench: https://arxiv.org/abs/2406.14497
- ALCE: https://github.com/princeton-nlp/ALCE
- RAGAS metrics: https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/

### 8. Add retrieved-evidence objects and citation verification

Section 5.AC has the right retrieval loop, but it needs a concrete evidence data model and evaluator.

Add `RetrievedEvidence`:

- URL or local file ref
- title
- source type
- author/publisher if known
- published/updated date
- fetchedAt
- package/version if applicable
- content hash
- trust tier
- freshness verdict
- extraction spans
- citation IDs
- prompt-injection risk flags

Retrieval should be an adaptive loop:

```text
knowledgeDebt/task -> query plan -> local repo vs online docs/research/issues -> retrieve/fetch -> relevance/sufficiency/freshness judgment -> cite or search again
```

Add citation verification:

- Every material claim maps to evidence spans.
- Unsupported claims lower confidence or force another retrieval.
- Freshness conflicts prefer newer docs/release notes, keep older sources as historical context.
- Record retrieval attempts, pruned distractors, citations, and whether retrieval helped or hurt into the ledger.

Relevant sources:

- BEIR: https://arxiv.org/abs/2104.08663
- Self-RAG: https://arxiv.org/abs/2310.11511
- FLARE: https://arxiv.org/abs/2305.06983
- FreshLLMs: https://arxiv.org/abs/2310.03214
- CodeRAG-Bench: https://arxiv.org/abs/2406.14497
- CORE-Bench: https://arxiv.org/html/2606.11864v1

### 9. Make memory one projection over the same substrate

The chat memory core is a good start, but the long-horizon agent memory story should be layered:

- Working memory: active state and current step.
- Episodic memory: immutable event/attempt ledger.
- Semantic memory: facts/preferences/project constraints extracted from episodes.
- Procedural memory: validated workflows/skills extracted from successful or repaired attempts.

Add:

- Turn budget allocator for system/invariants, objective/focus chain, current user message, recent transcript, overflow summary, semantic memories, episodic evidence, procedural skills, and tool definitions.
- All-loaded-project memory as namespaced access, not a shared boolean.
- Memory governance: provenance, scopes, deletion, contradiction replacement, recency/frequency/importance, reversible history.
- "Why recalled" surfacing for users.
- Internal LongMemEval-style tasks before broadening memory scope.

Relevant sources:

- CoALA cognitive architectures: https://arxiv.org/abs/2309.02427
- Generative Agents: https://arxiv.org/abs/2304.03442
- LongMemEval: https://openreview.net/pdf?id=pZiyCaVuti
- LightMem: https://arxiv.org/html/2604.07798v1
- Lost in the Middle: https://arxiv.org/abs/2307.03172

### 10. Add provenance/taint and egress/MCP policy to security

The strict Docker boundary is strong, but online retrieval, browser tools, MCP, and host-access chat create source/sink risks.

Add a capability broker between model and every tool:

Inputs:

- effective ruleset
- role
- source provenance
- tool trust
- current taint labels
- requested action
- target path/domain/server
- whether action is a sink

Outputs:

- allow
- deny
- one-time confirm
- require fresh trusted planning context

Taint labels:

- `repo_instruction`
- `web`
- `mcp`
- `private_repo`
- `secret_like`
- `user_trusted`
- `runtime_policy`

Rules:

- Repo instructions can guide style but never modify capabilities, approvals, network, secrets, or host access.
- Web/MCP content cannot trigger external network, MCP, file-write, git-delivery, or host actions without a trusted plan or confirmation.
- Remote MCP annotations are hints, not trust decisions.
- Egress needs a real broker: DNS/SNI/domain allowlist, deny IP literals and LAN by default, network-attempt audit, per-action approvals where needed.
- Audit security-relevant task-agent actions too, not just chat host actions: sandbox bash, file reads/writes, patch capture/apply, MCP calls, egress attempts, protected-path denials, approvals, model/session IDs, taint state.
- Consider hardening tier: rootless Docker/user namespaces, seccomp/AppArmor, pinned image digest/SBOM/signature, optional gVisor/Kata/microVM on Linux.

Relevant sources:

- Systems Security Foundations for Agentic Computing: https://arxiv.org/abs/2512.01295
- NVIDIA sandboxing guidance: https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/
- OWASP LLM01 Prompt Injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- NCSC prompt injection as confused deputy: https://www.ncsc.gov.uk/blog-post/prompt-injection-is-not-sql-injection
- OpenAI prompt-injection agent design: https://openai.com/index/designing-agents-to-resist-prompt-injection/
- AgentDojo: https://arxiv.org/abs/2406.13352
- OS-Harm: https://arxiv.org/abs/2506.14866
- Securing Agents With Tracked Capabilities: https://dl.acm.org/doi/10.1145/3786335.3813127

### 11. Make routing confidence- and resource-aware

Section 5.AB has the right model-fitness core. Add two refinements:

- Calibrated confidence must be computed from evidence, not model self-report.
- Local resource cost is the real cost: wall time, queue time, RAM/VRAM pressure, model load time, endpoint occupancy, thermal/energy proxy.

Add ledger fields:

- predicted route
- actual outcome
- verifier outcome
- uncertainty score
- selected rung
- queue/resource state
- accept/reject reason

Confidence signals:

- tool-call validity
- tests/acceptance evidence
- no-diff/loop signals
- semantic/sample disagreement
- reviewer verdict
- historical calibration by model x role x task-shape x tool-set-size x prompt family

Retry ladder:

```text
same model/simple retry
reduced tool set
constrained schema/grammar
native LM Studio endpoint if useful
prompt variant
context shrink/smart-zone
best-of-N/self-consistency
cross-model reviewer/carry
decompose/split
park/escalate
```

Runtime policy:

- Keep 5.Z full matrix for release confidence.
- At runtime, use cross-model debate/review selectively for high-risk or low-confidence outputs.
- Prefer different model families for reviewer/carry to reduce correlated errors.
- Optimize globally across queued cards so hard cards reserve strong models and easy cards drain through fast small models.

Relevant sources:

- NVIDIA SLM agents position paper: https://research.nvidia.com/labs/lpr/slm-agents/
- FrugalGPT: https://arxiv.org/abs/2305.05176
- RouteLLM: https://openreview.net/forum?id=8sSqNntaMr
- Hybrid LLM: https://proceedings.iclr.cc/paper_files/paper/2024/hash/b47d93c99fa22ac0b377578af0a1f63a-Abstract-Conference.html
- Language Model Cascades: https://arxiv.org/html/2404.10136v1
- SelfCheckGPT: https://arxiv.org/abs/2303.08896
- Semantic entropy: https://www.nature.com/articles/s41586-024-07421-0
- Self-consistency: https://arxiv.org/abs/2203.11171
- LM Studio API docs: https://lmstudio.ai/docs/developer/rest
- vLLM docs: https://docs.vllm.ai/

## Recommended backlog fold-in

Do not add a large new section. Fold these into existing sections:

### Fold into 5.AF

- Expand the Attempt Ledger into a workflow event log with leases, admission/resource events, idempotency keys, replay tool-result refs, and scheduler events.
- Build the lease-based durable scheduler before widening adaptive model selection.
- Add unified resource admission: board cap + sandbox pool + endpoint capacity + model load state + RAM/VRAM/disk + priority.
- Extend the tool manifest with state gating, replay mode, source/sink taint, and security audit facets.

### Fold into 5.AA

- Make the retry ladder a typed controller strategy table.
- Add calibrated confidence and failure capsules.
- Add automatic split/decompose as a retry rung.
- Add state-local ReAct loops only inside controller states.

### Fold into 5.AB

- Add confidence intervals and local-resource cost to model fitness.
- Add global scheduling across queued cards.
- Add BFCL-like per-model tool probes.
- Track behavior by model x role x task-shape x tool-set-size x endpoint x prompt family.

### Fold into 5.AE

- Add `ProceduralSkillBank`.
- Add candidate/quarantine/active/deprecated lifecycle.
- Add skill distillation from the ledger.
- Add per-model transfer and negative-transfer stats.

### Fold into 5.B / 5.V

- Add the deterministic repair kernel.
- Add hidden `fail_to_pass` and `pass_to_pass` test splits.
- Add repeat-run reliability and failure-injection suites.
- Add code retrieval qrels and grounded citation scoring.

### Fold into 5.AC / 5.L / security posture

- Add `RetrievedEvidence`.
- Add citation verification and freshness conflict handling.
- Add provenance/taint labels and a real egress broker.
- Wire MCP ruleset enforcement before tool exposure.

## Suggested implementation order

1. Update 5.AF design now: ledger as workflow event log plus attempt stream.
2. Implement pure ledger schemas/builders and append-only store.
3. Add idempotency/replay metadata to the tool manifest.
4. Build durable lease scheduler over the ledger.
5. Replace fragmented admission checks with a unified admission controller.
6. Add BFCL-style local tool probes and repeat-run smoke reliability.
7. Add deterministic repair kernel for bugfix cards.
8. Add hidden test split and failure-injection fixtures to dev-test projects.
9. Add procedural skill bank, but keep all learned skills quarantined until replay/dev-test validation.
10. Only then widen adaptive model routing and skill variation, because they will finally have trustworthy evidence.

## Subagent coverage

Research agents covered:

- Hierarchical decomposition and HTN/DAG planning.
- Control-flow architectures and state-machine orchestration.
- Tool/API design for small models.
- Memory systems and procedural memory.
- RAG, freshness, and source citation.
- Verification-driven agents and test oracles.
- Coding-agent implementation and repair kernels.
- Adaptive model routing.
- Agent benchmark/eval harnesses.
- Security/sandboxing/prompt-injection/MCP.
- Resource governance and durable scheduling.
- Procedural skill learning/distillation.

The convergent recommendation from all of them: build the substrate first, then make adaptive behavior a projection over that substrate.
