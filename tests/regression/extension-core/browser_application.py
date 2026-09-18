"""Native Chromium fixture: generated popup, actual worker/content/IDB, synthetic AI and fetch.
The popup is opened as an extension page; only tabs.query(active) is supplied the
fixture AI tab, because Playwright does not operate the browser action toolbar.
No live AI/provider or installed target-browser certification is claimed.
"""
from pathlib import Path
import argparse,base64,json,tempfile,time,os,traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]

def until(fn, timeout=30):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        value=fn()
        if value:return value
        time.sleep(.1)
    raise AssertionError('Timed out waiting for browser state')

def seed_authority(worker, private_key):
    encoded = base64.b64encode(private_key.read_bytes()).decode('ascii')
    worker.evaluate("""async (pkcs8) => {
      const v = SellerAgentsBootstrapVerifier;
      const fromB64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
      const b64 = bytes => btoa(String.fromCharCode(...bytes));
      const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
      const deviceId = '22222222-2222-4222-8222-222222222222';
      const sessionId = '33333333-3333-4333-8333-333333333333';
      const content = {
        schemaVersion: 'adapter_profile_v1',
        page: {identityStrategy: 'page_identity', conversationStrategy: 'conversation_root', composerStrategy: 'composer_root'},
        selectors: {
          conversation: {strategy: 'conversation_root', primary: {kind: 'packaged_selector_reference', reference: 'conversation-root'}, fallbacks: [], timeoutMs: 1000, observationMode: 'polling'},
          composer: {strategy: 'composer_root', primary: {kind: 'packaged_selector_reference', reference: 'composer-root'}, fallbacks: [], timeoutMs: 1000, observationMode: 'polling'},
          send: {strategy: 'send_control', primary: {kind: 'packaged_selector_reference', reference: 'send-control'}, fallbacks: [], timeoutMs: 1000, observationMode: 'polling'},
          assistantResponse: {strategy: 'assistant_response', primary: {kind: 'packaged_selector_reference', reference: 'assistant-response'}, fallbacks: [], timeoutMs: 1000, observationMode: 'polling'}
        },
        observation: {mode: 'polling', intervalMs: 500},
        contours: [
          {key: 'page_identity', required: true, expectedState: 'PRESENT', strategy: 'page_identity'},
          {key: 'conversation_root', required: true, expectedState: 'PRESENT', strategy: 'conversation_root'},
          {key: 'composer_root', required: true, expectedState: 'INTERACTIVE', strategy: 'composer_root'},
          {key: 'send_control', required: true, expectedState: 'INTERACTIVE', strategy: 'send_control'}
        ]
      };
      const compatibility = {
        schemaVersion: 'profile_compatibility_v1', contractVersion: 'control_plane_v1', browserFamilies: ['chrome'],
        minimumBrowserVersions: [], minimumExtensionVersion: null
      };
      const profileBytes = new TextEncoder().encode(v.canonicalJson({content, compatibility}));
      const contentSha256 = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', profileBytes)));
      const payload = {
        snapshotVersion: 'bootstrap_snapshot_v2', contractVersion: 'control_plane_v2', configVersion: 1,
        issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), offlineGraceUntil: new Date(Date.now() + 7200000).toISOString(),
        serverTime: new Date().toISOString(), accessBasis: 'BETA', account: {id: '11111111-1111-4222-8111-111111111111', status: 'ACTIVE'},
        subscription: {state: 'NONE', planRevision: null}, devicePolicy: {status: 'ACTIVE'},
        compatibility: {extension: {status: 'SUPPORTED', minimumVersion: null}, browser: {status: 'SUPPORTED'}},
        entitlements: {'source.ozon': true, 'source.wildberries': true, 'ai.chatgpt': true}, features: {},
        ai: {status: 'RESOLVED', detected: {family: 'chatgpt', surface: 'web', variant: null},
          profile: {profileKey: 'browser-fixture-profile', revision: 1, scopeVariant: null, schemaVersion: 'adapter_profile_v1', contentSha256, content, compatibility}}
      };
      const payloadBytes = new TextEncoder().encode(v.canonicalJson(payload));
      const key = await crypto.subtle.importKey('pkcs8', fromB64(pkcs8), {name: 'Ed25519'}, false, ['sign']);
      const keyId = 'browser-fixture-key';
      const prefix = new Uint8Array([...new TextEncoder().encode('product-control-plane/bootstrap-snapshot/v1'), 0, ...new TextEncoder().encode(keyId), 0]);
      const signed = new Uint8Array(prefix.length + payloadBytes.length); signed.set(prefix); signed.set(payloadBytes, prefix.length);
      const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, signed));
      const envelope = {envelopeVersion: 'bootstrap_envelope_v2', algorithm: 'Ed25519', keyId, payload: v.base64urlEncode(payloadBytes), signature: v.base64urlEncode(signature)};
      const cfg = SellerAgentsControlConfig;
      const ua = String(navigator.userAgent || '').toLowerCase();
      const browser = {family: ua.includes('yabrowser') ? 'yandex_chromium' : 'chrome', version: (String(navigator.userAgent || '').match(/(?:Chrome|YaBrowser)\/(\d+(?:\.\d+){0,3})/i) || [null, '0.0.0'])[1]};
      const trustBundleSha256 = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v.canonicalJson(cfg.trustBundle)))));
      const cacheBinding = {cacheVersion: 'control_cache_binding_v1', controlApiOrigin: cfg.controlApiOrigin, portalOrigin: cfg.portalOrigin, contractVersion: cfg.contractVersion, extensionVersion: cfg.extensionVersion, browser, detectedAi: {family: 'chatgpt', surface: 'web', variant: null}, trustBundleSha256};
      const serverTimeMs = Date.parse(payload.serverTime);
      const cacheClock = {cacheVersion: 'control_cache_clock_v1', owner: {controlApiOrigin: cfg.controlApiOrigin, portalOrigin: cfg.portalOrigin, contractVersion: cfg.contractVersion, deviceId, sessionId}, trustedServerTimeMs: serverTimeMs, effectiveTimeMs: serverTimeMs};
      const credentials = {deviceId, sessionId, tokenType: 'Bearer', accessToken: 'fixture_access_token', accessTokenExpiresAt: '2099-09-16T00:00:00Z', refreshToken: 'A'.repeat(43), refreshTokenExpiresAt: '2099-09-17T00:00:00Z'};
      await chrome.storage.local.set({seller_agents_control_auth_v2: {generation: 1, credentials, pending: null, rotation: null, authority: {verified: true, workAllowed: true, payload, envelope, deviceId, sessionId, generation: 1, requestedAi: 'chatgpt', cacheBinding}, cacheClock, lastError: null}});
    }""", encoded)

