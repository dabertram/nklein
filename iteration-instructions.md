# !Klein — Iteration Instructions (perpetual-improvement playbook)

> **Purpose.** This is the standing instruction set for an agent told: *"Check `iteration-instructions.md`
> and work on the project until nothing is left to do."* Follow it literally. It tells you how to analyze,
> what to work on, how to keep the docs in sync, how often to commit/push, and when to stop and ask the user.
>
> **Read first, every iteration:** `specsheet.md` (what !Klein is), `plan.md` → "Consolidated status" (what's
> done / open), and `follow-up-5.md` (latest findings). Those three are the live source of truth. The older
> `follow-up-1..4.md` + `findings-from-follow-up-work-4.md` are **archival** — consult only for historical
> rationale, don't re-mine them for tasks.

---

## 0. Prime directives (never violate)

1. **LOCAL MODELS ONLY.** `CLOUD_ENABLED = false`. Never add a path, default, setting, or UI that can reach a
   paid/cloud LLM. Re-enabling cloud is a deliberate single-file code change, never a feature you add casually.
2. **STRICT DOCKER ISOLATION IS MANDATORY.** Every agent shell/filesystem action runs in a Docker container.
   Never add a host fallback, a "disable isolation" toggle, or a code branch that runs an agent tool on the
   host. Board/plan/!Klein-state mutation is *trusted control-plane* and may run host-side; the user's-repo
   file/shell/edit/patch/search is *data-plane* and must be sandboxed. Keep that line bright.
3. **≥32k context minimum**; no oversized prompt is ever sent; no hardcoded window/speed constants in
   routing/budget decisions.
4. **UPSTREAM-CLEAN.** Never patch `node_modules/@nkleinbot/*`. Every feature is a `src/nklein-sdk/` plug-in on
   an official SDK socket. `npm run check:nklein-boundary` must stay green.
5. **PROTECTED TESTS ARE HUMAN-GATED.** You may not weaken or change anything in `test/protected/**`,
   `vitest.protected.config.ts`, or `test/protected/protected-tests.json` without **explicit user approval**.
   If a change you want requires touching them, STOP and ask the user with a structured proposal
   (`intent` / `diff` / `reason` / `expectedEffects`). Default is deny.
6. **Follow `AGENTS.md` / `CLAUDE.md`** repo rules: no `any`, no inline/dynamic imports, prefer SDK types,
   `react-use` hooks in web-ui, Tailwind over inline styles, small single-responsibility files, keep
   `CHANGELOG.md` `## [Upcoming]` current in the same change as the code.

---

## 1. The iteration loop

Repeat until the stop condition (§4) is met:

1. **Sync context.** Read `specsheet.md`, `plan.md` (Consolidated status + relevant phase), `follow-up-5.md`.
   Run a quick `git log --oneline -10` and `git status` to see recent work and the working tree.
2. **Pick the highest-value open item.** Priority order:
   1. Anything that unblocks the user's headline goal (today: `plan.md` §2.A — autonomous decomposition→cards
      under isolation).
   2. Safety/correctness (isolation invariants, guardrails, protected-test coverage gaps).
   3. Open items already enumerated in `plan.md` Consolidated status / `follow-up-5.md` (§2.B, §2.C, §3.x).
   4. `specsheet.md` §14 future features that are ready (no unresolved user clarification).
   If multiple are comparable, prefer the smallest safe step that ships value.
3. **Deep analysis before coding.** For the chosen item: read the actual implementation, not just the doc.
   Re-grep quoted symbols (line numbers drift). Confirm the gap is real and decide the cleanest approach
   consistent with the invariants and existing architecture. If the right approach is genuinely ambiguous in
   a way the codebase/spec can't resolve, ask the user (don't guess on architecture-shaping decisions).
4. **Implement** to production quality. Add/adjust **well-selected** tests (see §3). Keep changes coherent and
   within the SDK boundary.
5. **Verify** (see §2). Everything must be green before you consider the item done.
6. **Update the docs in the same change:**
   - `CHANGELOG.md` `## [Upcoming]` — a user-facing bullet for the change.
   - `plan.md` — flip the item's checkbox, update the Consolidated status + the relevant phase, and refresh
     the "last reconciled" timestamp when you do a status pass.
   - `specsheet.md` — update the feature entry (and add a high-level timestamp on the section you touched).
     If you're adding a genuinely new capability, write its spec entry in `specsheet.md` §14 **first**.
7. **Commit cadence:** see §5 — collect ~10–15 changes, then commit and push.
8. Go to step 1.

---

## 2. Verification gates (run before marking any item done)

- `npm run typecheck` — 0 errors.
- `npm run web:typecheck` — 0 errors.
- `npm run lint` — clean.
- `npm run check:nklein-boundary` — passes.
- `npm run test:fast` (and the relevant `npx vitest run test/runtime/...` suites for what you touched) — green.
- `npm run test:protected` — green (and you did not modify it without approval).
- For web-ui changes: `npm --prefix web-ui run test` for the affected components.
- For isolation/Docker changes: run the Docker-gated integration tests if a daemon is available; they must
  skip cleanly when not.
