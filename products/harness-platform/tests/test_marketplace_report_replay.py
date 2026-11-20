import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from zipfile import ZipFile

from acceptance.marketplace_reports.replay import main, verify_archive


SAMPLE = Path(__file__).resolve().parents[1] / "acceptance/marketplace_reports/fixtures/sample_day"
SAMPLE_RESULT = SAMPLE.parent / "sample_result.json"
SUMMARY = "SUMMARY.json"
RECONCILIATION = "ADVERTISING_SOURCE_RECONCILIATION.json"
OZON_LEDGER = "OZON_PHYSICAL_UNIT_LEDGER.csv"
WB_LEDGER = "WB_PHYSICAL_UNIT_LEDGER.csv"


class MarketplaceReportReplayTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "sample.zip"
        self.members = {path.name: path.read_text(encoding="utf-8") for path in SAMPLE.iterdir()}

    def write_archive(self):
        with ZipFile(self.path, "w") as archive:
            for name, content in self.members.items():
                archive.writestr(name, content)

    def replay(self):
        self.write_archive()
        return verify_archive(self.path)

    def test_report_uses_original_turnover_and_rounds_after_aggregation(self):
        expected = json.loads(SAMPLE_RESULT.read_text(encoding="utf-8"))
        self.assertEqual(self.replay(), expected)

    def run_comparison(self, actual):
        self.write_archive()
        output_path = self.path.parent / "connector.json"
        output_path.write_text(json.dumps(actual), encoding="utf-8")
        stdout = StringIO()
        stderr = StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            status = main([str(self.path), "--actual", str(output_path)])
        return status, stdout.getvalue(), stderr.getvalue()

    def test_cli_accepts_matching_connector_with_extra_metadata(self):
        expected = json.loads(SAMPLE_RESULT.read_text(encoding="utf-8"))
        actual = json.loads(SAMPLE_RESULT.read_text(encoding="utf-8"))
        actual["wb"]["currency"] = "RUB"
        actual["connector_revision"] = 1
        status, output, errors = self.run_comparison(actual)
        self.assertEqual(status, 0, errors)
        self.assertEqual(json.loads(output), expected)

    def test_cli_reports_mismatched_or_missing_connector_fields(self):
        for field, value in (("drr_percent", "2.00"), ("ordered_units", True), ("advertising_rub", None)):
            with self.subTest(field=field):
                actual = json.loads(SAMPLE_RESULT.read_text(encoding="utf-8"))
                if value is None:
                    del actual["wb"][field]
                else:
                    actual["wb"][field] = value
                status, output, errors = self.run_comparison(actual)
                self.assertNotEqual(status, 0)
                self.assertEqual(output, "")
                self.assertIn(f"wb.{field}", errors)

    def test_summary_must_include_both_stores(self):
        summary = json.loads(self.members[SUMMARY])
        summary["stores"].pop()
        self.members[SUMMARY] = json.dumps(summary)
        with self.assertRaises(ValueError):
            self.replay()

    def test_missing_ledger_fails_even_if_summary_is_complete(self):
        del self.members[WB_LEDGER]
        with self.assertRaises(ValueError):
            self.replay()

    def test_duplicate_archive_member_is_ambiguous(self):
        self.write_archive()
        with self.assertWarns(UserWarning), ZipFile(self.path, "a") as archive:
            archive.writestr(SUMMARY, self.members[SUMMARY])
        with self.assertRaises(ValueError):
            verify_archive(self.path)

    def test_incorrect_store_figures_cannot_cancel_out_in_the_total(self):
        summary = json.loads(self.members[SUMMARY])
        summary["stores"][0]["remaining_without_rub"] = "121.30"
        summary["stores"][1]["remaining_without_rub"] = "16.04"
        self.members[SUMMARY] = json.dumps(summary)
        with self.assertRaises(ValueError):
            self.replay()

    def test_summary_cannot_replace_weighted_drr_with_mean(self):
        summary = json.loads(self.members[SUMMARY])
        summary["combined"]["drr_percent"] = "9.08"
        self.members[SUMMARY] = json.dumps(summary)
        with self.assertRaises(ValueError):
            self.replay()

    def test_operational_amount_cannot_replace_posted_advertising(self):
        reconciliation = json.loads(self.members[RECONCILIATION])
        reconciliation.update(wb_posted_rub="31.17", wb_posted_minus_operational_rub="0")
        self.members[RECONCILIATION] = json.dumps(reconciliation)
        with self.assertRaises(ValueError):
            self.replay()

    def test_advertising_difference_keeps_its_sign(self):
        reconciliation = json.loads(self.members[RECONCILIATION])
        reconciliation["wb_posted_minus_operational_rub"] = "1.17"
        self.members[RECONCILIATION] = json.dumps(reconciliation)
        with self.assertRaises(ValueError):
            self.replay()

    def test_missing_operational_amount_does_not_override_posted_spend(self):
        reconciliation = json.loads(self.members[RECONCILIATION])
        reconciliation.update(wb_operational_rub=None, wb_posted_minus_operational_rub=None)
        self.members[RECONCILIATION] = json.dumps(reconciliation)
        result = self.replay()
        self.assertEqual(result["wb"]["advertising_rub"], "30.00")
        self.assertIsNone(result["wb_advertising"]["operational_rub"])
        self.assertIsNone(result["wb_advertising"]["posted_minus_operational_rub"])
        self.assertEqual(result["wb_advertising"]["operational_coverage"], "unavailable")
        self.assertEqual(result["wb_advertising"]["missing_campaign_count"], 2)

    def test_operational_coverage_depends_on_source_completeness(self):
        reconciliation = json.loads(self.members[RECONCILIATION])
        reconciliation["missing_wb_fullstats_campaign_ids"] = []
        self.members[RECONCILIATION] = json.dumps(reconciliation)
        with self.subTest("explicitly complete"):
            ads = self.replay()["wb_advertising"]
            self.assertEqual(ads["operational_coverage"], "reported_complete")
            self.assertEqual(ads["missing_campaign_count"], 0)

        del reconciliation["missing_wb_fullstats_campaign_ids"]
        self.members[RECONCILIATION] = json.dumps(reconciliation)
        with self.subTest("unknown coverage"):
            ads = self.replay()["wb_advertising"]
            self.assertEqual(ads["operational_coverage"], "unknown")
            self.assertIsNone(ads["missing_campaign_count"])

        reconciliation.update(wb_operational_rub=None, wb_posted_minus_operational_rub=None)
        self.members[RECONCILIATION] = json.dumps(reconciliation)
        with self.subTest("no operational data or coverage"):
            ads = self.replay()["wb_advertising"]
            self.assertEqual(ads["operational_coverage"], "unavailable")
            self.assertIsNone(ads["missing_campaign_count"])

    def test_cli_rejects_full_coverage_on_an_incomplete_day(self):
        actual = json.loads(SAMPLE_RESULT.read_text(encoding="utf-8"))
        actual["wb_advertising"]["operational_coverage"] = "reported_complete"
        status, output, errors = self.run_comparison(actual)
        self.assertNotEqual(status, 0)
        self.assertEqual(output, "")
        self.assertIn("wb_advertising.operational_coverage", errors)

    def test_charge_without_any_units_cannot_be_verified_from_a_unit_ledger(self):
        header, _ = self.members[WB_LEDGER].splitlines()
        self.members[WB_LEDGER] = header + "\n"
        summary = json.loads(self.members[SUMMARY])
        summary["stores"][1].update(
            ordered_units="0", original_turnover_rub="0", advertising_rub="30",
            remaining_with_rub="-30", remaining_without_rub="-30", drr_percent=None,
        )
        summary["combined"].update(
            ordered_units="3", original_turnover_rub="960", advertising_rub="84.37",
            remaining_with_rub="60.012", remaining_without_rub="90.30",
            drr_percent="8.788541666666666666666666667",
        )
        self.members[SUMMARY] = json.dumps(summary)
        with self.assertRaisesRegex(ValueError, "unallocated"):
            self.replay()

    def test_mixed_report_dates_fail(self):
        with self.subTest("advertising reconciliation"):
            reconciliation = json.loads(self.members[RECONCILIATION])
            reconciliation["date"] = "2001-02-04"
            self.members[RECONCILIATION] = json.dumps(reconciliation)
            with self.assertRaises(ValueError):
                self.replay()
        with self.subTest("store"):
            self.members[RECONCILIATION] = (SAMPLE / RECONCILIATION).read_text(encoding="utf-8")
            summary = json.loads(self.members[SUMMARY])
            summary["stores"][0]["date"] = "2001-02-04"
            self.members[SUMMARY] = json.dumps(summary)
            with self.assertRaises(ValueError):
                self.replay()

    def test_drr_is_unknown_with_zero_turnover_and_posted_spend(self):
        self.members[OZON_LEDGER] = self.members[OZON_LEDGER].replace(",320,", ",0,")
        self.members[WB_LEDGER] = self.members[WB_LEDGER].replace(",240,", ",0,")
        summary = json.loads(self.members[SUMMARY])
        for totals in [*summary["stores"], summary["combined"]]:
            totals.update(original_turnover_rub="0", drr_percent=None)
        self.members[SUMMARY] = json.dumps(summary)
        result = self.replay()
        self.assertEqual(result["combined"]["advertising_rub"], "84.37")
        for scope in ("ozon", "wb", "combined"):
            self.assertIsNone(result[scope]["drr_percent"])
