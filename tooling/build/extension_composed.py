"""Compose the common extension runtime for development or store release packaging."""
from pathlib import Path
import argparse
import base64
import importlib.util
import json
import os
import re
import shutil
import sys
import zipfile
from urllib.parse import urlsplit

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("extension_baseline", ROOT / "tooling/build/extension_baseline.py")
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)
RECIPE = ROOT / "apps/extension/composition.json"


def read_input(relative, inputs):
    path = ROOT / relative
    assert path.resolve().is_relative_to(ROOT) and not path.is_symlink(), relative
    data = path.read_bytes()
    inputs[relative] = {"sha256": baseline.sha256(data), "bytes": len(data)}
    return data


def canonical_https_origin(value):
    assert isinstance(value, str)
    parsed = urlsplit(value)
    assert parsed.scheme == "https" and parsed.hostname
    assert parsed.username is None and parsed.password is None
    assert parsed.path in ("", "/") and not parsed.query and not parsed.fragment
    origin = "https://" + parsed.netloc
    assert value == origin
    return origin


def validate_trust_bundle(bundle):
    required = {"trustBundleVersion", "algorithm", "publicKeyFormat", "publicKeyEncoding",
                "fingerprintAlgorithm", "fingerprintEncoding", "keys"}
    assert isinstance(bundle, dict) and set(bundle) == required
    assert bundle["trustBundleVersion"] == "bootstrap_trust_bundle_v1"
    assert bundle["algorithm"] == "Ed25519"
    assert bundle["publicKeyFormat"] == "spki_der"
    assert bundle["publicKeyEncoding"] == "base64"
    assert bundle["fingerprintAlgorithm"] == "sha256"
    assert bundle["fingerprintEncoding"] == "lowercase_hex"
    assert isinstance(bundle["keys"], list) and 1 <= len(bundle["keys"]) <= 8
    active = 0
    key_ids = set()
    fingerprints = set()
    for key in bundle["keys"]:
        assert isinstance(key, dict) and set(key) == {
            "keyId", "publicKey", "fingerprintSha256", "lifecycle", "trustEligibility"
        }
        assert re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,63}", key["keyId"])
        assert key["keyId"] not in key_ids
        key_ids.add(key["keyId"])
        der = base64.b64decode(key["publicKey"], validate=True)
        assert len(der) == 44 and der[:12].hex() == "302a300506032b6570032100"
        assert baseline.sha256(der) == key["fingerprintSha256"]
        assert key["fingerprintSha256"] not in fingerprints
        fingerprints.add(key["fingerprintSha256"])
        assert key["lifecycle"] in {"ACTIVE", "RETIRED"}
        expected = "SIGNING_AND_VERIFICATION" if key["lifecycle"] == "ACTIVE" else "VERIFICATION_OVERLAP"
        assert key["trustEligibility"] == expected
        active += key["lifecycle"] == "ACTIVE"
    assert active >= 1


def store_config(authority_path, recipe):
    authority_path = Path(authority_path)
    assert authority_path.is_file() and not authority_path.is_symlink()
    authority = baseline.read_json(authority_path)
    assert isinstance(authority, dict) and set(authority) == {
        "schemaVersion", "source", "productVersion", "contractVersion", "migrationLevel",
        "environment", "origins", "trustBundle"
    }
    assert authority["schemaVersion"] == "octoport_release_authority_v1"
    assert isinstance(authority["source"], dict) and set(authority["source"]) == {"head", "tree"}
    assert re.fullmatch(r"[a-f0-9]{40}", authority["source"]["head"])
    assert re.fullmatch(r"[a-f0-9]{40}", authority["source"]["tree"])
    assert authority["productVersion"] == recipe["version"]
    assert authority["contractVersion"] == "control_plane_v2"
    assert isinstance(authority["migrationLevel"], int) and authority["migrationLevel"] >= 0
    assert authority["environment"] == "PREPRODUCTION"
    assert isinstance(authority["origins"], dict) and set(authority["origins"]) == {
        "controlApiOrigin", "portalOrigin"
    }
    control = canonical_https_origin(authority["origins"]["controlApiOrigin"])
    portal = canonical_https_origin(authority["origins"]["portalOrigin"])
    assert control != portal
    validate_trust_bundle(authority["trustBundle"])
    config = {
        "environment": authority["environment"],
        "controlApiOrigin": control,
        "portalOrigin": portal,
        "extensionVersion": authority["productVersion"],
        "contractVersion": authority["contractVersion"],
        "trustBundle": authority["trustBundle"],
    }
    return config, baseline.sha256(authority_path.read_bytes())


