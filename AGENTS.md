This file captures tribal knowledge-the nuanced, non-obvious patterns that make the difference between a quick fix and hours of debugging.
When to add to this file:
- User had to intervene, correct, or hand-hold
- Multiple back-and-forth attempts were needed to get something working
- You discovered something that required reading many files to understand
- A change touched files you wouldn't have guessed
- Something worked differently than you expected
- User explicitly asks to add something
Proactively suggest additions when any of the above happen-don't wait to be asked.
What NOT to add: Stuff you can figure out from reading a few files, obvious patterns, or standard practices. This file should be high-signal, not comprehensive.

---

TypeScript principles
- No any types unless absolutely necessary.
- Check node_modules for external API type definitions instead of guessing.
- Prefer SDK-provided types, schemas, helpers, and model metadata over local redefinitions. For things like NKlein SDK reasoning settings, use the SDK's source of truth whenever possible instead of recreating unions, support checks, or shapes in !Klein.
- NEVER use inline imports. No await import("./foo.js"), no import("pkg").Type in type positions, and no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies. Upgrade the dependency instead.

Code quality
- Write production-quality code, not prototypes
- Break components into small, single-responsibility files. 
- Extract shared logic into hooks and utilities. 
- Prioritize maintainability and clean architecture over speed. 
- Follow DRY principles and maintain clean architecture with clear separation of concerns.
- In `web-ui`, prefer `react-use` hooks (via `@/kanban/utils/react-use`) whenever possible
- Before adding custom utility code, evaluate whether a well-maintained third-party package can reduce complexity and long-term maintenance cost.

Architecture opinions
- Avoid thin shell wrappers that only forward props or relocate JSX for a single call site.
- Prefer extracting domain logic (state, effects, async orchestration) over presentation-only pass-through layers.
- Do not optimize for line count alone. Optimize for codebase navigability and clarity.

Git guardrails
- NEVER commit unless user asks.
- Keep `CHANGELOG.md` current: every feature, fix, or behavior change should add or update the `## [Upcoming]` section in the same change.

GitHub issues
When reading issues:
- Always read all comments on the issue.
- Use this command to get everything in one call:
  gh issue view <number> --json title,body,comments,labels,state

When closing issues via commit:
- Include fixes #<number> or closes #<number> in the commit message. This automatically closes the issue when the commit is merged.

web-ui Stack
- !Klein web-ui uses Tailwind CSS v4 for styling, Radix UI for accessible headless primitives, and Lucide React for icons.
- Custom UI primitives live in `src/components/ui/` (button, dialog, tooltip, kbd, spinner, cn utility).
- Toast notifications use `sonner`. Import `{ toast }` from `"sonner"` or use `showAppToast` from `@/components/app-toaster`.

Styling mental model
- Use Tailwind utility classes as the primary styling system. Prefer `className` over inline `style={{}}`.
- Prefer Tailwind classes over adding custom CSS in `globals.css` when possible. Conditional Tailwind classes via `cn()` are better than CSS overrides for state-driven styling (e.g. selected/active variants). Reserve `globals.css` for things Tailwind can't express: complex selectors (sibling combinators, attribute selectors), app-level layout glue, or styles that genuinely need to cascade.
- Only use inline `style={{}}` for truly dynamic values (colors from props/variables, computed positions from drag-and-drop, runtime-dependent dimensions).
- The design system tokens are defined in `globals.css` inside `@theme { ... }`. Use Tailwind utilities that reference them: `bg-surface-0`, `text-text-primary`, `border-border`, etc.

