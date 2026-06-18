# Follow-up 2 - under-the-hood hardening checklist

> Follow-up plan from the GPT-5.5 Medium alignment pass. This turns the agreed "under the hood"
> findings into an implementation checklist. `- [ ]` = open work to do. `- [x]` = verified or complete.

## Verdict

!Klein's visible UX issues around advisor settings, generated cards, code intelligence, and the reappearing
!Klein project all point back to a few deeper boundaries that need to be made explicit:

- workspace identity must not be inferred too eagerly from the current working directory;
- task artifacts must belong to a specific workspace and source task;
- lost task sessions need recoverable states instead of lingering as "running";
- board state and runtime session state should have separate persistence ownership;
- developer/self-improvement tools need stronger gating so they do not pollute normal usage.

The implementation should favor correctness and recovery over clever automation. Where !Klein can repair or
apply something automatically, it should still keep an observable artifact trail and a user-visible escape hatch.

---

## F0 - Workspace identity and project registration

- [x] **Make project registration explicit-only.**
  - [x] Remove startup behavior that auto-registers the process `cwd` merely because it is inside a Git repo.
  - [x] Preserve existing indexed projects on startup without silently recreating a removed project.
  - [x] Require Add Project or another explicit confirmed flow before a path becomes a board project.
  - [x] Keep ordinary project loading fast once a project is already registered.

- [x] **Protect the !Klein source repo as a self-improvement project.**
  - [x] Detect the !Klein app source repo by comparing the runtime startup repo/root with candidate project paths.
  - [x] If `/Users/david/GIT/kanban` or the app source root is not registered, do not auto-add it.
  - [x] Add a dedicated "Load !Klein source as project" or equivalent self-improvement action.
  - [x] Show an extra confirmation before loading !Klein's own code as a project.
  - [x] Respect prior user removal of the !Klein project until the user explicitly adds it again.
  - [x] Apply the same confirmation when the normal Add Project flow selects !Klein's own repo.

- [x] **Resolve task worktrees to their owning parent workspace.**
  - [x] Detect paths under `~/.cline/worktrees/...` before calling workspace auto-creation logic.
  - [x] Resolve task worktree commands to the parent project/workspace id recorded for the task.
  - [x] Prevent task worktree paths from being registered as standalone projects unless an advanced explicit flow confirms it.
  - [x] Prefer explicit workspace id/project path from task/session/hook context over `cwd`.
  - [x] Make `nklein task decompose`, task hooks, and task artifact application use the owning workspace, not the task worktree.

- [x] **Add accidental-project detection and repair UX.**
  - [x] Detect workspace index entries whose project path is under `~/.cline/worktrees`.
  - [x] Detect stale dev-test/worktree projects that have no valid parent project relationship.
  - [x] Present detected accidental projects to the user with choices to inspect, remove, or migrate artifacts.
  - [x] Do not silently migrate or delete existing accidental entries.
  - [x] Include the observed complex dev-test workspace case in the regression fixtures.

- [x] **Tests for workspace identity.**
  - [x] Starting !Klein from the !Klein repo does not recreate a removed !Klein project.
  - [x] Explicitly adding the !Klein repo requires confirmation and succeeds after confirmation.
  - [x] Running CLI commands inside a task worktree resolves to the parent workspace.
  - [x] Running decomposition inside a task worktree creates cards in the parent board.
  - [x] Task worktree paths cannot become new projects through implicit resolution.
  - [x] Existing non-self projects still load normally after startup.

---

## F1 - Decomposition artifacts and generated card application

- [x] **Make generated task graphs workspace-owned artifacts.**
  - [x] Store every decomposition/buildout/spec graph with an artifact id.
  - [x] Store the owning workspace id, source task id, artifact kind, created timestamp, and validation status.
  - [x] Apply artifacts by `{ workspaceId, artifactId }`, not by slug or current working directory.
  - [x] Keep source card provenance on generated cards.
  - [x] Make artifact application idempotent so retrying does not duplicate cards or links.

- [x] **Auto-apply generated cards by default, with clear overrides.**
  - [x] Add a global setting for automatic card creation from valid decomposition/buildout/spec artifacts.
  - [x] Default the setting to enabled.
  - [x] Add a per-card override that can disable auto-apply for a specific source card.
  - [x] When auto-apply is enabled, create cards and dependencies on the owning parent board immediately after validation.
  - [x] When auto-apply fails, keep the artifact pending and show a recovery action on the source card.

