# Architecture Overview

!Klein is a local Node runtime plus a React app for running many coding-agent tasks in parallel.

This codebase is a fork of Cline Kanban. The repository name and some internal compatibility names still use `kanban`, but user-facing docs and UI copy should refer to `!Klein`, while command examples should use `nklein`. The main product direction is local-first orchestration for small local LLMs on limited hardware, with upstream Cline Kanban changes considered opportunistically rather than as a strict parity target.

There are three big ideas to hold in your head:

1. The browser is mostly a control surface. It renders state, sends commands, and reacts to live updates.
> **STALENESS WARNING (2026-07-19):** parts of this document below still describe the retired PTY-backed CLI-agent
> architecture. The terminal-CLI agents (claude/codex/gemini/opencode/droid/kiro) were REMOVED — see
> `src/core/agent-catalog.ts` ("the catalog is nklein-only"). PTY survives only for the manual workspace shell panel
> (`src/terminal/`), NOT for agent execution; agents run in the Docker sandbox. Treat every "PTY-backed agent"
> statement below as historical until this document is rewritten (tracked in `todo.md`).

2. The local runtime is the source of truth for projects, worktrees, sessions, git operations, and streaming state.
3. There are two different agent execution paths:
   - most agents run as PTY-backed CLI processes
   - NKlein runs through a native SDK-backed chat runtime

If you remember nothing else, remember this:

- PTY-backed agents are process-oriented
- NKlein is session-oriented
- the backend coordinates both through one runtime API and one state stream

## System Diagram

```text
+----------------------------------------------------------------------------------+
| Browser UI                                                                       |
| web-ui/src                                                                       |
|                                                                                  |
| App.tsx, hooks/, components/, runtime/, terminal/                               |
+---------------------------------------+------------------------------------------+
                                        |
                                        | TRPC requests and websocket updates
                                        v
+----------------------------------------------------------------------------------+
| Local Runtime                                                                    |
| src/                                                                             |
|                                                                                  |
| trpc/app-router.ts, trpc/runtime-api.ts, server/runtime-state-hub.ts             |
+-------------------------------+--------------------------------+------------------+
                                |                                |
                                |                                |
                                v                                v
+-------------------------------+--+          +------------------+-------------------+
| PTY Runtime                      |          | Native NKlein Integration             |
| src/terminal/                    |          | src/nklein-agent/                       |
|                                  |          |                                      |
| agent-registry.ts                |          | nklein-provider-service.ts            |
| session-manager.ts               |          | nklein-task-session-service.ts        |
| pty-session.ts                   |          | nklein-session-runtime.ts             |
+-------------------------------+--+          | nklein-message-repository.ts         |
                                |             | nklein-event-adapter.ts              |
                                |             +------------------+-------------------+
                                |                                |
                                v                                v
+-------------------------------+--+          +------------------+-------------------+
| Worktrees and shell processes    |          | Published NKlein SDK packages        |
| per-task cwd, CLI agents, shell  |          | `@nkleinbot/core`, `@nkleinbot/agents`, `@nkleinbot/llms` |
+----------------------------------+          | provider store, session host,       |
                                              | session artifact persistence         |
                                              +--------------------------------------+
```

## Request and Stream Diagram

```text
User action in UI
    |
    v
component
    |
    v
hook or runtime query helper
    |
    v
TRPC client
    |
    v
app-router.ts
    |
    v
runtime-api.ts
    |
    +--> terminal/session-manager.ts for CLI-backed agents
    |
    +--> nklein-task-session-service.ts for native NKlein


Live runtime output
    |
    +--> terminal session summaries
    |
    +--> NKlein summaries and chat messages
    |
    v
runtime-state-hub.ts
    |
    v
websocket stream
    |
    v
browser runtime state hooks
    |
    v
board, detail view, sidebar, and terminal panels
```

## The Mental Model

!Klein is easiest to understand if you separate it into three layers of responsibility.

