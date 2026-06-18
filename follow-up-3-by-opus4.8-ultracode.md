# Follow-up 3 — !Klein rename completion, implementation audit & improvement roadmap

> Authored by Opus 4.8 (ultracode pass) on 2026-06-18, branch `feat/kanban-reliability-context-upgrade`.
> This is the authoritative checklist for finishing the **!Klein / nklein** fork rename, verifying the
> earlier plans were really implemented, and a prioritized roadmap of improvements — with special focus on
> making **small / slow / small-context local LLMs** productive on a large codebase.
>
> Status legend: `- [ ]` open work · `- [x]` done/verified in this pass · `- [~]` needs verification before acting.
>
> **Handoff (2026-06-18):** ready for another agent to implement. Three further decisions are now locked — packaged/OS app name **`nKlein`**, **hide all cloud UI** for now, and a **separate, documented protected-test suite** — see §0.2–§0.3 and the resolved list in §I. The only change already applied is the §A1 brand-wordmark fix.

## 0. How to use this doc

- Each top-level section (A–I) is independently actionable. Treat each `### ` heading as a candidate task card.
- File references are `path:line` against the current branch. Line numbers drift — re-grep the quoted string if a number looks off.
- "Quick win" = small, low-risk, user-visible, no migration. Do these first.
- Decisions already locked with the user are in §0.2; do not re-litigate them.

### 0.1 Verdict

The fork is in good shape. The hard engineering (local-only lockdown, never-overflow context guard, timeout scaling, swarm concurrency, decomposition + planning DAG, lost-session recovery, workspace-identity hardening) is **substantially implemented and tested** — see §B. The two biggest *unfinished* threads are:

1. **The rename is only ~60% done.** User-visible text is mostly converted, but the **app-brand wordmark was still "Cline"** (now fixed in this pass) and **all technical identifiers** (env vars, storage keys, on-disk dir, HTTP header, cookie, Electron appId/protocol) are still `kanban`.
2. **The self-improvement / evidence loop is developer-only and unintuitive.** There is real machinery (`evidence-bundle.ts`, dev-test scaffolding) but no one-click path to collect evidence and hand it to an agent — internal or external.

Everything else here is incremental quality, hardening, and small-model leverage.

### 0.2 Locked decisions (from clarifying questions)

