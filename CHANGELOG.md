# Changelog

## [Upcoming !Klein 0.0.1]

- Renamed the fork's user-facing product to `!Klein` and the command-line entry point/package command to `nklein`, while preserving repository/internal compatibility names where they still matter.
- Replaced the remaining app-brand "Cline" labels in the UI with `!Klein` (sidebar wordmark, UI error screen, runtime-disconnected screen, and offline fallback now say `!Klein` / `nklein`), while keeping genuine Cline engine/provider/account references intact.
- Continued the rename migration across desktop metadata, protocol handling, runtime env vars, workspace headers, session cookies, runtime-home paths, and terminal/status surfaces, with one-release compatibility fallbacks for legacy `KANBAN_*` env vars plus legacy workspace header/cookie acceptance.
- Taught the desktop runtime health probe to recognize both the current `!Klein` browser title and the legacy `Kanban` title during the rename transition, so packaged shells can still attach to already-running older runtimes.
- Tightened the Electron shell with regression coverage for isolated/sandboxed renderer preferences, packaged devtools disabling, deny-by-default popup handling, and a CSP on the disconnected recovery page; desktop window/menu fallback titles now use `nKlein`.
- Added a small brand-regression guard that scans UI/CLI user-visible strings and fails if a new accidental app-brand `Cline`/`Kanban` string slips back in outside the explicit engine/legacy allowlist.
- Hid cloud-only Cline account/sign-in affordances in the local-only UI, filtered cloud providers out of task/setup/settings pickers, gated Featurebase/cloud feedback behind the shared runtime cloud-support flag, and removed the `Cloud` timeout-profile option when cloud providers are disabled.
- Added an `Open data dir` shortcut to Developer Tools, verified the gated dev-test sidebar tools are present in the web UI, and cleaned up stale follow-up checklist statuses so the docs match the shipped debug/developer surfaces.
- Added automatic migration from legacy `~/.cline/kanban` runtime data into `~/.cline/nklein`, plus browser localStorage key migration from `kanban.*` to `nklein.*`, so existing installs keep their plans, telemetry, dev runs, config, code index, and UI preferences.
- Added a task-detail `Copy evidence` action backed by a typed runtime evidence bundle endpoint, capturing card prompt, base ref/commit, worktree path, transcript, bounded diff evidence, and runtime config before copying a ready-to-paste external-agent prompt.
- Added a separate protected-test runner (`npm run test:protected`) with a curated manifest and co-located rationale docs, plus write-guard blocks for protected-suite paths and config files.
- Added topic-based guidance routing for decomposition-generated cards, injecting the matching `/nklein-security`, `/nklein-ui`, or `/nklein-ts` skill command from a maintained topic map.
- Added structured protected-test edit denial payloads with `intent`, `diff`, `reason`, and `expectedEffects`, so blocked agents can ask for exact human review through the existing follow-up question channel.
- Added one-use protected-test edit approvals in the Cline chat panel, scoped to the exact structured request and audited to local telemetry before the matching retry is allowed.
- Added a create-task prompt template menu with quick starts for bug fixes, small features, tests, security review, and decomposition.
- Added create-task context imports from local files, GitHub issues, and GitHub PR diffs, appending bounded context blocks directly into the task prompt via the local `gh` CLI for GitHub sources.
- Added a task-detail evidence drawer after evidence collection, showing the bundle path, generated evidence files, transcript paths, and copied external-agent prompt block.
- Added a gated Developer Tools self-improvement flow that loads the currently running dev checkout, accepts optional notes/evidence, and seeds a protected-guarded Cline Backlog task.
- Expanded the sidebar Project Health card into a compact diagnostics dashboard that lists every health issue for affected projects, including pending artifacts and lost-session artifact warnings.
- Added Git clone ref selection for project add, letting cloned projects check out a branch, tag, or commit in detached mode after clone.
- Added an additive command palette on `Cmd/Ctrl+K` for core board actions including new task, add project, settings, git history, backlog start, and Developer Tools.
- Added a local-model setup action to the empty project state so first-run users can open onboarding before adding their first repository.