The browser layer is the presentation and orchestration layer. It renders the board, detail view, settings, and terminal or chat surfaces. It also owns short-lived UI state such as panel visibility, form drafts, and optimistic message rendering.

The runtime layer is the control layer. It decides what session to start, where it should run, what worktree or workspace it belongs to, what command or SDK session should be used, and what state should be streamed back to the browser.

The execution layer is the actual agent implementation. For most agents that means a CLI process attached to a PTY. For NKlein that means the published SDK packages with their own provider store, session host, and persisted session artifacts.

That split explains a lot of the architecture:

- the browser should not be the source of truth for session lifecycle
- the runtime should coordinate work, not render UI
- the NKlein integration should adapt the SDK instead of copying SDK responsibilities into !Klein

## Runtime Modes

!Klein currently supports three runtime modes.

| Runtime mode | Used for | Scope | Backing implementation | Why it exists |
| --- | --- | --- | --- | --- |
| Native NKlein chat | NKlein | task-scoped, plus a project-scoped sidebar surface | NKlein SDK session host | NKlein exposes richer chat semantics, provider settings, OAuth, and persisted session history |
| CLI-backed task terminal | Claude Code, Codex, Gemini, OpenCode, Droid, and similar agents | task-scoped | PTY-backed process runtime | these agents are command-driven CLIs and already fit the terminal model well |
| Workspace shell terminal | the bottom shell panel | workspace-scoped | PTY-backed shell process | this is for manual commands in the repo, not task execution |

The crucial point is that NKlein is not just "another agent command". It is a native runtime path. Treating it like a terminal process would throw away useful structure that the SDK already gives us.

## Why NKlein Is Different

The codebase draws a hard line between NKlein and the rest of the agent catalog.

Most agents are binaries. We launch them, stream their terminal output, watch for transitions, and kill the process when the session ends.

NKlein is different because the SDK already owns several concerns that a CLI runtime does not:

- provider settings
- OAuth login and refresh
- session hosting
- persisted session history

Because of that, the architecture is intentionally split:

- NKlein uses a native chat path
- other agents stay on the PTY path
- the UI still sees a shared runtime surface, but the implementation behind it differs

This is one of the most important architecture choices in the repo. If someone accidentally starts pushing NKlein back toward "just another CLI", the system gets worse, not simpler.

## Core Concepts

These terms come up everywhere in the codebase.

| Concept | Meaning | Why it matters |
| --- | --- | --- |
| Workspace | an indexed git repository that !Klein has opened | most browser and runtime state is scoped to a workspace |
| Task card | a board item with a prompt, base ref, and review settings | a task is the unit of work the board cares about |
| Worktree | a per-task git worktree | most task agents run inside one |
| Task session | the live runtime attached to a task card | this may be a PTY process or a native NKlein session |
| Home agent session | a synthetic, project-scoped session used by the sidebar agent surface | this lets the sidebar reuse existing runtime primitives without creating a real task card |
| Runtime summary | the small state object the board uses to know whether a session is idle, running, awaiting review, interrupted, or failed | this is the bridge between long-running agent work and the UI |

## Who Owns What

One of the biggest cleanup themes was making ownership clearer. The system is much easier to work on if every concern has one obvious owner.

| Concern | Primary owner | Notes |
| --- | --- | --- |
| board state, workspace state, review state | !Klein | this is product state, not SDK state |
| worktree lifecycle | !Klein | task worktrees are an !Klein concept |
| non-NKlein process lifecycle | !Klein | the terminal runtime owns process start, resize, output, and stop |
| NKlein provider settings and secrets | NKlein SDK | !Klein should not mirror these back into its own runtime config |
| NKlein OAuth state and refresh | NKlein SDK | !Klein delegates through a provider service |
| NKlein session persistence and history | NKlein SDK | !Klein hydrates from SDK artifacts instead of reinventing persistence |
| mapping SDK sessions into !Klein task semantics | !Klein integration layer | this is what `src/nklein-agent/` exists to do |
| UI rendering state for detail view and sidebar | browser hooks and components | local UI state belongs in the frontend |
| live state fanout to the browser | `runtime-state-hub.ts` | the browser should react to streamed state, not poll |

