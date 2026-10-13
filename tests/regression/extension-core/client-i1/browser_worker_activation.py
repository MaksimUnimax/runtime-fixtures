"""Exact-identity helpers for the isolated Chromium MV3 worker verifier.

This module performs no browser action. The verifier creates its own temporary
profile and loads one unpacked extension via the existing CDP fixture route.
"""

import json
import re
from pathlib import Path

_CHROME_ID = re.compile(r"[a-p]{32}\Z")


def require_loaded_extension_id(response):
    if not isinstance(response, dict):
        raise RuntimeError("CDP loadUnpacked response is not an object")
    extension_id = response.get("id")
    if not isinstance(extension_id, str) or _CHROME_ID.fullmatch(extension_id) is None:
        raise RuntimeError("CDP did not return a valid extension ID")
    return extension_id


def require_manifest_worker_entry(runtime):
    root = Path(runtime)
    manifest = root / "manifest.json"
    if not root.is_dir() or not manifest.is_file():
        raise RuntimeError("Runtime manifest is missing")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    background = data.get("background")
    entry = background.get("service_worker") if isinstance(background, dict) else None
    if not isinstance(entry, str) or not entry.endswith(".js") or "\\" in entry:
        raise RuntimeError("Invalid extension service worker path")
    parts = entry.split("/")
    if any(part in ("", ".", "..") for part in parts) or entry.startswith("/"):
        raise RuntimeError("Unsafe extension service worker path")
    if not (root / entry).is_file():
        raise RuntimeError("Manifest service worker is missing")
    return entry


def select_owned_worker(workers, extension_id, entry):
    """Return only the service worker for the freshly loaded CDP extension."""
    extension_id = require_loaded_extension_id({"id": extension_id})
    if not isinstance(entry, str) or not entry:
        raise RuntimeError("Missing expected worker entry")
    exact = f"chrome-extension://{extension_id}/{entry}"
    matching = [worker for worker in workers if getattr(worker, "url", None) == exact]
    if len(matching) > 1:
        raise RuntimeError("Ambiguous duplicate extension service workers")
    return matching[0] if matching else None