- [x] **Add inline artifact review when auto-apply is disabled.**
  - [x] Show pending artifacts on the source card detail panel.
  - [x] Include artifact kind, task count, dependency count, validation status, and created timestamp.
  - [x] Add Apply and Reject actions.
  - [x] After Apply, create cards/dependencies in the source workspace and mark the artifact applied.
  - [x] After Reject, keep a compact record that the artifact was rejected without cluttering the board.

- [x] **Fix the complex dev-test stalled-card class of bug.**
  - [x] Reproduce the observed case where chat says 10 tasks were generated but the parent board has no new cards.
  - [x] Verify the cards were created in the accidental task-worktree project today.
  - [x] Add regression coverage proving future decomposition writes to the parent project.
  - [x] Add recovery handling for existing accidental project artifacts from the observed workspace.

- [x] **Tests for artifact application.**
  - [x] Valid graph auto-applies to parent workspace.
  - [x] Auto-apply disabled creates an inline pending artifact review.
  - [x] Applying a pending artifact is idempotent.
  - [x] Rejecting a pending artifact prevents later accidental application.
  - [x] Slug collisions do not apply the wrong graph.
  - [x] Missing parent workspace produces a clear recoverable error.

---

## F2 - Lost session recovery and auto-review reliability

- [x] **Add explicit lost-session recovery behavior.**
  - [x] Detect sessions whose heartbeat status becomes `lost`.
  - [x] If useful output, success-looking messages, or pending artifacts exist, park the task into a clear needs-attention or review-style state.
  - [x] Add actions: Resume, Mark interrupted, Apply pending artifacts.
  - [x] Preserve session transcript and latest artifact references for recovery.
  - [x] Show a human-readable reason on the card instead of relying only on raw heartbeat status.

- [x] **Allow users to keep lost sessions marked running.**
  - [x] Add a setting for lost-heartbeat policy.
  - [x] Default to Park + Actions.
  - [x] Provide an alternative "Keep running" mode for manual operators.
  - [x] Make the selected policy visible enough that behavior is not surprising.

- [x] **Make auto-review outcomes observable and trustworthy.**
  - [x] Confirm auto-review runs when cards reach review.
  - [x] If auto-review cannot run, show a specific reason and recovery action.
  - [x] If auto-review succeeds but no commit/PR/worktree effect happened, flag the card for attention.
  - [x] Surface review checkpoint capture failures when they affect recovery.
  - [x] Keep harmless cleanup failures best-effort but record diagnostics.

- [x] **Expose verify and merge actions where they belong.**
  - [x] Add a Verify action for Review/Planning cards when an `Acceptance check:` line is detected.
  - [x] Run verification in the correct task worktree by default.
  - [x] Show status, output summary, and failure reason on the card or detail panel.
  - [x] Add a Review-lane action to merge reviewed work.
  - [x] Show merge progress, conflicts, skipped tasks, and cleanup status.
  - [x] Avoid a full merge dashboard in this pass.

- [x] **Tests for recovery and review.**
  - [x] Lost heartbeat with pending graph parks and exposes Apply pending artifacts.
  - [x] Lost heartbeat with no useful output can be marked interrupted.
  - [x] Keep-running policy preserves the running state but makes lost status visible.
  - [x] Auto-review success produces the expected commit/PR state or card transition.
  - [x] Auto-review claimed success with no effect is flagged.
  - [x] Verify action appears only when acceptance checks are present.
  - [x] Merge reviewed work reports conflicts without deleting worktrees prematurely.

---

## F3 - Persistence ownership and conflict handling

- [x] **Split board state and runtime session ownership.**
  - [x] Make board persistence responsible for cards, lanes, dependencies, project metadata, and board-level config only.
  - [x] Make runtime services own session summaries, terminal summaries, heartbeat status, checkpoints, and runtime progress.
  - [x] Stop requiring UI board saves to carry full session snapshots.
  - [x] Avoid backend mutation of incoming UI session payloads as part of board save.
  - [x] Stream or patch runtime-owned session changes through the runtime state channel.

