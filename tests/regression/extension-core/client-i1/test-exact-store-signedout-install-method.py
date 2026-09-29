"""Unit regression for exact STORE signed-out install method selection."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

fake_api = types.ModuleType("playwright.sync_api")
fake_api.sync_playwright = mock.Mock(side_effect=AssertionError("BROWSER_MUST_NOT_START"))
helper_path = Path(__file__).with_name("exact-store-signedout-controls.py")
spec = importlib.util.spec_from_file_location("signedout_helper", helper_path)
helper = importlib.util.module_from_spec(spec)
with mock.patch.dict(
    sys.modules,
    {"playwright": types.ModuleType("playwright"), "playwright.sync_api": fake_api},
):
    spec.loader.exec_module(helper)


class SignedOutInstallMethodTests(unittest.TestCase):
    def test_auto_uses_cdp_for_branded_chromium(self):
        self.assertEqual(
            helper.resolve_install_method("Google Chrome 147.0.7727.116", "auto"),
            "cdp",
        )
        for product in (
            "Yandex 26.8.1.1111 stable",
            "Yandex Browser 26.8.1.1111 stable",
        ):
            with self.subTest(product=product):
                self.assertEqual(helper.resolve_install_method(product, "auto"), "cdp")

    def test_auto_preserves_cli_for_opera_and_chromium(self):
        self.assertEqual(
            helper.resolve_install_method("Opera 136.0.6008.22", "auto"), "cli"
        )
        self.assertEqual(
            helper.resolve_install_method("Chromium 152.0.7977.120", "auto"), "cli"
        )

    def test_explicit_install_method_wins(self):
        self.assertEqual(
            helper.resolve_install_method("Google Chrome 147.0.7727.116", "cli"),
            "cli",
        )
        self.assertEqual(
            helper.resolve_install_method("Opera 136.0.6008.22", "cdp"), "cdp"
        )

    def test_cdp_loader_uses_exact_runtime_path_and_returns_id(self):
        session = mock.Mock()
        session.send.return_value = {"id": "test-extension-id"}
        browser = types.SimpleNamespace(
            new_browser_cdp_session=mock.Mock(return_value=session)
        )
        context = types.SimpleNamespace(browser=browser)
        runtime = Path("/tmp/exact-runtime")
        self.assertEqual(
            helper.load_unpacked_via_cdp(context, runtime), "test-extension-id"
        )
        session.send.assert_called_once_with(
            "Extensions.loadUnpacked", {"path": str(runtime)}
        )

    def test_cdp_loader_fails_closed_without_extension_id(self):
        session = mock.Mock()
        session.send.return_value = {}
        browser = types.SimpleNamespace(
            new_browser_cdp_session=mock.Mock(return_value=session)
        )
        context = types.SimpleNamespace(browser=browser)
        with self.assertRaisesRegex(AssertionError, "^CDP_EXTENSION_ID_MISSING$"):
            helper.load_unpacked_via_cdp(context, Path("/tmp/exact-runtime"))


if __name__ == "__main__":
    unittest.main()
