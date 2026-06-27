# Handoff — continue on another machine

Branch: `feat/kanban-reliability-context-upgrade`. Pull it, then read this top-to-bottom. Durable state lives in
`todo.md` (the backlog), `AGENTS.md` (tribal knowledge), and git — nothing important is only in chat.

## What was JUST built + PROVEN (this session): the FULL-SYSTEM e2e layer

The e2e effort has two layers:
1. **Mock layer (already committed earlier, `75862b37`)** — fast, deterministic Playwright UI e2e. `web-ui/tests/harness/`
   (`installRuntimeMock` + fixtures + board helpers), proven by `web-ui/tests/board-harness.spec.ts`. Covers UI
   *presentation*. Run: `PLAYWRIGHT_BROWSERS_PATH=/Users/david/Library/Caches/ms-playwright npm --prefix web-ui run e2e`.
2. **Full-system layer (this session, in THIS commit)** — the real backend producing a real, checkable artifact:
   - [scripts/full-system-harness.mts](scripts/full-system-harness.mts) — reusable `bootFullSystemRuntime()`: boots the
     genuine `src/cli.ts` (the `dev:full` runtime) under an isolated HOME on a free port with `NODE_ENV=development`,
     returns typed tRPC clients (global + workspace-scoped) + a board WebSocket + a clean SIGTERM→SIGKILL `stop()`.
     **Reuse this** for future full-system verifiers (project-switch stall, evidence, review→merge) — don't re-spawn by hand.
   - [scripts/verify-full-system.mts](scripts/verify-full-system.mts) — the verifiable-result e2e: pins the live model,
     scaffolds `small-model-smoke` (a tiny TS CLI shipping a REAL uncapped-score bug) via the real `createDevTestProject`,
     starts a direct fix card on the real stack, watches to a terminal state, then checks out the `nklein/tasks/<task>`
     result branch and runs a **harness-owned cap-invariant oracle** (the agent can't game it) → **PASS / PARTIAL / INCOMPLETE**.

### How to run it
```bash
# single model (isolated HOME auto-created if HOME isn't already isolated):
NKLEIN_VERIFY_MODEL="qwen/qwen2.5-coder-14b-m5max" npx tsx scripts/verify-full-system.mts
# the model sweep (free — verify-all-models drives any verify-*.mts across the LM Studio roster, honors deepseek-drop):
npx tsx scripts/verify-all-models.mts verify-full-system
```
Needs: live LM Studio (`http://127.0.0.1:1234/v1`), Docker + the `nklein/agent-sandbox:0.0.1` image, tsx. A run takes ~1–2 min.

### Proof status
Ran 4× with qwen2.5-coder-14b: **2 clean PASS** (booted → ran to `awaiting_review` → oracle confirmed the cap bug
*actually* fixed → clean teardown incl. Docker containers gone), **2 PARTIAL**. The core harness is proven end-to-end.
Note: `scripts/` is outside the tsc + biome scope (like every `verify-*.mts`), so these are validated by *running*, not
the static gate — the green commit gate (tsc + biome + `test:fast`) is unaffected by them.

## OPEN THREAD — start here (the one thing left mid-investigation)

**Intermittent PARTIAL false-failure in the oracle.** On 2 of 4 runs the card reached `awaiting_review` but the oracle
reported `fail 1` with a **file-level** ✖ and **no named subtest failure**. Crucially: run 3's captured agent
`src/habit-score.ts` was `return Math.round(Math.min(1, completionRatio + streakBonus) * 100);` — which I **proved passes
all 4 oracle tests** in two clean local repros (a bare dir AND a full smoke-ts-cli template copy). So the model's fix was
*correct* yet the harness oracle failed → **the oracle has an environment-sensitive false-failure**, not the model.

What I couldn't reproduce by guessing, so it's now **instrumented** (in this commit): `runResultOracle` captures the agent
source + **full unfiltered** oracle stdout/stderr + exit code, and `main()` dumps them on any non-PASS. **Next step:** run
`verify-full-system.mts` until a PARTIAL recurs, read the FULL oracle output in the log (no longer filtered), and find why
`node --experimental-strip-types --test test/habit-score.test.js` fails *only* inside the `git worktree add --detach`
checkout. Hypotheses not yet ruled out: (a) a stray uncaught rejection/exit in the worktree process; (b) the agent also
touched `package.json`/`tsconfig`/a sibling that perturbs the run; (c) a worktree-vs-`git show` content mismatch (unlikely —
same ref). The fix is likely either making the oracle run hermetic (copy only `src/habit-score.ts` + the oracle test into a
clean temp dir instead of using the worktree) or correctly classifying a no-assertion-failure file-level error.

## Broader pending backlog (full detail in `todo.md`, the TodoWrite list mirrors it)

- Expand systematic UI-e2e-with-mocks specs on the mock harness (board lifecycle, project nav incl. the switch stall, settings, review).
- **Bug the mock harness caught:** clicking a card can crash on unguarded `response.promptBlock` after a tRPC call that
  returns null — `web-ui/src/components/kanban-board.tsx` ~L487 + `.../detail-panels/task-recovery-actions-panel.tsx` ~L166.
- Reproduce + fix the residual **project-switch stall** (empty/stalled board when switching projects while a card processes).
- Investigate + fix the **Docker errors** in the dschinn dev-workspace + **broken evidence creation**.
- Land the **reasoning-phase activity snippet** on the board card (earlier speculative attempt was reverted — needs the correct event path; reasoning flows a different path than `assistant-reasoning-delta`'s `latestHookActivity`).
- Rework the **dev-test-start layout** (unify the 2 start paths) + add **full test-driven mode** (default ON, global + per-project) + **simplify `read_large_file`**.
- The dschinn "master challenge" is reserved for the final fun part — keep using small projects for UI/e2e stabilization.

## Working-mode reminders (settled — don't re-litigate)
Autonomous full-capabilities: drive the headless browser / Docker / live models yourself; user only specs/guides/clarifies.
Commit incrementally, each commit green (tsc + biome + `test:fast`; web-ui NOT in the root pre-commit — run `web:typecheck`
+ web vitest + web e2e yourself for web-ui changes). `CHANGELOG.md` is release-notes only (user-facing features / fixes to
bugs that shipped on `main`) — a dev harness is neither, so it gets a `todo.md` note, not a changelog entry.
