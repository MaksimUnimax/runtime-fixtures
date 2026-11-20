"""Black-box acceptance contract for offline native gateway usage reconciliation."""

from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


CLI = Path(__file__).resolve().with_name("reconcile.py")
TARIFF = {
    "schema": "usage-tariffs/v1",
    "versions": {
        "test-v1": {
            "models": {"m": {"input": "1", "cache": "0.1", "output": "2"}}
        }
    },
}


def attempt(key, *, session="synthetic-chat", purpose="native-model-step"):
    admitted = {
        "schema": "harness-lab-model-attempt/v1",
        "event": "admitted",
        "attempt_id": key,
        "session_id": session,
        "model": "m",
        "purpose": purpose,
        "started_at": "2026-11-19T23:59:58Z",
    }
    finished = {
        **admitted,
        "event": "finished",
        "finished_at": "2026-11-20T00:00:02Z",
        "status": 200,
        "outcome": "completed",
        "response_model": "m",
        "usage": {
            "input_tokens": 1_000_000,
            "cache_read_input_tokens": 500_000,
            "cache_creation_input_tokens": 0,
            "output_tokens": 250_000,
        },
        "quote": {
            "pricing_version": "test-v1",
            "quote_kind": "conservative_peak_estimate",
            "prices_usd_per_million": {"input": 1, "cache": 0.1, "output": 2},
            "fx_rub_per_usd": 80,
            "usd_peak_estimate": 1.55,
            "rub_peak_estimate": 124,
        },
    }
    return admitted, finished


