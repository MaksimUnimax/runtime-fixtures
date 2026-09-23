"""Run the signed-bootstrap verifier inside a real Chromium extension worker."""
from pathlib import Path
import argparse
import hashlib
import subprocess
from datetime import datetime, timezone
import json
import os
import tempfile
from playwright.sync_api import sync_playwright

def run(runtime: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=False)
    with sync_playwright() as playwright, tempfile.TemporaryDirectory(prefix="seller-agents-i1-browser-") as profile:
        options = {"headless": True, "args": ["--no-sandbox", f"--disable-extensions-except={runtime}", f"--load-extension={runtime}"]}
        if os.environ.get("SA_TEST_CHROMIUM"):
            options["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
        else:
            options["channel"] = "chromium"
        browser = playwright.chromium.launch_persistent_context(profile, **options)
        try:
            worker = browser.service_workers[0] if browser.service_workers else browser.wait_for_event("serviceworker")
            result = worker.evaluate("""async () => {
              const v = SellerAgentsBootstrapVerifier;
              const pair = await crypto.subtle.generateKey({name:'Ed25519'}, true, ['sign','verify']);
              const der = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
              const b64 = bytes => btoa(String.fromCharCode(...bytes));
              const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
              const fingerprint = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', der)));
              const keyId = 'browser-i1-key';
              const payload = {snapshotVersion:'bootstrap_snapshot_v2',contractVersion:'control_plane_v2',configVersion:1,issuedAt:'2026-09-15T00:00:00Z',expiresAt:'2099-09-16T00:00:00Z',offlineGraceUntil:'2099-09-17T00:00:00Z',serverTime:'2026-09-15T00:00:00Z',account:{id:'11111111-1111-4111-8111-111111111111',status:'ACTIVE'},subscription:{state:'NONE',planRevision:null},devicePolicy:{status:'ACTIVE'},compatibility:{extension:{status:'SUPPORTED',minimumVersion:null},browser:{status:'SUPPORTED'}},entitlements:{},features:{},ai:{status:'UNCONFIGURED'}};
              const bytes = new TextEncoder().encode(v.canonicalJson(payload));
              const prefix = new Uint8Array([...new TextEncoder().encode('product-control-plane/bootstrap-snapshot/v1'),0,...new TextEncoder().encode(keyId),0]);
              const signed = new Uint8Array(prefix.length + bytes.length); signed.set(prefix); signed.set(bytes, prefix.length);
              const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, signed));
              const bundle = {trustBundleVersion:'bootstrap_trust_bundle_v1',algorithm:'Ed25519',publicKeyFormat:'spki_der',publicKeyEncoding:'base64',fingerprintAlgorithm:'sha256',fingerprintEncoding:'lowercase_hex',keys:[{keyId,publicKey:b64(der),fingerprintSha256:fingerprint,lifecycle:'ACTIVE',trustEligibility:'SIGNING_AND_VERIFICATION'}]};
              const envelope = {envelopeVersion:'bootstrap_envelope_v2',algorithm:'Ed25519',keyId,payload:v.base64urlEncode(bytes),signature:v.base64urlEncode(signature)};
              const valid = await v.verifyV2(envelope, bundle);
              const tampered = {...envelope, payload:v.base64urlEncode(new TextEncoder().encode(v.canonicalJson({...payload,account:{id:'22222222-2222-4222-8222-222222222222',status:'ACTIVE'}})))};
              const invalid = await v.verifyV2(tampered, bundle);
              return {valid:valid.ok,account:valid.payload.account.id,tamperRejected:invalid.ok === false};
            }""")
            if result != {"valid": True, "account": "11111111-1111-4111-8111-111111111111", "tamperRejected": True}:
                raise AssertionError(result)
            rows = []
            for file in sorted(runtime.rglob("*"), key=lambda f: f.relative_to(runtime).as_posix()):
                if file.is_symlink():
                    raise RuntimeError("Runtime symlink is not accepted")
                if file.is_file():
                    rows.append(file.relative_to(runtime).as_posix() + "\0" + hashlib.sha256(file.read_bytes()).hexdigest() + "\n")
            fingerprint = hashlib.sha256("".join(rows).encode()).hexdigest()
            source_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=Path(__file__).resolve().parents[4], text=True).strip()
            (output / "result.json").write_text(json.dumps({"status": "PASS", "browser": browser.browser.version, "runtimePath": str(runtime.resolve()), "runtimeSha256": fingerprint, "sourceHead": source_head, "generatedAt": datetime.now(timezone.utc).isoformat(), **result}, ensure_ascii=False, indent=2))
        finally:
            browser.close()
    print(json.dumps(json.loads((output / "result.json").read_text()), ensure_ascii=False))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.runtime.resolve(), args.output.resolve())
