"""Finite synthetic release fixtures: never use production or an installed DB."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from verify_ops_release import ReleaseVerificationError, verify_release
from verify_owner_test_release import (
    ADMIN_HEALTH_ARTIFACTS,
    NEXT_BUILD_IDS,
    SERVICE_ENTRIES,
    OwnerTestReleaseError,
    verify_owner_test_release,
)

SHA = "a" * 40
TREE = "b" * 40


class FourServiceRuntimeVerification(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="four-service-release-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / SHA
        self.root.mkdir(mode=0o755)
        self.files: dict[str, bytes] = {}

        self._add(".runtime/node", b"synthetic node runtime\n", mode=0o555)
        services: dict[str, dict[str, object]] = {}
        for name, (entry, cwd) in SERVICE_ENTRIES.items():
            payload = ("synthetic " + name + " compiled entry\n").encode()
            self._add(entry, payload)
            spec: dict[str, object] = {
                "entry": entry,
                "entrySha256": hashlib.sha256(payload).hexdigest(),
                "workingDirectory": cwd,
            }
            if name in NEXT_BUILD_IDS:
                build = ("SyntheticNextBuild" + name).encode()
                self._add(NEXT_BUILD_IDS[name], build)
                spec["buildIdSha256"] = hashlib.sha256(build).hexdigest()
            if name == "admin":
                artifacts = {}
                for path in ADMIN_HEALTH_ARTIFACTS:
                    data = ("synthetic compiled admin " + path + "\n").encode()
                    self._add(path, data)
                    artifacts[path] = hashlib.sha256(data).hexdigest()
                spec["healthArtifactsSha256"] = artifacts
                spec["buildBasePath"] = "/admin"
                self._add(
                    "apps/admin/.next/routes-manifest.json",
                    b'{"version":3,"basePath":"/admin"}',
                )
            services[name] = spec

        self.manifest = {
            "format": "octoport-ops-release-v1",
            "sourceSha": SHA,
            "sourceTree": TREE,
            "runtime": {
                "nodeSha256": hashlib.sha256(self.files[".runtime/node"]).hexdigest(),
                "services": services,
            },
        }
        self._refresh()

    def _add(self, relative: str, content: bytes, mode: int = 0o644) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        for directory in path.parents:
            if directory == self.root.parent:
                break
            directory.chmod(0o755)
        path.write_bytes(content)
        path.chmod(mode)
        self.files[relative] = content

    def _refresh(self) -> None:
        (self.root / "RELEASE_MANIFEST.json").write_text(
            json.dumps(self.manifest, sort_keys=True) + "\n"
        )
        (self.root / "RELEASE_SYMLINKS").write_text("")
        lines = []
        for path in sorted(self.root.rglob("*")):
            if path.is_file() and not path.is_symlink() and path.name != "RELEASE_SHA256SUMS":
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                lines.append(f"{digest}  {path.relative_to(self.root).as_posix()}")
        (self.root / "RELEASE_SHA256SUMS").write_text("\n".join(lines) + "\n")

    def _inventory_digest(self) -> str:
        return hashlib.sha256(
            (self.root / "RELEASE_SHA256SUMS").read_bytes()
        ).hexdigest()

    _UNSET = object()

    def _verify(self, *, trusted_inventory: object = _UNSET) -> dict[str, object]:
        return verify_owner_test_release(
            self.root,
            expected_source_sha=SHA,
            expected_source_tree=TREE,
            expected_inventory_sha256=(
                self._inventory_digest()
                if trusted_inventory is self._UNSET
                else trusted_inventory
            ),
        )

    def test_valid_four_service_runtime_is_only_a_source_package_pass(self) -> None:
        result = self._verify()
        self.assertEqual(result["status"], "PASS_SOURCE_PACKAGE_ONLY")
        self.assertEqual(result["sourceSha"], SHA)
        self.assertEqual(result["sourceTree"], TREE)
        self.assertEqual(result["trustedInventorySha256"], self._inventory_digest())
        self.assertEqual(result["services"], ["admin", "api", "portal", "worker"])
        self.assertEqual(result["adminHealthArtifacts"], 3)
        self.assertEqual(result["adminBuildBasePath"], "/admin")

    def test_generic_verifier_can_pass_three_services_without_admin(self) -> None:
        # Original byte-inventory integrity is necessary, not service complete.
        self.manifest["runtime"]["services"].pop("admin")
        self._refresh()
        self.assertEqual(
            verify_release(
                self.root, expected_source_sha=SHA, expected_source_tree=TREE
            )["status"],
            "PASS",
        )
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_SERVICE_SET_INVALID"
        ):
            self._verify()

    def test_legacy_telegram_manifest_does_not_pass_owner_test(self) -> None:
        self.manifest["runtime"].pop("services")
        self._refresh()
        with self.assertRaisesRegex(OwnerTestReleaseError, "OWNER_TEST_SERVICE_SET_INVALID"):
            self._verify()

    def test_rejects_missing_compiled_api_or_worker(self) -> None:
        for service in ("api", "worker"):
            with self.subTest(service=service):
                path = self.root / SERVICE_ENTRIES[service][0]
                saved = path.read_bytes()
                path.unlink()
                self._refresh()
                with self.assertRaisesRegex(
                    OwnerTestReleaseError, "OWNER_TEST_RUNTIME_FILE_MISSING"
                ):
                    self._verify()
                path.write_bytes(saved)
                self._refresh()

    def test_rejects_missing_admin_compiled_health_route(self) -> None:
        compiled = self.root / ADMIN_HEALTH_ARTIFACTS[1]
        compiled.unlink()
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_RUNTIME_FILE_MISSING"
        ):
            self._verify()

    def test_rejects_missing_admin_health_inventory_entry(self) -> None:
        self.manifest["runtime"]["services"]["admin"]["healthArtifactsSha256"].pop(
            ADMIN_HEALTH_ARTIFACTS[0]
        )
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_ADMIN_HEALTH_SET_INVALID"
        ):
            self._verify()

    def test_rejects_admin_compiled_bundle_with_false_manifest_digest(self) -> None:
        self.manifest["runtime"]["services"]["admin"]["healthArtifactsSha256"][
            ADMIN_HEALTH_ARTIFACTS[0]
        ] = "c" * 64
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_RUNTIME_DIGEST_MISMATCH"
        ):
            self._verify()

    def test_rejects_three_service_compiled_payload_mutation(self) -> None:
        path = self.root / SERVICE_ENTRIES["portal"][0]
        path.write_text("tampered\n")
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_CHECKSUM_MISMATCH"
        ):
            self._verify()

    def test_admin_empty_base_path_is_a_supported_explicit_build(self) -> None:
        self.manifest["runtime"]["services"]["admin"]["buildBasePath"] = ""
        self._add(
            "apps/admin/.next/routes-manifest.json",
            b'{"version":3,"basePath":""}',
        )
        self._refresh()
        self.assertEqual(self._verify()["adminBuildBasePath"], "")

    def test_rejects_base_path_declaration_different_from_compiled_routes(self) -> None:
        for declared, compiled in (("/admin", ""), ("", "/admin")):
            with self.subTest(declared=declared, compiled=compiled):
                self.manifest["runtime"]["services"]["admin"]["buildBasePath"] = declared
                self._add(
                    "apps/admin/.next/routes-manifest.json",
                    json.dumps({"version": 3, "basePath": compiled}).encode(),
                )
                self._refresh()
                with self.assertRaisesRegex(
                    OwnerTestReleaseError, "OWNER_TEST_ADMIN_BASE_PATH_MISMATCH"
                ):
                    self._verify()

    def test_rejects_missing_compiled_admin_routes_manifest(self) -> None:
        (self.root / "apps/admin/.next/routes-manifest.json").unlink()
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_RUNTIME_FILE_MISSING"
        ):
            self._verify()

    def test_rejects_invalid_compiled_admin_routes_manifest(self) -> None:
        for payload in (
            b"not JSON", b"[]", b"null", b"\xff", b'{"version":3}',
            b'{"version":3,"basePath":null}',
            b'{"version":3,"basePath":false}',
            b'{"version":2,"basePath":"/admin"}',
            b'{"version":3.0,"basePath":"/admin"}',
            b'{"version":"3","basePath":"/admin"}',
            b'{"version":3,"basePath":"/unexpected"}',
            b"[" * 1200 + b"0" + b"]" * 1200,
            b'{"version":3,"basePath":"/admin","basePath":""}',
            b'{"version":3,"basePath":"/admin","other":{"x":1,"x":2}}',
        ):
            with self.subTest(payload=payload):
                self._add("apps/admin/.next/routes-manifest.json", payload)
                self._refresh()
                with self.assertRaisesRegex(
                    OwnerTestReleaseError, "OWNER_TEST_ADMIN_ROUTES_MANIFEST_INVALID"
                ):
                    self._verify()

    def test_rejects_oversized_compiled_admin_routes_manifest(self) -> None:
        self._add(
            "apps/admin/.next/routes-manifest.json",
            b" " * (4 * 1024 * 1024) + b"x",
        )
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_ADMIN_ROUTES_MANIFEST_INVALID"
        ):
            self._verify()

    def test_accepts_routes_manifest_at_exact_size_limit(self) -> None:
        minimal = b'{"version":3,"basePath":"/admin"}'
        payload = minimal + b" " * (4 * 1024 * 1024 - len(minimal))
        self._add("apps/admin/.next/routes-manifest.json", payload)
        self._refresh()
        self.assertEqual(self._verify()["adminBuildBasePath"], "/admin")

    def test_routes_manifest_cannot_change_under_pinned_inventory(self) -> None:
        approved_inventory = self._inventory_digest()
        self._add(
            "apps/admin/.next/routes-manifest.json",
            b'{"version":3,"basePath":""}',
        )
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_TRUSTED_INVENTORY_MISMATCH"
        ):
            self._verify(trusted_inventory=approved_inventory)

    def test_cli_rejects_compiled_base_path_mismatch(self) -> None:
        self._add(
            "apps/admin/.next/routes-manifest.json",
            b'{"version":3,"basePath":""}',
        )
        self._refresh()
        outcome = subprocess.run(
            [
                sys.executable, "-B",
                str(Path(__file__).with_name("verify_owner_test_release.py")),
                "--expected-source-sha", SHA,
                "--expected-source-tree", TREE,
                "--expected-inventory-sha256", self._inventory_digest(),
                str(self.root),
            ],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(outcome.returncode, 1)
        self.assertEqual(outcome.stdout, "")
        self.assertEqual(
            json.loads(outcome.stderr)["code"],
            "OWNER_TEST_ADMIN_BASE_PATH_MISMATCH",
        )

    def test_rejects_unapproved_admin_compiled_base_path(self) -> None:
        self.manifest["runtime"]["services"]["admin"]["buildBasePath"] = "/surprise"
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_ADMIN_BASE_PATH_INVALID"
        ):
            self._verify()

    def test_rejects_oversized_next_build_id(self) -> None:
        path = self.root / NEXT_BUILD_IDS["admin"]
        path.write_bytes(b"A" * 1024)
        self.manifest["runtime"]["services"]["admin"]["buildIdSha256"] = (
            hashlib.sha256(path.read_bytes()).hexdigest()
        )
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_NEXT_BUILD_ID_INVALID"
        ):
            self._verify()

    def test_rejects_service_entry_source_instead_of_compiled_output(self) -> None:
        self.manifest["runtime"]["services"]["api"]["entry"] = "apps/api/src/main.ts"
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_SERVICE_ENTRY_INVALID"
        ):
            self._verify()

    def test_rejects_missing_or_invalid_node_runtime(self) -> None:
        node = self.root / ".runtime/node"
        node.chmod(0o444)
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_NODE_NOT_EXECUTABLE"
        ):
            self._verify()

    def test_rejects_new_next_build_id_with_line_break(self) -> None:
        path = self.root / NEXT_BUILD_IDS["admin"]
        path.write_bytes(b"broken\nBUILD_ID")
        self.manifest["runtime"]["services"]["admin"][
            "buildIdSha256"
        ] = hashlib.sha256(path.read_bytes()).hexdigest()
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_NEXT_BUILD_ID_INVALID"
        ):
            self._verify()

    def test_requires_independent_exact_source_sha_and_tree(self) -> None:
        for kwargs, code in (
            ({"expected_source_sha": "c" * 40, "expected_source_tree": TREE},
             "RELEASE_EXPECTED_SOURCE_SHA_MISMATCH"),
            ({"expected_source_sha": SHA, "expected_source_tree": "d" * 40},
             "RELEASE_EXPECTED_SOURCE_TREE_MISMATCH"),
        ):
            with self.subTest(code=code):
                with self.assertRaisesRegex(ReleaseVerificationError, code):
                    verify_owner_test_release(
                        self.root, expected_inventory_sha256=self._inventory_digest(), **kwargs
                    )

    def test_rejects_symlink_escape_even_if_checksum_metadata_matches(self) -> None:
        entry = self.root / SERVICE_ENTRIES["admin"][0]
        entry.unlink()
        outside = Path(self.temp.name) / "outside.txt"
        outside.write_text("synthetic outside\n")
        entry.symlink_to(outside)
        (self.root / "RELEASE_SYMLINKS").write_text(
            SERVICE_ENTRIES["admin"][0] + "\t" + str(outside) + "\n"
        )
        # Invalid symlink needs no checksum tampering to be caught. Inventory
        # remains syntactically correct while the link escapes the release.
        lines = [
            line for line in (self.root / "RELEASE_SHA256SUMS").read_text().splitlines()
            if not line.endswith("  " + SERVICE_ENTRIES["admin"][0])
        ]
        (self.root / "RELEASE_SHA256SUMS").write_text("\n".join(lines) + "\n")
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_SYMLINK_INVALID"
        ):
            self._verify()

    def test_trusted_inventory_rejects_rehashed_forged_package(self) -> None:
        originally_trusted = self._inventory_digest()
        # Attacker has write access to package and can rewrite its own hashes.
        entry = SERVICE_ENTRIES["admin"][0]
        forged = b"fake replacement compiled admin runtime"
        (self.root / entry).write_bytes(forged)
        self.manifest["runtime"]["services"]["admin"]["entrySha256"] = (
            hashlib.sha256(forged).hexdigest()
        )
        self._refresh()
        self.assertNotEqual(self._inventory_digest(), originally_trusted)
        # Internal manifest and checksum verification would now both succeed.
        self.assertEqual(
            verify_release(
                self.root, expected_source_sha=SHA, expected_source_tree=TREE
            )["status"],
            "PASS",
        )
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_TRUSTED_INVENTORY_MISMATCH"
        ):
            self._verify(trusted_inventory=originally_trusted)

    def test_trusted_inventory_hash_format_is_checked(self) -> None:
        for value in ("not-a-sha256", "A" * 64, "", None, 42):
            with self.subTest(value=value):
                with self.assertRaisesRegex(
                    OwnerTestReleaseError, "OWNER_TEST_DIGEST_INVALID"
                ):
                    self._verify(trusted_inventory=value)

    def test_nonobject_manifest_has_fail_closed_diagnostic(self) -> None:
        self.manifest = []
        self._refresh()
        with self.assertRaisesRegex(
            OwnerTestReleaseError, "OWNER_TEST_MANIFEST_INVALID"
        ):
            self._verify()

    def test_cli_requires_trusted_inventory_provenance(self) -> None:
        script = Path(__file__).with_name("verify_owner_test_release.py")
        outcome = subprocess.run(
            [
                sys.executable, "-B", str(script),
                "--expected-source-sha", SHA,
                "--expected-source-tree", TREE,
                str(self.root),
            ],
            capture_output=True, text=True, timeout=10,
        )
        self.assertNotEqual(outcome.returncode, 0)
        self.assertIn("--expected-inventory-sha256", outcome.stderr)

    def test_cli_source_package_only_and_missing_source_pair(self) -> None:
        script = Path(__file__).with_name("verify_owner_test_release.py")
        complete = subprocess.run(
            [
                sys.executable,
                "-B",
                str(script),
                "--expected-source-sha",
                SHA,
                "--expected-source-tree",
                TREE,
                "--expected-inventory-sha256",
                self._inventory_digest(),
                str(self.root),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(complete.returncode, 0, complete.stderr)
        self.assertEqual(json.loads(complete.stdout)["status"], "PASS_SOURCE_PACKAGE_ONLY")
        missing_pair = subprocess.run(
            [sys.executable, "-B", str(script), str(self.root)],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertNotEqual(missing_pair.returncode, 0)
        self.assertIn("--expected-source-sha", missing_pair.stderr)

    def test_cli_rejects_invalid_source_tree_without_output_success(self) -> None:
        script = Path(__file__).with_name("verify_owner_test_release.py")
        outcome = subprocess.run(
            [
                sys.executable,
                "-B",
                str(script),
                "--expected-source-sha",
                SHA,
                "--expected-source-tree",
                "d" * 40,
                "--expected-inventory-sha256",
                self._inventory_digest(),
                str(self.root),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(outcome.returncode, 1)
        self.assertEqual(
            json.loads(outcome.stderr)["code"], "RELEASE_EXPECTED_SOURCE_TREE_MISMATCH"
        )


if __name__ == "__main__":
    unittest.main()
