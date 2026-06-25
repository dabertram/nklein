# Codebase Anti-Pattern Findings

Date: 2026-06-26

Scope: first-party code in `src/`, `web-ui/src/`, `packages/desktop/src/`, `test/`, `web-ui/tests/`, and `scripts/`. Excluded `vendor/`, `node_modules/`, build output, and generated/dev fixture code except where relevant to a repeated pattern.

Method: static whole-repo scan plus targeted source validation. No tests were run for this document-only review.

## Executive Summary

- The highest-risk finding is the chat host-action model: "sandboxed" chat scopes are implemented as host filesystem and host shell access rooted at a workspace path, with broad session-level acknowledgement for unsafe commands.
- The largest maintainability drag is a set of oversized coordination modules and UI components that mix state, orchestration, validation, persistence, and presentation.
- Several repo principles are being undercut by broad lint disables, inline/dynamic imports in production TypeScript, duplicated policy constants, and unvalidated JSON casts.
- Test coverage exists, but repeated hand-rolled Playwright/tRPC mocks and brittle DOM selectors increase drift risk.

## Findings

### 1. High: Chat "sandboxed" scopes are implemented with host-side shell and filesystem access

Evidence:

- `web-ui/src/components/chat/chat-sidebar.tsx:38` has a TODO noting `host_access` should be gated behind a global setting or typed confirmation, but the scope is still available in the UI.
- `web-ui/src/components/chat/chat-sidebar.tsx:49` includes `project_sandboxed`, `all_projects`, and `host_access` in `CAN_ACT_SCOPES`.
- `src/chat/chat-session-store.ts:36` defaults new chat sessions to `project_sandboxed`, not `chat_only`.
- `src/trpc/runtime-api.ts:440` maps `chat_only` to `isolated_readonly`, `host_access` to `host`, and every other actionable scope to `sandbox_with_host_escape`.
- `src/trpc/runtime-api.ts:445` constructs workspace read/board/focus tools directly from `workspacePath`.
- `src/trpc/runtime-api.ts:450` adds the command tool whenever `session.scope !== "chat_only"`.
- `src/chat/chat-command-tool.ts:70` runs commands with `spawn(command, { cwd, shell: true })`.
- `src/trpc/runtime-api.ts:473` auto-approves commands classified as safe, and `src/trpc/runtime-api.ts:489` allows unsafe actions whenever `session.riskAcknowledged === true`.
- `src/chat/chat-workspace-tools.ts` uses host `readFile`/`writeFile` while reporting actions as `sandbox_read` and `sandbox_write`.

Why this matters:

The naming suggests a sandbox boundary, but the implementation is host execution and host filesystem access constrained by workspace path and policy checks. That mismatch is a security and UX risk: a user may grant "sandboxed" chat action assuming Docker-style isolation, while the code can execute a shell command on the host. The session-level `riskAcknowledged` flag also turns later unsafe command confirmations into a broad opt-in.

Suggested remediation:

- Rename or redefine non-Docker chat scopes so the UI and audit labels do not imply container isolation unless the execution is actually containerized.
- Gate `host_access` behind an explicit global setting plus typed confirmation, as the existing TODO suggests.
- Make unsafe command approval per-action or narrowly scoped by command fingerprint instead of a session-wide boolean.
- Consider reusing the Docker `AgentSandboxManager` boundary for chat command execution, or make host execution a visibly separate privileged mode.
- Add tests that assert scope-to-executor mapping, audit `actionKind`, and approval behavior for safe, unsafe, browser, and write actions.

### 2. High: Oversized coordination modules concentrate too many responsibilities

Evidence:

- `web-ui/src/components/runtime-settings-dialog.tsx` is 4,430 lines. It contains UI rendering, provider/model loading, many local state fields (`:1782`), unsaved-change diffing (`:2139`), reset synchronization (`:2352`), async provider model orchestration (`:2479`), and direct DOM scroll querying (`:2577`).
- `src/nklein-sdk/nklein-task-session-service.ts` is 3,531 lines. It owns mutable session maps and listeners (`:690`), constructor wiring for many dependencies (`:704`), and policy/guardrail logic such as repeated tool-call enforcement (`:2864`).
- `src/core/api-contract.ts` is 2,593 lines and centralizes schemas, constants, derived helpers, and many wire types for unrelated runtime surfaces.
- `src/trpc/runtime-api.ts` is 2,384 lines and acts as the main backend entry point for sessions, settings, git operations, chat, workspace actions, and runtime lifecycle.
- `web-ui/src/App.tsx` is 1,359 lines despite its file comment saying it should stay focused on top-level wiring.
- Very large tests mirror the same concentration: `test/runtime/trpc/runtime-api.test.ts` is 5,012 lines and `test/runtime/nklein-sdk/nklein-task-session-service.test.ts` is 4,618 lines.

