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

RUN mkdir -m 1777 /workspaces

WORKDIR /workspaces

COPY tool-runner.cjs /opt/nklein/tool-runner.cjs

CMD ["sleep", "infinity"]
