import pathlib
import subprocess
import tempfile
import unittest

from exact_candidate_gate import verify


class ExactCandidateGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = pathlib.Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.base = self.commit("base.txt", "base\n")

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-C", str(self.repo), *args], text=True, stderr=subprocess.DEVNULL
        ).strip()

    def commit(self, name, contents):
        (self.repo / name).write_text(contents)
        self.git("add", name)
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def test_clean_final_delta_records_exact_tree(self):
        head = self.commit("code.txt", "valid\n")
        proof = verify(self.repo, self.base, head)
        self.assertEqual(proof["head"], head)
        self.assertEqual(proof["tree"], self.git("rev-parse", "HEAD^{tree}"))

    def test_clean_last_commit_cannot_hide_parent_whitespace(self):
        self.commit("code.txt", "valid\n\n")
        head = self.commit("README.md", "A useful link\n")
        self.git("diff", "--check", "HEAD^..HEAD")
        with self.assertRaisesRegex(ValueError, "blank line at EOF"):
            verify(self.repo, self.base, head)

    def test_whitespace_successor_repairs_full_delta(self):
        self.commit("code.txt", "valid\n\n")
        head = self.commit("code.txt", "valid\n")
        self.assertTrue(verify(self.repo, self.base, head)["full_delta_check"])

    def test_dirty_worktree_is_rejected(self):
        head = self.commit("code.txt", "valid\n")
        (self.repo / "untracked.txt").write_text("uncommitted\n")
        with self.assertRaisesRegex(ValueError, "dirty"):
            verify(self.repo, self.base, head)

    def test_wrong_final_head_is_rejected(self):
        self.commit("code.txt", "valid\n")
        with self.assertRaisesRegex(ValueError, "differs"):
            verify(self.repo, self.base, self.base)

    def test_missing_base_is_rejected(self):
        head = self.commit("code.txt", "valid\n")
        with self.assertRaises(ValueError):
            verify(self.repo, "missing-ref", head)

    def test_unrelated_base_is_rejected(self):
        head = self.commit("code.txt", "valid\n")
        self.git("checkout", "--orphan", "other")
        self.git("rm", "-rf", ".")
        unrelated = self.commit("unrelated.txt", "independent\n")
        self.git("checkout", "--detach", head)
        with self.assertRaises(ValueError):
            verify(self.repo, unrelated, head)


if __name__ == "__main__":
    unittest.main()