def run(runtime,output,private_key):
    output.mkdir(parents=True,exist_ok=True)
    fixture=(ROOT/'tests/regression/extension-core/fixtures/application-chat.html').read_text()
    result={'status':'RUNNING','live_provider_calls':0,'installed_acceptance':False,'scope':'native Chromium fixture; popup active-tab port controlled; synthetic AI/fetch'}
    with sync_playwright() as p,tempfile.TemporaryDirectory() as profile:
        opts={'headless':True,'channel':'chromium','args':['--no-sandbox',f'--disable-extensions-except={runtime}',f'--load-extension={runtime}']}
        if os.getenv('SA_TEST_CHROMIUM'):opts['executable_path']=os.environ['SA_TEST_CHROMIUM'];opts.pop('channel')
        context=p.chromium.launch_persistent_context(profile,**opts)
        page=popup=worker=None
        errors=[]
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            empty_status=worker.evaluate("async()=>SellerAgentsControlClient.status()")
            assert empty_status['authenticated'] is False
            seed_authority(worker, private_key)
            worker.evaluate("()=>{globalThis.__seller_agents_native_fixture_sentinel='first-worker-only'}")
            extension_url=worker.url
            context.close()
            context=None
            context=p.chromium.launch_persistent_context(profile,**opts)
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            assert worker.url == extension_url
            assert worker.evaluate("()=>globalThis.__seller_agents_native_fixture_sentinel") is None
            restored=worker.evaluate("async()=>SellerAgentsControlClient.status()")
            assert restored['authenticated'] is True and restored['workAllowed'] is True
            context.route('https://**/*',lambda route:route.fulfill(body=fixture,content_type='text/html') if route.request.url.startswith('https://chatgpt.com/c/') else route.abort())
            page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('https://chatgpt.com/c/11111111-1111-4222-8111-111111111111')
            tab_id=until(lambda:worker.evaluate("async()=>{const tabs=await chrome.tabs.query({url:'https://chatgpt.com/c/*'});return tabs[0]?.id}"))
            worker.evaluate("""()=>{globalThis.fixtureFetches=[];globalThis.fetch=async(url,init)=>{
              if(!String(url).includes('.wildberries.ru/'))throw new Error('Fixture forbids unmocked provider');
              fixtureFetches.push(String(url));
              return globalThis.fixtureBinary ? new Response(new Uint8Array([37,80,68,70,45,49,10,0,255]),{headers:{'content-type':'application/pdf','content-disposition':'attachment; filename="native-report.pdf"'}}) : new Response('{"result":{"fixture":42}}',{headers:{'content-type':'application/json'}});
            }}""")
            # A popup opened as its own extension tab must render account state
            # without borrowing an AI-tab query override. It has no supported
            # AI context, so Start remains disabled even for the restored account.
            own_popup=context.new_page();own_popup.on('pageerror',lambda e:errors.append(str(e)))
            own_popup.goto(worker.url.rsplit('/',1)[0]+'/popup.html')
            until(lambda: 'Аккаунт · 11111111' in own_popup.locator('#account').inner_text())
            assert own_popup.locator('#catalog').is_visible()
            own_popup.click('#wildberries');own_popup.click('#add');own_popup.fill('#token','FIXTURE_NATIVE_OWN_TAB_TOKEN');own_popup.fill('#name','Own-tab fixture store');own_popup.click('#save')
            until(lambda: 'Own-tab fixture store' in own_popup.locator('#stores').inner_text())
            assert own_popup.locator('#start').is_disabled()
            own_popup.close()
            popup=context.new_page();popup.on('pageerror',lambda e:errors.append(str(e)))
            popup.add_init_script(f"const originalQuery=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=(query)=>query.active?Promise.resolve([{{id:{tab_id}}}]):originalQuery(query);")
            popup.goto(worker.url.rsplit('/',1)[0]+'/popup.html')
            until(lambda: 'Аккаунт · 11111111' in popup.locator('#account').inner_text())
            popup.click('#wildberries');popup.click('#add');popup.fill('#token','FIXTURE_BROWSER_PERSONAL_TOKEN');popup.fill('#name','Тестовый WB');popup.click('#save')
            until(lambda: 'Тестовый WB' in popup.locator('#stores').inner_text())
            assert page.evaluate('sent.length')==0
            popup.click('#start')
            until(lambda:'Работаем' in popup.locator('#connection').inner_text())
            assert page.evaluate('sent.length')==1
            assert 'WB_HELP_V1' in page.evaluate('sent[0]')
            # Historical assistant block must not gain the execution button.
            until(lambda:worker.evaluate("async()=>Object.values((await chrome.storage.local.get('ozmb_work_sessions_v1')).ozmb_work_sessions_v1||{})[0]?.state==='active_visible'"))
            page.wait_for_timeout(300)
            assert page.locator('.ozon-bridge-block-action').count()==0
            page.evaluate("fixtureCommand('WB_HELP_V1 {\"operation\":\"describe\",\"params\":{\"alias\":\"seller_info\"}}\\nWB_API_V1 {\"operation\":\"seller_info\",\"params\":{}}')")
            page.locator("section[data-turn='assistant'] .code").last.scroll_into_view_if_needed()
            button=page.locator('.ozon-bridge-block-action').last
            button.wait_for();assert button.inner_text()=='WB';button.click()
            page.wait_for_function('sent.length===2',timeout=30000)
            assert page.evaluate("sent[1].startsWith('WB_BATCH_RESULT_V1')")
            until(lambda:worker.evaluate("async()=>Object.values((await chrome.storage.local.get('ozmb_manual_operations')).ozmb_manual_operations||{})[0]?.status==='completed'"))
            assert worker.evaluate('fixtureFetches.length')==1
            # Hiding keeps the session active; the popup persists the bound marketplace.
            popup.click('#visibility');until(lambda:'скрыта' in popup.locator('#connection').inner_text())
            assert page.locator('.ozon-bridge-block-action').count()==0
            popup.click('#visibility');until(lambda:page.locator('.ozon-bridge-block-action').count()==1)
            page.locator("section[data-turn='assistant'] .code").last.scroll_into_view_if_needed()
            button=page.locator('.ozon-bridge-block-action').last;button.click();page.wait_for_timeout(250)
            assert worker.evaluate('fixtureFetches.length')==1
            # Actual native File/IndexedDB/chunk/attachment/send path for a binary WB result.
            command=worker.evaluate("""()=>{fixtureBinary=true;const m=Object.values(SellerAgentsWBReference.contract.OPERATIONS).find(m=>m.response_mode==='binary'&&m.execution_enabled&&m.privacy==='standard');return 'WB_API_V1 '+JSON.stringify({operation:m.alias,params:{path:Object.fromEntries([...m.path.matchAll(/\\{([^}]+)\\}/g)].map(m=>[m[1],'fixture'])),query:Object.fromEntries(m.required_query_keys.map(k=>[k,'1'])),...(m.body_required?{body:{}}:{})}})}""")
            page.evaluate('(text)=>fixtureCommand(text)',command)
            page.locator("section[data-turn='assistant'] .code").last.scroll_into_view_if_needed()
            button=page.locator('.ozon-bridge-block-action').last;button.wait_for();button.click()
            page.wait_for_function('files.length>=1',timeout=30000)
            actual=page.evaluate("files.find(f=>f.name==='native-report.pdf')")
            assert actual['bytes']==[37,80,68,70,45,49,10,0,255]
            page.wait_for_function('sent.length===3',timeout=30000)
            until(lambda:worker.evaluate("async()=>Object.values((await chrome.storage.local.get('ozmb_manual_operations')).ozmb_manual_operations||{})[0]?.status==='completed'"))
            assert worker.evaluate('fixtureFetches.length')==2
            popup.click('#finish');until(lambda:'Завершено' in popup.locator('#connection').inner_text())
            assert page.locator('.ozon-bridge-block-action').count()==0
            # Popup dimensions at normal and enlarged typography; no horizontal clipping.
            for width,scale in [(380,1),(320,1),(380,1.25)]:
                popup.set_viewport_size({'width':width,'height':900})
                popup.evaluate('(scale)=>document.documentElement.style.fontSize=(14*scale)+"px"',scale)
                popup.click('#edit')
                assert popup.evaluate('document.documentElement.scrollWidth<=innerWidth')
                popup.screenshot(path=str(output/f'popup-{width}-{scale}.png'),full_page=True)
                popup.click('#cancel')
            assert not errors,errors
            result.update(status='PASS',browser=context.browser.version,checks=['popup create/edit','real Work prompt','old-history baseline','WB mixed block text send','no replay','Show/Hide','native binary File/IDB/port send','Finish','320/380px and enlarged typography'])
        except Exception as error:
            result.update(status='FAIL',error=str(error),traceback=traceback.format_exc(),page_errors=errors)
            if popup:
                try:popup.screenshot(path=str(output/'failure-popup.png'),full_page=True)
                except Exception:pass
            if page:
                try:page.screenshot(path=str(output/'failure-chat.png'),full_page=True)
                except Exception:pass
            if worker:
                try:(output/'failure-worker.json').write_text(json.dumps(worker.evaluate('async()=>chrome.storage.local.get(["ozmb_diagnostics","ozmb_work_sessions_v1","ozmb_manual_operations","ozmb_pending_work_starts_v1"])'),ensure_ascii=False,indent=2))
                except Exception:pass
        finally:
            if context:
                context.close()
            (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False));assert result['status']=='PASS',result.get('error')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--runtime',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--fixture-private-key',type=Path,required=True);args=parser.parse_args();run(args.runtime.resolve(),args.output.resolve(),args.fixture_private_key.resolve())
