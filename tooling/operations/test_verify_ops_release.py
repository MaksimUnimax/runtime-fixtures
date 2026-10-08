from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from verify_ops_release import ReleaseVerificationError, verify_release


SOURCE_SHA = "a" * 40
SOURCE_TREE = "b" * 40


class VerifyOpsReleaseTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / SOURCE_SHA
        self.root.mkdir(mode=0o755)
        (self.root / "runtime").mkdir()
        (self.root / "runtime" / "entry.js").write_text("entry\n")
        (self.root / "payload.txt").write_text("payload\n")
        (self.root / "runtime-link").symlink_to("runtime/entry.js")
        (self.root / "RELEASE_MANIFEST.json").write_text(
            json.dumps(
                {
                    "format": "octoport-ops-release-v1",
                    "sourceSha": SOURCE_SHA,
                    "sourceTree": SOURCE_TREE,
                },
                sort_keys=True,
            )
            + "\n"
        )
        self._refresh_metadata()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _refresh_metadata(self) -> None:
        links = []
        for path in self.root.rglob("*"):
            if path.is_symlink():
                links.append(
                    f"{path.relative_to(self.root).as_posix()}\t{os.readlink(path)}"
                )
        (self.root / "RELEASE_SYMLINKS").write_text(
            "\n".join(sorted(links)) + ("\n" if links else "")
        )
        checksums = []
        for path in sorted(self.root.rglob("*")):
            if (
                path.is_file()
                and not path.is_symlink()
                and path.name != "RELEASE_SHA256SUMS"
            ):
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                checksums.append(f"{digest}  {path.relative_to(self.root).as_posix()}")
        (self.root / "RELEASE_SHA256SUMS").write_text("\n".join(checksums) + "\n")

    def test_valid_release_passes(self) -> None:
        result = verify_release(self.root)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["sourceSha"], SOURCE_SHA)
        self.assertEqual(result["symlinks"], 1)

    def test_tampered_file_fails(self) -> None:
        (self.root / "payload.txt").write_text("tampered\n")
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_CHECKSUM_MISMATCH"
        ):
            verify_release(self.root)

    def test_extra_file_fails(self) -> None:
        (self.root / "extra.txt").write_text("extra\n")
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_FILE_SET_MISMATCH"
        ):
            verify_release(self.root)

    def test_symlink_escape_fails_even_when_inventory_matches(self) -> None:
        outside = self.base / "outside.txt"
        outside.write_text("outside\n")
        link = self.root / "runtime-link"
        link.unlink()
        link.symlink_to(outside)
        self._refresh_metadata()
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_SYMLINK_INVALID"
        ):
            verify_release(self.root)

    def test_group_writable_file_fails(self) -> None:
        payload = self.root / "payload.txt"
        payload.chmod(0o664)
        self._refresh_metadata()
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_PERMISSIONS_INVALID"
        ):
            verify_release(self.root)

    def test_root_only_file_fails(self) -> None:
        payload = self.root / "payload.txt"
        payload.chmod(0o600)
        self._refresh_metadata()
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_PERMISSIONS_INVALID"
        ):
            verify_release(self.root)

    def test_untraversable_directory_fails(self) -> None:
        runtime = self.root / "runtime"
        runtime.chmod(0o700)
        self._refresh_metadata()
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_PERMISSIONS_INVALID"
        ):
            verify_release(self.root)

    def test_exact_expected_source_pair_succeeds(self) -> None:
        result = verify_release(
            self.root,
            expected_source_sha=SOURCE_SHA,
            expected_source_tree=SOURCE_TREE,
        )
        self.assertEqual(result["status"], "PASS")

    def test_exact_expected_source_pair_preserves_checksum_validation(self) -> None:
        (self.root / "payload.txt").write_text("tampered\\n")
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_CHECKSUM_MISMATCH"
        ):
            verify_release(
                self.root,
                expected_source_sha=SOURCE_SHA,
                expected_source_tree=SOURCE_TREE,
            )

    def test_expected_source_commit_mismatch_fails(self) -> None:
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_EXPECTED_SOURCE_SHA_MISMATCH"
        ):
            verify_release(
                self.root,
                expected_source_sha="c" * 40,
                expected_source_tree=SOURCE_TREE,
            )

    def test_expected_source_tree_mismatch_fails(self) -> None:
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_EXPECTED_SOURCE_TREE_MISMATCH"
        ):
            verify_release(
                self.root,
                expected_source_sha=SOURCE_SHA,
                expected_source_tree="c" * 40,
            )

    def test_expected_source_pair_is_required_together(self) -> None:
        for kwargs in (
            {"expected_source_sha": SOURCE_SHA},
            {"expected_source_tree": SOURCE_TREE},
        ):
            with self.subTest(kwargs=tuple(kwargs)):
                with self.assertRaisesRegex(
                    ReleaseVerificationError, "RELEASE_EXPECTED_SOURCE_PAIR_REQUIRED"
                ):
                    verify_release(self.root, **kwargs)

    def test_invalid_expected_source_values_fail_closed(self) -> None:
        for kwargs, code in (
            (
                {"expected_source_sha": "INVALID", "expected_source_tree": SOURCE_TREE},
                "RELEASE_EXPECTED_SOURCE_SHA_INVALID",
            ),
            (
                {"expected_source_sha": SOURCE_SHA, "expected_source_tree": "NOT-GIT"},
                "RELEASE_EXPECTED_SOURCE_TREE_INVALID",
            ),
            (
                {
                    "expected_source_sha": SOURCE_SHA.upper(),
                    "expected_source_tree": SOURCE_TREE,
                },
                "RELEASE_EXPECTED_SOURCE_SHA_INVALID",
            ),
        ):
            with self.subTest(code=code):
                with self.assertRaisesRegex(ReleaseVerificationError, code):
                    verify_release(self.root, **kwargs)

    def _run_cli(self, *flags: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                "-B",
                str(Path(__file__).with_name("verify_ops_release.py")),
                *flags,
                str(self.root),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_cli_legacy_positional_mode_still_passes(self) -> None:
        result = self._run_cli()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["status"], "PASS")

    def test_cli_exact_expected_pair_succeeds(self) -> None:
        result = self._run_cli(
            "--expected-source-sha",
            SOURCE_SHA,
            "--expected-source-tree",
            SOURCE_TREE,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["sourceSha"], SOURCE_SHA)

    def test_cli_wrong_expected_tree_fails_without_accepted_release(self) -> None:
        result = self._run_cli(
            "--expected-source-sha",
            SOURCE_SHA,
            "--expected-source-tree",
            "c" * 40,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(
            json.loads(result.stderr)["code"], "RELEASE_EXPECTED_SOURCE_TREE_MISMATCH"
        )

    def test_json_integer_manifest_source_tree_rejected(self) -> None:
        manifest_path = self.root / "RELEASE_MANIFEST.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["sourceTree"] = int("1" * 40)
        manifest_path.write_text(json.dumps(manifest) + "\n")
        self._refresh_metadata()
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_SOURCE_TREE_INVALID"
        ):
            verify_release(
                self.root,
                expected_source_sha=SOURCE_SHA,
                expected_source_tree="1" * 40,
            )

    def test_json_integer_manifest_source_sha_rejected(self) -> None:
        digit_source_sha = "1" * 40
        self.root = self.root.rename(self.base / digit_source_sha)
        manifest_path = self.root / "RELEASE_MANIFEST.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["sourceSha"] = int(digit_source_sha)
        manifest_path.write_text(json.dumps(manifest) + "\n")
        self._refresh_metadata()
        with self.assertRaisesRegex(
            ReleaseVerificationError, "RELEASE_SOURCE_SHA_INVALID"
        ):
            verify_release(
                self.root,
                expected_source_sha=digit_source_sha,
                expected_source_tree=SOURCE_TREE,
            )


if __name__ == "__main__":
    unittest.main()