- If you changed user-relevant UI/flows that can't be unit-verified, either run the dev build and observe, or
  explicitly record the manual-verification debt in `follow-up-5.md` §2.C (don't silently mark it done).

Never mark a checkbox `[x]` until its gate passes. Report failures honestly with the output.

---

## 3. Test selection philosophy (well-selected, not exhaustive)

- Add tests that lock **product behavior and invariants**, not implementation trivia. Favor a focused
  regression for each bug fixed and each invariant a small model could plausibly weaken.
- The **protected suite** is the floor that lets small/weak LLMs work on !Klein safely. It must cover the
  load-bearing invariants: local-only policy, context-window/overflow policy, timeout scaling, swarm
  guardrails, workspace identity, decomposition apply — **and** (open item) the strict-isolation
  no-host-execution guard + fail-closed start guard. Propose additions to the protected manifest **only via
  the human-approval path** (§0.5).
- Keep suites fast and non-hanging. If CI hangs on Node 22, suspect a live subprocess / real SDK-host boot
  before a slow test body (see `.plan/docs/node22-ci-hanging-tests-investigation.md`).

---

## 4. Stop condition — when "nothing is left to do"

When you genuinely cannot find a reasonable improvement (every `plan.md` open item is done or blocked on the
user; `specsheet.md` §14 has no buildable item without unresolved clarification; no correctness/safety/UX gap
survives deep analysis):

1. Do a final verification pass (§2) and make sure docs are in sync.
2. **Do NOT invent low-value churn** to look busy. Stop.
3. Report to the user: a short summary of what was accomplished this run, the verification status, and the
   list of items now blocked on them (e.g. the LATER portable-project-state spec needs their clarification;
   the manual isolation/dev-build verification needs a Docker-enabled interactive session).
4. **Ask the user for new feature ideas** to extend `specsheet.md`. Offer 2–4 concrete proposals of your own
   (derived from deep analysis of the codebase — reasonable, high-value, invariant-respecting) so they have a
   starting point, but make clear you'll add whatever they want to the spec and work it through.

If new ideas arrive: write them into `specsheet.md` §14 first, decompose into `plan.md`, then resume the loop.

---

## 5. Commit & push cadence (keep the server repo current without micro-commits)

- **Do not commit after every single feature.** Collect roughly **10–15** completed feature/fix/improvement
  implementations (or a coherent themed batch) before committing. The goal: keep the remote up to date so work
  isn't lost, **without** fine-grained noise.
- Commit/push **sooner** than 15 if: a batch reaches a natural milestone, you're about to start something
  risky, the working tree is getting large/hard to review, or a long idle/handoff is imminent. Never let a
  large amount of unsaved good work accumulate.
- **Branch discipline:** work on the feature branch (currently `feat/kanban-reliability-context-upgrade`);
  never commit directly to `main`. If somehow on `main`, branch first.
- **Each commit:** ensure all §2 gates are green first; write a clear message summarizing the batch; end the
  message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
  Keep `CHANGELOG.md` `## [Upcoming]` updated **within** the batch (don't leave it for a separate commit).
- **Push** after committing so the server repository stays current. If a push fails (diverged remote), rebase
  carefully and re-run gates before re-pushing.
- Only open a PR / cut a release when the user asks (use the `release` skill for releases).

---

## 6. Working principles (quality bar)

- Production code, not prototypes. DRY, clean separation, small files; extract domain logic over building
  pass-through shells.
- Match surrounding code style, comment density, and idioms. Reference code as `path:line`.
- Progressive disclosure in UI: a plain summary for non-technical users, full technical detail one expand
  away. Every capability you ship must be visible in the UI (the coverage-matrix rule) — if it runs, the user
  can see that it ran, what it decided, and why.
- Surface outcomes faithfully: if tests fail, say so with output; if a step is skipped or blocked, say that.
- Before deleting/overwriting something you didn't create, look at it; if it contradicts how it was described,
  surface that instead of proceeding.
- Prefer well-maintained third-party packages over bespoke utility code when they reduce long-term cost.

---

## 7. Quick reference — where things live

- Local-only policy: `src/nklein-sdk/nklein-local-only-policy.ts`
- Strict isolation: `src/nklein-sdk/nklein-agent-sandbox.ts`, `src/nklein-sdk/agent-sandbox/`,
  `docker/agent-sandbox/`, `src/nklein-sdk/nklein-agent-sandbox-extra-tools.ts`
- Task session orchestration (sandbox lifecycle, pause, budgets, decomposition gating, result-branch capture):
  `src/nklein-sdk/nklein-task-session-service.ts`
- Decomposition: `src/nklein-sdk/nklein-decomposition-tool.ts`, `nklein-decomposition-workflow.ts`,
  `nklein-plan-artifacts.ts`
- Result branches / worktrees: `src/workspace/task-result-branches.ts`, `src/workspace/task-worktree*.ts`
- MCSR: `src/nklein-sdk/nklein-model-registry.ts` · Router/guard: `nklein-task-router.ts`,
  `nklein-task-start-guard.ts`
- Guardrails: `src/core/swarm-guardrails.ts`, `src/core/card-pause.ts`, `nklein-pause-controller.ts`
- Protected tests: `test/protected/` · Write guard: `src/core/agent-write-guard.ts`
- Runtime config / settings: `src/config/runtime-config.ts`, `src/core/api-contract.ts`,
  `web-ui/src/components/runtime-settings-dialog.tsx`
- Live docs: `specsheet.md`, `plan.md`, `follow-up-5.md`, this file.
