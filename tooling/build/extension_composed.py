"""Compose the common extension runtime for development or store release packaging."""
from pathlib import Path
import argparse
import base64
import importlib.util
import json
import math
import os
import re
import shutil
import stat
import sys
import zipfile
from urllib.parse import urlsplit

# Python -O removes assert statements, including release trust and patch guards.
# Refuse to compose any artifact when those validations would be disabled.
if not __debug__:
    raise RuntimeError("EXTENSION_COMPOSITION_ASSERTIONS_DISABLED")

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("extension_baseline", ROOT / "tooling/build/extension_baseline.py")
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)
RECIPE = ROOT / "apps/extension/composition.json"
MAX_STORE_AUTHORITY_BYTES = 1024 * 1024
STORE_VISIBLE_BRAND_TARGETS = (
    "popup.html",
    "popup.js",
    "shared/application.js",
    "attachment_delivery_port_content.js",
)


def rewrite_store_visible_brand(output):
    """Rewrite visible development branding without coupling to copy occurrence counts."""
    for target in STORE_VISIBLE_BRAND_TARGETS:
        assert target in output, target
        output[target] = output[target].replace(b"Seller Agents", "Октопорт".encode())


def rewrite_product_labels(output):
    """Only known product labels; marketplace names/protocols/hosts stay intact."""
    labels = (
        ("Ozon Bridge", "Октопорт"),
        ("OZON BRIDGE", "ОКТОПОРТ"),
        ("Ozon Autorun:", "Октопорт:"),
        ("Ozon Autorun ", "Октопорт "),
        ("Ozon manual recovery:", "Октопорт:"),
        ("Ozon manual:", "Октопорт:"),
        ("Ozon recovery:", "Октопорт:"),
        ("Ozon:", "Октопорт:"),
        ("кнопку Ozon", "кнопку «Октопорт»"),
        ("кнопки Ozon", "кнопки «Октопорт»"),
        ("кнопка Ozon", "кнопка «Октопорт»"),
        ('submit_control: "Ozon"', 'submit_control: "Октопорт"'),
        ("команд в Octoport", "команд в Октопорт"),
        ("Сохранённый Ozon delivery text", "Сохранённый результат Октопорта"),
    )
    for target in ("content_script.js", "attachment_delivery_port_content.js",
                   "shared/runtime_names.js", "service_worker.js",
                   "shared/live_runtime_v0122_patch.js", "shared/llm_output_report_workflow_patch.js",
                   "shared/ozon_contract.js"):
        for old, new in labels:
            output[target] = output[target].replace(old.encode(), new.encode())


def assert_no_store_brand_leaks(directory):
    """Fail if the final store runtime still contains the development-facing brand."""
    stale = sorted(
        path.relative_to(directory).as_posix()
        for path in directory.rglob("*")
        if path.is_file() and b"Seller Agents" in path.read_bytes()
    )
    assert not stale, ("stale Seller Agents store brand", stale)


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
    try:
        port = parsed.port
    except ValueError as error:
        raise AssertionError("Invalid HTTPS origin port") from error
    assert not parsed.netloc.endswith(":") and (port is None or 1 <= port <= 65535), (
        "Invalid HTTPS origin port"
    )
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


