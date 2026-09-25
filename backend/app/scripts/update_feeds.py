"""Manual/cron script: refreshes the URLhaus malware-URL feed on disk.

Downloads the recent-URLs text feed from URLhaus (abuse.ch), writes it
atomically to `backend/data/urlhaus.txt` (via a temp file + os.replace), then
forces `app.services.feeds` to reload it. Unlike `feeds.py`'s lazy loader
(which must never crash the request path), this script fails loudly on any
network error -- it's meant to be run manually or from a cron job, e.g.:

    uv run python -m app.scripts.update_feeds
"""

from __future__ import annotations

import os
import tempfile

import httpx

from app.config import get_urlhaus_feed_path
from app.services import feeds

URLHAUS_FEED_URL = "https://urlhaus.abuse.ch/downloads/text_recent/"
REQUEST_TIMEOUT_S = 30


def update_feeds() -> tuple[int, int]:
    """Downloads the feed, atomically writes it, reloads the cache.

    Returns (n_urls, n_hosts) from the freshly reloaded feed.
    """
    dest_path = get_urlhaus_feed_path()
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    response = httpx.get(URLHAUS_FEED_URL, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()

    tmp_file = tempfile.NamedTemporaryFile(dir=str(dest_path.parent), delete=False)
    tmp_path = tmp_file.name
    try:
        tmp_file.write(response.content)
        tmp_file.close()
        os.replace(tmp_path, dest_path)
    except BaseException:
        tmp_file.close()
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise

    feeds.reload()
    return feeds.feed_stats()


def main() -> None:
    n_urls, n_hosts = update_feeds()
    print(f"URLhaus feed updated: {n_urls} URLs, {n_hosts} unique hosts")


if __name__ == "__main__":
    main()
