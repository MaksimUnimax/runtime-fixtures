from pathlib import Path
import hashlib
import json
import os
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

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
            self.assertEqual(output[target].count("Октопорт".encode()), count)

    def test_product_labels_preserve_protocols_hosts_and_marketplace_names(self):
        sample = 'submit_control: "Ozon"; ' + "Ozon Bridge; Ozon Autorun ошибка; Ozon: batch принят; нажмите кнопку Ozon; OZON_API_V1 OZON_HELP_V2 https://api-seller.ozon.ru Магазин Ozon"
        targets = ("content_script.js", "attachment_delivery_port_content.js", "shared/runtime_names.js", "service_worker.js", "shared/live_runtime_v0122_patch.js", "shared/llm_output_report_workflow_patch.js", "shared/ozon_contract.js")
        output = {target: sample.encode() for target in targets}
        composed.rewrite_product_labels(output)
        for value in output.values():
            text = value.decode()
            self.assertIn("Октопорт: batch принят", text)
            self.assertIn("кнопку «Октопорт»", text)
            self.assertIn("OZON_API_V1 OZON_HELP_V2 https://api-seller.ozon.ru Магазин Ozon", text)
            self.assertNotIn("Ozon:", text)
            self.assertNotIn("Ozon Bridge", text)
            self.assertNotIn("Ozon Autorun", text)
            self.assertIn('submit_control: "Октопорт"', text)

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
            (root / "popup.html").write_bytes("Октопорт".encode())
            (root / "unexpected.js").write_bytes(b'root.textContent = "Seller Agents";')
            with self.assertRaises(AssertionError):
                composed.assert_no_store_brand_leaks(root)

    def test_final_guard_accepts_clean_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "popup.html").write_bytes("Октопорт".encode())
            (root / "attachment_delivery_port_content.js").write_bytes("Октопорт".encode())
            composed.assert_no_store_brand_leaks(root)


