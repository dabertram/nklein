"""!Klein Python core — local-only ML + native-agent sidecar.

See ``core-py/README.md`` and the migration plan. The pure helpers (``local_only``, ``sampling``,
``generation`` body builder, ``structured`` recovery) import without FastAPI/pydantic/httpx; the FastAPI app
(``app``) and pydantic ``contract`` require the installed dependencies.
"""

from __future__ import annotations

CONTRACT_VERSION = 1

__all__ = ["CONTRACT_VERSION"]
