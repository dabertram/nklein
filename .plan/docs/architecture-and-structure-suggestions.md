# Architecture and Structure Suggestions

Date: 2026-06-26

Scope: repository architecture and module structure across the local runtime, React web UI, Electron desktop shell, contracts, persistence, tests, and build/CI boundaries.

Method: static review of the existing architecture docs, package layout, TypeScript path aliases, router/service structure, UI folder layout, shared contract usage, and boundary enforcement. This complements `anti-patterns.md`: that file lists code-level anti-patterns; this file focuses on target structure and migration shape.

## Current Architecture Read

The intended architecture is sound: a local Node runtime is the source of truth, the browser is a control surface, and execution is split between native NKlein SDK sessions and legacy PTY-backed agent processes. The docs in `docs/architecture.md` already explain this well.

The implementation is partway through that transition:

- Runtime, contract, and shared domain code still live together under `src/`.
- The web UI imports selected runtime source files directly through `@runtime-*` aliases in `web-ui/tsconfig.json` and `web-ui/vite.config.ts`.
- `src/core/api-contract.ts` is the primary shared contract file, but it has grown into a large mixed module.
- `src/trpc/app-router.ts` and `src/trpc/runtime-api.ts` remain broad coordinators despite several good extracted helpers under `src/trpc/runtime-api/`.
- `src/nklein-sdk/` contains many focused modules, but the true SDK boundary is not crisply enforced.
- `web-ui/src/` is organized mostly by technical category (`components`, `hooks`, `runtime`, `state`) rather than product feature.
- Root, web UI, and desktop are separate package installs rather than one coherent workspace-managed monorepo.

The main improvement theme is not "rewrite". It is to make the documented ownership model physically visible in the folder, package, and import structure.

## Target Shape

A good long-term shape would look closer to this:

```text
apps/
  web/
  desktop/
packages/
  contracts/
  runtime/
  runtime-core/
  nklein-integration/
  web-runtime-client/
  test-harness/
```

This does not need to happen in one move. The highest-value first step is extracting contracts and pure domain code behind stable imports while leaving runtime implementation in place.

## Recommendations

### 1. Formalize The Monorepo Boundary

Observation:

- The repo already has multiple packages: root runtime, `web-ui`, and `packages/desktop`.
- Dependency installation is scripted manually with `npm install && npm --prefix web-ui install && npm --prefix packages/desktop install`.
- The web UI compiles against runtime source files through direct aliases like `@runtime-contract`, `@runtime-agent-catalog`, and `@runtime-task-state`.
- CI repeats separate installs instead of using a workspace graph.

Suggestion:

- Convert the repo to npm workspaces or another workspace manager before doing major structural moves.
- Treat the runtime, web app, desktop shell, contracts, and test utilities as explicit packages.
- Start with a low-risk package such as `packages/contracts` that contains only Zod schemas, inferred types, constants, and pure helpers needed by both runtime and UI.
- Keep compatibility aliases initially, but point them at the new package entrypoints instead of individual runtime source files.

Why:

The current layout is a monorepo without monorepo boundaries. Formal workspaces would make dependency ownership, build order, and import rules easier to enforce.

Incremental path:

1. Add workspace metadata while keeping existing package names and scripts working.
2. Move only contract/pure helpers first.
3. Update path aliases to package entrypoints.
4. Move the web app from `web-ui/` to `apps/web/` only after imports are stable.

### 2. Split Contracts By Domain, Keep One Public Barrel

Observation:

- `src/core/api-contract.ts` is large and mixes board schemas, runtime config, task sessions, model/provider settings, statistics, update status, workspace state, and assorted helpers.
- `src/core/chat-api-contract.ts` is a good precedent: it keeps the board-independent chat contract separate and navigable.
- The UI already consumes contract code through `@runtime-contract` and `@/runtime/types`.

Suggestion:

Create contract modules by domain, for example:

```text
packages/contracts/src/
  index.ts
  board.ts
  chat.ts
  runtime-config.ts
  task-session.ts
  nklein-provider.ts
  nklein-planning.ts
  workspace.ts
  git.ts
  telemetry.ts
  update.ts
```