- Made project registration explicit on startup, added self-source confirmation for loading !Klein as a project, and blocked implicit task-worktree project registration.
- Added durable decomposition artifact manifests, provenance on generated Planning cards, and idempotent graph application so retrying a plan does not duplicate cards or links.
- Added a decomposition auto-apply setting plus pending artifact Apply/Reject actions on source card details for manual plan review and recovery.
- Added a lost-heartbeat policy setting for Cline sessions, defaulting to Park + actions with a recovery warning while preserving the latest transcript/activity for resume or interruption handling.
- Added a Mark interrupted recovery action for lost Cline sessions on task details.
- Added task-detail Verify and Merge actions for acceptance-check and review cards, backed by typed runtime endpoints that run checks in task worktrees and report merge conflicts inline.
- Added durable auto-review notices on cards, so failed/no-op auto-commit and auto-PR attempts explain the recovery path instead of only surfacing transient UI feedback.
- Preserved full per-task Cline context/timeout overrides when changing detail-panel model settings, and clarified context/timeout labels in settings surfaces.
- Added an Advisor send flow in settings that sends generated prompts to a selected local Cline model and shows response output with sent/received timestamps.
- Added runtime-configured code intelligence embeddings with global defaults, project overrides, OpenAI-compatible local endpoint support, and project sidebar status that shows the effective provider/model.
- Added `/models` discovery and endpoint tests for custom OpenAI-compatible providers and code-intelligence embedding endpoints, including one-click model loading in the setup/settings UI plus LM Studio and Ollama helper examples to reduce local endpoint guesswork.
- Added project health detection for accidental task-worktree projects, with sidebar inspect/remove/migrate choices and explicit plan-artifact migration back to the detected parent project.
- Added project health diagnostics for pending generated plan artifacts that have not yet been applied or rejected.
- Added project health diagnostics for lost Cline sessions that still have pending generated artifacts needing review.
- Recorded task-scoped telemetry when turn checkpoint capture fails, keeping task start best-effort while making recovery-impacting checkpoint loss visible.
- Recorded task-scoped telemetry when generated plan artifacts cannot be auto-applied, keeping artifacts pending while making the recovery failure diagnosable.
- Recorded task-scoped recovery telemetry when Cline session reload/rebind paths fail, so restart/resume problems surface as actionable recovery diagnostics instead of only generic start failures.
- Added sanitized plan-artifact lifecycle telemetry for create/apply/reject transitions, logging only artifact metadata and counts rather than plan prompts or contents.
- Added lost-session recovery transition telemetry for persisted-session rebound and explicit interrupted recovery actions, making those recovery choices visible in diagnostics.
- Logged workspace resolver decisions for explicit workspace ids, explicit project paths, detected parent task-worktree ownership, existing index hits, and rejected task-worktree auto-registration.
- Rebased single-card board move conflicts in the web client against the latest workspace state before retrying save, preserving simple user drag actions instead of always forcing a full refetch.
- Added a persistent inline board notice for unsafe save conflicts, so users get retry/reapply guidance after sync instead of relying on a transient toast alone.
- Preserved the last local board edit across unsafe save conflicts by syncing the latest board state first and offering an explicit restore-my-edit recovery path instead of forcing the user to redo the change.
- Added deterministic replay for single board operations during save-conflict recovery, so one-card edits and single dependency changes can be reapplied against the latest revision instead of always falling back to manual recovery.
- Hardened self-observation telemetry redaction for prompt-like metadata keys, so specs, plans, summaries, and prompt bodies are dropped before local telemetry is written.
- Kept best-effort task-worktree cleanup failures out of the main UI toaster path, so non-blocking cleanup noise stays diagnostic-only unless recovery actually depends on it.
- Routed Cline decomposition artifacts and generated cards to the parent workspace even when the Cline task runs inside its task worktree, with a 10-card regression matching the stalled complex dev-test failure mode.
- Preserved runtime-owned task session state during UI board saves, so stale browser snapshots cannot move a running/review/lost session backward.
- Made browser board saves session-free; the runtime now attaches current session state server-side and low-level board-only saves preserve existing sessions.
- Tightened the public workspace save contract to board-only persistence, so browser saves no longer accept task-session payloads and the runtime/session layer remains the sole owner of session summaries.
- Moved settings-side dogfood/smoke-eval controls and sidebar dev-test project tools behind debug-mode Developer Tools gating so normal settings stay focused on user-facing runtime configuration.
- Hardened dev-test cleanup with a durable !Klein marker, confirmation prompts, scoped stale patch removal, marked-project-only deletion, and partial-failure reporting.
- Enforced local-only Cline model usage: cloud provider selections are ignored or hard-stopped, cloud providers and recommendations are hidden from the picker, routing drops cloud candidates, and cloud-blocked cards are parked with a clear local-model message.
- Added a !Klein-owned effective context ceiling for Cline starts/restarts and proactive pre-send overflow telemetry, so oversized prompts are compacted or blocked before provider dispatch.
- Removed the 200k effective-context clamp for local Cline models, preserving million-token advertised windows end-to-end while keeping overflow guards, native compaction, and budget bars on the same resolved window.
- Improved oversized single-prompt failures with a specific recovery message, cold-start timeout floors for models without speed samples, and a regression guard that blocks persisted cloud launch metadata during overflow restarts.
- Passed MCSR/user effective context windows through runtime routing into native Cline starts and chat budget displays, preventing provider-advertised windows from overruling !Klein's effective guard.
- Persisted sanitized Cline launch metadata with SDK sessions and reused it during resume/overflow recovery, preventing recoverable compaction restarts from failing with missing session config.
- Treated legacy cloud timeout profiles as local-model timeouts and clamped positive Cline timeouts to at least 60 seconds, so slow local model sessions cannot inherit stale one-second request, stream, tool, agent, or conversation limits.
- Raised positive local Cline timeouts from MCSR speed observations at task start, using measured wall-time-per-1k prompt tokens, prefill/decode rates, TTFT, and wall-time samples while preserving unlimited mode.
- Added an effectively unlimited timeout mode as the fix for the HTTP "body timeout error" (undici `UND_ERR_BODY_TIMEOUT`) that otherwise aborts long-running local model streams: selecting it disables !Klein's request, stream, tool, agent, and conversation timeouts so a slow local model can finish a long turn without its response body being timed out mid-stream.
- Parked Cline tasks after repeated identical start/send failures, suppressing duplicate failure telemetry and system messages once a task is clearly stuck.
- Hardened Cline acceptance checks to use a non-login shell with an explicit PATH fallback and a larger output buffer, avoiding shell-init hangs and false failures from large passing output.
- Tightened acceptance auto-repair prompts so failing assertions and TypeScript/compiler errors are extracted as explicit next-turn constraints before the bounded raw output.
- Centralized passcode session cookie construction and added coverage for strict `HttpOnly`/`SameSite=Strict` flags plus TLS-only `Secure` cookies while keeping the runtime bound to `127.0.0.1` by default.
- Added obvious-secret scanning to Cline agent write approvals and direct write-file tools, blocking private keys, provider tokens, GitHub tokens, AWS access keys, and long credential assignments before files are written.
- Added a backend-fed Cline context budget breakdown and segmented chat-panel bar using the effective context window, with fallback to the existing estimate when breakdown data is unavailable.
- Added routing regression coverage for preferred feasible local models and candidate-specific 32k/80k context-window assignment.
- Split retained `read_files` / `read_large_file` results into the context budget bar's included-file segment instead of hiding that content inside other history.
- Applied decomposed Cline task graphs into the Planning lane, normalized persisted boards to include Planning, and let dependency-unblocked Planning cards flow into execution.
- Seeded the !Klein decomposition prompt as an overridable Cline workflow and resolved `/kanban-decompose` through the user instruction service instead of hardcoding the prompt into runtime starts.
- Added recursive `decompose_project.expansions`, so oversized decomposition leaves can be replaced in one validated tool call with bounded-depth splitting and dependency rewriting to terminal replacement tasks.
- Made `decompose_project` explicit when connected local model fit has not been validated yet, and kept slug-colliding decomposed task IDs disambiguated with regression coverage.
- Added clarification-question support to decomposition plans: the workflow asks for questions/assumptions, `decompose_project` rejects unresolved open questions, and `questions.md` is written and exposed with plan artifacts.
- Added lightweight clarifying-question answer chips to the Cline chat panel, with answers sent through the existing planning chat turn and free-text composer still available.
- Added `summary.md` to decomposition plan artifacts and exposed `summaryPath`, giving the later Planning DAG review a plain-language summary to display.
- Tightened the Cline context budget display to use effective model-window wording, retain the segmented health-colored bar, and label fallback estimates as fallback working budgets instead of available model context.
- Improved Cline context budget breakdowns by retaining the SDK system prompt per task and estimating enabled !Klein tool-schema overhead instead of leaving tool tokens at zero.
- Enforced the project task concurrency cap across UI starts, dependency auto-starts, and backend runtime starts, while preserving the fast Codex restore path by counting only already-loaded Cline services.
- Unified local endpoint serialization with the local-only provider policy, so custom local OpenAI-compatible endpoints are serialized by URL while distinct local endpoints can run in parallel.
- Broadened Cline model tool-routing rules so weak local model families, including custom local OpenAI-compatible providers, receive a trimmed SDK default toolset while stronger models keep the full tool surface and Cline's typed sequential execution default.
- Added workspace-scoped Cline file discovery, file-size, retrieval, large-file, and batched write tools, with context-budget-aware read guidance and per-file write limits.
- Added a local-gated Cline web research tool for current HTTPS sources on an allow-list, intended for docs, model, MCP, and changelog research without enabling arbitrary browsing.
- Added Cline team delegation and team-progress projection so multi-agent SDK activity can be tracked and summarized inside !Klein.
- Personalized repo-map ranking around current task/chat text, explicit repo-map queries, and seed paths, so small local models see symbols relevant to the active card instead of only globally central code.
- Merged repo-map symbol matches into `search_code` alongside lexical line hits and semantic code-index chunks, giving small local models hybrid retrieval that orients around relevant symbols even when the query only matches file paths or declarations.
- Seeded overridable `!Klein` guidance skills for security, UI, and TypeScript into each workspace's Cline skills config and enabled the SDK skills extension so small local models can load terse topic guidance on demand.
- Added compact codebase-specific examples to the seeded guidance skills so matched skill prompts include concrete !Klein patterns for small local models.
- Added task-card and dev-test "Copy evidence" actions so evidence bundles can be collected and copied without opening the detail panel or dropping to the CLI.
- Made decomposition role assignment write the Cline router-selected role settings onto created Planning cards, including route-up cases and default-model selections.
- Added structured `endpoint_busy` Cline start responses with MCSR-derived retry estimates for same-local-endpoint contention.
- Added queued local-endpoint admission for dependency auto-starts, so same-endpoint Cline tasks are deduplicated, paced by MCSR wait estimates, and retried when the busy local endpoint frees.
- Persisted `filesLikelyTouched` on decomposition-created cards and used it to skip overlapping task starts across UI single starts, start-all, dependency auto-starts, and CLI `task start`.
- Added `decisions.md` plan artifacts and compact shared spec/decision injection for decomposition-created cards, so dependent Cline tasks inherit the same plan contracts.
- Added `nklein task merge` to merge reviewed/completed task worktree heads into a clean base worktree in dependency order, abort conflicts, and create a Planning integration card with conflicted paths.
- Wired `nklein task done` to auto-merge reviewed task worktrees before cleanup/dependent auto-start, preserving worktrees and creating integration cards when merges block or conflict.
- Added a workspace swarm stop signal with `nklein task swarm-stop` / `swarm-resume`; project task starts now return a typed `swarm_stopped` response while paused.
- Recorded typed self-observation telemetry when native Cline reaches the consecutive mistake guardrail and stopped the task through the SDK callback, making repeated tool/API failure stalls diagnosable.
- Added a Cline autonomous turn-budget guardrail that aborts over-budget task sessions, parks the card for review, and records `budget_wall` telemetry with checkpoint evidence.
- Added a !Klein repeated-tool stall watchdog for Cline tasks, parking sessions after 5 repeated non-attention tool starts with the same input and surfacing the limit in settings.
- Bounded Cline tool transcript inputs, outputs, and errors, including stack-noise filtering plus next-step hints for failed tools so small local models keep more usable context.
- Added a board-level Local swarm strip with running/waiting/blocked counts and a Pause/Resume control wired to typed runtime swarm-stop endpoints.
- Added Local swarm nudges for single-endpoint serialization and model-load-aware start-all ordering that prefers cards targeting an already-running local model.
- Added an inline Local swarm concurrency slider that saves `maxConcurrentTasks` from the board header.
- Added local shared-endpoint ids to Cline session summaries and surfaced per-endpoint running utilization in the board Local swarm strip.
- Enriched running task cards with compact swarm telemetry: token counts, approximate output tok/s, elapsed time, turn count, current activity/tool, and a mini context-budget bar.
- Added Advanced policy visibility in settings for routing policy, context-budget inputs, acceptance command source, and local telemetry diagnostics paths/limits.
- Added a board-level code-intelligence chip to surface repo-map/index readiness from the existing typed runtime status endpoint.
- Added a no-LLM task Diagnostics panel backed by local self-observation JSONL telemetry and a typed runtime `getTaskDiagnostics` endpoint.
- Added a card-detail Activity surface that summarizes planning/routing, context budget, current tool activity, and acceptance state from existing session data.
- Promoted acceptance and merge into Activity pipeline steps backed by local diagnostics, and recorded task-scoped worktree merge telemetry for merged, skipped, blocked, and conflicted merge outcomes.
- Stamped decomposition-created cards with backend model-fit evidence from the Cline routing guard and surfaced that evidence as a Planning DAG fit badge.
- Expanded the Planning DAG review panel to show the full connected dependency component around the selected card, including indirect linked plan cards.
- Added revised-plan flags to the Planning DAG panel for integration, decision, contradiction, split, and decomposition-blocked adaptation cards.
- Added an explicit Planning DAG approval action that marks plan-mode Planning cards execution-ready without clearing revision metadata.
- Added `revisions.md` plan artifacts and exposed `revisionsPath` through decomposition tool, CLI, and dogfood API outputs for future adaptive re-planning audit trails.
- Added `nklein task plan-gap` and a typed `plan_gap` self-observation signal so execution agents can report missing decisions, contradictions, dependencies, oversized scope, or unplanned integration work.
- Let `nklein task plan-gap --kind integration_needed` create a Planning integration card with evidence while returning the created card in the command response.
- Broadened acceptance failure plan-gap classification with domain patterns for unresolved decisions, contradictions, missing packages/files/commands/config/schema, and scope/resource exhaustion.
- Recorded a concrete `integration_card_added` plan revision when automatic integration-card adaptation runs with `--plan-slug`.
- Added bounded plan-gap adaptation cards for scope and decision gaps: oversized cards are blocked for decomposition, decision/contradiction gaps pause into Planning, and repeated adaptations reuse the existing Planning card.
- Recorded concrete `decision_card_added` and `scope_split_card_added` revisions when adaptive plan-gap cards are created for a known decomposition plan.
- Added `nklein task expand-plan-task` to apply approved recursive replacement tasks to saved plan DAGs, re-link dependencies through entry/terminal replacements, and append `recursive_task_replaced` revisions.
- Fixed Cline team-progress summaries so `task_end` events with string-shaped errors are reported as failures instead of completions.
- Named and documented Cline context-budget policy constants for reserve caps, unknown-window fallbacks, pressure curves, and file chunk sizing without changing budget behavior.
- Documented the Cline repo-map heuristic and refreshed cached repo maps after successful workspace-mutating tools, so code-orientation context no longer stays stale after edits.
- Upgraded Cline repo maps with TypeScript AST symbol extraction, PageRank-style reference/import ranking, stable prompt-prefix ordering, and tests for refreshed, first-position repo-map rails.
- Debounced Cline model-registry persistence so observations update the in-memory MCSR immediately while locked disk writes are coalesced, with fractional EWMA speed stats preserved across reloads.
- Switched Cline model-registry event extraction to the SDK session-event types, recording observations from typed usage events plus !Klein-measured request duration instead of guessed `run-finished` payloads.
- Recorded explicit local Cline launch context windows into the model registry immediately and added advertised/observed/user-override context-window precedence for MCSR entries.
- Added first-run Cline onboarding controls for setting a local model context-window override and seeding model roles with the selected reasoning effort.
- Hardened `nklein dev smoke-eval` to score only local Cline providers and include the selected local model plus guard, overflow, and timeout telemetry counts in the evidence bundle.
- Added a local dev smoke fixture, Cline eval harness, and evidence bundle writer so local-model runs can capture prompts, telemetry, diffs, and score artifacts for regression review.
- Let `nklein task plan-gap --plan-slug <slug>` append concrete gap entries to a plan's `revisions.md` audit trail while still recording the structured self-observation signal.
- Recorded automatic `plan_gap` telemetry when acceptance verification finds a missing acceptance contract or exhausts repair/escalation attempts.
- Added an expandable Cline model telemetry panel backed by the MCSR, showing local-only model endpoint, context-window, throughput, latency, capability, samples, and missing-window prompts.
- Included configured local Cline provider/model selections and model-role roster entries in MCSR responses even before they have telemetry samples.
- Improved fallback Cline model labels on task cards so raw provider-qualified GPT/Claude IDs render as readable model names when the provider catalog is not loaded.
- Replaced cloud Cline examples in task CLI help with local-model examples and added a production-source boundary scan for cloud-provider literals.
- Added a Cline code-intelligence status panel in settings, exposing repo-map availability and code-index cache coverage, staleness, embedding metadata, cache path, and search readiness.
- Made MCSR capability scores age-aware by decaying old eval/pass-rate evidence toward the static prior instead of letting stale observations dominate forever.
- Improved startup onboarding for local Cline setup: it reopens when Cline lacks a configured local model, shows detected Ollama/LM Studio endpoints and loaded models, and seeds architect/worker/reviewer roles from the selected local model on first save.
- Let `nklein task plan-gap` infer the owning decomposition plan from decomposition-created task IDs, so inferred integration-card adaptations append to `revisions.md` without requiring `--plan-slug`.
- Classified exhausted acceptance failures that clearly indicate missing dependencies, contradictory requirements, or oversized scope as structured `plan_gap` events instead of always recording a generic review gap.
- Added a guided first-run local endpoint start panel with Ollama and LM Studio download links plus install, server-start, model-load, and verification commands.
- Added a Cline autonomous wall-time guardrail that aborts over-budget task sessions, parks the card for review, and records `budget_wall` telemetry with checkpoint evidence.
- Added a repeated no-diff checkpoint watchdog for Cline tasks, parking sessions that keep checkpointing the same commit without producing new diff progress.
- Added ownership-aware task worktree sync and !Klein-created repository markers, preserving agent edits on overlapping paths and safely cleaning repository metadata only for repos !Klein owns.
- Hardened project removal/re-add flows so task worktrees and saved task patches are cleaned up consistently and stale task content cannot be restored accidentally.
- Added a Planning card DAG review panel in task detail, showing linked prerequisite/dependent cards with status, complexity, likely files, and model/agent hints.
- Added a Local swarm guardrails section to settings, surfacing the current concurrency cap plus enforced Cline turn, wall-time, no-diff, and mistake guardrails.
- Added local-only per-model Cline context-window overrides, with a typed runtime save/clear API plus controls in both the Model Telemetry panel and Cline settings.
- Added live code-index progress reporting for local code search, surfacing scan/embed/cache-write phases plus file/chunk and cache hit/miss counters in Cline settings.
- Enriched the card Activity surface with explicit card-selected/runtime-selected routing details and a separate retrieval/indexing step for file and code-search tools.
- Recorded initial `recursive_split` plan revisions when `decompose_project.expansions` rewrites oversized tasks before saving the plan graph.
- Added a shared 12-card swarm batch budget for start-all and dependent auto-start launches, surfaced alongside the other Local swarm guardrails in settings.

