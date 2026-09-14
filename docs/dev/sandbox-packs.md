# Sandbox ecosystem packs

The agent sandbox image (`nklein/agent-sandbox:<version>`, `docker/agent-sandbox/Dockerfile`) ships the base
toolchains (Node, Rust, Go, Java, Python 3.11 + uv). Anything an ecosystem needs beyond that is a **pack**: a small
overlay Dockerfile applied on top of the pinned base image, never a rebuild of it. This is how the sandbox is
"extended as needed for reasonable ecosystems" (David 2026-09-14, P1.SANDBOXPACKS) while a hotspot uplink stays a
viable build environment.

## Building a pack

```
node scripts/build-agent-sandbox-pack.mjs <pack> [--from <image>] [--tag <image>]
```

`docker/agent-sandbox/Dockerfile.<pack>-pack` is applied on `--from` (default `nklein/agent-sandbox:<package version>`)
and written to `--tag` (default: the same name, so the pack becomes the sandbox the runtime uses next). Build under a
separate tag while a measurement is running (`--tag nklein/agent-sandbox:0.0.1-python`) so the system under test does
not change underneath it; a runtime picks a specific image with `NKLEIN_AGENT_SANDBOX_IMAGE=<tag>`.

Every pack's Dockerfile ends with a readiness assertion that fails the BUILD when the advertised capability is absent
(the python pack: an offline 3.8 venv with pytest).

## Packs

| Pack | Adds | Why |
|---|---|---|
| `python` | CPython 3.8–3.12 under `/opt/uv/python` (offline), a per-interpreter wheelhouse of pytest/coverage (`UV_FIND_LINKS=/opt/nklein/wheels`) | era repositories (every SWE-bench Lite/Verified instance is a `setup.py` project from the 3.8/3.9 era); `uv venv` honours `.python-version` and resolves from the store without network |

Add a pack when a project needs it: one overlay Dockerfile, one entry in this table, and — if its package registry
must be reachable at the `medium` capability tier — one entry in the egress packs below.

## Egress packs (allowlist tier)

`sandboxEgressAllowlist` accepts `ecosystem:<name>` entries that expand to the ecosystem's canonical registry hosts
(`src/core/sandbox-egress-ecosystems.ts`): `npm`, `python`, `python-toolchain` (Astral's python-build-standalone
release assets on GitHub, for `uv python install`), `rust`, `go`, `java`, `ruby`. Role-scoped entries work the same
way (`worker:ecosystem:python`). An unknown name stays a plain, unreachable entry. At the `fully_open` tier (the
product default) the sandbox has full egress and the packs only matter for offline readiness.

## Toolchain prime

`src/core/language-toolchain-detection.ts` maps root manifests to install/test commands. Python projects
(`pyproject.toml`, `setup.py`/`setup.cfg`, `requirements.txt`) install through uv:
`uv venv --seed .nklein-venv && uv pip install --python .nklein-venv/bin/python -e . pytest coverage`. The test
tools are unpinned on this path on purpose: an era interpreter needs the last release that still supports it, and
uv's resolver knows which.
