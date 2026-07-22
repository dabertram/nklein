#!/bin/sh
set -eu

exercise=${1:?exercise name is required}
case "$exercise" in
  *[!a-z0-9-]* | "")
    echo "unsafe exercise name" >&2
    exit 2
    ;;
esac

# Exercism's shared CMakeLists derives the source filename from the source-directory basename.
# The grader mount is intentionally generic, so present it through a validated, ephemeral name.
ln -s /grade "/tmp/$exercise"
cmake -S "/tmp/$exercise" -B /grade/build -DEXERCISM_RUN_ALL_TESTS=1 -G "Unix Makefiles"
cmake --build /grade/build --parallel 2
