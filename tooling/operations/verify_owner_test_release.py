#!/usr/bin/env python3
"""Read-only final integrity gate for a four-service owner-test release.

This is an additive verifier, NOT a build or deployment command. The caller
must independently approve the exact Git source commit/tree pair. Existing
Telegram-only and legacy releases remain under verify_ops_release.py.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import sys
from pathlib import Path

from verify_ops_release import ReleaseVerificationError, verify_release


class OwnerTestReleaseError(ReleaseVerificationError):
    """A fully checksum-valid archive can still omit required runtime parts."""


SERVICE_ENTRIES = {
    "api": ("apps/api/dist/main.js", "."),
    "worker": ("apps/worker/dist/main.js", "."),
    "portal": ("apps/portal/node_modules/next/dist/bin/next", "apps/portal"),
    "admin": ("apps/admin/node_modules/next/dist/bin/next", "apps/admin"),
}
NEXT_BUILD_IDS = {
    "portal": "apps/portal/.next/BUILD_ID",
    "admin": "apps/admin/.next/BUILD_ID",
}
ADMIN_HEALTH_ARTIFACTS = (
    "apps/admin/.next/server/app/api/control-plane/[...path]/route.js",
    "apps/admin/.next/server/app/health/page.js",
    "apps/admin/.next/server/app/health/[targetId]/page.js",
)
ADMIN_ROUTES_MANIFEST = "apps/admin/.next/routes-manifest.json"
_MAX_ADMIN_ROUTES_MANIFEST_BYTES = 4 * 1024 * 1024
_HEX_SHA256 = re.compile(r"[0-9a-f]{64}")


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _expected_digest(value: object) -> str:
    if not isinstance(value, str) or _HEX_SHA256.fullmatch(value) is None:
        raise OwnerTestReleaseError("OWNER_TEST_DIGEST_INVALID")
    return value


def _runtime_file(root: Path, relative: str) -> Path:
    path = root / relative
    # Core verifier already rejects all out-of-root links and tracks every
    # file/symlink checksum. Entrypoints themselves must be non-empty files.
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
        metadata = resolved.stat()
    except (OSError, ValueError, RuntimeError) as error:
        raise OwnerTestReleaseError("OWNER_TEST_RUNTIME_FILE_MISSING") from error
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size == 0:
        raise OwnerTestReleaseError("OWNER_TEST_RUNTIME_FILE_INVALID")
    return path


def _matches(root: Path, name: str, expected: object) -> None:
    if _digest(_runtime_file(root, name)) != _expected_digest(expected):
        raise OwnerTestReleaseError("OWNER_TEST_RUNTIME_DIGEST_MISMATCH")


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON property")
        value[key] = item
    return value


def _compiled_admin_base_path(root: Path) -> str:
    # Pinned Next 15 writes config.basePath to routes-manifest.json version 3.
    # The declared release field alone cannot prove the compiled routing path.
    path = _runtime_file(root, ADMIN_ROUTES_MANIFEST)
    with path.open("rb") as stream:
        payload = stream.read(_MAX_ADMIN_ROUTES_MANIFEST_BYTES + 1)
    if len(payload) > _MAX_ADMIN_ROUTES_MANIFEST_BYTES:
        raise OwnerTestReleaseError("OWNER_TEST_ADMIN_ROUTES_MANIFEST_INVALID")
    try:
        manifest = json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_json_object)
    except (ValueError, RecursionError) as error:
        raise OwnerTestReleaseError("OWNER_TEST_ADMIN_ROUTES_MANIFEST_INVALID") from error
    if (
        not isinstance(manifest, dict)
        or type(manifest.get("version")) is not int
        or manifest["version"] != 3
        or not isinstance(manifest.get("basePath"), str)
        or manifest["basePath"] not in ("", "/admin")
    ):
        raise OwnerTestReleaseError("OWNER_TEST_ADMIN_ROUTES_MANIFEST_INVALID")
    return manifest["basePath"]


def verify_owner_test_release(
    root_value: str | Path,
    *,
    expected_source_sha: str,
    expected_source_tree: str,
    expected_inventory_sha256: str,
) -> dict[str, object]:
    """Require all four compiled services on top of the original strict gate.

    Neither this verifier nor the manifest signs its own source identity.
    The expected source commit AND tree must come from trusted review.
    """
    # This digest must be supplied by a separately approved build/release
    # receipt. Reading it out of the package under test defeats the safeguard.
    trusted_inventory = _expected_digest(expected_inventory_sha256)
    try:
        base = verify_release(
            root_value,
            expected_source_sha=expected_source_sha,
            expected_source_tree=expected_source_tree,
        )
    except AttributeError as error:
        # Legacy verifier assumes a JSON object. Fail closed with a stable
        # diagnostic for valid but non-object manifest JSON.
        raise OwnerTestReleaseError("OWNER_TEST_MANIFEST_INVALID") from error
    root = Path(root_value).resolve(strict=True)
    actual_inventory = _digest(_runtime_file(root, "RELEASE_SHA256SUMS"))
    if actual_inventory != trusted_inventory:
        raise OwnerTestReleaseError("OWNER_TEST_TRUSTED_INVENTORY_MISMATCH")
    manifest = json.loads((root / "RELEASE_MANIFEST.json").read_text())
    if not isinstance(manifest, dict):
        raise OwnerTestReleaseError("OWNER_TEST_MANIFEST_INVALID")
    runtime = manifest.get("runtime")
    if not isinstance(runtime, dict):
        raise OwnerTestReleaseError("OWNER_TEST_RUNTIME_MANIFEST_MISSING")

    node = _runtime_file(root, ".runtime/node")
    if node.stat().st_mode & 0o111 != 0o111:
        raise OwnerTestReleaseError("OWNER_TEST_NODE_NOT_EXECUTABLE")
    _matches(root, ".runtime/node", runtime.get("nodeSha256"))

    services = runtime.get("services")
    if not isinstance(services, dict) or set(services) != set(SERVICE_ENTRIES):
        raise OwnerTestReleaseError("OWNER_TEST_SERVICE_SET_INVALID")

    for name, (entry, cwd) in SERVICE_ENTRIES.items():
        service = services[name]
        if not isinstance(service, dict):
            raise OwnerTestReleaseError("OWNER_TEST_SERVICE_MANIFEST_INVALID")
        required = {"entry", "entrySha256", "workingDirectory"}
        if name in NEXT_BUILD_IDS:
            required |= {"buildIdSha256"}
        if name == "admin":
            required |= {"healthArtifactsSha256", "buildBasePath"}
        if set(service) != required:
            raise OwnerTestReleaseError("OWNER_TEST_SERVICE_MANIFEST_INVALID")
        if service["entry"] != entry or service["workingDirectory"] != cwd:
            raise OwnerTestReleaseError("OWNER_TEST_SERVICE_ENTRY_INVALID")
        _matches(root, entry, service["entrySha256"])

        if name in NEXT_BUILD_IDS:
            path = NEXT_BUILD_IDS[name]
            build_file = _runtime_file(root, path)
            # Next BUILD_ID is a small generated regular file; do not read an
            # arbitrarily large payload or accept a symlink standing in for it.
            if build_file.is_symlink() or build_file.stat().st_size > 127:
                raise OwnerTestReleaseError("OWNER_TEST_NEXT_BUILD_ID_INVALID")
            build_id = build_file.read_bytes()
            # Missing/empty/line-broken Next output is not a compiled runtime.
            if not (1 <= len(build_id) <= 127) or any(
                byte < 33 or byte > 126 or byte in b"/\\" for byte in build_id
            ):
                raise OwnerTestReleaseError("OWNER_TEST_NEXT_BUILD_ID_INVALID")
            _matches(root, path, service["buildIdSha256"])

        if name == "admin":
            # Verify the declaration against compiled Next output. Installed
            # reverse-proxy/service parity remains a separate rollout proof.
            if service["buildBasePath"] not in ("", "/admin"):
                raise OwnerTestReleaseError("OWNER_TEST_ADMIN_BASE_PATH_INVALID")
            if _compiled_admin_base_path(root) != service["buildBasePath"]:
                raise OwnerTestReleaseError("OWNER_TEST_ADMIN_BASE_PATH_MISMATCH")
            artifacts = service["healthArtifactsSha256"]
            if not isinstance(artifacts, dict) or set(artifacts) != set(
                ADMIN_HEALTH_ARTIFACTS
            ):
                raise OwnerTestReleaseError("OWNER_TEST_ADMIN_HEALTH_SET_INVALID")
            for path in ADMIN_HEALTH_ARTIFACTS:
                _matches(root, path, artifacts[path])

    # This output reports source/package integrity only, never loaded process
    # bytes, database readiness, real owner session, or recovery acceptance.
    return {
        "status": "PASS_SOURCE_PACKAGE_ONLY",
        "sourceSha": base["sourceSha"],
        "sourceTree": base["sourceTree"],
        "trustedInventorySha256": trusted_inventory,
        "services": sorted(SERVICE_ENTRIES),
        "adminHealthArtifacts": len(ADMIN_HEALTH_ARTIFACTS),
        "adminBuildBasePath": services["admin"]["buildBasePath"],
        "files": base["files"],
        "symlinks": base["symlinks"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify compiled API, worker, portal and Admin Next release."
    )
    parser.add_argument("--expected-source-sha", required=True)
    parser.add_argument("--expected-source-tree", required=True)
    parser.add_argument("--expected-inventory-sha256", required=True)
    parser.add_argument("release_dir")
    args = parser.parse_args()
    try:
        outcome = verify_owner_test_release(
            args.release_dir,
            expected_source_sha=args.expected_source_sha,
            expected_source_tree=args.expected_source_tree,
            expected_inventory_sha256=args.expected_inventory_sha256,
        )
    except (OSError, ValueError, json.JSONDecodeError, ReleaseVerificationError) as error:
        message = (
            str(error)
            if isinstance(error, ReleaseVerificationError)
            else "OWNER_TEST_RELEASE_VERIFICATION_FAILED"
        )
        print(json.dumps({"status": "FAIL", "code": message}, sort_keys=True), file=sys.stderr)
        return 1
    print(json.dumps(outcome, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