def read_store_authority_snapshot(path):
    """Read one regular, size-bounded release authority input as one snapshot."""
    # This only establishes internal bytes/hash identity, not genuine authority
    # issuer acceptance, an Ed25519 signing permission or Store approval.
    no_follow = getattr(os, "O_NOFOLLOW", 0)
    directory_only = getattr(os, "O_DIRECTORY", 0)
    nonblocking = getattr(os, "O_NONBLOCK", 0)
    if not no_follow or not directory_only or not nonblocking:
        raise AssertionError("Secure store authority file opening is unavailable")
    flags = os.O_RDONLY | no_follow | nonblocking
    flags |= getattr(os, "O_CLOEXEC", 0)
    descriptor = None
    parent_descriptors = []
    try:
        # Do not resolve symlinks. Open every parent by directory fd, so a
        # symlink in an ancestor cannot redirect the final authority open.
        absolute = Path(os.path.abspath(os.fspath(path)))
        parts = absolute.parts
        if len(parts) < 2:
            raise AssertionError("Invalid store release authority file")
        parent_flags = os.O_RDONLY | directory_only | no_follow
        parent_flags |= getattr(os, "O_CLOEXEC", 0)
        parent_descriptor = os.open(absolute.anchor, parent_flags)
        parent_descriptors.append(parent_descriptor)
        for segment in parts[1:-1]:
            next_descriptor = os.open(
                segment, parent_flags, dir_fd=parent_descriptor
            )
            parent_descriptors.append(next_descriptor)
            parent_descriptor = next_descriptor
        descriptor = os.open(parts[-1], flags, dir_fd=parent_descriptor)
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise AssertionError("Store authority must be a regular file")
        if not 0 <= before.st_size <= MAX_STORE_AUTHORITY_BYTES:
            raise AssertionError("Store authority too large")

        def bounded_bytes():
            payload = bytearray()
            while len(payload) <= MAX_STORE_AUTHORITY_BYTES:
                chunk = os.read(
                    descriptor,
                    min(65536, MAX_STORE_AUTHORITY_BYTES + 1 - len(payload)),
                )
                if not chunk:
                    break
                payload.extend(chunk)
            if len(payload) > MAX_STORE_AUTHORITY_BYTES:
                raise AssertionError("Store authority too large")
            return bytes(payload)

        # A same-sized rewrite can evade mtime/ctime on coarse-clock filesystems.
        # Compare two bounded reads on the SAME no-follow descriptor, not paths.
        primary = bounded_bytes()
        os.lseek(descriptor, 0, os.SEEK_SET)
        confirmed = bounded_bytes()
        after = os.fstat(descriptor)
        if not (
            stat.S_ISREG(after.st_mode)
            and before.st_dev == after.st_dev
            and before.st_ino == after.st_ino
            and before.st_size == after.st_size == len(primary) == len(confirmed)
            and before.st_mtime_ns == after.st_mtime_ns
            and before.st_ctime_ns == after.st_ctime_ns
            and primary == confirmed
        ):
            raise AssertionError("Store authority changed during verified read")
        return primary
    except OSError as error:
        raise AssertionError("Invalid store release authority file") from error
    finally:
        # A failed close must not skip remaining descriptors. Never retry the
        # same fd after an ambiguous close error (its number may be reused).
        close_error = None
        descriptors = ([descriptor] if descriptor is not None else [])
        descriptors.extend(reversed(parent_descriptors))
        for current in descriptors:
            try:
                os.close(current)
            except OSError as error:
                if close_error is None:
                    close_error = error
        if close_error is not None:
            raise AssertionError("Invalid store release authority file") from close_error


def store_config(authority_path, recipe):
    authority_bytes = read_store_authority_snapshot(Path(authority_path))

    # Release authority must have one unambiguous interpretation throughout
    # tooling, reviewers and the packaged runtime. The default JSON decoder
    # silently overwrites repeated members, including nested trust bundles.
    def unique_members(pairs):
        value = {}
        for name, item in pairs:
            if name in value:
                raise AssertionError("Duplicate store release authority JSON member")
            value[name] = item
        return value

    def reject_nonfinite_number(value):
        raise AssertionError("Non-finite store release authority JSON number")

    def parse_finite_float(value):
        numeric = float(value)
        if not math.isfinite(numeric):
            raise AssertionError("Non-finite store release authority JSON number")
        return numeric

    authority = json.loads(
        authority_bytes.decode("utf-8"),
        object_pairs_hook=unique_members,
        parse_constant=reject_nonfinite_number,
        parse_float=parse_finite_float,
    )
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
    assert type(authority["migrationLevel"]) is int and authority["migrationLevel"] >= 0, "Invalid store release authority migration level"
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
    return config, baseline.sha256(authority_bytes)


