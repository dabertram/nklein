FROM node@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2

WORKDIR /opt/aider-polyglot
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

# Candidate patches are applied inside the sealed grader boundary. The slim
# Node base intentionally omits VCS tooling, so make the grader's patching
# dependency explicit instead of assuming `git` exists (found 2026-07-23 in the
# same sweep as the Java gap; the JS tranche had not started yet).
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