## [Cline Kanban 0.1.68]

- Codex hooks are now pre-trusted, eliminating permission prompts when !Klein manages Codex sessions
- Fixed signal handling to properly re-raise signals and ignore SIGQUIT for cleaner process cleanup
- Updated Cline SDK from 0.0.36 to 0.0.38, which includes: new OpenAI ChatGPT Subscription and v0 providers, Ollama no longer requires an API key, file-based and event-driven automation, auto-compaction for provider requests, per-turn usage metrics on assistant messages, normalized provider usage costs, web fetch enabled by default in act mode, various message handling and abort fixes

## [Cline Kanban 0.1.67]

- "New version available" notification with one-click update from the web UI
- Renamed the "Trash" column to "Done" and added CLI command aliases
- Allow entering a custom model ID when no matching models are found in the model selector
- Use Codex hooks for task state transitions
- Fixed stale worktree setup locks not being cleaned up on shutdown
- Fixed task ID generation to avoid timestamp-derived fallback IDs
- Added scaffolding for an Electron desktop app (not yet available)

## [Cline Kanban 0.1.66]

- Added a refresh button for LiteLLM and custom provider model lists, so you can re-fetch available models without leaving settings
- Enforced origin and host validation on the !Klein websocket service to prevent unauthorized connections

## [Cline Kanban 0.1.65]