Keep `index.ts` as the stable import surface for callers. Internally, each domain owns its schemas, inferred types, parser functions, and shared constants.

Why:

The contract is one of the most important boundaries in this app. When it is one very large file, unrelated domains become coupled by default and small contract changes are harder to review.

Additional guidance:

- Keep runtime implementation imports out of `packages/contracts`.
- Put only pure helpers in contracts. If a helper reads disk, calls SDKs, or depends on runtime state, it belongs in runtime code.
- Preserve compatibility exports from the old `@runtime-contract` path until callers are migrated.

### 3. Turn TRPC Into Domain Router Composition

Observation:

- `src/trpc/app-router.ts` defines a typed router but still contains many direct procedure definitions for runtime, chat, workspace, and projects.
- `src/trpc/runtime-api.ts` coordinates settings, NKlein providers, task sessions, chat tool wiring, git evidence, model registry, MCP, advisor flows, smoke evals, shell sessions, updates, and debug reset.
- There are already extraction starts under `src/trpc/runtime-api/`, such as task evidence prompts, timeout settings, concurrency gating, GitHub context import, and local advisor completion.

Suggestion:

Keep tRPC as the transport, but make the root router a composition layer:

```text
src/trpc/
  app-router.ts
  routers/
    runtime-config-router.ts
    task-session-router.ts
    task-chat-router.ts
    nklein-provider-router.ts
    nklein-model-router.ts
    nklein-planning-router.ts
    nklein-mcp-router.ts
    workspace-router.ts
    projects-router.ts
    chat-router.ts
```

Pair each router with an application service that owns behavior:

```text
src/runtime/
  services/
    RuntimeConfigService.ts
    TaskSessionApplicationService.ts
    NKleinProviderApplicationService.ts
    PlanningArtifactService.ts
    WorkspaceApplicationService.ts
```

Why:

This keeps transport validation close to tRPC while moving behavior into testable services. It also prevents `runtime-api.ts` from continuing to become the place every runtime feature lands.

Incremental path:

1. Extract one low-risk domain, such as update status or stats.
2. Extract NKlein provider/model endpoints next because they already have a provider service.
3. Extract task-session start/stop/chat paths only after characterization tests cover behavior.

### 4. Define Execution Backends As Ports And Adapters

Observation:

- The architecture doc says NKlein is session-oriented while other agents are process-oriented.
- `src/core/agent-catalog.ts` currently holds the launch-supported agent list and the legacy host-workspace predicate.
- Some UI/runtime code still branches directly on `agentId === "nklein"` or `selectedAgentId === "nklein"`.
- Legacy PTY agent support is still physically present even though launch support is currently NKlein-only.

Suggestion:

Introduce an explicit execution backend port:

```ts
interface TaskExecutionBackend {
  readonly id: string;
  readonly capabilities: TaskExecutionCapabilities;
  startTask(input: StartTaskInput): Promise<TaskSessionHandle>;
  stopTask(taskId: string): Promise<void>;
  sendInput(taskId: string, input: string): Promise<void>;
  subscribe(listener: TaskSessionListener): () => void;
}
```

Then provide adapters:

- `NKleinSdkExecutionBackend`
- `TerminalPtyExecutionBackend`
- `SandboxShellExecutionBackend` if shell-on-task remains separate

Use capabilities instead of scattered ID checks:

- `supportsNativeChat`
- `usesDockerSandbox`
- `supportsProviderSettings`
- `supportsInteractiveTerminal`
- `usesLegacyHostWorkspace`
- `supportsPlanRefinement`

Why:

The current product direction is local-only NKlein, but the code still carries legacy terminal paths. A backend port makes the remaining compatibility explicit and gives future agent types one integration point.

Incremental path:

1. Wrap existing NKlein and terminal managers behind a minimal interface without changing behavior.
2. Move `usesLegacyHostTaskWorkspace` and launch support into backend capability metadata.
3. Replace UI `agentId === "nklein"` branches with capability selectors where the UI decision is actually capability-based.