- [x] **Improve board save conflict handling.**
  - [x] Preserve the local user operation that lost a revision race.
  - [x] For simple operations, rebase and retry against the latest board state.
  - [x] For unsafe conflicts, show a non-destructive banner with retry/apply-local-edit guidance.
  - [x] Avoid blunt refetch behavior that makes the user redo a just-made edit.

- [x] **Add operation-level persistence where helpful.**
  - [x] Consider representing card moves, edits, dependency changes, and trash/restore as explicit operations.
  - [x] Keep full-state saves only where they remain simpler and safe.
  - [x] Ensure operation replay is deterministic and revision-checked.

- [x] **Tests for persistence.**
  - [x] Runtime session updates are not overwritten by board saves from stale UI state.
  - [x] A concurrent simple card move conflict is retried or safely reapplied.
  - [x] A complex conflicting edit shows a clear recovery path.
  - [x] Streamed runtime state still updates the active board without requiring a board save.
  - [x] Multi-tab edits do not silently drop the later user's operation.

---

## F4 - Runtime settings and model configuration exposure

- [x] **Advisor settings: replace copy-only prompt flow.**
  - [x] Remove or de-emphasize the "Copy prompt" advisor action.
  - [x] Add a local Cline model selector for advisor prompts.
  - [x] Add a Send prompt action.
  - [x] Send the generated prompt to the selected local Cline-compatible model.
  - [x] Show a read-only or editable output textbox with the model response.
  - [x] Show sent timestamp and received timestamp.
  - [x] Show failure text in the output area when the send fails.
  - [x] Keep v1 scoped to local Cline providers only.

- [x] **Clarify context labels and override behavior.**
  - [x] Rename "Effective" to "Effective context".
  - [x] Rename corresponding override labels to "Context override" or "Effective context override".
  - [x] Label the context token selector as an override when that is what it controls.
  - [x] Show units for token counts.
  - [x] Make inherited/default/effective values visually distinct.

- [x] **Expose full Cline task settings without raw internal names.**
  - [x] Preserve full `RuntimeTaskClineSettings` when editing task model settings.
  - [x] Expose context scope using human labels.
  - [x] Expose timeout settings with human labels and units.
  - [x] Avoid labels like `requestTimeoutMs` as primary UI text.
  - [x] Keep raw keys secondary only where useful for advanced diagnostics.
  - [x] Ensure model role settings can preserve provider, model, reasoning, context scope, and timeout overrides.

- [x] **Clean up internal model names.**
  - [x] Confirm `small-local-model` and related names are test/internal only.
  - [x] Rename fixtures if needed so they cannot appear user-facing.
  - [x] Add guardrails/tests to prevent fixture model ids from leaking into runtime model selectors.
  - [x] Prefer real detected LM Studio/Ollama model names in user-facing examples.

- [x] **Tests for model/settings UI.**
  - [x] Advisor send records sent and received timestamps.
  - [x] Advisor output renders success and failure responses.
  - [x] Context labels use "Effective context" and clear override language.
  - [x] Editing task model settings preserves all existing Cline settings.
  - [x] Fixture model ids do not appear in production model selectors.

---

## F5 - Code intelligence and embedding configuration

- [x] **Move code intelligence to project context.**
  - [x] Remove code intelligence status from global settings as the primary location.
  - [x] Add a project-scoped code intelligence panel near the selected-project left sidebar bottom.
  - [x] Co-locate it with project activity/status information, below or near lane summaries.
  - [x] Show indexing status, embedding provider, embedding model, last indexed timestamp, and errors.
  - [x] Keep the panel hidden or disabled when no project is selected.

- [x] **Add global default embedding model settings.**
  - [x] Add global default embedding provider/model fields to runtime config.
  - [x] Include local lexical fallback as a clearly named fallback, not oversold as semantic embeddings.
  - [x] Support OpenAI-compatible/local endpoint settings where already supported under the hood.
  - [x] Avoid requiring environment variables for normal user configuration.
  - [x] Keep API keys or secrets handled safely if provider support requires them.

- [x] **Add project-specific embedding override.**
  - [x] Allow each project/workspace to override the global embedding provider/model.
  - [x] Show inherited global defaults and effective project values.
  - [x] Re-index or invalidate cache when the effective embedding cache key changes.
  - [x] Make override reset easy.

