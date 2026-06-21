"""Sampling normalization for the !Klein Python core.

Mirrors the TypeScript ``LocalLlmSamplingOptions`` and ``cline-sampling-policy.ts``. Small/quantized models
run far more reliably with deterministic, loop-resistant sampling: low temperature, ``min_p`` to keep the
distribution coherent (arXiv:2407.01082), and a light ``repetition_penalty`` to suppress degenerate loops.

Pure and dependency-free so it can be unit-tested without FastAPI/pydantic installed.
"""

from __future__ import annotations

from dataclasses import dataclass

SMALL_LOCAL_MODEL_MARKERS = (
    "qwen",
    "llama",
    "mistral",
    "mixtral",
    "phi",
    "gemma",
    "deepseek-coder",
    "codellama",
)


def is_small_local_model_id(model_id: str | None) -> bool:
    if not model_id:
        return False
    lowered = model_id.strip().lower()
    return any(marker in lowered for marker in SMALL_LOCAL_MODEL_MARKERS)


@dataclass
class SamplingOptions:
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    min_p: float | None = None
    repetition_penalty: float | None = None
    max_tokens: int | None = None
    stop: tuple[str, ...] | None = None


# Role baselines mirror cline-sampling-policy.ts.
_CODING = SamplingOptions(temperature=0.15, top_p=0.95, min_p=0.05, repetition_penalty=1.05)
_PLANNING = SamplingOptions(temperature=0.3, top_p=0.95, min_p=0.05, repetition_penalty=1.05)
_STRUCTURED = SamplingOptions(temperature=0.1, top_p=0.9, min_p=0.05, repetition_penalty=1.05)


def _baseline_for_role(role: str) -> SamplingOptions:
    if role in ("architect", "planner"):
        return SamplingOptions(**_PLANNING.__dict__)
    if role == "structured":
        return SamplingOptions(**_STRUCTURED.__dict__)
    return SamplingOptions(**_CODING.__dict__)


def resolve_sampling(
    role: str = "unknown",
    model_id: str | None = None,
    override: SamplingOptions | None = None,
) -> SamplingOptions:
    """Resolve a sampling baseline for a role/model, applying caller overrides last."""
    baseline = _baseline_for_role(role)
    if is_small_local_model_id(model_id):
        cap = 0.25 if role in ("architect", "planner") else 0.12
        baseline.temperature = min(baseline.temperature or 0.15, cap)
        baseline.repetition_penalty = max(baseline.repetition_penalty or 1.05, 1.08)
    if override is not None:
        for field, value in override.__dict__.items():
            if value is not None:
                setattr(baseline, field, value)
    return baseline


def sampling_to_body(sampling: SamplingOptions) -> dict[str, object]:
    """Map normalized sampling to OpenAI/llama.cpp request-body fields (snake_case)."""
    body: dict[str, object] = {}
    if sampling.temperature is not None:
        body["temperature"] = sampling.temperature
    if sampling.top_p is not None:
        body["top_p"] = sampling.top_p
    if sampling.top_k is not None:
        body["top_k"] = sampling.top_k
    if sampling.min_p is not None:
        body["min_p"] = sampling.min_p
    if sampling.repetition_penalty is not None:
        body["repeat_penalty"] = sampling.repetition_penalty
    if sampling.max_tokens is not None:
        body["max_tokens"] = sampling.max_tokens
    if sampling.stop:
        body["stop"] = list(sampling.stop)
    return body