If a change feels awkward, it is often because ownership is being blurred.

## Backend Architecture

The backend has a few important subsystems, each with a different job.

### TRPC layer

`app-router.ts` defines the typed contract between the browser and the runtime.

`runtime-api.ts` is the coordinator behind that contract. It should be the front door for runtime procedures, but not the place where deep session logic accumulates. A good rule of thumb is that `runtime-api.ts` should route and validate, then hand off to the terminal runtime, the NKlein integration, workspace logic, config helpers, or git helpers.

### Terminal runtime

The `src/terminal/` area owns everything process-oriented:

- choosing what binary to run
- launching PTY sessions
- resizing and streaming terminal output
- translating process lifecycle into !Klein runtime summaries
- handling the workspace shell terminal

This is the path for Claude Code, Codex, Gemini, OpenCode, Droid, and any other command-driven agent.

### Native NKlein integration

The `src/nklein-agent/` area is an integration layer, not just a dump of SDK calls.

Its job is to translate between !Klein concepts and SDK concepts:

- !Klein thinks in task ids, runtime summaries, and browser-facing chat messages
- the SDK thinks in provider settings, session ids, raw session events, and persisted artifacts

The integration layer exists so the rest of !Klein does not need to understand the SDK package layout or the details of provider auth and session hosting.

### Workspace and config

`src/workspace/` owns worktree creation, lookup, cleanup, and turn checkpoints.

`src/config/runtime-config.ts` owns !Klein preferences such as selected agents, shortcuts, and prompt templates. It should not become a second source of truth for NKlein secrets, OAuth tokens, or SDK provider state.

### State streaming

`runtime-state-hub.ts` is the central fanout point for live updates. It listens to terminal summaries, NKlein summaries, NKlein messages, workspace metadata, and workspace state changes, then broadcasts websocket messages that keep the browser in sync.

This is important because !Klein is not designed around browser polling. The runtime is long-lived and streams state outward.

## Frontend Architecture

The frontend is also easier to navigate if you think in responsibilities instead of folders.

`App.tsx` is the composition root. It wires together the major hooks, determines which high-level surfaces are visible, and hands state down into the board, detail view, dialogs, and terminal areas. It should not become a second runtime orchestrator.

Hooks in `web-ui/src/hooks/` are where most domain logic lives. This includes project navigation, workspace synchronization, task-session actions, review behavior, NKlein chat state, and the home sidebar agent lifecycle. If you are looking for "how does this behavior actually work?", the answer is usually in a hook, not a component.

Components in `web-ui/src/components/` are mostly rendering and composition. Good frontend changes often mean moving runtime-aware logic into hooks and leaving the component to render a view model.

`web-ui/src/runtime/` holds client-side query helpers and persistence glue. One of the guardrails we now enforce is that raw workspace TRPC client creation should stay concentrated in the runtime query helpers rather than spread through arbitrary components.

## Native NKlein Architecture

The native NKlein stack is split into small modules because this part of the system has more moving pieces than the PTY runtime.

```text
runtime-api.ts
    |
    +--> nklein-provider-service.ts
    |        |
    |        v
    |    sdk-provider-boundary.ts
    |        |
    |        v
    |    @nkleinbot/core and @nkleinbot/llms provider store, catalog, OAuth helpers
    |
    v
nklein-task-session-service.ts
    |
    +--> nklein-session-runtime.ts
    |        |
    |        v
    |    sdk-runtime-boundary.ts
    |        |
    |        v
    |    @nkleinbot/core session host and persisted session records, plus @nkleinbot/agents prompt helpers
    |
    +--> nklein-message-repository.ts
    |        |
    |        v
    |    live in-memory messages plus hydrated SDK history
    |
    +--> nklein-event-adapter.ts
             |
             v
         nklein-session-state.ts
```