- [x] **Tests for code intelligence configuration.**
  - [x] Global embedding defaults persist and reload.
  - [x] Project override changes effective embedding model for that workspace.
  - [x] Cache entries remain separated by embedding provider/model cache key.
  - [x] Code intelligence panel appears only with a selected project.
  - [x] `local_lexical` fallback is labeled honestly.

---

## F6 - Developer tools and self-improvement safety

- [x] **Gate developer-only features.**
  - [x] Move dogfood backlog, smoke eval, dev-test project creation/cleanup, debug resets, and self-improvement controls into a Developer Tools area.
  - [x] Hide Developer Tools unless debug/dev mode is enabled.
  - [x] Keep normal settings focused on user-facing runtime configuration.
  - [x] Add explicit confirmations for actions that create projects, delete worktrees, reset state, or operate on !Klein's own repo.

- [x] **Improve dev-test cleanup hygiene.**
  - [x] Detect dev-test workspaces by durable metadata, not only basename patterns.
  - [x] Await worktree cleanup before reporting deletion success.
  - [x] Remove saved task patches for removed dev-test projects.
  - [x] Report leftover paths that could not be cleaned.
  - [x] Do not clean unrelated user projects that merely look similar.

- [x] **Tests for developer tool gating.**
  - [x] Developer Tools are hidden in normal mode.
  - [x] Developer Tools appear in debug/dev mode.
  - [x] Dev-test cleanup removes only marked !Klein-created projects.
  - [x] Self-project actions require confirmation.
  - [x] Cleanup reports partial failures without claiming full success.

---

## F7 - Observability and diagnostics

- [x] **Surface recovery-affecting best-effort failures.**
  - [x] Capture checkpoint creation failures that reduce the ability to review or recover a task.
  - [x] Capture artifact persistence/application failures.
  - [x] Capture session restart/resume failures with actionable messages.
  - [x] Keep low-value cleanup noise out of the main UI unless it blocks recovery.

- [x] **Add project/workspace diagnostics.**
  - [x] Add a diagnostic check for accidental worktree projects.
  - [x] Add a diagnostic check for missing parent workspaces.
  - [x] Add a diagnostic check for lost sessions with pending artifacts.
  - [x] Add a diagnostic check for stale generated artifacts that were never applied or rejected.
  - [x] Present diagnostics in Developer Tools or a project health area.

- [x] **Improve telemetry for hardening work.**
  - [x] Log workspace resolver decisions with source: explicit id, explicit path, parent worktree, existing index, or rejected auto-registration.
  - [x] Log artifact lifecycle events: created, validated, applied, rejected, failed.
  - [x] Log lost-session recovery transitions.
  - [x] Avoid logging secrets or full prompts.

---

## Suggested implementation order

1. [x] **Workspace resolver and self-project guard** - fixes the reappearing !Klein project and prevents new accidental task-worktree projects.
2. [x] **Artifact ownership and decomposition apply path** - fixes the generated-10-tasks-but-no-cards bug class.
3. [x] **Lost-session recovery actions** - makes stalled cards recoverable and explains what happened.
4. [x] **Persistence ownership split** - reduces stale overwrite/conflict risk before more runtime state is added.
5. [x] **Advisor/model/context settings cleanup** - visible user-facing polish on top of safer internals.
6. [x] **Code intelligence embedding settings and sidebar move** - aligns workspace-specific configuration with where users inspect projects.
7. [x] **Developer Tools gating and diagnostics** - keeps advanced/self-improvement features powerful but out of the normal user's way.

---

## Acceptance criteria

- [x] Removing the !Klein project stays respected across restarts.
- [x] Loading !Klein's own repo requires an explicit self-improvement confirmation.
- [x] Running decomposition from inside a task worktree creates cards on the parent board.
- [x] Existing accidental worktree projects are detected and presented for user decision.
- [x] Lost sessions no longer sit indefinitely as ordinary running cards when useful artifacts exist.
- [x] Board saves cannot overwrite runtime-owned session status.
- [x] Advisor can send a prompt to a selected local Cline model and show response timestamps.
- [x] Code intelligence embedding defaults and project overrides are user-configurable.
- [x] Developer-only features are hidden unless debug/dev mode is enabled.
- [x] Tests cover the observed complex dev-test workspace failure mode.
