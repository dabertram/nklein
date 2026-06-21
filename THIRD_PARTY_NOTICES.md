# Third-party notices & attribution

!Klein is licensed under **Apache-2.0** (see `LICENSE`). This file records (1) the deliberate decision to grow
!Klein beyond a Cline-SDK-only runtime into its own native agent core, and (2) every external agent/tool whose
**ideas or code** influenced !Klein, with each project's license and how it was used. We respect every
upstream license; where a license is incompatible with Apache-2.0 redistribution we take **no code** from it.

## Architectural decision (2026-06-21)

!Klein began as a thin layer over the Cline SDK (`@clinebot/*`). Live dev-test runs surfaced limits of that
boundary for small/quantized local models — most importantly that the SDK's LLM layer forwards only
`temperature`/`max_tokens`/`stop` and cannot send grammar / JSON-schema constrained decoding or `min_p` /
`top_k` / `repetition_penalty`. Rather than fork the SDK (which the upstream-clean invariant forbids), we
decided to build **!Klein's own agent core** (`src/agent-core/`) on top of our own local model client
(`src/cline-sdk/cline-local-llm-client.ts`), and to adopt the best implementations from the wider local-agent
ecosystem directly into our codebase. The Cline SDK remains supported as one runtime; it is no longer the only
one.

How we adopt third-party work:
- We **re-implement concepts in TypeScript** against our own interfaces rather than copying source verbatim.
- We **attribute** the originating project here for every adopted technique.
- We **never copy code from a license incompatible with Apache-2.0 redistribution** (notably AGPL-3.0).

## Projects studied and adopted

| Project | License | Compatible with Apache-2.0 distribution? | Used |
| --- | --- | --- | --- |
| Cline (`@clinebot/core`, `@clinebot/llms`, `@clinebot/shared`, `@clinebot/agents`) | Apache-2.0 | Yes | Yes — bundled SDK + one supported runtime |
| aider (`Aider-AI/aider`) | Apache-2.0 | Yes | Yes — concepts re-implemented in TS |
| Roo Code (`RooCodeInc/Roo-Code`) | Apache-2.0 | Yes | Concepts |
| Continue (`continuedev/continue`) | Apache-2.0 | Yes | Concepts |
| OpenHands (`All-Hands-AI/OpenHands`) | MIT | Yes | Concepts |
| Open Interpreter (`OpenInterpreter/open-interpreter`) | **AGPL-3.0** | **No** | **Concepts only — NO code copied** |

### aider — Apache-2.0
- **Adopted (code re-implemented in TS):** the edit-block *fuzzy search/replace fallback ladder* — exact →
  whitespace-flexible (dedent/re-indent) → leading-blank tolerance → `...` elision → closest-window fuzzy match
  (≥0.8 similarity). Our implementation: `src/cline-sdk/cline-fuzzy-edit.ts` (`edit_file` tool). Modeled on
  aider's `aider/coders/editblock_coder.py`.
- **Adopted (concepts):** plain-text edit formats beat function-call formats for weak models; reflection/retry
  with test-error feedback (already in !Klein's acceptance-repair loop).

### Roo Code — Apache-2.0
- **Adopted (concepts):** lenient/fuzzy diff application and multi-block search/replace as the primary edit
  path for small models; corrective feedback on a failed edit. Realized in `cline-fuzzy-edit.ts` / `edit_file`.

### Continue — Apache-2.0
- **Adopted (concepts):** retrieval/context-provider model (repo map + code index + hybrid search feeding a
  small context window). Realized in !Klein's existing `cline-repo-map.ts` / `cline-code-index.ts` /
  `cline-code-search.ts`.

### OpenHands — MIT
- **Adopted (concepts):** memory **condensation** to keep long runs within a small window (our opt-in
  selective compression, `cline-prompt-compression.ts`); separating code-acceptance from workflow-completion
  outcomes (our `dev-test-outcome.ts`).

### Open Interpreter — AGPL-3.0 (code excluded)
- We reviewed it for ideas only (interactive local code execution UX). **No Open Interpreter code is present in
  !Klein**, because AGPL-3.0 is incompatible with !Klein's Apache-2.0 licensing. Any overlapping capability is
  independently implemented.

## Academic techniques (papers, not project code)

These are implemented from published research, independent of the projects above:
- Grammar / JSON-schema **constrained decoding** — "Guiding LLMs The Right Way" (arXiv:2403.06988). Realized in
  `cline-local-llm-client.ts` (`response_format` / grammar) + `cline-tool-argument-repair.ts` (post-hoc).
- **min-p sampling** (arXiv:2407.01082) — `cline-sampling-policy.ts` / `cline-local-llm-client.ts`.
- **Self-consistency** (arXiv:2203.11171) — best-of-N decomposition, `cline-decomposition-selection.ts`.
- **LLMLingua-2** prompt compression (arXiv:2403.12968) — `cline-prompt-compression.ts`.
- **ReAct** tool-use loop (arXiv:2210.03629) — `src/agent-core/agent-loop.ts`.

## Maintenance rule

When adopting another technique or any code from an external project, add it here with the project, its
license, and what was taken — in the same change. Never add code from a license incompatible with Apache-2.0.
