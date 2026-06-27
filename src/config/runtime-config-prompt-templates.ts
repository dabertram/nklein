// Default + legacy git-delivery prompt templates for the runtime-config facade (§5.AK slice). Extracted verbatim from
// runtime-config.ts so the big multi-line strings don't clutter the config logic; runtime-config.ts imports them back.
// `{{base_ref}}` is substituted at use. The LEGACY_HOST_WORKTREE_* pair is back-compat for pre-isolation host worktrees;
// the DEFAULT_* pair is the current isolated-workspace flow.

export const LEGACY_HOST_WORKTREE_COMMIT_PROMPT_TEMPLATE = `You are in a task workspace on a detached HEAD. When you are finished with the task, commit the working changes onto {{base_ref}}.

- Do not run destructive commands: git reset --hard, git clean -fdx, git worktree remove, rm/mv on repository paths.
- Do not edit files outside git workflows unless required for conflict resolution.
- Preserve any pre-existing user uncommitted changes in the base workspace.

Steps:
1. In the current task workspace, stage and create a commit for the pending task changes.
2. Find where {{base_ref}} is checked out:
   - Run: git worktree list --porcelain
   - If branch {{base_ref}} is checked out in path P, use that P.
   - If not checked out anywhere, use current task workspace as P by checking out {{base_ref}} there.
3. In P, verify current branch is {{base_ref}}.
4. If P has uncommitted changes, stash them: git -C P stash push -u -m "kanban-pre-cherry-pick"
5. Cherry-pick the task commit into P. If this fails because .git/index.lock exists, wait briefly for any active git process to finish. If the lock remains and no git process is active, treat the lock as stale, remove it, and retry.
6. If cherry-pick conflicts, resolve carefully, preserving both the intended task changes and existing user edits.
7. If step 4 created a new stash entry, restore that stash with: git -C P stash pop <stash-ref>
8. If stash pop conflicts, resolve them while preserving pre-existing user edits.
9. Before reporting success, run git -C P status --short and verify there are no unmerged paths or unresolved conflict markers.
10. If a conflict cannot be resolved with high confidence, stop. Keep the repository recoverable, list every conflicted file, state whether a cherry-pick or stash operation remains active, and tell the user that manual merge attention is required. Never report a successful integration while conflicts remain.
11. Report:
   - Final commit hash
   - Final commit message
   - Whether stash was used
   - Whether conflicts were resolved
   - Any remaining manual follow-up needed`;
export const LEGACY_HOST_WORKTREE_OPEN_PR_PROMPT_TEMPLATE = `You are in a task workspace on a detached HEAD. When you are finished with the task, open a pull request against {{base_ref}}.

- Do not run destructive commands: git reset --hard, git clean -fdx, git worktree remove, rm/mv on repository paths.
- Do not modify the base workspace.
- Keep all PR preparation in the current task workspace.

Steps:
1. Ensure all intended changes are committed in the current task workspace.
2. If currently on detached HEAD, create a branch at the current commit in this task workspace.
3. Push the branch to origin and set upstream.
4. Create a pull request with base {{base_ref}} and head as the pushed branch (use gh CLI if available).
5. If a pull request already exists for the same head and base, return that existing PR URL instead of creating a duplicate.
6. If PR creation is blocked, explain exactly why and provide the exact commands to complete it manually.
7. Report:
   - PR title: PR URL
   - Base branch
   - Head branch
   - Any follow-up needed`;
export const DEFAULT_COMMIT_PROMPT_TEMPLATE = `You are in an isolated task workspace. Prepare the task changes for !Klein to capture into a result branch based on {{base_ref}}.

- Work only inside the current task workspace.
- Do not modify or run git commands in any path outside this task workspace.
- Do not run destructive commands: git reset --hard, git clean -fdx, git worktree remove, rm/mv on repository paths.

Steps:
1. Inspect the pending task changes and make sure they match the task request.
2. Stage all intended task changes and create one commit in the current task workspace with a clear message.
3. If Git identity is missing, set only this repository's local identity, then retry the commit.
4. Run git status --short and verify the task workspace is clean.
5. If conflicts or uncertainty remain, stop and explain the exact files and commands needed for manual follow-up.
6. Report:
   - Final commit hash
   - Final commit message
   - Whether any manual follow-up is needed`;
export const DEFAULT_OPEN_PR_PROMPT_TEMPLATE = `You are in an isolated task workspace. Prepare and open a pull request for the task changes against {{base_ref}}.

- Work only inside the current task workspace.
- Do not modify or run git commands in any path outside this task workspace.
- Do not run destructive commands: git reset --hard, git clean -fdx, git worktree remove, rm/mv on repository paths.

Steps:
1. Inspect the pending task changes and make sure they match the task request.
2. Stage all intended task changes and create one commit in the current task workspace with a clear message.
3. If currently on detached HEAD, create a branch at the current commit in this task workspace.
4. Push the branch to origin and set upstream.
5. Create a pull request with base {{base_ref}} and head as the pushed branch (use gh CLI if available).
6. If a pull request already exists for the same head and base, return that existing PR URL instead of creating a duplicate.
7. If PR creation is blocked, explain exactly why and provide the exact commands to complete it manually.
8. Report:
   - PR title: PR URL
   - Base branch
   - Head branch
   - Any follow-up needed`;
