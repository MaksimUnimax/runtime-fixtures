import json
import tempfile
import unittest
from pathlib import Path
from work_queue import advance_task, status_work, claim_task, compact_state
from audit_check import render_blockers


class SilentBlockerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "controllers").mkdir()
        (self.root / "logs").mkdir()
        for role in "ABC":
            (self.root / (role + ".json")).write_text(json.dumps({"status": "RUNNING"}))
        self.board = {"version": 1, "revision": 1, "tasks": [
            {"id": "delivery", "role": "C", "plan": "C06", "state": "IN_PROGRESS",
             "requires": [], "paths": ["release.md"], "result": "Версия для установки",
             "outcome_kind": "OWNER_INSTALLABLE_DELIVERY"},
            {"id": "product", "role": "A", "plan": "A04", "state": "READY",
             "requires": [], "paths": ["product.py"], "result": "Independent product"},
        ]}
        (self.root / "controllers/work-board.json").write_text(json.dumps(self.board))
        self.receipt = self.root / "logs/refusal.json"
        self.receipt.write_text('{"status":"BLOCKED_BEFORE_EXECUTION"}')

    def block(self):
        return advance_task(self.root, "C", "delivery", "BLOCKED",
                            str(self.receipt), "Инструмент отклонил операцию")

    def test_transition_requires_immediate_notice_not_owner_permission(self):
        event = self.block()
        alert = event["owner_attention"][0]
        self.assertTrue(alert["immediate_chat_notice_required"])
        self.assertEqual(alert["resolver"], "CONTROLLER")
        self.assertEqual(alert["task_id"], "delivery")
        self.assertNotIn("owner_action_required", alert)

    def test_switch_to_independent_work_does_not_hide_blocker(self):
        self.block()
        claim_task(self.root, "A", "product")
        state = status_work(self.root, "A")
        self.assertEqual(state["owner_attention"][0]["task_id"], "delivery")
        self.assertTrue(state["action_required"])
        self.assertEqual(compact_state({"role": "A", "work_queue": state})["work_queue"], state)

    def test_blocked_only_status_is_not_quiet(self):
        self.board["tasks"] = self.board["tasks"][:1]
        (self.root / "controllers/work-board.json").write_text(json.dumps(self.board))
        self.block()
        state = status_work(self.root, "C")
        self.assertTrue(state["action_required"])
        self.assertTrue(state["owner_attention"])

    def test_legacy_direct_block_is_visible_without_transition_event(self):
        self.board["tasks"][0].update(state="BLOCKED", blocked_reason="legacy refusal")
        (self.root / "controllers/work-board.json").write_text(json.dumps(self.board))
        text, alerts = render_blockers(self.root)
        self.assertEqual(alerts[0]["task_id"], "delivery")
        self.assertIn("legacy refusal", text)
        self.assertIn("Следующий шаг", text)

    def test_early_notice_does_not_mark_delivered_or_complete(self):
        self.block()
        text, alerts = render_blockers(self.root)
        self.assertTrue(alerts)
        saved = json.loads((self.root / "controllers/work-board.json").read_text())
        self.assertEqual(saved["tasks"][0]["state"], "BLOCKED")
        self.assertNotIn("message_delivered", saved["tasks"][0])

    def test_resume_with_evidence_removes_resolved_alert(self):
        self.block()
        advance_task(self.root, "C", "delivery", "IN_PROGRESS", str(self.receipt))
        self.assertEqual(status_work(self.root, "A")["owner_attention"], [])


if __name__ == "__main__":
    unittest.main()
