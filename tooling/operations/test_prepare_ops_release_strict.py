from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
PREPARER = REPO / "infra/production/scripts/prepare-octoport-ops-release.sh"
VERIFIER = REPO / "tooling/operations/verify_ops_release.py"
SOURCE_SHA = "a" * 40
SOURCE_TREE = "b" * 40
FOREIGN_SHA = "c" * 40
FOREIGN_TREE = "d" * 40


class ReleasePreparerStrictSourceIdentityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(
            prefix="strict-release-", dir=os.environ.get("TMPDIR")
        )
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.source = PREPARER.read_text(encoding="utf-8")
        self.invocation = self._verifier_invocation(self.source)

    @staticmethod
    def _verifier_invocation(script: str) -> str:
        lines = script.splitlines()
        found = [
            index
            for index, line in enumerate(lines)
            if line.lstrip().startswith("python3 ")
            and "/tooling/operations/verify_ops_release.py" in line
        ]
        if len(found) != 1:
            raise AssertionError("EXPECTED_ONE_FINAL_VERIFIER_CALL")
        gathered: list[str] = []
        for line in lines[found[0] :]:
            plain = line.rstrip()
            if "||" in plain:
                gathered.append(plain.rsplit("||", 1)[0].rstrip())
                break
            gathered.append(plain)
            if not plain.endswith("\\"):
                break
        else:
            raise AssertionError("VERIFIER_CALL_TERMINATOR_MISSING")
        fragment = "\n".join(gathered)
        if not fragment.endswith(">/dev/null"):
            raise AssertionError("EXPECTED_RELEASE_VERIFIER_OUTPUT_BOUNDARY")
        return fragment

    def _make_valid_release(self, sha: str, tree: str) -> Path:
        root = self.base / sha
        (root / "tooling/operations").mkdir(parents=True, mode=0o755)
        root.chmod(0o755)
        (root / "tooling").chmod(0o755)
        (root / "tooling/operations").chmod(0o755)
        shutil.copy2(VERIFIER, root / "tooling/operations/verify_ops_release.py")
        (root / "payload.txt").write_text("synthetic\n", encoding="utf-8")
        (root / "RELEASE_MANIFEST.json").write_text(
            json.dumps(
                {
                    "format": "octoport-ops-release-v1",
                    "sourceSha": sha,
                    "sourceTree": tree,
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        (root / "RELEASE_SYMLINKS").write_text("", encoding="utf-8")
        checksums: list[str] = []
        for file in sorted(root.rglob("*")):
            if file.is_file() and file.name != "RELEASE_SHA256SUMS":
                digest = hashlib.sha256(file.read_bytes()).hexdigest()
                checksums.append(f"{digest}  {file.relative_to(root).as_posix()}")
        (root / "RELEASE_SHA256SUMS").write_text(
            "\n".join(checksums) + "\n", encoding="utf-8"
        )
        return root

    def _run_real_final_invocation(
        self, target: Path, expected_sha: str, expected_tree: str
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env.update(
            {
                "target": str(target),
                "head_sha": expected_sha,
                "tree_sha": expected_tree,
                "PYTHONDONTWRITEBYTECODE": "1",
            }
        )
        return subprocess.run(
            ["bash", "-c", self.invocation],
            env=env,
            text=True,
            capture_output=True,
            timeout=12,
        )

    def test_original_bash_script_is_syntactically_valid(self) -> None:
        result = subprocess.run(
            ["bash", "-n", str(PREPARER)],
            text=True,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_final_call_binds_both_independent_source_identifiers(self) -> None:
        self.assertIn("--expected-source-sha", self.invocation)
        self.assertIn("--expected-source-tree", self.invocation)
        self.assertIn("head_sha", self.invocation)
        self.assertIn("tree_sha", self.invocation)
        self.assertIn("target", self.invocation)
        self.assertIn("git -C", self.source)
        self.assertRegex(self.source, r"head_sha=.*rev-parse HEAD")
        self.assertRegex(self.source, r"tree_sha=.*rev-parse HEAD\^\{tree\}")
        self.assertLess(
            self.source.index("tree_sha="),
            self.source.index("/tooling/operations/verify_ops_release.py"),
        )

    def test_final_call_accepts_exact_internally_valid_source(self) -> None:
        release = self._make_valid_release(SOURCE_SHA, SOURCE_TREE)
        result = self._run_real_final_invocation(release, SOURCE_SHA, SOURCE_TREE)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_final_call_rejects_other_internally_valid_source(self) -> None:
        release = self._make_valid_release(FOREIGN_SHA, FOREIGN_TREE)
        # This is a fully checksum-valid release, not a tampered payload.
        verifier = subprocess.run(
            ["python3", "-B", str(VERIFIER), str(release)],
            text=True,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(verifier.returncode, 0, verifier.stderr)
        failed = self._run_real_final_invocation(release, SOURCE_SHA, SOURCE_TREE)
        self.assertEqual(failed.returncode, 1)
        self.assertEqual(
            json.loads(failed.stderr)["code"],
            "RELEASE_EXPECTED_SOURCE_SHA_MISMATCH",
        )

    def test_final_call_rejects_different_tree_for_same_source_sha(self) -> None:
        release = self._make_valid_release(SOURCE_SHA, FOREIGN_TREE)
        # Source SHA is the intended one, but the internally valid Git-tree
        # differs from the clean source checkout's trusted tree identity.
        original = subprocess.run(
            ["python3", "-B", str(VERIFIER), str(release)],
            text=True,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(original.returncode, 0, original.stderr)
        failed = self._run_real_final_invocation(release, SOURCE_SHA, SOURCE_TREE)
        self.assertEqual(failed.returncode, 1)
        self.assertEqual(
            json.loads(failed.stderr)["code"],
            "RELEASE_EXPECTED_SOURCE_TREE_MISMATCH",
        )


if __name__ == "__main__":
    unittest.main()