class ReconciliationCliTest(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory(prefix="usage-reconcile-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.journal = self.root / "jsonl"
        self.tariffs = self.root / "rates.json"
        self.tariffs.write_text(json.dumps(TARIFF), encoding="utf-8")

    def cli(self):
        return subprocess.run(
            [sys.executable, str(CLI), str(self.journal), "--tariffs", str(self.tariffs)],
            capture_output=True, text=True, timeout=15, cwd=self.root,
        )

    def reconcile(self, records, exit_code):
        self.journal.write_text(
            "".join(json.dumps(row) + "\n" for row in records), encoding="utf-8",
        )
        completed = self.cli()
        self.assertEqual(completed.returncode, exit_code, completed.stderr)
        summary = json.loads(completed.stdout)
        self.assertEqual(summary["status"], {0: "complete", 1: "partial"}[exit_code])
        self.assertIsInstance(summary["issues"], dict)
        if exit_code == 1:
            self.assertTrue(any(count > 0 for count in summary["issues"].values()))
        return summary

    def money(self, output, field, expected):
        if expected is None:
            self.assertIsNone(output[field], field)
        else:
            self.assertIsInstance(output[field], str, field)
            self.assertEqual(Decimal(output[field]), Decimal(expected), field)

    def test_real_token_categories_and_two_currency_totals(self):
        output = self.reconcile(attempt("single"), 0)
        self.assertEqual(output["unique_attempts"], 1)
        self.assertEqual(output["duplicate_events"], 0)
        self.assertFalse(any(output["issues"].values()))
        for prefix in ("total", "known"):
            self.money(output, prefix + "_usd", "1.55")
            self.money(output, prefix + "_rub", "124")

    def test_out_of_order_duplicates_and_distinct_retries(self):
        admission_a, final_a = attempt("first")
        admission_b, final_b = attempt("next-attempt")
        admission_c, final_c = attempt("service", session="other-chat", purpose="compaction")
        # Repeat the same JSON object with keys in a different order.
        duplicate_a = dict(reversed(list(final_a.items())))
        records = [final_a, admission_b, final_c, admission_a, duplicate_a,
                   admission_c, final_b, dict(admission_b)]
        for stream in (records, list(reversed(records))):
            output = self.reconcile(stream, 0)
            self.assertEqual(output["unique_attempts"], 3)
            self.assertEqual(output["duplicate_events"], 2)
            self.money(output, "total_usd", "4.65")
            self.money(output, "total_rub", "372")

    def test_duplicate_numbers_and_consistency_of_finished_phase(self):
        start, end = attempt("consistent")
        for field, patch in (("status", {"status": 200.0}),
                             ("usage", {"usage": {**end["usage"], "input_tokens": 1_000_000.0}})):
            twin = {**end, **patch}
            for terminals in ((end, twin), (twin, end)):
                with self.subTest(field=field, original_first=terminals[0] is end):
                    output = self.reconcile([start, *terminals], 0)
                    self.assertEqual(output["duplicate_events"], 1)
                    self.money(output, "total_usd", "1.55")
                    self.money(output, "total_rub", "124")
        for label, admission, terminal in (
            ("max_tokens changed", {**start, "max_tokens": 300000}, {**end, "max_tokens": 300001}),
            ("ambiguous usage", start, {**end, "partial_usage": dict(end["usage"])}),
        ):
            with self.subTest(reason=label):
                report = self.reconcile([admission, terminal], 1)
                self.money(report, "total_usd", None)
                self.money(report, "total_rub", None)

    def test_disconnect_after_final_usage_retains_cost_once(self):
        start, end = attempt("disconnect")
        end.update(outcome="client_disconnected_unknown", partial_usage=None)
        result = self.reconcile([start, end, end], 0)
        self.money(result, "total_rub", "124")
        self.assertEqual(result["unique_attempts"], 1)
        end.update(partial_usage=end["usage"], usage=None)
        self.money(self.reconcile([start, end], 1), "total_rub", None)

    def test_actual_zero_usage_is_a_known_zero(self):
        start, end = attempt("zero")
        end["usage"] = {key: 0 for key in end["usage"]}
        end["quote"].update(usd_peak_estimate=0, rub_peak_estimate=0)
        output = self.reconcile([start, end], 0)
        self.money(output, "total_usd", "0")
        self.money(output, "total_rub", "0")

    def test_response_model_sets_billed_rates_even_if_requested_model_is_known(self):
        manifest = deepcopy(TARIFF)
        manifest["versions"]["test-v1"]["models"]["premium"] = {
            "input": "3", "cache": "0.4", "output": "5",
        }
        self.tariffs.write_text(json.dumps(manifest), encoding="utf-8")
        start, end = attempt("changed-model")
        end["response_model"] = "premium"
        original_quote = dict(end["quote"])
        end["quote"].update(prices_usd_per_million={"input": 3, "cache": 0.4, "output": 5},
                            usd_peak_estimate=4.45, rub_peak_estimate=356)
        output = self.reconcile([start, end], 0)
        self.money(output, "total_usd", "4.45")
        self.money(output, "total_rub", "356")
        output = self.reconcile([start, {**end, "quote": original_quote}], 1)
        self.money(output, "total_usd", None)
        self.money(output, "total_rub", None)

    def test_unpriced_cache_creation_leaves_both_totals_unknown(self):
        start, end = attempt("cache-write")
        end["usage"]["cache_creation_input_tokens"] = 1
        output = self.reconcile([start, end], 1)
        self.money(output, "total_usd", None)
        self.money(output, "total_rub", None)

    def test_empty_journal_has_no_totals(self):
        output = self.reconcile([], 1)
        self.assertEqual(output["unique_attempts"], 0)
        self.assertEqual(output["duplicate_events"], 0)
        self.money(output, "total_usd", None)
        self.money(output, "total_rub", None)

    def test_matching_attempt_ids_cannot_join_different_sessions(self):
        start, end = attempt("shared-id")
        end["session_id"] = "other-synthetic-session"
        output = self.reconcile([start, end, *attempt("known")], 1)
        self.money(output, "total_usd", None)
        self.money(output, "total_rub", None)
        self.money(output, "known_usd", "1.55")
        self.money(output, "known_rub", "124")

    def test_missing_fx_preserves_usd_and_known_rub_subtotal(self):
        first = attempt("known")
        start, end = attempt("no-fx")
        end["quote"].update(fx_rub_per_usd=None, rub_peak_estimate=None)
        output = self.reconcile([*first, start, end], 1)
        self.money(output, "total_usd", "3.10")
        self.money(output, "known_usd", "3.10")
        self.money(output, "known_rub", "124")
        self.money(output, "total_rub", None)

    def test_missing_or_incorrect_rub_with_valid_fx_preserves_usd(self):
        start, end = attempt("rub-mismatch")
        for value in (None, 125):
            with self.subTest(rub=value):
                quote = {**end["quote"], "rub_peak_estimate": value}
                output = self.reconcile([*attempt("known"), start, {**end, "quote": quote}], 1)
                self.money(output, "total_usd", "3.10")
                self.money(output, "known_usd", "3.10")
                self.money(output, "total_rub", None)
                self.money(output, "known_rub", "124")

    def test_http_failure_and_invalid_token_counts_cannot_contribute_quoted_money(self):
        start, end = attempt("bad-terminal")
        for label, patch in (
            ("HTTP error", {"status": 503}),
            ("negative usage", {"usage": {**end["usage"], "input_tokens": -1}}),
            ("boolean usage", {"usage": {**end["usage"], "output_tokens": True}}),
        ):
            for usd, rub in ((1.55, 124), (3, 999)):
                with self.subTest(reason=label, usd=usd, rub=rub):
                    quote = {**end["quote"], "usd_peak_estimate": usd, "rub_peak_estimate": rub}
                    output = self.reconcile([start, {**end, **patch, "quote": quote}, *attempt("known")], 1)
                    self.money(output, "total_usd", None)
                    self.money(output, "total_rub", None)
                    self.money(output, "known_usd", "1.55")
                    self.money(output, "known_rub", "124")

    def test_unfinished_and_orphan_do_not_become_zero_cost(self):
        start, finish = attempt("incomplete")
        for row in (start, finish):
            with self.subTest(event=row["event"]):
                output = self.reconcile([row, *attempt("complete")], 1)
                self.assertEqual(output["unique_attempts"], 2)
                self.money(output, "known_usd", "1.55")
                self.money(output, "known_rub", "124")
                self.money(output, "total_usd", None)
                self.money(output, "total_rub", None)

    def test_conflicting_terminals_are_independent_of_file_order(self):
        start, finish = attempt("conflict")
        disputed = {**finish, "outcome": "client_disconnected"}
        for records in ([start, finish, disputed], [disputed, start, finish]):
            output = self.reconcile(records, 1)
            self.assertEqual(output["unique_attempts"], 1)
            self.money(output, "total_usd", None)
            self.money(output, "total_rub", None)

    def test_quote_needs_independent_rates_and_matching_amount(self):
        start, finish = attempt("quote")
        updates = {
            "no quote": {"quote": None},
            "unknown version": {"quote": {**finish["quote"], "pricing_version": "not-published"}},
            "unknown billed model": {"response_model": "not-published"},
            "incorrect amount": {"quote": {**finish["quote"], "usd_peak_estimate": 15.50}},
            "incorrect quoted rates": {"quote": {
                **finish["quote"], "prices_usd_per_million": {"input": 2, "cache": 0.1, "output": 2},
            }},
        }
        for label, patch in updates.items():
            with self.subTest(case=label):
                output = self.reconcile([start, {**finish, **patch}], 1)
                self.money(output, "total_usd", None)

    def test_malformed_journal_fails_without_echoing_payload(self):
        marker = "sensitive-synthetic-line-do-not-echo"
        self.journal.write_text(json.dumps(attempt("early")[0]) + "\n{!" + marker, encoding="utf-8")
        process = self.cli()
        self.assertEqual(process.returncode, 2)
        self.assertNotIn(marker, process.stdout + process.stderr)

    def test_duplicate_json_keys_in_nested_rates_or_usage_are_invalid(self):
        start, end = attempt("duplicate-key")
        valid_journal = "\n".join(json.dumps(row) for row in (start, end)) + "\n"
        valid_tariffs = json.dumps(TARIFF)
        # Both alternatives become apparently valid if a parser silently takes the last value.
        for label, journal, tariffs in (
            ("usage", valid_journal.replace('"output_tokens":', '"output_tokens": 0, "output_tokens":'),
             valid_tariffs),
            ("tariff", valid_journal,
             valid_tariffs.replace('"input":', '"input": "10000", "input":')),
        ):
            with self.subTest(source=label):
                self.journal.write_text(journal, encoding="utf-8")
                self.tariffs.write_text(tariffs, encoding="utf-8")
                self.assertEqual(self.cli().returncode, 2)

    def test_malformed_tariff_is_an_input_error(self):
        self.journal.write_text("", encoding="utf-8")
        broken = deepcopy(TARIFF)
        broken["versions"]["test-v1"]["models"]["m"]["input"] = "-1"
        self.tariffs.write_text(json.dumps(broken), encoding="utf-8")
        self.assertEqual(self.cli().returncode, 2)


if __name__ == "__main__":
    unittest.main()
