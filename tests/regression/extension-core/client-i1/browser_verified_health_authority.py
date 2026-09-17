"""Exercise the passive verified-Health authority composition in Chromium."""
from pathlib import Path
import argparse
import base64
import json
import os
import tempfile
import time
from playwright.sync_api import sync_playwright


def run(runtime: Path, private_key: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=False)
    private_key_b64 = base64.b64encode(private_key.read_bytes()).decode("ascii")
    with sync_playwright() as playwright, tempfile.TemporaryDirectory(prefix="seller-agents-b2-browser-") as profile:
        options = {"headless": True, "args": ["--no-sandbox", f"--disable-extensions-except={runtime}", f"--load-extension={runtime}"]}
        if os.environ.get("SA_TEST_CHROMIUM"):
            options["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
        else:
            options["channel"] = "chromium"
        browser = playwright.chromium.launch_persistent_context(profile, **options)
        try:
            # A tab-created event deterministically wakes the MV3 worker in
            # headless Chromium before the probe evaluates its globals.
            browser.new_page()
            worker = browser.service_workers[0] if browser.service_workers else browser.wait_for_event("serviceworker")
            fixtures = worker.evaluate(r"""async (privateKeyB64) => {
                  const AUTH = 'seller_agents_control_auth_v2';
                  const accountId = '11111111-1111-4111-8111-111111111111';
                  const deviceId = '22222222-2222-4222-8222-222222222222';
                  const sessionId = '33333333-3333-4333-8333-333333333333';
                  const keyId = 'browser-fixture-key';
                  const b64url = bytes => { let value = ''; for (let i = 0; i < bytes.length; i += 0x8000) value += btoa(String.fromCharCode(...bytes.slice(i, i + 0x8000))); return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); };
                  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(privateKeyB64), c => c.charCodeAt(0)), {name:'Ed25519'}, false, ['sign']);
                  const sign = async (domain, claim) => {
                    const bytes = new TextEncoder().encode(SellerAgentsBootstrapVerifier.canonicalJson(claim));
                    const prefix = new TextEncoder().encode(domain + '\0' + keyId + '\0');
                    const signed = new Uint8Array(prefix.length + bytes.length); signed.set(prefix); signed.set(bytes, prefix.length);
                    return { healthEnvelopeVersion:'health_envelope_v1', algorithm:'Ed25519', keyId, payload:b64url(bytes), signature:b64url(new Uint8Array(await crypto.subtle.sign('Ed25519', key, signed))) };
                  };
                  const content = {schemaVersion:'adapter_profile_v1',page:{identityStrategy:'page_identity',conversationStrategy:'conversation_root',composerStrategy:'composer_root'},selectors:{conversation:{strategy:'conversation_root',primary:{kind:'packaged_selector_reference',reference:'conversation-root'},fallbacks:[],timeoutMs:1000,observationMode:'polling'},composer:{strategy:'composer_root',primary:{kind:'packaged_selector_reference',reference:'composer-root'},fallbacks:[],timeoutMs:1000,observationMode:'polling'},send:{strategy:'send_control',primary:{kind:'packaged_selector_reference',reference:'send-control'},fallbacks:[],timeoutMs:1000,observationMode:'polling'},assistantResponse:{strategy:'assistant_response',primary:{kind:'packaged_selector_reference',reference:'assistant-response'},fallbacks:[],timeoutMs:1000,observationMode:'polling'}},observation:{mode:'polling',intervalMs:100},contours:[{key:'page_identity',required:true,expectedState:'PRESENT',strategy:'page_identity'},{key:'conversation_root',required:true,expectedState:'PRESENT',strategy:'conversation_root'},{key:'composer_root',required:true,expectedState:'INTERACTIVE',strategy:'composer_root'},{key:'send_control',required:true,expectedState:'INTERACTIVE',strategy:'send_control'}]};
                  const compatibility = {schemaVersion:'profile_compatibility_v1',contractVersion:'control_plane_v1',browserFamilies:['chrome'],minimumBrowserVersions:[],minimumExtensionVersion:null};
                  const contentSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SellerAgentsBootstrapVerifier.canonicalJson({content, compatibility}))))].map(x => x.toString(16).padStart(2,'0')).join('');
                  const now = Date.now();
                  const payload = {snapshotVersion:'bootstrap_snapshot_v2',contractVersion:'control_plane_v2',configVersion:1,issuedAt:new Date(now - 1000).toISOString(),expiresAt:new Date(now + 3600000).toISOString(),offlineGraceUntil:new Date(now + 7200000).toISOString(),serverTime:new Date(now).toISOString(),account:{id:accountId,status:'ACTIVE'},subscription:{state:'NONE',planRevision:null},devicePolicy:{status:'ACTIVE'},compatibility:{extension:{status:'SUPPORTED',minimumVersion:null},browser:{status:'SUPPORTED'}},entitlements:{},features:{},ai:{status:'RESOLVED',detected:{family:'chatgpt',surface:'web',variant:null},profile:{profileKey:'browser-fixture-profile',revision:1,scopeVariant:null,schemaVersion:'adapter_profile_v1',contentSha256,content,compatibility}}};
                  const bootstrapBytes = new TextEncoder().encode(SellerAgentsBootstrapVerifier.canonicalJson(payload));
                  const bootstrapPrefix = new TextEncoder().encode('product-control-plane/bootstrap-snapshot/v1\0' + keyId + '\0');
                  const bootstrapSigned = new Uint8Array(bootstrapPrefix.length + bootstrapBytes.length); bootstrapSigned.set(bootstrapPrefix); bootstrapSigned.set(bootstrapBytes, bootstrapPrefix.length);
                  const bootstrapEnvelope = {envelopeVersion:'bootstrap_envelope_v2',algorithm:'Ed25519',keyId,payload:b64url(bootstrapBytes),signature:b64url(new Uint8Array(await crypto.subtle.sign('Ed25519', key, bootstrapSigned)))};
                  const trustBundleSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SellerAgentsBootstrapVerifier.canonicalJson(SellerAgentsControlConfig.trustBundle))))].map(x => x.toString(16).padStart(2,'0')).join('');
                  const browser = {family:'chrome',version:(String(navigator.userAgent).match(/(?:Chrome|YaBrowser)\/(\d+(?:\.\d+){0,3})/i) || [null,'0.0.0'])[1]};
                  const auth = {generation:1,credentials:{deviceId,sessionId,tokenType:'Bearer',accessToken:'BROWSER_ACCESS_TOKEN_20260917',accessTokenExpiresAt:new Date(now + 3600000).toISOString(),refreshToken:'R'.repeat(43),refreshTokenExpiresAt:new Date(now + 7200000).toISOString()},pending:null,rotation:null,authority:{verified:true,workAllowed:true,requestedAi:'chatgpt',generation:1,payload,envelope:bootstrapEnvelope,deviceId,sessionId,cacheBinding:{cacheVersion:'control_cache_binding_v1',controlApiOrigin:SellerAgentsControlConfig.controlApiOrigin,portalOrigin:SellerAgentsControlConfig.portalOrigin,contractVersion:'control_plane_v2',extensionVersion:'0.2.4',browser,detectedAi:{family:'chatgpt',surface:'web',variant:null},trustBundleSha256}},cacheClock:{cacheVersion:'control_cache_clock_v1',owner:{controlApiOrigin:SellerAgentsControlConfig.controlApiOrigin,portalOrigin:SellerAgentsControlConfig.portalOrigin,contractVersion:'control_plane_v2',deviceId,sessionId},trustedServerTimeMs:now,effectiveTimeMs:now},lastError:null};
                  await chrome.storage.local.set({[AUTH]:auth});
                  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bootstrapBytes))].map(x => x.toString(16).padStart(2,'0')).join('');
                  const context = {accountId,deviceId,sessionId,contractVersion:'control_plane_v2',configVersion:1,bootstrapSnapshotSha256:digest,ai:{family:'chatgpt',surface:'web',variant:null,profileKey:'browser-fixture-profile',revision:1,scopeVariant:null,contentSha256}};
                  const health = await sign('product-control-plane/health-authority/v1', {healthClaimVersion:'health_claim_v1',status:'PASS',target:'WORK',context,observedAt:new Date(now - 1000).toISOString(),expiresAt:new Date(now + 15 * 60 * 1000).toISOString(),executionAuthority:false});
                  const expired = await sign('product-control-plane/health-authority/v1', {healthClaimVersion:'health_claim_v1',status:'PASS',target:'WORK',context,observedAt:new Date(now - 16 * 60 * 1000).toISOString(),expiresAt:new Date(now - 1).toISOString(),executionAuthority:false});
                  const input = {account:{authenticated:true,accountId,expectedAccountId:accountId},session:{generation:1,expectedGeneration:1,deviceId,expectedDeviceId:deviceId,sessionId,expectedSessionId:sessionId,revoked:false,obsolete:false},compatibility:{extension:{version:'0.2.4',status:'SUPPORTED',minimumVersion:'0.2.0'},browser:{status:'SUPPORTED'},contractVersion:'control_plane_v2',expectedContractVersion:'control_plane_v2'},bootstrap:{verified:true,source:'ONLINE',freshness:'FRESH',accountId, generation:1,deviceId,sessionId,contractVersion:'control_plane_v2',configVersion:1,aiProvider:'chatgpt'},ai:{provider:'chatgpt',surface:'web',variant:null,profile:{verified:true,provider:'chatgpt',profileKey:'browser-fixture-profile',revision:1,scopeVariant:null,contentSha256}},health:{status:'PASS',current:true,verified:true},dialogue:{key:'https://chatgpt.com|browser-dialogue',trusted:true,tabId:null,expectedTabId:null,identity:{key:'https://chatgpt.com|browser-dialogue',origin:'https://chatgpt.com',conversationId:'browser-dialogue',provider:'chatgpt',status:'confirmed'},binding:{bound:true,bindingId:'browser-binding',revision:2,expectedRevision:2,conversationKey:'https://chatgpt.com|browser-dialogue',origin:'https://chatgpt.com',conversationId:'browser-dialogue',provider:'chatgpt',accountId,storeId:'ozon-store-a',marketplace:'ozon',credentialRevision:'ozon-credential-revision-a'}},store:{accountId,storeId:'ozon-store-a',marketplace:'ozon',credentialRevision:'ozon-credential-revision-a',selectedStoreId:null,expectedStoreId:null,expectedCredentialRevision:null,authGeneration:null},work:{operation:'start',state:'inactive',startIntentId:null,expectedStartIntentId:null},capabilityIntersection:{schemaVersion:'verified_capability_intersection_v1',source:'ONLINE',freshness:'FRESH',configVersion:1,accessBasis:'BETA',executionAuthority:false,capabilities:[{capabilityId:'marketplace.ozon.adapter',entitlementKey:'source.ozon',packaged:true,signedPermissionPresent:true,signedPermissionAllowed:true,permissionSatisfied:true,executionAuthority:false},{capabilityId:'ai.chatgpt.web.adapter',entitlementKey:'ai.chatgpt',packaged:true,signedPermissionPresent:true,signedPermissionAllowed:true,permissionSatisfied:true,executionAuthority:false}]}};
                  return {health,input,expired,tampered:{...health,signature:health.signature.slice(0,-1) + (health.signature.endsWith('A') ? 'B' : 'A')}};
                }""", private_key_b64)
            # Restart the persistent profile so the fresh MV3 worker restores
            # the synthetic authority before its one-time client init runs.
            browser.close()
            browser = playwright.chromium.launch_persistent_context(profile, **options)
            browser.new_page()
            worker = browser.service_workers[0] if browser.service_workers else browser.wait_for_event("serviceworker")
            result = worker.evaluate(r"""async ({input, health, expired, tampered}) => {
              const calls = {network:0, messages:0};
              const originalFetch = globalThis.fetch;
              globalThis.fetch = (...args) => { calls.network++; return Promise.reject(new Error('B2_NETWORK')); };
              const originalSend = chrome.tabs.sendMessage;
              chrome.tabs.sendMessage = (...args) => { calls.messages++; return originalSend(...args); };
              const evaluate = envelope => SellerAgentsVerifiedOnlineWorkAuthority.evaluate(input, envelope);
              const valid = await evaluate(health);
              const badSignature = await evaluate(tampered);
              const expiredResult = await evaluate(expired);
              globalThis.fetch = originalFetch;
              chrome.tabs.sendMessage = originalSend;
              return {valid:{allowed:valid.allowed,executionAuthority:valid.executionAuthority,frozen:Object.isFrozen(valid)},tampered:{allowed:badSignature.allowed},expired:{allowed:expiredResult.allowed},calls};
            }""", fixtures)
            expected = {"valid": {"allowed": True, "executionAuthority": False, "frozen": True}, "tampered": {"allowed": False}, "expired": {"allowed": False}, "calls": {"network": 0, "messages": 0}}
            if result != expected:
                raise AssertionError(result)
            (output / "result.json").write_text(json.dumps({"status": "PASS", "browser": browser.browser.version, **result}, ensure_ascii=False, indent=2))
        finally:
            browser.close()
    print((output / "result.json").read_text())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.runtime.resolve(), args.private_key.resolve(), args.output.resolve())
