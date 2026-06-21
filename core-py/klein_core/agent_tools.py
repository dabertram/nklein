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


@dataclass
class AgentTool:
    name: str
    description: str
    run: Callable[[dict[str, Any]], Awaitable[Any]] | Callable[[dict[str, Any]], Any]


class WorkspaceTools:
    """Builds the default toolset rooted at ``workspace_root`` with path containment."""

    def __init__(self, workspace_root: str, max_file_bytes: int = 2_000_000) -> None:
        self._root = Path(workspace_root).resolve()
        self._max_file_bytes = max_file_bytes

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

    def build(self) -> list[AgentTool]:
        return [
            AgentTool("read_file", "Read a workspace file: {path}.", self.read_file),
            AgentTool("write_file", "Create/replace a file: {path, content}.", self.write_file),
            AgentTool(
                "edit_file",
                "Edit a file with search/replace blocks: {path, edits:[{search,replace}]}. Lenient matching.",
                self.edit_file,
            ),
            AgentTool("list_files", "List workspace files: {path?}.", self.list_files),
        ]
