# Handoff — continue on another machine

Branch: `feat/kanban-reliability-context-upgrade`. Pull it, then work from **`todo.md`** — it is the single source of
truth for what's left. `done.md` is the shipped archive, `AGENTS.md` is tribal knowledge, `CHANGELOG.md` is release
notes. Nothing important lives only in chat.

## This file has been fully integrated into `todo.md` (2026-06-28)

The previous handoff's open thread and backlog were folded into `todo.md` so there is one durable backlog. Pointers:

- **Full-system e2e layer (mock + real-runtime) and the oracle false-failure fix** → `todo.md` §5.V (the
  `## FULL-SYSTEM e2e layer` note + the `promptBlock` / project-switch-stall / reasoning-snippet bug items).
  - The oracle false-PARTIAL is **RESOLVED**: `scripts/verify-full-system.mts`'s `runResultOracle` is now hermetic
    (extracts only the result branch's `src/` via `git archive` into a clean harness-owned project — no worktree, no
    shared `.git/config`/`core.bare` cross-talk). Re-verified live: 4 clean PASS, 0 false-PARTIAL.
  - Fresh-checkout gotcha: run `npm install` first — `playwright` is a runtime dep of `src/chat/chat-browser-tool.ts`
    and the full runtime won't boot without it (`ERR_MODULE_NOT_FOUND: playwright`).
- **Dev-test / evidence backlog** (Docker errors + broken evidence in the dschinn workspace; dev-test-start unification;
  full test-driven mode; the new "no result branch captured" PARTIAL class; the `board.cards` reads-0 cosmetic; the
  dschinn "master challenge" reserved for last) → `todo.md` §5.AI.

## How to run the full-system verifier
```bash
NKLEIN_VERIFY_MODEL="qwen/qwen2.5-coder-14b-m5max" npx tsx scripts/verify-full-system.mts   # single model
npx tsx scripts/verify-all-models.mts verify-full-system                                     # the model sweep
```
Needs: live LM Studio (`http://127.0.0.1:1234/v1`), Docker + `nklein/agent-sandbox:0.0.1`, tsx. ~1–2 min/run.

## Working-mode reminders (settled — don't re-litigate)
Autonomous full-capabilities: drive the headless browser / Docker / live models yourself; the user only specs/guides/
clarifies. Commit incrementally, each commit green (tsc + biome + `test:fast`; web-ui not in the root pre-commit — run
`web:typecheck` + web vitest + web e2e yourself for web-ui changes). `CHANGELOG.md` is release-notes only. Full rules of
engagement live in `todo.md` §2 / §3 / §5.0.1.
