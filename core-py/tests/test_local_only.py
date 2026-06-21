from __future__ import annotations

import pytest

from klein_core.local_only import CloudProviderDisabledError, assert_local_base_url, is_local_base_url


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:1234/v1",
        "http://localhost:11434",
        "http://192.168.1.50:8080/v1",
        "http://10.0.0.2:5000",
        "http://my-box.local:1234",
    ],
)
def test_local_urls_allowed(url: str) -> None:
    assert is_local_base_url(url) is True
    assert_local_base_url(url)  # does not raise


@pytest.mark.parametrize(
    "url",
    ["https://api.openai.com/v1", "https://example.com", "http://8.8.8.8", "", None],
)
def test_non_local_urls_rejected(url: str | None) -> None:
    assert is_local_base_url(url) is False
    with pytest.raises(CloudProviderDisabledError):
        assert_local_base_url(url)
