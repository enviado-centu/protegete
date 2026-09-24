"""URL parsing helpers shared by the rules engine, the analyzer and the API layer."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass

import tldextract
from urllib.parse import urlparse

_extractor = tldextract.TLDExtract(suffix_list_urls=())


@dataclass(frozen=True)
class UrlInfo:
    """Parsed pieces of a URL relevant to rules and request validation."""

    original: str
    had_scheme: bool
    scheme: str
    host: str
    domain_label: str
    registrable_domain: str
    subdomain: str
    is_ip: bool


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def parse_url(url: str) -> UrlInfo:
    """Parses a URL, tolerating input without an explicit scheme (e.g. "example.com")."""
    stripped = url.strip()
    had_scheme = "://" in stripped
    parsed = urlparse(stripped if had_scheme else f"http://{stripped}")
    host = (parsed.hostname or "").lower()
    ext = _extractor(host)
    registrable_domain = f"{ext.domain}.{ext.suffix}" if ext.suffix else ext.domain
    return UrlInfo(
        original=url,
        had_scheme=had_scheme,
        scheme=(parsed.scheme or "").lower(),
        host=host,
        domain_label=ext.domain,
        registrable_domain=registrable_domain,
        subdomain=ext.subdomain,
        is_ip=_is_ip(host),
    )


def has_plausible_host(url: str) -> bool:
    """True if the URL looks like it has an addressable host (domain or IP)."""
    info = parse_url(url)
    if not info.host:
        return False
    if info.is_ip:
        return True
    return "." in info.host or info.host == "localhost"