- Model catalog now auto-refreshes on startup so newly available models appear immediately
- Fixed task cards resizing and causing layout shifts on the board
- Fixed initial Cline message not being sent after starting a new session
- Added runtime child process manager for the desktop app

## [Cline Kanban 0.1.64]

- Multi-line diff comments: Shift+click to select a range of lines, click the line number to open the comment box, and comments now include file path, line number, and column context
- File tree panel in diff views can now be toggled open or closed
- Task title editing now requires clicking the pencil icon that appears on card hover, preventing accidental edits when clicking the card

## [Cline Kanban 0.1.63]

- Fixed task detail view being lost on page refresh
- Fixed API key getting reset when modifying Cline agent settings
- Fixed !Klein agent starting in thinking state instead of idle

## [Cline Kanban 0.1.62]

- Fixed Cline chats on the home screen not resuming correctly from persisted history, causing conversation context to be lost
- Fixed Cline thinking indicator hiding prematurely during active requests
- Reasoning blocks now animate their collapse after finishing streaming
- Fixed model selector not scrolling to the selected model when opened, and improved visual clarity of the selected model and reasoning effort states

## [Cline Kanban 0.1.61]

- Added device code authorization for signing into Cline on remote systems
- Revamped theme system with new theme picker and improved color palettes
- Fixed duplicate MCP tool registration when using SDK 0.0.34
- Fixed MCP settings not showing up during Cline setup

## [Cline Kanban 0.1.60]

