"""B02 Claude: real adapter + tracker + attachClaimed + request, offline DOM.
Only native UI fixtures and worker transport are synthetic. Every browser request
is intercepted. No live profile, credentials, AI Send or marketplace is accessed.
"""
import argparse, asyncio, datetime, hashlib, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

MODULES=['shared/conversation_identity.js','shared/runtime_names.js','shared/work_session_model.js','shared/ai_delivery_capabilities.js','shared/ai_adapters.js','shared/web_file_attachment.js','shared/composer_send.js']
URL='https://claude.ai/chat/11111111-1111-4111-8111-111111111111'
HTML='''<!doctype html><meta charset="utf-8"><style>
body{margin:20px}div,fieldset,main{min-height:12px}button{min-width:32px;min-height:28px}
[contenteditable]{display:block;width:400px;min-height:40px}[hidden]{display:none!important}
[role=dialog]{position:fixed;inset:20px;background:white}[data-cds=FileUpload]{min-height:80px}
input[type=file]{position:absolute;width:1px;height:1px;opacity:0}
</style><main><div data-testid="chat-column" data-conversation-id="11111111-1111-4111-8111-111111111111">
<div class="relative flex min-w-0 flex-col gap-xs"><div id="_r_user_"><div class="cds-user-message-body"><div data-testid="user-message">Owned original prompt</div></div></div></div>
<div class="contents"><div class="mt-xs"><div class="group group/message-row"><div data-testid="assistant-message" data-is-streaming="false" data-turn-key="22222222-2222-4222-8222-222222222222"><p>Owned response</p></div></div></div></div>
<fieldset><div class="flex w-full min-w-0 flex-col"><input type="file" id="chat-input-file-upload-onpage" data-testid="file-upload" accept="" multiple aria-hidden="true">
<div data-cds="ChatComposer" class="flex w-full min-w-0 flex-col"><div data-testid="chat-input" contenteditable="true" role="textbox"></div>
<div data-cds="ChatComposerActions"><button type="button" id="own-attach" data-testid="chat-input-attach">Attach</button><button type="button" data-cds="Button" aria-label="Включить голосовой режим">Voice</button><button type="button" data-testid="chat-input-send" aria-label="Отправить сообщение" disabled>Send</button></div></div></div></fieldset></div></main>'''

