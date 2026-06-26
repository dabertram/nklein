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
