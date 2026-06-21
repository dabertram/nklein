"""Export the wire contract as JSON Schema (source of truth for TS<->Python parity).

Run: ``uv run python scripts/export_schema.py > contract.schema.json``. A CI check compares the TS zod
contract against this file and fails on drift.
"""

from __future__ import annotations

import json

from klein_core.contract import (
    CONTRACT_VERSION,
    GenerateRequest,
    GenerateResponse,
    GenerateStructuredRequest,
    GenerateStructuredResponse,
    HealthResponse,
)


def build_schema() -> dict[str, object]:
    return {
        "contractVersion": CONTRACT_VERSION,
        "models": {
            "GenerateRequest": GenerateRequest.model_json_schema(),
            "GenerateResponse": GenerateResponse.model_json_schema(),
            "GenerateStructuredRequest": GenerateStructuredRequest.model_json_schema(),
            "GenerateStructuredResponse": GenerateStructuredResponse.model_json_schema(),
            "HealthResponse": HealthResponse.model_json_schema(),
        },
    }


if __name__ == "__main__":
    print(json.dumps(build_schema(), indent=2))