- **Rename depth:** full rename of all technical identifiers **+ backward-compatible migration** (no loss of existing local state).
- **Naming tokens (three forms):** in-app display `!Klein`; OS/packaging display where `!` is unsafe **`nKlein`**; technical identifiers `nklein`. Full table in §0.3. The git marker `kanban.repositoryCreatedByKanban` and the repo name `kanban` are the documented keeps.
- **Cloud UI:** **hide all cloud options for now** — cloud is hard-disabled, so the affordances are dead weight. Hide (don't delete) behind the policy flag. See §G5.
- **Protected tests:** enforced via **agent-write-guard block + structured approval** (intent / change / reason / effects) at edit time, and the protected suite is kept **well-selected, in a location separate from the main test suite, with co-located documentation** so its purpose stays clear and maintainable. See §D.
- **Guidance docs:** integrated as **on-demand skills/workflows** that load only when a task matches the topic.

### 0.3 Naming convention (canonical)

Three deliberate tokens (plus the keeps). If any of these isn't what you intended, flag it before the rename starts.

| Context | Token | Examples |
|---|---|---|
| In-app UI display brand | `!Klein` | sidebar wordmark, dialog copy, onboarding, toasts, browser-tab title |
| OS / packaging display where `!` is unsafe | `nKlein` | Electron `productName`, installer/bundle name, OS window title, protocol display name |
| Technical identifiers (lowercase) | `nklein` | CLI binary, npm package, `NKLEIN_*` env, `nklein://` scheme, `~/.cline/nklein`, `x-nklein-workspace-id`, `nklein_session`, `com.cline.nklein` |
| Keep unchanged | `kanban` / `Cline` | repo name, git marker `kanban.repositoryCreatedByKanban`, Cline engine/provider/account references |

### 0.4 The brand-vs-engine rule (read before any rename edit)

"Cline" is overloaded. Two distinct meanings must be handled differently:

- **!Klein** = this app/product (the board, the runtime, the CLI). Rename these.
- **Cline** = the upstream agent engine / SDK (`@clinebot/core`, `@clinebot/llms`), the Cline provider, and the Cline cloud account. **Keep these as "Cline".**

When in doubt, ask: "Is this the thing the user launched, or the engine running inside it?" The app is !Klein; the engine is Cline.

---

## A. Finish the rename to !Klein / nklein

### A1. User-visible app-brand strings (quick wins)
- [x] **Top-left brand wordmark** — `web-ui/src/components/project-navigation-panel.tsx:345` now renders `!Klein v{__APP_VERSION__}` (was `Cline`). *(Done in this pass — the user-reported issue.)*
- [x] App crash screen — `web-ui/src/components/app-error-boundary.tsx:18` now "!Klein hit an unexpected UI error." *(Done.)*
- [x] Runtime-disconnected screen — `web-ui/src/hooks/runtime-disconnected-fallback.tsx:18-19` now "Disconnected from !Klein" and "Run `nklein` again in your terminal…". *(Done.)*
- [x] `web-ui/index.html` `<title>` → `!Klein`.
- [x] `web-ui/public/manifest.json` `name` / `short_name` (currently `Cline`) → `!Klein`.
- [x] `packages/desktop/src/disconnected.html` page title + "Run kanban…" body → `!Klein` / `nklein`.
- [x] `src/cli.ts` console prefixes `[kanban]` → `[nklein]` (≈ lines 481, 542).
- [x] **Brand-vs-engine disambiguation sweep:** grep `web-ui/src` for every rendered `Cline` string and classify each (app-brand → `!Klein`; engine/provider/account → keep). Known keeps: `aria-label="Cline mode"`; "Cline context window override". The wordmark was missed once already — do this sweep deliberately. Note: the cloud sign-in surface ("Sign in to Cline", `cline-setup-section.tsx:560`) is being **removed entirely** (§G5), so it goes away regardless of this sweep.

### A2. Electron app metadata
- [x] `packages/desktop/electron-builder.yml`: `appId: com.cline.kanban` → `com.cline.nklein`.
- [x] `productName: Kanban` → **`nKlein`** (decided: the packaged/OS app name drops the `!`; `!Klein` stays for in-app UI only). This also governs the OS window title and installer/bundle name.
- [x] `protocols.name` → `nKlein`; `protocols.schemes: kanban` → `nklein`.
- [x] `packages/desktop/src/protocol-handler.ts` `KANBAN_PROTOCOL = "kanban"` → `"nklein"`.
- [x] `packages/desktop/package.json` `name: @kanban/desktop` → `@nklein/desktop`; update its description (still says "Kanban").

### A3. Environment variables → `NKLEIN_*` (with one-release fallback)
- [x] `src/core/runtime-endpoint.ts`: `KANBAN_RUNTIME_HOST/PORT/HTTPS/TLS_CA` → `NKLEIN_*`.
- [x] `src/security/passcode-manager.ts`: `KANBAN_INTERNAL_AUTH_TOKEN` → `NKLEIN_INTERNAL_AUTH_TOKEN`.
- [x] `src/update/update.ts`: `KANBAN_NO_AUTO_UPDATE` → `NKLEIN_NO_AUTO_UPDATE` (≈ line 505).
- [x] `packages/desktop/src/main.ts`: `KANBAN_DESKTOP_USER_DATA` → `NKLEIN_DESKTOP_USER_DATA` (≈ line 30).
- [x] For each: read the old `KANBAN_*` name as a deprecated fallback for one release; log a one-time deprecation warning.

### A4. HTTP header + session cookie (dual-read during transition)
- [x] Header `x-kanban-workspace-id` → `x-nklein-workspace-id`: writers `src/cli.ts:296`, `web-ui/src/runtime/trpc-client.ts:23`; reader `src/server/runtime-server.ts:86`.
- [x] Cookie `kanban_session` → `nklein_session`: `src/security/passcode-manager.ts:134-135` (read) and `src/server/runtime-server.ts:442` (Set-Cookie).
- [x] Server should **accept both** header names and **both** cookie names for one release so an open tab isn't logged out mid-rename.

### A5. On-disk directories + path constants
- [x] `src/workspace/task-worktree-path.ts`: `KANBAN_RUNTIME_HOME_DIR_NAME = ".cline/kanban"` → `".cline/nklein"` (leave the generic `worktrees` names alone).
- [x] `src/config/runtime-config.ts`: `RUNTIME_HOME_DIR` and `PROJECT_CONFIG_DIR` (`"kanban"`) → `"nklein"` (≈ lines 104, 107).
- [x] Temp prefixes: `src/workspace/turn-checkpoints.ts` `"kanban-checkpoint-"` → `"nklein-checkpoint-"`; `src/cline-sdk/cline-dev-test-project.ts` `kanban-${slug}` → `nklein-${slug}` (≈ line 152).
- [x] Hardcoded `.cline/kanban/*` paths: `src/trpc/runtime-api.ts`, `src/workspace/project-health.ts`, `src/cline-sdk/cline-code-index.ts`, `src/cline-sdk/cline-plan-artifacts.ts`, `web-ui/src/components/debug-dialog.tsx` (~lines 65/94), and test fixtures. Centralize through the constants above so this is one change, not dozens.

### A6. Migration utility (new) — the "+ migration" half of the decision
- [x] New `src/config/legacy-name-migration.ts`, invoked once at runtime startup:
  - [x] If `~/.cline/kanban` exists and `~/.cline/nklein` does not, migrate (move or copy) `plans/`, `config.json`, `code-index-v1.json`, `telemetry/`, `dev-runs/`.
  - [x] Write a `migrated-from-kanban` marker so it never runs twice; log a structured outcome (counts, any path it couldn't move).
  - [x] Treat failure as non-fatal but surfaced (ties into §G observability) — never silently lose data.
- [x] `web-ui/src/storage/local-storage-store.ts`: migrate the **21** `kanban.*` keys → `nklein.*` with read-old-then-write-new fallback. Keep the enum the single source of truth so the prefix changes in one place.
- [x] Tests: seed a fake `~/.cline/kanban` and fake localStorage, assert post-migration state, assert idempotency on a second run.

### A7. Intentional keeps (document; do **not** change)
- [x] Repo name `kanban` — documented in `README.md:7`.
- [x] Git marker `kanban.repositoryCreatedByKanban` — documented in `AGENTS.md`; `src/workspace/initialize-repo.ts:8`, `src/cline-sdk/cline-dev-test-project.ts:131`. Renaming it would orphan ownership of existing repos.
- [x] Internal embedding model id `kanban-local-lexical-vector-v1` — kept intentionally so lexical fallback caches are not invalidated; real embedding endpoints use provider/model-specific cache keys.
- [x] Internal component filenames `kanban-*.tsx/.ts` — no user impact; not worth the churn.
- [x] Confirm the man page: `man/kanban.1` was deleted; ensure `man/nklein.1` exists and is the one referenced by `package.json` `man`.

### A8. Sweep + regression guard
- [x] After the above, run a residual grep (`Kanban`, `KANBAN`, `kanban` minus documented keeps) and reconcile.
- [x] Add a tiny test (or CI grep) that fails if a **new** user-facing `Kanban`/`Cline` (app-brand) string appears in `web-ui/src` or CLI output — so the rename can't silently regress. Allowlist the engine references.

---

## B. Did plan.md / follow-up.md / follow-up-2 actually get implemented?

Short answer: **yes, ~95%.** Evidence gathered this pass below; full per-item mapping is reproduced from the cross-check.

### B1. plan.md L0–L4 (local swarm)
- [x] **L0 local-only lockdown** — `src/cline-sdk/cline-local-only-policy.ts` (`CLOUD_ENABLED = false`), gated at `cline-provider-service.ts` and re-asserted at `src/trpc/runtime-api.ts`; tests in `test/runtime/cline-sdk/cline-local-only-policy.test.ts`.
- [x] **L1 reliability** — never-overflow pre-send guard + real effective window (no 200k clamp) in `cline-task-session-service.ts`; local timeout floors + cold-start priors in `cline-timeout-scaling.ts`; acceptance gate uses non-login `/bin/sh` in `cline-acceptance-gate.ts`; context-budget bar on cards.
- [x] **L2 swarm** — concurrency enforced across all start paths; per-endpoint serialization with retry/queue; per-model tool routing; swarm guardrails (`swarm-stop.json`, turn/wall-time/no-diff/mistake budgets).
- [x] **L3 decomposition** — Planning-lane cards, recursive expand, clarifying-question intake (`questions.md`), plain-language `summary.md`, adaptive re-planning (`plan-gap`, `revisions.md`).
- [x] **L4 operator UI** — board cockpit metrics, swarm header, MCSR panel, Planning DAG review + **approval action** + **revised-card flags**, diagnostics drawer, first-run local-model onboarding.

### B2. Confirmed-open / verify
- [x] **Persistence-ownership split (follow-up-2 F3).** Verified: browser saves send board-only payloads, public `workspaceApi.saveState` forwards only `board`/`expectedRevision`, and `saveWorkspaceState` preserves existing runtime-owned sessions unless an internal caller explicitly supplies `sessions`. Covered by `workspace-state.integration.test.ts` and `workspace-api.test.ts`.
- [x] **Real semantic embeddings (plan.md M2/M3).** OpenAI-compatible embedding endpoints can now back the code index, and `search_code` merges lexical line matches, semantic/index chunks, and repo-map symbols with deduplication. The lexical model id remains only the fallback/cache key.
- [x] **Dev-test web UI (follow-up-2 F6).** Verified: `web-ui/src/components/project-navigation-panel.tsx` already exposes gated dev-test creation/cleanup and evidence-path actions in debug mode, with coverage in `project-navigation-panel.test.tsx`.
- [x] **Doc hygiene:** fixed `follow-up-2-by-gpt5.5-medium.md` so the "Suggested implementation order" checkboxes (items 4 & 7) match the completed sections.
- [x] Confirm `CHANGELOG.md [Upcoming]` reflects this pass (rename + any items implemented).

---

## C. Dev-test → evidence → coding-agent workflow (make it one-click)

Today: evidence machinery exists (`src/telemetry/evidence-bundle.ts` → `~/.cline/kanban/dev-runs/<scenario>-<ts>/` with `summary.md`, transcripts, `telemetry.jsonl`, `config-snapshot.json`, optional `diff.patch`), and dev-test scaffolding exists (`src/cline-sdk/cline-dev-test-project.ts`, `src/trpc/projects-api.ts` `createDevTestProject`/`cleanupDevTestProjects`). But getting evidence *out* means navigating the filesystem, and there's no "now go fix it" button. This is the "rather unintuitive" pain the user called out.

### C1. One-click evidence hand-off (for an *external* coding agent)
- [x] Add a **"Copy evidence for agent"** action on each task card / detail panel (and on dev-test runs).
- [x] Reuse `createEvidenceBundle()`; extend the bundle to also capture: worktree path, base ref + **commit SHA**, resolved provider/model/role settings, the card prompt, and the latest agent transcript + diff.
- [x] On click, write/refresh the bundle and **copy to clipboard** both: (a) the absolute bundle folder path, and (b) a ready-to-paste prompt block ("Here is evidence from a !Klein task… files at `<path>`… please …").
- [x] tRPC: a `collectEvidence` action returning `{ bundlePath, promptBlock }`. Toast "Evidence copied" via `showAppToast`.

### C2. One-click "Create !Klein self-improvement project" (internal loop)
!Klein creates its own workspace, loads the evidence, analyzes → plans → works on a branch.
- [ ] Entry point: a gated button (Developer Tools / "Lab") near the evidence action and on dev-test runs.
- [ ] **Source selector:**
  - [ ] **v1 (now):** "Currently running code" — the dev checkout. Detect dev mode via `process.env.NODE_ENV === "development"` (`src/server/middleware.ts:21`) and the asset-dir resolution in `src/server/assets.ts`.
  - [ ] **Later:** branch / tag / commit from the GitHub repo. Extend `src/workspace/git-clone.ts` to accept a ref, and add `ref?` to `ProjectAddRequest` in `src/core/api-contract.ts`.
  - [ ] **Version pinning (non-dev sources):** check out exactly the **commit SHA recorded in the evidence bundle** so the agent fixes the version the evidence came from, not `HEAD`.
- [ ] **User notes/guidance:** a free-text field merged into the seeded task prompt (`RuntimeCreateTaskInput.prompt` + `generatedFromPlan`); attach the evidence files as task context (`filesLikelyTouched` + an evidence note).
- [ ] Gate behind the existing self-project confirmation (`addProject({ confirmSelfProject: true })`, `src/trpc/projects-api.ts:298`).
- [ ] Couple with §D so the spawned agent is automatically under the protected-test guardrail.

### C3. Embedding model example next to the selector (quick win)
The embedding settings live in `web-ui/src/components/runtime-settings-dialog.tsx` (global ≈ L2699–2724, project override ≈ L2766–2798). Placeholders currently imply Ollama only.
- [x] Add inline helper text under the provider/model fields with **two concrete, copy-pasteable examples** (LM Studio is the target runtime):
  - **LM Studio** — endpoint `http://localhost:1234/v1/embeddings`, model `text-embedding-nomic-embed-text-v1.5` (download the GGUF `nomic-embed-text-v1.5` in LM Studio, start the local server).
  - **Ollama** — endpoint `http://127.0.0.1:11434/v1/embeddings`, model `nomic-embed-text` (`ollama pull nomic-embed-text`).
- [x] Optional polish (→ §H): a **"Test endpoint"** button (call `/models` or a 1-token embed and show ✓/✗) and a model dropdown populated from the endpoint's `/models`, so there's zero guesswork.

### C4. Discoverability
- [ ] Ensure the dev-test + evidence + self-improvement actions are reachable from a **clearly-labeled, gated** UI surface (not CLI/tRPC-only). Verify against §B "dev-test web UI" finding.

---

## D. Protected-test guardrail (let a small model touch !Klein safely)

Goal: a small model can work on !Klein's own code without silently breaking features/UI, but you can still approve a test change after seeing **what / why / effects**. Enforced at edit time via the existing write guard. **Decision:** the protected suite must be **well-selected (curated, not "all tests"), physically separate from the main test suite, and documented right next to itself** so its purpose stays clear and maintainable when external/valid contributors work on the codebase.

- [x] **D1. Separate, curated protected suite.**
  - [x] Give the protected tests their **own location**, distinct from the main suite — `test/protected/protected-tests.json` is the canonical manifest and `vitest.protected.config.ts` runs it as a separate Vitest target.
  - [x] **Curate deliberately** — the v1 manifest protects local-only policy, context-window/overflow policy, timeout scaling, swarm guardrails, workspace identity/health, and decomposition apply behavior.
  - [x] Protected tests currently live in the main suite and are referenced from `test/protected/protected-tests.json`, keeping the canonical list obvious and in one place.
- [x] **D2. Co-located documentation (so it stays maintainable).**
  - [x] `test/protected/README.md` explains what protected means, why the suite exists, the explicit-approval rule, and how to propose a change.
  - [x] `test/protected/protected-tests.json` carries a one-line rationale per protected test group.
- [x] **D3. Block by default** — `src/core/agent-write-guard.ts` now identifies protected-suite paths, and editor/write/apply-patch approvals plus direct write-file tools reject edits to `test/protected/**` and `vitest.protected.config.ts` without explicit human approval.
- [ ] **D4. Structured approval** — on a blocked attempt the agent must emit `{ intent, diff, reason, expectedEffects }`. Surface it via the existing clarifying-question UI (`web-ui/src/components/detail-panels/cline-agent-chat-panel.tsx`). Only an explicit per-edit approval unlocks that specific change; default is deny.
- [ ] **D5. Audit + tests** — log every protected-test approval to telemetry (what/why); tests for both the blocked path and the approved-unblock path.
- [ ] **D6.** Make the protected suite apply *automatically* inside the §C2 self-improvement project so the guardrail is on by default when !Klein edits itself.

---

## E. Curated guidance docs as on-demand skills

You asked whether feeding in curated guidance (UI/UX, layout, performance, security, backend, frontend, architecture, software design, maintainability) would raise output quality. **Yes — but only if delivered as small, on-demand, codebase-specific skills**, not a giant always-on dump. Research backs both halves: well-crafted context files lifted task success from ~30% → ~90%, while *verbose, LLM-generated* guidance files *reduced* success by ~2% and raised cost ~23% (they duplicate what's already in the repo). For small-context local models the budget discipline matters even more.

### E1. Integration mechanism
- [x] Reuse the existing workflow-seeding path (the one that seeds `kanban-decompose.md` and is referenced as `/kanban-decompose`). Seed a set of `skills/<topic>/SKILL.md` docs into the project config.
- [ ] **On-demand loading:** the decomposition/router tags each card with a topic (`ui`, `security`, `perf`, `arch`, `ts`, `testing`, …); the matching skill loads only when that card runs. Keep an always-on digest ≤ a few hundred tokens; pull depth on demand.
- [x] Each seeded v1 skill is **terse, copy-pasteable, and !Klein-specific** — cites the real design tokens (`globals.css @theme`), the UI primitives (`src/components/ui/`), the SDK boundary (`src/cline-sdk/`), and the repo rules (no `any`, react-use hooks, Tailwind-over-inline). Generic advice the model already knows is omitted.

### E2. Source list to distill (do **not** paste wholesale)
- **UI/UX & layout:** *Refactoring UI* (Wathan/Schoger); Nielsen Norman Group's 10 usability heuristics; W3C **WAI-ARIA Authoring Practices (APG)**; **WCAG 2.2** quick-ref.
- **Frontend / React / Tailwind:** react.dev (rules of hooks, component patterns); **web.dev Core Web Vitals**; Tailwind + Radix docs (already the stack).
- **Architecture / software design:** Ousterhout, *A Philosophy of Software Design*; Fowler, *Refactoring*; **12-Factor App**; **C4 model** for architecture description.
- **Security:** **OWASP Top 10**, **OWASP ASVS**, **OWASP Cheat Sheet Series**; **Electron security checklist**; **Node.js security best practices**.
- **Maintainability / process:** **Google Engineering Practices** (code-review guide); **Conventional Commits**; **Keep a Changelog** (already used); **Testing Library guiding principles** / testing trophy.
- **TypeScript:** the **TS Handbook**; *Effective TypeScript* patterns (reinforces the repo's no-`any` rule).

### E3. Output of this workstream
- [x] A `skills/` directory (seeded) with one distilled doc per initial topic (`security`, `ui`, `ts`), each ≤ ~300–500 tokens, each ending with a "!Klein specifics" block.
- [ ] A mapping table: card-topic → skill file, plus the router hook that injects it.

---

## F. SOTA techniques for small / slow / small-context local LLMs (research-mapped)

What the field is doing in 2026 and where !Klein already stands. !Klein is **ahead of most** on harness design; the gap is semantic retrieval and a few context-engineering polish items.

### F1. Retrieval (biggest lever)
- [x] **AST + PageRank repo map** — `src/cline-sdk/cline-repo-map.ts` extracts TS symbols and ranks with PageRank. This is exactly Aider's approach and the right "middle ground between grep and LSP."
- [x] **Personalized PageRank boosts** — Aider boosts identifiers mentioned in the conversation (~10×) and chat/seed files (~50×). `cline-repo-map.ts` now applies a conversation-aware personalization vector and final symbol-score boost from current session text, explicit repo-map tool queries, and seed paths.
- [x] **Real local semantic embeddings** — `openai_compatible` embedding settings support LM Studio/Ollama-style local endpoints, the code index stores provider/model-separated dense vectors, and `search_code` now merges lexical + semantic/index + repo-map results with deduplication.

### F2. Context engineering (Anthropic's framing: "smallest high-signal set of tokens")
- [x] Compaction + structured note-taking (`decisions.md` blackboard) are present.
- [x] **Bounded tool outputs + actionable errors** — Cline tool transcript messages now cap oversized inputs/outputs/errors, strip stack-frame noise from tool errors, and append a concise next-step hint so small models do not burn context on raw failure dumps.
- [x] Prompt budgeting + `read_large_file` chunking + 1000-line write cap are present.

### F3. Decomposition + verification loops
- [x] Decomposition chains, clarifying questions, plan-gap adaptation present.
- [x] **Failing-test-as-constraint** — tightened the loop so acceptance repair extracts the failing assertion/compiler error and feeds it back as a first-class next-turn constraint before the bounded raw output.

### F4. Routing (hybrid is the 2026 default)
- [x] Model roles + router (`src/cline-sdk/cline-task-router.ts`) route simple→small, complex→larger-local. Keep; surface the decision in the UI so the operator understands why a model was picked.

### F5. Few-shot, codebase-specific examples
- [ ] For matched topics (§E), include 1–2 concrete !Klein code examples in the prompt (a real component using the tokens/primitives). Few-shot from *this* repo beats generic instruction for small models.

### F6. AGENTS.md discipline
- [x] !Klein's `AGENTS.md` already follows the high-signal, non-obvious, boundaries-explicit pattern that the 2,500-repo study found effective. Keep resisting verbose auto-generated bloat.

---

## G. Additional feature & hardening ideas

### G1. Security hardening
- [x] **Electron checklist pass** (`packages/desktop`): confirmed and locked `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, packaged devtools-off behavior, deny-by-default `setWindowOpenHandler`, same-origin navigation blocking, and a CSP-protected disconnected fallback page. Also fixed the remaining OS window-title/menu fallback to `nKlein`.
- [x] **Bind the local runtime to `127.0.0.1` only** by default; audited `src/security/passcode-manager.ts` token handling and locked Set-Cookie flags (`HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age`, and `Secure` under TLS) behind `buildSessionCookieHeader()` regression coverage.
- [x] **Secret scanning in the agent-write path** for the self-improvement flow — write approvals and direct write-file tools now block obvious private keys, provider tokens, GitHub tokens, AWS access keys, and long credential assignments before writing to disk.
- [ ] Optional: egress restriction for agent worktrees (the local-only policy already blocks cloud providers; this extends it to arbitrary network calls during a task).

### G2. Reliability
- [x] Finish/verify the persistence-ownership split (§B2).
- [x] Lost-session recovery + observable auto-review are present; keep them surfaced.

### G3. Features (user-workflow leverage)
- [ ] Prompt-template / quick-start library (the create-task flow has none today).
- [ ] "Import context into a task" from a file, a GitHub issue (`gh issue view`), or a PR diff.
- [x] **Endpoint reachability + model discovery** dropdowns for *both* embeddings and providers (call `/models`), removing the "what do I type here" problem.
- [x] "Open data dir" shortcut (jumps to `~/.cline/nklein`).
- [ ] Consolidated evidence/diff viewer panel (ties to §C1).

### G4. Observability
- [ ] A project-health dashboard surfacing the diagnostics already logged (accidental worktree projects, missing parents, lost sessions w/ pending artifacts, stale artifacts) — the data exists; give it a home.

### G5. Hide all cloud options (cloud is disabled) — user-prioritized
Cloud is hard-disabled (`CLOUD_ENABLED = false`, `src/cline-sdk/cline-local-only-policy.ts`), so cloud UI is dead weight and confusing. **Decision: hide all cloud options for now** — *hide, don't delete*; keep them behind the policy flag so a future re-enable is a one-switch change.
- [x] Hide cloud **sign-in / account** surfaces: `web-ui/src/components/shared/cline-setup-section.tsx` ("Sign in to Cline" ≈ L560) and any Cline-account menu/avatar/status.
- [x] Hide cloud **providers** and cloud **model recommendations** from every picker (provider catalog, model picker, role pickers). Verify the L0 filtering already covers *all* of these surfaces, not just the main model picker.
- [x] Hide cloud-only **settings** (managed OAuth, cloud endpoints) in `web-ui/src/components/runtime-settings-dialog.tsx`.
- [x] Drive visibility off the single local-only policy flag — nothing hard-coded — and add a test asserting **no cloud affordance renders** while cloud is disabled.
- [x] Keep the existing hard-stop messaging for any pre-existing cloud-pinned cards, so hidden ≠ silently broken.

---

## H. Optional UI proposals (non-destructive, only if exceptionally convincing)

Constraints honored: the kanban board stays the core idea; **no surfaced feature is dropped**; current responsiveness/perf are acceptable so these are opt-in, not urgent.

- [ ] A clearly-labeled, gated **"Lab" / Developer Tools** surface housing dev-test, evidence, and self-improvement actions (replaces the current CLI/tRPC-only access).
- [ ] An **evidence drawer** on a card: transcript + diff + telemetry + the one-click copy/seed actions in one place.
- [x] Embedding **"Test endpoint"** button + model dropdown (from §C3).
- [ ] A **command palette** (⌘K) + keyboard-first navigation — additive, discoverable, doesn't change the board.
- [ ] Richer empty/onboarding states that point at the local-model setup (already partially present via the first-run onboarding).

Each is additive. If none are "exceptionally convincing," shipping only the Lab surface (which the workflow asks for anyway) is the safe minimum.

---

## I. Open questions / confirmations

### Resolved (this pass)
- ✅ **Packaged/OS app name** (was: `!Klein` vs `Klein`) → **`nKlein`**. In-app UI stays `!Klein`; technical identifiers stay `nklein`. (§0.3, §A2)
- ✅ **Cloud UI** → **hide all cloud options for now**, driven off the local-only policy flag. (§G5)
- ✅ **Protected tests** → keep the list **well-selected/curated, in a location separate from the main test suite, with documentation co-located** explaining each protected test's purpose so it stays maintainable when external/valid work touches the codebase. (§D)

### Still open (non-blocking)
- [ ] **App icon/logo** — keep `ClineIcon` next to the `!Klein` wordmark, or design a Klein mark? (Pure design call.) (§A1)
- [x] **Embedding model id bump** — keep `kanban-local-lexical-vector-v1` until a deliberate lexical-cache invalidation is needed; OpenAI-compatible embeddings already separate cache entries by provider/model key. (§A7 / §F1)
- [x] **Guidance-skill priority** — start with `security`, `ui`, `ts`. (§E)
- [ ] **Self-improvement v1 scope** — confirm v1 = "currently running code (dev mode)" only, branch/tag/commit later. (§C2)

---

## Sources / references

Agentic-coding & context-engineering research consulted for this pass:

- Aider repo map (tree-sitter + personalized PageRank): https://aider.chat/docs/repomap.html and the community write-up at https://github.com/NousResearch/hermes-agent/issues/535
- Why coding agents still lean on grep / repo-map vs RAG: https://yage.ai/share/why-coding-agents-still-use-grep-en-20260327.html and https://www.mindstudio.ai/blog/is-rag-dead-what-ai-coding-agents-use-instead
- Terminal coding-agent scaffolding, harness & context engineering (arXiv): https://arxiv.org/pdf/2603.05344
- Context engineering for coding agents (2026): https://www.fundesk.io/context-engineering-techniques-ai-coding-agents-2026 and spec-driven framing https://www.webuild-ai.com/insights/aligning-spec-driven-development-and-context-engineering-for-2026
- AGENTS.md best practices & the 2,500-repo study: https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/ and https://www.morphllm.com/agents-md-guide and the open format at https://agents.md/
- State of local-LLM coding agents (Feb 2026): https://medium.com/@rontom/the-state-of-coding-agents-using-local-llms-february-2026-83259140e6ec
- LM Studio embeddings (model id `text-embedding-nomic-embed-text-v1.5`, `/v1/embeddings`): https://lmstudio.ai/docs/python/embedding and https://lmstudio.ai/docs/api/rest-api