### 5. Make Session Types First-Class

Observation:

- The app has task sessions, workspace shell terminal sessions, native NKlein task chat sessions, a synthetic home sidebar session, and board-independent chat sessions.
- The architecture doc calls out the home sidebar as intentionally weird: it is not a normal task, but it reuses task-session primitives.
- `runtime-state-hub.ts` streams terminal summaries, NKlein summaries, task chat, project updates, metadata, MCP auth status, and session context updates.

Suggestion:

Define an explicit session model:

```text
TaskSession
WorkspaceShellSession
WorkspaceAgentSession
BoardIndependentChatSession
```

Each session should have:

- identity
- workspace scope
- execution backend
- lifecycle state
- stream topics
- persistence owner
- allowed actions

Why:

This would remove ambiguity around synthetic home sessions and make it clear which state belongs to the board, which belongs to a workspace, and which is global chat state.

Incremental path:

1. Add a small `session-kind` discriminator to internal runtime summaries or registries.
2. Keep wire compatibility while deriving existing summaries from the new internal model.
3. Move the home sidebar from "synthetic task id" toward `WorkspaceAgentSession` when the surrounding code is ready.

### 6. Convert The Web UI To Feature Slices

Observation:

- `web-ui/src/` is mostly organized by technical role: `components`, `hooks`, `runtime`, `state`, `terminal`, `storage`.
- Large feature surfaces are spread across several folders. For example, settings uses `runtime-settings-dialog.tsx`, NKlein controller hooks, provider setup components, runtime query helpers, tests, and shared setup panels.
- `App.tsx` is the browser composition root but still wires a large amount of local state and feature orchestration.

Suggestion:

Move toward feature folders:

```text
apps/web/src/
  app/
    App.tsx
    app-shell.tsx
  features/
    board/
    task-detail/
    settings/
    chat/
    project-nav/
    terminal/
    git-history/
    onboarding/
  shared/
    ui/
    runtime-client/
    storage/
    resize/
    telemetry/
```

Within each feature, co-locate:

- components
- hooks
- state/view-model helpers
- tests
- feature-specific fixtures

Why:

The app is domain-heavy. Feature slices make it easier to answer "where does settings behavior live?" or "what owns task-detail chat?" without jumping through category folders.

Incremental path:

1. Start with new features only.
2. Move settings into `features/settings` because it has a clear boundary and large payoff.
3. Move board/task-detail after shared board domain code is stabilized.
4. Leave `shared/ui` and `shared/runtime-client` as stable cross-feature dependencies.

### 7. Extract A Shared Board Domain Module

Observation:

- Runtime board schemas live in `src/core/api-contract.ts`.
- Runtime persistence normalizes board data in `src/state/workspace-state.ts`.
- The web UI has its own board interfaces in `web-ui/src/types/board.ts`.
- The web UI also has separate board normalization and mutation helpers in `web-ui/src/state/board-state.ts`.
- Initial column definitions appear in both runtime and UI code.

Suggestion:

Create a shared board domain module in the contracts or runtime-core package:

```text
packages/runtime-core/src/board/
  schemas.ts
  columns.ts
  normalize.ts
  mutations.ts
  dependencies.ts
  selectors.ts
```

Use it from both runtime persistence and browser state logic where behavior is genuinely shared.

Why:

Board shape and board mutation rules are product domain logic, not UI-only logic. Duplicating normalization and column rules creates drift risk between persisted state and the browser model.

Boundary guidance:

- Shared board domain can be pure and environment-independent.
- UI-only draft state, drag state, local form state, and rendering selectors should stay in the web feature.
- Runtime-only persistence, CRDT import/export, and filesystem locking should stay in runtime.

### 8. Put Persistence Behind Typed Store Boundaries

Observation:

- Workspace state has strong Zod validation and migration-like normalization.
- Other stores use lighter JSON/JSONL parsing and unchecked casts, as noted in `anti-patterns.md`.
- Runtime config, workspace index, board state, session transcripts, audit logs, memory, merge history, and run summaries are all durable state, but they do not share one store contract pattern.

