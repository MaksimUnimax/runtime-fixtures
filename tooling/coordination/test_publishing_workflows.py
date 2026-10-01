"""The five required checks must start for every authorized publishing dialogue."""
from pathlib import Path
import re
import unittest


class PublishingWorkflowTests(unittest.TestCase):
    def test_all_five_required_workflows_run_for_each_dialogue_push(self):
        root = Path(__file__).resolve().parents[2]
        expected = {"main", "work/a-extension", "work/b-backend", "work/c-integration", "controller/**"}
        for name in ("coordination.yml", "documentation.yml", "extension-ci.yml", "extension-i1-ci.yml", "server-ci.yml"):
            with self.subTest(workflow=name):
                contents = (root / ".github/workflows" / name).read_text()
                match = re.search(r"(?ms)^  push:\s*\n    branches:\s*\[(.*?)\]", contents)
                self.assertIsNotNone(match, "explicit push branches are required")
                branches = {value.strip().strip('"').strip("'") for value in match[1].split(",") if value.strip()}
                self.assertEqual(branches, expected)


if __name__ == "__main__":
    unittest.main()