FIXTURE=r'''(() => {
 globalThis.T={requests:[],uploads:0,commits:0,ready:0,sendClicks:0,nativeClicks:0,payload:'Complete harmless offline file\nEND\n',filename:'B02_OFFLINE_OWNER.txt',variant:globalThis.TEST_VARIANT,stage:globalThis.TEST_STAGE,done:false};
 T.root=document.querySelector('[data-testid="chat-column"]');T.editor=document.querySelector('[data-testid="chat-input"]');T.actions=document.querySelector('[data-cds="ChatComposerActions"]');T.composer=T.editor.closest('[data-cds="ChatComposer"]');
 T.mutate=stage=>{
  if(T.done||T.stage!==stage)return;T.done=true;
  const v=T.variant;
  if(v==='route')history.replaceState(null,'','/chat/33333333-3333-4333-8333-333333333333');
  if(v==='root')T.root.replaceWith(T.root.cloneNode(true));
  if(v==='editor')T.editor.replaceWith(T.editor.cloneNode(true));
  if(v==='editor_parent'){const x=document.createElement('div');T.editor.replaceWith(x);x.append(T.editor)}
  if(v==='actions')T.actions.replaceWith(T.actions.cloneNode(true));
  if(v==='user_native')document.querySelector('#_r_user_').id='_r_other_';
  if(v==='user_text')document.querySelector('[data-testid="user-message"]').textContent='Foreign prompt';
  if(v==='assistant_native')document.querySelector('[data-testid="assistant-message"]').setAttribute('data-turn-key','44444444-4444-4444-8444-444444444444');
  if(v==='assistant_node'){const a=document.querySelector('[data-testid="assistant-message"]');a.replaceWith(a.cloneNode(true))}
  if(v==='extra_message'){const u=document.querySelector('[data-testid="user-message"]').parentElement.parentElement.parentElement;T.root.prepend(u.cloneNode(true))}
  if(v==='remove_message')document.querySelector('[data-testid="assistant-message"]').remove();
  if(v==='hidden_history')document.querySelector('[data-testid="user-message"]').hidden=true;
  if(v==='explicit')T.root.setAttribute('data-conversation-id','55555555-5555-4555-8555-555555555555');
  if(v==='draft')T.editor.textContent='OWNER_DRAFT';
  if(v==='duplicate_editor')T.composer.append(T.editor.cloneNode(true));
  if(v==='foreign_dialog'){const d=document.createElement('div');d.setAttribute('role','dialog');d.textContent='Foreign modal';document.body.append(d)}
  if(v==='dialog_replace'){const d=document.querySelector('[role="dialog"]');if(d)d.replaceWith(d.cloneNode(true))}
  if(v==='input_replace'){const i=document.querySelector('[data-cds="FileUpload"] input');if(i)i.replaceWith(i.cloneNode(true))}
  if(v==='input_disabled'){const i=document.querySelector('[data-cds="FileUpload"] input');if(i)i.disabled=true}
  if(v==='input_duplicate'){const i=document.querySelector('[data-cds="FileUpload"] input');if(i)i.parentElement.append(i.cloneNode(true))}
  if(v==='widget_hidden'){const w=document.querySelector('[data-cds="FileUpload"]');if(w)w.hidden=true}
  if(v==='actor'){T.expectedActor='FOREIGN_ACTOR';T.revoked=true;}
  if(v==='runtime')T.consumer.runtime.dispose();
 };
 T.editor.addEventListener('input',()=>{document.querySelector('[data-testid="chat-input-send"]').disabled=!T.editor.textContent});
 document.querySelector('[data-testid="chat-input-send"]').addEventListener('click',()=>T.sendClicks++);
 function buildWidget(dialog){
  const group=document.createElement('div');group.setAttribute('role','group');group.setAttribute('data-cds','FileUpload');
  group.innerHTML='<input type="file" multiple aria-hidden="true"><button type="button" data-cds="Button">Выбрать файлы</button>';dialog.append(group);
  group.querySelector('input').addEventListener('change',e=>{
   T.uploads++;const file=e.target.files[0];T.fileBytes=file?.size;T.fileName=file?.name;
   dialog.remove();T.editor.removeAttribute('aria-hidden');T.actions.removeAttribute('aria-hidden');
   const branch=document.createElement('div');branch.setAttribute('data-cds-composer-attachments','');
   branch.innerHTML='<div data-cds="MessageAttachmentsFile" data-testid="file-thumbnail"><span data-cds="CardLink" role="button" tabindex="0"></span><span data-cds="Badge">TXT</span><button data-cds-attachment-remove></button></div>';
   branch.querySelector('[data-cds="CardLink"]').setAttribute('title',file.name);branch.querySelector('[data-cds-attachment-remove]').setAttribute('aria-label','Удалить: '+file.name);T.composer.append(branch);
   document.querySelector('[data-testid="chat-input-send"]').disabled=false;T.mutate('after_upload');
  });
 }
 document.querySelector('#own-attach').addEventListener('click',()=>{
  T.nativeClicks++;const create=()=>{
   const menu=document.createElement('div');menu.setAttribute('role','menu');menu.setAttribute('data-perf-overlay','composer_add_menu');menu.setAttribute('aria-labelledby','own-attach');document.body.append(menu);
   const addItem=()=>{const item=document.createElement('div');item.setAttribute('role','menuitem');item.setAttribute('data-testid','add-menu-upload-file');item.textContent='Upload';menu.append(item);
    item.addEventListener('click',()=>{T.nativeClicks++;menu.remove();const d=document.createElement('div');d.setAttribute('role','dialog');d.setAttribute('data-cds','Dialog');d.setAttribute('data-perf-overlay','composer_radiant_pine_dialog');document.body.append(d);T.editor.setAttribute('aria-hidden','true');T.actions.setAttribute('aria-hidden','true');
     if(T.variant==='delayed_widget')setTimeout(()=>buildWidget(d),80);else buildWidget(d);T.mutate('modal');});};
   if(T.variant==='delayed_item')setTimeout(addItem,80);else addItem();};
  if(T.variant==='delayed_menu')setTimeout(create,80);else create();
 });
 globalThis.chrome={runtime:{lastError:null,connect(){let callback;return {onMessage:{addListener(fn){callback=fn}},onDisconnect:{addListener(){}},disconnect(){},postMessage(message){
  const a=OzonAIAdapters.adapterForLocation(),here=SellerAgentsConversationSurface.read(a),masked=!!document.querySelector('[role="dialog"][data-perf-overlay="composer_radiant_pine_dialog"]');
  T.requests.push({type:message.type,liveOwner:message.live_owner,actor:message.actor_id||null,masked,identity:here.status,composer:!!a.composerContext(),sendAvailable:!!a.sendButton(a.composerContext())});
  let response;T.expectedActor ||= message.actor_id;
  if(T.revoked||!T.initial||here.status!=='confirmed'||message.live_owner?.origin!==T.initial.origin||message.live_owner?.conversation_id!==T.initial.conversation_id||message.actor_id&&message.actor_id!==T.expectedActor)response={ok:false,code:'SYNTHETIC_OWNER_MISMATCH'};
  else if(message.type==='OZ_ATTACHMENT_COMMIT'){T.commits++;T.mutate('commit');response=T.variant==='commit_denied'?{ok:false,code:'SYNTHETIC_COMMIT_DENIED'}:T.variant==='commit_unknown'?{ok:true,attach_allowed:false}:{ok:true,attach_allowed:true,recovery:{...T.recovery,delivery_phase:'attachment_committed'}}}
  else if(message.type==='OZ_ATTACHMENT_ARTIFACT_META'){T.mutate('meta');response={ok:true,descriptors:[T.descriptor]}}
  else if(message.type==='OZ_ATTACHMENT_ARTIFACT_CHUNK')response={ok:true,offset:0,total_byte_length:T.bytes.length,byte_length:T.bytes.length,chunk_base64:btoa(T.variant==='bad_hash'?T.payload.replace('C','X'):T.payload)};
  else if(message.type==='OZ_ATTACHMENT_RECOVERY_GET'){T.mutate('recovery');response={ok:true,recovery:{...T.recovery,delivery_phase:'attachment_committed'}}}
  else if(message.type==='OZ_ATTACHMENT_READY'){T.ready++;response={ok:true,ready:true,recovery:{...T.recovery,delivery_phase:'attachment_ready'}}}
  else response={ok:false,code:'SYNTHETIC_UNEXPECTED_REQUEST_NO_SEND'};
  queueMicrotask(()=>callback({kind:'response',request_id:message.request_id,response}));
 }}}}};
})()'''
SETUP=r'''(async()=>{
 const a=OzonAIAdapters.adapterForLocation();T.initial=await SellerAgentsConversationSurface.ready(a);T.bytes=new TextEncoder().encode(T.payload);
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',T.bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 T.descriptor={artifact_key:'offline-owned-artifact',filename:T.filename,byte_length:T.bytes.length,sha256:sha,mime_type:'text/plain'};
 T.recovery={owner_kind:'work',owner_id:'OWN_TEST_WORK',operation_id:'OWN_OP',run_id:'',delivery_id:'OWN_DELIVERY',adapter_id:'claude',origin:T.initial.origin,conversation_id:T.initial.conversation_id,conversation_key:T.initial.origin+'|'+T.initial.conversation_id,delivery_mode:'attachment_watch_v1',delivery_phase:'attachment_claimed',outgoing_text:'OWN_SAFE_MARKER',artifact_descriptors:[T.descriptor]};
 return T.initial;
})()'''
RUN=r'''(async()=>{
 let error=null,phase=null;try{phase=(await T.consumer.attachClaimed(T.recovery))?.delivery_phase||null}catch(e){error=e.code||e.message}
 const a=OzonAIAdapters.adapterForLocation(),c=a.composerContext();
 return {error,phase,uploads:T.uploads,commits:T.commits,ready:T.ready,sendClicks:T.sendClicks,nativeClicks:T.nativeClicks,requests:T.requests,initial:T.initial,final:SellerAgentsConversationSurface.read(a),fileName:T.fileName||null,fileBytes:T.fileBytes||null,markerExact:c?OzonAIAdapters.readComposerText(c.composer)===T.recovery.outgoing_text:false};
})()'''
CASES=[(x,'',True) for x in ['normal','delayed_menu','delayed_item','delayed_widget']]
CASES += [(x,'modal',False) for x in ['route','root','editor','editor_parent','actions','user_native','user_text','assistant_native','assistant_node','extra_message','remove_message','hidden_history','explicit','draft','duplicate_editor','foreign_dialog','input_disabled','input_duplicate','widget_hidden']]
CASES += [(x,'commit',False) for x in ['route','user_text','assistant_native','input_replace','dialog_replace','draft','actor']]
CASES += [('runtime','meta',False),('route','after_upload',False)]
CASES += [(x,'',False) for x in ['commit_denied','commit_unknown','bad_hash']]
assert len(CASES)==35

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
async def main(args):
 runtime=Path(args.runtime).resolve();output=Path(args.output).resolve();output.parent.mkdir(parents=True,exist_ok=True)
 if output.exists():raise RuntimeError('Result already exists; inspect outcome before any repeated operation')
 scripts=[(runtime/n).read_text() for n in MODULES];attach=(runtime/'attachment_delivery_port_content.js').read_text()
 anchor='  runtime.recoverCurrent = recoverCurrent;'
 if attach.count(anchor)!=1:raise RuntimeError('Exact test export anchor is not unique')
 consumer=attach.replace(anchor,'  globalThis.T.consumer={attachClaimed,liveOwnerBinding,sameConversation,runtime};\n'+anchor)
 result={'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'level':'OFFLINE_REAL_CLAUDE_ADAPTER_TRACKER_ATTACHCLAIMED_REQUEST_WITH_SYNTHETIC_WORKER','inputs':{n:sha(runtime/n) for n in MODULES+['attachment_delivery_port_content.js']},'test_sha256':sha(Path(__file__)),'external_requests':0,'live_profile_used':False,'results':[]}
 async with async_playwright() as pw:
  options={'headless':True,'args':['--no-sandbox']}
  if args.browser:options['executable_path']=args.browser
  browser=await pw.chromium.launch(**options);result['browser']=browser.version
  try:
   selected=[case for case in CASES if not args.case or case[0]+'@'+(case[1] or 'default') in args.case]
   if not selected:raise RuntimeError('No requested cases exist')
   result['selected_cases']=[v+'@'+(st or 'default') for v,st,_ in selected]
   for variant,stage,positive in selected:
    case_id=variant+'@'+(stage or 'default');context=await browser.new_context(service_workers='block')
    async def route(request):
     if request.request.is_navigation_request() and request.request.url==URL:await request.fulfill(status=200,content_type='text/html',body=HTML)
     else:await request.abort()
    await context.route('**/*',route);page=await context.new_page();row={'id':case_id,'expects_ready':positive}
    try:
     await page.goto(URL,wait_until='domcontentloaded',timeout=5000);await page.evaluate('globalThis.TEST_VARIANT='+json.dumps(variant)+';globalThis.TEST_STAGE='+json.dumps(stage))
     await page.evaluate('\n;\n'.join(scripts));await page.evaluate(FIXTURE);await page.evaluate(consumer)
     await page.evaluate('clearTimeout(T.consumer.runtime.startup_timer);T.consumer.runtime.startup_timer=null;')
     initial=await page.evaluate(SETUP)
     if initial['status']!='confirmed':raise RuntimeError('Fixture did not establish a real confirmed conversation: '+json.dumps(initial))
     value=await asyncio.wait_for(page.evaluate(RUN),timeout=8);row['actual']=value
     masked=[x for x in value['requests'] if x['masked']]
     common=value['sendClicks']==0 and value['uploads']<=1 and value['commits']<=1
     if positive:
      good=common and value['phase']=='attachment_ready' and value['error'] is None and value['ready']==1 and value['uploads']==1 and value['markerExact'] and bool(masked) and all(x['identity']=='confirmed' and not x['composer'] and not x['sendAvailable'] for x in masked) and value['initial']['conversation_id']==value['final']['conversation_id']
     else:good=common and value['phase']!='attachment_ready' and value['ready']==0 and value['uploads']<=(1 if stage=='after_upload' else 0)
     row['status']='PASS' if good else 'FAIL'
    except Exception as error:row.update(status='HARNESS_ERROR',error=type(error).__name__+': '+str(error)[:1200])
    finally:await context.close()
    result['results'].append(row);output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'id':case_id,'status':row['status'],'error':row.get('actual',{}).get('error',row.get('error'))}),flush=True)
  finally:await browser.close()
 result['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();result['summary']={status:sum(x['status']==status for x in result['results']) for status in ['PASS','FAIL','HARNESS_ERROR']};result['all_cases_executed']=len(result['results'])==len(selected)
 output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('SUMMARY',json.dumps(result['summary']),'SHA256',sha(output),flush=True)
 return 0 if all(x['status']=='PASS' for x in result['results']) else 1
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--runtime',required=True);parser.add_argument('--output',required=True);parser.add_argument('--browser');parser.add_argument('--case',action='append');args=parser.parse_args();sys.exit(asyncio.run(main(args)))