The useful way to think about each module is:

| Module | Role | Why it exists |
| --- | --- | --- |
| `sdk-provider-boundary.ts` | the only place that should import SDK provider and OAuth APIs directly | protects the rest of !Klein from SDK package layout details |
| `sdk-runtime-boundary.ts` | the only place that should import SDK session-host and persisted-session APIs directly | same reason, but for runtime behavior |
| `nklein-provider-service.ts` | !Klein-facing service for provider settings, model catalog loading, OAuth login, and launch config resolution | keeps auth and provider policy out of `runtime-api.ts` and the UI |
| `nklein-session-runtime.ts` | owns the live SDK session host plus task id to session id bindings | maps !Klein tasks onto SDK sessions |
| `nklein-message-repository.ts` | stores the !Klein-side view of NKlein chat state and hydrates history from SDK persistence | gives the rest of the backend one consistent chat repository shape |
| `nklein-event-adapter.ts` | translates raw SDK events into !Klein mutations | isolates protocol-specific event handling |
| `nklein-session-state.ts` | pure state helpers for messages and summaries | keeps low-level mutation logic reusable and testable |
| `nklein-task-session-service.ts` | the task-oriented facade used by the rest of the backend | gives runtime-api.ts one place to talk to for NKlein session work |

This split matters because the biggest failure mode in this area is accidental duplication:

- duplicating SDK-owned settings in !Klein config
- duplicating SDK event logic in multiple places
- duplicating chat behavior between detail view and sidebar
- duplicating direct SDK imports throughout the codebase

## Configuration and Persistence

Different state lives in different places on purpose.

| State | Where it lives | Why |
| --- | --- | --- |
| selected agent, shortcuts, !Klein prompt templates | !Klein runtime config | these are !Klein preferences |
| per-project UI or workflow state | workspace state or project config | this is workspace-scoped product state |
| NKlein provider settings, API keys, OAuth tokens | SDK-backed provider store | the SDK already owns auth and provider persistence |
| NKlein session history | SDK persisted session artifacts | this allows recovery without rebuilding another persistence layer |
| task runtime summaries | !Klein runtime memory and state stream | the board needs a lightweight product-shaped summary of current work |

One very important rule falls out of that table:

Do not put NKlein provider secrets or OAuth tokens back into `runtime-config.ts`.

## The Home Sidebar Agent Surface

The home sidebar agent surface is one of the less obvious parts of the architecture.

It looks like a task panel, but it is not backed by a real task card and it does not create a task worktree. Instead, the system creates a synthetic home agent session id and runs a project-scoped session behind that identity.

That design is a deliberate compromise.

It lets the sidebar reuse the same runtime primitives that already exist for task-scoped chat and terminal panels, but without pretending the sidebar is a normal task with a prompt card and a worktree-backed lifecycle.

The current behavior is:

- when the selected sidebar agent is NKlein, the sidebar renders native chat
- when the selected sidebar agent is another provider, the sidebar renders a terminal panel
- the home session is keyed to the current workspace and relevant agent descriptor
- switching between Projects and Agent in the sidebar should not restart the session
- switching to a different project or materially different agent configuration should rotate the session

This is one of the places where the architecture still has a little intentional weirdness. It is not a first-class workspace-native session type yet, but it is now documented and contained.

## Main Flows

### Starting a CLI-backed task session

When the user starts a normal non-NKlein task, the browser asks the runtime to start a task session. The runtime resolves the task cwd, chooses the right command, and starts a PTY-backed process inside the task worktree. As the process runs, the terminal runtime emits summary updates and terminal output. The runtime state hub then streams those updates back to the browser so the board and detail view stay live.

This is the "classic kanban" path.

### Sending a NKlein chat message

