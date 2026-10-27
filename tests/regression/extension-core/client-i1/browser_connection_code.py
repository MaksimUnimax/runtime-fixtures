"""Existing product connection scenario, empty Chrome profiles and real local API.
No remote marketplaces, no existing profile, no access-control changes.
"""
from pathlib import Path
import argparse, json, os, pwd, shutil, subprocess, time, uuid, urllib.request, traceback, zipfile, hashlib, re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[4]
NODE="/root/.nvm/versions/node/v24.20.0/bin/node"
PNPM="/root/.nvm/versions/node/v24.20.0/bin/pnpm"
def ready(url,limit=20):
    until=time.monotonic()+limit
    while time.monotonic()<until:
        try:
            with urllib.request.urlopen(url,timeout=1) as r:
                if r.status==200:return
        except Exception:pass
        time.sleep(.1)
    raise RuntimeError("LOCAL_ENDPOINT_NOT_READY")
def run(output):
    result={"status":"RUNNING","stage":"prepare","checks":{},"installed_production_acceptance":False,"scope":"actual Chrome, product popup and cabinet, real local HTTP/isolated PostgreSQL; ephemeral signing and OTP; no live provider"}
    processes=[]; browsers=[]; stage="prepare";checks=result["checks"]
    owner=pwd.getpwnam("octoport-monitor")
    try:
        if not str(output).startswith("/tmp/octoport-connection-r142-"):raise RuntimeError("OWN_OUTPUT_REQUIRED")
        env=dict(os.environ);env["PATH"]=str(Path(NODE).parent)+":"+env.get("PATH","");env["NEXT_TELEMETRY_DISABLED"]="1"
        config=json.loads(subprocess.check_output([NODE,str(ROOT/"tests/regression/extension-core/client-i1/make-browser-config.mjs"),str(output/"unused-private-placeholder"),str(output/"public-trust.json")],cwd=ROOT,env=env,text=True))
        env["SA_PACKAGED_CONFIG_JSON"]=json.dumps(config)
        with (output/"compose.log").open("w") as log:
            subprocess.run(["python3",str(ROOT/"tooling/build/extension_composed.py"),"--output",str(output/"package")],cwd=ROOT,env=env,check=True,stdout=log,stderr=subprocess.STDOUT,timeout=30)
        runtime=output/"package/runtime"
        for p in [output,output/"package",runtime,*runtime.rglob("*")]:
            p.chmod(0o755 if p.is_dir() else 0o644)
        chrome=Path(os.environ["SA_CONNECTION_BROWSER_BINARY"])
        if not chrome.is_file():raise RuntimeError("BROWSER_BINARY_MISSING")
        portalenv=dict(env);portalenv["CONTROL_PLANE_API_ORIGIN"]="http://127.0.0.1:43100"
        portal=subprocess.Popen([PNPM,"--filter","@product/portal","exec","next","start","--hostname","127.0.0.1","--port","43101"],cwd=ROOT,env=portalenv,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        processes.append(portal);ready("http://127.0.0.1:43101/login")
        namespace=uuid.uuid4().hex;email="connection-browser-"+namespace+"@example.test"
        with sync_playwright() as pw:
            def launch(name,port):
                profile=output/name;profile.mkdir(exist_ok=True);profile.chmod(0o700);os.chown(profile,owner.pw_uid,owner.pw_gid)
                args=[str(chrome),"--headless=new","--no-first-run","--no-default-browser-check","--disable-background-networking","--disable-component-update","--disable-sync",f"--remote-debugging-port={port}",f"--user-data-dir={profile}",f"--disable-extensions-except={runtime}",f"--load-extension={runtime}","about:blank"]
                assert not any(x in args for x in ["--no-sandbox","--disable-setuid-sandbox","--disable-web-security"])
                proc=subprocess.Popen(args,cwd="/tmp",env={"PATH":"/usr/bin:/bin","LANG":"C.UTF-8","XDG_CACHE_HOME":str(profile/"cache"),"XDG_CONFIG_HOME":str(profile/"config")},user=owner.pw_uid,group=owner.pw_gid,extra_groups=[],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                processes.append(proc);ready(f"http://127.0.0.1:{port}/json/version")
                browser=pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}");browsers.append(browser);context=browser.contexts[0]
                result.setdefault("observed_worker_paths",[]).append([w.url for w in context.service_workers])
                is_product=lambda worker: worker.url.startswith("chrome-extension://") and worker.url.endswith("/service_worker_entry.js")
                workers=[worker for worker in context.service_workers if is_product(worker)]
                worker=workers[0] if workers else context.wait_for_event("serviceworker",predicate=is_product,timeout=10000)
                result.setdefault("product_worker_urls",[]).append(worker.url)
                extension=worker.url.split("/")[2]
                popup=context.new_page();popup.goto(f"chrome-extension://{extension}/popup.html")
                popup.locator("#auth-start").wait_for(state="attached")
                return proc,browser,context,popup
            def status(popup):
                return popup.evaluate("""async()=>{const v=await chrome.runtime.sendMessage({type:'SA_POPUP_STATE'});return {ok:v.ok,authenticated:v.auth?.authenticated,accountId:v.auth?.accountId,deviceId:v.auth?.deviceId,method:v.auth?.authenticationMethod,lastError:v.auth?.lastError?.code};}""")
            def connect(popup,code):
                popup.locator("#connection-code").fill(code);popup.locator("#connection-submit").click()
                try:
                    popup.locator("#catalog").wait_for(state="visible",timeout=15000)
                finally:
                    result["last_popup_status"]=status(popup)
                    result["last_popup_message"]=popup.locator("#auth-status").inner_text()
                return status(popup)
            stage="first_browser";a,ba,ca,pa=launch("profile-a",43102)
            cabinet=ca.new_page();cabinet.goto("http://127.0.0.1:43101/login?returnTo=%2Fconnect")
            cabinet.get_by_label("Email",exact=True).fill(email);cabinet.get_by_role("button",name="Send code",exact=True).click()
            cabinet.get_by_label("Code",exact=True).fill("424242");cabinet.get_by_role("button",name="Verify",exact=True).click()
            cabinet.wait_for_url("**/connect")
            stage="issue_code";cabinet.get_by_role("button",name="Получить код подключения",exact=True).click()
            field=cabinet.get_by_label("Секретный код подключения",exact=True);field.wait_for();saved=field.input_value()
            assert saved.startswith("octo1_") and len(saved)==49
            checks["cabinet_issued_code"]=True
            account=cabinet.locator("select").input_value()
            first=connect(pa,saved)
            assert first["authenticated"] and first["accountId"]==account and first["method"]=="ACCOUNT_CONNECTION_CODE"
            checks["website_code_to_same_account"]=True
            checks["secret_not_in_popup_field"]=pa.locator("#connection-code").input_value()==""
            checks["secret_not_persisted"]=pa.evaluate("async code=>!JSON.stringify(await chrome.storage.local.get(null)).includes(code)",saved)
            stage="owner_receipt_confirmation"
            cabinet.reload();cabinet.get_by_role("button",name="Заменить код, оставить устройства",exact=True).wait_for()
            checks["one_time_reveal"]=cabinet.get_by_label("Секретный код подключения",exact=True).count()==0
            if os.environ.get("SA_CONNECTION_BROWSER_SCENARIO")=="legacy_upgrade":
                from browser_d3s2_r1_transfer import seed_store
                stage="prepare_exact_040_product_with_local_test_configuration"
                archive=Path(os.environ["SA_CONNECTION_LEGACY_ARCHIVE"])
                assert hashlib.sha256(archive.read_bytes()).hexdigest()=="8a1e0e3a7b238787160fcd1525d70fd9ab6849afb95852e2a5526150a4674c01"
                ba.close();browsers.remove(ba);a.terminate();a.wait(timeout=10)
                candidate=output/"new-candidate-runtime";runtime.rename(candidate);runtime.mkdir()
                with zipfile.ZipFile(archive) as z:
                    assert all(not Path(n).is_absolute() and ".." not in Path(n).parts for n in z.namelist())
                    z.extractall(runtime)
                old_manifest=json.loads((runtime/"manifest.json").read_text());assert old_manifest["version"]=="0.2.40"
                old_manifest["host_permissions"]=[x for x in old_manifest["host_permissions"] if x not in ["https://api.octoport.ru/*","https://app.octoport.ru/*"]]+["http://127.0.0.1:43100/*","http://127.0.0.1:43101/*"]
                (runtime/"manifest.json").write_text(json.dumps(old_manifest))
                worker_file=runtime/"service_worker.js";old_bytes=worker_file.read_bytes();head,tail=old_bytes.split(b";\n",1)
                assert head.startswith(b"globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=")
                old_config={**config,"extensionVersion":"0.2.40"}
                prefix=b"globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__="+json.dumps(json.dumps(old_config,separators=(",",":"))).encode()+b";\n"
                worker_file.write_bytes(prefix+tail)
                assert hashlib.sha256(worker_file.read_bytes().split(b";\n",1)[1]).digest()==hashlib.sha256(tail).digest()
                for q in [runtime,*runtime.rglob("*")]:q.chmod(0o755 if q.is_dir() else 0o644)
                result["old_package_test_adaptation"]={"archive_sha256":hashlib.sha256(archive.read_bytes()).hexdigest(),"changed_only":["manifest local API/portal origins","service_worker packaged local API/portal/ephemeral public trust config"],"old_worker_product_body_unchanged":True}
                stage="legacy_040_activation_against_new_server"
                b,bb,cb,pb=launch("profile-b",43103)
                with cb.expect_page() as page_info:pb.locator("#auth-start").click()
                portal=page_info.value;portal.wait_for_url("**/login?returnTo=*")
                portal.get_by_label("Email",exact=True).fill(email);portal.get_by_role("button",name="Send code",exact=True).click()
                portal.get_by_label("Code",exact=True).fill("424242");portal.get_by_role("button",name="Verify",exact=True).click()
                portal.wait_for_url("**/activate?authorizationId=*")
                portal.locator("dl dd").first.wait_for()
                portal.locator('select option:not([value=""]):not([disabled])').first.wait_for(state="attached")
                pb.wait_for_function("()=>/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(document.querySelector('#auth-code').innerText.trim())")
                code=re.search(r"([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})$",pb.locator("#auth-code").inner_text().strip()).group(1)
                portal.locator("select").select_option(account);portal.get_by_label("User code").fill(code)
                portal.get_by_role("button",name="Approve",exact=True).click()
                pb.locator("#catalog").wait_for(timeout=15000)
                legacy=status(pb);assert legacy["authenticated"] and legacy["accountId"]==account
                worker=next(w for w in cb.service_workers if w.url.endswith("/service_worker_entry.js"))
                legacy_identity=worker.evaluate("async()=>{const x=(await chrome.storage.local.get('seller_agents_control_auth_v2')).seller_agents_control_auth_v2;return {deviceId:x.credentials.deviceId,sessionId:x.credentials.sessionId};}")
                assert legacy_identity["deviceId"]!=first["deviceId"]
                result["legacy_identity"]=legacy_identity
                old_id=worker.url.split("/")[2];store_id="legacy-upgrade-retained-key";synthetic="SYNTHETIC_LEGACY_UPGRADE_KEY_NEVER_REAL"
                seed_store(worker,store_id,{"seller":{"clientId":"142000","apiKey":synthetic},"performance":{}},"legacy-revision")
                checks["old_040_device_flow_works_with_new_api_and_migration"]=True
                bb.close();browsers.remove(bb);b.terminate();b.wait(timeout=10)
                stage="upgrade_same_extension_directory_and_profile"
                runtime.rename(output/"old-runtime-preserved");shutil.copytree(candidate,runtime)
                for q in [runtime,*runtime.rglob("*")]:q.chmod(0o755 if q.is_dir() else 0o644)
                b,bb,cb,pb=launch("profile-b",43103)
                worker=next(w for w in cb.service_workers if w.url.endswith("/service_worker_entry.js"))
                result["upgrade_before_reload"]={"status":status(pb),"worker":worker.evaluate("()=>({version:chrome.runtime.getManifest().version,codeMethod:typeof SellerAgentsControlClient.connectWithCode})")}
                # An unpacked folder replacement needs Chrome's ordinary extension reload;
                # process restart alone is not proof that cached active code was replaced.
                closed=[];worker.on("close",lambda *_:closed.append(True))
                idle=cb.new_page()
                pb.evaluate("()=>{setTimeout(()=>chrome.runtime.reload(),0);return true;}")
                deadline=time.monotonic()+5
                while not closed and time.monotonic()<deadline:idle.wait_for_timeout(50)
                assert closed,"OLD_WORKER_DID_NOT_TERMINATE_AFTER_RELOAD"
                result["old_worker_closed_after_reload"]=bool(closed)
                diagnostic=cb.new_page();diagnostic.goto("chrome://extensions/")
                rows=diagnostic.evaluate("async()=>{const rows=await chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true});return rows.filter(x=>x.type==='EXTENSION').map(x=>({id:x.id,state:x.state,disableReasons:x.disableReasons}));}")
                result["extension_reload_state"]=rows
                current=next((x for x in rows if x["id"]==old_id),None)
                if current and current["disableReasons"].get("unsupportedDeveloperExtension"):
                    stage="upgrade_requires_disposable_profile_developer_mode"
                    raise RuntimeError("UNPACKED_RELOAD_DISABLED_BY_BROWSER")
                pb=cb.new_page();pb.goto(f"chrome-extension://{old_id}/popup.html")
                pb.locator("#catalog").wait_for()
                workers=[w for w in cb.service_workers if w.url.endswith("/service_worker_entry.js")]
                worker=workers[0] if workers else cb.wait_for_event("serviceworker",predicate=lambda w:w.url.endswith("/service_worker_entry.js"),timeout=10000)
                upgraded=status(pb)
                result["upgrade_after_reload"]={"status":upgraded,"worker":worker.evaluate("()=>({version:chrome.runtime.getManifest().version,codeMethod:typeof SellerAgentsControlClient.connectWithCode})")}
                assert result["upgrade_after_reload"]["worker"]=={"version":"0.2.42","codeMethod":"function"}
                assert upgraded["authenticated"] and upgraded["accountId"]==account and upgraded["deviceId"]==legacy_identity["deviceId"]
                assert upgraded["method"]=="NORMAL_DEVICE_FLOW"
                assert worker.evaluate("async()=>{const x=(await chrome.storage.local.get('seller_agents_control_auth_v2')).seller_agents_control_auth_v2;return {deviceId:x.credentials.deviceId,sessionId:x.credentials.sessionId};}")==legacy_identity
                assert worker.url.split("/")[2]==old_id
                assert worker.evaluate("async({account,id,key})=>{const s=await chrome.storage.local.get('seller_agents_stores_v1');return s.seller_agents_stores_v1?.accounts?.[account]?.stores?.[id]?.credentials?.seller?.apiKey===key;}",{"account":account,"id":store_id,"key":synthetic})
                checks["upgrade_preserves_same_device_session_and_local_key"]=True
                checks["legacy_method_remains_truthfully_labeled"]=True
                stage="rotation_keeps_upgraded_legacy_installation"
                portal=cb.new_page();portal.goto("http://127.0.0.1:43101/login?returnTo=%2Fconnect")
                portal.get_by_label("Email",exact=True).fill(email);portal.get_by_role("button",name="Send code",exact=True).click()
                portal.get_by_label("Code",exact=True).fill("424242");portal.get_by_role("button",name="Verify",exact=True).click()
                portal.wait_for_url("**/connect")
                portal.get_by_role("button",name="Заменить код, оставить устройства",exact=True).click()
                portal.get_by_label("Секретный код подключения",exact=True).wait_for()
                worker.evaluate("async()=>await SellerAgentsControlClient.bootstrap()")
                assert status(pb)["deviceId"]==legacy_identity["deviceId"] and status(pb)["authenticated"]
                checks["ordinary_code_rotation_preserves_legacy_installation"]=True
                result.update(status="PASS",stage="legacy_upgrade_completed",checks=checks)
            elif os.environ.get("SA_CONNECTION_BROWSER_SCENARIO")=="auth_recovery":
                from browser_d3s2_r1_transfer import seed_store
                stage="lost_committed_exchange"
                b,bb,cb,pb=launch("profile-b",43103)
                pb.locator("#connection-code").fill(saved);pb.locator("#connection-submit").click()
                pb.locator("#status").filter(has_text="Ответ сервера не подтверждён").wait_for(timeout=15000)
                failed=status(pb);assert not failed["authenticated"]
                meta=json.loads((output/"exchange-evidence.json").read_text());assert len(meta)==2 and meta[1]["responseDropped"]
                assert pb.evaluate("async code=>!JSON.stringify(await chrome.storage.local.get(null)).includes(code)",saved)
                bb.close();browsers.remove(bb);b.terminate();b.wait(timeout=10)
                stage="unknown_exchange_restart"
                b,bb,cb,pb=launch("profile-b",43103)
                pb.locator("#connection-submit").wait_for()
                restored=status(pb);assert not restored["authenticated"]
                assert len(json.loads((output/"exchange-evidence.json").read_text()))==2
                second=connect(pb,saved);meta=json.loads((output/"exchange-evidence.json").read_text())
                assert len(meta)==3 and meta[1]["deviceId"]==meta[2]["deviceId"]==second["deviceId"]
                assert meta[1]["attemptSha256"]==meta[2]["attemptSha256"]
                assert meta[1]["sessionId"]==meta[2]["sessionId"]
                checks["lost_committed_exchange_same_attempt_and_device_after_restart"]=True
                checks["restart_does_not_automatically_send_code"]=True
                stage="account_switch_with_retained_local_keys"
                worker=next(w for w in cb.service_workers if w.url.endswith("/service_worker_entry.js"))
                store_id="connection-account-A-store";keyA="SYNTHETIC_ACCOUNT_A_KEY_NEVER_REAL"
                seed_store(worker,store_id,{"seller":{"clientId":"142000","apiKey":keyA},"performance":{}},"r142-account-A")
                pb.reload();pb.locator("#catalog").wait_for()
                cabinetB=cb.new_page();cabinetB.goto("http://127.0.0.1:43101/login?returnTo=%2Fconnect")
                cabinetB.get_by_label("Email",exact=True).fill("second-"+namespace+"@example.test")
                cabinetB.get_by_role("button",name="Send code",exact=True).click()
                cabinetB.get_by_label("Code",exact=True).fill("424242")
                cabinetB.get_by_role("button",name="Verify",exact=True).click();cabinetB.wait_for_url("**/connect")
                cabinetB.get_by_role("button",name="Получить код подключения",exact=True).click()
                fieldB=cabinetB.get_by_label("Секретный код подключения",exact=True);fieldB.wait_for()
                codeB=fieldB.input_value();accountB=cabinetB.locator("select").input_value();assert accountB!=account
                pb.locator("#auth-reset").click();pb.locator("#confirm").click();pb.locator("#connection-submit").wait_for()
                changed=connect(pb,codeB);assert changed["accountId"]==accountB
                visible=worker.evaluate("async()=> (await SellerAgentsActiveStoreCatalog.list()).map(s=>s.id)")
                assert store_id not in visible
                preserved=worker.evaluate("async ({account,id,key})=>{const v=await chrome.storage.local.get('seller_agents_stores_v1');return v.seller_agents_stores_v1?.accounts?.[account]?.stores?.[id]?.credentials?.seller?.apiKey===key;}",{"account":account,"id":store_id,"key":keyA})
                assert preserved
                checks["other_account_cannot_see_prior_account_store"]=True
                checks["local_reset_keeps_prior_account_key_isolated"]=True
                pb.locator("#auth-reset").click();pb.locator("#confirm").click();pb.locator("#connection-submit").wait_for()
                returned=connect(pb,saved);assert returned["accountId"]==account
                assert store_id in worker.evaluate("async()=> (await SellerAgentsActiveStoreCatalog.list()).map(s=>s.id)")
                checks["return_to_original_account_restores_its_catalog"]=True
                result.update(status="PASS",stage="auth_recovery_and_switch_completed",checks=checks)
            elif os.environ.get("SA_CONNECTION_BROWSER_SCENARIO")=="work_cycle":
                from browser_d3s2_r1_transfer import seed_store
                worker=next(w for w in ca.service_workers if w.url.endswith("/service_worker_entry.js"))
                stage="work_fixture"
                store_id="connection-work-fixture"
                seed_store(worker,store_id,{"seller":{"clientId":"142000","apiKey":"SYNTHETIC_WORK_KEY_NEVER_REAL"},"performance":{}},"r142-work-revision")
                fixture=(ROOT/"tests/regression/extension-core/fixtures/application-chat.html").read_text()
                conversation_id="11111111-1111-4111-8111-111111111111"
                fixture=fixture.replace('<main id="turns">','<main id="turns" data-conversation-id="'+conversation_id+'">')
                # The provider identifier belongs to the common conversation/composer
                # surface; a sibling message-only main cannot identify that surface.
                fixture=fixture.replace('</main>\n<form>','\n<form>').replace('</form>\n<script>','</form></main>\n<script>')
                chat_url="https://chatgpt.com/c/"+conversation_id
                ca.route("https://**/*",lambda route:route.fulfill(body=fixture,content_type="text/html") if route.request.url==chat_url else route.abort())
                chat=ca.new_page();chat.goto(chat_url)
                tab_id=worker.evaluate("async url=>(await chrome.tabs.query({})).find(t=>t.url===url)?.id",chat_url)
                assert isinstance(tab_id,int)
                pa.add_init_script("const original=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=q=>q?.active?Promise.resolve([{id:"+str(tab_id)+"}]):original(q);")
                pa.reload();pa.locator("#catalog").wait_for();pa.select_option("#stores",store_id)
                def work_state():
                    return pa.evaluate("async id=>await chrome.runtime.sendMessage({type:'SA_POPUP_STATE',tab_id:id})",tab_id)
                def until(check, seconds=20):
                    end=time.monotonic()+seconds
                    while time.monotonic()<end:
                        value=check()
                        if value:return value
                        chat.wait_for_timeout(100)
                    raise RuntimeError("WORK_STATE_TIMEOUT")
                stage="work_start"
                pa.locator("#start").click()
                chat.wait_for_function("sent.length===1",timeout=25000)
                active=until(lambda:(v if (v:=work_state()).get("work",{}).get("state")=="active_visible" and not v.get("pending") else None))
                result["work_identity"]={k:active.get("identity",{}).get(k) for k in ["status","source","identity_scope"]}
                result["work_is_local"]=bool("|local:" in active.get("conversation_key",""))
                assert not result["work_is_local"]
                def sync_stage(label):
                    outcome=worker.evaluate("async()=>await SellerAgentsSyncJournal.syncNow('explicit_user_action')")
                    journal=worker.evaluate("async()=>{const j=await SellerAgentsSyncJournal.read();return {pending:Object.values(j.entries).map(e=>({kind:e.kind,status:e.status,error:e.lastError})),serverRevisions:Object.values(j.serverRevisions)};}")
                    result.setdefault("sync_stages",[]).append({"stage":label,"outcome":outcome,"journal":journal})
                    assert outcome.get("ok") and not journal["pending"]
                    assert any(r>0 for r in journal["serverRevisions"])
                sync_stage("start")
                first_intent=active["work"]["start_intent_id"]
                checks["new_code_auth_start_bound_same_account"]=status(pa)["accountId"]==account
                stage="manual_help_delivery"
                chat.evaluate("""()=>fixtureCurrentChatGPTBlock('OZON_HELP_V2 {"cluster":"catalog_products"}')""")
                chat.locator("[data-assistant-stream-block]").last.scroll_into_view_if_needed()
                button=chat.locator(".ozon-bridge-block-action").last;button.wait_for(timeout=10000);button.click()
                chat.wait_for_function("sent.length===2",timeout=25000)
                assert chat.evaluate("sent[1].startsWith('OZON_')")
                sync_stage("delivery")
                checks["existing_manual_command_and_result_delivery"]=True
                stage="work_finish"
                pa.locator("#finish").click()
                until(lambda:not work_state().get("context",{}).get("work_active"))
                chat.locator(".ozon-bridge-block-action").wait_for(state="hidden")
                assert chat.evaluate("sent.length")==2
                sync_stage("finish")
                stage="new_start_after_finish"
                until(lambda:pa.locator("#start").is_enabled())
                pa.locator("#start").click()
                active=until(lambda:(v if (v:=work_state()).get("work",{}).get("state")=="active_visible" and not v.get("pending") else None))
                sync_stage("new_start")
                assert active["work"]["start_intent_id"]!=first_intent
                chat.wait_for_function("sent.length===3")
                assert chat.locator(".ozon-bridge-block-action").count()==0
                checks["finish_then_new_start_no_old_command_replay"]=True
                pa.locator("#finish").click();until(lambda:not work_state().get("context",{}).get("work_active"))
                assert chat.evaluate("sent.length")==3
                sync_stage("final_finish")
                checks["final_finish_terminal"]=True
                result.update(status="PASS",stage="work_cycle_completed",checks=checks)
            elif os.environ.get("SA_CONNECTION_BROWSER_SCENARIO")=="key_transfer":
                from browser_d3s2_r1_transfer import seed_store
                stage="key_transfer_second_browser"
                b,bb,cb,pb=launch("profile-b",43103)
                second=connect(pb,saved);assert second["accountId"]==account
                wa=next(w for w in ca.service_workers if w.url.endswith("/service_worker_entry.js"))
                wb=next(w for w in cb.service_workers if w.url.endswith("/service_worker_entry.js"))
                store_id="connection-transfer-fixture"
                synthetic="SYNTHETIC_R142_TRANSFER_KEY_NEVER_REAL"
                seed_store(wa,store_id,{"seller":{"clientId":"142000","apiKey":synthetic},"performance":{}},"r142-source-revision")
                seed_store(wb,store_id,{},None)
                for popup in [pa,pb]:
                    popup.reload();popup.locator("#catalog").wait_for();popup.select_option("#stores",store_id)
                stage="key_receipt_denied_before_owner_approval"
                pb.locator("#transfer-consent").check();pb.locator("#transfer-create").click()
                pb.locator("#status").filter(has_text="Перед получением ключей подтвердите").wait_for()
                assert wb.evaluate("async()=> (await SellerAgentsCredentialTransferVault.list()).length")==0
                checks["code_alone_cannot_create_key_receipt"]=True
                cabinet.reload()
                row=cabinet.locator("li").filter(has_text=second["deviceId"])
                row.get_by_role("button",name="Разрешить получение ключей",exact=True).click()
                cabinet.get_by_label("Введите последние 8 символов ID из нужного расширения").fill(second["deviceId"][-8:])
                cabinet.get_by_role("button",name="Подтверждаю эту установку",exact=True).click()
                row.filter(has_text="получение ключей разрешено").wait_for()
                stage="key_receipt_explicit_consent"
                pb.locator("#transfer-consent").uncheck();pb.locator("#transfer-create").click()
                pb.locator("#status").filter(has_text="Сначала подтвердите явное согласие").wait_for()
                assert wb.evaluate("async()=> (await SellerAgentsCredentialTransferVault.list()).length")==0
                checks["owner_approval_does_not_replace_transfer_consent"]=True
                pb.locator("#transfer-consent").check();pb.locator("#transfer-create").click()
                pb.locator("#transfer-status").filter(has_text="Запрос создан").wait_for()
                requests=wb.evaluate("async()=> (await SellerAgentsCredentialTransferVault.list()).map(x=>({requestId:x.requestId,phase:x.phase}))")
                assert len(requests)==1
                request_id=requests[0]["requestId"]
                stage="encrypted_key_transfer_and_ack"
                pa.locator("#transfer-discover").click()
                pa.locator("#transfer-status").filter(has_text="Найдено запросов: 1").wait_for()
                pb.locator("#transfer-receive").click()
                pb.locator("#transfer-status").filter(has_text="Передача принята").wait_for(timeout=15000)
                def key_matches(worker):
                    return worker.evaluate("""async ({id,key})=>{const account=await SellerAgentsControlClient.currentAccount();const all=await chrome.storage.local.get('seller_agents_stores_v1');const store=all.seller_agents_stores_v1?.accounts?.[account]?.stores?.[id];return !!store?.credentialRevision&&store?.credentials?.seller?.apiKey===key;}""",{"id":store_id,"key":synthetic})
                assert key_matches(wa) and key_matches(wb)
                completion=wb.evaluate("""async id=>{const row=await SellerAgentsControlClient.readCredentialTransfer(id);return {state:row.state,recipientDeviceId:row.recipientDeviceId};}""",request_id)
                assert completion["state"]=="COMPLETED" and completion["recipientDeviceId"]==second["deviceId"]
                checks["actual_encrypted_transfer_ack_and_independent_local_key_reread"]=True
                checks["source_key_preserved"]=True
                checks["sandbox_not_disabled"]=True
                result.update(status="PASS",stage="key_transfer_completed",checks=checks)
            elif os.environ.get("SA_CONNECTION_BROWSER_SCENARIO")=="owner_lifecycle":
                stage="confirm_key_recipient"
                row=cabinet.locator("li").filter(has_text=first["deviceId"])
                row.get_by_role("button",name="Разрешить получение ключей",exact=True).click()
                confirmation=cabinet.get_by_label("Введите последние 8 символов ID из нужного расширения")
                confirmation.fill("wrong-id")
                assert cabinet.get_by_role("button",name="Подтверждаю эту установку",exact=True).is_disabled()
                confirmation.fill(first["deviceId"][-8:])
                cabinet.get_by_role("button",name="Подтверждаю эту установку",exact=True).click()
                row.filter(has_text="получение ключей разрешено").wait_for()
                checks["owner_confirmation_matches_exact_device"]=True
                stage="unknown_replacement"
                dropped=[]
                def lose_committed_response(route):
                    response=route.fetch()
                    dropped.append(response.status)
                    route.abort()
                cabinet.route("**/api/control-plane/v1/connection-codes",lose_committed_response,times=1)
                cabinet.get_by_role("button",name="Заменить код, оставить устройства",exact=True).click()
                cabinet.get_by_role("button",name="Проверить ту же попытку",exact=True).wait_for()
                cabinet.get_by_role("status").filter(has_text="Ответ не подтверждён").wait_for()
                assert dropped==[200]
                cabinet.reload()
                cabinet.get_by_role("button",name="Проверить ту же попытку",exact=True).click()
                cabinet.get_by_role("status").filter(has_text="Сервер подтверждает прошлый выпуск").wait_for()
                assert cabinet.get_by_label("Секретный код подключения",exact=True).count()==0
                checks["committed_lost_response_restores_same_attempt_without_secret_reveal"]=True
                stage="ordinary_replace"
                cabinet.get_by_role("button",name="Заменить код, оставить устройства",exact=True).click()
                field=cabinet.get_by_label("Секретный код подключения",exact=True);field.wait_for()
                replacement=field.input_value();assert replacement!=saved
                def recheck(context):
                    worker=next(w for w in context.service_workers if w.url.endswith("/service_worker_entry.js"))
                    return worker.evaluate("""async()=>{try{await SellerAgentsControlClient.bootstrap();}catch(_){}const s=await SellerAgentsControlClient.status();return {authenticated:s.authenticated,deviceId:s.deviceId,accountId:s.accountId};}""")
                retained=recheck(ca);assert retained["authenticated"] and retained["deviceId"]==first["deviceId"]
                checks["ordinary_replace_retains_existing_device_after_server_check"]=True
                b,bb,cb,pb=launch("profile-b",43103)
                pb.locator("#connection-code").fill(saved);pb.locator("#connection-submit").click()
                limit=time.monotonic()+10
                while time.monotonic()<limit:
                    rejected=status(pb)
                    if rejected.get("lastError")=="CONNECTION_CODE_CLOSED":break
                    time.sleep(.1)
                assert rejected.get("lastError")=="CONNECTION_CODE_CLOSED" and not rejected["authenticated"]
                checks["old_code_cannot_enroll_new_browser"]=True
                pb.locator("#auth-cancel").click();pb.locator("#confirm").click()
                pb.locator("#connection-submit").wait_for()
                second=connect(pb,replacement);assert second["accountId"]==account
                checks["replacement_code_enrolls_independent_device"]=second["deviceId"]!=first["deviceId"]
                cabinet.reload();unapproved=cabinet.locator("li").filter(has_text=second["deviceId"])
                unapproved.get_by_role("button",name="Разрешить получение ключей",exact=True).wait_for()
                checks["new_device_does_not_inherit_key_receipt_approval"]=True
                stage="emergency_revoke"
                cabinet.get_by_label("Понимаю, что все устройства этого аккаунта будут отозваны").check()
                cabinet.get_by_role("button",name="Заменить код и отозвать устройства",exact=True).click()
                field=cabinet.get_by_label("Секретный код подключения",exact=True);field.wait_for()
                emergency_code=field.input_value();assert emergency_code!=replacement
                cabinet.get_by_role("status").filter(has_text="Устройства отозваны").wait_for()
                assert not recheck(ca)["authenticated"] and not recheck(cb)["authenticated"]
                checks["emergency_revoke_denies_existing_devices_on_server_contact"]=True
                pb.reload();third=connect(pb,emergency_code)
                assert third["accountId"]==account and third["deviceId"] not in [first["deviceId"],second["deviceId"]]
                checks["emergency_code_connects_new_independent_session"]=True
                checks["sandbox_not_disabled"]=True
                result.update(status="PASS",stage="owner_lifecycle_completed",checks=checks)
            else:
                ba.close();browsers.remove(ba);a.terminate();a.wait(timeout=10)
                stage="second_browser";b,bb,cb,pb=launch("profile-b",43103)
                second=connect(pb,saved)
                assert second["accountId"]==account and second["deviceId"]!=first["deviceId"]
                checks["second_browser_without_website"]=True
                checks["separate_device"]=True
                checks["no_cabinet_cookie_second_browser"]=not any(c["name"]=="pcp_session" for c in cb.cookies())
                bb.close();browsers.remove(bb);b.terminate();b.wait(timeout=10)
                stage="restart_first_browser";a2,ba2,ca2,pa2=launch("profile-a",43102)
                pa2.locator("#catalog").wait_for(state="visible",timeout=15000)
                restored=status(pa2);assert restored["accountId"]==account and restored["deviceId"]==first["deviceId"]
                checks["browser_restart_keeps_confirmed_enrollment"]=True
                checks["sandbox_not_disabled"]=True
                result.update(status="PASS",stage="completed",checks=checks)
    except Exception as error:
        result.update(status="FAIL",stage=stage,error_type=type(error).__name__,
          failure_sites=[{"file":Path(frame.filename).name,"line":frame.lineno,"function":frame.name} for frame in traceback.extract_tb(error.__traceback__)])
        # Only pre-credential browser setup errors may retain their first message.
        if stage=="first_browser":
            first=str(error).splitlines()[0]
            if not any(value in first.lower() for value in ["octo1_","bearer","424242","password","token"]):
                result["setup_error"]=first[:400]
    finally:
        for browser in browsers:
            try:browser.close()
            except Exception:pass
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=8)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        result["own_children_terminal"]=all(p.poll() is not None for p in processes)
        for name in ["profile-a","profile-b"]:
            path=output/name
            if path.exists():shutil.rmtree(path)
        result["own_profiles_removed"]=not any((output/name).exists() for name in ["profile-a","profile-b"])
        (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    return 0 if result["status"]=="PASS" and result["own_children_terminal"] and result["own_profiles_removed"] else 1
if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--output",type=Path,required=True)
    raise SystemExit(run(parser.parse_args().output))
