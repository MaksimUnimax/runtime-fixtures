"""CLI contract for the optional offline operator breakdown."""

import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from test_reconcile import CLI, TARIFF, attempt


OPERATION = "0123456789abcdef" * 2


def attributed(attempt_id, workspace="workspace A", operation=OPERATION, source="chat.turn"):
    scope = {"workspace_id": workspace, "operation_id": operation, "source": source}
    return tuple({**event, "attribution": dict(scope)} for event in attempt(attempt_id))


class OperationSummaryTest(unittest.TestCase):
    def setUp(self):
        tmpdir = TemporaryDirectory(prefix="operations-reconcile-")
        self.addCleanup(tmpdir.cleanup)
        self.root = Path(tmpdir.name)
        self.tariffs = self.root / "tariffs.json"
        self.tariffs.write_text(json.dumps(TARIFF), encoding="utf-8")

    def report(self, events, code, *, breakdown=True):
        journal = self.root / "journal.jsonl"
        journal.write_text("".join(json.dumps(event) + "\n" for event in events), encoding="utf-8")
        args = [sys.executable, str(CLI), str(journal), "--tariffs", str(self.tariffs)]
        if breakdown:
            args.append("--by-operation")
        result = subprocess.run(args, capture_output=True, text=True, timeout=15, cwd=self.root)
        self.assertEqual(result.returncode, code, result.stderr + result.stdout)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["status"], "complete" if code == 0 else "partial")
        return summary

    def test_distinct_operations_separate_workspaces_and_sources(self):
        first, end = attributed("main-attempt")
        same_group = attributed("retry")
        second = attributed("other-workspace", workspace="workspace B", operation="b" * 32)
        background = attributed("other-source", source="jobs.v2-nightly_1", operation="c" * 32)
        records = [*second, end, *background, *same_group, first, end, *second]
        report = self.report(records, 0)
        self.assertEqual(report, self.report(list(reversed(records)), 0))
        self.assertEqual(report["duplicate_events"], 3)
        self.assertEqual((report["total_usd"], report["total_rub"]), ("6.2", "496"))
        attribution = report["attribution"]
        self.assertEqual(attribution["assigned_attempts"], 4)
        self.assertEqual(attribution["unassigned_attempts"], 0)
        self.assertEqual(attribution["status"], "complete")
        self.assertEqual(attribution["issues"], {})
        self.assertEqual([
            (row["workspace_id"], row["source"], row["operation_id"], row["unique_attempts"],
             row["duplicate_events"], row["total_usd"], row["total_rub"])
            for row in attribution["operations"]
        ], [
            ("workspace A", "chat.turn", OPERATION, 2, 1, "3.1", "248"),
            ("workspace A", "jobs.v2-nightly_1", "c" * 32, 1, 0, "1.55", "124"),
            ("workspace B", "chat.turn", "b" * 32, 1, 2, "1.55", "124"),
        ])

    def test_operation_binding_conflict_hides_all_disputed_groups_and_preserves_global_cost(self):
        for different_binding in ({"workspace": "workspace B"}, {"source": "jobs"}):
            with self.subTest(different_binding=different_binding):
                start, end = attributed("first")
                records = [start, *attributed("same-binding"), end,
                           *attributed("competing-binding", **different_binding), end,
                           *attributed("other-operation", operation="c" * 32)]
                report = self.report(records, 1)
                self.assertEqual(report, self.report(list(reversed(records)), 1))
                self.assertEqual(report["issues"], {})
                self.assertEqual((report["total_usd"], report["total_rub"]), ("6.2", "496"))
                self.assertEqual(report["duplicate_events"], 1)
                attribution = report["attribution"]
                self.assertEqual(attribution["status"], "partial")
                self.assertEqual(attribution["issues"], {"operation_binding_conflict": 3})
                self.assertEqual((attribution["assigned_attempts"], attribution["unassigned_attempts"]), (1, 3))
                only, = attribution["operations"]
                self.assertEqual((only["operation_id"], only["unique_attempts"], only["duplicate_events"]),
                                 ("c" * 32, 1, 0))
                self.assertEqual((only["total_usd"], only["total_rub"]), ("1.55", "124"))

    def test_legacy_attempt_keeps_global_amount_and_missing_assignment_visible(self):
        events = [*attributed("new"), *attempt("legacy")]
        aggregate = self.report(events, 0, breakdown=False)
        self.assertNotIn("attribution", aggregate)
        report = self.report(events, 1)
        attribution = report["attribution"]
        self.assertEqual(attribution["status"], "partial")
        self.assertEqual(attribution["issues"], {"missing_attribution": 1})
        self.assertEqual((attribution["assigned_attempts"], attribution["unassigned_attempts"]), (1, 1))
        self.assertEqual(report["issues"], {})
        for key, value in aggregate.items():
            if key != "status":
                self.assertEqual(report[key], value)
        self.assertEqual((report["total_usd"], report["total_rub"]), ("3.1", "248"))
        self.assertEqual(len(attribution["operations"]), 1)
        self.assertEqual(attribution["operations"][0]["total_usd"], "1.55")

    def test_missing_phase_can_be_assigned_but_has_no_verified_amount(self):
        start, _ = attributed("pending")
        _, finish = attributed("orphan", operation="a" * 32)
        report = self.report([start, *attributed("known"), start, finish], 1)
        attribution = report["attribution"]
        self.assertEqual(attribution["status"], "complete")
        self.assertEqual((attribution["assigned_attempts"], attribution["unassigned_attempts"]), (3, 0))
        regular, orphan = attribution["operations"]
        self.assertEqual(regular["issues"], {"missing_finish": 1})
        self.assertEqual(regular["duplicate_events"], 1)
        self.assertEqual(regular["known_usd"], "1.55")
        self.assertEqual(orphan["issues"], {"missing_admission": 1})
        self.assertEqual(orphan["known_usd"], "0")
        for row in (regular, orphan, report):
            self.assertEqual(row["status"], "partial")
            self.assertIsNone(row["total_usd"])
            self.assertIsNone(row["total_rub"])

    def test_missing_fx_only_invalidates_its_group_rub_total(self):
        start, end = attributed("no-fx")
        end["quote"].update(fx_rub_per_usd=None, rub_peak_estimate=None)
        report = self.report([start, end, *attributed("known", workspace="workspace B", operation="b" * 32)], 1)
        self.assertEqual(report["attribution"]["status"], "complete")
        incomplete, complete = report["attribution"]["operations"]
        self.assertEqual((incomplete["status"], incomplete["total_usd"], incomplete["total_rub"]),
                         ("partial", "1.55", None))
        self.assertEqual((complete["status"], complete["total_usd"], complete["total_rub"]),
                         ("complete", "1.55", "124"))
        self.assertEqual((report["total_usd"], report["known_rub"], report["total_rub"]),
                         ("3.1", "124", None))

    def test_malformed_scope_is_unassigned_without_normalizing_identifiers(self):
        valid = attributed("seed")[0]["attribution"]
        examples = [None, [], {"operation_id": OPERATION},
                    {**valid, "extra": True}, {**valid, "operation_id": "A" * 32},
                    {**valid, "operation_id": "a" * 33}, {**valid, "source": "job/1"},
                    {**valid, "source": "x" * 65}, {**valid, "source": "1jobs"}]
        examples += [{**valid, "workspace_id": value} for value in ("", "x\x00y", " x", "x ", "я" * 257)]
        events = [
            {**event, "attribution": scope}
            for index, scope in enumerate(examples)
            for event in attempt(f"invalid-{index}")
        ]
        # Exercise both inclusive length bounds and an opaque Unicode workspace identifier.
        events.extend(attributed("boundary", workspace="я" * 256, source="a" * 64))
        report = self.report(events, 1)
        attribution = report["attribution"]
        self.assertEqual(attribution["issues"], {"invalid_attribution": len(examples)})
        self.assertEqual(attribution["unassigned_attempts"], len(examples))
        self.assertEqual(attribution["assigned_attempts"], 1)
        self.assertEqual([row["workspace_id"] for row in attribution["operations"]], ["я" * 256])
        self.assertEqual(attribution["operations"][0]["unique_attempts"], 1)

    def test_mismatched_scope_across_phases_invalidates_aggregate_and_group(self):
        start, end = attributed("mixed-phases")
        other = {**end, "attribution": {**end["attribution"], "workspace_id": "workspace B"}}
        legacy_end = {key: value for key, value in end.items() if key != "attribution"}
        for terminal in (other, legacy_end):
            with self.subTest(scope=terminal.get("attribution")):
                for breakdown in (False, True):
                    report = self.report([start, terminal], 1, breakdown=breakdown)
                    self.assertEqual(report["known_usd"], "0")
                    self.assertIsNone(report["total_rub"])
                    self.assertIsNone(report["total_usd"])
                    if breakdown:
                        self.assertEqual(report["attribution"]["issues"], {"attribution_mismatch": 1})
                        self.assertEqual(report["attribution"]["operations"], [])

    def test_conflict_within_phase_excludes_even_a_consistent_scope(self):
        start, end = attributed("conflict")
        for disputed in (
            {**end, "attribution": {**end["attribution"], "operation_id": "b" * 32}},
            {**end, "outcome": "client_disconnected"},
        ):
            events = [start, end, disputed, end, *attributed("valid")]
            result = self.report(events, 1)
            self.assertEqual(result, self.report(list(reversed(events)), 1))
            self.assertEqual(result["duplicate_events"], 1)
            self.assertIsNone(result["total_usd"])
            self.assertEqual(result["attribution"]["issues"], {"conflicting_events": 1})
            self.assertEqual(result["attribution"]["assigned_attempts"], 1)
            row, = result["attribution"]["operations"]
            self.assertEqual((row["unique_attempts"], row["duplicate_events"], row["total_usd"]),
                             (1, 0, "1.55"))

    def test_empty_journal_cannot_report_complete_attribution(self):
        report = self.report([], 1)
        self.assertEqual(report["attribution"], {
            "status": "partial", "assigned_attempts": 0, "unassigned_attempts": 0,
            "issues": {"empty_journal": 1}, "operations": [],
        })


if __name__ == "__main__":
    unittest.main()
