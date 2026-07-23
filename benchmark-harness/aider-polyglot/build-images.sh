#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

docker build --file "$root/cpp.Dockerfile" --tag nklein/aider-polyglot-cpp:1.0.0 "$root"
docker build --file "$root/go.Dockerfile" --tag nklein/aider-polyglot-go:1.0.0 "$root"
docker build --file "$root/javascript.Dockerfile" --tag nklein/aider-polyglot-javascript:1.0.0 "$root"
docker build --file "$root/java.Dockerfile" --tag nklein/aider-polyglot-java:1.0.0 "$root"
docker build --file "$root/rust.Dockerfile" --tag nklein/aider-polyglot-rust:1.0.0 "$root"
