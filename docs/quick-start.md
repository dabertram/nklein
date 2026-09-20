# Quick start

From a clean machine to a card moving on the board. Every step is local; nothing here talks to a cloud model.

## 1. Prerequisites

- **Node.js 22+** and npm.
- **Docker** (Docker Desktop or a daemon the current user can reach). Every agent runs inside a hardened sandbox
  container; without Docker, !Klein plans and shows the board but refuses to start cards — fail-closed by design.
- **A local model server**: [LM Studio](https://lmstudio.ai) on `http://localhost:1234` with at least one loaded
  chat model that has a **32k or larger context window** (the runtime never sends an oversized prompt; smaller
  windows are refused, not truncated).

## 2. Install and run from source

`nklein` is not on npm yet (prerelease 0.0.1), so build it from this repository:

```bash
git clone https://github.com/dabertram/nklein.git
cd nklein
npm run install:all      # root + vendored SDK + web UI + desktop workspaces
npm run build            # builds the runtime, the web UI and the sandbox image
./dist/cli.js            # starts the runtime and opens http://127.0.0.1:3484
```

Useful flags: `--port <n|auto|ephemeral>`, `--host <ip>` (loopback by default), `--no-open`.
For day-to-day development use `npm run dev:full` instead (runtime + Vite with hot reload).

Run it from inside a git repository to open that project, or start it anywhere and use **Add Project** in the UI.

## 3. First run

1. **Get started** — a four-slide tour; skip it with the ✕ if you know the product.
2. **Guided setup** — the wizard recommends the global configuration (model roles, sandbox sizing) from what it
   detects on this machine and ends with **"How much do you want to see?"**, which picks your detail level (below).
   Re-run it any time from *Settings → General → Run setup wizard*.
3. Tell !Klein what to build in the chat box, or press `c` to write a card yourself. Decomposition produces linked
   cards; each card runs in its own sandbox on the model routed for it, is reviewed, and moves through
   *Planning → Ready → In Progress → Review → Completed*.

`nklein setup` prints the same recommendations in a terminal; `nklein setup acquire <model>` previews a model
download and only fetches it when re-run with `--approve`.

## 4. Detail levels

One continuous surface, six views, switched in the strip under the title bar (the keys `0`–`4` and `G`). The level
changes what you **see**, never what the runtime does.

| Level | What it is for | What it shows |
| --- | --- | --- |
| **0 Minimalistic** | Just a conversation. | The chat and your projects — no git chrome, no telemetry. |
| **1 Clean** | A live map of the work. | Clusters of cards by stream; click one to drill into its lean lanes. |
| **2 Advanced** | The full board. | Every lane, card chrome, git actions, shortcuts, code intelligence. |
| **3 Professional** | The cockpit. | The board plus host/fleet resources and dependency edges always on. |
| **4 Full** | Everything. | Adds developer and diagnostic surfaces (needs *Developer mode* in Settings). |
| **G Graph** | The plan as a graph. | The dependency DAG with critical path and ETA. |

Opening a card at Minimalistic or Clean shows a minimal sheet first; **Full detail** is one tap away.

## 5. Where things live

- `~/.nklein/nklein/config.json` — global runtime configuration (what the wizard writes).
- `~/.nklein/nklein/workspaces/<project>/board.json` — the board itself, one file per project.
- `~/.nklein/data/settings/providers.json` — the model-server endpoint(s).
- Agent sandboxes are Docker containers labelled `nklein.kind=agent-sandbox`; the runtime reaps its own on start.

## 6. When something is off

- **"Disconnected from !Klein"** — the runtime process is gone; start it again and reload the tab.
- **"Sandbox unavailable"** in the board header — Docker is not reachable or the image is not built; run
  `npm run sandbox:build` after starting Docker.
- **"Selected model … is not currently loaded"** — load it in LM Studio (or pick another in *Settings → !Klein
  Provider & Models*).
- Everything else: *Settings → Read the docs*, or the [engineering docs](./README.md).
