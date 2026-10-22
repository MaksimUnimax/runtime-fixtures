"""Synthetic packaging tests: no install, live DB, credentials or network."""
from __future__ import annotations
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).parent))
import package_owner_test_release as pkg
from verify_owner_test_release import ADMIN_HEALTH_ARTIFACTS, verify_owner_test_release


class RuntimePackage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="four-runtime-package-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.output = self.root / "output"
        self.node = self.root / "node"
        self.node.write_text("#!/bin/sh\nprintf 'v24.20.0\\n'\n")
        self.node.chmod(0o755)
        self.write("package.json", '{"name":"fixture","private":true}')
        self.write("pnpm-lock.yaml", 'lockfileVersion: "9.0"\n')
        self.write("tsconfig.base.json", '{}')
        self.write("pnpm-workspace.yaml", 'packages: ["apps/*"]\n')
        for name in ("api", "worker", "portal", "admin"):
            self.write("apps/" + name + "/package.json", json.dumps({
                "name": "@product/" + name, "dependencies": {"next" if name in ("portal", "admin") else "tsx": "1.0.0"},
            }))
            self.write("apps/" + name + "/src/main.ts", "export const fixture = true;\n")
        self.git("init", "-q")
        self.git("add", ".")
        self.commit()
        # Test-only generated package-store/build outputs, never product data.
        for name in ("tsx", "next"):
            self.write("node_modules/.pnpm/" + name + "@1.0.0/node_modules/" + name + "/package.json", json.dumps({"name": name}))
        self.write("node_modules/.pnpm/next@1.0.0/node_modules/next/dist/bin/next", "synthetic Next entry\n")
        self.write("node_modules/.pnpm/tsx@1.0.0/node_modules/tsx/dist/cli.mjs", "synthetic tsx entry\n")
        for name in ("api", "worker", "portal", "admin"):
            dependency = "next" if name in ("portal", "admin") else "tsx"
            parent = self.source / "apps" / name / "node_modules"
            parent.mkdir()
            (parent / dependency).symlink_to("../../../node_modules/.pnpm/" + dependency + "@1.0.0/node_modules/" + dependency)
        for name in ("api", "worker"):
            self.write("apps/" + name + "/dist/main.js", "synthetic compiled " + name + "\n")
        for name in ("portal", "admin"):
            self.write("apps/" + name + "/.next/BUILD_ID", "SyntheticBuildId" + name)
            self.write("apps/" + name + "/.next/cache/not-runtime", "cache must not be shipped")
        self.write("apps/admin/.next/routes-manifest.json", '{"version":3,"basePath":"/admin"}')
        for path in ADMIN_HEALTH_ARTIFACTS:
            self.write(path, "synthetic compiled Health artifact")
        self.write("apps/api/.env", "SYNTHETIC_UNTRACKED_SENTINEL_DO_NOT_COPY=1")

    def write(self, path, value):
        p = self.source / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(value)
        return p

    def git(self, *args):
        result = subprocess.run(["git", "-C", str(self.source), *args], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def commit(self):
        self.git("-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "synthetic fixture")
        self.sha = self.git("rev-parse", "HEAD")
        self.tree = self.git("rev-parse", "HEAD^{tree}")

    def run_package(self, **kwargs):
        return pkg.package_release(self.source, self.output, self.node, self.sha, self.tree, **kwargs)

    def test_real_archive_contains_exact_valid_four_runtime_synthetic_fixture(self):
        receipt = self.run_package()
        self.assertEqual(receipt["verification"]["status"], "PASS_SOURCE_PACKAGE_ONLY")
        self.assertEqual(receipt["workspaceNames"], sorted(pkg.ROOTS))
        self.assertTrue(receipt["archiveContentVerified"])
        self.assertEqual(receipt["acceptance"], "BUILT_PACKAGE_ONLY_NOT_INSTALLED_NOT_RECOVERY_NOT_PRODUCTION")
        archive = self.output / receipt["archive"]
        self.assertEqual(pkg.digest(archive), receipt["archiveSha256"])
        target = self.root / "extracted"
        target.mkdir()
        # Only our generated archive, already validated against its exact stage.
        with tarfile.open(archive) as tar:
            names = tar.getnames()
            self.assertFalse(any("/.env" in name or "/cache/" in name for name in names))
            tar.extractall(target)  # Generated, validated private fixture; Python 3.11 supported.
        proof = verify_owner_test_release(target / self.sha, expected_source_sha=self.sha,
            expected_source_tree=self.tree, expected_inventory_sha256=receipt["trustedInventorySha256"])
        self.assertEqual(proof["services"], ["admin", "api", "portal", "worker"])
        self.assertEqual(proof["adminBuildBasePath"], "/admin")
        self.assertEqual(self.git("status", "--porcelain", "--untracked-files=no"), "")

    def test_transitive_pnpm_dependency_is_included(self):
        self.write("node_modules/.pnpm/next@1.0.0/node_modules/next/package.json", '{"name":"next","dependencies":{"child":"2"}}')
        self.write("node_modules/.pnpm/child@2/node_modules/child/package.json", '{"name":"child"}')
        self.write("node_modules/.pnpm/child@2/node_modules/child/index.js", "child payload")
        parent = self.source / "node_modules/.pnpm/next@1.0.0/node_modules"
        (parent / "child").symlink_to("../../child@2/node_modules/child")
        self.run_package()
        child = self.output / self.sha / "node_modules/.pnpm/child@2/node_modules/child/index.js"
        self.assertEqual(child.read_text(), "child payload")

    def test_missing_transitive_dependency_is_rejected(self):
        self.write("node_modules/.pnpm/next@1.0.0/node_modules/next/package.json",
                   '{"name":"next","dependencies":{"missing":"2"}}')
        with self.assertRaisesRegex(pkg.PackageError, "TRANSITIVE_DEPENDENCY_MISSING"):
            self.run_package()
        self.assertFalse(self.output.exists())

    def test_optional_transitive_dependency_absence_is_reported(self):
        self.write("node_modules/.pnpm/next@1.0.0/node_modules/next/package.json",
                   '{"name":"next","optionalDependencies":{"absent-platform-binary":"2"}}')
        receipt = self.run_package()
        self.assertTrue(any(x.endswith(":absent-platform-binary") for x in receipt["omittedOptionalDependencies"]))

    def test_workspace_runtime_dependency_and_sources_are_included(self):
        self.write("packages/example/package.json", '{"name":"@product/example"}')
        self.write("packages/example/src/index.ts", 'export const value = 1;')
        self.write("apps/api/package.json", '{"name":"@product/api","dependencies":{"tsx":"1","@product/example":"workspace:*"}}')
        self.git("add", "apps/api/package.json", "packages/example")
        self.commit()
        link = self.source / "apps/api/node_modules/@product/example"
        link.parent.mkdir()
        link.symlink_to("../../../../packages/example")
        receipt = self.run_package()
        self.assertIn("@product/example", receipt["workspaceNames"])
        self.assertTrue((self.output / self.sha / "packages/example/src/index.ts").is_file())

    def test_missing_compiled_admin_route_never_creates_a_package(self):
        (self.source / ADMIN_HEALTH_ARTIFACTS[0]).unlink()
        with self.assertRaises((OSError, RuntimeError)):
            self.run_package()
        self.assertFalse(self.output.exists())

    def test_missing_required_dependency_fails_without_output(self):
        (self.source / "apps/api/node_modules/tsx").unlink()
        with self.assertRaisesRegex(pkg.PackageError, "PNPM_DEPENDENCY_LINK_MISSING"):
            self.run_package()
        self.assertFalse(self.output.exists())

    def test_external_dependency_link_rejected_without_reading_target(self):
        link = self.source / "apps/api/node_modules/tsx"
        link.unlink()
        external = self.root / "outside"
        external.mkdir()
        link.symlink_to(os.path.relpath(external, link.parent))
        with self.assertRaisesRegex(pkg.PackageError, "EXTERNAL_OR_BROKEN_LINK"):
            self.run_package()
        self.assertFalse(self.output.exists())

    def test_absolute_internal_dependency_link_is_rejected(self):
        link = self.source / "apps/api/node_modules/tsx"
        target = link.resolve()
        link.unlink()
        link.symlink_to(target)
        with self.assertRaisesRegex(pkg.PackageError, "PACKAGE_EXTERNAL_LINK"):
            self.run_package()

    def test_dirty_source_and_wrong_identity_are_rejected(self):
        with self.assertRaisesRegex(pkg.PackageError, "SOURCE_ID_MISMATCH"):
            pkg.package_release(self.source, self.output, self.node, "a" * 40, self.tree)
        self.write("apps/api/src/main.ts", "changed source")
        with self.assertRaisesRegex(pkg.PackageError, "TRACKED_SOURCE_DIRTY"):
            self.run_package()
        self.assertFalse(self.output.exists())

    def test_output_is_not_overwritten(self):
        self.output.mkdir()
        marker = self.output / "keep"
        marker.write_text("unique preserved data")
        with self.assertRaisesRegex(pkg.PackageError, "OUTPUT_ALREADY_EXISTS"):
            self.run_package()
        self.assertEqual(marker.read_text(), "unique preserved data")

    def test_output_cannot_be_inside_checkout(self):
        with self.assertRaisesRegex(pkg.PackageError, "OUTPUT_OVERLAPS_SOURCE"):
            pkg.package_release(self.source, self.source / "output", self.node, self.sha, self.tree)

    def test_unapproved_runtime_version_is_rejected(self):
        self.node.write_text("#!/bin/sh\nprintf 'v22.0.0\\n'\n")
        with self.assertRaisesRegex(pkg.PackageError, "NODE_VERSION_MISMATCH"):
            self.run_package()

    def test_memory_and_disk_budgets_fail_closed(self):
        with self.assertRaisesRegex(pkg.PackageError, "INPUT_BUDGET_EXCEEDED"):
            self.run_package(max_bytes=32)
        with patch.object(pkg.shutil, "disk_usage", return_value=shutil._ntuple_diskusage(1000, 999, 1)):
            with self.assertRaisesRegex(pkg.PackageError, "OUTPUT_DISK_RESERVE"):
                self.run_package()
        self.assertFalse(self.output.exists())

    def test_invalid_admin_compiled_routes_rejected_and_own_output_cleaned(self):
        self.write("apps/admin/.next/routes-manifest.json", '{"version":3,"basePath":"/admin","basePath":""}')
        with self.assertRaisesRegex(RuntimeError, "ROUTES_MANIFEST_INVALID"):
            self.run_package()
        self.assertFalse(self.output.exists())

    def test_input_symlink_parent_cannot_redirect_a_copy(self):
        nested = self.source / "changing"
        nested.mkdir()
        payload = nested / "file"
        payload.write_text("original")
        inputs = pkg.Inventory(self.source, set(), 1024)
        inputs.add_file("changing/file", payload)
        payload.unlink()
        nested.rmdir()
        outside = self.root / "replacement"
        outside.mkdir()
        (outside / "file").write_text("replacement")
        nested.symlink_to(outside)
        stage = self.root / "stage"
        stage.mkdir()
        with self.assertRaises(OSError):
            inputs.copy(stage)
        self.assertFalse((stage / "changing/file").exists())

    def test_tracked_blob_hash_must_match_even_with_clean_status_claim(self):
        stage = self.root / "stage"
        stage.mkdir()
        path = self.source / "apps/api/src/main.ts"
        inputs = pkg.Inventory(self.source, set(), 1024)
        inputs.add_file("apps/api/src/main.ts", path)
        inputs.git_blobs["apps/api/src/main.ts"] = "a" * 40
        with self.assertRaisesRegex(pkg.PackageError, "TRACKED_BLOB_MISMATCH"):
            inputs.copy(stage)

    def test_archive_mutation_and_duplicate_entries_are_rejected(self):
        receipt = self.run_package()
        archive = self.output / receipt["archive"]
        archive.chmod(0o644)
        with tarfile.open(archive, "w:gz") as tar:
            item = tarfile.TarInfo(self.sha)
            item.type = tarfile.DIRTYPE
            item.mode = 0o555
            tar.addfile(item)
            tar.addfile(item)
        with self.assertRaisesRegex(pkg.PackageError, "ARCHIVE_ENTRY_INVALID"):
            pkg.verify_archive(archive, self.output / self.sha)

    def test_runtime_probes_are_nonroot_and_do_not_inherit_private_environment(self):
        api_error = b'ZodError: [{"path": ["databaseUrl"], "message":"required"}]'
        children = []
        for code, out, err in ((1, b"", api_error), (1, b"", api_error),
                                (0, b"Next.js v15.5.21", b""), (0, b"Next.js v15.5.21", b"")):
            child = Mock(pid=70000 + len(children), returncode=code)
            child.communicate.return_value = (out, err)
            children.append(child)
        with patch.object(pkg.subprocess, "Popen", side_effect=children) as start, \
                patch.object(pkg.os, "killpg") as stop:
            result = pkg.runtime_import_smoke(self.source)
        self.assertEqual(set(result), {"api", "worker", "portal", "admin"})
        self.assertEqual(start.call_count, 4)
        self.assertEqual(stop.call_count, 4)
        for invocation in start.call_args_list:
            options = invocation.kwargs
            self.assertEqual(options["user"], 65534)
            self.assertEqual(options["group"], 65534)
            self.assertEqual(options["extra_groups"], [])
            self.assertTrue(options["start_new_session"])
            self.assertNotIn("DATABASE_URL", options["env"])
            self.assertNotIn("GH_TOKEN", options["env"])
            self.assertNotIn("AUTH_ROOT_SECRET", options["env"])
        for child in children:
            child.communicate.assert_called_once_with(timeout=20)
            child.wait.assert_called_once_with(timeout=5)

    def test_runtime_module_error_is_not_accepted_as_missing_configuration(self):
        child = Mock(pid=70000, returncode=1)
        child.communicate.return_value = (b"", b"Error: Cannot find module missing-runtime")
        with patch.object(pkg.subprocess, "Popen", return_value=child), patch.object(pkg.os, "killpg"):
            with self.assertRaisesRegex(pkg.PackageError, "RUNTIME_IMPORT_GATE_FAILED_API"):
                pkg.runtime_import_smoke(self.source)
        child.wait.assert_called_once_with(timeout=5)

    def test_runtime_probe_timeout_cleans_own_group(self):
        child = Mock(pid=70000, returncode=None)
        child.communicate.side_effect = subprocess.TimeoutExpired("synthetic", 20)
        with patch.object(pkg.subprocess, "Popen", return_value=child), patch.object(pkg.os, "killpg") as stop:
            with self.assertRaisesRegex(pkg.PackageError, "RUNTIME_PROBE_TIMEOUT"):
                pkg.runtime_import_smoke(self.source)
        stop.assert_called_once_with(70000, pkg.signal.SIGKILL)
        child.wait.assert_called_once_with(timeout=5)

    def test_safe_names_reject_traversal_and_control_characters(self):
        for name in ("../escape", "/absolute", "a/../b", "a//b", "a\nb", "a/./b"):
            with self.subTest(name=name):
                with self.assertRaises(pkg.PackageError):
                    pkg.safe_name(name)


if __name__ == "__main__":
    unittest.main()
