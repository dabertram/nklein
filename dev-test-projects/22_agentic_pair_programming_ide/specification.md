# 22 - Agentic Pair Programming IDE with Live Codebase Understanding

Complexity tier: 22/25
Expected decomposition size: 85-100 dependent implementation cards before coding.
Domain pressure: agentic IDEs, code intelligence, language-server orchestration, editor UX, context retrieval, test driving, refactoring safety, developer agency.
Acceptance command: npm test

## How to use this challenge
This is a large dev-test project specification for evaluating whether an autonomous coding agent can decompose a real agentic-software product, manage domain knowledge, preserve trust boundaries, and verify hard behavior with deterministic tests. The goal is not to finish the entire product. The goal is to build the foundation that would let a real product emerge without hiding the dangerous or difficult parts behind generic chat UI.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, identify architectural invariants, and choose a release slice that exercises the riskiest core behavior. Prefer fewer production-quality vertical slices over many shallow labels. If a requirement needs future expert review, standards research, or product-policy decisions, record it as knowledge debt and still build a defensible deterministic subset.

## Product vision
Build a serious agentic IDE foundation where a developer can ask for changes, inspect the agent plan, watch bounded edits, run verification, and recover safely. This is not a chat sidebar. It is an integrated development environment with codebase indexing, task decomposition, context assembly, tool execution, editable plans, checkpoints, and trust-preserving interaction design.

## Product users
- Professional developers working in large repositories where agent context must be curated carefully.
- Tech leads who want agent plans aligned with architecture, test strategy, and repository conventions.
- Developers who need reversible edits, explainable context selection, and low-friction verification loops.
- Teams that want local-model support without sending private code to hosted services.

## Foundation release scope
The first serious buildout must include:
- Workspace, project, file, symbol, diagnostic, test, task, plan step, context pack, tool call, edit operation, checkpoint, verification run, and user decision models.
- Codebase indexer that combines file tree, symbols, imports, test files, package metadata, recent changes, ownership hints, and documentation into a queryable local graph.
- Context builder that can assemble bounded context packs from task intent, relevant symbols, dependency paths, failing tests, open editor files, and explicit user pins.
- Agent plan editor with steps, dependencies, risk labels, required context, verification targets, and user-approved scope boundaries.
- Edit transaction system that applies structured patches, groups related file changes, detects conflicts with user edits, and supports checkpoint rollback.
- Verification orchestrator that chooses and runs focused checks, captures logs, links failures to plan steps, and updates task state.
- Live code intelligence bridge for diagnostics, references, rename impact, type errors, and quick-fix candidates through deterministic language-service fixtures.
- Interaction model for approve step, pause, redirect, reject patch, pin file, add constraint, ask for evidence, and continue from checkpoint.
- Local model routing boundary with token budget accounting, redaction, context compression, and fallback rules.
- Seed workspace with a medium TypeScript app, failing tests, stale docs, cross-file refactor, user edit conflict, and ambiguous architecture convention.

## Agentic subsystems that must be modeled explicitly
- Context provenance: every included file or excerpt must have a reason, source, freshness, and token cost.
- Plan-to-edit traceability: every edit operation should link back to a plan step and verification target.
- Conflict model: user edits during agent work must be preserved and surfaced as merge decisions, not overwritten.
- Diagnostic loop: type errors and test failures should update the agent plan instead of causing blind retry loops.
- IDE state projection: the UI should expose task state, checkpoints, modified files, running commands, and evidence without becoming a noisy transcript.
- Local-first privacy model: sensitive files, secrets, and ignored paths must be excluded by policy unless explicitly allowed.

## Architecture requirements
- Separate editor shell, repository index, context selection, model interface, tool runtime, patch engine, verification runner, and UI state projection.
- Make the patch engine independent of the LLM so edits can be diffed, validated, rejected, and replayed deterministically.
- Represent context packs as immutable snapshots with file hashes to detect stale reasoning.
- Keep verification logs structured with command, cwd, environment, duration, status, and failure signatures.
- Model user decisions as durable events so the IDE can resume after restart.
- Design the agent runtime as cancellable and resumable at plan-step boundaries.

## Domain knowledge debt to surface
The agent should not pretend to know every model, standard, protocol, or product-policy choice perfectly. It should mark assumptions, define testable subsets, preserve extension points, and keep expert-review needs visible. Required knowledge areas:
- An agentic IDE must protect developer agency; the user controls scope, edits, and verification tradeoffs.
- Language servers provide facts but not architecture judgment; the IDE must combine both carefully.
- Context selection is a product feature with provenance, freshness, and budget constraints.
- Patch application is a transactional workflow, not text pasted into files.
- Local-model support requires compression, routing, and recovery from weak model behavior.

## Required challenge scenarios
The implementation plan and fixtures should be shaped around scenarios like these. They do not all need full UI coverage in the first slice, but the core model should be capable of representing them:
- A user asks for a refactor that touches five files; the IDE must build a plan, pin relevant symbols, apply scoped patches, and run focused tests.
- The user edits one target file while the agent is working; the IDE must detect conflict and preserve the user change.
- A type error appears after a patch; the agent must link it to the plan step and repair the narrow cause.
- A requested change would require reading a secret file; the IDE must explain the privacy block and ask for explicit override.
- A small local model repeatedly requests the same file batch; the context manager must detect loops and provide a compressed synthesis instead.

## Decomposition pressure
This challenge should force decomposition across domain modeling, state machines, policy engines, trace or evidence capture, deterministic fixtures, security boundaries, recovery workflows, and UI/view-model projections. The plan should include dependency links so shared primitives, invariants, fixtures, and acceptance tests are built before dependent orchestration features. Avoid starting with screens or a chat transcript. Start with the facts, contracts, permissions, traces, and tests that would make later interaction trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, unsafe assumptions, model limitations, security boundaries, fixture limitations, terminology, user-experience tradeoffs, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Context packs list included files, excerpts, reasons, hashes, token cost, and freshness.
- Patch transactions can be applied, rejected, rolled back, and replayed from checkpoints.
- Verification orchestration maps failing commands back to plan steps and changed files.
- Conflict tests preserve concurrent user edits and require explicit resolution.
- Privacy policy tests exclude ignored files, secrets, and disallowed paths from model context.
- The project passes npm test using deterministic repository and language-service fixtures.

## Explicit non-goals
- Do not build only a chat panel in an editor frame.
- Do not let the model write arbitrary files outside approved scope.
- Do not hide why context was selected.
- Do not treat failed verification as generic conversation history.

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

> Added 2026-06-26 via deep domain research. **The single hardest, defining property of this project:** an agentic IDE must guarantee **developer agency and reversibility** — every byte the agent writes must be a transactional, attributable, *rejectable* operation that can never silently clobber a concurrent human edit, escape its approved scope, or read a forbidden file — and all of that must hold while the agent is driven by a small local model that misformats patches and loops. The product is not "a chat panel that edits files." It is a **transactional patch engine + context-provenance system** in which the LLM proposes and the deterministic machinery disposes, diffs, and rolls back.

This section adds the load-bearing architecture, grounds it in real IDE/agent practice, and makes the determinism/governance spine concrete. It is coherent with the master-challenge philosophy in `36_dark_factory_dschinn_universal_agent` (deterministic simulation, capability/taint model, evidence graph, global invariants) specialized to an agentic IDE.

## E0. The meta-test: what "good" means here

The naive version is a chat sidebar that writes files. It is untestable (live LLM, live language server, live FS races) and it is *dangerous*: it overwrites the line the developer just typed, reads `.env`, or thrashes in a retry loop on a malformed patch. The disciplined version treats the **repository, the language service, and the model as deterministic fixtures**, makes **patch application a transaction** independent of the LLM, and makes **context selection an inspectable, provenance-carrying artifact**. The grading rubric:

1. **Determinism** — same fixture workspace + same fixture language-service + same model fixture + same seed ⇒ identical context packs, plan, patches, and verification results. No `Date.now()`, no network, no live model, no FS race.
2. **Reversibility & agency** — every edit belongs to a checkpoint and can be applied, rejected, rolled back, and replayed; the developer controls scope, edits, and verification tradeoffs; nothing the agent does is irreversible without explicit approval.
3. **Conflict safety** — a concurrent human edit to a target file is *never* lost; it surfaces as a merge decision, not an overwrite.
4. **Provenance & privacy** — every file/excerpt in a context pack has a reason, source, freshness, hash, and token cost; secret/ignored/disallowed files are excluded by policy and require an explicit, audited override to include.

