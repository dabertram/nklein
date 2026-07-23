#!/usr/bin/env python3
"""Generate LiveCodeBench answers through a local OpenAI-compatible endpoint.

Prompt construction and code extraction come from the revision-pinned official
LiveCodeBench checkout. The official custom_evaluator remains the grader.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

PINNED_COMMIT = "28fef95ea8c9f7a547c8329f2cd3d32b92c1fa24"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--harness", required=True)
    parser.add_argument("--api-base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--release-version", default="release_v6")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--max-tokens", type=int, default=4096)
    parser.add_argument("--request-timeout", type=int, default=300)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def assert_local_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("--api-base-url must be an http(s) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("--api-base-url cannot contain credentials, a query, or a fragment")
    host = parsed.hostname.lower()
    local = host == "localhost" or host.endswith(".local") or "." not in host
    try:
        address = ipaddress.ip_address(host)
        local = address.is_private or address.is_loopback or address.is_link_local
    except ValueError:
        pass
    if not local:
        raise ValueError("--api-base-url must address a local/private model endpoint")
    return value.rstrip("/")


def assert_pinned_harness(path: Path) -> None:
    if not path.is_dir():
        raise ValueError(f"LiveCodeBench harness does not exist: {path}")
    head = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    ).stdout.strip()
    if head != PINNED_COMMIT:
        raise ValueError(f"LiveCodeBench harness must be pinned at {PINNED_COMMIT}; found {head}")
    dirty = subprocess.run(
        ["git", "-C", str(path), "status", "--porcelain"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    ).stdout.strip()
    if dirty:
        raise ValueError("LiveCodeBench harness checkout must be clean")


def completions_url(base_url: str) -> str:
    if base_url.endswith("/v1"):
        return f"{base_url}/chat/completions"
    return f"{base_url}/v1/chat/completions"


def generate(endpoint: str, model: str, messages: list[dict[str, str]], max_tokens: int, timeout: int) -> str:
    payload = json.dumps(
        {
            "model": model,
            "messages": messages,
            "temperature": 0,
            "max_tokens": max_tokens,
            "n": 1,
            "stream": False,
        }
    ).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("NKLEIN_LOCAL_MODEL_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = Request(endpoint, data=payload, headers=headers, method="POST")
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
            content = result["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise ValueError("local model response content is not text")
            return content
        except (HTTPError, URLError, TimeoutError, socket.timeout, KeyError, IndexError, json.JSONDecodeError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(2**attempt)
    raise RuntimeError(f"local model request failed after 3 attempts: {last_error}")


def publish_create_only(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise FileExistsError(f"refusing to replace immutable LiveCodeBench generations: {path}")
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def main() -> None:
    args = arguments()
    if args.max_tokens < 1 or args.request_timeout < 1:
        raise ValueError("token and timeout limits must be positive")
    harness = Path(args.harness).resolve()
    output = Path(args.output).resolve()
    assert_pinned_harness(harness)
    endpoint = completions_url(assert_local_url(args.api_base_url))

    # Dataset acquisition is a separate explicit egress step. A benchmark run is
    # networkless except for the selected local model endpoint.
    os.environ["HF_DATASETS_OFFLINE"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    sys.path.insert(0, str(harness))
    os.chdir(harness)

    from lcb_runner.benchmarks import load_code_generation_dataset
    from lcb_runner.lm_styles import LMStyle
    from lcb_runner.prompts import format_prompt_generation
    from lcb_runner.utils.extraction_utils import extract_code

    benchmark = sorted(
        load_code_generation_dataset(args.release_version, start_date=args.start_date, end_date=args.end_date),
        key=lambda problem: problem.question_id,
    )
    if not benchmark:
        raise ValueError("selected LiveCodeBench window contains no problems")

    generations: list[dict[str, object]] = []
    for index, problem in enumerate(benchmark, start=1):
        messages = format_prompt_generation(problem, LMStyle.OpenAIChat)
        if not isinstance(messages, list):
            raise TypeError("official OpenAIChat formatter did not return chat messages")
        raw = generate(endpoint, args.model, messages, args.max_tokens, args.request_timeout)
        generations.append(
            {
                "question_id": problem.question_id,
                "code_list": [extract_code(raw, LMStyle.OpenAIChat)],
                "output_list": [raw],
                "prompt_sha256": hashlib.sha256(
                    json.dumps(messages, sort_keys=True, separators=(",", ":")).encode("utf-8")
                ).hexdigest(),
            }
        )
        print(f"[{index}/{len(benchmark)}] {problem.question_id}", flush=True)

    publish_create_only(output, generations)


if __name__ == "__main__":
    main()
