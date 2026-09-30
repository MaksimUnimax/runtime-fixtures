"""Current recipe versions must retain the proven route checks, not add tuple copies."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location(
    "tested_import_route", ROOT / "tooling/checks/extension_import.py"
)
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)


def recipe(version="0.2.10"):
    return {
        "schema_version": 1,
        "stage": "I1-C1",
        "version": version,
        "marketplace_hosts": ["https://wb.example/*"],
    }


class ReachedPreservedBehavior(Exception):
    pass


class VersionPolicyTests(unittest.TestCase):
    def test_every_historical_version_preserves_existing_flags(self):
        for version in ["0.1.22"] + [f"0.2.{n}" for n in range(11)]:
            with self.subTest(version=version):
                patch = -1 if version == "0.1.22" else int(version.split(".")[-1])
                expected = {
                    "marketplace_hosts": patch >= 3,
                    "control_hosts": patch >= 4,
                    "corrective_ports": patch >= 1,
                    "application_worker": patch >= 4,
                    "version_files": 8 if patch >= 4 else (9 if patch == 3 else 10),
                }
                self.assertEqual(
                    route.version_route_profile(version, "0.2.10"), expected
                )

    def test_next_current_recipe_keeps_same_route_contract(self):
        self.assertEqual(
            route.version_route_profile("0.2.11", "0.2.11"),
            route.version_route_profile("0.2.10", "0.2.10"),
        )

    def test_unknown_and_future_not_in_recipe_rejected(self):
        for version in (
            "0.2.11",
            "0.2.65536",
            "0.3.0",
            "1.2.3",
            "0.2.09",
            "0.2.9-beta",
            None,
            True,
        ):
            with self.subTest(version=version), self.assertRaises(ValueError):
                route.version_route_profile(version, "0.2.10")

    def test_recipe_validation_and_stage_are_required(self):
        for key, value in [
            ("version", "0.3.0"),
            ("version", "0.2.65536"),
            ("version", None),
            ("stage", "UNKNOWN"),
            ("schema_version", 2),
        ]:
            item = recipe()
            item[key] = value
            with (
                self.subTest(key=key, value=value),
                mock.patch.object(route.baseline, "read_json", return_value=item),
            ):
                with self.assertRaises(ValueError):
                    route.current_composed_version()
        with mock.patch.object(
            route.baseline, "read_json", return_value=recipe("0.2.11")
        ):
            self.assertEqual(route.current_composed_version(), "0.2.11")

    def exercise_actual_entry(self, current, requested, mismatch=False):
        with tempfile.TemporaryDirectory(prefix="l1-version-route-") as temp:
            root = Path(temp)
            layout = root / "layout"
            prod = layout / "dist-step7-candidate"
            prod.mkdir(parents=True)
            manifest = {
                "manifest_version": 3,
                "version": "0.2.9" if mismatch else requested,
                "permissions": ["storage"],
                "host_permissions": [
                    "https://ozon.example/*",
                    "https://wb.example/*",
                    "http://127.0.0.1:43100/*",
                    "http://127.0.0.1:43101/*",
                ],
            }
            (prod / "manifest.json").write_text(json.dumps(manifest))
            for number in range(7):
                name = "service_worker_entry.js" if number == 0 else f"s{number}.js"
                content = f"// {requested}\n"
                if number == 0:
                    content += "// Repair live v0.1.21 defects before downstream output/delivery wrappers capture contract/provider globals.\n"
                (prod / name).write_text(content)
            original = route.baseline.read_json

            def read_json(path):
                text = str(path)
                if text.endswith("apps/extension/composition.json"):
                    return recipe(current)
                if "ozon-permissions-0aa8f535" in text:
                    return {
                        "permissions": ["storage"],
                        "host_permissions": ["https://ozon.example/*"],
                    }
                return original(path)

            runner = mock.Mock()
            runner.run.side_effect = ReachedPreservedBehavior()
            with (
                mock.patch.object(route.baseline, "read_json", side_effect=read_json),
                mock.patch.object(
                    route.baseline, "prepare_ozon_layout", return_value=layout
                ) as setup,
            ):
                try:
                    route.ozon_route(runner, root, root, "probe", False, requested)
                finally:
                    self.last_child_calls = runner.run.call_count
                    self.last_setup_calls = setup.call_count

    def test_next_recipe_reaches_existing_behavior_after_exact_manifest_checks(self):
        with self.assertRaises(ReachedPreservedBehavior):
            self.exercise_actual_entry("0.2.11", "0.2.11")
        self.assertEqual(self.last_child_calls, 1)

    def test_wrong_manifest_still_rejected_before_first_child(self):
        with self.assertRaises(AssertionError):
            self.exercise_actual_entry("0.2.11", "0.2.11", mismatch=True)
        self.assertEqual(self.last_child_calls, 0)

    def test_unknown_route_rejected_before_layout_and_child(self):
        with self.assertRaises(ValueError):
            self.exercise_actual_entry("0.2.10", "0.2.11")
        self.assertEqual(self.last_child_calls, 0)
        self.assertEqual(self.last_setup_calls, 0)

    def test_current_checkers_no_longer_pin_an_independent_version(self):
        for rel in [
            "tooling/checks/extension_core.py",
            "tooling/checks/extension_i1.py",
        ]:
            with self.subTest(rel=rel):
                text = (ROOT / rel).read_text()
                self.assertIn("original.current_composed_version()", text)
                self.assertNotIn('"0.2.10"', text)


if __name__ == "__main__":
    unittest.main()