- Choose a different agent per task, or change the model and provider for Cline tasks, when creating tasks from the board
- Adds remote file browser for adding projects when running !Klein on a remote server, with git clone support for adding projects by repository URL
- HTTPS and passcode authentication support for secure remote access
- Adds Kiro CLI agent support
- Pick from 10 new color themes to personalize your board
- Cline account organization switching and credit balance display in settings
- Set and edit task titles
- Incremental expand in the diff viewer -- click to show 20 more lines in collapsed context blocks
- Mobile-responsive layout for the web UI, including adaptive navigation, task detail views, and chat panels
- Friendly labels for task commands (like file edits and shell commands) in the sidebar chat
- Cline credit usage notifications with a link to manage your plan
- Fixed startup onboarding reappearing after being dismissed
- Fixed browser back button not returning from task detail view to the board
- Fixed chat state not reinitializing properly when resuming a trashed task
- Fixed `/clear` not fully resetting chat for restored sessions
- Fixed diff mode toggle not reflecting its active state
- Fixed detached notification process orphans on shutdown
- Disabled unnecessary startup update checks for Codex agent
- Faster trash restore for Codex tasks by skipping unnecessary session probes
- Redesigned settings dialog with sidebar navigation, scroll-spy highlighting, and card-style sections
- Updated Cline SDK from 0.0.28 to 0.0.33, which includes: checkpoint support (configurable, disabled by default), correct model list for Cline provider via OpenRouter, compaction at 95%, steer messages fix, and team agent identity in event payloads

## [Cline Kanban 0.1.59]

- Added a beta hint card to the project sidebar with quick access to send feedback or report issues
- Added "Read the docs" button in the settings dialog linking to documentation
- Adjusted prompting for the commit button to better handle stale git lock files and multiple stashes at once

## [Cline Kanban 0.1.58]

- More panels are now resizable (agent chat, git history, and more) and your layout preferences persist across sessions
- Adds full Factory Droid CLI agent support
- Add, edit, and delete custom OpenAI Compatible providers from the settings dialog
- Fixed trashed task cards being openable from the board
- Fixed git history cache not clearing when closing the view
- Terminal cursor defaults now match VS Code behavior
- Feedback widget no longer triggers authentication until you actually click it
- Updated Cline SDK from 0.0.24 to 0.0.28, which includes: OpenAI-compatible provider support via AI SDK, custom provider CRUD in core, better handling of overloaded and insufficient-credits errors, fixed tool schema format for OpenAI-compatible providers, accurate input token reporting

## [Cline Kanban 0.1.57]

- Added `nklein --update` command so you can check for and install updates manually
- Fixed Windows agents (like Codex) being incorrectly launched through cmd.exe when they're native executables
- Reduced latency when switching between projects
- Restored the feedback widget with proper JWT authentication
- Fixed telemetry service configuration for Cline agents
- Updated Cline SDK from 0.0.23 to 0.0.24, which includes reasoning details support and improved JSON Schema handling for tool definitions

## [Cline Kanban 0.1.56]

- Automatic context overflow recovery: when the conversation history exceeds the model's context window, !Klein now compacts old messages and retries instead of failing
- Credit limit errors (insufficient balance / 402) are now surfaced immediately without unnecessary retries or confusing system messages
- Added report issue and feature request links to the settings dialog
- Added Cline icon to browser notifications
- Updated Cline SDK from 0.0.22 to 0.0.23, which includes: LiteLLM private model support, provider-specific setting configs, loop detection as a built-in agent policy, provider ID normalization for model resolution, OAuth token refresh fix for spawned agents

## [Cline Kanban 0.1.55]

- Fixed non-ASCII file paths (e.g. Japanese, Chinese, Korean characters) rendering as garbled octal escape sequences in the diff view

## [Cline Kanban 0.1.54]

- Task agent chat panel resizing now persists when navigating between tasks

## [Cline Kanban 0.1.53]

- Added `/clear` slash command to reset the Cline agent chat session
- Added hints for environment variables in Cline provider setup
- Aligned Cline provider and model fallbacks with SDK defaults for more reliable configuration
- Fixed Codex plan mode not working
- Fixed slash command file watchers to reuse a single watcher per workspace instead of creating duplicates
- Show loading skeleton in onboarding carousel while videos load
- Added VS Code Insiders as a file open target

## [Cline Kanban 0.1.52]

- Added support for custom OpenAI-compatible providers, so you can connect any OpenAI-compatible API as a Cline model provider
- Added PWA support -- the web UI can now be installed as a standalone desktop app from Chrome, with window controls overlay and an offline fallback page that auto-reconnects when the server comes back
- Sticky file headers in the diff viewer now pin under the toolbar while scrolling through large diffs
- Show a cleanup spinner during Ctrl+C shutdown instead of silently hanging
- Fixed Codex status monitoring to reliably track the latest tool call
- Fixed terminal color detection for TUI apps like Codex CLI that query both foreground and background colors at startup
- Fixed activity preview text getting truncated in hooks
- Fixed project column sizing not persisting across sessions
- Fixed home sidebar session IDs not matching the current format

## [Cline Kanban 0.1.51]

- Task terminals now support multiple simultaneous viewers, so opening the same task in several browser tabs no longer causes disconnections
- Terminal TUI state is now preserved across reconnects, so you no longer lose your terminal view when the connection drops and re-establishes
- Fixed Codex CLI content disappearing or rendering incorrectly -- PTY sessions are now fully server-side, so you can refresh the page, switch between tasks, and unmount terminals without losing any output
- Fixed home sidebar terminal sessions not reconnecting after navigation
- Switched to esbuild for faster builds
- Claude agent hyperlinks now render correctly in !Klein terminals
- Fixed screen flickering and unnecessary polling when viewing trashed tasks
- Fixed restoring tasks from trash using the wrong agent
- Fixed stale git worktree registrations that could cause worktree operations to fail

## [Cline Kanban 0.1.50]

- Updated Cline SDK from 0.0.21 to 0.0.22, which includes: fixed hook worker process launching to use a more robust internal launch mechanism

## [Cline Kanban 0.1.49]

- Updated Cline SDK from 0.0.16 to 0.0.21, which includes: organization fetching support, SDK declaration maps for better type resolution, OpenAI Compatible provider migration and cleanup of the legacy provider, agent telemetry events with agent ID and metadata, bash tool and home directory fixes on Windows, and exposed LoggerTelemetryAdapter in the node package

## [Cline Kanban 0.1.48]

- Fixed sidebar agent attempting to edit files and write code instead of staying focused on !Klein board management

## [Cline Kanban 0.1.47]

- Fixed browser open failing on Linux systems where `xdg-open` is not available

## [Cline Kanban 0.1.46]

- Added reasoning level dropdown to Cline provider settings and the model selector in the chat composer
- Images can now be attached when creating tasks for Claude Code and Codec CLI agents -- images are saved as temporary files and their paths are passed into the prompt since TUIs don't support inline images
- Added shortcuts for diff view actions and a "Start and Open" shortcut as an alternative to starting a task (shout out to Shey for the idea!)
- Fixed issues with the sidebar Cline chat session not reloading after adding MCP servers
- The project column can now be collapsed all the way to the edge for a minimal view (shout out to Shey for this idea!)
- Fixed issues with some Next.js project configurations in worktrees
- Fixed diff viewer showing false changes for end-of-file-only differences
- Fixed a crash in older browsers when generating UUIDs for board state
- Fixed a crash on Windows when resizing the terminal after the PTY process has exited

## [Cline Kanban 0.1.45]

