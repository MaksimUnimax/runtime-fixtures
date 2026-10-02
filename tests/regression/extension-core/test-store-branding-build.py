from pathlib import Path
import importlib.util
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


def load_composed():
    spec = importlib.util.spec_from_file_location(
        "a05_store_branding_composed", ROOT / "tooling/build/extension_composed.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


composed = load_composed()


class StoreBrandingBuildTests(unittest.TestCase):
    def test_rewrite_does_not_depend_on_occurrence_counts(self):
        output = {}
        for count, target in enumerate(composed.STORE_VISIBLE_BRAND_TARGETS, start=1):
            output[target] = (b"Seller Agents|" * count) + b"unchanged"
        composed.rewrite_store_visible_brand(output)
        for count, target in enumerate(composed.STORE_VISIBLE_BRAND_TARGETS, start=1):
            self.assertNotIn(b"Seller Agents", output[target])
            self.assertEqual(output[target].count(b"Octoport"), count)

    def test_rewrite_requires_every_declared_visible_surface(self):
        output = {target: b"Seller Agents" for target in composed.STORE_VISIBLE_BRAND_TARGETS[:-1]}
        with self.assertRaises(AssertionError):
            composed.rewrite_store_visible_brand(output)

    def test_attachment_delivery_message_is_a_visible_brand_surface(self):
        self.assertIn(
            "attachment_delivery_port_content.js",
            composed.STORE_VISIBLE_BRAND_TARGETS,
        )

    def test_final_guard_rejects_any_stale_brand_leak(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "popup.html").write_bytes(b"Octoport")
            (root / "unexpected.js").write_bytes(b'root.textContent = "Seller Agents";')
            with self.assertRaises(AssertionError):
                composed.assert_no_store_brand_leaks(root)

    def test_final_guard_accepts_clean_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "popup.html").write_bytes(b"Octoport")
            (root / "attachment_delivery_port_content.js").write_bytes(b"Octoport")
            composed.assert_no_store_brand_leaks(root)


if __name__ == "__main__":
    unittest.main()