Why this matters:

These files are hard to review safely because unrelated behavior changes share the same module state and import graph. They also make unit testing expensive: narrowly changing one behavior often requires booting or mocking a large slice of the app. The result is higher regression risk and more pressure to add more local state or one-off helpers in the same file.

Suggested remediation:

- Split by responsibility, not by line count alone.
- For `runtime-settings-dialog.tsx`, extract a settings draft reducer/store, provider/model loading hook, validation/save orchestration, and section components only where they own real behavior.
- For `nklein-task-session-service.ts`, move guardrails, activity adaptation, compaction/recovery policy, and session lifecycle transitions behind focused collaborators with tests.
- For `runtime-api.ts`, group routers by domain and keep the root module as composition.
- For `api-contract.ts`, split stable contract domains while preserving a single barrel entry for callers.
- Create characterization tests before each extraction to avoid changing behavior during cleanup.

### 3. Medium: Broad lint disables hide classes of issues the codebase cares about

Evidence:

- `biome.json:16` disables `noExplicitAny` globally.
- `biome.json:76` disables multiple accessibility rules across `web-ui/**`, including click/key parity, focusability, semantic elements, SVG titles, and ARIA validation.
- `biome.json:92` disables React exhaustive dependency checking across `web-ui/**`.
- `biome.json:95` disables `noDangerouslySetInnerHtml` across `web-ui/**`.
- `biome.json:98` disables non-null assertion and array-index-key checks across `web-ui/**`.
- Current explicit `any` usage in first-party code appears narrow, for example `test/runtime/nklein-sdk/nklein-decomposition-tool-fuzz.test.ts:196`.
- `dangerouslySetInnerHTML` is used in focused rendering modules such as `web-ui/src/components/shared/diff-renderer.tsx:514` and `web-ui/src/components/detail-panels/nklein-markdown-content.tsx:136`.

Why this matters:

The disabled rules are not cosmetic. They cover exactly the areas where this application has meaningful risk: accessibility in a dense UI, effect correctness in stateful React components, unsafe HTML rendering, and type-safety drift. Keeping these disabled at broad path scope means future regressions will not be caught even when only a small number of files need exceptions.

Suggested remediation:

- Re-enable these rules by default and add file-level or line-level suppressions with rationale where the exception is intentional.
- Keep `dangerouslySetInnerHTML` behind a small sanitized rendering abstraction and allow the lint exception only there.
- Re-enable exhaustive deps incrementally around extracted hooks first, since large components may need behavior-preserving cleanup before the rule can be made strict.
- Replace the global `noExplicitAny` disable with targeted exceptions in fuzz tests or helper boundaries.

### 4. Medium: Production TypeScript uses inline and dynamic imports despite a repo-level rule against them

Evidence:

- The repo instruction says to avoid inline imports, dynamic imports for types, and `import("pkg").Type` in type positions.
- `src/cli.ts:322` and `src/cli.ts:336` dynamically load runtime modules.
- `src/cli.ts:417` documents a lazy-load workaround because eager runtime imports kept CLI commands alive after printing output, then `src/cli.ts:439` uses `Promise.all([import(...)])`.
- `src/trpc/runtime-api.ts:774` and `src/trpc/runtime-api.ts:789` use inline `import("../core/api-contract.js").Type` annotations.
- `src/server/runtime-server.ts:904` and `src/terminal/terminal-state-mirror.ts:4` use inline import type expressions.
- Similar dynamic-import patterns appear in scripts and tests.

Why this matters:

The CLI lazy-load workaround may be legitimate, but the pattern is now scattered and conflicts with the standing TypeScript guideline. Inline type imports also make dependencies harder to search, refactor, and enforce. If the lazy-load issue is real, it should be captured as an explicit boundary rather than a general permission to use dynamic imports anywhere.

Suggested remediation:

- Replace inline type imports with normal top-level `import type` declarations.
- Create a small typed lazy-load boundary for the CLI runtime workaround, with a comment explaining the process-lifetime issue and a regression test if feasible.
- Keep dynamic imports in scripts/tests only when they are necessary and documented.
- Add a lint or search check that catches new inline import type expressions in production source.

### 5. Medium: JSON and JSONL persistence relies on unchecked casts and silent malformed-data fallback

Evidence:

- `src/config/runtime-config.ts:970` parses runtime config JSON and returns `JSON.parse(raw) as T`; any parse/read failure returns `null`.
- `src/chat/chat-memory-store.ts:65` parses JSONL entries as `ChatMemory` and only skips lines that fail to parse.
- `src/chat/chat-host-action-audit-store.ts:90` casts JSONL entries to `ChatHostActionAuditEntry` and mainly filters by session id.
- `src/chat/chat-transcript-store.ts:65` casts entries to `ChatMessage` and only checks role.
- `src/chat/chat-session-store.ts:90`, `src/state/merge-history-store.ts:95`, and `src/state/task-run-summary-store.ts:175` follow similar parse-and-cast patterns.

