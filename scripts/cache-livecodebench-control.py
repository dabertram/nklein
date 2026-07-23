#!/usr/bin/env python3
"""Explicit egress step: cache one release/date window for offline control runs."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

PINNED_COMMIT = "28fef95ea8c9f7a547c8329f2cd3d32b92c1fa24"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cache an official LiveCodeBench release window. This command performs network egress."
    )
    parser.add_argument("--harness", required=True)
    parser.add_argument("--release-version", default="release_v6", choices=["release_v6"])
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()

    harness = Path(args.harness).resolve()
    head = subprocess.run(
        ["git", "-C", str(harness), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    ).stdout.strip()
    if head != PINNED_COMMIT:
        raise SystemExit(f"LiveCodeBench harness must be pinned at {PINNED_COMMIT}; found {head}")
    if subprocess.run(
        ["git", "-C", str(harness), "status", "--porcelain"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    ).stdout.strip():
        raise SystemExit("LiveCodeBench harness checkout must be clean")

    sys.path.insert(0, str(harness))
    os.chdir(harness)
    from lcb_runner.benchmarks import load_code_generation_dataset

    problems = sorted(
        load_code_generation_dataset(args.release_version, start_date=args.start_date, end_date=args.end_date),
        key=lambda problem: problem.question_id,
    )
    if not problems:
        raise SystemExit("selected LiveCodeBench window contains no problems")
    rows = [
        {
            "question_id": problem.question_id,
            "contest_date": problem.contest_date.isoformat(),
            "prompt_sha256": hashlib.sha256(problem.question_content.encode("utf-8")).hexdigest(),
        }
        for problem in problems
    ]
    canonical = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("utf-8")
    manifest = {
        "schema_version": 1,
        "harness_commit": PINNED_COMMIT,
        "release_version": args.release_version,
        "start_date": args.start_date,
        "end_date": args.end_date,
        "problem_count": len(rows),
        "window_sha256": hashlib.sha256(canonical).hexdigest(),
        "problems": rows,
        "cached_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    path = Path(args.manifest).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    print(json.dumps({"manifest": str(path), **manifest}, sort_keys=True))


if __name__ == "__main__":
    main()