- Fixed kanban access validation to only apply restrictions to enterprise customers, so non-enterprise users are no longer incorrectly blocked

## [Cline Kanban 0.1.44]

- Fixed remote configuration not being applied correctly

## [Cline Kanban 0.1.43]

- !Klein access can now be gated via Cline remote config
- Fixed "C" (create task) keyboard shortcut crashing when no projects exist
- Fixed macOS directory picker treating cancel as an error instead of a normal cancellation
- Improved agent selection copy during onboarding
- File paths in the settings dialog now display with `~` instead of the full home directory
- Fixed incorrect "kanban" branding in the disconnected screen (now says "Cline")
- Fixed cancel button showing wrong label in detail view panels
- Temporarily disabled Featurebase feedback widget

## [Cline Kanban 0.1.42]

- Fixed auto-update failing on Windows by using the correct `.cmd` extensions for package manager commands (npm, pnpm, yarn)

## [Cline Kanban 0.1.41]

- Cline agent sessions now automatically recover after a runtime teardown, so work isn't lost if the runtime restarts
- Per-task plan/act mode now persists when switching between tasks
- Chat messages sent while the agent is actively working are now queued and delivered when the turn completes, instead of being dropped
- Fixed repeated MCP OAuth callbacks causing errors when the browser fires the redirect more than once
- Fixed corrupt patch captures when trashing tasks in worktrees
- Session IDs are now sanitized for Windows-safe file paths
- Agent mistake tolerance increased from 3 to 6 consecutive errors, giving the agent more room to recover from transient failures
- Fixed the navbar agent setup hint showing incorrect state
- Use the `open` package for cross-platform URL opening instead of custom logic
- Updated Cline SDK to 0.0.15 with file-based store fallbacks, remote config support, improved chat failure handling with message state rollback, and a new `maxConsecutiveMistakes` option to prevent agents from getting stuck in failure loops

## [Cline Kanban 0.1.40]

- Sidebar agent now stays focused on board management and redirects coding requests to task creation, so dedicated agents handle implementation work in their own worktrees
- Fixed feedback widget initialization for Cline-authenticated users

## [Cline Kanban 0.1.39]

- Fixed the feedback widget not opening reliably when clicking "Share Feedback"
- Capitalized button labels for consistency ("Add Project", "Share Feedback")

## [Cline Kanban 0.1.38]

- First-run onboarding for script shortcuts -- new users are guided through creating their first shortcut directly from the top bar
- Settings file URLs can now be opened
- Fixed terminal bottom pane content clearing when running script shortcuts

## [Cline Kanban 0.1.37]

- Slash commands and file mentions in the client chat input field
- Share Feedback button in the bottom left, powered by Featurebase and enriched with Cline account data like email so we can see who reports are coming from, with a Linear integration for automatic issue creation
- MCP OAuth callbacks consolidated onto the main runtime server with real-time auth status updates
- Linear MCP shortcut for one-click install setup
- Updated startup onboarding carousel with a screen about using camera and the agent to add tasks
- Conversation history always visible in detailed task view
- Fixed an issue where adding MCPs wouldn't be available in existing Cline chats -- adding MCPs now resets Cline chats to use them
- Fixed an issue where the client chat would get into a "task chat session is not running" error state. You can now send a message to continue the conversation when Cline fails a tool call
- Fixed an issue where binary diffs would not show up in diff views
- Diff renderer groups removals before additions for easier reading
- Fixed default model selection when OAuth login leaves it blank
- Updated Cline SDK with fixes for ask question tool being disabled in yolo mode, cost calculation, and tool description and truncation logic improvements

## [Cline Kanban 0.1.36]

