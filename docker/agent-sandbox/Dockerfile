FROM node:22-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ripgrep ca-certificates python3 \
	&& rm -rf /var/lib/apt/lists/*

# Curated MCP servers (§5.AR) baked into the image so they run 100% OFFLINE inside the sandbox (prime-directive #1):
# !Klein reaches them via `docker exec -i <container> <cmd>` — the host never spawns the process, so strict Docker
# isolation (invariant #2) holds. Installed at BUILD time (build has network; the running container is `--network none`),
# pinned for reproducibility. Bin: `mcp-server-sequential-thinking` (stdio). node/npm are already in the base image.
RUN npm install -g @modelcontextprotocol/server-sequential-thinking@2025.12.18 \
	&& npm cache clean --force

# codebase-memory-mcp (§5.AR / §5.B) — DeusData code-graph MCP: exact STRUCTURAL queries (search_graph / trace_path /
# get_code_snippet / get_architecture) + local semantic search via a compiled-in nomic-embed-code (int8) — no API key,
# no runtime fetch. MIT. The npm launcher's postinstall (install.js) downloads the PINNED linux `-portable`
# fully-static binary from GitHub Releases at BUILD time (build has network), checksum-verified, into the package's
# `bin/`; at runtime `bin.js` just execs it — NO network, so it works under `--network none`. install.js is NON-FATAL
# on a failed download, so we ASSERT the binary materialized (`test -x`) and fail the build otherwise — never ship an
# image that offers a missing binary. Stdio server: bare `codebase-memory-mcp` (matches the catalog's inContainerArgv).
RUN npm install -g codebase-memory-mcp@0.8.1 \
	&& npm cache clean --force \
	&& test -x "$(npm root -g)/codebase-memory-mcp/bin/codebase-memory-mcp"

# codebase-memory needs a WRITABLE cache dir (its SQLite index + config). The sandbox runs the agent as an unprivileged
# uid whose HOME may not be writable, so point the cache at a world-writable in-image path (like /workspaces) via
# CBM_CACHE_DIR, and enable auto-indexing so a workspace is indexed on first MCP connection (search_graph returns real
# results without the harness having to issue an explicit index_repository first). Each sandbox container is separate +
# ephemeral, so a shared 1777 dir is safe. The `config set` is best-effort (guarded) so a CLI change never breaks the
# build — without it the tool is still present and degrades gracefully (empty graph ⇒ the model falls back to grep).
ENV CBM_CACHE_DIR=/opt/nklein/cbm
RUN mkdir -m 1777 -p /opt/nklein/cbm \
	&& (codebase-memory-mcp config set auto_index true || echo "codebase-memory: auto_index not set (non-fatal)")

# basic-memory (§5.AR authored markdown-graph memory) — AGPL-3.0-or-later, Python 3.12+ (the base image ships 3.11), so
# install via uv: COPY the pinned uv static binary from Astral's official image, then `uv tool install` provisions an
# ISOLATED venv + a managed CPython 3.12 at BUILD time (build has network; the running container is --network none).
# The managed python + tool venv go under a WORLD-READABLE /opt/uv (chmod a+rX) because the sandbox execs the launcher
# as an unprivileged uid — never from root's 0700 home. Bin: `basic-memory` (stdio via `basic-memory mcp`, overriding
# the upstream SSE default). `--help` ASSERTS the install runs so a broken bake fails the BUILD, not runtime. Egress is
# hardened by env (verified vectors: pypi auto-update, Umami analytics, FastEmbed HF download); semantic search is left
# OFF (robust SQLite FTS recall — no ~73MB model to pre-seed; enable + pre-seed later). --network none is the backstop.
COPY --from=ghcr.io/astral-sh/uv:0.11.26 /uv /uvx /usr/local/bin/
ENV UV_PYTHON_INSTALL_DIR=/opt/uv/python \
	UV_TOOL_DIR=/opt/uv/tools \
	UV_TOOL_BIN_DIR=/usr/local/bin
RUN uv tool install --python 3.12 basic-memory==0.22.1 \
	&& chmod -R a+rX /opt/uv \
	&& basic-memory --help >/dev/null
ENV BASIC_MEMORY_AUTO_UPDATE=false \
	BASIC_MEMORY_NO_PROMOS=1 \
	BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED=false \
	HF_HUB_OFFLINE=1 \
	TRANSFORMERS_OFFLINE=1

RUN mkdir -m 1777 /workspaces

WORKDIR /workspaces

COPY tool-runner.cjs /opt/nklein/tool-runner.cjs

CMD ["sleep", "infinity"]
