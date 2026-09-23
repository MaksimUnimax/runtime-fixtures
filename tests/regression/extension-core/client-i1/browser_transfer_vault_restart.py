#!/usr/bin/env python3
import argparse
import json
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ACCOUNT = "11111111-1111-4111-8111-111111111111"
RECIPIENT = "22222222-2222-4222-8222-222222222222"
SESSION = "33333333-3333-4333-8333-333333333333"
SOURCE = "44444444-4444-4444-8444-444444444444"
REQUEST = "55555555-5555-4555-8555-555555555555"
PACKET = "66666666-6666-4666-8666-666666666666"


def worker(context):
    return context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=30000)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--executable")
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    options = {
        "headless": True,
        "args": ["--no-sandbox", "--disable-dev-shm-usage", f"--disable-extensions-except={runtime}", f"--load-extension={runtime}"],
    }
    if args.executable:
        options["executable_path"] = args.executable
    else:
        options["channel"] = "chromium"
    result = {"status": "RUNNING", "label": args.label, "runtime": str(runtime)}
    with tempfile.TemporaryDirectory(prefix=f"octoport-a02-{args.label}-") as profile, sync_playwright() as pw:
        first = pw.chromium.launch_persistent_context(profile, **options)
        first_worker = worker(first)
        expected_worker_url = first_worker.url
        prepared = first_worker.evaluate(
            """async (v)=>{
              const keys=await SellerAgentsCredentialTransferCrypto.generateRecipientKeyPair();
              const expiresAt=new Date(Date.now()+300000).toISOString();
              await SellerAgentsCredentialTransferVault.put({vaultVersion:SellerAgentsCredentialTransferVault.VERSION,requestId:v.requestId,accountId:v.accountId,recipientDeviceId:v.recipientDeviceId,sessionId:v.sessionId,sourceDeviceId:v.sourceDeviceId,selectedStoreIds:['installed-vault-store'],publicKeySpki:keys.publicKeySpki,privateKey:keys.privateKey,expiresInSeconds:300,expiresAt,phase:'ACTIVE',packetId:null,result:null});
              const envelope=await SellerAgentsCredentialTransferCrypto.encrypt({accountId:v.accountId,requestId:v.requestId,sourceDeviceId:v.sourceDeviceId,recipientDeviceId:v.recipientDeviceId,packetId:v.packetId,recipientPublicKeySpki:keys.publicKeySpki,payload:{probe:'installed-idb-crypto-key-restart',version:1}});
              const stored=await SellerAgentsCredentialTransferVault.get(v.requestId);
              let exportRejected=false; try{await crypto.subtle.exportKey('jwk',stored.privateKey);}catch(_){exportRejected=true;}
              return {envelope,phase:stored.phase,keyType:stored.privateKey.type,keyExtractable:stored.privateKey.extractable,exportRejected,workerUrl:globalThis.location?.href||null};
            }""",
            {"requestId": REQUEST, "accountId": ACCOUNT, "recipientDeviceId": RECIPIENT, "sessionId": SESSION, "sourceDeviceId": SOURCE, "packetId": PACKET},
        )
        assert prepared["phase"] == "ACTIVE", prepared
        assert prepared["keyType"] == "private" and prepared["keyExtractable"] is False and prepared["exportRejected"] is True, prepared
        first.close()

        second = pw.chromium.launch_persistent_context(profile, **options)
        second_worker = worker(second)
        assert second_worker.url == expected_worker_url, {"before": expected_worker_url, "after": second_worker.url}
        restored = second_worker.evaluate(
            """async (v)=>{
              const stored=await SellerAgentsCredentialTransferVault.get(v.requestId);
              if(!stored) return {missing:true};
              let exportRejected=false; try{await crypto.subtle.exportKey('jwk',stored.privateKey);}catch(_){exportRejected=true;}
              const payload=await SellerAgentsCredentialTransferCrypto.decrypt({envelope:v.envelope,privateKey:stored.privateKey,accountId:v.accountId,requestId:v.requestId,sourceDeviceId:v.sourceDeviceId,recipientDeviceId:v.recipientDeviceId,packetId:v.packetId});
              await SellerAgentsCredentialTransferVault.remove(v.requestId);
              const after=await SellerAgentsCredentialTransferVault.get(v.requestId);
              return {missing:false,phase:stored.phase,keyType:stored.privateKey.type,keyExtractable:stored.privateKey.extractable,exportRejected,payload,removed:after===null};
            }""",
            {"requestId": REQUEST, "accountId": ACCOUNT, "recipientDeviceId": RECIPIENT, "sourceDeviceId": SOURCE, "packetId": PACKET, "envelope": prepared["envelope"]},
        )
        second.close()
    assert restored.get("missing") is False, restored
    assert restored["phase"] == "ACTIVE", restored
    assert restored["keyType"] == "private" and restored["keyExtractable"] is False and restored["exportRejected"] is True, restored
    assert restored["payload"] == {"probe": "installed-idb-crypto-key-restart", "version": 1}, restored
    assert restored["removed"] is True, restored
    result.update(status="PASS", workerUrlStable=True, keyType="private", keyExtractable=False, exportRejected=True, decryptedAfterRestart=True, cleanupConfirmed=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
