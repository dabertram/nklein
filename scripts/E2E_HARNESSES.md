# §5.V live-e2e harnesses (`scripts/verify-*.mts`)

The **layer-2** half of §5.V's test net: real, live "punch-through" harnesses (live LM Studio + Docker),
run **manually / periodically** — not in the fast gate (layer-1 = the `test/contract/` suites). Each is a
standalone `tsx` script with its own header docs. They drive the REAL stack and assert externally-observable
behavior, so they survive a backend rewrite (the port-resilient oracle, like the contract suites).

## Common setup

- **LM Studio** running with a loaded chat model (e.g. `qwen/qwen3-8b-m5max`) at `http://127.0.0.1:1234/v1`.
- **Docker** up with the `nklein/agent-sandbox` image (the agent tool path is containerized).
- Most accept: `NKLEIN_VERIFY_MODEL`, `NKLEIN_VERIFY_PROVIDER` (default `lmstudio`), `NKLEIN_VERIFY_BASE_URL`,
  `NKLEIN_VERIFY_CONTEXT_WINDOW` (40000), `NKLEIN_VERIFY_TIMEOUT_MS`, `NKLEIN_VERIFY_DUMP_ACTIVITIES=1` (dump the
  agent's activity trace, invaluable for triage).
- The **in-memory** harnesses below require an isolated `HOME` (they guard on it): `HOME=/tmp/nklein-verify`.

Run e.g.: `HOME=/tmp/nklein-verify NKLEIN_VERIFY_MODEL="qwen/qwen3-8b-m5max" tsx scripts/verify-task-completion.mts`

## North-star pipeline (the agent grinding a project to delivery — small-model proven 2026-06-26)

| Harness | Proves |
| --- | --- |
| `verify-decompose-isolation.mts` | A real decompose: reads the spec → calls `decompose_project` (recovers a missing `title`); **no host path leaks** into agent output. In-memory service. |
| `verify-task-completion.mts` | A single implementation card runs to `awaiting_review` with a **correct, ready-to-merge result branch** (delivery verified). In-memory service. |
| `verify-multi-card-pipeline.mts` | **FULL runtime** (`startTsBackend` → `createDevTestProject` → `startTaskSession`): decompose → the runtime's auto-start **cascade** runs the generated cards. NB the seed-card start needs the same fields the UI sends (esp. `agentId` + `nkleinSettings`). |
| `verify-sandbox-mcp.mts` | §5.AR: a curated MCP server baked into the sandbox image is reachable over the real `docker exec -i <container> <cmd>` MCP transport **offline** (`--network none`), and the §5.AL fit gate offers it to a fitting model (qwen3-8b) but withholds it from a native reasoner. No model/task needed — needs Docker + the built `nklein/agent-sandbox` image. |

## Strict isolation (host details never reach the agent; no host worktrees)

`verify-strict-isolation.mts` · `verify-restart-resume-isolation.mts` · `verify-autopromote-recovery.mts`

## Chat agent (the sidebar `!Klein` agent — live)

`verify-chat-agent-e2e.mts` · `verify-chat-agent-tools.mts` · `verify-chat-agent-write.mts` ·
`verify-chat-browse.mts` · `verify-chat-command-exec.mts` · `verify-chat-create-card.mts` ·
`verify-chat-runtime.mts` · `verify-chat-send.mts`

## UI (Playwright against the served app)

`verify-card-detail-ui.mts` · `verify-settings-ui.mts` · `verify-chat-ui.mts` — assume the app is already
serving (default `http://127.0.0.1:4173`); they drive headless Chromium and assert zero console/CSP errors.
