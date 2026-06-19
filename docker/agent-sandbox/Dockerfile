FROM node:22-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ripgrep ca-certificates python3 \
	&& rm -rf /var/lib/apt/lists/*

RUN mkdir -m 1777 /workspaces

WORKDIR /workspaces

COPY tool-runner.mjs /opt/nklein/tool-runner.mjs

CMD ["sleep", "infinity"]
