"""Workspace-scoped tools for the !Klein native Python agent core.

A minimal, safe toolset bound to a workspace root (path containment enforced): ``read_file``, ``write_file``,
``edit_file`` (the aider-style fuzzy editor), and ``list_files``. The agent loop is tool-agnostic; this is the
default toolset for the Python core. Filesystem only — no shell — so it is safe to run in tests.
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .fuzzy_edit import apply_blocks

_MAX_COMMAND_OUTPUT_CHARS = 4000


def _tail(text: str) -> str:
    return text if len(text) <= _MAX_COMMAND_OUTPUT_CHARS else f"...[truncated]\n{text[-_MAX_COMMAND_OUTPUT_CHARS:]}"


@dataclass
class AgentTool:
    name: str
    description: str
    run: Callable[[dict[str, Any]], Awaitable[Any]] | Callable[[dict[str, Any]], Any]


class WorkspaceTools:
    """Builds the default toolset rooted at ``workspace_root`` with path containment.

    ``allow_commands`` enables a ``run_command`` tool (build/test execution) needed for a real
    implement->build->test loop. It runs host-side in the workspace, so it is opt-in; under !Klein's isolation
    invariant this must move into the Docker sandbox tool-runner before production use (tracked in plan.md).
    """

    def __init__(
        self,
        workspace_root: str,
        max_file_bytes: int = 2_000_000,
        allow_commands: bool = False,
        command_timeout_s: float = 600.0,
    ) -> None:
        self._root = Path(workspace_root).resolve()
        self._max_file_bytes = max_file_bytes
        self._allow_commands = allow_commands
        self._command_timeout_s = command_timeout_s

    def _resolve(self, rel_path: str) -> Path:
        candidate = (self._root / rel_path).resolve()
        if candidate != self._root and self._root not in candidate.parents:
            raise ValueError(f"path {rel_path!r} escapes the workspace root")
        return candidate

    def read_file(self, args: dict[str, Any]) -> Any:
        path = self._resolve(str(args.get("path", "")))
        data = path.read_text("utf-8")
        if len(data.encode("utf-8")) > self._max_file_bytes:
            return {"error": "file too large; request a line range"}
        return {"path": str(path.relative_to(self._root)), "content": data}

    def write_file(self, args: dict[str, Any]) -> Any:
        path = self._resolve(str(args.get("path", "")))
        content = str(args.get("content", ""))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, "utf-8")
        return {"path": str(path.relative_to(self._root)), "written": True}

    def edit_file(self, args: dict[str, Any]) -> Any:
        path = self._resolve(str(args.get("path", "")))
        edits = args.get("edits") or [args]
        blocks: list[tuple[str, str]] = []
        for edit in edits:
            search = edit.get("search", edit.get("old_string"))
            replace = edit.get("replace", edit.get("new_string"))
            if search is None or replace is None:
                return {"error": "each edit needs search and replace"}
            blocks.append((str(search), str(replace)))
        try:
            original = path.read_text("utf-8")
        except OSError:
            return {"error": f"{args.get('path')} could not be read; use write_file to create it"}
        result = apply_blocks(original, blocks)
        if not result.ok or result.content is None:
            return {"error": result.reason, "best_similarity": result.best_similarity}
        if result.content == original:
            return {"changed": False}
        path.write_text(result.content, "utf-8")
        return {"changed": True, "strategy": result.strategy}

    def list_files(self, args: dict[str, Any]) -> Any:
        base = self._resolve(str(args.get("path", ".")))
        out: list[str] = []
        for root, _dirs, files in os.walk(base):
            for name in files:
                rel = os.path.relpath(os.path.join(root, name), self._root)
                out.append(rel)
                if len(out) >= 500:
                    return {"files": sorted(out), "truncated": True}
        return {"files": sorted(out), "truncated": False}

    def run_command(self, args: dict[str, Any]) -> Any:
        import subprocess  # noqa: S404 - controlled build/test execution in the throwaway benchmark workspace

        command = str(args.get("command", "")).strip()
        if not command:
            return {"error": "command is required"}
        try:
            proc = subprocess.run(  # noqa: S602 - shell needed for build/test pipelines; workspace-scoped, opt-in
                command,
                shell=True,
                cwd=str(self._root),
                capture_output=True,
                text=True,
                timeout=self._command_timeout_s,
            )
        except subprocess.TimeoutExpired:
            return {"error": f"command timed out after {self._command_timeout_s}s", "command": command}
        return {
            "command": command,
            "exit_code": proc.returncode,
            "stdout": _tail(proc.stdout),
            "stderr": _tail(proc.stderr),
        }

    def build(self) -> list[AgentTool]:
        tools = [
            AgentTool("read_file", "Read a workspace file: {path}.", self.read_file),
            AgentTool("write_file", "Create/replace a file: {path, content}.", self.write_file),
            AgentTool(
                "edit_file",
                "Edit a file with search/replace blocks: {path, edits:[{search,replace}]}. Lenient matching.",
                self.edit_file,
            ),
            AgentTool("list_files", "List workspace files: {path?}.", self.list_files),
        ]
        if self._allow_commands:
            tools.append(
                AgentTool(
                    "run_command",
                    "Run a shell command in the workspace (build/test): {command}. Returns exit_code/stdout/stderr.",
                    self.run_command,
                )
            )
        return tools
