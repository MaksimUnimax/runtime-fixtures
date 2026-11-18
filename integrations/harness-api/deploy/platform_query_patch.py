#!/usr/bin/env python3
"""Create a guarded Alisa QueryService overlay; never edit the source in place.

Harness keeps genuine WEB Query receipts for parameter_report_rpc authority.
Those receipts belong to its separate runtime, so native QueryService routes
must not list, recover, read, clarify, or cancel them. The existing owner and
expiry checks remain in their original order and the native NOT_FOUND error
keeps the API boundary unchanged. No schema, principal, or RPC proof changes.

Usage:
  python3 platform_query_patch.py --source ORIGINAL_SERVICE_PY
  python3 platform_query_patch.py --source ORIGINAL_SERVICE_PY --output NEW_SERVICE_PY

The source hash is pinned to the audited production release. Output is a new
file and must not exist. Install it into a separate release copy, then run the
normal release activation procedure. This script does not activate a release.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path

SOURCE_RELEASE = "alisa-demand-platform-13f01118c7402814"
SOURCE_RELATIVE_PATH = "services/platform/src/alisa_platform/queries/service.py"
SOURCE_SHA256 = "a3c8e2ffab12aedc83d645979a839bce9fd73cc799d77df7fb3541242d754a20"
HARNESS_MARKER = "harness_runtime_v1"

_PATCHES = (
    (
        "    need(row.expires_at > timezone.now(), 'RESULT_EXPIRED')\n"
        "    return row\n",
        "    need(row.expires_at > timezone.now(), 'RESULT_EXPIRED')\n"
        "    # Harness receipts belong to a separate runtime, never the native dispatcher.\n"
        "    need('harness_runtime_v1' not in row.continuation, 'NOT_FOUND')\n"
        "    return row\n",
    ),
    (
        "    rows = Query.objects.filter(customer_id=customer, tenant_id=tenant,\n"
        "                                expires_at__gt=timezone.now()).order_by('-created_at')[:50]\n",
        "    rows = Query.objects.filter(customer_id=customer, tenant_id=tenant,\n"
        "                                expires_at__gt=timezone.now())\n"
        "    rows = rows.exclude(continuation__has_key='harness_runtime_v1').order_by('-created_at')[:50]\n",
    ),
)


class SourceMismatch(ValueError):
    """A different release requires a new review rather than a fuzzy patch."""


def patch_source(source: bytes) -> bytes:
    digest = hashlib.sha256(source).hexdigest()
    if digest != SOURCE_SHA256:
        raise SourceMismatch(f"Expected source SHA256 {SOURCE_SHA256}; got {digest}")
    value = source.decode("utf-8")
    for original, replacement in _PATCHES:
        if value.count(original) != 1:
            raise SourceMismatch("Audited patch anchor is missing or ambiguous")
        value = value.replace(original, replacement, 1)
    ast.parse(value, filename=SOURCE_RELATIVE_PATH)
    return value.encode("utf-8")


def write_overlay(source_path: Path, output_path: Path) -> dict:
    source_path = source_path.resolve(strict=True)
    if source_path == output_path.resolve():
        raise ValueError("In-place updates are forbidden; choose a new overlay output file")
    patched = patch_source(source_path.read_bytes())
    # Exclusive create also refuses symlinks and existing hardlinks. A release
    # clone may use hardlinks; never truncate one and modify the original inode.
    with output_path.open("xb") as stream:
        stream.write(patched)
        stream.flush()
        os.fsync(stream.fileno())
        os.fchmod(stream.fileno(), source_path.stat().st_mode & 0o777)
    return {
        "source_sha256": SOURCE_SHA256,
        "output_sha256": hashlib.sha256(patched).hexdigest(),
        "output": str(output_path.resolve()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", type=Path, help="New file only; omission validates without writing")
    args = parser.parse_args()
    try:
        if args.output is not None:
            result = write_overlay(args.source, args.output)
        else:
            patched = patch_source(args.source.read_bytes())
            result = {
                "source_sha256": SOURCE_SHA256,
                "output_sha256": hashlib.sha256(patched).hexdigest(),
                "mode": "check",
            }
    except (OSError, UnicodeError, ValueError, SyntaxError) as error:
        parser.exit(1, f"QueryService overlay refused: {error}\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