- Added Sentry error reporting to help identify and fix crashes faster
- Fixed terminal sessions sometimes failing to reconnect, which caused the terminal emulator to scroll to the top during card transitions before scrolling back down
- Fixed onboarding to default to Cline as the AI provider and automatically set the provider's default model, preventing errors when switching providers without updating the model
- Fixed Ctrl+C to wait for Cline to finish shutting down before fully exiting, preventing false double-interrupt exits
- Upgraded Cline SDK from 0.0.7 to 0.0.11 with numerous fixes and improvements:
  - Fixed prompt caching being broken for Anthropic models, meaning users were paying full price every turn. Cost calculation was also fixed (it was double-counting cache reads and ignoring cache writes)
  - Fixed cancelling a request causing all subsequent requests in the session to immediately fail, due to a reused AbortController
  - Fixed Gemini tool use failing for most non-trivial tool schemas. JSON Schema properties not in Gemini's allowed set (like `default`, `pattern`, `minLength`) caused Gemini to reject entire requests
  - Fixed tools with no required parameters (like "list all") being silently dropped
  - Fixed CLI hanging indefinitely in CI/Docker environments when stdin was detected as "not a TTY" but wasn't providing input
  - Fixed Vercel AI Gateway being completely broken (base URL was `.app` instead of `.sh`, so all requests 404'd)
  - Fixed internal metadata fields leaking into API requests sent to providers, wasting tokens
  - Fixed multi-agent team tools failing when the orchestrator sent null for optional filter parameters. Also added concurrent run prevention and better error visibility for teammate failures
  - Fixed MCP tool names with special characters or exceeding 128 chars causing provider schema validation errors (now sanitized with a hash suffix)
  - Fixed OpenRouter and other gateway error messages showing opaque nested JSON blobs instead of the actual error
  - Fixed `--json` mode output being impure (plain text warnings leaked into stdout, breaking JSONL parsing)
  - Fixed SQLite crashing with a disk I/O error on first run instead of auto-creating the data directory
  - Fixed "Sonic boom is not ready yet" error on CLI exit
  - Removed hardcoded 8,192 max output tokens per turn cap, so models are no longer artificially limited
  - Added OpenAI-compatible prompt caching support
  - Added OpenAI-compatible providers now surface truncated responses (`finish_reason: "length"`) so callers can detect them
  - Headless mode no longer requires a persisted API key -- env vars like `ANTHROPIC_API_KEY` now work
  - Headless mode output cleaned up: model info, welcome line, and summary gated behind `--verbose`
  - Config directory is now overridable via `--config` flag or `CLINE_DIR` env var for isolated config across multiple SDK instances
  - `readFile` executor now supports optional `start_line`/`end_line` parameters, enabling models to read specific portions of large files

## [Cline Kanban 0.1.35]

- Added runtime debug tools accessible from the top bar for troubleshooting configuration and agent state
- Settings now automatically retry loading when the initial attempt fails, improving reliability on slower connections

## [Cline Kanban 0.1.34]

- Model pickers now show recommended Cline models for quick selection
- Failed tasks show a red error icon and failure reason on the board card instead of a spinner
- When adding a project on a headless/remote runtime where no directory picker is available, you can now enter the project path manually
- Fixed workspace not refreshing correctly on startup by waiting for the runtime snapshot before syncing
- Fixed !Klein agent creating tasks for worktree paths instead of the main project

## [Cline Kanban 0.1.33]

- Fixed task worktree setup for Turbopack projects no longer attempting slow background copies of node_modules; affected subproject dependencies are now correctly skipped instead of symlinked

## [Cline Kanban 0.1.32]

- Fix concurrent task mutations (e.g. adding multiple tasks at the same time) failing due to write conflicts -- task mutations now use a workspace lock to safely handle simultaneous operations
- Fix a bug where stopping a task that was restored from a previous session would fail because the session wasn't properly reconnected on startup
- Fix a bug where restarting the app would show raw metadata in user messages for old Cline sessions that were reloaded
- Fix worktrees for projects using Turbopack, where symlinked node_modules would cause build failures -- worktrees now fall back to copying node_modules for Turbopack projects
- Fix SDK command parsing that could cause agent system prompts to be malformed
- Fix Cmd+V image paste in the chat composer not working due to the paste handler running asynchronously, causing the browser to swallow the event
- Fix proper-lockfile crashing due to accidentally passing undefined as the onCompromised handler
- Require confirmation before git init when adding projects
- Fix task card agent preview flickering to empty state
- Cancel inline task edit on Escape key press
- Move task worktrees to ~/.cline/worktrees
- Update onboarding intro video and frame width
- Change the start-all-tasks shortcut to Cmd+B

## [Cline Kanban 0.1.31]

- Add ability to resume Cline tasks that were trashed
- Support image attachments for Cline agent chat
- Fix the commit and make PR button in the Cline agent chat panel
- Fix issue where creating multiple tasks at the same time with git submodules would run into a git config locking issue
- Fix script shortcuts to interrupt previously long-running commands, so you no longer need to Ctrl+C before hitting the shortcut again
- Fix issue where running incorrect kanban commands would auto-open the browser
- Preserve runnable kanban command in sidebar prompt
- Avoid premature Codex review state transitions
- Fix diff "Add" button incorrectly sending Cline chat messages
- Various UX improvements (checkbox labels, Cline thinking shimmer animation)

## [Cline Kanban 0.1.30]

- Add MCP server management and OAuth authentication for Cline providers
- Add "Start All Tasks" keyboard shortcut (Alt + Shift + S)
- Show assistant response previews in task card activity instead of generic "Agent active" text
- Track full chat history per task, enabling richer conversation display and reliable message streaming
- Display API key expiry as a human-readable date instead of a raw number
- Support launching !Klein without a selected project (global-only mode)
- Automatically restart agent terminals when the underlying process exits unexpectedly
- Fix prewarm cleanup accidentally disposing the detail panel terminal for active tasks
- Fix task card expand animation jumping by waiting for measured height before animating
- Fix Cline thinking indicator flicker in the chat panel

## [Cline Kanban 0.1.29]

- Fix onboarding and settings screens not working when no projects exist
- Update Cline SDK with auth migration for existing CLI users and fixes for OpenAI-compatible APIs

## [Cline Kanban 0.1.28]

- Onboarding dialog for first-time users with guided walkthroughs for auto-commit, linking, and diff comments
- Dependency links now show arrowheads so you can see direction at a glance, and the agent provides guidance about link direction when creating them
- Cline chat input field now includes a model selector, plan/act mode toggle, and a cancel button to stop generations midstream
- Resizable project sidebar (drag to resize, persists across sessions)
- Show the full command in expanded run_commands tool calls
- Review actions (Commit, Open PR) only appear when there are actual file changes
- Cline chat preserves your scroll position when reading older messages
- Failed tool calls display proper error messages instead of deadlocking the session
- "Thinking" indicator shows while tool calls are loading
- ANSI escape codes from CLI output are stripped instead of showing raw characters
- Inline code in Cline chat wraps correctly instead of overflowing
- Tasks with uncompleted dependencies can no longer be started
- Better error reporting when Cline fails to start (clear messages instead of silent hangs)
- Gracefully handles missing provider settings instead of crashing
- Removed OpenAI, Gemini, and Droid agents to reduce surface area at launch (coming back in follow-up releases)

## [Cline Kanban 0.1.27]

- Upgraded Cline SDK to stable v0.0.4, replacing nightly builds for more reliable native Cline sessions

## [Cline Kanban 0.1.26]

- Trashing a task now saves a git patch of any uncommitted work, and restoring it from trash automatically reapplies those changes so nothing gets lost
- "Create more" toggle in the new task dialog lets you create multiple tasks in a row without reopening the dialog each time
- New keyboard shortcuts: Cmd/Ctrl+G toggles the git history view, Cmd/Ctrl+Shift+S opens settings, and Esc closes git history from the home screen
- Shortcut commands now safely interrupt any running terminal process before executing, so commands no longer get jumbled with whatever was previously running
- Agent file-read activity now shows the full list of files being accessed instead of truncating with "(+N more)"
- Expanding the diff view now automatically closes the terminal panel to avoid overlapping views
- Task worktree cleanup no longer gets stuck when patch capture fails
- Fixed the "Thinking..." indicator incorrectly appearing while the agent is actively streaming a response
- Native Cline sessions now correctly capture their latest changes when entering review
- Removed the redundant "Projects" label below the sidebar segment tabs
- Consistent spacing and alignment across all alert dialogs
- Fixed terminal background color in the detail view to match the rest of the overlay

## [Cline Kanban 0.1.25]

- Added a chat view to the home sidebar for project-scoped agent conversations. What used to be the project column is now a sidebar that can switch between projects and chat.
- The agent can now trash and delete tasks on your behalf using new task management commands
- When no CLI agent is detected, a guided setup flow walks you through getting started
- Replaced the !Klein skill system with `--append-system-prompt` -- since the board now has a dedicated agent, we just append context to its prompt instead of maintaining a separate skill
- Native Cline SDK chat runtime with cancelable turns
- `--host` flag to bind the server to a custom IP address
- Submodules are now initialized automatically in new task worktrees
- Fix Escape key unexpectedly closing the detail view
- Increased shortcut label and footer font sizes
- Capped agent preview lines in task cards

## [Cline Kanban 0.1.24]

- Fixed multiline prompt arguments being broken on Windows cmd.exe

## [Cline Kanban 0.1.23]

- Fix Windows terminal launches incorrectly escaping arguments with spaces, parentheses, and other special characters

## [Cline Kanban 0.1.22]

- Fix Windows terminal launch failing for bare executables (e.g. `cline`) due to unnecessary quoting

## [Cline Kanban 0.1.21]

- Fix Windows agent commands failing to launch
- Fix update detection for Windows npm-cache npx transient installs
- Reduce false-positive triggering of the kanban skill
- Show worktree errors in toasts

## [Cline Kanban 0.1.20]

- Fix branch picker showing remote tracking refs instead of just local branches, and enable trackpad scrolling in the picker
- Fix task card activity not updating when Opencode completes hook actions
- Fix Cline tasks getting stuck instead of returning to in-progress when asking follow-up questions during review

## [Cline Kanban 0.1.19]

- Fixed a race condition where navigating to a task's detail view could trigger an unintended auto-start
- Fixed shutdown cleanup to reliably stop all running tasks across projects

## [Cline Kanban 0.1.18]

- Fix layout stability when moving cards between columns programmatically
- Improve checkbox contrast on dialog footers
- Reduce dialog header/footer side padding to match vertical padding
- Fix description briefly flashing on card mount

## [Cline Kanban 0.1.17]

- Fix keyboard shortcuts (Cmd+Enter) not working when focus is on dialog inputs

## [Cline Kanban 0.1.16]

- Fixed agent startup reliability and command detection
- Fixed path handling on Windows and Linux for cross-platform support

## [Cline Kanban 0.1.15]

- Fix diff view syntax highlighting colors in git history
- Improve graceful shutdown handling for CLI processes
- Fix worktree symlink mirroring for ignored paths to avoid blocking operations
- Fix process cleanup on Windows when tasks time out
- Support Windows AppData path discovery for Opencode integration
- Make "Open in Editor" workspace actions work correctly across platforms
- Add directory picker support on Windows
- Fix transcript path detection in hooks
- Handle Linux directory picker fallbacks and errors gracefully

## [Cline Kanban 0.1.14]

- Fixed a crash on Linux systems where no browser opener (xdg-open, etc.) was available

## [Cline Kanban 0.1.13]

- New task creation dialog with list detection for quickly creating multiple tasks at once
- Git history now shows remote refs and branch divergence so you know if you need to pull
- Expandable task card descriptions -- click to reveal the full description inline
- Notifications now show the latest agent message
- Improved split diff rendering by consolidating same hunk changes
- Fixed issue where cards in the kanban column updating content would cause scroll jumps

## [Cline Kanban 0.1.12]

- Redesigned the web UI with a refined dark theme, custom UI primitives, and polished controls for a more professional look and feel
- Added split diff view so you can click the expand button above any diff to see changes side by side
- Added last turn changes, which takes a Git snapshot each time you send a message to your agent so you can see exactly what changed since your last message
- Added an all changes view to see every modification in a task's worktree at a glance
- Resizable agent terminal emulator so you can drag to make it bigger or smaller
- Inline task creation controls with keyboard shortcut hints
- Fix diff panel persisting stale content when switching views
- Fix last-turn diff transitions flickering during scope changes
- Only keep terminal connections alive for tasks actively on the board, and clean them up when the runtime disconnects
- Fix WebSocket proxy so terminal connections work correctly during local development
- Fix the dogfood launcher not waiting for the child process to exit, which could leave orphaned processes on shutdown

## [Cline Kanban 0.1.11]

- Add !Klein skill for creating and managing tasks directly from your agent
- Remove !Klein MCP server in favor of skill-based task automation

## [Cline Kanban 0.1.10]

- Add "Start task" button to create task card -- press `c` to create, type your task, then Cmd+Shift+Enter to start it right away
- Add "Cancel auto-review" actions to task cards
- Add "Start All" button to backlog column header to start all backlog tasks at once
- Add Cmd+Enter shortcut for sending diff comments
- Show keyboard shortcut hints on the create task button
- Simplified shortcut icon picker
- Show authentication warning callout in Linear MCP setup dialog
- Show loading state on trash button while deleting
- Resume paused droid tasks when read/grep hooks fire
- Fix stale diff persisting when switching between task details
- Fix stale script shortcuts lingering after switching projects
- Fix git history flicker during scope switches
- Fix terminal rendering for Droid CLI in split terminals
- Fix linked task start animations
- Detect when GitHub/Linear/!Klein MCPs are already installed to skip unnecessary setup dialogs
- Fix resuming trashed tasks after terminal refactors
- Fix Droid CLI review state transitions around AskUser tool calls
- Default new users to Cline CLI when installed
- Highlight active branch button in blue
- Fix settings dialog appearing disabled during config refresh
- Center selected detail card in sidebar

## [Cline Kanban 0.1.9]

- Fix worktree paths with symlinks in ignored directories being incorrectly treated as active

## [Cline Kanban 0.1.8]

- Terminal now properly renders full-screen TUI applications like OpenCode
- Fixed terminal content disappearing and scroll back being lost when opening a task. Terminals are now created proactively for each agent instead of connecting mid-session, which preserves full scroll back and content rendering. This is especially important for rendering TUI apps like Codex and Droid correctly.
- Improved terminal rendering quality, inspired by VS Code's xterm and node-pty implementation. Noticeably higher FPS, smoother scrolling, and a more native look and feel for terminal emulators.

## [Cline Kanban 0.1.7]

- When a task prompt mentions creating tasks (e.g. "break down into tasks", "create 3 tickets", "split into cards"), !Klein now shows a setup dialog offering to install the !Klein MCP before the task starts
- Similar setup dialogs appear for Linear and GitHub CLI when task prompts reference those services
- MCP server instructions now guide agents to detect the ephemeral worktree path and pass the main worktree as projectPath, so "add tasks in kanban" tasks correctly create tasks in the main workspace instead of the ephemeral task worktree

## [Cline Kanban 0.1.6]

- Show live hook activity (tool calls, file edits, command runs) on task cards as agents work
- Auto-confirm Codex workspace trust prompts so tasks start without manual intervention
- Show working copy changes in the detail panel's git history
- Fix terminal pane state bleeding across tasks when switching between them
- Fix duplicate paste events in agent terminals
- Stop detail terminals when trashing tasks to free resources
- Automatically pick up new versions when launching with `npx nklein`
- Fix git metadata not updating reliably when switching projects
- Stabilize workspace metadata stream startup

## [Cline Kanban 0.1.5]

- Added Droid CLI agent support alongside Claude and Codex
- Dogfood launcher for quickly opening !Klein on its own repo with runtime port selection
- Terminal rebuilt around xterm and node-pty for better performance and reliability
- Filter terminal device attribute auto-responses from being sent to agents as input
- Fix workspace metadata causing unnecessary rerenders, with retry recovery
- Fix task worktrees being recreated when the base ref updates if they already exist
- Fix self-ignored directories being symlinked in task worktrees
- Fix bypass permissions toggle resetting unexpectedly
- Fix git refs not clearing when switching detail scope

## [Cline Kanban 0.1.4]

- Each task gets its own CLI agent working in a git worktree, so they can work in parallel on the same codebase without stepping on each other
- When an agent finishes, review diffs and leave comments before deciding what to merge
- Commit or open a PR directly from the board, and the agent writes the commit message or PR description for you
- Link tasks together to create dependency chains, where one task finishing kicks off the next, letting you complete large projects end to end
- "Automatically commit" and "automatically open PR" toggles give agents more autonomy to complete work on their own
- MCP integration lets agents add and start tasks on the board themselves, decomposing large work into parallelizable linked tasks
- Built-in git visualizer shows your branches and commit history so you can track the work your agents are doing