class StoreAuthoritySnapshotTests(unittest.TestCase):
    """Verify build-time authority config and its receipt hash bind one input."""

    @staticmethod
    def authority(control="https://api-a.example.test"):
        return {
            "schemaVersion": "octoport_release_authority_v1",
            "source": {"head": "0" * 40, "tree": "1" * 40},
            "productVersion": "0.2.37",
            "contractVersion": "control_plane_v2",
            "migrationLevel": 61,
            "environment": "PREPRODUCTION",
            "origins": {
                "controlApiOrigin": control,
                "portalOrigin": "https://portal.example.test",
            },
            "trustBundle": {
                "trustBundleVersion": "bootstrap_trust_bundle_v1",
                "algorithm": "Ed25519",
                "publicKeyFormat": "spki_der",
                "publicKeyEncoding": "base64",
                "fingerprintAlgorithm": "sha256",
                "fingerprintEncoding": "lowercase_hex",
                "keys": [{
                    "keyId": "synthetic-store-read-test",
                    "publicKey": "MCowBQYDK2VwAyEAFG3DxyJOAU0cI1T50i6+tDUonQ74Qzw1Ra6USuEWYRg=",
                    "fingerprintSha256": "69e2ddf7c78d4221d06b65be0212063b923e4e827c2e271385fef0d04cce85dc",
                    "lifecycle": "ACTIVE",
                    "trustEligibility": "SIGNING_AND_VERIFICATION",
                }],
            },
        }

    @staticmethod
    def serialized(control):
        return json.dumps(
            StoreAuthoritySnapshotTests.authority(control),
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")

    def test_store_authority_config_sha_references_same_snapshot(self):
        with tempfile.TemporaryDirectory(prefix="octoport-c01-store-authority-") as temp:
            file = Path(temp) / "synthetic.json"
            original = self.serialized("https://api-a.example.test")
            replacement = self.serialized("https://api-b.example.test")
            self.assertEqual(len(original), len(replacement))
            file.write_bytes(original)
            original_json_loads = json.loads
            changed = []

            def overwrite_after_parse(text, *args, **kwargs):
                parsed = original_json_loads(text, *args, **kwargs)
                if isinstance(parsed, dict) and parsed.get("schemaVersion") == "octoport_release_authority_v1" and not changed:
                    file.write_bytes(replacement)
                    changed.append(True)
                return parsed

            with patch.object(composed.json, "loads", overwrite_after_parse):
                config, digest = composed.store_config(file, {"version": "0.2.37"})
            self.assertEqual(changed, [True], "Test must actually replace the source pathname")
            self.assertEqual(file.read_bytes(), replacement)
            self.assertNotEqual(hashlib.sha256(original).digest(), hashlib.sha256(replacement).digest())
            self.assertEqual(config["controlApiOrigin"], "https://api-a.example.test")
            self.assertEqual(
                digest, hashlib.sha256(original).hexdigest(),
                "Store receipt must hash bytes actually used to create packaged config",
            )

    def test_store_authority_same_size_write_during_fd_read_fails_closed(self):
        if not hasattr(os, "pwrite"):
            self.skipTest("synthetic concurrent overwrite requires os.pwrite")
        with tempfile.TemporaryDirectory(prefix="octoport-c01-authority-mutation-") as temp:
            file = Path(temp) / "synthetic.json"
            original = self.serialized("https://api-a.example.test")
            replacement = self.serialized("https://api-b.example.test")
            self.assertEqual(len(original), len(replacement))
            file.write_bytes(original)
            identity = file.stat()
            actual_read = os.read
            changed = []

            def mutate_before_read(fd, count):
                if not changed and os.fstat(fd).st_ino == identity.st_ino:
                    writer = os.open(file, os.O_WRONLY)
                    try:
                        os.pwrite(writer, replacement, 0)
                    finally:
                        os.close(writer)
                    os.utime(
                        file, ns=(identity.st_atime_ns, identity.st_mtime_ns + 1_000_000_000)
                    )
                    changed.append(True)
                return actual_read(fd, count)

            with patch.object(composed.os, "read", mutate_before_read):
                with self.assertRaisesRegex(AssertionError, "changed during"):
                    composed.store_config(file, {"version": "0.2.37"})
            self.assertTrue(changed, "The authority descriptor must actually be read")

    def test_store_authority_same_size_rewrite_between_reads_ignores_coarse_stat(self):
        if not hasattr(os, "pwrite"):
            self.skipTest("coarse timestamp simulated concurrent write requires os.pwrite")
        with tempfile.TemporaryDirectory(prefix="octoport-c01-store-coarse-clock-") as temp:
            file = Path(temp) / "synthetic.json"
            original = self.serialized("https://api-a.example.test")
            replacement = self.serialized("https://api-b.example.test")
            self.assertEqual(len(original), len(replacement))
            file.write_bytes(original)
            identity = file.stat()
            real_fstat = os.fstat
            real_lseek = os.lseek
            changed = []

            def coarse_timestamp_fstat(fd):
                state = real_fstat(fd)
                if state.st_ino != identity.st_ino or state.st_dev != identity.st_dev:
                    return state
                # Model a filesystem where equal-length writes do not advance
                # mtime/ctime at the granularity observed by fstat.
                return SimpleNamespace(
                    st_mode=state.st_mode, st_dev=state.st_dev, st_ino=state.st_ino,
                    st_size=state.st_size, st_mtime_ns=identity.st_mtime_ns,
                    st_ctime_ns=identity.st_ctime_ns,
                )

            def mutate_after_first_read(fd, offset, whence):
                current = real_fstat(fd)
                if not changed and current.st_dev == identity.st_dev and current.st_ino == identity.st_ino:
                    writer = os.open(file, os.O_WRONLY)
                    try:
                        os.pwrite(writer, replacement, 0)
                    finally:
                        os.close(writer)
                    changed.append(True)
                return real_lseek(fd, offset, whence)

            with patch.object(composed.os, "fstat", coarse_timestamp_fstat), patch.object(
                composed.os, "lseek", mutate_after_first_read
            ):
                with self.assertRaisesRegex(AssertionError, "changed during"):
                    composed.store_config(file, {"version": "0.2.37"})
            self.assertEqual(changed, [True], "Coarse-stat regression must really change bytes")
            self.assertEqual(file.read_bytes(), replacement)

    def test_store_authority_open_swap_to_symlink_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="octoport-c01-authority-link-") as temp:
            root = Path(temp)
            file = root / "candidate.json"
            alternate = root / "alternate.json"
            file.write_bytes(self.serialized("https://api-a.example.test"))
            alternate.write_bytes(self.serialized("https://api-b.example.test"))
            actual_open = os.open
            swapped = []

            def replace_path_before_open(path, flags, *args, **kwargs):
                if Path(path) == file and not swapped:
                    file.unlink()
                    file.symlink_to(alternate.name)
                    swapped.append(True)
                return actual_open(path, flags, *args, **kwargs)

            with patch.object(composed.os, "open", replace_path_before_open):
                with self.assertRaisesRegex(AssertionError, "Invalid store release authority file"):
                    composed.store_config(file, {"version": "0.2.37"})
            self.assertTrue(swapped)

    def test_store_authority_fifo_refused_without_blocking(self):
        if not hasattr(os, "mkfifo"):
            self.skipTest("FIFO test requires POSIX")
        with tempfile.TemporaryDirectory(prefix="octoport-c01-authority-fifo-") as temp:
            fifo = Path(temp) / "candidate.fifo"
            os.mkfifo(fifo)
            # O_NONBLOCK prevents the open() call waiting for an absent writer.
            with self.assertRaisesRegex(AssertionError, "regular file"):
                composed.store_config(fifo, {"version": "0.2.37"})

    def test_store_composer_refuses_optimized_python_before_any_build(self):
        with patch.dict(os.environ, {"PYTHONDONTWRITEBYTECODE": "1"}):
            proc = subprocess.run(
                [sys.executable, "-O", "-c",
                 "import runpy; runpy.run_path(" +
                 repr(str(ROOT / "tooling/build/extension_composed.py")) +
                 ", run_name='not_a_full_build')"],
                capture_output=True, text=True, timeout=8,
            )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("EXTENSION_COMPOSITION_ASSERTIONS_DISABLED", proc.stderr)

    def test_store_authority_input_larger_than_one_megabyte_fails_closed(self):
        with tempfile.TemporaryDirectory(prefix="octoport-c01-authority-cap-") as temp:
            file = Path(temp) / "synthetic.json"
            content = self.serialized("https://api-a.example.test")
            file.write_bytes(content + b" " * (1024 * 1024 + 1 - len(content)))
            with self.assertRaisesRegex(AssertionError, "too large"):
                composed.store_config(file, {"version": "0.2.37"})


if __name__ == "__main__":
    unittest.main()
