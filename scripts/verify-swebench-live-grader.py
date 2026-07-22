#!/usr/bin/env python3
"""Fail-fast compatibility probe for !Klein's pinned native SWE-bench-Live grader."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


EXPECTED_HARNESS_COMMIT = "70ec57e852e3f2d195790fe71f553e272c691833"
EXPECTED_REPOLAUNCH_COMMIT = "7735b1e7363dd3bbc69bd0ef80db646a2ae391fd"


def git_commit(path: Path) -> str:
    return subprocess.check_output(
        ["git", "-C", str(path), "rev-parse", "HEAD"], text=True
    ).strip()


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "benchmark-harness/swebench-live").resolve()
    harness_commit = git_commit(root)
    launch_commit = git_commit(root / "launch")
    if harness_commit != EXPECTED_HARNESS_COMMIT:
        raise SystemExit(
            f"SWE-bench-Live harness mismatch: expected {EXPECTED_HARNESS_COMMIT}, found {harness_commit}"
        )
    if launch_commit != EXPECTED_REPOLAUNCH_COMMIT:
        raise SystemExit(
            f"RepoLaunch mismatch: expected {EXPECTED_REPOLAUNCH_COMMIT}, found {launch_commit}"
        )
    os.chdir(root)
    sys.path.insert(0, str(root / "launch"))
    sys.path.insert(0, str(root))
    from evaluation.evaluation import get_default_image_name, run_instances

    expected_image = "starryzhang/sweb.eval.x86_64.owner_1776_repo-1"
    image = get_default_image_name("owner__repo-1", "linux")
    if image != expected_image or not callable(run_instances):
        raise SystemExit("SWE-bench-Live evaluation API probe failed")
    print(
        json.dumps(
            {
                "harness_commit": harness_commit,
                "repo_launch_commit": launch_commit,
                "run_instances": True,
                "linux_image_architecture": "x86_64",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
