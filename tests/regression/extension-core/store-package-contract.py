"""Contract checks for the explicit extension store/release build mode."""
from pathlib import Path
import importlib.util
import json
import tempfile

ROOT = Path(__file__).resolve().parents[3]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


composed = load("store_composed", "tooling/build/extension_composed.py")
firefox = load("store_firefox", "tooling/build/extension_firefox.py")

PUBLIC_KEY = "MCowBQYDK2VwAyEAFG3DxyJOAU0cI1T50i6+tDUonQ74Qzw1Ra6USuEWYRg="
FINGERPRINT = "69e2ddf7c78d4221d06b65be0212063b923e4e827c2e271385fef0d04cce85dc"


def authority(control="https://api.octoport.ru", portal="https://app.octoport.ru"):
    return {
        "schemaVersion": "octoport_release_authority_v1",
        "source": {"head": "0" * 40, "tree": "1" * 40},
        "productVersion": "0.2.4",
        "contractVersion": "control_plane_v2",
        "migrationLevel": 48,
        "environment": "PREPRODUCTION",
        "origins": {"controlApiOrigin": control, "portalOrigin": portal},
        "trustBundle": {
            "trustBundleVersion": "bootstrap_trust_bundle_v1",
            "algorithm": "Ed25519",
            "publicKeyFormat": "spki_der",
            "publicKeyEncoding": "base64",
            "fingerprintAlgorithm": "sha256",
            "fingerprintEncoding": "lowercase_hex",
            "keys": [{
                "keyId": "fixture-store-key",
                "publicKey": PUBLIC_KEY,
                "fingerprintSha256": FINGERPRINT,
                "lifecycle": "ACTIVE",
                "trustEligibility": "SIGNING_AND_VERIFICATION",
            }],
        },
    }


def write_authority(root, value):
    path = root / "authority.json"
    path.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    return path


with tempfile.TemporaryDirectory(prefix="octoport-store-contract-") as temp:
    root = Path(temp)
    auth = write_authority(root, authority())
    runtime, extracted, receipt = composed.build(
        root / "chromium", mode="store", release_authority=auth
    )
    manifest = json.loads((runtime / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["name"] == "Octoport — Ozon + Wildberries"
    assert manifest["action"]["default_title"] == "Octoport"
    assert manifest["icons"] == {
        "16": "icons/octoport-16.png",
        "48": "icons/octoport-48.png",
        "128": "icons/octoport-128.png",
    }
    assert manifest["action"]["default_icon"] == manifest["icons"]
    for icon in manifest["icons"].values():
        assert (runtime / icon).is_file()
        assert (extracted / icon).read_bytes() == (runtime / icon).read_bytes()
    assert "https://api.octoport.ru/*" in manifest["host_permissions"]
    assert "https://app.octoport.ru/*" in manifest["host_permissions"]
    assert not any(value.startswith("http://127.0.0.1") for value in manifest["host_permissions"])
    worker = (runtime / "service_worker.js").read_text(encoding="utf-8")
    assert "globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=" in worker
    assert "control_plane_v2" in worker and "PREPRODUCTION" in worker
    assert "PACKAGED_CONFIG_REQUIRED" in worker
    assert "LOCAL DEVELOPMENT" not in worker
    assert "127.0.0.1:43100" not in worker and "127.0.0.1:43101" not in worker
    assert "config-local-development" not in worker
    for visible in ("popup.html", "popup.js", "shared/application.js"):
        text = (runtime / visible).read_text(encoding="utf-8")
        assert "Seller Agents" not in text
        assert "Octoport" in text
    popup = (runtime / "popup.html").read_text(encoding="utf-8")
    assert "Локальная разработка" not in popup
    assert "LOCAL DEVELOPMENT" not in popup
    assert "Проверяем аккаунт…" in popup
    assert "BETA · результаты сразу в ИИ · буфер до 1 часа" in popup
    assert receipt["build_mode"] == "store"
    assert receipt["environment"] == "PREPRODUCTION"
    assert receipt["package"]["name"] == "OCTOPORT_v0.2.4_CHROMIUM_STORE.zip"
    assert receipt["package"]["repeat_archive_match"] is True
    assert receipt["release_authority_sha256"] == composed.baseline.sha256(auth.read_bytes())

    firefox_receipt = firefox.build(runtime, root / "firefox-runtime")
    firefox_manifest = json.loads(
        (root / "firefox-runtime" / "manifest.json").read_text(encoding="utf-8")
    )
    assert firefox_receipt["build_mode"] == "store"
    assert firefox_receipt["package"]["name"] == "OCTOPORT_v0.2.4_FIREFOX_STORE.zip"
    assert firefox_manifest["browser_specific_settings"]["gecko"]["id"] == "octoport@octoport.ru"
    assert "https://api.octoport.ru/*" in firefox_manifest["host_permissions"]
    assert not any(value.startswith("http://127.0.0.1") for value in firefox_manifest["host_permissions"])

def rejected(root, value, name):
    auth = write_authority(root, value)
    try:
        composed.build(root / name, mode="store", release_authority=auth)
    except AssertionError:
        return
    raise AssertionError(f"store mode accepted invalid authority: {name}")


with tempfile.TemporaryDirectory(prefix="octoport-store-negative-") as temp:
    root = Path(temp)
    rejected(root, authority(control="http://127.0.0.1:43100"), "http-origin")
    production = authority()
    production["environment"] = "PRODUCTION"
    rejected(root, production, "production-environment")
    duplicate_id = authority()
    duplicate_id["trustBundle"]["keys"].append(dict(duplicate_id["trustBundle"]["keys"][0]))
    rejected(root, duplicate_id, "duplicate-key-id")
    duplicate_fingerprint = authority()
    duplicate = dict(duplicate_fingerprint["trustBundle"]["keys"][0])
    duplicate["keyId"] = "fixture-store-key-2"
    duplicate_fingerprint["trustBundle"]["keys"].append(duplicate)
    rejected(root, duplicate_fingerprint, "duplicate-fingerprint")

print(json.dumps({"status": "PASS", "checks": ["store HTTPS/v2 config", "Octoport icons", "deterministic Chromium ZIP", "Firefox store derivative", "HTTP authority rejected", "PRODUCTION authority rejected", "duplicate trust keys rejected"]}))
