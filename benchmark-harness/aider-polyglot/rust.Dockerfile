FROM rust@sha256:9b2689d6f99ff381f178fa4361db745c8c355faecde73aa5b18b0efa84f03e62

ENV CARGO_HOME=/opt/cargo-cache
WORKDIR /opt/aider-polyglot-rust-seed
COPY rust-seed/Cargo.toml rust-seed/Cargo.lock ./
COPY rust-seed/src src
RUN cargo fetch --locked \
    && rm -f /opt/cargo-cache/.package-cache /opt/cargo-cache/.package-cache-mutate