Suggestion:

Create a runtime persistence layer with standard store primitives:

```text
src/persistence/
  json-store.ts
  jsonl-store.ts
  migrations.ts
  corrupt-file-policy.ts
  stores/
    runtime-config-store.ts
    workspace-index-store.ts
    board-store.ts
    chat-session-store.ts
    chat-transcript-store.ts
    audit-log-store.ts
```

Each store should declare:

- schema
- file layout
- migration policy
- corruption policy
- concurrency/locking policy
- observability behavior

Why:

Persistence is a major architecture boundary in a local-first app. Standardizing it lowers data-loss risk and keeps every feature from inventing its own failure behavior.

### 9. Turn Runtime State Streaming Into A Projection Layer

Observation:

- `src/server/runtime-state-hub.ts` owns websocket clients, workspace maps, subscriptions, batching, task summary snapshots, chat messages, MCP auth broadcasts, metadata monitoring, and acceptance auto-repair triggering.
- It currently acts as both event subscriber and stream projector.

Suggestion:

Introduce typed runtime domain events internally:

```text
TaskSessionSummaryChanged
TaskChatMessageAppended
TaskReadyForReview
WorkspaceStateChanged
WorkspaceMetadataChanged
ProjectsChanged
McpAuthStatusesChanged
NKleinTeamProgressChanged
```

Then make `runtime-state-hub.ts` primarily a projection adapter:

```text
domain event -> workspace stream message -> websocket clients
```

Why:

This keeps websocket mechanics separate from runtime behavior. It also makes stream batching and replay/snapshot behavior easier to test.

Incremental path:

1. Add internal event types without changing websocket payloads.
2. Route one message family through the event projector.
3. Move acceptance auto-repair triggering out of the websocket hub if it is domain behavior rather than stream behavior.

### 10. Make The NKlein SDK Boundary Explicit And Enforced

Observation:

- The docs say SDK package details should stay behind `src/nklein-sdk/` boundary modules.
- Direct `@nklein/core` and `@nklein/shared` imports exist across many files under `src/nklein-sdk/`.
- `biome.json` restricts old `@nkleinbot/*` package names outside `src/nklein-sdk/**`, but the actual aliases in `tsconfig.json` are `@nklein/core`, `@nklein/agents`, `@nklein/llms`, and `@nklein/shared`.
- `.github/scripts/check-nklein-boundary.mjs` still checks `node_modules/@clinebot` and reports "Cline SDK" / `src/cline-sdk`.
- `.github/workflows/test.yml` calls `npm run check:cline-boundary`, while `package.json` defines `check:nklein-boundary`.

Suggestion:

- Decide the intended SDK import policy precisely:
  - strict: only boundary files import SDK packages, including shared tool types; or
  - layered: any file inside `src/nklein-sdk/` may import SDK tool types, but only boundary files may import provider/session-host/runtime APIs.
- Encode that policy in Biome restricted imports or a custom boundary script.
- Update the boundary script and CI command names to match the current NKlein package names.
- Export local aliases for SDK tool types from a boundary module if strict isolation is preferred.

Why:

The SDK boundary is one of the most important architecture seams. The code and docs should agree, and CI should enforce the agreement with current package names.

### 11. Give Settings Its Own Draft Model And Section Registry

Observation:

- Runtime settings is a large UI surface with generic app settings, NKlein provider settings, MCP settings, model registry, shortcuts, guardrails, and project overrides.
- State diffing, reset behavior, provider model loading, validation, and save orchestration currently live close to rendering.

Suggestion:

Create a settings feature with:

```text
features/settings/
  settings-draft.ts
  settings-draft-reducer.ts
  settings-validation.ts
  settings-save-plan.ts
  settings-sections.ts
  hooks/
    use-settings-draft.ts
    use-provider-model-loader.ts
  sections/
    GeneralSettingsSection.tsx
    AgentSettingsSection.tsx
    NKleinProviderSection.tsx
    McpSettingsSection.tsx
    GuardrailsSection.tsx
```