Why this matters:

Skipping malformed JSONL lines is reasonable for append-only logs, but structurally invalid JSON objects still pass through as trusted domain objects. Missing timestamps, wrong enum values, or malformed nested fields can later break sorting, filtering, UI rendering, or audit interpretation. For config files, returning `null` for any parse failure can silently reset behavior instead of surfacing a corrupt configuration.

Suggested remediation:

- Add zod or SDK-provided schemas at persistence boundaries and parse records into known-good shapes.
- Keep permissive JSONL recovery, but record or surface validation failures so corruption is observable.
- Distinguish missing config from corrupt config; preserve the corrupt file and report a clear diagnostic instead of silently treating it as absent.
- Centralize JSONL read/validate/skip behavior so each store does not reinvent a weaker variant.

### 6. Medium: Runtime policy constants are duplicated across backend and UI

Evidence:

- `src/core/api-contract.ts:103` exports `RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = 32_000`.
- `src/nklein-sdk/nklein-context-window-policy.ts:1` defines another `NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = 32_000`.
- `web-ui/src/runtime/nklein-context-window-policy.ts:3` defines another `NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = 32_000`.
- `web-ui/src/components/task-start-agent-onboarding-carousel.tsx:3` already imports `RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS` from `@runtime-contract`, showing the shared contract constant is available to the UI.
- The 80,000-token fallback is also duplicated in `src/nklein-sdk/nklein-task-session-service.ts:124`, `src/nklein-sdk/nklein-session-runtime.ts:78`, `src/nklein-sdk/nklein-task-start-guard.ts:8`, and `web-ui/src/components/detail-panels/nklein-agent-chat-panel.tsx:161`.

Why this matters:

These values encode product policy. If one copy changes and another does not, the UI can allow a configuration the runtime rejects, or the runtime can behave differently from what onboarding and warnings communicate.

Suggested remediation:

- Use the contract module as the single exported source for shared policy constants.
- Keep runtime-only defaults in one runtime policy module and expose them through the contract if the UI needs to display them.
- Add a small test that asserts UI policy helpers and runtime guards agree on minimum and fallback context-window values.

### 7. Medium: Playwright and component tests duplicate backend mocks and use brittle DOM queries

Evidence:

- Multiple Playwright specs define local tRPC helpers, workspace snapshots, WebSocket route stubs, and catch-all route behavior, including `web-ui/tests/settings.spec.ts`, `web-ui/tests/plan-artifact-review.spec.ts`, `web-ui/tests/review-recovery.spec.ts`, `web-ui/tests/chat-risk-ack.spec.ts`, `web-ui/tests/chat-scope.spec.ts`, and `web-ui/tests/chat-browser-toggle.spec.ts`.
- `web-ui/tests/settings.spec.ts:36` defines a local `WS_SNAPSHOT` with hard-coded project paths and board state.
- `web-ui/tests/settings.spec.ts:205` defines local WebSocket routing and `web-ui/tests/settings.spec.ts:220` catches all other tRPC calls with empty stubs.
- Component tests frequently inspect `document.body.textContent`, raw `querySelectorAll("button")`, placeholders, or positional button indexes, especially in large UI test files such as `web-ui/src/components/runtime-settings-dialog.test.tsx`.

Why this matters:

Duplicated protocol mocks tend to drift from the real runtime contract. Catch-all stubs can also hide missing endpoint coverage by returning plausible empty responses. Brittle DOM queries make tests pass or fail based on incidental ordering rather than user-visible semantics.

Suggested remediation:

- Build a shared web-ui test harness for tRPC batch routes, workspace snapshots, and WebSocket events using contract-derived fixtures where practical.
- Avoid broad catch-all success stubs; fail by default and explicitly mock each endpoint a test expects.
- Prefer role/name queries and stable user-facing assertions over raw button indexes or full body text checks.
- Keep one or two smoke tests against the real dev server path for high-value flows so mocked contract drift is caught early.

## Cross-Cutting Cleanup Order

1. Fix the chat scope and host-action governance naming/approval issue first because it is both user-facing and security-sensitive.
2. Re-enable narrow lint rules around new or recently extracted code, then ratchet broader areas as files are split.
3. Extract `runtime-settings-dialog.tsx` and `nklein-task-session-service.ts` along tested responsibility boundaries.
4. Normalize shared policy constants through the runtime contract.
5. Introduce validated persistence helpers for config and JSONL stores.
6. Consolidate Playwright mock infrastructure after the contract surfaces are clearer.
