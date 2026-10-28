#!/usr/bin/env python3
"""Real IndexedDB/CryptoKey persistence across two owned browser restarts.

The pending import record is a synthetic vault fixture. This does not claim
API authentication, catalog import, relay recovery or ACK acceptance.
"""
import argparse
import hashlib
import json
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_worker_activation import (
    require_loaded_extension_id, require_manifest_worker_entry, select_owned_worker,
)

ACCOUNT = "11111111-1111-4111-8111-111111111111"
RECIPIENT = "22222222-2222-4222-8222-222222222222"
SESSION = "33333333-3333-4333-8333-333333333333"
SOURCE = "44444444-4444-4444-8444-444444444444"
REQUEST = "55555555-5555-4555-8555-555555555555"
PACKET = "66666666-6666-4666-8666-666666666666"


def worker(context, runtime, entry, expected_id=None):
    # Match the existing I1 verifier's CDP load route, never an arbitrary worker.
    context.route("https://**/*", lambda route: route.abort())
    context.route("http://**/*", lambda route: route.abort())
    cdp = context.browser.new_browser_cdp_session()
    extension_id = require_loaded_extension_id(
        cdp.send("Extensions.loadUnpacked", {"path": str(runtime)})
    )
    if expected_id is not None and extension_id != expected_id:
        raise AssertionError("Extension origin changed across profile restart")
    selected = select_owned_worker(context.service_workers, extension_id, entry)
    if selected is None:
        popup = context.new_page()
        try:
            popup.goto(f"chrome-extension://{extension_id}/popup.html",
                       wait_until="domcontentloaded", timeout=12000)
            selected = select_owned_worker(context.service_workers, extension_id, entry)
            if selected is None:
                exact = f"chrome-extension://{extension_id}/{entry}"
                selected = context.wait_for_event(
                    "serviceworker", predicate=lambda value: value.url == exact,
                    timeout=12000,
                )
        finally:
            popup.close()
    selected = select_owned_worker([selected], extension_id, entry)
    if selected is None:
        raise AssertionError("Exact extension worker is absent")
    return selected, extension_id


def evaluate(worker, source, values):
    # A stalled IndexedDB operation must not consume the whole CI job.
    return worker.evaluate("""async (values) => {
      let timer;
      try {
        return await Promise.race([
          (""" + source + """)(values),
          new Promise((_, reject) => { timer = setTimeout(
            () => reject(new Error('VAULT_FIXTURE_DEADLINE')), 15000); })
        ]);
      } finally { clearTimeout(timer); }
    }""", values)


@contextmanager
def opened_worker(pw, profile, options, runtime, entry, expected_id=None):
    context = pw.chromium.launch_persistent_context(profile, **options)
    try:
        yield worker(context, runtime, entry, expected_id)
    finally:
        # Failed shutdown is a failed proof, not a successful restart.
        context.close()


KEY_AND_PAYLOAD = """
  if (!stored || stored.privateKey?.type !== 'private' || stored.privateKey.extractable !== false)
    throw new Error('VAULT_KEY_NOT_RESTORED');
  let exportRejected = false;
  try { await crypto.subtle.exportKey('jwk', stored.privateKey); }
  catch (_) { exportRejected = true; }
  if (!exportRejected) throw new Error('VAULT_PRIVATE_KEY_EXPORTABLE');
  const payload = await SellerAgentsCredentialTransferCrypto.decrypt({
    envelope:v.envelope, privateKey:stored.privateKey, accountId:v.accountId,
    requestId:v.requestId, sourceDeviceId:v.sourceDeviceId,
    recipientDeviceId:v.recipientDeviceId, packetId:v.packetId
  });
  if (payload.probe !== 'installed-idb-crypto-key-restart' || payload.version !== 1)
    throw new Error('VAULT_DECRYPTED_PAYLOAD_CHANGED');
"""


