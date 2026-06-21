"""Local-only network policy for the !Klein Python core.

Mirrors the TypeScript ``assertLocalProviderAllowed`` / ``isLocalBaseUrl`` guard
(``src/cline-sdk/cline-local-only-policy.ts``). The Python core must never reach a cloud endpoint: every
generation backend funnels through :func:`assert_local_base_url`. Re-enabling cloud is a deliberate code
change here, never a setting.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlparse

CLOUD_ENABLED = False

_LOCAL_HOSTNAMES = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


class CloudProviderDisabledError(RuntimeError):
    """Raised when a non-local endpoint is used while cloud is disabled."""


def _is_private_ip(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    # RFC-1918 / loopback / link-local / unique-local / CGNAT.
    if ip.is_loopback or ip.is_private or ip.is_link_local:
        return True
    if isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"):
        return True
    return False


def is_local_base_url(base_url: str | None) -> bool:
    """True when ``base_url`` points at the local machine / private network."""
    if not base_url or not base_url.strip():
        return False
    parsed = urlparse(base_url.strip())
    host = parsed.hostname
    if not host:
        return False
    host = host.lower()
    if host in _LOCAL_HOSTNAMES or host.endswith(".local"):
        return True
    return _is_private_ip(host)


def assert_local_base_url(base_url: str | None) -> None:
    """Raise :class:`CloudProviderDisabledError` unless ``base_url`` is local (and cloud stays disabled)."""
    if CLOUD_ENABLED:
        return
    if is_local_base_url(base_url):
        return
    raise CloudProviderDisabledError(f"Non-local endpoint is disabled: {base_url!r}")
