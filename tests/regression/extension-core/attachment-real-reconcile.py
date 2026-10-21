#!/usr/bin/env python3
"""B02 actual sent-card readers -> committed attachment recovery, offline only.
Reuse accepted fixtures and exact Work/dot visible markup. Only worker port
acknowledgements are fake; no matcher/identity/controller is replaced.
No provider network, upload, Send, auth, execution or installed acceptance.
"""
import argparse
import ast
import hashlib
import json
from html import escape
from pathlib import Path
from playwright.sync_api import sync_playwright
HERE=Path(__file__).parent
TREE=ast.parse((HERE/"chatgpt-dom-compat.py").read_text())
D=Path("/root/octoport-control/testing/chromium-dot/dot-ai-snapshots")
REPORT="REPORT\nEND"
UUID="12345678-1234-4234-8234-123456789abc"

def definitions(nodes,names,env=None):
    """Reuse named pure fixture definitions without running an old suite."""
    scope={"escape":escape,**(env or {})};selected=[]
    for n in nodes:
        name=n.name if isinstance(n,ast.FunctionDef) else (
            n.targets[0].id if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) else "")
        if name in names:selected.append(n)
    assert len(selected)==len(names),(names,len(selected))
    exec(compile(ast.Module(body=selected,type_ignores=[]),str(HERE/"chatgpt-dom-compat.py"),"exec"),scope)
    return scope

def body(name):
    return next(n.body for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name==name)

def fixtures():
    rows={}
    def add(name,url,html,new,target="main",descriptors=None,text=REPORT):
        rows[name]=dict(provider="chatgpt" if name in ("standard","work","dot") else name,
            url=url,html="<main>"+html+"</main>",new=new,target=target,
            descriptors=descriptors or [{"filename":"report.txt","byte_length":16}],text=text)
    q=definitions(body("run_sent_attachment"),["qcard","quser","kcard","kuser","editor"],{"text":REPORT})
    add("qwen","https://chat.qwen.ai/c/"+UUID,q["editor"]()+q["quser"](ident="old"),q["quser"](ident="new"))
    add("kimi","https://www.kimi.ai/chat/"+UUID,q["kuser"](ident="old"),q["kuser"](ident="new"))
    g=definitions(body("run_gemini_adapter"),["button","voice","root","sent","pair"])
    add("gemini","https://gemini.google.com/app/"+UUID,g["root"]()+g["pair"](g["sent"](),"","old"),g["pair"](g["sent"](),"","new"))
    g=definitions(body("run_grok_adapter"),["button","voice","root","turn","filecard"])
    add("grok","https://grok.com/c/"+UUID,g["root"]()+g["turn"]("user","<p>REPORT</p><p>END</p>",g["filecard"],"response-old"),
        g["turn"]("user","<p>REPORT</p><p>END</p>",g["filecard"],"response-new"))
    loop=next(n for n in body("run_parent_roots") if isinstance(n,ast.For))
    choice=next(n for n in loop.body if isinstance(n,ast.If))
    arrow=definitions(TREE.body,["deepseek_send_arrow_fixture"])
    cards=definitions(loop.body,["dcard","ccard"])
    for name,branch in [("deepseek",choice.body),("claude",choice.orelse)]:
        f=definitions(branch,["user","assistant","composer","html"],arrow)
        if name=="deepseek":
            old=f["user"].replace('<div class="ds-collapsible-text">',cards["dcard"]+'<div class="ds-collapsible-text">')
            new=old;target=".ds-virtual-list-visible-items"
        else:
            old=f["user"].replace('<div role="article">','<div role="article">'+cards["ccard"])
            new=old.replace("_r_5u_","_r_reconcile_new_");target='[data-testid="chat-column"]'
        add(name,("https://chat.deepseek.com/a/chat/" if name=="deepseek" else "https://claude.ai/chat/")+UUID,
            f["html"].replace(f["user"],old),new,target,text="USER BODY")
    s=definitions(body("run_standard_sent"),["card","message","modern"],{"text":REPORT})
    add("standard","https://chatgpt.com/c/"+UUID,s["modern"]+s["message"](ident="old"),
        s["message"](ident="new",unit="fallback-turn-1:0:user"))
    a=definitions(body("run_alice_ready_sent"),["card","composer","message"],{"value":REPORT})
    add("alice","https://alice.yandex.ru/chat/"+UUID+"/",a["composer"]("")+a["message"](ident="old"),a["message"](ident="new"))
    w=json.loads((D/"WORK_CAPTURE_DOM_20261021T0205Z.json").read_text())
    d=json.loads((D/"DOT_CAPTURE_20261021T0209Z.json").read_text())
    add("work",w["url"],w["before"]["inputs"][7]["parent"],w["sent"]["dom"]["cards"][0][4]["html"],
        descriptors=[{"filename":"GPT_WORK_UI_20261021T0136Z.json","byte_length":8471},
                     {"filename":"DOT_UI_20261021T0141Z.json","byte_length":54659}],text=None)
    add("dot",d["url"],d["before"]["inputs"][0]["parent"],d["sentFinal"][0],
        descriptors=[{"filename":"B02_UPLOAD_STATE_20261020.txt","byte_length":158044}],text=d["testText"])
    rows["kimi"]["composer_only_html"]=definitions(body("run_kimi_adapter"),["editor"])["editor"]()
    return rows

