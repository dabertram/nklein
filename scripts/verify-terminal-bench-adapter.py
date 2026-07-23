#!/usr/bin/env python3
"""Fail-closed protocol probe for the pinned Harbor external-agent seam."""

from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harbor.agents.base import BaseAgent
from harbor.models.agent.context import AgentContext

from integrations.harbor.nklein_harbor_agent import MAX_STREAM_CHARS, NKleinHarborAgent

PINNED_HARBOR_VERSION = "0.5.0"


class _Input:
    def __init__(self) -> None:
        self.messages: list[dict[str, object]] = []

    def write(self, value: bytes) -> None:
        self.messages.append(json.loads(value.decode("utf-8")))

    async def drain(self) -> None:
        return None


class _Output:
    def __init__(self) -> None:
        self.lines = iter(
            [
                json.dumps(
                    {
                        "type": "exec",
                        "id": 7,
                        "request": {
                            "command": "printf probe",
                            "cwd": "/root",
                            "timeoutSeconds": 12,
                        },
                    }
                ).encode()
                + b"\n",
                json.dumps(
                    {
                        "type": "complete",
                        "result": {
                            "sessionId": "probe-session",
                            "submittedSummary": "probe complete",
                            "warnings": [],
                        },
                    }
                ).encode()
                + b"\n",
            ]
        )

    async def readline(self) -> bytes:
        return next(self.lines, b"")


class _Stderr:
    async def readline(self) -> bytes:
        return b""


class _Process:
    def __init__(self) -> None:
        self.stdin = _Input()
        self.stdout = _Output()
        self.stderr = _Stderr()
        self.returncode: int | None = None

    async def wait(self) -> int:
        self.returncode = 0
        return 0

    def terminate(self) -> None:
        self.returncode = -15


class _Environment:
    session_id = "probe-environment"

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def exec(self, **kwargs: object) -> SimpleNamespace:
        self.calls.append(kwargs)
        return SimpleNamespace(
            return_code=0, stdout="x" * (MAX_STREAM_CHARS + 100), stderr=""
        )


async def _probe(repo: Path) -> dict[str, object]:
    if importlib.metadata.version("harbor") != PINNED_HARBOR_VERSION:
        raise RuntimeError(f"Harbor must be pinned to {PINNED_HARBOR_VERSION}")
    if not issubclass(NKleinHarborAgent, BaseAgent):
        raise RuntimeError("!Klein adapter does not implement Harbor BaseAgent")
    if not (repo / "scripts" / "run-terminal-bench-agent.mts").is_file():
        raise RuntimeError("!Klein Terminal-Bench TypeScript bridge is missing")
    if not (repo / "node_modules" / ".bin" / "tsx").is_file():
        raise RuntimeError("!Klein workspace dependencies are missing")

    environment = _Environment()
    process = _Process()
    context = AgentContext()
    with tempfile.TemporaryDirectory(prefix="nklein-harbor-probe-") as logs:
        agent = NKleinHarborAgent(Path(logs), model_name="probe/model")
        await agent.setup(environment)  # type: ignore[arg-type]
        with (
            patch.dict(
                os.environ,
                {
                    "NKLEIN_TERMINAL_MODEL_BASE_URL": "http://127.0.0.1:1234/v1",
                    "NKLEIN_TERMINAL_MODEL_ID": "probe/model",
                },
                clear=False,
            ),
            patch(
                "integrations.harbor.nklein_harbor_agent.asyncio.create_subprocess_exec",
                return_value=process,
            ),
        ):
            await agent.run("Probe the boundary.", environment, context)  # type: ignore[arg-type]

    if environment.calls != [
        {"command": "printf probe", "cwd": "/root", "timeout_sec": 12}
    ]:
        raise RuntimeError(
            f"Harbor exec request was not preserved: {environment.calls!r}"
        )
    responses = [
        message
        for message in process.stdin.messages
        if message.get("type") == "response"
    ]
    if (
        len(responses) != 1
        or len(str(responses[0]["result"]["stdout"])) > MAX_STREAM_CHARS + 256
    ):  # type: ignore[index]
        raise RuntimeError(
            "Harbor exec result was not returned through the bounded protocol"
        )
    if (
        context.metadata is None
        or context.metadata.get("session_id") != "probe-session"
    ):
        raise RuntimeError(
            "Harbor AgentContext did not receive !Klein completion metadata"
        )
    return {
        "harborVersion": PINNED_HARBOR_VERSION,
        "agentImportPath": NKleinHarborAgent.import_path(),
        "execInOwnedContainer": True,
        "mutableRootFilesystem": True,
        "boundedExecResults": True,
        "preserveContainerAcrossTurns": True,
        "harborOwnsVerification": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    if Path.cwd().resolve() != repo:
        os.chdir(repo)
    print(json.dumps(asyncio.run(_probe(repo)), sort_keys=True))


if __name__ == "__main__":
    main()
