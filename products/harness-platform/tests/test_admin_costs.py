import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from platform_core.admin_costs import AdminCosts, present_chat


class EstimateProjection(unittest.TestCase):
    def setUp(self):
        base = Path(__file__).resolve().parents[1] / "usage-reconciliation"
        sample = (base / "example-operations.jsonl").read_text().splitlines()
        self.rows = [json.loads(line) for line in sample]
        for row in self.rows:
            row["attribution"]["source"] = "chat.turn"
        self.op = self.rows[0]["attribution"]["operation_id"]
        self.costs = AdminCosts()
        self.costs.journal = Path(self.enterContext(tempfile.TemporaryDirectory())) / "meter.jsonl"
        self.costs.tariffs = base / "tariffs.json"

    def write(self, rows):
        self.costs.journal.write_text("".join(json.dumps(row) + "\n" for row in rows))

    def read(self):
        return self.costs.for_operations("demo-a", {self.op}).get(self.op)

    def test_uses_verified_group_and_never_reuses_stale_amount(self):
        self.assertIsNone(self.read())
        self.write(self.rows)
        self.assertEqual(self.read()["rub"], "0.00144")
        with patch("platform_core.admin_costs.index_journal", side_effect=AssertionError):
            self.assertEqual(self.read()["rub"], "0.00144")
            self.assertEqual(self.costs.for_operations("demo-b", {self.op}), {})
        self.write(self.rows[:3])
        self.assertEqual(self.read(), {"rub": None, "usd": None})
        self.rows[1]["quote"].update(fx_rub_per_usd=None, rub_peak_estimate=None)
        self.write(self.rows[:2])
        self.assertEqual(self.read(), {"rub": None, "usd": "0.000009"})
        self.costs.journal.write_text("invalid\n")
        self.assertIsNone(self.read())
        self.costs.journal.unlink()
        self.assertIsNone(self.read())

    def test_disputed_attempt_cannot_turn_subtotal_into_full_price(self):
        self.write([*self.rows, {**self.rows[1], "outcome": "disconnected"}])
        self.assertIsNone(self.read())
        other = self.rows[-1]["attribution"]["operation_id"]
        self.assertEqual(self.costs.for_operations("demo-b", {other})[other]["rub"], "0.00336")

    def test_revocation_while_reading_releases_only_message_text(self):
        from unittest.mock import Mock
        identity, costs, scope = Mock(), Mock(), Mock()
        identity.chat_receipts.return_value = {}
        identity.can_view_costs.side_effect = [True, False]
        costs.for_operations.return_value = {self.op: {"rub": "1", "usd": "0.01"}}
        result = {"messages": [{"text": "answer", "operationId": self.op}], "events": []}
        self.assertEqual(present_chat(identity, costs, "session", scope, "events", result),
                         {"messages": [{"text": "answer"}], "events": []})
