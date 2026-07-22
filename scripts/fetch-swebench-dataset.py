#!/usr/bin/env python3
"""Explicit egress step: fetch and pin a bounded SWE-style dataset slice locally."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from datasets import load_dataset


LIVE_DATASET = "SWE-bench-Live/SWE-bench-Live"
LEGACY_DATASETS = {
    "princeton-nlp/SWE-bench_Lite",
    "princeton-nlp/SWE-bench_Verified",
}
ALLOWED_DATASETS = {LIVE_DATASET, *LEGACY_DATASETS}
MAX_ROWS = 500


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch an immutable, bounded SWE-style task slice. This command performs network egress; "
            "the runtime benchmark commands never fetch."
        )
    )
    parser.add_argument("--dataset", required=True, choices=sorted(ALLOWED_DATASETS))
    parser.add_argument("--revision", required=True, help="Hugging Face dataset commit SHA; floating revisions are refused.")
    parser.add_argument("--split", help="Dataset split (default: lite for Live, test for legacy compatibility data).")
    parser.add_argument("--output", required=True)
    parser.add_argument("--instance-id", action="append", default=[])
    parser.add_argument("--fresh-after", help="ISO date cutoff over created_at (fresh-set track).")
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--allow-legacy", action="store_true", help="Acknowledge legacy contamination and use for paired A/B only.")
    return parser.parse_args()


def iso_timestamp(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.timestamp()
    text = str(value).replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    raise TypeError(f"Unsupported dataset value: {type(value).__name__}")


def main() -> None:
    args = parse_args()
    if not (7 <= len(args.revision) <= 64) or any(character not in "0123456789abcdefABCDEF" for character in args.revision):
        raise SystemExit("--revision must be a 7–64 character hexadecimal dataset commit SHA")
    if args.dataset in LEGACY_DATASETS and not args.allow_legacy:
        raise SystemExit("legacy SWE-bench data requires --allow-legacy and may support paired A/B claims only")
    if args.limit < 1 or args.limit > MAX_ROWS:
        raise SystemExit(f"--limit must be between 1 and {MAX_ROWS}; unbounded corpus retention is forbidden")
    cutoff = iso_timestamp(args.fresh_after) if args.fresh_after else None
    requested = set(args.instance_id)
    split = args.split or ("lite" if args.dataset == LIVE_DATASET else "test")

    dataset = load_dataset(args.dataset, split=split, revision=args.revision)
    rows: list[dict[str, Any]] = []
    for row in dataset:
        instance_id = str(row.get("instance_id", ""))
        if requested and instance_id not in requested:
            continue
        created_at = iso_timestamp(row.get("created_at"))
        if cutoff is not None and (created_at is None or created_at < cutoff):
            continue
        rows.append(dict(row))
        if not requested and len(rows) >= args.limit:
            break
    if requested:
        missing = sorted(requested - {str(row.get("instance_id", "")) for row in rows})
        if missing:
            raise SystemExit(f"requested instance ids absent after filters: {', '.join(missing)}")
    if len(rows) > args.limit:
        raise SystemExit(f"selection returned {len(rows)} rows, above explicit --limit {args.limit}")
    if not rows:
        raise SystemExit("selection returned zero rows; no benchmark artifact was written")

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest_path = output.with_suffix(output.suffix + ".manifest.json")
    if output.exists() or manifest_path.exists():
        raise SystemExit("output or manifest already exists; pinned benchmark slices are immutable, so choose a new path")
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    manifest_temporary = manifest_path.with_name(f".{manifest_path.name}.{os.getpid()}.tmp")
    digest = hashlib.sha256()
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            os.chmod(temporary, 0o600)
            for row in sorted(rows, key=lambda item: str(item.get("instance_id", ""))):
                encoded = (json.dumps(row, sort_keys=True, default=json_default) + "\n").encode("utf-8")
                handle.write(encoded.decode("utf-8"))
                digest.update(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        manifest = {
            "schema_version": 1,
            "dataset": args.dataset,
            "revision": args.revision.lower(),
            "split": split,
            "row_count": len(rows),
            "instance_ids": sorted(str(row["instance_id"]) for row in rows),
            "sha256": digest.hexdigest(),
            "fresh_after": args.fresh_after,
            "legacy_contamination_acknowledged": args.dataset in LEGACY_DATASETS,
            "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        with manifest_temporary.open("x", encoding="utf-8") as handle:
            handle.write(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
        try:
            os.replace(manifest_temporary, manifest_path)
        except BaseException:
            output.unlink(missing_ok=True)
            raise
    finally:
        temporary.unlink(missing_ok=True)
        manifest_temporary.unlink(missing_ok=True)
    print(json.dumps({"output": str(output), "manifest": str(manifest_path), **manifest}, sort_keys=True))


if __name__ == "__main__":
    main()