def compose(directory, mode="development", release_authority=None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    baseline.verify_import()
    recipe = baseline.read_json(RECIPE)
    assert recipe["version"] == "0.2.4" and recipe["stage"] == "I1-C1"
    inputs = {}
    read_input("apps/extension/composition.json", inputs)
    output = {}
    for row in baseline.runtime_rows("ozon"):
        relative = row["relative_runtime_path"]
        output[relative] = read_input(recipe["baseline"] + "/" + relative, inputs)
    for target, sources in recipe["bundles"].items():
        assert target in output
        output[target] = b"\n;\n".join(read_input(source, inputs) for source in sources)
    for target, bundle in recipe.get("isolated_bundles", {}).items():
        assert target not in output
        # WB authority and fixed-host transport cannot replace any Ozon global.
        prefix = b"(() => { const scope = Object.create(null); (function(globalThis) {\n"
        suffix = b"\n})(scope); globalThis.SellerAgentsWBReference = Object.freeze({contract: scope.WBContract, credentials: scope.WBCredentials, guidance: scope.WBGuidance, transport: scope.ProviderTransportCore}); })();\n"
        output[target] = prefix + b"\n;\n".join(read_input(p, inputs) for p in bundle["reference_sources"]) + suffix
        output[target] += b"\n;\n".join(read_input(p, inputs) for p in bundle["sources"])
    for target, sources in recipe.get("application_files", {}).items():
        output[target] = b"\n;\n".join(read_input(source, inputs) for source in sources)
    if mode == "store":
        for target, source in recipe.get("static_files", {}).items():
            output[target] = read_input(source, inputs)
    for target in recipe.get("worker_postload", []):
        assert target in output
        output["service_worker_entry.js"] += ("\nimportScripts(" + json.dumps(target) + ");\n").encode()
    worker = output["service_worker.js"].decode("utf-8")
    for row in recipe["worker_function_replacements"]:
        pattern = r"(?ms)^(?:async )?function " + re.escape(row["function"]) + r"\(.*?^}$"
        matches = list(re.finditer(pattern, worker))
        assert len(matches) == 1, row["function"]
        match = matches[0]
        assert baseline.sha256(match.group().encode()) == row["source_sha256"], row["function"]
        replacement = read_input(row["replacement"], inputs).decode().rstrip()
        worker = worker[:match.start()] + replacement + worker[match.end():]
    init = recipe["worker_initializer"]
    assert worker.count(init["old"]) == 1
    worker = worker.replace(init["old"], read_input(init["replacement"], inputs).decode().rstrip())
    output["service_worker.js"] = b"\n;\n".join(read_input(path, inputs) for path in recipe["worker_prelude"]) + b"\n;\n" + worker.encode()
    packaged_config = os.environ.get("SA_PACKAGED_CONFIG_JSON")
    parsed_config = None
    release_authority_sha256 = None
    if mode == "store":
        assert release_authority is not None and packaged_config is None
        try:
            parsed_config, release_authority_sha256 = store_config(release_authority, recipe)
        except (AssertionError, TypeError, ValueError) as error:
            raise AssertionError("invalid store release authority") from error
    else:
        assert mode == "development" and release_authority is None
        if packaged_config:
            try:
                parsed_config = json.loads(packaged_config)
                assert isinstance(parsed_config, dict)
                assert set(parsed_config) >= {"environment", "controlApiOrigin", "portalOrigin", "extensionVersion", "contractVersion", "trustBundle"}
                assert parsed_config["environment"] == "LOCAL DEVELOPMENT"
                assert parsed_config["extensionVersion"] == recipe["version"]
            except (AssertionError, TypeError, ValueError) as error:
                raise AssertionError("invalid SA_PACKAGED_CONFIG_JSON") from error
    if parsed_config is not None:
        config_bytes = json.dumps(parsed_config, ensure_ascii=False, separators=(",", ":"))
        output["service_worker.js"] = b"globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=" + json.dumps(config_bytes).encode() + b";\n" + output["service_worker.js"]
    for patch in json.loads(read_input(recipe["application_patches"], inputs)):
        text = output[patch["target"]].decode()
        assert text.count(patch["old"]) == 1, (patch["target"], patch["old"][:100], text.count(patch["old"]))
        output[patch["target"]] = text.replace(patch["old"], patch["new"]).encode()
    if mode == "store":
        visible_brand_targets = {
            "popup.html": 5,
            "popup.js": 2,
            "shared/application.js": 1,
        }
        for target, expected_count in visible_brand_targets.items():
            assert output[target].count(b"Seller Agents") == expected_count, target
            output[target] = output[target].replace(b"Seller Agents", b"Octoport")
    # This is a distinct composed package. The frozen donor stays untouched.
    for relative, data in output.items():
        data = data.replace(b"0.1.22", recipe["version"].encode())
        target = directory / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    manifest_path = directory / "manifest.json"
    manifest = baseline.read_json(manifest_path)
    if mode == "store":
        manifest["name"] = "Octoport — Ozon + Wildberries"
        manifest["action"]["default_title"] = "Octoport"
        manifest["description"] = "Read-only отчёты Ozon и Wildberries в выбранном ИИ; ключи магазинов хранятся локально."
    else:
        manifest["name"] = "Seller Agents Development — Ozon + WB"
        manifest["action"]["default_title"] = "Seller Agents"
        manifest["description"] = "Данные магазинов Ozon и Wildberries в вашем ИИ. Development-сборка."
    if mode == "store":
        icons = {
            "16": "icons/octoport-16.png",
            "48": "icons/octoport-48.png",
            "128": "icons/octoport-128.png",
        }
        manifest["icons"] = icons
        manifest["action"]["default_icon"] = icons
    control_hosts = recipe.get("control_hosts", [])
    if parsed_config is not None:
        control_hosts = [
            parsed_config["controlApiOrigin"].rstrip("/") + "/*",
            parsed_config["portalOrigin"].rstrip("/") + "/*",
        ]
    manifest["host_permissions"] = list(
        dict.fromkeys(manifest["host_permissions"] + recipe["marketplace_hosts"] + control_hosts)
    )
    baseline.write_json(manifest_path, manifest)
    files = [{"path": p.relative_to(directory).as_posix(), "sha256": baseline.sha256(p.read_bytes()),
              "bytes": p.stat().st_size} for p in sorted(directory.rglob("*")) if p.is_file()]
    assert len(files) == len(output)
    return {
        "stage": recipe["stage"],
        "version": recipe["version"],
        "purpose": "STORE_RELEASE_CANDIDATE" if mode == "store" else recipe["purpose"],
        "build_mode": mode,
        "environment": parsed_config["environment"] if parsed_config else "LOCAL DEVELOPMENT",
        "release_authority_sha256": release_authority_sha256,
        "packaged_origins": {
            "controlApi": parsed_config["controlApiOrigin"] if parsed_config else recipe.get("control_api_origin", "http://127.0.0.1:43100"),
            "portal": parsed_config["portalOrigin"] if parsed_config else recipe.get("portal_origin", "http://127.0.0.1:43101"),
        },
        "inputs": inputs,
        "files": files,
        "installed_acceptance": False,
    }


def build(output, mode="development", release_authority=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    runtime = output / "runtime"
    receipt = compose(runtime, mode=mode, release_authority=release_authority)
    second = output / "repeat-runtime"
    assert compose(second, mode=mode, release_authority=release_authority) == receipt
    name = (
        "OCTOPORT_v0.2.4_CHROMIUM_STORE.zip"
        if mode == "store"
        else "SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip"
    )
    archive = output / name
    repeat = output / "repeat.zip"
    for source, target in [(runtime, archive), (second, repeat)]:
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as zip_file:
            for row in receipt["files"]:
                info = zipfile.ZipInfo(row["path"], date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                zip_file.writestr(info, (source / row["path"]).read_bytes())
    assert archive.read_bytes() == repeat.read_bytes()
    extracted = output / "extracted"
    with zipfile.ZipFile(archive) as zip_file:
        assert set(zip_file.namelist()) == {r["path"] for r in receipt["files"]}
        zip_file.extractall(extracted)
    for row in receipt["files"]:
        assert baseline.sha256((extracted / row["path"]).read_bytes()) == row["sha256"]
    receipt["package"] = {"name": name, "bytes": archive.stat().st_size,
                          "sha256": baseline.sha256(archive.read_bytes()),
                          "repeat_archive_match": True, "source_extracted_bytes_match": True}
    baseline.write_json(output / "composition-receipt.json", receipt)
    shutil.rmtree(second)
    repeat.unlink()
    return runtime, extracted, receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=("development", "store"), default="development")
    parser.add_argument("--release-authority", type=Path)
    args = parser.parse_args()
    if (args.mode == "store") != (args.release_authority is not None):
        parser.error("--release-authority is required only for --mode store")
    _, _, receipt = build(
        args.output.resolve(),
        mode=args.mode,
        release_authority=args.release_authority.resolve() if args.release_authority else None,
    )
    print(receipt["package"])
