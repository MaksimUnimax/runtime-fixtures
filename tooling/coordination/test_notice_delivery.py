import json
from pathlib import Path
import tempfile
import unittest

import control

from notice_delivery import read_controller_notices


class NoticeDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, name, data):
        path = self.root / name
        path.write_text(json.dumps(data))
        return path

    def test_canonical_and_to_only_notices_are_both_delivered(self):
        self.write("A-canonical.json", {"id": "canonical", "role": "A", "status": "OPEN"})
        legacy = self.write("A-to.json", {"id": "legacy", "to": "A", "status": "OPEN",
                                         "later_stop_wins": True})
        before = legacy.read_bytes()
        notices = read_controller_notices(self.root, "A")
        self.assertEqual([row["id"] for row in notices], ["canonical", "legacy"])
        self.assertTrue(all(row["role"] == "A" for row in notices))
        self.assertTrue(notices[1]["later_stop_wins"])
        self.assertEqual(legacy.read_bytes(), before)

    def test_real_status_entrypoint_delivers_to_only_notice(self):
        directory = self.root / "controller-notices"
        directory.mkdir()
        (directory / "B-owner.json").write_text(json.dumps({
            "id": "B-owner", "to": "B", "status": "OPEN",
            "task": "Reproduce owner failure", "later_stop_wins": True,
        }))
        previous = control.CONTROL
        self.addCleanup(setattr, control, "CONTROL", previous)
        control.CONTROL = self.root
        notices = control.controller_notices("B")
        self.assertEqual([row["id"] for row in notices], ["B-owner"])
        self.assertTrue(notices[0]["later_stop_wins"])

    def test_target_role_only_notice_is_delivered_without_mutating_history(self):
        notice = self.write("C-target.json", {"id": "target", "target_role": "C", "status": "ACTIVE"})
        before = notice.read_bytes()
        delivered = read_controller_notices(self.root, "C")
        self.assertEqual([row["id"] for row in delivered], ["target"])
        self.assertEqual(delivered[0]["role"], "C")
        self.assertEqual(notice.read_bytes(), before)

    def test_matching_recipient_aliases_do_not_duplicate_delivery(self):
        self.write("B-current.json", {
            "role": "B", "to": "B", "target_role": "B", "status": "OPEN"
        })
        self.assertEqual(len(read_controller_notices(self.root, "B")), 1)

    def test_missing_or_conflicting_recipient_is_visible_error(self):
        for data in ({}, {"role": "B"}, {"to": "B"}, {"target_role": "B"},
                     {"role": "A", "to": "B"}, {"role": "A", "target_role": "B"},
                     {"to": "A", "target_role": "B"}, {"role": None, "to": "A"},
                     {"role": "", "target_role": "A"}, {"target_role": None}):
            with self.subTest(data=data):
                self.write("A-invalid.json", data)
                with self.assertRaisesRegex(ValueError, "NOTICE_RECIPIENT_MISMATCH: A-invalid.json"):
                    read_controller_notices(self.root, "A")

    def test_wrong_shape_is_visible_error(self):
        self.write("C-invalid.json", [])
        with self.assertRaisesRegex(ValueError, "NOTICE_OBJECT_REQUIRED"):
            read_controller_notices(self.root, "C")

    def test_closed_and_superseded_are_not_reactivated(self):
        self.write("C-closed.json", {"status": "CLOSED"})
        self.write("C-superseded.json", {"status": "SUPERSEDED"})
        self.write("C-open.json", {"role": "C", "status": "OPEN"})
        self.assertEqual(len(read_controller_notices(self.root, "C")), 1)

    def test_other_role_is_not_delivered(self):
        self.write("A-other.json", {"role": "A", "status": "OPEN"})
        self.assertEqual(read_controller_notices(self.root, "B"), [])

    def test_nonterminal_status_is_preserved(self):
        self.write("A-deferred.json", {"role": "A", "status": "DEFERRED_OWNER_STOP"})
        self.assertEqual(read_controller_notices(self.root, "A")[0]["status"],
                         "DEFERRED_OWNER_STOP")


if __name__ == "__main__":
    unittest.main()
