"""Tests for the URLhaus malware feed loader (Feature B)."""

from __future__ import annotations

from pathlib import Path

from app.services import feeds


def _write_feed(tmp_path: Path, content: str) -> Path:
    feed_path = tmp_path / "urlhaus.txt"
    feed_path.write_text(content, encoding="utf-8")
    return feed_path


def test_exact_url_match(tmp_path, monkeypatch) -> None:
    feed_path = _write_feed(
        tmp_path,
        "# URLhaus feed\n\nhttp://evil.example.com/payload.exe\n",
    )
    monkeypatch.setattr(feeds, "_feed_path", lambda: feed_path)
    feeds.reload()

    assert feeds.is_urlhaus_match("http://evil.example.com/payload.exe") is True


def test_host_only_match_for_a_different_path_on_the_same_host(tmp_path, monkeypatch) -> None:
    feed_path = _write_feed(tmp_path, "http://evil.example.com/payload.exe\n")
    monkeypatch.setattr(feeds, "_feed_path", lambda: feed_path)
    feeds.reload()

    assert feeds.is_urlhaus_match("http://evil.example.com/other-page") is True


def test_ip_port_entry_host_is_stripped_correctly(tmp_path, monkeypatch) -> None:
    feed_path = _write_feed(tmp_path, "http://203.0.113.5:8080/bad.exe\n")
    monkeypatch.setattr(feeds, "_feed_path", lambda: feed_path)
    feeds.reload()

    assert feeds.is_urlhaus_match("http://203.0.113.5/other") is True
    assert feeds.is_urlhaus_match("http://203.0.113.5:8080/bad.exe") is True


def test_comments_and_blank_lines_are_skipped(tmp_path, monkeypatch) -> None:
    feed_path = _write_feed(
        tmp_path,
        "# comment line\n\n   \nhttp://malware.example.net/x\n# trailing comment\n",
    )
    monkeypatch.setattr(feeds, "_feed_path", lambda: feed_path)
    feeds.reload()

    assert feeds.is_urlhaus_match("http://malware.example.net/x") is True
    assert feeds.is_urlhaus_match("http://comment/line") is False


def test_unrelated_url_does_not_match(tmp_path, monkeypatch) -> None:
    feed_path = _write_feed(tmp_path, "http://evil.example.com/payload.exe\n")
    monkeypatch.setattr(feeds, "_feed_path", lambda: feed_path)
    feeds.reload()

    assert feeds.is_urlhaus_match("https://example.com") is False


def test_missing_feed_file_never_raises_and_yields_no_match(tmp_path, monkeypatch) -> None:
    missing_path = tmp_path / "definitely_does_not_exist.txt"
    assert not missing_path.exists()
    monkeypatch.setattr(feeds, "_feed_path", lambda: missing_path)
    feeds.reload()

    assert feeds.is_urlhaus_match("http://anything.example.com") is False
