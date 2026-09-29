"""End-to-end ownership checks against real, disposable Git merge graphs."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("merge_control", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)
RULES = {"roles": {
    "A": {"allow": ["apps/extension/**"], "deny": []},
    "B": {"allow": ["apps/api/**"], "deny": []},
    "C": {"allow": ["**"], "deny": ["apps/site/**"]},
}}


class MergeOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Isolated guard test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "core.hooksPath", str(self.repo / "empty-test-hooks"))
        self.put("base.txt", "base")
        self.commit("base")
        self.base = self.git("rev-parse", "HEAD")

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.repo), *args], check=True, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ).stdout.strip()

    def put(self, path, text):
        p = self.repo / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-qm", message)

    def merge(self, local, incoming, accepted=False, remote=True):
        self.git("checkout", "-qb", "candidate")
        self.put(incoming, "incoming")
        self.commit("incoming")
        candidate = self.git("rev-parse", "HEAD")
        self.git("checkout", "-qb", "local", self.base)
        self.put(local, "local")
        self.commit("local")
        if remote:
            self.git("update-ref", "refs/remotes/origin/main",
                     candidate if accepted else self.git("rev-parse", "HEAD"))
        self.git("merge", "--no-ff", "--no-commit", "candidate")

    def guard(self, role):
        with patch.object(control, "ROOT", self.repo), patch.object(control, "policy", return_value=RULES):
            return control.scope_guard(role)

    def test_c_accepts_old_candidate_without_rechecking_accepted_site(self):
        self.merge("apps/site/accepted.html", "docs/new.md")
        self.assertEqual(self.guard("C"), ["docs/new.md"])

    def test_c_accepts_backend_candidate_after_unrelated_site(self):
        self.merge("apps/site/accepted.html", "apps/api/new.py")
        self.assertEqual(self.guard("C"), ["apps/api/new.py"])

    def test_a_can_import_accepted_backend_main(self):
        self.merge("apps/extension/local.js", "apps/api/accepted.py", accepted=True)
        self.assertEqual(self.guard("A"), ["apps/extension/local.js"])

    def test_b_can_import_accepted_extension_main(self):
        self.merge("apps/api/local.py", "apps/extension/accepted.js", accepted=True)
        self.assertEqual(self.guard("B"), ["apps/api/local.py"])

    def test_c_rejects_new_forbidden_site_delta(self):
        self.merge("docs/local.md", "apps/site/new.html")
        with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION.*apps/site/new.html"):
            self.guard("C")

    def test_a_rejects_unaccepted_backend_candidate(self):
        self.merge("apps/extension/local.js", "apps/api/new.py")
        with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION"):
            self.guard("A")

    def test_missing_remote_rejects_instead_of_hiding_forbidden_candidate(self):
        self.merge("docs/local.md", "apps/site/new.html", remote=False)
        with self.assertRaisesRegex(RuntimeError, "MERGE_ANCESTRY_UNVERIFIED"):
            self.guard("C")

    def test_merge_resolution_cannot_add_foreign_edits(self):
        self.merge("apps/extension/local.js", "apps/api/accepted.py", accepted=True)
        self.put("apps/api/accepted.py", "unauthorized resolution")
        with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION"):
            self.guard("A")

    def test_untracked_foreign_file_is_still_rejected(self):
        self.merge("docs/local.md", "docs/incoming.md")
        self.put("apps/site/untracked.html", "foreign")
        with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION"):
            self.guard("C")

    def test_nonmerge_local_change_remains_guarded_without_remote(self):
        self.put("apps/site/new.html", "foreign")
        self.git("add", ".")
        with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION"):
            self.guard("C")


if __name__ == "__main__":
    unittest.main()

