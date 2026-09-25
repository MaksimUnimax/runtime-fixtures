from __future__ import annotations

import hashlib
import json
import os
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
                checksums.append(
                    f"{digest}  {path.relative_to(self.root).as_posix()}"
                )
        (self.root / "RELEASE_SHA256SUMS").write_text(
            "\n".join(checksums) + "\n"
        )

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


if __name__ == "__main__":
    unittest.main()