The dialog component should render a draft/view model. It should not own all save semantics directly.

Why:

Settings is a natural feature boundary and a good first UI extraction because the behavior is mostly contained. A draft model also makes unsaved-change detection, reset, validation, and project/global override behavior easier to test.

### 12. Create Shared Test Harness Packages

Observation:

- Playwright specs duplicate tRPC batch envelopes, workspace snapshots, websocket mocks, and catch-all route handling.
- Large component tests often recreate runtime config and board fixtures locally.
- Runtime tests are strong, but several suites mirror the oversized production modules.

Suggestion:

Create shared test harnesses:

```text
packages/test-harness/
  runtime-fixtures/
  board-fixtures/
  trpc-mock-server/
  websocket-stream-fixtures/
  playwright/
```

Use default-fail behavior for unmocked endpoints. Provide contract-derived fixtures for common workspace state, runtime config, task sessions, and chat sessions.

Why:

Tests should reinforce architecture boundaries. Shared harnesses make it easier to test features through realistic contracts instead of drifting hand-written mocks.

### 13. Align CI With The Desired Boundaries

Observation:

- CI manually installs root, web UI, and desktop dependencies.
- The test workflow references a missing `check:cline-boundary` script.
- The existing boundary script checks old Cline paths rather than current NKlein package boundaries.

Suggestion:

- Fix the immediate script mismatch.
- Add boundary checks for:
  - web UI cannot import runtime implementation except through approved contract/runtime-client packages.
  - SDK imports follow the decided NKlein boundary policy.
  - contracts package has no runtime, filesystem, Node process, browser, or SDK dependencies.
  - feature folders do not import across feature internals except through public `index.ts` files.
- Once workspaces exist, run `npm ci --workspaces` and workspace-aware build/test commands.

Why:

Architecture rules that live only in docs decay. The current docs are good; the enforcement needs to catch up.

## Suggested Migration Order

1. Fix boundary enforcement drift.
   - Update CI command names.
   - Update the NKlein boundary script and restricted-import rules to current package names.

2. Extract contract domains.
   - Start with `chat-api-contract.ts` as the model.
   - Split `api-contract.ts` gradually behind a stable barrel export.

3. Extract shared board domain.
   - Move column definitions, schemas, normalization, and pure mutations into a shared package.
   - Keep UI draft/drag state in the web app.

4. Modularize tRPC by domain.
   - Move small domains first.
   - Keep root router composition stable.
   - Back each router with an application service.

5. Introduce execution backend ports.
   - Wrap NKlein and terminal execution without changing behavior.
   - Replace ID checks with capability checks where appropriate.

6. Move web UI toward feature slices.
   - Start with settings.
   - Then board/task-detail.
   - Leave shared UI primitives and runtime clients in `shared/`.

7. Standardize persistence.
   - Add typed JSON/JSONL store helpers and migrate stores one at a time.

8. Refactor runtime streaming into event projection.
   - Preserve existing websocket message contracts while cleaning up internal ownership.

## What Not To Do

- Do not split files purely by line count. Split around ownership and testable behavior.
- Do not create thin wrapper components or services that only forward arguments.
- Do not move the web UI to a package boundary before shared contracts are stable.
- Do not remove legacy terminal/worktree code opportunistically unless the remaining product contract is explicit and tested.
- Do not let the contracts package depend on runtime implementation just to avoid an intermediate migration step.

## Success Criteria

The architecture cleanup is working when:

- A new engineer can find the owner of board, chat, settings, provider, workspace, and task-session behavior from the folder names.
- The web UI imports contracts and client helpers, not arbitrary runtime implementation files.
- Runtime routers are small enough that their procedure list maps directly to feature domains.
- NKlein SDK imports are visibly constrained and CI-enforced.
- Board state normalization and mutation rules have one shared source of truth.
- Tests use shared contract fixtures and fail when an endpoint is accidentally unmocked.
- `App.tsx`, `runtime-api.ts`, and `nklein-task-session-service.ts` become composition points rather than accumulation points.
