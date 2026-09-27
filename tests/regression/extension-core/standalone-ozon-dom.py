import os
from pathlib import Path
import json,html,traceback,uuid
from playwright.sync_api import sync_playwright
B=Path(os.environ['OZ_TEST_OUTPUT']).resolve(); B.mkdir(parents=True,exist_ok=True)
O=B/'evidence'; O.mkdir(exist_ok=True)
EXT=Path(os.environ['OZ_TEST_RUNTIME']).resolve()
CMD='OZON_HELP_V2\n{"cluster":"supplies_fbo"}'
def block(attrs='aria-label="Copy code"',body=None):
 return '<div class="codeblock" style="margin:25px;padding:20px;width:650px"><button '+attrs+'>Copy</button><pre><code>'+html.escape(CMD if body is None else body)+'</code></pre></div>'
def msg(inner,attrs='data-turn="assistant"',tag='section'):
 return '<'+tag+' '+attrs+'>'+inner+'</'+tag+'>'
FORM='''<form><textarea id="prompt-textarea" style="width:700px;height:80px"></textarea><button data-testid="send-button" aria-label="Send message" type="submit">Send</button></form><script>window.submissions=[];document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const t=document.querySelector('textarea');submissions.push(t.value);const d=document.createElement('section');d.dataset.turn='user';d.textContent=t.value;document.querySelector('main').append(d);t.value='';});</script>'''
GUEST_FORM=FORM.replace('id="prompt-textarea"','id="mobile-composer-prompt"')+'<script>(()=>{const t=document.querySelector("textarea"),b=document.querySelector("form button");b.disabled=true;t.addEventListener("input",()=>{b.disabled=t.dataset.testBlocked==="1"||!t.value.trim()});document.querySelector("form").addEventListener("submit",()=>{b.disabled=true})})()</script>'
CURRENT_WB='<div data-writing-block data-testid="writing-block-container" id="writing-block-msg-current"><div data-testid="writing-block-header-surface"><span>Обычный текст</span><button type="button" aria-label="Копировать">Copy</button></div><div class="ProseMirror writing-block-editor-disabled" aria-disabled="true"><p>OZON_HELP_V2</p><p>{&quot;cluster&quot;:&quot;supplies_fbo&quot;}</p></div></div>'
cases=[
 ('current_writing_block_standalone',CURRENT_WB,1),
 ('current_writing_block_inside_user',msg(CURRENT_WB,'data-turn="user"'),0),
 ('native_guest_cycle',msg(block()),1),
 ('native_guest_double_cycle',msg(block()),1),
 ('native_guest_stop_cycle',msg(block()),1),
 ('native_guest_blocked',msg(block()),1),

 ('main_replaced_cycle',msg(block()),1),
 ('overlay_removed_cycle',msg(block()),1),
 ('shadow_button_removed_cycle',msg(block()),1),
 ('body_replaced_cycle',msg(block()),1),

 ('legacy_ru',msg(block('aria-label="Копировать"')),1),
 ('legacy_en',msg(block('aria-label="Copy"')),1),
 ('copy_code_en',msg(block()),1),
 ('copy_code_ru',msg(block('aria-label="Копировать код"')),1),
 ('title_only',msg(block('title="Копировать код"')),1),
 ('structural_copy_state',msg(block('data-code-copy-state="idle"')),1),
 ('unknown_copy_label',msg(block('aria-label="Copier le code"')),1),
 ('no_copy_control',msg('<pre><code>'+html.escape(CMD)+'</code></pre>'),1),
 ('article_role',msg(block(),tag='article'),1),
 ('author_role',msg(block(),'data-message-author-role="assistant"',tag='div'),1),
 ('guest_role',msg(block(),'data-message-role="assistant" id="guest-a"',tag='li'),1),
 ('mixed_roles',msg(block())+msg(block(),'data-message-role="assistant"',tag='li'),2),
 ('nested_dedup',msg(msg(block(),'data-message-author-role="assistant"',tag='div')),1),

 ('user_ignored',msg(block(),'data-turn="user"'),0),
 ('guest_user_ignored',msg(block(),'data-message-role="user"',tag='li'),0),
 ('plain_text_ignored',msg(html.escape(CMD)),0),
 ('two_independent_blocks',msg(block(body='NOT_A_COMMAND')+block()),2),
 ('writing_editor',msg('<div><button aria-label="Copy code">Copy</button><div data-writing-block-fullscreen-editor-region>'+html.escape(CMD)+'</div></div>'),1),
 ('desktop_plain_code_copy_ru',msg('<div class="ordinary-text-block"><div class="toolbar"><span>Обычный текст</span><button aria-label="Копировать">Copy</button></div><div class="body"><code style="display:block;white-space:pre">'+html.escape(CMD)+'</code></div></div>'),1),
 ('desktop_plain_code_copy_en',msg('<div class="ordinary-text-block"><div class="toolbar"><span>Plain text</span><button aria-label="Copy">Copy</button></div><div class="body"><code style="display:block;white-space:pre">'+html.escape(CMD)+'</code></div></div>'),1),
 ('desktop_inline_code_no_copy',msg('<p>Inline <code>'+html.escape(CMD)+'</code></p>'),0),
 ('desktop_user_plain_code_copy',msg('<div><button aria-label="Копировать">Copy</button><code>'+html.escape(CMD)+'</code></div>','data-message-role="user"',tag='li'),0),
 ('desktop_ambiguous_copy_multiple_code',msg('<div><button aria-label="Копировать">Copy</button><code>A</code><code>'+html.escape(CMD)+'</code></div>'),0),

 ('project_labelledby_response_actions_generic',msg('<div class="ordinary-text-block"><button aria-label="Копировать">Copy</button><code>'+html.escape(CMD)+'</code></div><span id="resp-actions-label">Действия с ответом</span><div role="group" aria-labelledby="resp-actions-label"><button aria-label="Копировать ответ">R</button></div>','',tag='div'),1),
 ('project_unlabelled_response_actions_generic',msg('<div class="ordinary-text-block"><button aria-label="Копировать">Copy</button><code>'+html.escape(CMD)+'</code></div><div role="group"><button aria-label="Copy response">R</button></div>','',tag='div'),1),
 ('project_user_copy_message_not_response',msg('<div class="ordinary-text-block"><button aria-label="Копировать">Copy</button><code>'+html.escape(CMD)+'</code></div><div role="group"><button aria-label="Копировать сообщение">U</button></div>','',tag='div'),0),
 ('project_action_inferred_plain_code',msg('<div class="ordinary-text-block"><div><span>Обычный текст</span><button aria-label="Копировать">Copy</button></div><code>'+html.escape(CMD)+'</code></div><div role="group" aria-label="Действия с ответом" data-message-actions data-assistant-message-actions></div>','',tag='section'),1),
 ('project_action_inferred_pre',msg('<pre><code>'+html.escape(CMD)+'</code></pre><div role="group" aria-label="Response actions" data-message-actions></div>','',tag='article'),1),
 ('project_user_actions_not_inferred',msg('<div><button aria-label="Копировать">Copy</button><code>'+html.escape(CMD)+'</code></div><div role="group" aria-label="Действия с вашим сообщением"></div>','',tag='section'),0),
 ('project_explicit_plus_actions_dedup',msg('<div><button aria-label="Копировать">Copy</button><code>'+html.escape(CMD)+'</code></div><div role="group" aria-label="Действия с ответом" data-assistant-message-actions></div>'),1),
 ('role_added_later',msg(block(),'id="late" data-message-role="pending"',tag='li'),0),
 ('streamed_code',msg('<div id="stream"></div>'),0),
 ('rapid_double_click',msg(block()),1),
 ('reload_binding',msg(block()),1),
]
results=[]; network=[]; errors=[]; fixtures={}
with sync_playwright() as p:
 ctx=p.chromium.launch_persistent_context(str(B/('profile-regression-'+uuid.uuid4().hex[:8])),channel='chromium',headless=True,args=['--no-sandbox','--disable-extensions-except='+str(EXT),'--load-extension='+str(EXT)],viewport={'width':1100,'height':900})
 try:
  sw=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker',timeout=15000)
  eid=sw.url.split('/')[2]
  ctx.on('request',lambda req:network.append(req.url))
  def route(r):
   if r.request.url in fixtures:r.fulfill(status=200,content_type='text/html',body=fixtures[r.request.url])
   else:r.abort()
  ctx.route('https://**/*',route)
  popup=ctx.new_page();popup.goto('chrome-extension://'+eid+'/popup.html')
  def rpc(m):return popup.evaluate('(m)=>chrome.runtime.sendMessage(m)',m)
  for i,(name,markup,expected) in enumerate(cases):

   cid=str(uuid.uuid4()); url='https://chatgpt.com/'+('uc/' if name.startswith('guest') else 'c/')+cid
   fixtures[url]='<!doctype html><html><head><meta charset="utf-8"></head><body><main>'+markup+(GUEST_FORM if name.startswith('native_guest') else FORM)+'</main></body></html>'
   page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url);page.wait_for_timeout(350)
   if name=='native_guest_blocked':page.locator('textarea').evaluate('(e)=>e.dataset.testBlocked="1"')
   if name=='native_guest_stop_cycle':page.locator('form').evaluate('(f)=>{const b=document.createElement("button");b.id="native-stop";b.type="button";b.setAttribute("aria-label","Stop generating");f.append(b)}')
   row={'case':name,'expected_initial_buttons':expected}
   try:
    buttons=page.locator('button.ozon-bridge-block-action')
    assert buttons.count()==0,'Button before conversation binding'
    tid=next(t['id'] for t in sw.evaluate('()=>chrome.tabs.query({})') if t.get('url')==url)
    key='https://chatgpt.com|'+cid
    r=rpc({'type':'OZ_BIND_CONVERSATION','context':{'tab_id':tid,'origin':'https://chatgpt.com','conversation_id':cid}});assert r.get('ok'),str(r)
    r=rpc({'type':'OZ_WORK_RESUME','tab_id':tid,'conversation_key':key});assert r.get('ok'),str(r)
    page.bring_to_front();page.wait_for_timeout(450)
    row['initial_buttons']=buttons.count();assert buttons.count()==expected,row
    if expected:assert all(buttons.nth(n).is_enabled() for n in range(expected))
    assert page.evaluate('submissions.length')==0,'Unrequested auto execution'
    if name=='main_replaced_cycle':
     page.locator('main').evaluate('(e)=>{const form=e.querySelector("form");const n=e.cloneNode(true);n.querySelector("form").replaceWith(form);e.replaceWith(n)}')
    if name=='overlay_removed_cycle':
     page.locator('#ozon-bridge-own-button-host').evaluate('(e)=>e.remove()')
    if name=='shadow_button_removed_cycle':
     buttons.first.evaluate('(e)=>e.remove()')
    if name=='body_replaced_cycle':
     page.evaluate('()=>{const old=document.body;const body=document.createElement("body");const main=document.querySelector("main");const form=document.querySelector("form");const copy=main.cloneNode(true);copy.querySelector("form")?.remove();body.append(copy,form);old.replaceWith(body)}')
    if name.endswith('_cycle'):
     page.wait_for_timeout(350);assert buttons.count()==1 and buttons.first.is_visible(), 'button lost on '+name
     count_before=rpc({'type':'OZ_GET_DIAGNOSTICS','limit':300}).get('diagnostics',[])
     page.wait_for_timeout(350)
     count_after=rpc({'type':'OZ_GET_DIAGNOSTICS','limit':300}).get('diagnostics',[])
     row['idle_scan_stable']=sum(e.get('event')=='CODE_BLOCK_SCAN' for e in count_before)==sum(e.get('event')=='CODE_BLOCK_SCAN' for e in count_after)
     assert row['idle_scan_stable'],'rescan loop at idle'
    if name=='role_added_later':
     page.locator('#late').evaluate('(e)=>e.dataset.messageRole="assistant"');page.wait_for_timeout(250)
     assert buttons.count()==1,'Attribute-only role change missed'
     page.locator('#late').evaluate('(e)=>e.dataset.messageRole="user"');page.wait_for_timeout(250)
     assert buttons.count()==0,'Stale assistant button retained'
    if name=='streamed_code':
     page.locator('#stream').evaluate('(e)=>e.innerHTML="<pre><code>OZON_</code></pre>"');page.wait_for_timeout(250);assert buttons.count()==1
     page.locator('#stream code').evaluate('(e,t)=>e.textContent=t',CMD);page.wait_for_timeout(250);assert buttons.count()==1

    if name=='reload_binding':
     page.reload();page.wait_for_timeout(600);assert buttons.count()==1 and buttons.first.is_enabled()
    if name in ('current_writing_block_standalone','project_labelledby_response_actions_generic','project_unlabelled_response_actions_generic') or name.endswith('_cycle') or name in ('copy_code_en','guest_role','rapid_double_click','two_independent_blocks','streamed_code','desktop_plain_code_copy_ru','project_action_inferred_plain_code'):
     target=buttons.nth(1) if name=='two_independent_blocks' else buttons.first
     if name in ('rapid_double_click','native_guest_double_cycle'):target.evaluate('(b)=>{b.click();b.click();}')
     else:target.click()
     if name=='native_guest_stop_cycle':
      page.wait_for_timeout(350);assert page.evaluate('submissions.length')==0;page.locator('#native-stop').evaluate('(e)=>e.remove()')
     page.wait_for_function('submissions.length===1',timeout=6000)
     page.wait_for_timeout(500)
     submissions=page.evaluate('submissions');assert len(submissions)==1
     assert 'supplies_fbo' in submissions[0] and 'cluster_selected' in submissions[0]
     diagnostics=rpc({'type':'OZ_GET_DIAGNOSTICS'})['diagnostics']
     accepted=[d for d in diagnostics if d.get('event')=='MANUAL_BATCH_ACCEPTED' and d.get('conversation_id')==cid]
     assert len(accepted)==1,accepted
     row.update({'deliveries':1,'native_worker_acceptances':1,'local_help_cluster':'supplies_fbo'})
     if name.startswith('native_guest'):
      page.wait_for_function('()=>!document.querySelector("#ozon-bridge-own-button-host").shadowRoot.querySelector("button").disabled',timeout=4000)
      row['ready_for_next_command']=True
     (O/(name+'-cycle.json')).write_text(json.dumps({'report':submissions[0],'diagnostics':[d for d in diagnostics if d.get('tab_id')==tid or d.get('conversation_id')==cid]},ensure_ascii=False,indent=2))
    if name=='native_guest_blocked':
     buttons.first.click();page.wait_for_timeout(500)
     assert page.evaluate('submissions.length')==0
     dd=rpc({'type':'OZ_GET_DIAGNOSTICS'})['diagnostics']
     own=[d for d in dd if d.get('tab_id')==tid]
     assert not any(d.get('event') in ('SEND_CLICKED','DELIVERY_SUCCESS') for d in own)
     row['disabled_nonempty_not_completed']=True
     assert rpc({'type':'OZ_WORK_FINISH','tab_id':tid,'conversation_key':key}).get('ok')
    row['result']='PASS'
   except Exception as e:
    row.update({'result':'FAIL','error':str(e),'trace':traceback.format_exc()})
   results.append(row);print(name,row['result'],row.get('error',''),flush=True)
   if name in ('current_writing_block_standalone','project_labelledby_response_actions_generic','project_unlabelled_response_actions_generic') or name.endswith('_cycle') or name in ('copy_code_en','guest_role','two_independent_blocks'):page.screenshot(path=str(O/(name+'.png')))
   page.close()
   (O/'regression.json').write_text(json.dumps({'environment':'native Chromium extension, original service worker; synthetic page only; no credentials','version':sw.evaluate('chrome.runtime.getManifest().version'),'cases':results,'page_errors':errors,'ozon_requests':[u for u in network if 'ozon.' in u]},ensure_ascii=False,indent=2))
 finally:ctx.close()
assert all(r['result']=='PASS' for r in results), 'Regression failures'
assert not errors,errors
print('TOTAL_PASS',len(results),flush=True)