When the user sends a NKlein message from the detail view or the home sidebar, the browser goes through shared NKlein runtime actions instead of inventing two separate flows. The request reaches `runtime-api.ts`, which delegates to the task-oriented NKlein session service. That service makes sure the right native session exists, applies chat turns to it, listens to SDK events, updates the message repository and summary state, and lets the runtime state hub stream those updates back to the browser.

The important architectural point is that detail view and sidebar are two surfaces over the same underlying NKlein runtime model.

### Opening settings and changing NKlein provider state

The settings dialog is split between generic !Klein settings and the NKlein-specific provider flow. The browser loads provider catalog data, available models, saved provider settings, and OAuth state through a dedicated NKlein controller path. The backend answers those requests through the NKlein provider service, which is the layer that talks to the SDK-backed provider store.

This means the UI can stay focused on rendering and local form state while the provider service owns auth and launch configuration policy.

## Design Rules

These are the architectural rules that are most important to preserve.

- one concern should have one clear source of truth
- keep the SDK behind the NKlein boundary modules
- keep `runtime-api.ts` as a coordinator, not a god file
- do not store NKlein auth or provider secrets in !Klein runtime config
- prefer sharing runtime-aware hooks between detail view and sidebar instead of letting the two diverge
- treat the browser as a client of streamed runtime state, not the source of truth for long-running sessions
- when adding new agent behavior, prefer capability-oriented reasoning over sprinkling more `selectedAgentId === "nklein"` checks
- because this feature area currently has zero users to migrate, prefer clean replacement over backward-compatibility scaffolding

## Enforced Boundaries

Some of the highest-value rules are enforced automatically by lint.

- only the two SDK boundary modules may import directly from `@nkleinbot/*`
- in the browser app, `createWorkspaceTrpcClient` is reserved for the runtime query helpers
- the raw home agent session prefix should not be duplicated in app code

These rules are intentionally narrow. They exist to protect the seams that are easiest to accidentally erode.

## Deliberate Tradeoffs

Not everything is perfectly generalized, and that is okay. Some current tradeoffs are intentional.

- the home sidebar uses a synthetic session identity instead of a first-class workspace-native session type
- some agent-selection code still branches on `"nklein"` directly, even though the long-term direction is more capability-based routing
- the published SDK packages are still a real dependency boundary, so the local boundary modules matter a lot
- NKlein is native chat while the rest of the catalog is still command-driven, which means some parallel abstractions are similar but not identical

The important thing is that these tradeoffs are now explicit. They are not random accidents spread through the codebase.

## Common Change Guide

When you are making a change, this table is often more useful than a file list.

| If you are changing... | Think about this first | Common mistake to avoid |
| --- | --- | --- |
| task startup for Claude Code, Codex, Gemini, OpenCode, or Droid | the PTY runtime and agent launch path | accidentally adding special logic to the NKlein path |
| NKlein provider settings, models, or OAuth | the NKlein provider service and SDK provider boundary | storing secrets in !Klein config or duplicating OAuth policy |
| NKlein message rendering or send/cancel behavior | the shared NKlein hooks and task-session service | making detail view and sidebar behave differently |
| live board updates | the runtime state hub and browser stream consumers | falling back to polling or duplicating summary logic |
| home sidebar agent behavior | the synthetic home session lifecycle | treating the sidebar like a normal task with a real worktree |
| new architectural boundaries | the existing lint rules and ownership model | adding a rule that is too broad and becomes a nuisance |

## What A New Engineer Should Expect

A new engineer opening this repo will probably notice a few things quickly:

- the backend is long-lived and stateful, not a thin stateless API server
- the browser is closer to a local control client than a traditional web app
- the task system, review system, and runtime system are tightly connected
- NKlein has a richer integration path than the rest of the agent catalog
- the architecture now favors clean ownership over compatibility glue because this area did not have legacy users to preserve

If you approach the code with those assumptions, the rest of the system starts to make sense much faster.
