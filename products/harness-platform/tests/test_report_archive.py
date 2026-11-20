import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from zipfile import ZipFile

from platform_core.catalog import Catalog
from platform_core.dispatch import Dispatcher, InvalidToolInput, ToolExecutionFailed, UnavailableTool
from platform_core.storage import Scope, Store
from report_archive.normalize import read_report
from report_archive.plugin import PLUGINS, archive_path


DAY = "2001-02-03"
TOOL = "marketplace_daily_archive"
FIXTURES = Path(__file__).resolve().parents[1] / "acceptance/archive_chat/fixtures"
OZON = f"demo/snapshots/{DAY}/asof-sample/UNIT_ECONOMICS.json"
WB = f"WB/snapshots/sample/{DAY}.json"


class ReportArchiveTests(TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.zip_path = self.root / "report.zip"
        self.expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
        self.sources = {
            name: json.loads((FIXTURES / "input" / name).read_text(encoding="utf-8"))
            for name in (OZON, WB)
        }

    def write_report(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(path, "w") as archive:
            for name, record in self.sources.items():
                archive.writestr(name, json.dumps(record, ensure_ascii=False))

    def read(self):
        self.write_report(self.zip_path)
        return read_report(self.zip_path, DAY)

    def test_independent_source_snapshots_match_reference(self):
        self.assertEqual(self.read(), self.expected)

    def test_missing_or_ambiguous_snapshot_is_rejected(self):
        wb = self.sources.pop(WB)
        with self.subTest("missing WB snapshot"), self.assertRaises(ValueError):
            self.read()
        self.sources[WB] = wb
        self.sources[f"WB/snapshots/another-collection/{DAY}.json"] = wb
        with self.subTest("two WB snapshots for day"), self.assertRaises(ValueError):
            self.read()

    def test_each_snapshot_must_declare_its_date_and_supported_version(self):
        mutations = [
            (OZON, "report_date", "2001-02-04"),
            (WB, "date", "2001-02-04"),
            (OZON, "schema", "unknown/v9"),
            (WB, "version", "unknown/v9"),
        ]
        for source, key, value in mutations:
            with self.subTest(source=source, key=key):
                with patch.dict(self.sources[source], {key: value}), self.assertRaises(ValueError):
                    self.read()

    def test_aggregate_files_are_not_used_as_a_replacement_for_missing_snapshots(self):
        self.sources = {"SUMMARY.json": self.expected}
        with self.assertRaises(ValueError):
            self.read()

    def test_operational_coverage_and_posted_wb_spend_are_independent(self):
        ads = self.sources[WB]["advertising"]
        for missing, spend, coverage, count in (
            (None, "31.17", "unknown", None),
            ([], "31.17", "reported_complete", 0),
            ([301, 302], "31.17", "partial", 2),
            ([301, 302], None, "unavailable", 2),
        ):
            with self.subTest(missing=missing, spend=spend):
                if missing is None:
                    ads.pop("missing_stats_campaign_ids", None)
                else:
                    ads["missing_stats_campaign_ids"] = missing
                ads["operational_rub"] = spend
                result = self.read()
                self.assertEqual(result["wb"]["advertising_rub"], "30.00")
                reconciliation = result["wb_advertising"]
                self.assertEqual(reconciliation["operational_coverage"], coverage)
                self.assertEqual(reconciliation["missing_campaign_count"], count)
                gap = None if spend is None else "-1.17"
                self.assertEqual(reconciliation["posted_minus_operational_rub"], gap)

    def test_zero_turnover_is_distinct_from_zero_ad_spend(self):
        self.sources[OZON]["rows"]["Оборот"]["without_coefficient_total_unrounded"] = "0"
        self.sources[WB]["ordered_original_rub"] = "0"
        result = self.read()
        for name in ("ozon", "wb", "combined"):
            self.assertIsNone(result[name]["drr_percent"])
        self.assertEqual(result["combined"]["advertising_rub"], "84.37")

    def test_workspace_scope_selects_archive_and_caller_can_only_choose_a_date(self):
        catalog = Catalog(PLUGINS)
        plugin_id = catalog.plugin_for(TOOL).id
        store = Store(self.root / "state.sqlite3")
        self.addCleanup(store.close)
        archive_root = self.root / "team-reports"
        first = Scope("sample-user-a", "sample-space-a", "sample-chat-a")
        second = Scope("sample-user-b", "sample-space-b", "sample-chat-b")
        for scope in (first, second):
            store.create_workspace(scope.actor_id, scope.workspace_id)
            store.create_chat(scope)
            store.set_entitlement(scope.workspace_id, plugin_id, True)
            store.set_enabled(scope, plugin_id, True)

        args = {"date": DAY}
        alice = Dispatcher(catalog, store, first)
        bob = Dispatcher(catalog, store, second)
        self.write_report(archive_path(archive_root, first.workspace_id, DAY))
        with patch.dict(os.environ, {"HARNESS_REPORT_ARCHIVE_ROOT": str(archive_root)}):
            self.assertEqual(alice.call_tool(TOOL, args), self.expected)
            with self.assertRaisesRegex(ToolExecutionFailed, "^Tool execution failed$"):
                bob.call_tool(TOOL, args)
            self.sources[WB]["ordered_units"] = 7
            self.write_report(archive_path(archive_root, second.workspace_id, DAY))
            self.assertEqual(bob.call_tool(TOOL, args)["combined"]["ordered_units"], 10)
            self.assertEqual(alice.call_tool(TOOL, args)["combined"]["ordered_units"], 4)
            with self.assertRaises(InvalidToolInput):
                bob.call_tool(TOOL, {**args, "workspace_id": first.workspace_id})
            store.set_entitlement(first.workspace_id, plugin_id, False)
            with self.assertRaises(UnavailableTool):
                alice.call_tool(TOOL, args)