def run(args):
    # Do not resolve away an unsafe symlink before the existing preflight.
    runtime = args.runtime.absolute()
    entry = require_manifest_worker_entry(runtime)
    options = {
        "headless": True,
        "ignore_default_args": ["--disable-extensions"],
        "args": ["--no-sandbox", "--enable-unsafe-extension-debugging",
                 "--disable-background-networking"],
    }
    executable = args.executable or os.environ.get("SA_TEST_CHROMIUM")
    options["executable_path" if executable else "channel"] = executable or "chromium"
    values = {"requestId": REQUEST, "accountId": ACCOUNT, "recipientDeviceId": RECIPIENT,
              "sessionId": SESSION, "sourceDeviceId": SOURCE, "packetId": PACKET}
    with tempfile.TemporaryDirectory(prefix="octoport-a02-vault-") as profile, sync_playwright() as pw:
        with opened_worker(pw, profile, options, runtime, entry) as (first, extension_id):
            prepared = evaluate(first, """async (v) => {
              const keys = await SellerAgentsCredentialTransferCrypto.generateRecipientKeyPair();
              const expiresAt = new Date(Date.now()+300000).toISOString();
              await SellerAgentsCredentialTransferVault.put({
                vaultVersion:SellerAgentsCredentialTransferVault.VERSION,
                requestId:v.requestId, accountId:v.accountId, recipientDeviceId:v.recipientDeviceId,
                sessionId:v.sessionId, sourceDeviceId:v.sourceDeviceId,
                selectedStoreIds:['installed-vault-store'], publicKeySpki:keys.publicKeySpki,
                privateKey:keys.privateKey, expiresInSeconds:300, expiresAt,
                phase:'ACTIVE', packetId:null, result:null
              });
              const envelope = await SellerAgentsCredentialTransferCrypto.encrypt({
                ...v, recipientPublicKeySpki:keys.publicKeySpki,
                payload:{probe:'installed-idb-crypto-key-restart',version:1}
              });
              const stored = await SellerAgentsCredentialTransferVault.get(v.requestId);
              if (stored.phase !== 'ACTIVE') throw new Error('VAULT_ACTIVE_NOT_DURABLE');
              const {privateKey, ...activeMetadata} = stored;
              return {envelope, expiresAt, publicKeySpki:keys.publicKeySpki, activeMetadata};
            }""", values)

        values.update(prepared)
        with opened_worker(pw, profile, options, runtime, entry, extension_id) as (second, _):
            pending = evaluate(second, """async (v) => {
              const stored = await SellerAgentsCredentialTransferVault.get(v.requestId);
              """ + KEY_AND_PAYLOAD + """
              if (stored.phase !== 'ACTIVE' || stored.expiresAt !== v.expiresAt ||
                  stored.publicKeySpki !== v.publicKeySpki)
                throw new Error('VAULT_ACTIVE_CHANGED_AFTER_RESTART');
              // Set up the missing persistence dimension, without claiming a
              // real catalog import or bypassing the client's authority guards.
              const result = {requestId:v.requestId, importState:'IMPORTED', results:[{
                storeId:'installed-vault-store', kind:'IMPORTED', code:null,
                store:{id:'installed-vault-store', marketplace:'wildberries', credentialRevision:'P1'}
              }]};
              const record = await SellerAgentsCredentialTransferVault.update(v.requestId,
                current => ({...current, phase:'IMPORTED_PENDING_ACK', packetId:v.packetId, result}));
              const {privateKey:activeKey, ...activeMetadata} = stored;
              const {privateKey, ...metadata} = record;
              return {activeMetadata, metadata};
            }""", values)
        if pending["activeMetadata"] != prepared["activeMetadata"]:
            raise AssertionError("Active vault identity changed across browser restart")
        pending = pending["metadata"]

        with opened_worker(pw, profile, options, runtime, entry, extension_id) as (third, _):
            restored = evaluate(third, """async (v) => {
              const stored = await SellerAgentsCredentialTransferVault.get(v.requestId);
              """ + KEY_AND_PAYLOAD + """
              const {privateKey, ...metadata} = stored;
              await SellerAgentsCredentialTransferVault.remove(v.requestId);
              if (await SellerAgentsCredentialTransferVault.get(v.requestId) !== null)
                throw new Error('VAULT_CLEANUP_NOT_CONFIRMED');
              return metadata;
            }""", values)
        # Compare all persisted fields, including identity, expiry, packet and
        # result. A surviving key alone cannot hide a lost/changed pending phase.
        if restored != pending or restored["phase"] != "IMPORTED_PENDING_ACK":
            raise AssertionError("Pending import record changed across browser restart")
        if restored["packetId"] != PACKET or restored["result"]["importState"] != "IMPORTED":
            raise AssertionError("Pending packet or import result was not restored")

    rows = [file.relative_to(runtime).as_posix() + "\0" + hashlib.sha256(file.read_bytes()).hexdigest() + "\n"
            for file in sorted(runtime.rglob("*")) if file.is_file()]
    return {"status": "PASS", "label": args.label,
            "runtimeSha256": hashlib.sha256("".join(rows).encode()).hexdigest(),
            "workerUrlStable": True, "browserRestarts": 2,
            "keyType": "private", "keyExtractable": False, "exportRejected": True,
            "decryptedAfterRestart": True, "pendingRecordExactAfterRestart": True,
            "cleanupConfirmed": True, "fixturePhases": ["ACTIVE", "IMPORTED_PENDING_ACK"],
            "boundary": "REAL_BROWSER_INDEXEDDB_SYNTHETIC_VAULT_RECORD_ONLY",
            "apiRelayAndCatalogAcceptance": False, "installedOwnerAcceptance": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--executable")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        raise FileExistsError("Refusing to overwrite existing browser evidence")
    try:
        result = run(args)
    except Exception as error:
        with args.output.open("x") as output:
            json.dump({"status": "FAIL", "label": args.label,
                       "error_type": type(error).__name__,
                       "boundary": "REAL_BROWSER_INDEXEDDB_SYNTHETIC_VAULT_RECORD_ONLY"}, output)
        raise
    with args.output.open("x") as output:
        json.dump(result, output, indent=2, ensure_ascii=False)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
