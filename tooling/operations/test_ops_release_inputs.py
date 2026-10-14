import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ops_release_inputs", Path(__file__).with_name("ops_release_inputs.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OpsReleaseInputsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ops-inputs-")
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def manifest(self, path, name, dependencies=None):
        target = self.root / path / "package.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"name": name, "dependencies": dependencies or {}}))
        return target.relative_to(self.root).as_posix()

    def run_publication_boundary(self, move_behavior):
        script = (Path(__file__).resolve().parents[2] / "infra/production/scripts/prepare-octoport-ops-release.sh").read_text()
        start = script.index('target="${RELEASE_ROOT}/${head_sha}"')
        end = script.index('python3 -B "${target}/tooling/operations/verify_ops_release.py"', start)
        # Execute the actual publication/cleanup block; build/systemd alone are
        # stubbed. The rename and delivered SIGTERM are real filesystem actions.
        header = r"""
set -Eeuo pipefail
SOURCE_DIR=/unused
head_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
tree_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
NODE_BIN=/usr/bin/true
PNPM_BIN=/usr/bin/true
store_root="$RELEASE_ROOT"
corepack_home="$RELEASE_ROOT"
fail() { printf '%s\n' "$*" >&2; exit 1; }
systemctl() {
  case "$*" in
    *LoadState*) printf 'not-found\n';;
    *Description*) printf '%s\n' "${build_description:-}";;
    *) printf 'inactive\n';;
  esac
}
systemd-run() { printf 'owned' > "$publish_tmp/payload"; }
"""
        program = header + "\nmv() {\n" + move_behavior + "\n}\n" + script[start:end]
        return subprocess.run(["/bin/bash", "-c", program], env={"PATH": "/usr/bin:/bin", "RELEASE_ROOT": str(self.root)}, capture_output=True, text=True, timeout=10)

    def test_sigterm_between_move_and_publication_flag_removes_owned_target(self):
        result = self.run_publication_boundary('/bin/mv "$@"; kill -TERM "$BASHPID"')
        self.assertEqual(result.returncode, 143, result.stderr)
        self.assertFalse((self.root / ("a" * 40)).exists())
        self.assertEqual(list(self.root.glob(".ops-*")), [])

    def test_publication_does_not_replace_raced_empty_foreign_target(self):
        behavior = r"""
/bin/mkdir "$target"
stat -c '%d:%i' "$target" > "$RELEASE_ROOT/foreign-identity"
/bin/mv "$@"
"""
        result = self.run_publication_boundary(behavior)
        target = self.root / ("a" * 40)
        self.assertTrue(target.is_dir(), result.stderr)
        expected = (self.root / "foreign-identity").read_text().strip()
        self.assertEqual(f"{target.stat().st_dev}:{target.stat().st_ino}", expected)
        self.assertEqual(list(target.iterdir()), [])
        self.assertNotEqual(result.returncode, 0)

    def test_preexisting_target_is_preserved(self):
        target = self.root / ("a" * 40)
        target.mkdir()
        (target / "keep").write_text("foreign")
        result = self.run_publication_boundary('/bin/mv "$@"')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((target / "keep").read_text(), "foreign")

    def test_foreign_replacement_after_move_is_not_removed_on_sigterm(self):
        behavior = r"""
/bin/mv "$@"
/bin/mv "$target" "$RELEASE_ROOT/externally-detached-owned"
/bin/mkdir "$target"
printf 'foreign' > "$target/keep"
kill -TERM "$BASHPID"
"""
        result = self.run_publication_boundary(behavior)
        self.assertEqual(result.returncode, 143, result.stderr)
        self.assertEqual((self.root / ("a" * 40) / "keep").read_text(), "foreign")

    def test_transitive_closure_excludes_unrelated_apps_and_handles_cycles(self):
        tracked = [
            self.manifest("apps/telegram-operator", "@product/telegram-operator", {"@product/shared": "workspace:*", "tsx": "4.20.5"}),
            self.manifest("packages/shared", "@product/shared", {"@product/contracts": "workspace:*"}),
            self.manifest("packages/contracts", "@product/contracts", {"@product/shared": "workspace:*"}),
            self.manifest("apps/admin", "@product/admin"),
            "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
            "tooling/server/monitor-pilot-authority.ts",
        ]
        with patch.object(module.subprocess, "check_output", return_value="\0".join(tracked)):
            result = module.runtime_inputs(self.root)
        self.assertIn("packages/contracts", result)
        self.assertIn("tooling/operations", result)
        self.assertIn("tooling/server/monitor-pilot-authority.ts", result)
        self.assertNotIn("apps/admin", result)
        self.assertNotIn("docs", result)

    def test_missing_workspace_dependency_fails_closed(self):
        tracked = self.manifest("apps/telegram-operator", "@product/telegram-operator", {"@product/missing": "workspace:*"})
        with patch.object(module.subprocess, "check_output", return_value=tracked):
            with self.assertRaisesRegex(ValueError, "MISSING_WORKSPACE"):
                module.runtime_inputs(self.root)

    def test_count_limit_never_deletes_active_or_old_releases(self):
        release = self.root / ("a" * 40)
        release.mkdir()
        with self.assertRaisesRegex(ValueError, "COUNT_LIMIT"):
            module.check_budget(self.root, 1, 10**10, 1)
        self.assertTrue(release.exists())

    def test_byte_limit_rejects_before_another_copy(self):
        (self.root / "payload").write_bytes(b"x" * 8192)
        with self.assertRaisesRegex(ValueError, "BYTES_LIMIT"):
            module.check_budget(self.root, 16, 1, 1)

    def test_free_space_uses_available_blocks_and_preserves_staging_margin(self):
        class FileSystem:
            f_bavail = 10
            f_frsize = 4096
        with patch.object(module.os, "statvfs", return_value=FileSystem()):
            with self.assertRaisesRegex(ValueError, "FREE_SPACE_RESERVE"):
                module.check_budget(self.root, 16, 10**10, 1024)

    def test_admission_rejects_insufficient_headroom_for_one_bounded_stage(self):
        (self.root / "existing").write_bytes(b"x" * 8192)
        used = module.allocated_bytes(self.root)
        with self.assertRaisesRegex(ValueError, "BYTES_LIMIT"):
            module.check_budget(self.root, 16, used + 65536, 1)

    def test_free_reserve_covers_staging_and_filesystem_metadata(self):
        class FileSystem:
            f_bavail = (4 * 1024**3 + 4096) // 4096
            f_frsize = 4096
        with patch.object(module.os, "statvfs", return_value=FileSystem()):
            with self.assertRaisesRegex(ValueError, "FREE_SPACE_RESERVE"):
                module.check_budget(self.root, 16, 20 * 1024**3, 3 * 1024**3)

    def test_export_rejects_before_copy_and_preserves_existing_release(self):
        stage = self.root / "stage"
        stage.mkdir()
        (stage / "payload").write_bytes(b"x" * 16384)
        destination = self.root / ".ops-publish-fixture"
        destination.mkdir()
        existing = self.root / ("a" * 40)
        existing.mkdir()
        (existing / "keep").write_text("active")
        node = self.root / "node"
        node.write_bytes(b"node")
        used = module.allocated_bytes(self.root)
        with self.assertRaisesRegex(ValueError, "BYTES_LIMIT"):
            module.export_stage(stage, destination, self.root, node, used + 8192, 1)
        self.assertEqual(list(destination.iterdir()), [])
        self.assertEqual((existing / "keep").read_text(), "active")

    def test_export_preserves_internal_hardlinks_and_verified_node_reuse(self):
        node = self.root / "node"
        node.write_bytes(b"fixture-node")
        release = self.root / ("a" * 40)
        donor = release / ".runtime/node"
        donor.parent.mkdir(parents=True)
        donor.write_bytes(node.read_bytes())
        donor.chmod(0o555)
        (release / "RELEASE_MANIFEST.json").write_text(json.dumps({
            "sourceSha": release.name,
            "runtime": {"nodeSha256": hashlib.sha256(node.read_bytes()).hexdigest()},
        }))
        stage = self.root / "stage"
        (stage / ".runtime").mkdir(parents=True)
        (stage / ".runtime/node").write_bytes(node.read_bytes())
        (stage / "a").write_bytes(b"same-inode")
        module.os.link(stage / "a", stage / "b")
        destination = self.root / ".ops-publish-fixture"
        destination.mkdir()
        result = module.export_stage(stage, destination, self.root, node)
        self.assertEqual(result["node"], "verified_immutable_hardlink")
        self.assertEqual((destination / "a").stat().st_ino, (destination / "b").stat().st_ino)
        self.assertEqual((destination / ".runtime/node").stat().st_ino, donor.stat().st_ino)

    def test_export_rejects_external_symlink_before_any_copy(self):
        stage = self.root / "stage"
        stage.mkdir()
        (stage / "external").symlink_to("../../outside")
        with self.assertRaisesRegex(ValueError, "EXTERNAL_SYMLINK"):
            module.export_projection(stage, 4096)

    def test_node_reuses_only_verified_readonly_identical_payload(self):
        source = self.root / "node-source"
        source.write_bytes(b"fixture-node")
        source.chmod(0o755)
        release = self.root / ("a" * 40)
        donor = release / ".runtime/node"
        donor.parent.mkdir(parents=True)
        donor.write_bytes(source.read_bytes())
        donor.chmod(0o555)
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        (release / "RELEASE_MANIFEST.json").write_text(json.dumps({"sourceSha": release.name, "runtime": {"nodeSha256": digest}}))
        stage = self.root / "stage"
        self.assertEqual(module.stage_node(source, stage, self.root), "verified_immutable_hardlink")
        self.assertEqual(donor.stat().st_ino, (stage / ".runtime/node").stat().st_ino)
        self.assertNotEqual(source.stat().st_ino, donor.stat().st_ino)

    def test_writable_or_corrupted_donor_is_never_linked(self):
        source = self.root / "node-source"
        source.write_bytes(b"fixture-node")
        for mode in (0o755, 0o555):
            release = self.root / (str(mode % 10) * 40)
            donor = release / ".runtime/node"
            donor.parent.mkdir(parents=True)
            donor.write_bytes(b"corrupt" if mode == 0o555 else source.read_bytes())
            donor.chmod(mode)
            (release / "RELEASE_MANIFEST.json").write_text(json.dumps({"sourceSha": release.name, "runtime": {"nodeSha256": hashlib.sha256(source.read_bytes()).hexdigest()}}))
        stage = self.root / "stage"
        self.assertEqual(module.stage_node(source, stage, self.root), "private_copy")
        self.assertEqual((stage / ".runtime/node").read_bytes(), source.read_bytes())
        self.assertEqual((stage / ".runtime/node").stat().st_mode & 0o777, 0o555)


if __name__ == "__main__":
    unittest.main()