def compose(directory, mode="development", release_authority=None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    baseline.verify_import()
    recipe = baseline.read_json(RECIPE)
    version = recipe["version"]
    assert isinstance(version, str) and re.fullmatch(r"(?:0|[1-9][0-9]{0,4})(?:\.(?:0|[1-9][0-9]{0,4})){2}", version)
    assert all(int(part) <= 65535 for part in version.split(".")) and any(int(part) for part in version.split("."))
    assert recipe["stage"] == "I1-C1"
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
    application_files = recipe.get("application_files", {})
    store_excluded_application_files = recipe.get("store_excluded_application_files", [])
    assert isinstance(store_excluded_application_files, list)
    assert len(store_excluded_application_files) == len(set(store_excluded_application_files))
    assert set(store_excluded_application_files) <= set(application_files)
    for target, sources in application_files.items():
        if mode == "store" and target in store_excluded_application_files:
            continue
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
    if parsed_config is None:
        # The recipe owns the version, including the development fallback. A
        # supplied packaged authority still takes precedence inside this module.
        development_config = read_input("packages/control-client/src/config.js", inputs)
        pattern = rb'extensionVersion: "[^"]+"'
        assert len(re.findall(pattern, development_config)) == 1
        versioned_config = re.sub(pattern, b"extensionVersion: " + json.dumps(version).encode(), development_config)
        assert output["service_worker.js"].count(development_config) == 1
        output["service_worker.js"] = output["service_worker.js"].replace(development_config, versioned_config, 1)
    if parsed_config is not None:
        config_bytes = json.dumps(parsed_config, ensure_ascii=False, separators=(",", ":"))
        output["service_worker.js"] = b"globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=" + json.dumps(config_bytes).encode() + b";\n" + output["service_worker.js"]
        if mode == "store":
            development_config = (ROOT / "packages/control-client/src/config.js").read_bytes()
            assert output["service_worker.js"].count(development_config) == 1
            store_config_module = b"""/* Store package requires the build-time packaged authority; no development fallback. */
(() => {
  "use strict";
  const override = globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__;
  if (!override) throw new Error("PACKAGED_CONFIG_REQUIRED");
  const value = typeof override === "string" ? JSON.parse(override) : override;
  globalThis.SellerAgentsControlConfig = Object.freeze(value);
})();
"""
            output["service_worker.js"] = output["service_worker.js"].replace(
                development_config, store_config_module
            )
            # Store authority has already restricted the environment to
            # PREPRODUCTION. Compile out the development-only scope
            # option as well as its config fallback; retain fail-closed gates.
            development_scope = b'development: config.environment === "LOCAL DEVELOPMENT"'
            assert output["service_worker.js"].count(development_scope) == 1
            output["service_worker.js"] = output["service_worker.js"].replace(
                development_scope, b"development: false", 1
            )
    for patch in json.loads(read_input(recipe["application_patches"], inputs)):
        text = output[patch["target"]].decode()
        assert isinstance(patch["old"], str)
        assert text.count(patch["old"]) == 1, (patch["target"], patch["old"][:100], text.count(patch["old"]))
        if "new_source" in patch:
            # One reviewed A05 extraction. The old patch anchor and new
            # replacement remain pinned byte-for-byte; no arbitrary path
            # loading from the patch list is permitted.
            assert set(patch) == {"target", "old", "old_sha256", "new_source", "new_sha256"}
            assert patch["target"] == "content_script.js"
            assert patch["new_source"] == "apps/extension/src/content/position-own-button.js"
            assert baseline.sha256(patch["old"].encode()) == patch["old_sha256"]
            replacement_bytes = read_input(patch["new_source"], inputs)
            # Original inline patch ended with an extra blank line. Keep the
            # checked external source canonical and restore that exact suffix
            # at composition time, before checking the expected output hash.
            replacement = replacement_bytes.decode() + "\n"
            assert baseline.sha256(replacement.encode()) == patch["new_sha256"]
        else:
            assert set(patch) == {"target", "old", "new"}
            replacement = patch["new"]
        output[patch["target"]] = text.replace(patch["old"], replacement).encode()
    rewrite_product_labels(output)
    if mode == "store":
        rewrite_store_visible_brand(output)
        popup = output["popup.html"]
        assert popup.count("Локальная разработка".encode()) == 1
        assert popup.count(b"LOCAL DEVELOPMENT") == 1
        popup = popup.replace("Локальная разработка".encode(), "Проверяем аккаунт…".encode())
        popup = popup.replace(
            b"LOCAL DEVELOPMENT \xc2\xb7 I1-C1 \xc2\xb7 ",
            b"BETA \xc2\xb7 ",
        )
        output["popup.html"] = popup
    # This is a distinct composed package. The frozen donor stays untouched.
    for relative, data in output.items():
        data = data.replace(b"0.1.22", recipe["version"].encode())
        target = directory / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    manifest_path = directory / "manifest.json"
    manifest = baseline.read_json(manifest_path)
    if mode == "store":
        manifest["name"] = "Октопорт — Ozon + Wildberries"
        manifest["action"]["default_title"] = "Октопорт"
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
    # Explicit Start can attach the packaged receiver to a pre-existing AI tab.
    # Existing host permissions still determine where execution is permitted.
    # Extension import stays inside the toolbar popup, never a side panel.
    manifest["permissions"] = [
        permission
        for permission in dict.fromkeys(manifest["permissions"] + ["scripting"])
        if permission != "sidePanel"
    ]
    manifest["host_permissions"] = list(
        dict.fromkeys(manifest["host_permissions"] + recipe.get("ai_hosts", []) + recipe["marketplace_hosts"] + control_hosts)
    )
    for entry in manifest["content_scripts"]:
        entry["matches"] = list(dict.fromkeys(entry["matches"] + recipe.get("ai_hosts", [])))
    # A donor manifest must not resurrect an auxiliary import surface.
    manifest.pop("side_panel", None)
    baseline.write_json(manifest_path, manifest)
    if mode == "store":
        assert_no_store_brand_leaks(directory)
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
        f"OCTOPORT_v{receipt['version']}_CHROMIUM_STORE.zip"
        if mode == "store"
        else f"SELLER_AGENTS_I1_C1_v{receipt['version']}_LOCAL_DEVELOPMENT.zip"
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
        # Preserve the supplied final component for O_NOFOLLOW.
        release_authority=args.release_authority if args.release_authority else None,
    )
    print(receipt["package"])
