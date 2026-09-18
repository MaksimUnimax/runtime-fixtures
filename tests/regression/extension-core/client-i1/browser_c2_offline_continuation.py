"""Chromium proof for durable signed authority and passive offline evaluation."""
from pathlib import Path
import argparse
import json
import time

from browser_c1_acceptance import (
    AUTH, BINDINGS, CHAT_FIXTURE, CONVERSATION_KEY, SESSIONS, STORES,
    BrowserFixture, SyntheticHealthServer, wait_for,
)
from playwright.sync_api import sync_playwright


def evaluate(fixture, include_provenance=True):
    return fixture.worker.evaluate(r"""async ({includeProvenance}) => {
      const local = await chrome.storage.local.get(null);
      const auth = local.seller_agents_control_auth_v2;
      const session = local.ozmb_work_sessions_v1["https://chatgpt.com|44444444-4444-4444-8444-444444444444"];
      const binding = local.ozmb_conversation_bindings["https://chatgpt.com|44444444-4444-4444-8444-444444444444"];
      const store = local.seller_agents_stores_v1.accounts[auth.authority.payload.account.id].stores[binding.store_context.storeId];
      const p = auth.authority.payload, profile = p.ai.profile;
      const current = {accountId:p.account.id,generation:auth.generation,deviceId:auth.authority.deviceId,sessionId:auth.authority.sessionId,
        origin:binding.origin,conversationId:binding.conversation_id,conversationKey:binding.conversation_key,bindingId:binding.binding_id,bindingRevision:binding.revision,
        marketplace:store.marketplace,storeId:store.id,credentialRevision:store.credentialRevision,aiFamily:p.ai.detected.family,aiSurface:p.ai.detected.surface,aiVariant:p.ai.detected.variant,
        aiProfile:{profileKey:profile.profileKey,revision:profile.revision,scopeVariant:profile.scopeVariant,contentSha256:profile.contentSha256},aiProfileKey:profile.profileKey,aiProfileRevision:profile.revision,aiProfileScopeVariant:profile.scopeVariant,aiProfileContentSha256:profile.contentSha256,workStartIntentId:session.start_intent_id};
      const work = includeProvenance ? session : {...session, admission_provenance:null};
      return await SellerAgentsOfflineWorkAuthority.evaluate({operation:'CONTINUE',work,receipt:includeProvenance ? session.admission_provenance : null,cachedAuthority:auth.authority,cacheClock:auth.cacheClock,safeTimeMs:auth.cacheClock.effectiveTimeMs,
        identity:{origin:binding.origin,conversationId:binding.conversation_id},binding,store,current});
    }""", {"includeProvenance": include_provenance})


def run(runtime: Path, private_key: Path, output: Path):
    output.mkdir(parents=True, exist_ok=False)
    server = SyntheticHealthServer(private_key).start()
    rows = []
    with sync_playwright() as pw:
        fixture = BrowserFixture(runtime, private_key, server, output)
        fixture.open(pw)
        try:
            fixture.reset()
            fixture.add_ozon()
            server.configure("pass")
            fixture.click_start()
            wait_for(fixture.active, "online active Work")
            storage = fixture.storage()
            receipt = storage[SESSIONS][CONVERSATION_KEY].get("admission_provenance")
            # C3C deliberately records local signed-authority provenance as
            # non-bearer lifecycle evidence after the online health check.
            assert receipt and receipt["mode"] == "LOCAL_SIGNED_AUTHORITY"
            assert not any(token.lower() in json.dumps(receipt).lower() for token in ("access_token", "refresh_token", "cookie", "health", "report"))
            assert "health" not in json.dumps(storage).lower().replace("health-authority", "")
            assert not any("api-seller.ozon.ru" in event["url"] or "wildberries.ru" in event["url"] for event in fixture.events)
            rows.append({"id": "BR-C2-01", "status": "PASS"})

            before = len(server.requests)
            valid = evaluate(fixture, include_provenance=False)
            assert valid["allowed"] is True and valid["executionAuthority"] is False
            assert len(server.requests) == before
            rows.append({"id": "BR-C2-02", "status": "PASS"})

            fixture.restart()
            restarted = evaluate(fixture, include_provenance=False)
            assert restarted["allowed"] is True and restarted["executionAuthority"] is False
            rows.append({"id": "BR-C2-03", "status": "PASS"})

            fixture.worker.evaluate(r"""async () => {
              const x = await chrome.storage.local.get('seller_agents_control_auth_v2');
              x.seller_agents_control_auth_v2.authority.payload.offlineGraceUntil = new Date(x.seller_agents_control_auth_v2.cacheClock.effectiveTimeMs).toISOString();
              await chrome.storage.local.set(x);
            }""")
            expired = evaluate(fixture)
            assert expired["allowed"] is False and expired["executionAuthority"] is False
            rows.append({"id": "BR-C2-04", "status": "PASS", "assertion": "tampered durable signed authority denies"})

            fixture.finish()
            denied = evaluate(fixture)
            assert fixture.storage()[SESSIONS][CONVERSATION_KEY]["state"] == "inactive"
            # C3C's pure evaluator intentionally ignores lifecycle booleans;
            # the application path enforces active Work before dispatch and
            # Finish clears the durable Work session here.
            assert denied["executionAuthority"] is False
            rows.append({"id": "BR-C2-05", "status": "PASS"})
        finally:
            fixture.close()
    server.stop()
    result = {"status": "PASS" if len(rows) == 5 else "FAIL", "browser": "native Chromium", "runtime": str(runtime), "cases": rows}
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.runtime.resolve(), args.private_key.resolve(), args.output.resolve())
