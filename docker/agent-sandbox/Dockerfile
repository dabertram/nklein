ARG NKLEIN_AGENT_SANDBOX_NODE_IMAGE=node:22-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2
ARG NKLEIN_AGENT_SANDBOX_RUST_IMAGE=rust:1.88-bookworm@sha256:af306cfa71d987911a781c37b59d7d67d934f49684058f96cf72079c3626bfe0
ARG NKLEIN_AGENT_SANDBOX_GO_IMAGE=golang:1.24-bookworm@sha256:1a6d4452c65dea36aac2e2d606b01b4a029ec90cc1ae53890540ce6173ea77ac
ARG NKLEIN_AGENT_SANDBOX_GRADLE_IMAGE=gradle:8.14-jdk21@sha256:dae150d9066fc04a791ec7f0adc1a0eb4e867f11d76d03063ee0a60e5da56149
ARG NKLEIN_AGENT_SANDBOX_MAVEN_IMAGE=maven:3.9.9-eclipse-temurin-21@sha256:3a4ab3276a087bf276f79cae96b1af04f53731bec53fb2e651aca79e4b10211e

FROM ${NKLEIN_AGENT_SANDBOX_RUST_IMAGE} AS rust-runtime
RUN rustup component add rust-analyzer rust-src

FROM ${NKLEIN_AGENT_SANDBOX_GO_IMAGE} AS go-runtime
RUN go install golang.org/x/tools/gopls@v0.21.1 \
	&& rm -rf /go/pkg/mod /root/.cache/go-build
