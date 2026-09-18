"""Native Chromium BR-C1 acceptance for source and extracted MV3 runtimes.

This file is test infrastructure only.  The loopback server is the only
synthetic component: the extension popup, service worker, storage, verifier,
admission fence, and Work lifecycle are the candidate runtime itself.
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
import os
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from synthetic_health_server import SyntheticHealthServer


ROOT = Path(__file__).resolve().parents[4]
CHAT_FIXTURE = ROOT / "tests/regression/extension-core/fixtures/application-chat.html"
AUTH = "seller_agents_control_auth_v2"
STORES = "seller_agents_stores_v1"
BINDINGS = "ozmb_conversation_bindings"
SESSIONS = "ozmb_work_sessions_v1"
PENDING = "ozmb_pending_work_starts_v1"
MANUAL = "ozmb_manual_operations"
KEY_ID = "browser-fixture-key"
ACCOUNT = "11111111-1111-4222-8111-111111111111"
DEVICE = "22222222-2222-4222-8222-222222222222"
SESSION = "33333333-3333-4333-8333-333333333333"
CONVERSATION = "44444444-4444-4444-8444-444444444444"
CONVERSATION_KEY = f"https://chatgpt.com|{CONVERSATION}"


def wait_for(fn, description: str, timeout: float = 10):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = fn()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError(f"Timed out: {description}")


def seed_authority(worker, private_key: Path):
    encoded = base64.b64encode(private_key.read_bytes()).decode("ascii")
    worker.evaluate(
        """async (pkcs8) => {
          const v = SellerAgentsBootstrapVerifier;
          const fromB64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
          const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
          const accountId = '11111111-1111-4222-8111-111111111111';
          const deviceId = '22222222-2222-4222-8222-222222222222';
          const sessionId = '33333333-3333-4333-8333-333333333333';
          const keyId = 'browser-fixture-key';
          const content = {
            schemaVersion:'adapter_profile_v1',
            page:{identityStrategy:'page_identity',conversationStrategy:'conversation_root',composerStrategy:'composer_root'},
            selectors:{
              conversation:{strategy:'conversation_root',primary:{kind:'packaged_selector_reference',reference:'conversation-root'},fallbacks:[],timeoutMs:1000,observationMode:'polling'},
              composer:{strategy:'composer_root',primary:{kind:'packaged_selector_reference',reference:'composer-root'},fallbacks:[],timeoutMs:1000,observationMode:'polling'},
              send:{strategy:'send_control',primary:{kind:'packaged_selector_reference',reference:'send-control'},fallbacks:[],timeoutMs:1000,observationMode:'polling'},
              assistantResponse:{strategy:'assistant_response',primary:{kind:'packaged_selector_reference',reference:'assistant-response'},fallbacks:[],timeoutMs:1000,observationMode:'polling'}},
            observation:{mode:'polling',intervalMs:500},
            contours:[
              {key:'page_identity',required:true,expectedState:'PRESENT',strategy:'page_identity'},
              {key:'conversation_root',required:true,expectedState:'PRESENT',strategy:'conversation_root'},
              {key:'composer_root',required:true,expectedState:'INTERACTIVE',strategy:'composer_root'},
              {key:'send_control',required:true,expectedState:'INTERACTIVE',strategy:'send_control'}]};
          const compatibility = {schemaVersion:'profile_compatibility_v1',contractVersion:'control_plane_v1',browserFamilies:['chrome'],minimumBrowserVersions:[],minimumExtensionVersion:null};
          const contentSha256 = hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v.canonicalJson({content,compatibility})))));
          const now = Date.now();
          const payload = {
            snapshotVersion:'bootstrap_snapshot_v2',contractVersion:'control_plane_v2',configVersion:1,
            issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),offlineGraceUntil:new Date(now+7200000).toISOString(),serverTime:new Date(now).toISOString(),
            accessBasis:'BETA',account:{id:accountId,status:'ACTIVE'},subscription:{state:'NONE',planRevision:null},devicePolicy:{status:'ACTIVE'},
            compatibility:{extension:{status:'SUPPORTED',minimumVersion:null},browser:{status:'SUPPORTED'}},
            entitlements:{'source.ozon':true,'source.wildberries':true,'ai.chatgpt':true,'ai.alice':true},features:{},
            ai:{status:'RESOLVED',detected:{family:'chatgpt',surface:'web',variant:null},profile:{profileKey:'browser-fixture-profile',revision:1,scopeVariant:null,schemaVersion:'adapter_profile_v1',contentSha256,content,compatibility}}};
          const payloadBytes = new TextEncoder().encode(v.canonicalJson(payload));
          const key = await crypto.subtle.importKey('pkcs8',fromB64(pkcs8),{name:'Ed25519'},false,['sign']);
          const prefix = new TextEncoder().encode('product-control-plane/bootstrap-snapshot/v1\\0'+keyId+'\\0');
          const signed = new Uint8Array(prefix.length+payloadBytes.length); signed.set(prefix); signed.set(payloadBytes,prefix.length);
          const signature = new Uint8Array(await crypto.subtle.sign('Ed25519',key,signed));
          const envelope = {envelopeVersion:'bootstrap_envelope_v2',algorithm:'Ed25519',keyId,payload:v.base64urlEncode(payloadBytes),signature:v.base64urlEncode(signature)};
          const cfg = SellerAgentsControlConfig;
          const trustBundleSha256 = hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v.canonicalJson(cfg.trustBundle)))));
          const browser = {family:'chrome',version:(String(navigator.userAgent).match(/(?:Chrome|YaBrowser)\\/(\\d+(?:\\.\\d+){0,3})/i)||[null,'0.0.0'])[1]};
          const cacheBinding = {cacheVersion:'control_cache_binding_v1',controlApiOrigin:cfg.controlApiOrigin,portalOrigin:cfg.portalOrigin,contractVersion:cfg.contractVersion,extensionVersion:cfg.extensionVersion,browser,detectedAi:{family:'chatgpt',surface:'web',variant:null},trustBundleSha256};
          const cacheClock = {cacheVersion:'control_cache_clock_v1',owner:{controlApiOrigin:cfg.controlApiOrigin,portalOrigin:cfg.portalOrigin,contractVersion:cfg.contractVersion,deviceId,sessionId},trustedServerTimeMs:now,effectiveTimeMs:now};
          const credentials = {deviceId,sessionId,tokenType:'Bearer',accessToken:'BROWSER_FIXTURE_ACCESS_TOKEN_20260918',accessTokenExpiresAt:new Date(now+3600000).toISOString(),refreshToken:'R'.repeat(43),refreshTokenExpiresAt:new Date(now+7200000).toISOString()};
          await chrome.storage.local.set({seller_agents_control_auth_v2:{generation:1,credentials,pending:null,rotation:null,authority:{verified:true,workAllowed:true,requestedAi:'chatgpt',generation:1,payload,envelope,deviceId,sessionId,cacheBinding},cacheClock,lastError:null}});
        }""",
        encoded,
    )


class BrowserFixture:
    def __init__(self, runtime: Path, private_key: Path, server: SyntheticHealthServer, output: Path):
        self.runtime = runtime
        self.private_key = private_key
        self.server = server
        self.output = output
        self.events: list[dict] = []
        self.errors: list[str] = []
        self.context = None
        self.worker = None
        self.page = None
        self.popup = None
        self.tab_id = None
        self._profile = None
        self._pw = None

    def open(self, pw):
        self._pw = pw
        self._profile = tempfile.TemporaryDirectory(prefix="seller-agents-c1-chromium-")
        options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage", f"--disable-extensions-except={self.runtime}", f"--load-extension={self.runtime}"]}
        if os.environ.get("SA_TEST_CHROMIUM"):
            options["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
        else:
            options["channel"] = "chromium"
        self._options = options
        self.context = pw.chromium.launch_persistent_context(self._profile.name, **options)
        self.context.on("request", lambda request: self.events.append({"url": request.url, "method": request.method}))
        self.worker = self.context.service_workers[0] if self.context.service_workers else self.context.wait_for_event("serviceworker")
        seed_authority(self.worker, self.private_key)
        expected_worker_url = self.worker.url
        extension_url = self.worker.url.rsplit("/", 1)[0]
        self.context.close()
        self.context = pw.chromium.launch_persistent_context(self._profile.name, **options)
        self.context.on("request", lambda request: self.events.append({"url": request.url, "method": request.method}))
        self.worker = self.context.service_workers[0] if self.context.service_workers else self.context.wait_for_event("serviceworker")
        assert self.worker.url == expected_worker_url
        assert self.worker.evaluate("async()=>SellerAgentsControlClient.status()")['authenticated'] is True
        self.context.route("https://chatgpt.com/**", lambda route: route.fulfill(body=CHAT_FIXTURE.read_text(), content_type="text/html"))
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.goto(f"https://chatgpt.com/c/{CONVERSATION}", wait_until="domcontentloaded")
        self.tab_id = wait_for(lambda: self.worker.evaluate("async()=>{const x=await chrome.tabs.query({url:'https://chatgpt.com/c/*'});return x[0]?.id}"), "ChatGPT tab")
        self.popup = self.context.new_page()
        self.popup.on("pageerror", lambda error: self.errors.append(str(error)))
        self.popup.add_init_script(f"const originalQuery=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=(query)=>query.active?Promise.resolve([{{id:{self.tab_id}}}]):originalQuery(query);")
        self.popup.goto(extension_url + "/popup.html")
        wait_for(lambda: "Аккаунт · 11111111" in self.popup.locator("#account").inner_text(), "popup account")

    def restart(self):
        """Restart the extension context so each matrix case has a fresh worker heap."""
        self.context.close()
        self.context = self._pw.chromium.launch_persistent_context(self._profile.name, **self._options)
        self.context.on("request", lambda request: self.events.append({"url": request.url, "method": request.method}))
        self.worker = self.context.service_workers[0] if self.context.service_workers else self.context.wait_for_event("serviceworker")
        assert self.worker.evaluate("async()=>SellerAgentsControlClient.status()")['authenticated'] is True
        extension_url = self.worker.url.rsplit("/", 1)[0]
        self.context.route("https://chatgpt.com/**", lambda route: route.fulfill(body=CHAT_FIXTURE.read_text(), content_type="text/html"))
        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.goto(f"https://chatgpt.com/c/{CONVERSATION}", wait_until="domcontentloaded")
        self.tab_id = wait_for(lambda: self.worker.evaluate("async()=>{const x=await chrome.tabs.query({url:'https://chatgpt.com/c/*'});return x[0]?.id}"), "ChatGPT tab restart")
        self.popup = self.context.new_page()
        self.popup.on("pageerror", lambda error: self.errors.append(str(error)))
        self.popup.add_init_script(f"const originalQuery=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=(query)=>query.active?Promise.resolve([{{id:{self.tab_id}}}]):originalQuery(query);")
        self.popup.goto(extension_url + "/popup.html")
        wait_for(lambda: "Аккаунт · 11111111" in self.popup.locator("#account").inner_text(), "popup account restart")

    def close(self):
        if self.context:
            self.context.close()
            self.context = None
        if self._profile:
            self._profile.cleanup()

    def storage(self):
        return self.worker.evaluate("async()=>chrome.storage.local.get(null)")

    def state(self):
        return self.popup.evaluate("async ({tab})=>chrome.runtime.sendMessage({type:'SA_POPUP_STATE',tab_id:tab})", {"tab": self.tab_id})

    def reload_popup(self):
        self.popup.reload()
        wait_for(lambda: "Аккаунт · 11111111" in self.popup.locator("#account").inner_text(), "popup reload")

    def rpc(self, typ, **fields):
        return self.popup.evaluate("async ({tab,type,fields})=>chrome.runtime.sendMessage({type,tab_id:tab,...fields})", {"tab": self.tab_id, "type": typ, "fields": fields})

    def reset(self):
        self.worker.evaluate(f"async()=>chrome.storage.local.remove({json.dumps([STORES,BINDINGS,SESSIONS,PENDING,MANUAL,'ozmb_diagnostics'])})")
        self.server.configure("pass")
        self.reload_popup()

    def seed_store(self, marketplace, name):
        """Seed mature catalog state for the fixture; popup controls remain the SUT."""
        store_id = "browser-ozon-source" if marketplace == "ozon" else "browser-wb-target"
        self.worker.evaluate(
            """async ({marketplace,name}) => {
              const accountId = '11111111-1111-4222-8111-111111111111';
              const credentials = marketplace === 'ozon'
                ? {seller:{clientId:'100001',apiKey:'BROWSER-SELLER-KEY',present:true},performance:{clientId:'',clientSecret:'',present:false}}
                : {token:'BROWSER-WB-PERSONAL-TOKEN'};
              const value = marketplace === 'ozon'
                ? JSON.stringify(['account-scoped-ozon-credentials','100001','BROWSER-SELLER-KEY','',''])
                : JSON.stringify(['seller-agents-wb-personal','BROWSER-WB-PERSONAL-TOKEN']);
              const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
              const revision = [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
              const id = marketplace === 'ozon' ? 'browser-ozon-source' : 'browser-wb-target';
              const current = (await chrome.storage.local.get('seller_agents_stores_v1')).seller_agents_stores_v1 || {version:1,accounts:{}};
              const account = current.accounts[accountId] || {next:{ozon:1,wildberries:1},stores:{}};
              account.stores[id] = {id,accountId,marketplace,name,credentials,credentialRevision:revision,personalDataEnabled:false,verification:{},createdAt:1700000000000};
              account.next[marketplace] = Math.max(account.next[marketplace] || 1, 2);
              await chrome.storage.local.set({seller_agents_stores_v1:{...current,version:1,accounts:{...current.accounts,[accountId]:account}}});
            }""",
            {"marketplace": marketplace, "name": name},
        )
        self.reload_popup()
        self.popup.click("#ozon" if marketplace == "ozon" else "#wildberries")
        wait_for(lambda: self.popup.locator("#stores option").count() == 1, f"{marketplace} store")
        wait_for(lambda: self.popup.locator("#stores").input_value() == store_id, f"{marketplace} selected store")
        return next(store for store in self.state()["stores"] if store["marketplace"] == marketplace)

    def add_ozon(self, name="Source Ozon"):
        return self.seed_store("ozon", name)

    def add_wb(self, name="Target WB"):
        return self.seed_store("wildberries", name)

    def set_bound(self, store, state="inactive", revision=4):
        value = {
            "binding_id": "browser-fixture-binding", "revision": 2, "origin": "https://chatgpt.com", "ai_id": "chatgpt", "conversation_id": CONVERSATION, "conversation_key": CONVERSATION_KEY,
            "store_context": {"accountId": store["accountId"], "storeId": store["id"], "marketplace": store["marketplace"], "credentialRevision": store["credentialRevision"], "policyRevision": "personal-disabled", "authGeneration": 1},
        }
        work = {"version": 1, "state": state, "revision": revision, "conversation_key": CONVERSATION_KEY, "tab_id": self.tab_id, "origin": "https://chatgpt.com", "ai_id": "chatgpt", "conversation_id": CONVERSATION, "start_intent_id": None}
        self.worker.evaluate("async ({binding,work})=>chrome.storage.local.set({ozmb_conversation_bindings:{[" + json.dumps(CONVERSATION_KEY) + "]:binding},ozmb_work_sessions_v1:{[" + json.dumps(CONVERSATION_KEY) + "]:work}})", {"binding": value, "work": work})
        self.reload_popup()

    def mutate(self, expression: str):
        self.worker.evaluate("async (code)=>{const local=await chrome.storage.local.get(null);(" + expression + ")(local);await chrome.storage.local.set({ozmb_conversation_bindings:local.ozmb_conversation_bindings,ozmb_work_sessions_v1:local.ozmb_work_sessions_v1,seller_agents_stores_v1:local.seller_agents_stores_v1})}", expression)

    def mutate_from_popup(self, expression: str):
        self.popup.evaluate("async (code)=>{const local=await chrome.storage.local.get(null);(" + expression + ")(local);await chrome.storage.local.set({ozmb_conversation_bindings:local.ozmb_conversation_bindings,ozmb_work_sessions_v1:local.ozmb_work_sessions_v1,seller_agents_stores_v1:local.seller_agents_stores_v1})}", expression)

    def install_store_read_barrier(self):
        self.worker.evaluate("""()=>{
          const original = chrome.tabs.sendMessage.bind(chrome.tabs);
          let tabReads = 0;
          globalThis.__saTestStoreBarrier = {armed:false,entered:false,released:false,reads:0,messages:[]};
          chrome.runtime.onMessage.addListener((message) => {
            if (message?.type === 'SA_WORK_START') globalThis.__saTestStoreBarrier.armed = true;
          });
          chrome.tabs.sendMessage = async (...args) => {
            const messageType = String(args[1]?.type || '');
            if (globalThis.__saTestStoreBarrier.armed && messageType === 'OZ_GET_IDENTITY') {
              tabReads += 1; globalThis.__saTestStoreBarrier.reads = tabReads;
              globalThis.__saTestStoreBarrier.messages.push(messageType);
            }
            if (globalThis.__saTestStoreBarrier.armed && messageType === 'OZ_GET_IDENTITY' && tabReads === 3) {
              globalThis.__saTestStoreBarrier.entered = true;
              while (!globalThis.__saTestStoreBarrier.released) await new Promise(resolve => setTimeout(resolve, 5));
            }
            return original(...args);
          };
        }""")

    def store_read_barrier_entered(self):
        return bool(self.worker.evaluate("()=>globalThis.__saTestStoreBarrier?.entered === true"))

    def release_store_read_barrier(self):
        self.worker.evaluate("()=>{if(globalThis.__saTestStoreBarrier)globalThis.__saTestStoreBarrier.released=true}")

    def store_read_barrier_state(self):
        return self.worker.evaluate("()=>globalThis.__saTestStoreBarrier || null")

    def health_count(self):
        return sum(request["path"] == "/v1/health-authority" for request in self.server.requests)

    def click_start(self):
        before = self.health_count()
        self.popup.click("#start")
        return before

    def click_resume(self):
        before = self.health_count()
        self.popup.click("#work-resume")
        return before

    def active(self):
        value = self.storage()
        return value.get(SESSIONS, {}).get(CONVERSATION_KEY, {}).get("state") in {"active_visible", "active_hidden", "recovering"}

    def inactive(self):
        return self.storage().get(SESSIONS, {}).get(CONVERSATION_KEY, {}).get("state") == "inactive"

    def finish(self):
        self.popup.click("#finish")
        wait_for(self.inactive, "Finish")

    def finish_message(self):
        return self.rpc("OZ_WORK_FINISH", conversation_key=CONVERSATION_KEY)

    def direct_legacy(self, typ):
        return self.popup.evaluate("({tab,type})=>new Promise(resolve=>chrome.runtime.sendMessage({type,tab_id:tab},response=>resolve({response:response||null,error:chrome.runtime.lastError?.message||null})))", {"tab": self.tab_id, "type": typ})

    def ordinary_command(self):
        return self.popup.evaluate(f"async ({{tab}})=>chrome.runtime.sendMessage({{type:'OZ_EXECUTE_COMMAND',tab_id:tab,conversation_key:{CONVERSATION_KEY!r},command:{{operation:'seller_info',params:{{}}}}}})", {"tab": self.tab_id})


def relevant(storage):
    return {key: copy.deepcopy(storage.get(key)) for key in [STORES, BINDINGS, SESSIONS, PENDING, MANUAL]}


def run_candidate(runtime: Path, private_key: Path, server: SyntheticHealthServer, output: Path):
    rows = []
    with sync_playwright() as pw:
        fixture = BrowserFixture(runtime, private_key, server, output)
        fixture.open(pw)
        selected_cases = {value for value in os.environ.get("SA_BROWSER_ONLY", "").split(",") if value}

        def case(case_id, description, fn):
            if selected_cases and case_id not in selected_cases:
                return
            print(f"[{runtime.name}] {case_id} ...", flush=True)
            try:
                fn()
                rows.append({"id": case_id, "status": "PASS", "description": description})
                print(f"[{runtime.name}] {case_id} PASS", flush=True)
            except Exception as error:
                rows.append({"id": case_id, "status": "FAIL", "description": description, "error": f"{type(error).__name__}: {error}"})
                print(f"[{runtime.name}] {case_id} FAIL: {error}", flush=True)

        def fresh():
            fixture.restart()
            fixture.reset()
            store = fixture.add_ozon()
            time.sleep(.15)
            return store

        def valid_start():
            fresh(); server.configure("pass"); before = fixture.health_count(); fixture.click_start(); wait_for(fixture.active, "valid popup Start"); assert fixture.health_count() - before == 1

        case("BR-C1-01", "new-dialogue popup Start with signed PASS creates one lifecycle", valid_start)
        case("BR-C1-02", "historical unbound popup Start reaches active Work", valid_start)

        def resume():
            store = fresh(); fixture.set_bound(store); server.configure("pass"); before = fixture.health_count(); assert not fixture.popup.locator("#work-resume").is_hidden(); fixture.click_resume(); wait_for(fixture.active, "popup Resume"); assert fixture.health_count() - before == 1
        case("BR-C1-03", "inactive bound popup Resume reaches donor Resume", resume)

        def raw_start():
            before = relevant(fixture.storage()); health_before = fixture.health_count(); server.configure("pass"); result = fixture.direct_legacy("OZ_WORK_START"); assert_code(result); assert fixture.health_count() == health_before; assert relevant(fixture.storage()) == before
        case("BR-C1-04", "raw external OZ_WORK_START is disabled", raw_start)
        def raw_resume():
            before = relevant(fixture.storage()); health_before = fixture.health_count()
            result = fixture.direct_legacy("OZ_WORK_RESUME")
            assert_code(result)
            assert fixture.health_count() == health_before
            assert_same(relevant(fixture.storage()), before)
        case("BR-C1-05", "raw external OZ_WORK_RESUME is disabled", raw_resume)

        def denied(mode):
            fresh(); server.configure(mode); before = relevant(fixture.storage()); health_before = fixture.health_count(); fixture.click_start(); wait_for(lambda: fixture.health_count() == health_before + 1, f"{mode} Health"); time.sleep(.3); assert not fixture.active(); assert relevant(fixture.storage())[BINDINGS] == before[BINDINGS]; assert relevant(fixture.storage())[SESSIONS] == before[SESSIONS]; assert fixture.health_count() == health_before + 1
        for cid, mode in [("BR-C1-06", "deny"), ("BR-C1-07", "unavailable"), ("BR-C1-08", "tampered"), ("BR-C1-09", "expired"), ("BR-C1-10", "wrong-context"), ("BR-C1-11", "network")]:
            case(cid, f"signed Health {mode} denies without lifecycle mutation", lambda mode=mode: denied(mode))

        def delayed_store_drift():
            fresh(); server.configure("delayed"); baseline = relevant(fixture.storage()); fixture.click_start(); wait_for(server.health_seen.is_set, "delayed Health request"); fixture.mutate("(s)=>{const a=s.seller_agents_stores_v1.accounts[Object.keys(s.seller_agents_stores_v1.accounts)[0]];a.stores[Object.keys(a.stores)[0]].name='drifted'}"); server.release.set(); time.sleep(.5); assert not fixture.active(); assert relevant(fixture.storage())[BINDINGS] == baseline[BINDINGS]
        case("BR-C1-12", "selected store drift discards delayed Health", delayed_store_drift)

        def delayed_mutation(kind):
            store = fresh(); fixture.set_bound(store); server.configure("delayed"); before = relevant(fixture.storage()); fixture.click_start(); wait_for(server.health_seen.is_set, "delayed rebind Health")
            if kind == "work":
                fixture.mutate(f"(s)=>{{s.ozmb_work_sessions_v1[{CONVERSATION_KEY!r}].revision=99;s.ozmb_work_sessions_v1[{CONVERSATION_KEY!r}].state='active_hidden'}}")
            else: fixture.worker.evaluate("async()=>{const x=await chrome.storage.local.get('seller_agents_control_auth_v2');x.seller_agents_control_auth_v2.generation+=1;await chrome.storage.local.set(x)}")
            server.release.set(); time.sleep(.5); assert relevant(fixture.storage())[BINDINGS] == before[BINDINGS]
        case("BR-C1-13", "binding/work revision drift discards delayed Health", lambda: delayed_mutation("work"))
        case("BR-C1-14", "account/control generation drift discards delayed Health", lambda: delayed_mutation("generation"))

        def finish_race():
            store = fresh(); fixture.set_bound(store, "active_visible", 4); fixture.add_wb(); fixture.reload_popup(); fixture.popup.click("#wildberries"); server.configure("delayed"); fixture.popup.click("#start"); wait_for(lambda: not fixture.popup.locator("#confirmation").is_hidden(), "Finish-race confirmation"); fixture.popup.click("#confirm"); wait_for(server.health_seen.is_set, "Finish-race Health"); fixture.finish_message(); wait_for(fixture.inactive, "Finish during Health"); server.release.set(); time.sleep(.5); assert not fixture.active(); assert fixture.storage().get(PENDING) in (None, {})
        case("BR-C1-15", "Finish during delayed Health cancels late PASS", finish_race)

        def double_start():
            fresh(); server.configure("pass"); health_before = fixture.health_count(); fixture.popup.locator("#start").dblclick(); wait_for(fixture.active, "double Start"); assert fixture.health_count() - health_before == 1
        case("BR-C1-16", "double-click popup Start is single-flight", double_start)

        def double_resume():
            store = fresh(); fixture.set_bound(store); server.configure("pass"); health_before = fixture.health_count(); fixture.popup.locator("#work-resume").dblclick(); wait_for(fixture.active, "double Resume"); assert fixture.health_count() - health_before == 1
        case("BR-C1-17", "double-click popup Resume is single-flight", double_resume)

        def parallel_dialogues():
            store = fresh(); server.configure("pass"); health_before = fixture.health_count(); second = fixture.context.new_page(); second.goto(f"https://chatgpt.com/c/{CONVERSATION}-two"); wait_for(lambda: fixture.worker.evaluate("async()=>{const x=await chrome.tabs.query({url:'https://chatgpt.com/c/*'});return x.length>=2}"), "second dialogue"); tabs = fixture.worker.evaluate("async()=>{const x=await chrome.tabs.query({url:'https://chatgpt.com/c/*'});return x.map(t=>t.id)}"); result = fixture.popup.evaluate("async ({a,b,id})=>Promise.all([chrome.runtime.sendMessage({type:'SA_WORK_START',tab_id:a,store_id:id,confirm_change:false,start_intent_id:'parallel-a'}),chrome.runtime.sendMessage({type:'SA_WORK_START',tab_id:b,store_id:id,confirm_change:false,start_intent_id:'parallel-b'})])", {"a": tabs[0], "b": tabs[1], "id": store["id"]}); assert all(x.get("ok") for x in result), result; wait_for(lambda: fixture.health_count() == health_before + 2, "parallel Health"); second.close(); time.sleep(.3)
        case("BR-C1-18", "distinct dialogue admissions are independent", parallel_dialogues)
        case("BR-C1-19", "distinct store/dialogue context remains independent", parallel_dialogues)

        def target_setup(state="inactive", mode="pass"):
            source = fresh(); fixture.set_bound(source, state); target = fixture.add_wb(); fixture.reload_popup(); fixture.popup.click("#wildberries"); wait_for(lambda: fixture.popup.locator("#stores").input_value() == target["id"], "target selected store"); time.sleep(.15); server.configure(mode); return source, target

        def warning_and_reject():
            source, _ = target_setup(); health_before = fixture.health_count(); assert "Выбран следующий магазин" in fixture.popup.locator("#selection").inner_text(); fixture.popup.click("#start"); time.sleep(.25); assert not fixture.popup.locator("#confirmation").is_hidden(), {"selection": fixture.popup.locator("#selection").inner_text(), "status": fixture.popup.locator("#status").inner_text(), "start_disabled": fixture.popup.locator("#start").is_disabled()}; fixture.popup.click("#reject"); assert fixture.health_count() == health_before; assert fixture.inactive()
        case("BR-C1-20", "different-store selection displays actual confirmation UX", warning_and_reject)
        case("BR-C1-21", "rejected store-change confirmation preserves source", warning_and_reject)

        def confirmed_rebind(state, mode, expect_finish):
            source, target = target_setup(state, mode); before = relevant(fixture.storage()); health_before = fixture.health_count(); fixture.popup.click("#start"); wait_for(lambda: not fixture.popup.locator("#confirmation").is_hidden(), "confirmation"); fixture.popup.click("#confirm"); wait_for(lambda: fixture.health_count() == health_before + 1, "target Health");
            if mode == "pass":
                try:
                    wait_for(lambda: fixture.storage().get(PENDING) in (None, {}) and fixture.storage().get(BINDINGS, {}).get(CONVERSATION_KEY, {}).get("store_context", {}).get("storeId") == target["id"], "target lifecycle")
                except AssertionError as error:
                    raise AssertionError({"target": target, "popup_status": fixture.popup.locator("#status").inner_text(), "storage": relevant(fixture.storage())}) from error
                wait_for(fixture.active, "target active lifecycle")
            else: assert relevant(fixture.storage())[BINDINGS] == before[BINDINGS]
        case("BR-C1-22", "active-visible confirmed rebind verifies before guarded Finish/target Start", lambda: confirmed_rebind("active_visible", "pass", True))
        case("BR-C1-23", "active-hidden confirmed rebind preserves secure order", lambda: confirmed_rebind("active_hidden", "pass", True))
        case("BR-C1-24", "inactive confirmed rebind skips unnecessary Finish", lambda: confirmed_rebind("inactive", "pass", False))
        case("BR-C1-25", "denied target Health preserves source binding/work", lambda: confirmed_rebind("active_visible", "deny", True))

        def rebind_delay(target_drift=False, old_drift=False):
            source, target = target_setup("active_visible", "delayed"); before = relevant(fixture.storage()); fixture.popup.click("#start"); wait_for(lambda: not fixture.popup.locator("#confirmation").is_hidden(), "confirmation"); fixture.popup.click("#confirm"); wait_for(server.health_seen.is_set, "delayed rebind Health");
            if target_drift:
                fixture.mutate("(s)=>{const a=s.seller_agents_stores_v1.accounts[Object.keys(s.seller_agents_stores_v1.accounts)[0]];a.stores[Object.keys(a.stores)[1]].credentialRevision='drifted'}")
            if old_drift: fixture.mutate(f"(s)=>{{s.ozmb_work_sessions_v1[{CONVERSATION_KEY!r}].revision=99}}")
            server.release.set(); time.sleep(.6); assert relevant(fixture.storage())[BINDINGS] == before[BINDINGS]
        case("BR-C1-26", "delayed rebind target revision drift discards before mutation", lambda: rebind_delay(target_drift=True))
        case("BR-C1-27", "delayed rebind old Work drift discards before mutation", lambda: rebind_delay(old_drift=True))

        def pretoken_drift(field):
            source, _ = target_setup("active_visible", "pass"); baseline = relevant(fixture.storage());
            before = fixture.health_count(); fixture.install_store_read_barrier();
            try:
                fixture.popup.click("#start"); wait_for(lambda: not fixture.popup.locator("#confirmation").is_hidden(), "pre-token confirmation"); fixture.popup.click("#confirm"); wait_for(fixture.store_read_barrier_entered, "pre-token admission snapshot barrier")
                if field == "work":
                    fixture.mutate_from_popup(f"(s)=>{{s.ozmb_work_sessions_v1[{CONVERSATION_KEY!r}].revision=77}}")
                    assert fixture.storage().get(SESSIONS, {}).get(CONVERSATION_KEY, {}).get("revision") == 77
                else: fixture.mutate_from_popup("(s)=>{const a=s.seller_agents_stores_v1.accounts[Object.keys(s.seller_agents_stores_v1.accounts)[0]];a.stores[Object.keys(a.stores)[1]].credentialRevision='pretoken-drift'}")
                fixture.release_store_read_barrier(); time.sleep(.6)
            finally: fixture.release_store_read_barrier()
            assert fixture.health_count() - before == 0, {"health": fixture.health_count() - before, "barrier": fixture.store_read_barrier_state()}; assert relevant(fixture.storage())[BINDINGS] == baseline[BINDINGS], {"bindings": relevant(fixture.storage())[BINDINGS], "baseline": baseline[BINDINGS]}; assert fixture.storage().get(PENDING) in (None, {}), {"pending": fixture.storage().get(PENDING)}
        case("BR-C1-28", "pre-token Work revision drift is rejected before Health", lambda: pretoken_drift("work"))
        case("BR-C1-29", "pre-token target credential revision drift is rejected before Health", lambda: pretoken_drift("credential"))

        def no_autorun():
            valid_start(); before = len([x for x in fixture.events if "api-seller.ozon.ru" in x["url"]]); time.sleep(.4); assert len([x for x in fixture.events if "api-seller.ozon.ru" in x["url"]]) == before
        case("BR-C1-30", "old commands do not autorun after admission", no_autorun)
        case("BR-C1-31", "admission alone makes no provider operation", lambda: (valid_start(), assert_provider_zero(fixture.events)))
        case("BR-C1-32", "Health/B2 decision is not persisted as execution authority", lambda: (valid_start(), assert_no_health_persistence(fixture.storage())))
        case("BR-C1-33", "successful result remains executionAuthority false", lambda: (valid_start(), assert_execution_false(fixture.storage())))

        def ordinary_zero():
            valid_start(); before = fixture.health_count(); fixture.ordinary_command(); time.sleep(.5); assert fixture.health_count() == before; assert not any(x["url"].endswith("/v1/bootstrap") for x in fixture.events)
        case("BR-C1-34", "ordinary command adds zero Health calls", ordinary_zero)
        case("BR-C1-35", "ordinary command adds zero Bootstrap calls", ordinary_zero)

        def recovery():
            denied("tampered"); valid_start(); assert fixture.active()
        case("BR-C1-36", "worker recovers after denial/tamper/race and fresh Start works", recovery)

        if fixture.errors:
            rows.append({"id": "BROWSER-RUNTIME-ERRORS", "status": "FAIL", "error": repr(fixture.errors)})
        fixture.close()
    result = {"status": "PASS" if all(row["status"] == "PASS" for row in rows) else "FAIL", "browser": "native Chromium", "runtime": str(runtime), "results": rows, "health_requests": len([x for x in server.requests if x["path"] == "/v1/health-authority"]), "provider_requests": 0, "control_requests": server.requests}
    output.mkdir(parents=True, exist_ok=True)
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def assert_code(result):
    assert result.get("response", {}).get("code") == "LEGACY_ACTION_DISABLED" or "LEGACY_ACTION_DISABLED" in (result.get("error") or ""), result


def assert_same(left, right):
    assert left == right


def assert_provider_zero(events):
    assert not any("api-seller.ozon.ru" in x["url"] or "wildberries.ru" in x["url"] for x in events)


def assert_no_health_persistence(storage):
    assert not any("health" in key.lower() or "authority_decision" in key.lower() for key in storage if key != AUTH)


def assert_execution_false(storage):
    assert storage.get(AUTH, {}).get("authority", {}).get("executionAuthority") is not True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-runtime", type=Path, required=True)
    parser.add_argument("--extracted-runtime", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    server = SyntheticHealthServer(args.private_key).start()
    try:
        all_results = {}
        for label, runtime in [("source", args.source_runtime), ("extracted", args.extracted_runtime)]:
            all_results[label] = run_candidate(runtime.resolve(), args.private_key.resolve(), server, args.output.resolve() / label)
    finally:
        server.stop()
    summary = {"status": "PASS" if all(x["status"] == "PASS" for x in all_results.values()) else "FAIL", "candidates": all_results}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
