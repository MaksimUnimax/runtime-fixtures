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
    """Check the entire unpacked runtime before a browser can load its bytes.

    Root, manifest, worker and all nested files must be ordinary in-tree
    entries. A symlink to an outside file can otherwise escape manifest
    validation before Extensions.loadUnpacked executes.
    """
    root = Path(runtime)
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise RuntimeError("Unsafe unpacked runtime root")
    canonical = root.resolve(strict=True)
    if canonical != root:
        raise RuntimeError("Noncanonical unpacked runtime root")
    for path in root.rglob("*"):
        if path.is_symlink():
            raise RuntimeError("Unpacked runtime contains a symlink")
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(canonical):
            raise RuntimeError("Unpacked runtime path escapes root")
        if not path.is_file() and not path.is_dir():
            raise RuntimeError("Unpacked runtime contains a special file")
    manifest = root / "manifest.json"
    if not manifest.is_file() or manifest.is_symlink():
        raise RuntimeError("Runtime manifest is missing or unsafe")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    background = data.get("background")
    entry = background.get("service_worker") if isinstance(background, dict) else None
    if not isinstance(entry, str) or not entry.endswith(".js") or "\\" in entry:
        raise RuntimeError("Invalid extension service worker path")
    parts = entry.split("/")
    if any(part in ("", ".", "..") for part in parts) or entry.startswith("/"):
        raise RuntimeError("Unsafe extension service worker path")
    worker = root / entry
    if not worker.is_file() or worker.is_symlink():
        raise RuntimeError("Manifest service worker is missing or unsafe")
    if not worker.resolve(strict=True).is_relative_to(canonical):
        raise RuntimeError("Manifest service worker escapes runtime root")
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