FROM ${NKLEIN_AGENT_SANDBOX_GRADLE_IMAGE} AS gradle-runtime
FROM ${NKLEIN_AGENT_SANDBOX_MAVEN_IMAGE} AS maven-runtime
FROM ${NKLEIN_AGENT_SANDBOX_NODE_IMAGE}

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential ca-certificates curl git python3 python3-pip python3-venv ripgrep \
	&& rm -rf /var/lib/apt/lists/*

# F12.84b — one STRICTLY isolated, pinned polyglot runtime image. The sandbox pool intentionally shares containers
# across cards, so per-card base-image swapping would strand co-tenants and destroy warm caches. Instead we copy the
# exact language runtimes into the same read-only image and deterministically select only the detected toolchain's
# commands at execution time. No host compiler/interpreter is mounted or invoked.
COPY --from=rust-runtime /usr/local/cargo /usr/local/cargo
COPY --from=rust-runtime /usr/local/rustup /usr/local/rustup
COPY --from=go-runtime /usr/local/go /usr/local/go
COPY --from=go-runtime /go/bin/gopls /usr/local/go/bin/gopls
COPY --from=gradle-runtime /opt/gradle /opt/gradle
COPY --from=gradle-runtime /opt/java/openjdk /opt/java/openjdk
COPY --from=maven-runtime /usr/share/maven /usr/share/maven
ENV RUSTUP_HOME=/usr/local/rustup \
	CARGO_HOME=/usr/local/cargo \
	JAVA_HOME=/opt/java/openjdk \
	GRADLE_HOME=/opt/gradle \
	PATH=/usr/local/cargo/bin:/usr/local/go/bin:/opt/gradle/bin:/usr/share/maven/bin:/opt/java/openjdk/bin:${PATH}

# Lockfile-selected JS package managers must already exist because runtime network access may be `none`. Their package
# dependencies are still installed only inside the task workspace, under that card's network policy.
RUN npm install -g pnpm@10.13.1 yarn@1.22.22 bun@1.2.18 \
	&& npm cache clean --force

# Curated MCP servers (§5.AR) baked into the image so they run 100% OFFLINE inside the sandbox (prime-directive #1):
# !Klein reaches them via `docker exec -i <container> <cmd>` — the host never spawns the process, so strict Docker
# isolation (invariant #2) holds. Installed at BUILD time (build has network; the running container is `--network none`),
# pinned for reproducibility. Bin: `mcp-server-sequential-thinking` (stdio). node/npm are already in the base image.
RUN npm install -g @modelcontextprotocol/server-sequential-thinking@2025.12.18 \
	&& npm cache clean --force

# The repo-map and structural-search tools use ast-grep's tree-sitter N-API binding. The tool runner leaves this native
# dependency external so Docker resolves the Linux build here instead of bundling the host's Darwin/Windows binary.
RUN npm install --prefix /opt/nklein @ast-grep/napi@0.44.1 \
	&& npm cache clean --force

# F12.64/F12.85 — persistent, lazy LSP backends for navigation + diagnostics. The repository wrapper starts only the
# family a card actually touches, preserving container memory. Every upstream server is baked and pinned at BUILD time;
# runtime remains fully offline (`--network none`).
RUN npm install -g typescript-language-server@5.3.0 typescript@5.9.3 pyright@1.1.410 \
	&& npm cache clean --force \
	&& typescript-language-server --version | grep -Fx '5.3.0' \
	&& tsc --version | grep -Fx 'Version 5.9.3' \
	&& pyright --version | grep -Fx 'pyright 1.1.410'

# Eclipse JDT.LS milestone (not a moving snapshot). Verify the publisher's SHA-256 before extraction. The upstream
# `bin/jdtls` wrapper selects stdio and requires a distinct writable `-data` directory, which the broker derives under
# the task container's /tmp for each workspace.
ARG NKLEIN_JDTLS_URL=https://download.eclipse.org/jdtls/milestones/1.60.0/jdt-language-server-1.60.0-202606262232.tar.gz
ARG NKLEIN_JDTLS_SHA256=e94c303d8198f977930803582738771fd18c52c5492878410bf222b1aa81ef1d
RUN mkdir -p /opt/jdtls \
	&& curl -fsSL "$NKLEIN_JDTLS_URL" -o /tmp/jdtls.tar.gz \
	&& echo "$NKLEIN_JDTLS_SHA256  /tmp/jdtls.tar.gz" | sha256sum -c - \
	&& tar -xzf /tmp/jdtls.tar.gz -C /opt/jdtls \
	&& rm /tmp/jdtls.tar.gz \
	&& test -x /opt/jdtls/bin/jdtls

# codebase-memory-mcp (§5.AR / §5.B) — DeusData code-graph MCP: exact STRUCTURAL queries (search_graph / trace_path /
# get_code_snippet / get_architecture) + local semantic search via a compiled-in nomic-embed-code (int8) — no API key,
# no runtime fetch. MIT. The npm launcher's postinstall (install.js) downloads the PINNED linux `-portable`
# fully-static binary from GitHub Releases at BUILD time (build has network), checksum-verified, into the package's
# `bin/`; at runtime `bin.js` just execs it — NO network, so it works under `--network none`. install.js is NON-FATAL
# on a failed download, so we ASSERT the binary materialized (`test -x`) and fail the build otherwise — never ship an
# image that offers a missing binary. Stdio server: bare `codebase-memory-mcp` (matches the catalog's inContainerArgv).
RUN npm install -g codebase-memory-mcp@0.9.0 \
	&& npm cache clean --force \
	&& test -x "$(npm root -g)/codebase-memory-mcp/bin/codebase-memory-mcp" \
	&& codebase-memory-mcp --version | grep -Fx 'codebase-memory-mcp 0.9.0'

# codebase-memory needs a WRITABLE cache dir (its SQLite index + config). The sandbox runs the agent as an unprivileged
# uid whose HOME may not be writable, so point the cache at a world-writable in-image path (like /workspaces) via
# CBM_CACHE_DIR, and enable auto-indexing so a workspace is indexed on first MCP connection (search_graph returns real
# results without the harness having to issue an explicit index_repository first). Each sandbox container is separate +
# ephemeral, so a shared 1777 dir is safe. The `config set` is best-effort (guarded) so a CLI change never breaks the
# build — without it the tool is still present and degrades gracefully (empty graph ⇒ the model falls back to grep).
# v0.9 sizes its default memory budget from the detected host/cgroup tier. Pin the same 2 GiB ceiling declared by the
# curated catalog so custom larger containers cannot silently invalidate !Klein's admission calculation.
ENV CBM_CACHE_DIR=/opt/nklein/cbm \
	CBM_MEM_BUDGET_MB=2048
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
	&& uv tool install --python 3.12 poetry==2.1.3 \
	&& chmod -R a+rX /opt/uv \
	&& basic-memory --help >/dev/null \
	&& poetry --version | grep -Fx 'Poetry (version 2.1.3)'
ENV BASIC_MEMORY_AUTO_UPDATE=false \
	BASIC_MEMORY_NO_PROMOS=1 \
	BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED=false \
	HF_HUB_OFFLINE=1 \
	TRANSFORMERS_OFFLINE=1

RUN mkdir -m 1777 /workspaces

# Fail the IMAGE BUILD when any advertised runtime is absent. Version output is kept in the build log as immutable
# provenance for later startup/install timing reports.
RUN node --version \
	&& npm --version \
	&& pnpm --version \
	&& yarn --version \
	&& bun --version \
	&& python3 --version \
	&& cargo --version \
	&& rustc --version \
	&& rust-analyzer --version \
	&& go version \
	&& gopls version \
	&& java -version \
	&& gradle --version \
	&& mvn --version

WORKDIR /workspaces

COPY tool-runner.cjs /opt/nklein/tool-runner.cjs
COPY lsp-symbol-mcp-server.cjs /opt/nklein/lsp-symbol-mcp-server.cjs

CMD ["sleep", "infinity"]
