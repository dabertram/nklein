"""Entry point: run the !Klein core sidecar (local-only)."""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="klein-core", description="!Klein local-only Python core sidecar")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (must be local).")
    parser.add_argument("--port", type=int, default=3585, help="Bind port.")
    args = parser.parse_args()

    if args.host not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit(f"Refusing to bind non-local host {args.host!r}; the core is local-only.")

    import uvicorn

    uvicorn.run("klein_core.app:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
