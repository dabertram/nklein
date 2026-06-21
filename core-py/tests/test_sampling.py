from __future__ import annotations

from klein_core.sampling import SamplingOptions, resolve_sampling, sampling_to_body


def test_coding_baseline_is_deterministic() -> None:
    sampling = resolve_sampling(role="worker")
    assert sampling.temperature is not None and sampling.temperature <= 0.2
    assert sampling.min_p == 0.05
    assert sampling.repetition_penalty is not None and sampling.repetition_penalty >= 1.05


def test_planning_more_exploratory_than_worker() -> None:
    assert (resolve_sampling(role="planner").temperature or 0) > (resolve_sampling(role="worker").temperature or 0)


def test_small_model_tightens_temperature_and_penalty() -> None:
    small = resolve_sampling(role="worker", model_id="qwen2.5-coder-7b")
    generic = resolve_sampling(role="worker", model_id="big-model")
    assert (small.temperature or 1) <= (generic.temperature or 1)
    assert (small.repetition_penalty or 1) >= (generic.repetition_penalty or 1)


def test_override_wins() -> None:
    sampling = resolve_sampling(role="worker", model_id="qwen", override=SamplingOptions(temperature=0.9))
    assert sampling.temperature == 0.9
    assert sampling.min_p == 0.05  # untouched baseline preserved


def test_sampling_to_body_maps_snake_case() -> None:
    body = sampling_to_body(
        SamplingOptions(temperature=0.1, top_p=0.9, top_k=40, min_p=0.05, repetition_penalty=1.1, max_tokens=128, stop=("</s>",))
    )
    assert body == {
        "temperature": 0.1,
        "top_p": 0.9,
        "top_k": 40,
        "min_p": 0.05,
        "repeat_penalty": 1.1,
        "max_tokens": 128,
        "stop": ["</s>"],
    }