def extract(source,name):
    needle="  function "+name+"("
    start=source.index(needle) if needle in source else source.index("  async function "+name+"(")
    return source[start:source.index("\n",start)] if name in ("normalizeText","current","sleep","adapter") else source[start:source.index("\n  }\n",start)+5]

def run(runtime,output,selected):
    output.mkdir(parents=True,exist_ok=False)
    port=(runtime/"attachment_delivery_port_content.js").read_text()
    names=["current","sleep","normalizeText","adapter","identity","conversationKey","sameConversation","ownerPayload",
           "assistantTurnIds","matchingNewUserTurn","waitMatchingUserTurn","failDelivery","reconcileSendCommitted","processRecovery"]
    helpers="\n".join(extract(port,name) for name in names)
    scripts={p:(runtime/p).read_text() for p in ["shared/conversation_identity.js","shared/web_file_attachment.js",
                                               "shared/ai_delivery_capabilities.js","shared/ai_adapters.js"]}
    probe="""async ([f,variant,helpers])=>{
      const a=OzonAIAdapters.ADAPTERS[f.provider],requests=[],statuses=[];
      const RUNTIME_KEY='__B02_RECONCILE_OFFLINE__',runtime={disposed:false,in_flight:new Set()};
      globalThis[RUNTIME_KEY]=runtime;
      // Test-only bounded poll time; the product source is unchanged.
      const SEND_RECONCILE_TIMEOUT_MS=50;
      function status(...args){statuses.push(args);}
      async function request(type,payload){
        requests.push({type,payload});
        if(type==='OZ_ATTACHMENT_CONFIRM')return {ok:true,confirmed:true};
        if(type==='OZ_ATTACHMENT_FAIL')return {ok:true};
        throw Error('Unexpected transport operation '+type);
      }
      const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
      return await new AsyncFunction('a','f','variant','requests','statuses','RUNTIME_KEY','runtime',
        'SEND_RECONCILE_TIMEOUT_MS','status','request',helpers+`
        let clickCount=0;document.addEventListener('click',()=>clickCount++);
        // Mount an older otherwise identical Work/dot own turn before baseline.
        if(['work','dot'].includes(f.surface)){
          const t=document.createElement('template');t.innerHTML=f.new;const old=t.content;
          for(const n of old.querySelectorAll('[data-chatgpt-search-message-ids]'))
            n.setAttribute('data-chatgpt-search-message-ids','offline-old-message');
          for(const n of old.querySelectorAll('[data-chatgpt-search-unit-key],[data-content-search-unit-key]'))
            for(const k of ['data-chatgpt-search-unit-key','data-content-search-unit-key'])
              if(n.hasAttribute(k))n.setAttribute(k,n.getAttribute(k).replace(/fallback-turn-[^:]+/,'offline-old-turn'));
          if(f.surface==='dot'){
            for(const n of old.querySelectorAll('[data-message-id]'))n.setAttribute('data-message-id','offline-old-message');
            old.querySelector('.message-text').setAttribute('data-content-search-unit-key','offline-old-message:message');
          }
          document.querySelector(f.target).append(old);
        }
        const before=await SellerAgentsConversationSurface.ready(a);
        if(before.status!=='confirmed')throw Error('Fixture initial identity '+JSON.stringify(before));
        const baseline=a.userMessages().map(n=>a.messageId(n));
        if(!baseline.length||baseline.some(x=>!x))throw Error('Missing real baseline');
        let actualText=f.text;
        if(actualText===null){
          const sent=a.sentAttachmentMessage(a.userMessages()[0],f.descriptors);
          if(!sent)throw Error('Accepted Work fixture did not expose sent reader');
          actualText=sent.text;
        }
        const recovery={owner_kind:'work',owner_id:'offline-owner',delivery_id:'offline-delivery',
          adapter_id:a.id,delivery_mode:'attachment_watch_v1',delivery_phase:'attachment_send_committed',
          origin:before.origin,conversation_id:before.conversation_id,conversation_key:conversationKey(),
          store_id:'offline-store',marketplace:'ozon',outgoing_text:actualText,
          artifact_descriptors:structuredClone(f.descriptors),baseline_user_turn_ids:baseline};
        if(!['baseline_only','composer_only'].includes(variant))document.querySelector(f.target).insertAdjacentHTML('beforeend',f.new);
        if(variant==='wrong_filename')recovery.artifact_descriptors[0].filename='other-file-same-count.txt';
        if(variant==='wrong_body')recovery.outgoing_text='Different body, same file';
        if(variant==='composer_only'){
          const fragment=document.createElement('template');fragment.innerHTML=f.new;
          const card=fragment.content.querySelector(f.cardSelector),target=a.composerContext()?.root;
          if(!card||!target)throw Error('Fixture card/composer not found '+f.surface);
          target.append(card);
        }
        if(variant==='other_context')recovery.conversation_id='different-original-dialogue';
        const expectedNew=a.userMessages().map(n=>a.messageId(n)).filter(id=>id&&!baseline.includes(id));
        const result=await processRecovery(recovery);
        const confirms=requests.filter(r=>r.type==='OZ_ATTACHMENT_CONFIRM'),fails=requests.filter(r=>r.type==='OZ_ATTACHMENT_FAIL');
        if(variant==='new_owned'){
          if(!result.ok||!result.confirmed||confirms.length!==1||fails.length)throw Error('Expected one confirmation '+JSON.stringify({result,requests}));
          if(expectedNew.length!==1||confirms[0].payload.confirmed_user_turn_id!==expectedNew[0])throw Error('Confirmation is not the single new owned turn');
          if(confirms[0].payload.owner_id!==recovery.owner_id||confirms[0].payload.delivery_id!==recovery.delivery_id)throw Error('Owner/delivery payload lost');
        }else{
          if(result.ok||confirms.length)throw Error('False sent confirmation '+JSON.stringify({result,requests}));
          const expected=variant==='other_context'?'ATTACHMENT_RECOVERY_CONTEXT_MISMATCH':'ATTACHMENT_SEND_OUTCOME_UNKNOWN_NO_RETRY';
          if(result.code!==expected||fails.length!==(variant==='other_context'?0:1))throw Error('Wrong failure '+JSON.stringify({result,requests}));
        }
        if(clickCount||requests.some(r=>!['OZ_ATTACHMENT_CONFIRM','OZ_ATTACHMENT_FAIL'].includes(r.type)))throw Error('Committed outcome was retried');
        if(runtime.in_flight.size)throw Error('In-flight claim leaked');
        return {result,baseline_count:baseline.length,new_turn_count:expectedNew.length,confirms:confirms.length,
          fail_records:fails.length,clicks:clickCount,requests:requests.map(r=>r.type),identity_scope:before.identity_scope,
          matcher:a.sentAttachmentMessage.name||'provider-owned reader'};
        `)(a,f,variant,requests,statuses,RUNTIME_KEY,runtime,SEND_RECONCILE_TIMEOUT_MS,status,request);
    }"""
    all_fixtures=fixtures()
    card_selectors=dict(qwen=".fileitem-btn",kimi=".attachment-list-file",gemini="user-query-file-preview",
        grok='button[aria-label="Открыть вложение"]',deepseek=".eafda4ae",claude='[data-testid="file-thumbnail"]',
        standard='span[class~="group/resource-card"]',alice=".MessageAttachedFiles",work='span[class~="group/resource-card"]',dot=".attachment-list")
    result=dict(status="RUNNING",scope="Real adapter/card -> committed processRecovery; offline only. Mocked worker acknowledgements, no Send/byte identity/installed acceptance.",
        runtime_sha256={p:hashlib.sha256(s.encode()).hexdigest() for p,s in scripts.items()},port_sha256=hashlib.sha256(port.encode()).hexdigest(),
        fixture_source_sha256=hashlib.sha256((HERE/"chatgpt-dom-compat.py").read_bytes()).hexdigest(),
        test_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),cases={})
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        context=browser.new_context(viewport={"width":1100,"height":800},service_workers="block")
        context.route("**/*",lambda route:route.fulfill(status=200,content_type="text/html",body="<html></html>"))
        page=context.new_page()
        for surface,f in all_fixtures.items():
            f.update(surface=surface,cardSelector=card_selectors[surface])
            for variant in ["new_owned","wrong_filename","baseline_only","composer_only","wrong_body","other_context"]:
                key=surface+"_"+variant
                if selected and key not in selected:continue
                try:
                    page.goto(f["url"])
                    page.set_content('<style>[hidden]{display:none!important}.A11yHidden{display:none}button,textarea{min-width:20px;min-height:20px}svg{max-width:24px;max-height:24px}</style>'+f["html"])
                    if variant=="composer_only" and f.get("composer_only_html"):page.locator("main").evaluate("(n,html)=>n.insertAdjacentHTML('beforeend',html)",f["composer_only_html"])
                    for script in scripts.values():page.evaluate(script)
                    actual=page.evaluate(probe,[f,variant,helpers])
                    result["cases"][key]={"status":"PASS","actual":actual}
                except Exception as e:result["cases"][key]={"status":"FAIL","error":str(e)[:2400]}
                (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
        browser.close()
    if selected:assert set(result["cases"])==set(selected)
    failed=[n for n,v in result["cases"].items() if v["status"]!="PASS"]
    result.update(status="FAIL" if failed else "PASS",case_count=len(result["cases"]),failed=failed)
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"case_count":len(result["cases"]),"failed":failed}))
    return int(bool(failed))

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--runtime",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--cases",default="")
    args=parser.parse_args()
    raise SystemExit(run(args.runtime,args.output,set(args.cases.split(",")) if args.cases else None))
