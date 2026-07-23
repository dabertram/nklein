"""Harbor 0.5 external agent adapter for !Klein's native session runtime."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

MAX_STREAM_CHARS = 96_000


def _bounded(value: str | None) -> str:
    text = value or ""
    if len(text) <= MAX_STREAM_CHARS:
        return text
    half = MAX_STREAM_CHARS // 2
    dropped = len(text) - MAX_STREAM_CHARS
    return f"{text[:half]}\n... [{dropped} characters omitted by !Klein Harbor bridge] ...\n{text[-half:]}"


class NKleinHarborAgent(BaseAgent):
    @staticmethod
    def name() -> str:
        return "nklein"

    def version(self) -> str | None:
        return "0.1.0"

    async def setup(self, environment: BaseEnvironment) -> None:
        if not callable(getattr(environment, "exec", None)):
            raise RuntimeError(
                "Harbor environment does not expose its required exec boundary"
            )

    async def _drain_stderr(self, stream: asyncio.StreamReader) -> None:
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        log_path = self.logs_dir / "nklein-agent.log"
        with log_path.open("a", encoding="utf-8") as handle:
            while line := await stream.readline():
                text = line.decode("utf-8", errors="replace")
                handle.write(text)
                handle.flush()

    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        repo = Path(__file__).resolve().parents[2]
        runner = repo / "scripts" / "run-terminal-bench-agent.mts"
        tsx = repo / "node_modules" / ".bin" / "tsx"
        if not runner.is_file() or not tsx.is_file():
            raise RuntimeError(
                "!Klein Terminal-Bench runner or built workspace dependencies are missing"
            )
        base_url = os.environ.get("NKLEIN_TERMINAL_MODEL_BASE_URL", "").strip()
        model_id = (
            os.environ.get("NKLEIN_TERMINAL_MODEL_ID", "").strip()
            or (self.model_name or "").strip()
        )
        if not base_url or not model_id:
            raise RuntimeError(
                "NKLEIN_TERMINAL_MODEL_BASE_URL and NKLEIN_TERMINAL_MODEL_ID are required"
            )
        context_window = int(os.environ.get("NKLEIN_TERMINAL_CONTEXT_WINDOW", "32768"))
        max_tokens = int(os.environ.get("NKLEIN_TERMINAL_MAX_TOKENS", "4096"))
        config = {
            "taskId": f"terminal-bench-{environment.session_id}",
            "instruction": instruction,
            "providerId": os.environ.get("NKLEIN_TERMINAL_PROVIDER_ID", "lmstudio"),
            "modelId": model_id,
            "baseUrl": base_url,
            "contextWindow": context_window,
            "maxTokensPerTurn": max_tokens,
            "workingDirectory": os.environ.get("NKLEIN_TERMINAL_WORKDIR", "/root"),
        }
        process = await asyncio.create_subprocess_exec(
            str(tsx),
            str(runner),
            cwd=repo,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "NKLEIN_NO_AUTO_UPDATE": "1"},
        )
        if process.stdin is None or process.stdout is None or process.stderr is None:
            raise RuntimeError("failed to create !Klein bridge pipes")
        stderr_task = asyncio.create_task(self._drain_stderr(process.stderr))
        process.stdin.write((json.dumps(config) + "\n").encode("utf-8"))
        await process.stdin.drain()
        tool_calls = 0
        completion: dict[str, object] | None = None
        try:
            while line := await process.stdout.readline():
                message = json.loads(line.decode("utf-8"))
                message_type = message.get("type")
                if message_type == "exec":
                    tool_calls += 1
                    request = message.get("request") or {}
                    response: dict[str, object] = {
                        "type": "response",
                        "id": message.get("id"),
                    }
                    try:
                        result = await environment.exec(
                            command=str(request["command"]),
                            cwd=str(request["cwd"]),
                            timeout_sec=int(request["timeoutSeconds"]),
                        )
                        response["result"] = {
                            "returnCode": result.return_code,
                            "stdout": _bounded(result.stdout),
                            "stderr": _bounded(result.stderr),
                        }
                    except Exception as error:
                        response["error"] = f"Harbor environment exec failed: {error}"
                    process.stdin.write((json.dumps(response) + "\n").encode("utf-8"))
                    await process.stdin.drain()
                elif message_type == "complete":
                    completion = message.get("result") or {}
                    break
                elif message_type == "error":
                    raise RuntimeError(
                        str(message.get("error") or "!Klein runner failed")
                    )
                else:
                    raise RuntimeError(
                        "!Klein runner emitted an unknown protocol message"
                    )
            return_code = await process.wait()
            if return_code != 0:
                raise RuntimeError(f"!Klein runner exited with code {return_code}")
            if completion is None:
                raise RuntimeError("!Klein runner exited without a completion envelope")
            context.metadata = {
                "bridge_schema": 1,
                "tool_calls": tool_calls,
                "session_id": completion.get("sessionId"),
                "submitted_summary": completion.get("submittedSummary"),
                "warnings": completion.get("warnings") or [],
            }
        finally:
            if process.returncode is None:
                process.terminate()
                await process.wait()
            await stderr_task
