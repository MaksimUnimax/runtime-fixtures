import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from acceptance.archive_chat.check import run_check


@unittest.skipUnless(os.environ.get("HARNESS_NODE_MODULES"), "requires pinned native Harness")
class ArchiveChatAcceptance(unittest.TestCase):
    def test_authenticated_turn_matches_fixture_and_survives_restart(self):
        fixtures = Path(__file__).resolve().parents[1] / "acceptance/archive_chat/fixtures"
        source = fixtures / "input"
        with TemporaryDirectory() as directory:
            archive = Path(directory) / "sample.zip"
            with ZipFile(archive, "w") as zip_file:
                for member in source.rglob("*.json"):
                    zip_file.write(member, member.relative_to(source))
            expected = json.loads((fixtures / "expected.json").read_text(encoding="utf-8"))
            self.assertEqual(run_check(archive, expected["date"]), expected)