Design tokens (defined in globals.css @theme)
- Surface hierarchy: `surface-0` (#1F2428, app bg / columns), `surface-1` (#24292E, navbar / project col / raised), `surface-2` (#2D3339, cards/inputs), `surface-3` (#353C43, hover), `surface-4` (#3E464E, pressed/scrollbars)
- Borders: `border` (#30363D, default), `border-bright` (#444C56, more visible), `border-focus` (#0084FF, focus rings)
- Text: `text-primary` (#E6EDF3), `text-secondary` (#8B949E), `text-tertiary` (#6E7681)
- Accent: `accent` (#0084FF), `accent-hover` (#339DFF)
- Status: `status-blue` (#4C9AFF), `status-green` (#3FB950), `status-orange` (#D29922), `status-red` (#F85149), `status-purple` (#A371F7), `status-gold` (#D4A72C)
- Border radius: `rounded-sm` (4px), `rounded-md` (6px), `rounded-lg` (8px), `rounded-xl` (12px)

UI primitives (src/components/ui/)
- `Button` from `@/components/ui/button`: `variant="default"|"primary"|"danger"|"ghost"`, `size="sm"|"md"`, `icon={<LucideIcon />}`, `fill`, children for text content.
- `Dialog`, `DialogHeader`, `DialogBody`, `DialogFooter` from `@/components/ui/dialog`: For modals. `DialogHeader` takes a `title` string.
- `AlertDialog`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` from `@/components/ui/dialog`: For destructive confirmations.
- `Tooltip` from `@/components/ui/tooltip`: `<Tooltip content="text"><trigger/></Tooltip>`.
- `Spinner` from `@/components/ui/spinner`: `size` (number), `className`.
- `Kbd` from `@/components/ui/kbd`: Keyboard shortcut display.
- `cn` from `@/components/ui/cn`: Utility for conditional className joining.

Icons
- Use `lucide-react` for all icons. Import individual icons: `import { Settings, Plus, Play } from "lucide-react"`.
- Standard icon sizes: 14px for small buttons, 16px for default contexts.
- Pass icons as JSX elements to button `icon` prop: `icon={<Settings size={16} />}`.

Radix UI primitives
- Use Radix directly for headless behavior: `@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-checkbox`, `@radix-ui/react-switch`, `@radix-ui/react-collapsible`, `@radix-ui/react-select`.
- Style Radix components with Tailwind classes. Use `data-[state=checked]:` for state-driven styling.

Dark theme
- The app is always in dark theme. Colors are set via CSS custom properties in `globals.css`.
- Surface hierarchy: `bg-surface-0` (app background) -> `bg-surface-1` (raised panels) -> `bg-surface-2` (cards/inputs) -> `bg-surface-3` (hover) -> `bg-surface-4` (pressed).
- Do NOT use Blueprint, Tailwind's light-mode defaults, or any `dark:` prefix. The theme is always dark.

Misc. tribal knowledge
- **WORKING MODE — autonomous, full capabilities (do NOT forget / re-litigate).** The agent has **all needed capabilities and tools** in the working environment and uses them itself: a **headless browser (Playwright)** it drives for any UI work + verification, **Docker** + the `nklein/agent-sandbox` image, a **live LM Studio** with loaded models, the **dev-test projects** + `collect evidence`, and the full repo toolchain. **There are NO babysitting / "watched" sessions.** All user interaction is limited to **adding specs, guiding direction, and clarifying questions**; **everything else is autonomous** — implementation, browser/UI interaction + verification, Docker/sandbox runs, dev-test sweeps, all live verification. Never defer work by assuming a missing capability or a need for the user to watch/click — if a change needs UI/live verification, drive the browser/Docker/models yourself. (Repeatedly mis-assumed in the past; this note exists so it stops happening. The only legitimate reasons to pause: a genuine spec/clarification question, or splitting a large job across context windows.)
- !Klein's native NKlein agent is powered by the installed `@nkleinbot/core` and `@nkleinbot/llms` packages plus the local `src/nklein-sdk/` boundary layer, so when NKlein behavior is unclear, inspect those packages and `src/nklein-sdk/` for the real implementation details.
- The NKlein session host does not expose its internal session map. Model changes may use the public `updateSessionModel` API; provider, endpoint, reasoning, mode, context, or timeout changes require restarting from persisted history. Never cast the host to a private `sessions` shape and mutate it.
- Default NKlein/sandbox tasks no longer use host task worktrees: their work lives in the Docker sandbox volume (`/workspaces/<taskId>`) and is captured as an `nklein/tasks/<task>` result branch the trusted runtime applies to the user's repo (see `src/workspace/task-result-branches.ts`). The host worktree subsystem (`src/workspace/task-worktree*.ts`, the `ensureWorktree` tRPC mutation) is **legacy**, reached only by (a) explicit non-NKlein terminal/CLI agents — disabled under the local-only lockdown — and (b) user-opened shell terminals on a task (`resolveTaskCwd({ ensure: true })`). The single boundary predicate is `usesLegacyHostTaskWorkspace(agentId)` in `src/core/agent-catalog.ts`; never re-derive it. Fully deleting the worktree modules is deferred (plan.md §2.B) because they are still compile-/contract-coupled to the web-ui legacy path and the shell-terminal flow — it requires removing terminal agents from the catalog and reworking shell-on-task, which needs UI verification.
- Legacy host task worktrees (when they exist) intentionally preserve agent progress. External project-folder changes are copied only onto paths still owned by the project sync state; overlapping agent edits must remain isolated and produce a warning. Removing an entire project is different from trashing a task: await all worktree cleanup and delete saved task patches so re-adding the folder cannot restore stale content.
- !Klein is launched from the user's shell and inherits its environment. For agent detection and task-agent startup, prefer direct PATH checks and direct process launches over spawning an interactive shell. Avoid `zsh -i`, shell fallback command discovery, or "launch shell then type command into it" on hot paths. On setups with heavy shell init like `conda` or `nvm`, doing that per task can freeze the runtime and even make new Terminal.app windows feel hung when several tasks start at once. It's fine to use an actual interactive shell for explicit shell terminals, not for normal agent session work.
- NKlein agent tool execution is containerized. SDK default tools and sandbox acceptance checks must go through the Docker `AgentSandboxManager`; do not add host fallbacks for agent `bash`, read, search, editor, or patch execution. The shell-startup guidance above is for CLI detection, legacy terminal/shell sessions, and explicit user terminals, not for NKlein agent tool side effects.
- Host-path recovery must cover raw sandbox command strings as well as structured file-tool path fields. Models often run `cd <host temp project> && ...` after seeing trusted runtime paths; inside Docker that must become `cd . && ...` or they misdiagnose the sandbox as unavailable and start alternate-access loops.
- If CI hangs on Node 22 after tests seem to finish, suspect a live subprocess or SDK-host startup path before assuming a slow test body. Read `.plan/docs/node22-ci-hanging-tests-investigation.md` before repeating that investigation. `test/runtime/nklein-sdk/nklein-task-session-service.test.ts` was the big prior culprit because a unit-style suite was still booting the real NKlein SDK host.
- When !Klein runs on a headless remote Linux instance (for example over SSH+tunnel), native folder picker commands may be unavailable (`zenity`/`kdialog`). Treat this as a normal remote-runtime limitation and use manual path entry fallback instead of requiring desktop packages.
- Git repositories initialized or cloned by !Klein carry the local Git config marker `kanban.repositoryCreatedByKanban=true`. Keep the workspace-index ownership flag in sync with that marker so ownership survives removing and re-adding a project. Only offer deletion of `.git` for marked repositories, and remove task worktrees before deleting repository metadata.
- Keep ordinary NKlein `read_files` behavior stateless for normal code, small files, and focused excerpts. Only use !Klein's `read_large_file` workflow when a file must be read completely and would not fit in available context; do not use it just because a file is somewhat long. When `read_large_file` is genuinely needed, use reasonably large safe primary chunks to reduce chunk count and stitching areas, cover primary chunks through EOF, return every stitching window, and require final deduplicated synthesis before completion.
- When tightening NKlein read-loop guardrails, cover both per-file content coverage and exact batch request fingerprints. Small models often reread the same 2-4 file group in alternating batches, so single-file duplicate checks alone do not stop the loop; still allow narrower focused reads after a batch so agents can recover when compacted context drops verbatim lines.
- NKlein diagnostics and generated-card starts are workspace-sensitive. Task ids such as `dev-habit-insights-mid` repeat across dev-test projects, so diagnostics must be scoped by workspace identity/path hash, not just task id. Decomposition-generated implementation cards land in `planning` with `startInPlanMode: false`; start paths must allow those cards to move from Planning to `in_progress`, otherwise the generated DAG looks correct but cannot actually run.
- LM Studio is a live-only local provider. Do not trust SDK/catalog default model ids for selection because they can point at an unloaded stale model such as `openai/gpt-oss-20b`; discover loaded models from the live endpoint, fall back to the catalog localhost base URL when no base URL is saved, and prefer selecting a currently loaded model.
- **Be robust against small/weak-model output errors rather than trying to teach the model.** When a small/quantized local model malforms its output, the durable fix is to *parse and recover* in !Klein, not to add another re-prompt/instruction (models that make the mistake often can't follow the correction either, and it burns turns/budget). Canonical example: models "narrate" tool calls as `<tool_call>{…}</tool_call>` text in the content/reasoning channel instead of emitting a structured call — recovered by `recoverNarratedToolCalls` in the `afterModel` hook (`nklein-narrated-tool-call.ts`), which appends a real tool-call part so the agent loop dispatches it. The single robust seam for "model output text → executed tool call" is the `afterModel` hook mutating `message.content` *before* the vendored `agent-runtime` loop extracts tool-call parts (it filters `message.content`, not the finishReason). Apply this parse-and-recover principle to every weak-model failure mode (malformed tool args already go through the shared `repairJsonValue`).
