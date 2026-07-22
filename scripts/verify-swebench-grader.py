#!/usr/bin/env python3
"""Fail-fast compatibility probe for !Klein's pinned official SWE-bench grading seam."""

import json
from importlib.metadata import version

from swebench.harness.grading import get_eval_report
from swebench.harness.log_parsers import MAP_REPO_TO_PARSER


EXPECTED_VERSION = "4.1.0"


def main() -> None:
    installed = version("swebench")
    if installed != EXPECTED_VERSION:
        raise SystemExit(
            f"swebench version mismatch: expected {EXPECTED_VERSION}, installed {installed}"
        )
    if not callable(get_eval_report):
        raise SystemExit("swebench.harness.grading.get_eval_report is unavailable")
    if not MAP_REPO_TO_PARSER:
        raise SystemExit("swebench.harness.log_parsers.MAP_REPO_TO_PARSER is empty")
    print(
        json.dumps(
            {
                "version": installed,
                "get_eval_report": True,
                "parser_count": len(MAP_REPO_TO_PARSER),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