Everything below serves those four — and they are exactly what makes a *weak local model* safe to pair with: it is fenced by a transaction boundary and a provenance gate, not trusted to behave.

## E1. Research-grounded domain authenticity

Fold these real mechanisms in — they are what a professional IDE and a serious coding agent actually do:

- **Agent–Computer Interface (ACI) discipline (SWE-agent).** Reliability comes from interface design, not model size: a **windowed file viewer (~100 lines/turn)**, **lint-before-apply guardrails that reject syntactically broken edits**, **search that lists matching files without dumping confusing per-match context**, and **explicit "ran, no output" feedback**. The IDE's edit transaction and verification loop must adopt this. Sources: https://swe-agent.com/0.7/background/aci/ , https://arxiv.org/abs/2405.15793 .
- **Repo-map / symbol-graph context selection (aider).** The authentic mechanism for "bounded context pack from task intent" is a **tree-sitter symbol graph ranked by personalized PageRank** (biased ~50× toward the user's pinned/open files and the failing-test symbols), trimmed to a token budget. This *is* the context builder. Sources: https://aider.chat/2023/10/22/repomap.html , https://deepwiki.com/Aider-AI/aider/4-repository-understanding-and-context .
- **Edit formats and the architect/editor split (aider).** Patches come in distinct formats with real tradeoffs for weak models: **whole-file** (robust but wasteful), **SEARCH/REPLACE diff** (efficient but breaks on delimiter collisions/ambiguous matches), **unified diff** (reduces "lazy elision"), **diff-fenced** (for models that mis-fence). The **architect/editor pattern** — a stronger/planner model emits plain-language change intent, a cheaper/local **editor model** turns it into a syntactically valid diff — is the canonical way to get reliable edits from weak models, and maps directly onto this product's local-model routing boundary. Sources: https://aider.chat/docs/more/edit-formats.html , https://www.morphllm.com/edit-formats/diff-format-explained .
- **SEARCH/REPLACE apply + fuzzy fallback failure modes.** When an exact search block fails, real tools (RooCode) do **middle-out fuzzy matching** (Levenshtein-scored, thresholded) — but this introduces a *reliability risk* the patch engine must handle explicitly: ambiguous matches and delimiter collisions must **fail loudly** (→ `requires-human-review`), never apply to the wrong location. Source: https://www.morphllm.com/edit-formats/diff-format-explained .
- **Language Server Protocol (LSP) is the source of code *facts*.** Diagnostics, `textDocument/references`, `textDocument/rename` (returns a single atomic `WorkspaceEdit`), `workspace/symbol`, semantic tokens, and `codeAction` quick-fixes are JSON-RPC requests with typed results and a **capabilities** handshake (not every server supports every request). Model the live-code-intelligence bridge on these exact request shapes and the capability negotiation. Crucially: LSP gives *facts*, not *architecture judgment* — the IDE combines both. Sources: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/ , https://amirteymoori.com/lsp-language-server-protocol-ai-coding-tools/ .
- **Secret/ignored-file exclusion (gitleaks model).** The privacy policy that keeps secrets out of model context is **regex rules + Shannon-entropy scoring** (high-entropy strings = likely credentials; `your_api_key_here` placeholders score low and pass), plus `.gitignore`/deny-glob exclusion. This is the deterministic basis for "this file is secret, block it from context." Sources: https://github.com/gitleaks/gitleaks , https://starlog.is/articles/cybersecurity/gitleaks-gitleaks/ .
- **Event-stream-as-source-of-truth (OpenHands).** Model the IDE's durable state as an append-only event log of actions/observations/decisions; replaying it reconstructs the whole session — the basis for resume-after-restart and for plan-step-boundary cancel/resume. Source: https://arxiv.org/html/2407.16741v3 .
- **Scaffold taxonomy vocabulary.** Name the modules using the coding-agent scaffold taxonomy: context management, action/tool space, control flow, verification & feedback, memory. Source: https://arxiv.org/pdf/2604.03515 .

## E2. The hardest technical seams (named)

1. **The patch engine is LLM-independent (the spine).** An `EditOperation` is a typed structural patch (`{format, targetFile, baseHash, hunks|wholeContent, planStepRef, verificationTargetRef}`) that the engine **parses, validates, applies, diffs, rejects, rolls back, and replays** with *no* model in the loop. The model only *produces candidate text*; the engine owns truth. This is what makes edits diffable and reversible — and it's the seam most demos skip.
2. **The 3-way conflict model against live human edits (agency spine).** Every target file is captured with a `baseHash` when the agent's plan step begins. Before apply, the engine re-reads the on-disk file; if its hash changed (the human edited it), the engine performs a **three-way merge (base, human, agent)** and routes non-trivially-overlapping changes to an explicit **merge decision** — it never overwrites the human edit. Borrow the entity-level/AST-aware merge insight (false conflicts from line-based merges) and degrade gracefully to a conflict decision when uncertain. Sources: https://git-scm.com/docs/git-merge , https://github.com/ataraxy-labs/weave .
3. **Context packs as immutable, provenance-carrying snapshots.** A `ContextPack` is an immutable snapshot: ordered list of `{path, excerptRange, reason, source ∈ pin|symbol-graph|failing-test|dependency-path|open-editor, freshnessTs, contentHash, tokenCost}` + total budget. **Stale-reasoning detection:** if a referenced file's current hash ≠ the pack's recorded hash, the agent is reasoning over stale code and must rebuild — a tested behavior. "Why was this included?" is answered from the pack, never from prose.
4. **The privacy boundary as a hard gate (taint spine).** Files matching deny-globs, `.gitignore`, or the gitleaks-style secret detector are `forbidden`. A request whose context would include a forbidden file does **not** silently drop it and proceed — it **blocks, explains the privacy reason, and requires an explicit, audited owner override** before that file can enter any model packet. A secret reaching the model boundary without an override is a hard error.
5. **The diagnostic loop that updates the plan, not a blind retry.** When a patch produces a new type error or test failure, the verification orchestrator links the failure (command, cwd, env, duration, status, **failure signature**) back to the originating **plan step** and **changed files**, and the agent *updates the plan step* (narrow repair) rather than re-submitting the same edit. Loop/repeat detection short-circuits blind retries.
6. **Local-model routing with budget, redaction, compression, and loop-breaking.** The routing boundary accounts tokens, redacts secrets, **compresses context when a small model repeatedly requests the same file batch** (detect the loop → inject a synthesized summary instead of the raw files again), and falls back per policy. This is the architect/editor split made operational. Source: https://aider.chat/docs/more/edit-formats.html .

## E3. Determinism & testability strategy (non-negotiable)

- **Virtual clock + seeded entropy.** No `Date.now()`/`setTimeout`/`Math.random()` in core. Freshness, debounce, ordering, and any retry timing read an injected clock + single seeded PRNG. Same `(seed, fixtureWorkspace, fixtureLSP, modelFixture)` ⇒ byte-identical context packs, plan, patches, verification.
- **Fixture workspace + fixture language service + fixture model (the world is data).** `Workspace`/`RepoIndex`, `LanguageService` (returns canned diagnostics/references/rename `WorkspaceEdit`s keyed by file hash), and `ModelClient` are interfaces with deterministic fixture implementations in-repo and live adapters behind the same interface. The seed workspace ships: a medium TS app, failing tests, stale docs, a cross-file refactor target, a **prepared user-edit conflict**, an ambiguous architecture convention, and a `.env`/secret file for the privacy test.
- **Golden context packs + golden patches.** Tests assert the exact included files, excerpt ranges, reasons, hashes, token costs, and the exact structural patch produced for a given task fixture + model fixture. A "degraded model" fixture (malformed SEARCH/REPLACE, narrated tool calls, repeated file-batch requests) must still yield a *safe* outcome: a rejected/`requires-human-review` patch and a loop-broken compressed context — never a wrong-location apply.
- **Event-sourced decision log + resume test.** User decisions (approve step, reject patch, pin, add constraint, override privacy, continue-from-checkpoint) are durable events; a restart replays them and reconstructs IDE state. Cancel/resume is tested at plan-step boundaries.
- **Deterministic verification runs.** Verification logs are structured `{command, cwd, env, duration(virtual), status, failureSignature}`; fixtures map commands → canned logs so "failing command → plan step → changed file" linkage is exact and replayable. Borrow VCR/cassette discipline (content-addressed; fail-fast on missing fixture). Source: https://github.com/vcr/vcr .

## E4. The small/weak-local-model crux (the !Klein north star)

The IDE is built to pair a developer with a **small, quantized, fallible local model** and stay safe and productive:

- **The transaction boundary makes a fallible model safe.** A malformed/over-broad edit is *rejected by the engine*, not written. The model cannot escape approved scope because the engine enforces scope, not the prompt.
- **Architect/editor decomposition for reliable edits.** Plan in natural language (cheaper to get right), then have the editor stage emit a *validated* diff; if the diff fails to apply or lints dirty, repair narrowly or escalate — never paste broken text. Source: https://aider.chat/docs/more/edit-formats.html .
- **Loop detection → synthesis, not re-fetch.** Repeated identical file-batch requests (a hallmark of small models with compacted context) trigger a compressed synthesis injection — a required, tested behavior straight from the base spec's challenge scenario.
- **Weak-model output errors are parsed and recovered, not re-prompted** (narrated tool calls, malformed JSON patches), consistent with the host product's philosophy. A test deliberately degrades the model and asserts agency/reversibility/conflict-safety all still hold.
- **Confidence-aware verification budget.** Route low-confidence or high-blast-radius steps to *more* verification (broader focused test set) and to human approval; a correctly-uncertain model that asks for evidence/approval is the success case. Source: https://arxiv.org/pdf/2601.07264 .

## E5. Adversarial, failure, and edge-case scenarios (concrete, testable)

Each ships as a deterministic fixture and must produce the correct, reversible outcome + audit:

- **Concurrent human edit:** the developer edits the same target file mid-plan-step. Expected: hash mismatch → three-way merge → explicit merge decision; the human change is preserved; no overwrite.
- **Secret-file pull:** a requested refactor's context would include `.env`/a high-entropy credential file. Expected: privacy block, explanation, require explicit audited override; without override, the file never enters a model packet.
- **Malformed/ambiguous patch:** the model emits a SEARCH block matching two locations / colliding with delimiters. Expected: engine refuses to guess → `requires-human-review`, original files untouched.
- **Post-patch type error:** a patch introduces a narrow type error. Expected: failure linked to its plan step + changed file; agent makes a *narrow* repair, not a blind resubmission or a broad rewrite.
- **Out-of-scope write attempt:** the model proposes editing a file outside the approved plan scope. Expected: hard refusal + audit; scope is enforced by the engine.
- **Repeated file-batch loop:** a small model requests the same 3-file batch in alternating turns. Expected: loop detected → compressed synthesis injected → progress resumes (no thrash).
- **Stale-context guard:** a file changes after a context pack was built; the agent's next action references it. Expected: hash mismatch → pack rebuild before acting (no reasoning over stale code).
- **Verification-theater repair:** a "fix" that makes a failing test pass by deleting the assertion. Expected: flagged/rejected (coverage/assertion check), consistent with reward-hacking taxonomy. Source: https://arxiv.org/html/2604.15149 .

## E6. Rigorous acceptance criteria, including property-based / invariant tests

Beyond the base spec's example-based criteria, assert these **invariants** with property-based + differential tests over randomized + scripted runs:

1. **Context-pack determinism & provenance totality** — same task fixture + model fixture + seed ⇒ identical pack; *every* included excerpt has reason+source+hash+freshness+tokenCost; total tokenCost ≤ budget. (Property-tested.)
2. **No-clobber (agency invariant)** — for any interleaving of agent apply and a concurrent human edit to the same file, the human's bytes are never lost; overlapping changes always produce a merge decision. (Fuzz the interleaving.)
3. **Transaction reversibility** — for any sequence of applied edits, rolling back to a checkpoint restores byte-identical workspace state; replay from the checkpoint reproduces it. (Property-tested.)
4. **Scope containment** — no `EditOperation` ever writes a path outside the approved plan scope; an attempt is refused + audited. (Totality.)
5. **Privacy non-leak** — no forbidden (secret/ignored/deny-globbed) file ever appears in a model packet without a recorded override event. (Differential test: scan every emitted packet against the deny set.)
6. **Stale-reasoning guard** — no action executes against a context pack whose referenced hashes no longer match the workspace. (Invariant.)
7. **Plan↔edit↔verification traceability** — every `EditOperation` links to a plan step and a verification target; every verification failure links back to a plan step and changed file. (Graph totality.)
8. **Loop-breaking** — a repeated identical file-batch request count above K triggers exactly one synthesis injection and does not re-emit the raw batch. (Property-tested.)
9. **Apply safety** — an ambiguous/colliding SEARCH block is never applied; it always becomes `requires-human-review` with the original files unchanged.

## E7. The concrete first vertical slice (the on-ramp — build THIS first, ~35–45 cards)

Prove the spine on **one** fixture workspace and **one** five-file refactor task plus the **prepared conflict** and **secret** fixtures:

1. **Determinism core + event-sourced decision log + checkpoints** (virtual clock, seeded PRNG, append-only decisions, snapshot/restore) (~7 cards).
2. **Repo index + context builder** (tree-sitter symbol graph → personalized PageRank → budgeted immutable context pack with full provenance + stale-hash detection) (~7 cards).
3. **Patch engine (LLM-independent)** (typed `EditOperation`, SEARCH/REPLACE + whole-file apply, fuzzy fallback that fails loudly on ambiguity, lint-before-apply, scope containment, rollback/replay) (~8 cards).
4. **3-way conflict model** (baseHash capture, pre-apply re-read, three-way merge, explicit merge decision) (~6 cards).
5. **Privacy gate** (gitleaks-style secret detector + deny-globs + `.gitignore`; block→explain→audited-override) (~5 cards).
6. **LSP fixture bridge + verification orchestrator** (diagnostics/references/rename `WorkspaceEdit` fixtures; structured verification logs; failure→plan-step linkage; diagnostic loop updates plan) (~7 cards).
7. **Local-model routing + plan editor** (architect/editor split, token accounting, redaction, loop-detection→synthesis) (~6 cards).
8. **Invariants E6 (1–9) green** on this slice, including the concurrent-edit, secret-file, ambiguous-patch, and loop fixtures, under `npm test` with no network/live model.

If that slice holds, broad IDE UI, more languages, and live LSP/model adapters are breadth on a proven spine.

## E8. Domain knowledge-debt to track (surface, don't bluff)

- **Three-way merge semantics for code are subtle.** Line-based merges invent false conflicts; entity/AST-aware merging reduces them but is language-specific. Ship a defensible line+hash conflict model now; mark AST-level merge as expert-review extension. Source: https://github.com/ataraxy-labs/weave .
- **Secret detection has false negatives/positives.** Entropy+regex misses obfuscated secrets and flags some non-secrets; the deny-set and entropy threshold are documented, tunable knobs, not certainties. Source: https://arxiv.org/pdf/2410.23657 .
- **LSP capability variance.** Not all language servers implement all requests; the bridge must negotiate capabilities and degrade. Source: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/ .
- **Edit-format reliability is model-dependent.** Which format is most reliable depends on the model (udiff variants help smaller models; some models mis-fence). Track per-model format selection as a tunable routing decision. Sources: https://arxiv.org/html/2510.12487v1 , https://aider.chat/docs/more/edit-formats.html .
- **Privacy of agent artifacts.** Prompts, context packs, tool I/O, and patches are first-class product data with retention/redaction concerns; model retention as policy.
- **Benchmark caveat.** SWE-bench Verified is increasingly contaminated and may not predict this product's pair-programming workload; prefer in-repo fixtures as ground truth. Source: https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ .

## E9. Why this is a great !Klein challenge

It stresses **decomposition** (determinism core → context provenance → patch transaction → conflict model → privacy gate → verification loop → routing), **determinism under weak models** (the engine is deterministic; the model is fenced and its garbage is rejected), **governance** (scope containment + privacy non-leak + audit + reversibility as tested invariants), and **trust-preserving restraint** (no-clobber and stale-reasoning guards). It is the cleanest demonstration of the thesis that a *weak local model becomes a safe pair-programmer when the IDE owns the transaction boundary and the provenance, and the model merely proposes.* A swarm can build it seam-by-seam, each with a crisp invariant and a deterministic fixture.

---

## Small-model build guide (3B-ready)

This section makes the project mechanically buildable by a 3B local model with minimal reasoning. The model follows; this guide does the thinking. All acceptance tests run offline with zero live dependencies.

### 1. Glossary & ground rules

**Domain terms**
- **EditOperation**: a typed structural patch `{format, targetFile, baseHash, hunks|wholeContent, planStepRef, verificationTargetRef}`. The LLM produces candidate text; the patch engine owns truth.
- **baseHash**: `sha256` of the target file's content at the moment the plan step began. Used for conflict detection.
- **CheckpointId**: an opaque string identifying a point in the edit transaction log from which the workspace can be restored byte-identically.
- **ContextPack**: an immutable snapshot — ordered list of `{path, excerptRange, reason, source, freshnessTs, contentHash, tokenCost}` plus a total `tokenBudget`. Every included file has a reason.
- **PlanStep**: `{id, description, dependsOn, riskLabel, requiredContext, verificationTargetRef, status}`.
- **MergeDecision**: the user-facing record of a 3-way conflict between base/human/agent versions of a file. Never auto-resolved.
- **PrivacyBlock**: the event raised when a file matching a deny-glob or secret detector is requested for model context. Requires an explicit audited override.
- **FixtureWorkspace**: a deterministic in-repo directory `test/fixtures/workspace/` containing TypeScript source files for testing.
- **FixtureLSP**: a deterministic implementation of `LanguageService` returning canned diagnostics/references from JSON files.
- **FixtureModel**: a deterministic implementation of `ModelClient` keyed by `sha256(contextPackHash)` → canned patch text.
- **SEARCH/REPLACE format**: a patch format where the model emits a block with `<<<<<<< SEARCH` and `>>>>>>> REPLACE` delimiters.
- **Loop detection**: when a model requests the same file batch K times without progress, inject a synthesized summary instead of the raw files.

**Stack**
- Language: TypeScript (strict mode, no `any`)
- Runtime: Node.js 20+
- Test runner: Vitest (`npm test` runs `vitest run`)
- Key libraries: `tree-sitter` + `tree-sitter-typescript` for symbol graph; `zod` for schemas; `fast-check` for property tests
- No live LSP server, no live model, no network, no `Date.now()`, no `Math.random()` in core

**Acceptance command** (project root):
```
npm test
```

**Determinism rules (imperative)**
1. Never call `Date.now()`, `new Date()`, `setTimeout`, or `Math.random()` in `src/`. Use injected `Clock` and `Prng`.
2. Never import a live language-server or model client in `src/core/`, `src/patch/`, `src/context/`, `src/privacy/`. Use adapter interfaces.
3. All fixture files live in `test/fixtures/`. Throw (do not fetch) on a missing fixture.
4. Same `(seed, fixtureWorkspace, fixtureLSP, modelFixture)` ⇒ byte-identical context packs, plan, patches, verification.
5. `npm test` must pass from a cold clone with no environment variables set.

---

### 2. The explicit task graph for the FIRST vertical slice

The first slice (≈ 38 cards) proves the spine on **one fixture workspace** (5-file TypeScript app) with **one refactor task** plus the **prepared user-edit conflict** and **secret-file** fixtures. Build in this exact order.

---

**`S01` — Core types & interfaces**
dependsOn: none
files: `src/types.ts`
interface:
```typescript
export type EditFormat = "search-replace" | "whole-file" | "unified-diff";
export type PlanStatus = "pending" | "in-progress" | "done" | "failed" | "cancelled";
export type MergeDecisionStatus = "pending" | "human-chose-theirs" | "human-chose-ours" | "human-merged";
export type PrivacyBlockReason = "deny-glob" | "gitignore" | "high-entropy-secret";
export interface Clock { now(): number; }
export interface Prng { next(): number; }
export interface EditOperation {
  id: string; format: EditFormat; targetFile: string; baseHash: string;
  searchBlock?: string; replaceBlock?: string; wholeContent?: string;
  planStepRef: string; verificationTargetRef: string;
}
export interface PlanStep {
  id: string; description: string; dependsOn: string[];
  riskLabel: "low"|"medium"|"high"; requiredContextPaths: string[];
  verificationTargetRef: string; status: PlanStatus;
}
export interface ContextEntry {
  path: string; excerptRange: [number, number] | null;
  reason: string; source: "pin"|"symbol-graph"|"failing-test"|"dependency-path"|"open-editor";
  freshnessTs: number; contentHash: string; tokenCost: number;
}
export interface ContextPack {
  id: string; entries: ContextEntry[]; totalTokenCost: number; tokenBudget: number;
}
```
how to implement: create `src/types.ts`; define every type above; export all.
acceptance: `test/types.test.ts` imports each export; asserts `typeof EditOperation !== "undefined"` (smoke). `npm test` green.

---

**`S02` — Virtual clock & seeded PRNG**
dependsOn: `S01`
files: `src/clock.ts`, `src/prng.ts`, `test/clock.test.ts`, `test/prng.test.ts`
interface:
```typescript
export class FixedClock implements Clock { constructor(private ts: number) {} now() { return this.ts; } }
export class SeededPrng implements Prng {
  constructor(private seed: number) {}
  next(): number { /* xorshift32 */ }
}
```
how to implement: same xorshift32 approach as in project 21. Test that `SeededPrng(99)` called 3 times returns the same sequence every run.
acceptance: deterministic sequence asserted.

---

**`S03` — Append-only event log & checkpoints**
dependsOn: `S01`, `S02`
files: `src/event-log.ts`, `test/event-log.test.ts`
interface:
```typescript
export type IdeEvent =
  | { type: "edit-applied"; payload: EditOperation; ts: number }
  | { type: "edit-rejected"; payload: { opId: string; reason: string }; ts: number }
  | { type: "user-decision"; payload: { kind: string; data: unknown }; ts: number }
  | { type: "checkpoint"; payload: { checkpointId: string; workspaceSnapshot: Record<string, string> }; ts: number };
export class EventLog {
  constructor(private clock: Clock) {}
  append(event: Omit<IdeEvent, "ts">): void {}
  snapshot(checkpointId: string): Record<string, string> | undefined {}  // returns workspace at that checkpoint
  events(): readonly IdeEvent[] {}
}
```
how to implement:
1. Store events in a private array; stamp `ts = clock.now()`.
2. `snapshot(checkpointId)` finds the most recent `checkpoint` event with matching `checkpointId`; returns its `workspaceSnapshot`.
3. Test: append an edit, then a checkpoint, then another edit. `snapshot(id)` returns the workspace state at the checkpoint (not the later edit).
acceptance: checkpoint lookup returns the right snapshot; events array is frozen.

---

**`S04` — Content hash utility**
dependsOn: none
files: `src/hash.ts`, `test/hash.test.ts`
interface:
```typescript
export function sha256Hex(content: string): string {}
export function hashWorkspace(files: Record<string, string>): string {}
// hashWorkspace: sort keys, hash concatenation of "path:hash\n" pairs
```
how to implement: use `crypto.createHash("sha256")`. Test that the same string always produces the same hash. Test that two different strings produce different hashes.
acceptance: deterministic hashes; `npm test` green.

---

**`S05` — Fixture workspace**
dependsOn: `S04`
files: `test/fixtures/workspace/src/app.ts`, `test/fixtures/workspace/src/user.ts`, `test/fixtures/workspace/src/db.ts`, `test/fixtures/workspace/src/utils.ts`, `test/fixtures/workspace/src/config.ts`, `test/fixtures/workspace/.env`
interface: none (fixture files)
how to implement:
1. Create 5 TypeScript files forming a minimal layered app (app → user, user → db, db → config, utils standalone). Each file has 20–40 lines.
2. `app.ts`: imports from `user.ts`, has `function main()`.
3. `user.ts`: exports `interface User { id: string; email: string; }` and `function getUser(id: string): User`.
4. `db.ts`: exports `function queryDb(sql: string): unknown[]`.
5. `config.ts`: exports `const DB_URL = "postgres://localhost/app"`.
6. `utils.ts`: exports `function formatDate(ts: number): string`.
7. `.env`: contains `API_KEY=sk-test-abc123` (high-entropy secret for the privacy test).
acceptance: all 6 files exist; `test/fixtures/workspace/.env` contains `API_KEY=`.

---

**`S06` — Fixture LSP adapter**
dependsOn: `S01`, `S05`
files: `src/adapters/lsp-fixture-adapter.ts`, `test/fixtures/lsp/diagnostics.json`, `test/fixtures/lsp/references.json`, `test/fixtures/lsp/rename-workspace-edit.json`
interface:
```typescript
export interface LanguageService {
  getDiagnostics(file: string, content: string): Promise<Diagnostic[]>;
  getReferences(file: string, symbol: string): Promise<Reference[]>;
  getRenameEdit(file: string, symbol: string, newName: string): Promise<WorkspaceEdit>;
}
export interface Diagnostic { file: string; line: number; message: string; severity: "error"|"warning"; }
export interface Reference { file: string; line: number; symbol: string; }
export interface WorkspaceEdit { changes: Record<string, Array<{range:[number,number,number,number]; newText: string}>>; }
export class LspFixtureAdapter implements LanguageService {
  constructor(private fixturesDir: string) {}
  // reads JSON files; keyed by file+symbol; throws on missing
}
```
how to implement:
1. Create `test/fixtures/lsp/diagnostics.json`: `{"src/user.ts": [{"line":5,"message":"Type 'string' is not assignable to 'number'","severity":"error"}]}`.
2. Create `test/fixtures/lsp/references.json`: `{"src/user.ts:getUser": [{"file":"src/app.ts","line":3,"symbol":"getUser"}]}`.
3. Create `test/fixtures/lsp/rename-workspace-edit.json`: `{"src/user.ts:getUser:getUserById": {"changes":{"src/app.ts":[{"range":[3,0,3,7],"newText":"getUserById"}]}}}`.
4. Adapter reads and returns the canned data.
5. Test: `getDiagnostics("src/user.ts", "...")` returns the canned diagnostic.
acceptance: fixture loads; missing key throws; no network.

---

**`S07` — Tree-sitter symbol graph & personalized PageRank context builder**
dependsOn: `S04`, `S05`
files: `src/context/symbol-graph.ts`, `src/context/pagerank.ts`, `test/symbol-graph.test.ts`
interface:
```typescript
export interface SymbolNode { name: string; file: string; startLine: number; endLine: number; }
export interface SymbolGraph {
  nodes: SymbolNode[];
  edges: Array<{from: string; to: string}>; // "file:symbol" → "file:symbol"
}
export function buildSymbolGraph(files: Record<string, string>): SymbolGraph {}
export function personalizedPageRank(
  graph: SymbolGraph,
  pinnedFiles: string[],  // 50x weight bias
  maxNodes: number
): SymbolNode[] {}
```
how to implement:
1. `buildSymbolGraph`: use tree-sitter to extract all function/class/interface definitions and import relationships.
2. `personalizedPageRank`: implement a simplified 10-iteration PageRank where pinned-file nodes start with 50× weight; return top `maxNodes` by final rank.
3. Test: build graph from fixture workspace; pinning `src/app.ts` should rank `getUser` (imported by app) in top 3.
acceptance: symbol graph has >5 nodes from the fixture workspace; PageRank with `app.ts` pinned returns `getUser` in results.

---

**`S08` — Immutable ContextPack builder**
dependsOn: `S01`, `S02`, `S04`, `S07`
files: `src/context/context-builder.ts`, `test/context-builder.test.ts`
interface:
```typescript
export function buildContextPack(opts: {
  pinnedFiles: string[]; failingTestFiles: string[];
  workspace: Record<string, string>; symbolGraph: SymbolGraph;
  tokenBudget: number; clock: Clock;
}): ContextPack {}
export function isContextPackStale(pack: ContextPack, currentWorkspace: Record<string, string>): boolean {}
```
how to implement:
1. `buildContextPack`: run `personalizedPageRank`; select top symbols up to `tokenBudget`; for each selected file, create a `ContextEntry` with `contentHash = sha256Hex(workspace[file])`, `reason = "symbol-graph"`, `tokenCost = Math.ceil(content.length / 4)`.
2. `isContextPackStale`: for each entry, recompute `sha256Hex(currentWorkspace[entry.path])` — if any differs from `entry.contentHash`, return `true`.
3. Test: build a pack; mutate one workspace file; assert `isContextPackStale` returns `true`.
4. Test: same workspace, same inputs → identical pack (determinism).
acceptance: stale detection works; pack is deterministic with same seed.

---

**`S09` — Secret detector & privacy gate**
dependsOn: `S01`, `S04`
files: `src/privacy/secret-detector.ts`, `src/privacy/privacy-gate.ts`, `test/privacy-gate.test.ts`
interface:
```typescript
export function detectSecret(content: string): boolean {}
// Shannon entropy > 4.5 AND length > 20 AND matches /[A-Za-z0-9+/=_\-]{20,}/ → true

export interface PrivacyGateResult { allowed: boolean; reason?: PrivacyBlockReason; }
export function checkPrivacyGate(
  filePath: string, content: string,
  denyGlobs: string[], gitignorePaths: string[]
): PrivacyGateResult {}
```
how to implement:
1. Shannon entropy: `H = -Σ p(c) * log2(p(c))` over character frequencies. If H > 4.5 and string matches the regex → secret.
2. `checkPrivacyGate`: deny-glob match (use `minimatch`) → `{allowed:false, reason:"deny-glob"}`; gitignore path → `{allowed:false, reason:"gitignore"}`; secret detected → `{allowed:false, reason:"high-entropy-secret"}`.
3. Test: `API_KEY=sk-test-abc123` in `.env` → detected as secret.
4. Test: `const x = "hello"` → not a secret.
5. Test: a file in `.gitignore` → blocked with `reason:"gitignore"`.
acceptance: all three test cases pass; `npm test` green.

---

**`S10` — Context pack privacy filter**
dependsOn: `S08`, `S09`
files: `src/context/context-privacy-filter.ts`, `test/context-privacy-filter.test.ts`
interface:
```typescript
export interface PrivacyFilterResult {
  pack: ContextPack; blockedPaths: Array<{path: string; reason: PrivacyBlockReason}>;
}
export function applyPrivacyFilter(
  pack: ContextPack, workspace: Record<string, string>,
  denyGlobs: string[], gitignorePaths: string[]
): PrivacyFilterResult {}
```
how to implement:
1. For each entry in `pack.entries`, run `checkPrivacyGate`.
2. If blocked: remove from pack, add to `blockedPaths`.
3. The returned pack never contains a forbidden file.
4. Test: a pack containing `.env` → `.env` removed; `blockedPaths` has one entry with `reason:"high-entropy-secret"`.
5. Test: a file not matching any deny pattern → included unchanged.
acceptance: privacy non-leak invariant: `.env` never appears in the filtered pack.

---

**`S11` — Patch engine: SEARCH/REPLACE apply**
dependsOn: `S01`, `S04`
files: `src/patch/patch-engine.ts`, `test/patch-engine.test.ts`
interface:
```typescript
export type ApplyResult =
  | { status: "applied"; newContent: string; newHash: string }
  | { status: "ambiguous"; reason: string }
  | { status: "not-found"; reason: string }
  | { status: "requires-human-review"; reason: string };

export function applySearchReplace(
  originalContent: string, searchBlock: string, replaceBlock: string
): ApplyResult {}

export function applyWholeFile(replaceBlock: string): ApplyResult {}
```
how to implement:
1. `applySearchReplace`: find `searchBlock` in `originalContent`. If not found → `"not-found"`. If found more than once → `"ambiguous"`. If found exactly once → replace and return `"applied"`.
2. `applyWholeFile`: always returns `"applied"` with `newContent = replaceBlock`.
3. Test: exact match → `"applied"`.
4. Test: search block not present → `"not-found"`.
5. Test: search block present twice → `"ambiguous"`.
acceptance: all three test cases green; ambiguous match NEVER applies to the wrong location.

---

**`S12` — Patch engine: scope containment**
dependsOn: `S01`, `S11`
files: `src/patch/scope-guard.ts`, `test/scope-guard.test.ts`
interface:
```typescript
export function assertInScope(filePath: string, approvedPaths: Set<string>): void {
  // throws Error("out-of-scope write: " + filePath) if not in approvedPaths
}
export function applyEditWithScopeCheck(
  op: EditOperation, approvedPaths: Set<string>,
  workspace: Record<string, string>
): ApplyResult {}
```
how to implement:
1. `assertInScope`: if `filePath` not in `approvedPaths` → throw.
2. `applyEditWithScopeCheck`: call `assertInScope` first, then dispatch to `applySearchReplace` or `applyWholeFile`.
3. Test: applying to an out-of-scope file throws.
4. Test: applying to an in-scope file succeeds.
acceptance: scope containment enforced; out-of-scope attempt throws and leaves workspace unchanged.

---

**`S13` — Patch engine: lint-before-apply (TypeScript syntax check)**
dependsOn: `S11`
files: `src/patch/lint-guard.ts`, `test/lint-guard.test.ts`
interface:
```typescript
export function lintTypeScript(content: string): { valid: boolean; errors: string[] } {}
```
how to implement:
1. Use tree-sitter to parse the content; if parsing produces an `ERROR` node at the top level → invalid.
2. If the content contains an unmatched `{` or `(` — count open/close parens — → invalid.
3. Test: valid TS function → `{valid: true}`.
4. Test: `"function foo( {"` (unmatched paren) → `{valid: false}`.
acceptance: both cases green; syntactically broken edits are rejected before apply.

---

**`S14` — Rollback and checkpoint restore**
dependsOn: `S03`, `S04`, `S11`, `S12`
files: `src/patch/rollback.ts`, `test/rollback.test.ts`
interface:
```typescript
export function createCheckpoint(log: EventLog, workspaceSnapshot: Record<string, string>): string {
  // appends a checkpoint event, returns checkpointId
}
export function restoreCheckpoint(
  log: EventLog, checkpointId: string
): Record<string, string> | undefined {}
```
how to implement:
1. `createCheckpoint`: generates `checkpointId = sha256Hex(JSON.stringify(workspaceSnapshot))`, appends a `checkpoint` event, returns the id.
2. `restoreCheckpoint`: finds the checkpoint event in the log; returns the stored workspace snapshot.
3. Test: apply 2 edits, create checkpoint, apply 2 more, restore → workspace matches the snapshot at the checkpoint.
4. Test: replaying all events from the checkpoint reproduces the same workspace.
acceptance: byte-identical restore from checkpoint; replay produces the same result.

---

**`S15` — 3-way conflict model**
dependsOn: `S01`, `S04`, `S11`
files: `src/patch/conflict-model.ts`, `test/conflict-model.test.ts`
interface:
```typescript
export type ConflictResult =
  | { kind: "clean"; mergedContent: string }
  | { kind: "merge-decision"; decision: MergeDecision };
export interface MergeDecision {
  filePath: string; baseContent: string; humanContent: string; agentContent: string;
  status: MergeDecisionStatus;
}
export function threeWayMerge(opts: {
  filePath: string; baseContent: string; humanContent: string; agentContent: string;
}): ConflictResult {}
```
how to implement:
1. If `humanContent === baseContent` (human made no change) → `{kind:"clean", mergedContent: agentContent}`.
2. If `agentContent === baseContent` (agent made no change) → `{kind:"clean", mergedContent: humanContent}`.
3. If both changed AND the changed ranges overlap (same line numbers modified) → `{kind:"merge-decision"}`.
4. If both changed AND non-overlapping lines → attempt a simple line-level merge: apply both diffs; if successful → `{kind:"clean"}`, else → `{kind:"merge-decision"}`.
5. Test: only human changed → clean (agent's version).
6. Test: only agent changed → clean (agent's version applied).
7. Test: both changed the same line → `"merge-decision"`.
acceptance: human change is NEVER lost in any test case; concurrent edit always surfaces `"merge-decision"` when lines overlap.

---

**`S16` — Pre-apply conflict check**
dependsOn: `S04`, `S11`, `S15`
files: `src/patch/pre-apply-check.ts`, `test/pre-apply-check.test.ts`
interface:
```typescript
export type PreApplyResult =
  | { action: "apply"; content: string }
  | { action: "merge-decision"; decision: MergeDecision }
  | { action: "reject-stale-base"; reason: string };
export function preApplyCheck(
  op: EditOperation, currentContent: string
): PreApplyResult {}
```
how to implement:
1. Compute `currentHash = sha256Hex(currentContent)`.
2. If `currentHash === op.baseHash` → proceed to apply (no human edit).
3. If `currentHash !== op.baseHash` → a human edit occurred; load base content from the checkpoint; call `threeWayMerge`.
4. Test: base hash matches → `"apply"`.
5. Test: base hash mismatches (human edit) → `"merge-decision"`.
acceptance: no-clobber invariant: human edit always triggers `"merge-decision"`, never `"apply"`.

---

**`S17` — Fixture workspace user-edit conflict fixture**
dependsOn: `S05`, `S16`
files: `test/fixtures/conflict/user-edit.json`
interface: none (fixture)
how to implement:
1. Create `test/fixtures/conflict/user-edit.json` with: `{baseHash: "<hash_of_app.ts>", humanEdit: "// human was here\n" + <app.ts content>, agentEdit: <app.ts with a refactored function>}`.
2. The `baseHash` must be the real `sha256Hex` of the fixture `app.ts` content.
3. Test: load this fixture, call `preApplyCheck` with mismatched hash → `"merge-decision"` returned.
acceptance: the conflict fixture triggers the no-clobber path every time.

---

**`S18` — Fixture model adapter (recorded trace)**
dependsOn: `S01`, `S04`, `S08`
files: `src/adapters/model-fixture-adapter.ts`, `test/fixtures/model-responses.json`, `test/model-fixture-adapter.test.ts`
interface:
```typescript
export interface ModelClient {
  proposeEdit(contextPack: ContextPack, instruction: string): Promise<string>;
  // returns candidate patch text (SEARCH/REPLACE or whole-file format)
}
export class ModelFixtureAdapter implements ModelClient {
  constructor(private goldenPath: string) {}
  // key = sha256Hex(contextPack.id + "|" + instruction)
  // throws if key missing
}
```
how to implement:
1. Create `test/fixtures/model-responses.json` with at least 2 entries (one for the refactor task, one for the loop-detection synthesis).
2. `proposeEdit`: hash `contextPack.id + "|" + instruction`; look up; throw on missing.
3. Test: valid context pack + instruction → returns canned patch text.
4. Test: unknown input → throws with the hash in the message.
acceptance: fixture lookup works; missing key throws; no network.

---

**`S19` — Loop detection & synthesis injection**
dependsOn: `S01`, `S08`, `S18`
files: `src/routing/loop-detector.ts`, `test/loop-detector.test.ts`
interface:
```typescript
export class LoopDetector {
  constructor(private threshold: number) {} // e.g. 3 repetitions
  record(batchFingerprint: string): void {}
  isLooping(batchFingerprint: string): boolean {}
  reset(batchFingerprint: string): void {}
}
export function computeBatchFingerprint(requestedPaths: string[]): string {
  // sort paths, sha256Hex(paths.join(","))
}
```
how to implement:
1. Track `Map<fingerprint, count>`.
2. `record`: increment count.
3. `isLooping`: return `count >= threshold`.
4. `reset`: set count to 0.
5. Test: record the same fingerprint 3 times → `isLooping` returns `true`.
6. Test: record 3 different fingerprints → none are looping.
7. Test: advancing calls (different paths each time) never trigger loop detection.
acceptance: loop detected at threshold; distinct requests never false-trigger.

---

**`S20` — Token budget accounting & context redaction**
dependsOn: `S08`, `S09`
files: `src/routing/token-budget.ts`, `test/token-budget.test.ts`
interface:
```typescript
export function accountTokens(pack: ContextPack, budget: number): ContextPack {
  // trim entries from the pack so totalTokenCost <= budget; preserve highest-PageRank entries
}
export function redactSecrets(content: string): string {
  // replace high-entropy substrings matching secret pattern with "[REDACTED]"
}
```
how to implement:
1. `accountTokens`: sort entries by decreasing `tokenCost` value (proxy for importance); greedily include until budget; return trimmed pack.
2. `redactSecrets`: find substrings matching `/[A-Za-z0-9+/=_\-]{20,}/g` with entropy > 4.5; replace with `"[REDACTED]"`.
3. Test: a pack with total cost 2000 trimmed to budget 1000 — assert `totalTokenCost <= 1000`.
4. Test: `redactSecrets("API_KEY=sk-test-abc123456789xyz")` → contains `"[REDACTED]"`.
acceptance: budget honored; secret redacted from context.

---

**`S21` — Verification orchestrator (fixture-based)**
dependsOn: `S01`, `S02`, `S06`
files: `src/verification/verification-orchestrator.ts`, `test/fixtures/verification-runs.json`, `test/verification-orchestrator.test.ts`
interface:
```typescript
export interface VerificationRun {
  command: string; cwd: string; status: "passed"|"failed"; durationMs: number;
  failureSignature: string | null; changedFiles: string[];
}
export interface VerificationLog {
  runs: VerificationRun[]; planStepRef: string; linkedChangedFiles: string[];
}
export class VerificationOrchestrator {
  constructor(private fixturesDir: string, private clock: Clock) {}
  runChecks(planStepRef: string, changedFiles: string[]): VerificationLog {}
}
```
how to implement:
1. Create `test/fixtures/verification-runs.json` with canned command results (2 passing, 1 failing).
2. `runChecks`: look up canned results by command; stamp `durationMs` using clock; link `failureSignature` to `changedFiles`.
3. Test: a failing run → `VerificationLog` contains a run with `status:"failed"` and the `planStepRef` set.
4. Test: failure is linked back to the correct `changedFiles`.
acceptance: verification results are deterministic; failure-to-plan-step linkage works.

---

**`S22` — Plan editor with diagnostic loop update**
dependsOn: `S01`, `S21`
files: `src/plan/plan-editor.ts`, `test/plan-editor.test.ts`
interface:
```typescript
export class PlanEditor {
  constructor(private steps: PlanStep[]) {}
  getStep(id: string): PlanStep | undefined {}
  updateStepStatus(id: string, status: PlanStatus): void {}
  narrowRepair(failedStepId: string, failureSig: string): PlanStep {}
  // creates a new sub-step linked as repair for the failed step
  allSteps(): PlanStep[] {}
}
```
how to implement:
1. `narrowRepair`: creates a new `PlanStep` with `id = failedStepId + "-repair"`, `dependsOn = [failedStepId]`, `description = "Repair: " + failureSig`.
2. Test: a type error after a patch → `narrowRepair` creates a repair step referencing the failed step.
3. Test: updating step status to `"done"` is reflected in `allSteps()`.
acceptance: plan updates reactively to diagnostics; repair step links correctly.

---

**`S23` — Integration test: 5-file refactor task**
dependsOn: `S03`–`S22`
files: `test/integration/refactor-task.test.ts`
interface: none
how to implement:
1. Set up: load fixture workspace, fixture LSP, fixture model.
2. Build a context pack with `src/user.ts` pinned.
3. Apply privacy filter — `.env` must be excluded.
4. Create a plan with 2 steps (rename `getUser` → `getUserById` in `user.ts` and `app.ts`).
5. Propose edit via fixture model → SEARCH/REPLACE patch.
6. Apply patch with scope check (only `user.ts` and `app.ts` in scope).
7. Run verification → canned result.
8. Create a checkpoint.
9. Assert: context pack has `src/user.ts` and `src/app.ts`; `.env` absent; patch applied; checkpoint exists.
acceptance: end-to-end refactor completes; privacy gate excludes `.env`; scope gate allows only the two planned files.

---

**`S24` — Integration test: concurrent user edit (no-clobber)**
dependsOn: `S15`, `S16`, `S17`, `S23`
files: `test/integration/concurrent-edit.test.ts`
interface: none
how to implement:
1. Load the `user-edit` conflict fixture.
2. Start a plan step with `baseHash` = hash of original `app.ts`.
3. Simulate human edit: change `app.ts` content so its hash differs.
4. Attempt to apply the agent's patch.
5. Assert: `preApplyCheck` returns `"merge-decision"`.
6. Assert: the human's bytes are present in `decision.humanContent`.
7. Assert: the original file is NOT overwritten.
acceptance: no-clobber invariant holds; human edit is preserved as a merge decision.

---

**`S25` — Integration test: secret-file privacy block**
dependsOn: `S09`, `S10`, `S23`
files: `test/integration/secret-file.test.ts`
interface: none
how to implement:
1. Attempt to include `.env` in the context pack.
2. Run privacy filter.
3. Assert: `.env` is in `blockedPaths` with `reason: "high-entropy-secret"`.
4. Assert: the filtered pack contains no entry with `path` ending in `.env`.
5. Assert: a `PrivacyBlock` event is in the event log.
acceptance: secret never reaches the model; event log records the block.

---

**`S26` — Integration test: ambiguous patch → requires-human-review**
dependsOn: `S11`, `S13`, `S23`
files: `test/integration/ambiguous-patch.test.ts`
interface: none
how to implement:
1. Create a fixture file with the `searchBlock` text appearing twice.
2. Call `applySearchReplace` with that file and a SEARCH block matching both occurrences.
3. Assert: result is `"ambiguous"`.
4. Assert: the original file is UNCHANGED.
acceptance: ambiguous match never applies; files untouched.

---

**`S27` — Integration test: loop detection → synthesis injection**
dependsOn: `S19`, `S20`, `S23`
files: `test/integration/loop-detection.test.ts`
interface: none
how to implement:
1. Set `LoopDetector` threshold to 3.
2. Simulate the same file-batch request 3 times (same `computeBatchFingerprint` result).
3. On the 3rd call, `isLooping` returns `true`.
4. Assert: a synthesis summary is injected instead of the raw batch.
5. Assert: `record` is called 3 times with the same fingerprint; `isLooping` is `true` on the 3rd.
acceptance: loop is detected at exactly 3 repetitions; synthesis is injected.

---

**`S28` — Context-pack determinism property test**
dependsOn: `S08`
files: `test/property/context-pack-determinism.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate random sets of pinned files (subsets of the 5 fixture files) and budgets.
2. Call `buildContextPack` twice with the same inputs.
3. Assert the two packs are `JSON.stringify`-equal.
4. Run with 200 examples.
acceptance: byte-identical packs for all 200 examples.

---

**`S29` — No-clobber property test**
dependsOn: `S15`, `S16`
files: `test/property/no-clobber.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate random `{baseContent, humanEdit, agentEdit}` strings where `humanEdit !== baseContent`.
2. Compute `op.baseHash = sha256Hex(baseContent)`, `currentContent = humanEdit`.
3. Assert `preApplyCheck` never returns `{action:"apply"}` when `sha256Hex(humanEdit) !== op.baseHash`.
4. Run with 300 examples.
acceptance: human edit is never silently overwritten in any fuzz case.

---

**`S30` — Transaction reversibility property test**
dependsOn: `S03`, `S14`
files: `test/property/transaction-reversibility.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate sequences of 1–5 edits (random content) and a checkpoint position.
2. Create checkpoint at position K, apply more edits, then restore.
3. Assert workspace matches the K-th snapshot byte-identically.
4. Run with 200 examples.
acceptance: restore is always byte-identical to the checkpoint snapshot.

---

**`S31` — Scope containment property test**
dependsOn: `S12`
files: `test/property/scope-containment.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate random `{approvedPaths: string[], attemptedPath: string}` where `attemptedPath` is NOT in `approvedPaths`.
2. Assert `assertInScope(attemptedPath, approvedPaths)` always throws.
3. Run with 300 examples.
acceptance: no out-of-scope write ever succeeds.

---

**`S32` — Privacy non-leak property test**
dependsOn: `S09`, `S10`
files: `test/property/privacy-non-leak.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate random context packs including `.env` in some entries.
2. Apply `applyPrivacyFilter` with `.env` in deny-globs.
3. Assert no entry in the filtered pack has `path` ending in `.env`.
4. Run with 200 examples.
acceptance: forbidden files never appear in the filtered pack.

---

**`S33` — Loop-breaking property test**
dependsOn: `S19`
files: `test/property/loop-breaking.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate random batches. Repeat the same fingerprint exactly `threshold` times, then a different one.
2. Assert: looping is detected at exactly `threshold`; the different fingerprint is NOT a loop.
3. Fuzz threshold from 2–5.
4. Run with 200 examples.
acceptance: loop detection fires at exact threshold; distinct requests never false-trigger.

---

**`S34` — Stale-context guard property test**
dependsOn: `S08`
files: `test/property/stale-context.test.ts`
interface: none
how to implement:
1. Use `fast-check`: build a context pack; generate a mutation to one workspace file.
2. Assert `isContextPackStale` returns `true` after the mutation.
3. Assert `isContextPackStale` returns `false` when no file changes.
4. Run with 200 examples.
acceptance: stale reasoning is always detected.

---

**`S35` — Apply-safety property test**
dependsOn: `S11`
files: `test/property/apply-safety.test.ts`
interface: none
how to implement:
1. Use `fast-check`: generate a SEARCH block that appears 0 or 2+ times in random content.
2. Assert: 0 occurrences → `"not-found"`. 2+ occurrences → `"ambiguous"`. Original content unchanged.
3. Run with 200 examples.
acceptance: ambiguous/missing search blocks never apply.

---

**`S36` — Plan↔edit↔verification traceability test**
dependsOn: `S21`, `S22`
files: `test/integration/traceability.test.ts`
interface: none
how to implement:
1. After the refactor integration test: assert every `EditOperation` has a non-empty `planStepRef`.
2. Assert every `VerificationRun` has a non-empty `planStepRef`.
3. Assert every failing run's `failureSignature` is linked to a `changedFiles` entry.
acceptance: no orphaned edits or verification runs.

---

**`S37` — npm test wiring**
dependsOn: `S01`–`S36`
files: `package.json`, `vitest.config.ts`, `tsconfig.json`
how to implement: same as project 21. `npm test` runs `vitest run`; strict TypeScript. `npm test` exits 0.
acceptance: all tests pass; no skipped tests.

---

**`S38` — Knowledge-debt register**
dependsOn: `S37`
files: `KNOWLEDGE_DEBT.md`
how to implement: list the 6 items from E8 (3-way merge semantics, secret detection FN/FP, LSP capability variance, edit-format model-dependence, artifact privacy, benchmark caveat) with risk level, action gate, and mitigation.
acceptance: file exists; `npm test` still green.

---

### 3. The decomposition method for the rest

**Recipe** (same pattern as project 21):
1. Identify the feature; find its new types (card N+0).
2. Create the fixture file(s) (card N+1).
3. Implement the pure core function (card N+2).
4. Write the unit test (card N+3 or merged with N+2).
5. Add a property test if there is an invariant (card N+4).
6. Wire into an integration test (card N+5).
7. State explicit dependsOn for every card.

**Worked example A — Live LSP adapter**
- `LA01` — Define `TypeScriptLspAdapter implements LanguageService` using `vscode-languageserver` library. dependsOn: `S06`.
- `LA02` — Ensure `npm test` still uses only the fixture adapter (live adapter exercised by `npm run test:live` only). dependsOn: `LA01`.
- `LA03` — Test: interface conformance (fixture and live adapter implement identical `LanguageService` shape). dependsOn: `LA02`.

**Worked example B — Unified diff format support**
- `UD01` — Add `"unified-diff"` to `EditFormat` in `src/types.ts`. dependsOn: `S01`.
- `UD02` — Implement `applyUnifiedDiff(content: string, patch: string): ApplyResult` in `src/patch/unified-diff-apply.ts`. dependsOn: `UD01`, `S11`.
- `UD03` — Test with a fixture unified diff that adds 3 lines. dependsOn: `UD02`.
- `UD04` — Property: an ambiguous unified diff (matches multiple locations) → `"requires-human-review"`. dependsOn: `UD03`.

**Worked example C — Post-patch type-error diagnostic loop**
- `DE01` — Extend `VerificationOrchestrator` to return LSP diagnostics after apply. dependsOn: `S21`, `S06`.
- `DE02` — Extend `PlanEditor.narrowRepair` to consume a `Diagnostic` and create a targeted repair step. dependsOn: `S22`, `DE01`.
- `DE03` — Integration test: introduce a type error via a bad patch → verification returns the diagnostic → `narrowRepair` creates a repair step. dependsOn: `DE02`.

---

### 4. Per-task implementation conventions

**File layout**
```
src/
  types.ts           # all shared types/interfaces
  clock.ts           # FixedClock
  prng.ts            # SeededPrng
  hash.ts            # sha256Hex, hashWorkspace
  event-log.ts       # EventLog
  adapters/          # LspFixtureAdapter, ModelFixtureAdapter
  context/           # symbol-graph, pagerank, context-builder, context-privacy-filter
  patch/             # patch-engine, scope-guard, lint-guard, rollback, conflict-model, pre-apply-check
  privacy/           # secret-detector, privacy-gate
  routing/           # loop-detector, token-budget
  verification/      # verification-orchestrator
  plan/              # plan-editor
test/
  fixtures/          # workspace/, lsp/, model-responses.json, conflict/, verification-runs.json
  integration/       # end-to-end tests
  property/          # fast-check property tests
  *.test.ts          # unit tests
```

**Test snippet**
```typescript
// test/patch-engine.test.ts
import { describe, it, expect } from "vitest";
import { applySearchReplace } from "../src/patch/patch-engine.js";

describe("applySearchReplace", () => {
  it("returns ambiguous when search block appears twice", () => {
    const content = "foo\nbar\nfoo\n";
    const result = applySearchReplace(content, "foo", "baz");
    expect(result.status).toBe("ambiguous");
  });
});
```

**Definition of done for any card**
1. `npm test` green.
2. No `any` types.
3. No live LSP, model, or network calls in tests.
4. Every fixture file committed to repo.
5. Every exported function has an explicit TypeScript return type.
6. The card has exactly one responsibility.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1 — Overwriting the human edit (no-clobber violation)**
A 3B model may implement `applyEditWithScopeCheck` without calling `preApplyCheck` first, directly replacing the file. The `S24` and `S29` tests will catch this.
Fix: ALWAYS call `preApplyCheck` before any apply. If the base hash mismatches, route to `threeWayMerge`. Never write a file without a hash check.

**Pitfall 2 — Using `Date.now()` for context pack freshness**
A 3B model may write `freshnessTs: Date.now()` in `buildContextPack`. This makes the stale-context test flaky.
Fix: pass `clock.now()` everywhere. Grep for `Date.now` before committing.

**Pitfall 3 — Missing the entropy threshold in `detectSecret`**
A 3B model may implement `detectSecret` with only a regex (no entropy check), causing `const apiUrl = "https://api.example.com/v1/users"` to be treated as a secret.
Fix: the entropy threshold (4.5) is the load-bearing guard against false positives. Test both high-entropy secrets AND normal strings.

**Pitfall 4 — Applying an ambiguous SEARCH block to the first match**
A 3B model may implement `applySearchReplace` to apply at the first occurrence when the block matches multiple times. This silently corrupts the file.
Fix: count occurrences BEFORE replacing. If count > 1 → return `"ambiguous"`. Never apply. The `S26` and `S35` tests enforce this.

**Pitfall 5 — Forgetting `planStepRef` on EditOperation**
A 3B model may create `EditOperation` objects without setting `planStepRef`, making the traceability test (`S36`) fail.
Fix: `planStepRef` is required in the `EditOperation` type. Any function that creates an `EditOperation` must accept a `planStepRef` parameter.

**Pitfall 6 — Loop detection keying on content instead of batch fingerprint**
A 3B model may key loop detection on file content rather than path fingerprint. A file that changes content between turns would then not be recognized as the same loop.
Fix: `computeBatchFingerprint` keys on sorted path names only, not content. Two requests for `["src/user.ts", "src/app.ts"]` in different orders produce the SAME fingerprint.

**Pitfall 7 — Creating fixture files at test runtime instead of committing them**
A 3B model may write code that auto-generates `test/fixtures/model-responses.json` on first run by calling an LLM. This breaks CI.
Fix: all fixture files must be committed to the repo before `npm test` runs. The fixture adapter THROWS (never fetches) on a missing key.
