"""Focused Chromium regression for ChatGPT assistant/code ownership compatibility.
Synthetic DOM only: no live ChatGPT, marketplace, auth or installed-browser acceptance.
"""
from pathlib import Path
import argparse,hashlib,json
from playwright.sync_api import sync_playwright


def run_kimi(runtime: Path, output: Path):
    """Kimi reader only, from observed 19 Oct final/reasoning parent chains."""
    from html import escape
    output.mkdir(parents=True, exist_ok=True)
    source = (runtime / "shared/ai_adapters.js").read_text()
    identity_source = (runtime / "shared/conversation_identity.js").read_text()
    result = {"status": "RUNNING", "scope": "offline Kimi final-code reader; no provider calls",
              "source_sha256": hashlib.sha256(source.encode()).hexdigest(), "cases": {}}
    def block(value, attrs=""):
        return '<div class="segment-code"><div class="syntax-highlighter light segment-code-content"><pre '+attrs+'><code>'+escape(value)+'</code></pre></div></div>'
    def final(value, attrs=""):
        return '<div class="toolcall-rollup__part toolcall-rollup__flat"><div class="markdown-container"><div class="markdown">'+block(value, attrs)+'</div></div></div>'
    def assistant(body, ident="a1"):
        return '<div class="chat-content-item chat-content-item-assistant" data-archer-id="'+ident+'">'+body+'</div>'
    def reasoning(value):
        return '<div class="thinking-container"><div class="markdown-container toolcall-content-text">'+block(value)+'</div></div>'
    long_text = "\n".join(f"{n:03} " + ("BEGIN_KIMI_UI" if n == 1 else "END_KIMI_UI" if n == 120 else "neutral") for n in range(1, 121))
    cases = {
        "observed_final_excludes_duplicate_reasoning": (assistant(reasoning('console.log("OCTOPORT_UI");')+reasoning("ALPHA\nBETA\nGAMMA")+final('console.log("OCTOPORT_UI");')+final("ALPHA\nBETA\nGAMMA")), ['console.log("OCTOPORT_UI");', "ALPHA\nBETA\nGAMMA"]),
        "long_120_lines_exact": (assistant(final(long_text)), [long_text]),
        "verbatim_whitespace_and_html_text": (assistant(final("  <tag>\n\tA\u00a0B\n")), ["  <tag>\n\tA\u00a0B\n"]),
        "outside_final_rollup_rejected": (assistant('<div class="markdown-container">'+block("BAD")+'</div>'), []),
        "toolcall_only_rejected": (assistant('<div class="toolcall-content-text">'+final("BAD")+'</div>'), []),
        "thinking_parent_rejected": ('<div class="thinking-container">'+assistant(final("BAD"))+'</div>', []),
        "user_message_rejected": ('<div class="chat-content-item chat-content-item-user">'+final("BAD")+'</div>', []),
        "assistant_nested_in_user_rejected": ('<div class="chat-content-item chat-content-item-user">'+assistant(final("BAD"))+'</div>', []),
        "nested_foreign_message_excluded": (assistant(final("OWN")+assistant(final("FOREIGN"),"nested")), ["OWN"]),
        "multiple_messages_order": (assistant(final("FIRST"),"a1")+assistant(final("SECOND"),"a2"), ["FIRST","SECOND"]),
        "hidden_ancestor_rejected": ('<div hidden>'+assistant(final("BAD"))+'</div>', []),
        "opacity_ancestor_rejected": ('<div style="opacity:0">'+assistant(final("BAD"))+'</div>', []),
        "aria_hidden_rejected": ('<div aria-hidden="true">'+assistant(final("BAD"))+'</div>', []),
        "editable_code_rejected": (assistant(final("BAD",'contenteditable="true"')), []),
        "plaintext_pre_rejected": (assistant(final("BAD",'contenteditable="plaintext-only"')), []),
        "plaintext_ancestor_rejected": ('<div contenteditable="plaintext-only">'+assistant(final("BAD"))+'</div>', []),
        "empty_editable_attribute_rejected": (assistant(final("BAD",'contenteditable=""')), []),
        "editable_code_child_rejected": (assistant(final("BAD").replace('<code>','<code contenteditable="plaintext-only">')), []),
        "editable_span_child_rejected": (assistant(final("BAD").replace('<code>BAD</code>','<code><span contenteditable="plaintext-only">BAD</span></code>')), []),
        "zero_size_pre_rejected": (assistant(final("BAD",'style="width:0;height:0;overflow:hidden"')), []),
        "ambiguous_direct_code_rejected": (assistant(final("BAD").replace("</code>","</code><code>OTHER</code>")), []),
    }
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body="<html><body></body></html>"))
            page.goto("https://www.kimi.ai/chat/fixture-a")
            for name, (markup, expected) in cases.items():
                page.set_content(markup)
                page.evaluate(identity_source)
                page.evaluate(source)
                actual = page.evaluate("""() => {
                    const reader = globalThis.SellerAgentsKimiCodeReader;
                    if (!reader) throw new Error("KIMI_READER_NOT_COMPOSED");
                    return reader.assistantMessages().flatMap(m => reader.findCodeBlocks(m).map(b => reader.readCodeText(b)));
                }""")
                assert actual == expected, (name, actual, expected)
                result["cases"][name] = {"status": "PASS", "blocks": len(actual)}
            mutations = {
                "detached_block_rejected": "b.remove()",
                "moved_into_reasoning_rejected": "const t=document.createElement('div');t.className='thinking-container';m.append(t);t.append(b)",
                "moved_to_other_message_rejected": "const n=m.cloneNode(false);n.setAttribute('data-archer-id','other');document.body.append(n);n.append(b.closest('.toolcall-rollup__flat'))",
                "code_node_replacement_rejected": "b.querySelector('code').replaceWith(b.querySelector('code').cloneNode(true))",
                "message_id_change_rejected": "m.setAttribute('data-archer-id','replacement')",
                "chat_path_change_rejected": "history.replaceState({},'', '/chat/fixture-b')",
                "new_hidden_parent_rejected": "m.style.display='none'",
            }
            for name, mutation in mutations.items():
                page.goto("https://www.kimi.ai/chat/fixture-a")
                page.set_content(assistant(final("CODE")))
                page.evaluate(identity_source)
                page.evaluate(source)
                actual = page.evaluate("""mutation => {
                    const r=SellerAgentsKimiCodeReader,m=r.assistantMessages()[0],b=r.findCodeBlocks(m)[0];
                    const before=r.readCodeText(b);
                    new Function('m','b', mutation)(m,b);
                    return {before,after:r.readCodeText(b),anchor:r.geometryAnchor(b)!==null};
                }""", mutation)
                assert actual == {"before":"CODE","after":"","anchor":False}, (name,actual)
                result["cases"][name] = {"status":"PASS"}
            # HTTP loopback is a secure browser context, so the full bundle can
            # initialize Web Crypto while the reader still rejects this origin.
            for origin in ["https://kimi.ai", "https://www.kimi.ai.example.invalid", "http://localhost"]:
                page.goto(origin+"/chat/fixture-a")
                page.set_content(assistant(final("BAD")))
                page.evaluate(identity_source)
                page.evaluate(source)
                assert page.evaluate("SellerAgentsKimiCodeReader.assistantMessages().length") == 0, origin
            result["cases"]["exact_observed_origin_only"] = {"status":"PASS"}
            page.goto("https://www.kimi.ai/chat/fixture-a")
            page.set_content(assistant(final("globalThis.__kimiExecuted = true;")))
            page.evaluate(identity_source)
            page.evaluate(source)
            assert page.evaluate("""() => {
                const r=SellerAgentsKimiCodeReader,m=r.assistantMessages()[0],b=r.findCodeBlocks(m)[0];
                return r.readCodeText(b)==="globalThis.__kimiExecuted = true;" && globalThis.__kimiExecuted===undefined;
            }""")
            result["cases"]["read_never_executes_code"] = {"status":"PASS"}
        finally:
            browser.close()
    result["status"] = "PASS"
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":"PASS","scope":result["scope"],"cases":len(result["cases"])}))
    return 0

def run_kimi_adapter(runtime: Path, output: Path):
    """Kimi activation/delivery consumers; prior reader30 is not rerun."""
    from html import escape
    output.mkdir(parents=True, exist_ok=True)
    files = ["shared/conversation_identity.js", "shared/web_file_attachment.js",
             "shared/ai_delivery_capabilities.js", "shared/ai_adapters.js", "shared/bridge_autorun_model.js"]
    sources = [(name, (runtime/name).read_text()) for name in files]
    content = (runtime/"content_script.js").read_text()
    functions = []
    for name in ["primaryComposerContext", "allComposerControls", "sendButtonCandidates",
                 "sendButton", "stopButton", "recognizedSendControl", "classifyComposerControl"]:
        start = content.index("  function "+name+"(")
        end = content.index("\n  }\n", start)+5
        functions.append(content[start:end])
    consumers = "\n".join(functions)
    result = {"status":"RUNNING", "scope":"offline Kimi registry/delivery activation and existing consumer delegation; no live or installed UI",
              "source_sha256":{name:hashlib.sha256(s.encode()).hexdigest() for name,s in sources},
              "content_sha256":hashlib.sha256(content.encode()).hexdigest(), "cases":{}}
    style = '<style>.chat-input-editor{width:300px;min-height:24px}.send-button-container{width:28px;height:28px}.hidden-input{display:none}</style>'
    def editor(text="", control="disabled", extra="", input_attrs="multiple"):
        return '<div class="chat-editor" data-testid="chat-editor"><div class="chat-input-editor" role="textbox" contenteditable="true">'+escape(text)+'</div><input class="hidden-input" type="file" '+input_attrs+'><div id="send" class="send-button-container '+control+'"></div>'+extra+'</div>'
    def card(name="sample", state="success", ext="TXT"):
        return '<div data-testid="input-attachment-list"><div class="file-card-container normal '+state+'"><p class="file-card-info-name">'+name+'</p><span class="file-ext">'+ext+'</span><div class="file-card-delete"></div></div></div>'
    final = '<div class="toolcall-rollup__flat"><div class="markdown-container"><div class="segment-code"><div class="segment-code-content"><pre><code>FINAL</code></pre></div></div></div></div>'
    assistant = '<div class="chat-content-item chat-content-item-assistant" data-archer-id="a1"><div class="thinking-container"><div class="toolcall-content-text">THINKING</div></div>'+final+'</div>'
    user = '<div class="chat-content-item chat-content-item-user" data-archer-id="u1" data-conversation-turn-id="u1"><div class="segment-user">OWN TEXT</div></div>'
    probe = """() => {const a=OzonAIAdapters.ADAPTERS.kimi,c=a.composerContext(),s=a.classifyComposerControl(c);return {context:!!c,kind:s.kind,candidates:a.sendButtonCandidates(c).length,stop:s.kind==='stop',busy:a.isGenerating()};}"""
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.route("**/*", lambda route: route.fulfill(status=200,content_type="text/html",body="<html><body></body></html>"))
            def load(markup, url="https://www.kimi.ai/chat/1a15379f-7822-8bc6-8000-099708a3bddb"):
                page.goto(url)
                page.set_content(style+markup)
                for _,source in sources:
                    page.evaluate(source)
                assert page.evaluate("!!globalThis.SellerAgentsKimiAdapter && !!OzonAIAdapters.ADAPTERS.kimi"), "KIMI_ADAPTER_NOT_REGISTERED"
            def check(name, markup, expression, expected):
                load(markup)
                actual=page.evaluate(expression)
                assert actual==expected,(name,actual,expected)
                result["cases"][name]={"status":"PASS","actual":actual}
            def state(kind, context=True):
                return {"context":context,"kind":kind,"candidates":1 if kind=="send_active" else 0,"stop":False,"busy":kind=="busy"}
            check("independent_witnesses_and_effective_ui_guards",
                editor().replace('<input class="hidden-input" type="file" multiple>', '<fieldset disabled><input class="hidden-input" type="file" multiple></fieldset>')+
                user.replace('data-conversation-turn-id="u1"','data-conversation-turn-id="turn-independent"')+
                user.replace('data-archer-id="u1"','data-archer-id="edit1"').replace('data-conversation-turn-id="u1"','data-conversation-turn-id="edit1"').replace('<div class="segment-user">OWN TEXT</div>','<div class="segment-user" contenteditable="true">UNSENT EDIT</div>'),
                """() => {const a=OzonAIAdapters.ADAPTERS.kimi,first=document.querySelector('[data-archer-id="u1"]'),edit=document.querySelector('[data-archer-id="edit1"]');return {surface:!!a.attachmentSurface(),id:a.messageId(first),users:a.userMessages().map(n=>a.messageId(n)),editingText:a.messageText(edit)};}""",
                {"surface":False,"id":"u1","users":["u1"],"editingText":""})
            check("registered_with_reviewed_local_delivery",editor(),"""() => ({
                id:OzonAIAdapters.ADAPTERS.kimi.id,origin:OzonAIAdapters.ADAPTERS.kimi.matchesLocation(),
                mode:OzonAIAdapters.normalizeMode('kimi'),auto:OzonAIAdapters.adapterForLocation()?.id==='kimi',
                explicit:OzonAIAdapters.adapterForLocation('kimi')?.id==='kimi',
                capability:OzonAIDeliveryCapabilities.profile('kimi').status,
                fileAllowed:OzonAIDeliveryCapabilities.fileDispatchDecision('kimi',{filename:'sample.txt',byte_length:4}).dispatch_allowed
            })""",{"id":"kimi","origin":True,"mode":"kimi","auto":True,"explicit":True,"capability":"implemented","fileAllowed":True})
            check("local_txt_capability_matches_adapter",editor(),"""() => {
                const c=OzonAIDeliveryCapabilities,p=c.profile('kimi');
                const allowed=(filename,byte_length)=>c.fileDispatchDecision('kimi',{filename,byte_length}).dispatch_allowed;
                return {extensions:[...p.accepted_extensions],maxBytes:p.max_file_bytes,maxFiles:p.max_files_per_turn,strategy:p.attachment_strategy,
                    txt:allowed('result.txt',1024*1024),over:allowed('result.txt',1024*1024+1),pdf:allowed('result.pdf',12)};
            }""",{"extensions":["txt"],"maxBytes":1048576,"maxFiles":1,"strategy":"file_input_v1","txt":True,"over":False,"pdf":False})
            check("local_transport_cutoff_not_provider_limit",editor(),"""() => {
                const c=OzonAIDeliveryCapabilities,short=c.generatedTextDecision('kimi','x'.repeat(4096)),long=c.generatedTextDecision('kimi','x'.repeat(4097)),unicode=c.generatedTextDecision('kimi','😀'.repeat(2049));
                return {short:short.representation,long:long.representation,unicode:unicode.representation,metric:long.length_metric,status:long.threshold_status};
            }""",{"short":"plain_text","long":"text_document","unicode":"text_document","metric":"utf16_code_units","status":"conservative_transport_cutoff"})
            check("large_report_uses_complete_txt_same_run",editor(),"""() => {
                const text='BEGIN\\n'+'данные\\n'.repeat(1200)+'END';
                const before={origin:location.origin,conversation_id:'fixture-chat',status:'collecting',sequence:7};
                const run=BridgeAutorunModel.claimDelivery(before,{mode:'batch_watch_v1',deliveryId:'kimi-local-report',requestId:'local-request',outgoingText:text});
                const d=run.delivery,marker=JSON.parse(d.outgoing_text.split('\\n').slice(1).join('\\n'));
                return {origin:run.origin,chat:run.conversation_id,sequence:run.sequence,phase:d.phase,mode:d.mode,adapter:d.adapter_id,
                    complete:d.generated_text_document.complete,bytes:d.generated_text_document.byte_length===new TextEncoder().encode(text).byteLength,
                    retained:d.artifact_text===text,markerComplete:marker.complete,providerFiles:d.provider_file_refs.length};
            }""",{"origin":"https://www.kimi.ai","chat":"fixture-chat","sequence":7,"phase":"attachment_claimed","mode":"attachment_watch_v1","adapter":"kimi","complete":True,"bytes":True,"retained":True,"markerComplete":True,"providerFiles":0})
            for name,markup,kind in [
                ("idle_disabled_is_ready",editor(),"ready"),
                ("text_send_enabled",editor("HELLO",""),"send_active"),
                ("text_send_disabled",editor("HELLO"),"send_disabled"),
                ("empty_enabled_is_unknown",editor("",""),"unknown"),
                ("loading_is_busy_not_stop",editor("","loading",'<span class="send-loading"></span>'),"busy"),
                ("disabled_and_loading_still_busy",editor("","disabled loading"),"busy"),
                ("unready_upload_blocks_enabled_send",editor("","",card(state="loading")),"unknown"),
                ("success_card_allows_observed_send",editor("","",card()),"send_active"),
                ("two_cards_are_ambiguous",editor("","",card()+card()),"unknown"),
                ("pointer_events_disabled",editor("HELLO","").replace('id="send"','id="send" style="pointer-events:none"'),"send_disabled"),
                ("aria_disabled_control",editor("HELLO","").replace('id="send"','id="send" aria-disabled="true"'),"send_disabled"),
                ("duplicate_send_controls",editor("HELLO","",'<div class="send-button-container"></div>'),"unknown"),
                ("outside_send_is_ignored",editor()+ '<div class="send-button-container"></div>',"ready"),
                ("assistant_fake_send_is_ignored",editor(extra='<div class="chat-content-item chat-content-item-assistant"><div class="send-button-container"></div></div>'),"ready"),
            ]:
                check(name,markup,probe,state(kind))
            for name,markup in [
                ("multiple_editors_rejected",editor()+editor()),
                ("editor_in_user_message_rejected",'<div class="chat-content-item chat-content-item-user">'+editor()+'</div>'),
                ("nested_editor_root_rejected",'<div class="chat-editor" data-testid="chat-editor">'+editor()+'</div>'),
                ("dialog_editor_rejected",'<div role="dialog">'+editor()+'</div>'),
                ("hidden_editor_rejected",'<div hidden>'+editor()+'</div>'),
                ("transparent_ancestor_rejected",'<div style="opacity:0">'+editor()+'</div>'),
                ("aria_disabled_editor_rejected",editor().replace('role="textbox"','role="textbox" aria-disabled="true"')),
            ]:
                check(name,markup,probe,state("unknown",False))
            check("hidden_duplicate_does_not_replace_editor",'<div hidden>'+editor()+'</div>'+editor(),probe,state("ready"))
            for name,mutation in [
                ("old_context_replaced_root","c.root.replaceWith(c.root.cloneNode(true))"),
                ("old_context_changed_url","history.replaceState({},'', '/chat/other')"),
            ]:
                check(name,editor("HELLO",""),"() => {const a=OzonAIAdapters.ADAPTERS.kimi,c=a.composerContext();"+mutation+";return a.sendButton(c)===null && a.classifyComposerControl(c).kind==='unknown';}",True)
            check("composer_text_mutation_uses_existing_helper",editor(),"""() => {const a=OzonAIAdapters.ADAPTERS.kimi,c=a.composerContext();let inputs=0;c.composer.addEventListener('input',()=>inputs++);a.setComposerText(c.composer,'COPY ONLY');return {text:a.readComposerText(c.composer),inputs,sendClicks:document.querySelector('#send').dataset.clicked||null};}""",{"text":"COPY ONLY","inputs":1,"sendClicks":None})
            check("busy_cannot_mutate_composer",editor("OLD","loading"),"""() => {const a=OzonAIAdapters.ADAPTERS.kimi,c=a.composerContext();try{a.setComposerText(c.composer,'BAD')}catch(e){return {code:e.code,text:c.composer.textContent}}return null}""",{"code":"COMPOSER_NOT_AVAILABLE","text":"OLD"})
            check("message_reader_integrates_with_owned_final",editor()+user+assistant,"""() => {const a=OzonAIAdapters.ADAPTERS.kimi,m=a.assistantMessages()[0];return {users:a.userMessages().map(n=>a.messageId(n)),assistants:a.assistantMessages().map(n=>a.messageId(n)),text:a.messageText(m),code:a.findCodeBlocks(m).map(b=>a.readCodeText(b)),complete:a.messageComplete(m)};}""",{"users":["u1"],"assistants":["a1"],"text":"FINAL","code":["FINAL"],"complete":True})
            check("busy_final_is_incomplete",editor("","loading")+assistant,"() => OzonAIAdapters.ADAPTERS.kimi.messageComplete(document.querySelector('.chat-content-item-assistant'))",False)
            check("unknown_control_is_not_completion",editor("","")+assistant,"() => OzonAIAdapters.ADAPTERS.kimi.messageComplete(document.querySelector('.chat-content-item-assistant'))",False)
            check("independent_turn_marker_accepted",editor()+user.replace('data-conversation-turn-id="u1"','data-conversation-turn-id="different"'),"() => OzonAIAdapters.ADAPTERS.kimi.messageId(document.querySelector('.chat-content-item-user'))","u1")
            check("malformed_turn_witness_rejected",editor()+user.replace('data-conversation-turn-id="u1"','data-conversation-turn-id="bad turn"'),"() => OzonAIAdapters.ADAPTERS.kimi.messageId(document.querySelector('.chat-content-item-user'))","")
            check("duplicate_message_marker_rejected",editor()+user+user,"() => OzonAIAdapters.ADAPTERS.kimi.userMessages().map(n=>OzonAIAdapters.ADAPTERS.kimi.messageId(n))",["",""])
            check("origin_route_is_not_chat_identity",editor()+user,"""() => ({provider:BB2ConversationIdentity.providerForOrigin(location.origin),temporary:BB2ConversationIdentity.conversationIdFromPath('/chat/p930ba07'),unverified:BB2ConversationIdentity.resolve({origin:location.origin,pathname:location.pathname}).status})""",{"provider":"kimi","temporary":None,"unverified":"unknown"})
            for name,markup in [
                ("hidden_native_input_selected",editor()),
                ("input_disabled_rejected",editor(input_attrs="multiple disabled")),
                ("unexpected_accept_rejected",editor(input_attrs='multiple accept=".pdf"')),
                ("second_input_rejected",editor(extra='<input type="file">')),
                ("missing_multiple_rejected",editor(input_attrs="")),
                ("draft_blocks_attachment",editor("DRAFT","")),
                ("existing_card_blocks_second_attachment",editor("","",card())),
            ]:
                check(name,markup,"() => !!OzonAIAdapters.ADAPTERS.kimi.attachmentSurface()",name=="hidden_native_input_selected")
            ready_probe = "() => OzonAIAdapters.ADAPTERS.kimi.attachmentReady([{filename:'sample.txt',byte_length:85}])"
            for name,markup,expected in [
                ("ready_card_requires_success_and_name",editor("","",card()),True),
                ("uploading_not_ready_even_enabled",editor("","",card(state="loading")),False),
                ("missing_success_not_ready",editor("","",card(state="normal")),False),
                ("wrong_card_filename_rejected",editor("","",card(name="other")),False),
                ("wrong_card_extension_rejected",editor("","",card(ext="PDF")),False),
                ("busy_after_send_is_not_staged_ready",editor("","loading",card()),False),
                ("user_message_card_not_composer_preview",editor()+'<div class="chat-content-item chat-content-item-user">'+card()+'</div>',False),
            ]:
                check(name,markup,ready_probe,expected)
            load(editor())
            transferred=page.evaluate("""async () => {
                const a=OzonAIAdapters.ADAPTERS.kimi,s=a.attachmentSurface(),bytes=new Uint8Array(1024*1024);
                for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
                let inputs=0,changes=0,clicks=0;
                s.input.addEventListener('input',()=>inputs++);s.input.addEventListener('change',()=>changes++);
                document.querySelector('#send').addEventListener('click',()=>clicks++);
                a.attachFiles(s,[new File([bytes],'sample.txt',{type:'text/plain'})]);
                const read=new Uint8Array(await s.input.files[0].arrayBuffer());
                const hex=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),x=>x.toString(16).padStart(2,'0')).join('');
                let retry;try{a.attachFiles(s,[new File(['retry'],'sample.txt',{type:'text/plain'})])}catch(e){retry=e.code}
                return {sameBytes:bytes.length===read.length&&bytes.every((v,i)=>v===read[i]),sha256:await hex(read),originalSha256:await hex(bytes),inputs,changes,clicks,retry};
            }""")
            assert transferred["sameBytes"] and transferred["sha256"]==transferred["originalSha256"],transferred
            assert (transferred["inputs"],transferred["changes"],transferred["clicks"],transferred["retry"])==(1,1,0,"TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE"),transferred
            result["cases"]["native_input_1mib_exact_bytes_no_send_no_replay"]={"status":"PASS","actual":transferred}
            for name,files_expr in [
                ("pdf_rejected","[new File(['x'],'sample.pdf',{type:'application/pdf'})]"),
                ("over_1mib_rejected","[new File([new Uint8Array(1024*1024+1)],'sample.txt',{type:'text/plain'})]"),
                ("two_files_rejected","[new File(['x'],'a.txt'),new File(['y'],'b.txt')]"),
                ("wrong_mime_rejected","[new File(['x'],'sample.txt',{type:'application/octet-stream'})]"),
            ]:
                check(name,editor(),"() => {const a=OzonAIAdapters.ADAPTERS.kimi,s=a.attachmentSurface();let changes=0;s.input.addEventListener('change',()=>changes++);try{a.attachFiles(s,"+files_expr+")}catch(e){return {code:e.code,count:s.input.files.length,changes}}return null}",{"code":"TARGET_AI_FILE_TYPE_UNSUPPORTED","count":0,"changes":0})
            check("stale_attachment_surface_cannot_write",editor(),"""() => {const a=OzonAIAdapters.ADAPTERS.kimi,s=a.attachmentSurface();history.replaceState({},'', '/chat/other');try{a.attachFiles(s,[new File(['x'],'a.txt')])}catch(e){return {code:e.code,count:s.input.files.length}}return null}""",{"code":"TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE","count":0})
            load(editor("TEXT",""))
            delegated=page.evaluate("(function(){function currentAIAdapter(){return OzonAIAdapters.ADAPTERS.kimi;}"+consumers+"""const c=primaryComposerContext();return {root:c.root.dataset.testid,send:sendButton(c)?.id,candidates:sendButtonCandidates(c).length,controls:allComposerControls(c).map(n=>n.id),stop:stopButton(c)===null,recognized:recognizedSendControl(c)?.id,kind:classifyComposerControl().kind};})()""")
            assert delegated=={"root":"chat-editor","send":"send","candidates":1,"controls":["send"],"stop":True,"recognized":"send","kind":"send_active"},delegated
            result["cases"]["prepared_consumers_delegate_to_actual_kimi_adapter"]={"status":"PASS","actual":delegated}
            held=page.evaluate("(function(){function currentAIAdapter(){return OzonAIAdapters.adapterForLocation();}"+consumers+"return primaryComposerContext()?.root===document.querySelector('.chat-editor') && sendButtonCandidates(primaryComposerContext()).length===1 && classifyComposerControl().kind==='send_active';})()")
            assert held is True
            result["cases"]["ordinary_work_selection_uses_kimi_adapter"]={"status":"PASS"}
            for url in ["https://kimi.ai/chat/a","https://www.kimi.ai.example.invalid/chat/a","http://localhost/chat/a"]:
                load(editor("TEXT",""),url)
                assert page.evaluate("!OzonAIAdapters.ADAPTERS.kimi.matchesLocation() && OzonAIAdapters.ADAPTERS.kimi.composerContext()===null && OzonAIAdapters.adapterForLocation('kimi')===null"),url
            result["cases"]["exact_owner_approved_origin_only"]={"status":"PASS"}
        finally:
            browser.close()
    manifest=json.loads((runtime/"manifest.json").read_text())
    assert any("https://www.kimi.ai/*" in row.get("matches",[]) for row in manifest.get("content_scripts",[]))
    result["cases"]["composed_manifest_has_exact_kimi_origin"]={"status":"PASS"}
    result["status"]="PASS"
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":"PASS","scope":result["scope"],"cases":len(result["cases"])}))
    return 0



def run_sent_attachment(runtime: Path, output: Path):
    """S07/S08 ordinary offline DOM fixtures derived from accepted 19 Oct data.
    Qwen: S08.completed.dom.json user body/card/name/text classes.
    Kimi: S08.sent.dom.json attachment-list-file card + accepted user markers.
    This checks DOM recognition only: no provider Send or installed acceptance.
    """
    from html import escape
    output.mkdir(parents=True, exist_ok=True)
    files = ["shared/conversation_identity.js", "shared/web_file_attachment.js",
             "shared/ai_delivery_capabilities.js", "shared/ai_adapters.js"]
    sources = [(name, (runtime/name).read_text()) for name in files]
    port = (runtime/"attachment_delivery_port_content.js").read_text()
    start = port.index("  function matchingNewUserTurn(")
    matcher = port[start:port.index("\n  async function waitMatchingUserTurn(", start)]
    start = port.index("  function normalizeText(")
    normalize = port[start:port.index("\n", start)]
    result = {"status":"RUNNING", "scope":"S07/S08 offline sent-attachment recognition; Qwen/Kimi accepted structural fixtures; no Send",
              "source_sha256":{n:hashlib.sha256(s.encode()).hexdigest() for n,s in sources},
              "port_sha256":hashlib.sha256(port.encode()).hexdigest(), "cases":{}}
    text = "Отчёт\nEND"
    def qcard(name="report.txt"):
        stem,ext=name.rsplit(".",1)
        return '<div class="fileitem-btn"><button class="fileitem-main"><div class="fileitem-file-name"><div class="fileitem-file-name-text">'+escape(stem)+'</div><div class="fileitem-file-name-ext">.'+escape(ext)+'</div></div><div class="fileitem-file-size">1.0 MB</div></button><div class="fileitem-actions"><button>превью</button></div></div>'
    def quser(card=True,name="report.txt",ident="SENT",role="user"):
        return '<div class="qwen-chat-message qwen-chat-message-'+role+'"><div class="chat-user-message-container" data-msg-id="'+ident+'">'+(qcard(name) if card else '')+'<div class="chat-user-message"><p class="user-message-content">'+escape(text)+'</p></div><div class="user-message-footer"><button>Копировать</button></div></div></div>'
    def kcard(name="report.txt"):
        stem,ext=name.rsplit(".",1)
        return '<div class="attachment-list-file"><div class="file-card-container normal success"><div class="file-card-info"><p class="file-card-info-name">'+escape(stem)+'</p><div class="file-card-info-status"><div class="file-card-info-detail"><span class="file-ext">'+escape(ext.upper())+'</span><span class="file-size">1 MB</span></div></div></div></div></div>'
    def kuser(card=True,name="report.txt",ident="SENT",role="user"):
        return '<div class="chat-content-item chat-content-item-'+role+'" data-archer-id="'+ident+'" data-conversation-turn-id="'+ident+'"><div class="segment segment-'+role+'">'+(kcard(name) if card else '')+'<p>'+escape(text)+'</p></div></div>'
    def editor(spin=False,stop=False):
        return '<div class="message-input-container"><textarea class="message-input-textarea"></textarea><div class="file-card-list"><div class="fileitem-btn"><div class="fileitem-file-name">report.txt</div><div class="fileitem-icon-wrapper"><svg class="fileitem-icon"><use href="#qwenFileicon-txt1"></use></svg></div></div></div><div class="chat-prompt-send-button"><button class="'+('stop-button' if stop else 'send-button')+'" aria-label="'+('Стоп' if stop else 'Send')+'"></button></div>'+('<svg class="anticon-spin" width="10" height="10"></svg>' if spin else '')+'</div>'
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        try:
            page=browser.new_page()
            page.route("**/*",lambda route: route.fulfill(status=200,content_type="text/html",body="<html><body></body></html>"))
            def load(site,markup):
                origin="https://chat.qwen.ai" if site=="qwen" else "https://www.kimi.ai"
                page.goto(origin+"/chat/fixture")
                page.set_content('<style>textarea{width:300px;height:40px}.fileitem-btn,.file-card-container{min-height:30px}.segment-user{min-height:50px}</style>'+markup)
                for _,source in sources: page.evaluate(source)
            def record(name,fn,expected):
                try:
                    actual=fn()
                    assert actual==expected,(actual,expected)
                    result["cases"][name]={"status":"PASS","actual":actual}
                except Exception as error:
                    result["cases"][name]={"status":"FAIL","error":str(error)[:1000]}
            def match(site,markup,baseline=None,descriptors=None):
                load(site,markup)
                recovery={"outgoing_text":text,"delivery_id":"fixture-delivery",
                          "artifact_descriptors":descriptors if descriptors is not None else [{"filename":"report.txt","byte_length":4}]}
                return page.evaluate("([site,recovery,baseline])=>{function adapter(){return OzonAIAdapters.ADAPTERS[site];}"+normalize+"\n"+matcher+"\nreturn matchingNewUserTurn(new Set(baseline),recovery);}",[site,recovery,baseline or []])
            for site,user,card in [("qwen",quser,qcard),("kimi",kuser,kcard)]:
                record(site+"_new_user_file_and_text",lambda s=site,u=user:match(s,u()),"SENT")
                record(site+"_baseline_no_duplicate",lambda s=site,u=user:match(s,u(),["SENT"]),None)
                record(site+"_plain_text_without_file_not_sent",lambda s=site,u=user:match(s,u(card=False)),None)
                record(site+"_wrong_filename_not_sent",lambda s=site,u=user:match(s,u(name="other.txt")),None)
                record(site+"_assistant_file_not_user_sent",lambda s=site,u=user:match(s,u(role="assistant")),None)
                record(site+"_missing_descriptors_unknown",lambda s=site,u=user:match(s,u(),descriptors=[]),None)
                record(site+"_composer_only_not_user_sent",lambda s=site,c=card:match(s,'<div class="chat-editor" data-testid="chat-editor">'+c()+'</div>'),None)
            def ready(spin=False,stop=False):
                load("qwen",editor(spin,stop))
                return page.evaluate("OzonAIAdapters.ADAPTERS.qwen.attachmentReady([{filename:'report.txt',byte_length:4}])")
            record("qwen_ready_txt_icon",lambda:ready(),True)
            record("qwen_spinner_enabled_send_is_not_ready",lambda:ready(spin=True),False)
            record("qwen_stop_with_txt_icon_is_not_ready",lambda:ready(stop=True),False)
        finally:
            browser.close()
    failed=[name for name,row in result["cases"].items() if row["status"]=="FAIL"]
    result["status"]="FAIL" if failed else "PASS"
    result["failed"]=failed
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"scope":result["scope"],"cases":len(result["cases"]),"failed":failed},ensure_ascii=False))
    return 1 if failed else 0



def run_observed_readers(runtime: Path, output: Path):
    """S04-S06 offline fixtures: accepted code HTML plus observed role/parent chains.
    No activation, clipboard, provider requests, Send, execution or completion claim.
    """
    from html import escape
    from html.parser import HTMLParser
    output.mkdir(parents=True, exist_ok=True)
    fixtures = {'deepseek': {'html': ['<pre><span>OCTOPORT_UI_PROBE_V1 {&quot;case&quot;:&quot;single&quot;,&quot;value&quot;:17}</span></pre>', '<pre><span><span class="token punctuation">{</span></span>\n<span>  <span class="token property">&quot;case&quot;</span><span class="token operator">:</span> <span class="token string">&quot;multi&quot;</span><span class="token punctuation">,</span></span>\n<span>  <span class="token property">&quot;label&quot;</span><span class="token operator">:</span> <span class="token string">&quot;Тест ё 😀&quot;</span><span class="token punctuation">,</span></span>\n<span>  <span class="token property">&quot;values&quot;</span><span class="token operator">:</span> <span class="token punctuation">[</span><span class="token number">1</span><span class="token punctuation">,</span> <span class="token number">2</span><span class="token punctuation">,</span> <span class="token number">3</span><span class="token punctuation">]</span><span class="token punctuation">,</span></span>\n<span>  <span class="token property">&quot;literal&quot;</span><span class="token operator">:</span> <span class="token string">&quot;&lt;tag&gt; &amp; quote&quot;</span></span>\n<span><span class="token punctuation">}</span></span></pre>', '<pre><span>001 BEGIN</span>\n<span>002 LINE</span>\n<span>003 LINE</span>\n<span>004 LINE</span>\n<span>005 LINE</span>\n<span>006 LINE</span>\n<span>007 LINE</span>\n<span>008 LINE</span>\n<span>009 LINE</span>\n<span>010 LINE</span>\n<span>011 LINE</span>\n<span>012 LINE</span>\n<span>013 LINE</span>\n<span>014 LINE</span>\n<span>015 LINE</span>\n<span>016 LINE</span>\n<span>017 LINE</span>\n<span>018 LINE</span>\n<span>019 LINE</span>\n<span>020 LINE</span>\n<span>021 LINE</span>\n<span>022 LINE</span>\n<span>023 LINE</span>\n<span>024 LINE</span>\n<span>025 LINE</span>\n<span>026 LINE</span>\n<span>027 LINE</span>\n<span>028 LINE</span>\n<span>029 LINE</span>\n<span>030 LINE</span>\n<span>031 LINE</span>\n<span>032 LINE</span>\n<span>033 LINE</span>\n<span>034 LINE</span>\n<span>035 LINE</span>\n<span>036 LINE</span>\n<span>037 LINE</span>\n<span>038 LINE</span>\n<span>039 LINE</span>\n<span>040 LINE</span>\n<span>041 LINE</span>\n<span>042 LINE</span>\n<span>043 LINE</span>\n<span>044 LINE</span>\n<span>045 LINE</span>\n<span>046 LINE</span>\n<span>047 LINE</span>\n<span>048 LINE</span>\n<span>049 LINE</span>\n<span>050 LINE</span>\n<span>051 LINE</span>\n<span>052 LINE</span>\n<span>053 LINE</span>\n<span>054 LINE</span>\n<span>055 LINE</span>\n<span>056 LINE</span>\n<span>057 LINE</span>\n<span>058 LINE</span>\n<span>059 LINE</span>\n<span>060 LINE</span>\n<span>061 LINE</span>\n<span>062 LINE</span>\n<span>063 LINE</span>\n<span>064 LINE</span>\n<span>065 LINE</span>\n<span>066 LINE</span>\n<span>067 LINE</span>\n<span>068 LINE</span>\n<span>069 LINE</span>\n<span>070 LINE</span>\n<span>071 LINE</span>\n<span>072 LINE</span>\n<span>073 LINE</span>\n<span>074 LINE</span>\n<span>075 LINE</span>\n<span>076 LINE</span>\n<span>077 LINE</span>\n<span>078 LINE</span>\n<span>079 LINE</span>\n<span>080 LINE</span>\n<span>081 LINE</span>\n<span>082 LINE</span>\n<span>083 LINE</span>\n<span>084 LINE</span>\n<span>085 LINE</span>\n<span>086 LINE</span>\n<span>087 LINE</span>\n<span>088 LINE</span>\n<span>089 LINE</span>\n<span>090 LINE</span>\n<span>091 LINE</span>\n<span>092 LINE</span>\n<span>093 LINE</span>\n<span>094 LINE</span>\n<span>095 LINE</span>\n<span>096 LINE</span>\n<span>097 LINE</span>\n<span>098 LINE</span>\n<span>099 LINE</span>\n<span>100 LINE</span>\n<span>101 LINE</span>\n<span>102 LINE</span>\n<span>103 LINE</span>\n<span>104 LINE</span>\n<span>105 LINE</span>\n<span>106 LINE</span>\n<span>107 LINE</span>\n<span>108 LINE</span>\n<span>109 LINE</span>\n<span>110 LINE</span>\n<span>111 LINE</span>\n<span>112 LINE</span>\n<span>113 LINE</span>\n<span>114 LINE</span>\n<span>115 LINE</span>\n<span>116 LINE</span>\n<span>117 LINE</span>\n<span>118 LINE</span>\n<span>119 LINE</span>\n<span>120 END</span></pre>'], 'source': 'deepseek/20261019T055142Z/S06.completed.dom.json', 'sha256': '9d19445319d701e48d5a2ff6da1cbcbe15ef464251c92449ad5dd43f075184a8'}, 'claude': {'html': ['<pre class="code-block__code !my-0 !rounded-[var(--msg-block-radius,0.5rem)] !text-sm !leading-relaxed p-3.5"><code class="language-text" data-highlight="plain">OCTOPORT_UI_PROBE_V1 {&quot;case&quot;:&quot;single&quot;,&quot;value&quot;:17}</code></pre>', '<pre class="code-block__code !my-0 !rounded-[var(--msg-block-radius,0.5rem)] !text-sm !leading-relaxed p-3.5"><code class="language-json" data-highlight="final"><span class="block [unicode-bidi:inherit] [text-align:-webkit-match-parent] [text-align:match-parent]" data-code-line-group=""><span><span>{</span>\n</span><span>  <span>&quot;</span><span>case</span><span>&quot;</span><span>:</span> <span>&quot;multi&quot;</span><span>,</span>\n</span><span>  <span>&quot;</span><span>label</span><span>&quot;</span><span>:</span> <span>&quot;Тест ё 😀&quot;</span><span>,</span>\n</span><span>  <span>&quot;</span><span>values</span><span>&quot;</span><span>:</span> <span>[</span>\n</span><span>    <span>1</span><span>,</span>\n</span><span>    <span>2</span><span>,</span>\n</span><span>    <span>3</span>\n</span><span>  <span>],</span>\n</span><span>  <span>&quot;</span><span>literal</span><span>&quot;</span><span>:</span> <span>&quot;&lt;tag&gt; &amp; quote&quot;</span>\n</span><span><span>}</span></span></span></code></pre>', '<pre class="code-block__code !my-0 !rounded-[var(--msg-block-radius,0.5rem)] !text-sm !leading-relaxed p-3.5"><code class="language-text" data-highlight="plain">001 BEGIN\n002 LINE\n003 LINE\n004 LINE\n005 LINE\n006 LINE\n007 LINE\n008 LINE\n009 LINE\n010 LINE\n011 LINE\n012 LINE\n013 LINE\n014 LINE\n015 LINE\n016 LINE\n017 LINE\n018 LINE\n019 LINE\n020 LINE\n021 LINE\n022 LINE\n023 LINE\n024 LINE\n025 LINE\n026 LINE\n027 LINE\n028 LINE\n029 LINE\n030 LINE\n031 LINE\n032 LINE\n033 LINE\n034 LINE\n035 LINE\n036 LINE\n037 LINE\n038 LINE\n039 LINE\n040 LINE\n041 LINE\n042 LINE\n043 LINE\n044 LINE\n045 LINE\n046 LINE\n047 LINE\n048 LINE\n049 LINE\n050 LINE\n051 LINE\n052 LINE\n053 LINE\n054 LINE\n055 LINE\n056 LINE\n057 LINE\n058 LINE\n059 LINE\n060 LINE\n061 LINE\n062 LINE\n063 LINE\n064 LINE\n065 LINE\n066 LINE\n067 LINE\n068 LINE\n069 LINE\n070 LINE\n071 LINE\n072 LINE\n073 LINE\n074 LINE\n075 LINE\n076 LINE\n077 LINE\n078 LINE\n079 LINE\n080 LINE\n081 LINE\n082 LINE\n083 LINE\n084 LINE\n085 LINE\n086 LINE\n087 LINE\n088 LINE\n089 LINE\n090 LINE\n091 LINE\n092 LINE\n093 LINE\n094 LINE\n095 LINE\n096 LINE\n097 LINE\n098 LINE\n099 LINE\n100 LINE\n101 LINE\n102 LINE\n103 LINE\n104 LINE\n105 LINE\n106 LINE\n107 LINE\n108 LINE\n109 LINE\n110 LINE\n111 LINE\n112 LINE\n113 LINE\n114 LINE\n115 LINE\n116 LINE\n117 LINE\n118 LINE\n119 LINE\n120 END</code></pre>'], 'source': 'claude/20261019T062100Z/S06.completed.dom.json', 'sha256': 'c44c78cec06c9ceb320a86cceb054c982149eab60402205d468d65534ba01440'}, 'gemini': {'html': ['<pre _ngcontent-ng-c3582179313="" class="ng-tns-c3582179313-35"><code _ngcontent-ng-c3582179313="" role="text" data-test-id="code-content" class="code-container formatted ng-tns-c3582179313-35">OCTOPORT_UI_PROBE_V1 {&quot;case&quot;:&quot;single&quot;,&quot;value&quot;:17}\n</code></pre>', '<pre _ngcontent-ng-c3582179313="" class="ng-tns-c3582179313-36"><code _ngcontent-ng-c3582179313="" role="text" data-test-id="code-content" class="code-container formatted ng-tns-c3582179313-36">{\n  <span class="hljs-attr">&quot;case&quot;</span>: <span class="hljs-string">&quot;multi&quot;</span>,\n  <span class="hljs-attr">&quot;label&quot;</span>: <span class="hljs-string">&quot;Тест ё 😀&quot;</span>,\n  <span class="hljs-attr">&quot;values&quot;</span>: [\n    <span class="hljs-number">1</span>,\n    <span class="hljs-number">2</span>,\n    <span class="hljs-number">3</span>\n  ],\n  <span class="hljs-attr">&quot;literal&quot;</span>: <span class="hljs-string">&quot;&lt;tag&gt; &amp; quote&quot;</span>\n}\n</code></pre>', '<pre _ngcontent-ng-c3582179313="" class="ng-tns-c3582179313-45"><code _ngcontent-ng-c3582179313="" role="text" data-test-id="code-content" class="code-container formatted ng-tns-c3582179313-45">001 OCTOPORT_LONG_BEGIN_gemini\n002 probe\n003 probe\n004 probe\n005 probe\n006 probe\n007 probe\n008 probe\n009 probe\n010 probe\n011 probe\n012 probe\n013 probe\n014 probe\n015 probe\n016 probe\n017 probe\n018 probe\n019 probe\n020 probe\n021 probe\n022 probe\n023 probe\n024 probe\n025 probe\n026 probe\n027 probe\n028 probe\n029 probe\n030 probe\n031 probe\n032 probe\n033 probe\n034 probe\n035 probe\n036 probe\n037 probe\n038 probe\n039 probe\n040 probe\n041 probe\n042 probe\n043 probe\n044 probe\n045 probe\n046 probe\n047 probe\n048 probe\n049 probe\n050 probe\n051 probe\n052 probe\n053 probe\n054 probe\n055 probe\n056 probe\n057 probe\n058 probe\n059 probe\n060 probe\n061 probe\n062 probe\n063 probe\n064 probe\n065 probe\n066 probe\n067 probe\n068 probe\n069 probe\n070 probe\n071 probe\n072 probe\n073 probe\n074 probe\n075 probe\n076 probe\n077 probe\n078 probe\n079 probe\n080 probe\n081 probe\n082 probe\n083 probe\n084 probe\n085 probe\n086 probe\n087 probe\n088 probe\n089 probe\n090 probe\n091 probe\n092 probe\n093 probe\n094 probe\n095 probe\n096 probe\n097 probe\n098 probe\n099 probe\n100 probe\n101 probe\n102 probe\n103 probe\n104 probe\n105 probe\n106 probe\n107 probe\n108 probe\n109 probe\n110 probe\n111 probe\n112 probe\n113 probe\n114 probe\n115 probe\n116 probe\n117 probe\n118 probe\n119 probe\n120 OCTOPORT_LONG_END_gemini\n</code></pre>'], 'source': 'gemini/20261019T062400Z/S06.fenced.dom.json', 'sha256': '2f33125b48b9164ea0aba5c3b397f4290f38d5a80e802267008afabed56b7978'}, 'grok': {'html': ['<pre class="shiki slack-ochin" tabindex="0" role="group" aria-label="JavaScript code"><code><span class="line"><span>console</span><span>.</span><span>log</span><span>(</span><span>&quot;OCTOPORT_UI&quot;</span><span>);</span></span></code></pre>', '<pre class="shiki slack-ochin" tabindex="0" role="group" aria-label="Code"><code><span class="line"><span>ALPHA</span></span>\n<span class="line"><span>BETA</span></span>\n<span class="line"><span>GAMMA</span></span></code></pre>', '<pre class="shiki slack-ochin" tabindex="0" role="group" aria-label="Code"><code><span class="line"><span>001 BEGIN_GROK_UI</span></span>\n<span class="line"><span>002 neutral</span></span>\n<span class="line"><span>003 neutral</span></span>\n<span class="line"><span>004 neutral</span></span>\n<span class="line"><span>005 neutral</span></span>\n<span class="line"><span>006 neutral</span></span>\n<span class="line"><span>007 neutral</span></span>\n<span class="line"><span>008 neutral</span></span>\n<span class="line"><span>009 neutral</span></span>\n<span class="line"><span>010 neutral</span></span>\n<span class="line"><span>011 neutral</span></span>\n<span class="line"><span>012 neutral</span></span>\n<span class="line"><span>013 neutral</span></span>\n<span class="line"><span>014 neutral</span></span>\n<span class="line"><span>015 neutral</span></span>\n<span class="line"><span>016 neutral</span></span>\n<span class="line"><span>017 neutral</span></span>\n<span class="line"><span>018 neutral</span></span>\n<span class="line"><span>019 neutral</span></span>\n<span class="line"><span>020 neutral</span></span>\n<span class="line"><span>021 neutral</span></span>\n<span class="line"><span>022 neutral</span></span>\n<span class="line"><span>023 neutral</span></span>\n<span class="line"><span>024 neutral</span></span>\n<span class="line"><span>025 neutral</span></span>\n<span class="line"><span>026 neutral</span></span>\n<span class="line"><span>027 neutral</span></span>\n<span class="line"><span>028 neutral</span></span>\n<span class="line"><span>029 neutral</span></span>\n<span class="line"><span>030 neutral</span></span>\n<span class="line"><span>031 neutral</span></span>\n<span class="line"><span>032 neutral</span></span>\n<span class="line"><span>033 neutral</span></span>\n<span class="line"><span>034 neutral</span></span>\n<span class="line"><span>035 neutral</span></span>\n<span class="line"><span>036 neutral</span></span>\n<span class="line"><span>037 neutral</span></span>\n<span class="line"><span>038 neutral</span></span>\n<span class="line"><span>039 neutral</span></span>\n<span class="line"><span>040 neutral</span></span>\n<span class="line"><span>041 neutral</span></span>\n<span class="line"><span>042 neutral</span></span>\n<span class="line"><span>043 neutral</span></span>\n<span class="line"><span>044 neutral</span></span>\n<span class="line"><span>045 neutral</span></span>\n<span class="line"><span>046 neutral</span></span>\n<span class="line"><span>047 neutral</span></span>\n<span class="line"><span>048 neutral</span></span>\n<span class="line"><span>049 neutral</span></span>\n<span class="line"><span>050 neutral</span></span>\n<span class="line"><span>051 neutral</span></span>\n<span class="line"><span>052 neutral</span></span>\n<span class="line"><span>053 neutral</span></span>\n<span class="line"><span>054 neutral</span></span>\n<span class="line"><span>055 neutral</span></span>\n<span class="line"><span>056 neutral</span></span>\n<span class="line"><span>057 neutral</span></span>\n<span class="line"><span>058 neutral</span></span>\n<span class="line"><span>059 neutral</span></span>\n<span class="line"><span>060 neutral</span></span>\n<span class="line"><span>061 neutral</span></span>\n<span class="line"><span>062 neutral</span></span>\n<span class="line"><span>063 neutral</span></span>\n<span class="line"><span>064 neutral</span></span>\n<span class="line"><span>065 neutral</span></span>\n<span class="line"><span>066 neutral</span></span>\n<span class="line"><span>067 neutral</span></span>\n<span class="line"><span>068 neutral</span></span>\n<span class="line"><span>069 neutral</span></span>\n<span class="line"><span>070 neutral</span></span>\n<span class="line"><span>071 neutral</span></span>\n<span class="line"><span>072 neutral</span></span>\n<span class="line"><span>073 neutral</span></span>\n<span class="line"><span>074 neutral</span></span>\n<span class="line"><span>075 neutral</span></span>\n<span class="line"><span>076 neutral</span></span>\n<span class="line"><span>077 neutral</span></span>\n<span class="line"><span>078 neutral</span></span>\n<span class="line"><span>079 neutral</span></span>\n<span class="line"><span>080 neutral</span></span>\n<span class="line"><span>081 neutral</span></span>\n<span class="line"><span>082 neutral</span></span>\n<span class="line"><span>083 neutral</span></span>\n<span class="line"><span>084 neutral</span></span>\n<span class="line"><span>085 neutral</span></span>\n<span class="line"><span>086 neutral</span></span>\n<span class="line"><span>087 neutral</span></span>\n<span class="line"><span>088 neutral</span></span>\n<span class="line"><span>089 neutral</span></span>\n<span class="line"><span>090 neutral</span></span>\n<span class="line"><span>091 neutral</span></span>\n<span class="line"><span>092 neutral</span></span>\n<span class="line"><span>093 neutral</span></span>\n<span class="line"><span>094 neutral</span></span>\n<span class="line"><span>095 neutral</span></span>\n<span class="line"><span>096 neutral</span></span>\n<span class="line"><span>097 neutral</span></span>\n<span class="line"><span>098 neutral</span></span>\n<span class="line"><span>099 neutral</span></span>\n<span class="line"><span>100 neutral</span></span>\n<span class="line"><span>101 neutral</span></span>\n<span class="line"><span>102 neutral</span></span>\n<span class="line"><span>103 neutral</span></span>\n<span class="line"><span>104 neutral</span></span>\n<span class="line"><span>105 neutral</span></span>\n<span class="line"><span>106 neutral</span></span>\n<span class="line"><span>107 neutral</span></span>\n<span class="line"><span>108 neutral</span></span>\n<span class="line"><span>109 neutral</span></span>\n<span class="line"><span>110 neutral</span></span>\n<span class="line"><span>111 neutral</span></span>\n<span class="line"><span>112 neutral</span></span>\n<span class="line"><span>113 neutral</span></span>\n<span class="line"><span>114 neutral</span></span>\n<span class="line"><span>115 neutral</span></span>\n<span class="line"><span>116 neutral</span></span>\n<span class="line"><span>117 neutral</span></span>\n<span class="line"><span>118 neutral</span></span>\n<span class="line"><span>119 neutral</span></span>\n<span class="line"><span>120 END_GROK_UI</span></span></code></pre>'], 'source': 'grok/20261019T091100Z/S06.completed.dom.json', 'sha256': 'c2e248c72fa3c135ba95f08562125751c4797f25810bf49cffdc75edb5eeaeb0', 'parents_source': 'grok/20261019T091100Z/S08.sent.dom.json', 'parents_sha256': 'c10e64360ae149f5c0f5c3e0e932454c6a1fe194ce2ebd063b34cb1a3283541c'}}
    class Plain(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.parts = []
        def handle_data(self, data):
            self.parts.append(data)
    def plain(value):
        p = Plain()
        p.feed(value)
        return "".join(p.parts)
    def body(provider, blocks):
        if provider == "deepseek":
            return '<div class="ds-message"><div class="ds-markdown ds-assistant-message-main-content">' + "".join('<div class="md-code-block md-code-block-light"><div role="button">Copy</div>'+b+'</div>' for b in blocks) + '</div></div>'
        if provider == "claude":
            return '<div role="article" aria-label="Сообщение 2 из 6"><div data-testid="assistant-message" data-is-streaming="false"><div class="prose"><div class="standard-markdown">' + "".join('<div role="group" aria-label="Код на языке text"><button data-testid="code-block-copy">Copy</button><div class="overflow-x-auto">'+b+'</div></div>' for b in blocks) + '</div></div></div></div>'
        if provider == "grok":
            return '<div id="response-OBSERVED_ID_2"><div role="article" data-testid="assistant-message" aria-labelledby="turn-heading-OBSERVED_ID_2"><h2 id="turn-heading-OBSERVED_ID_2">Grok</h2><div class="relative"><div class="response-content-markdown">'+"".join('<div class="not-prose"><div data-testid="code-block" class="chat-code-block"><div><div class="shiki">'+b+'</div></div></div></div>' for b in blocks)+'</div></div></div></div>'
        return '<div class="conversation-container message-actions-hover-boundary" id="3f085f98b6b0fa2a"><user-query><user-query-content>user text</user-query-content></user-query><model-response><div><response-container><div class="response-content">'+"".join(blocks)+'</div></response-container></div></model-response></div>'
    urls = {"deepseek":"https://chat.deepseek.com/a/chat/fixture-a", "claude":"https://claude.ai/chat/fixture-a", "gemini":"https://gemini.google.com/app/fixture-a", "grok":"https://grok.com/c/fixture-a"}
    bundle = (runtime/"shared/ai_adapters.js").read_text()
    identity = (runtime/"shared/conversation_identity.js").read_text()
    result = {"status":"RUNNING","scope":"S04-S06 DeepSeek/Claude/Gemini/Grok read-only assistant code DOM; synthetic parent-chain fixtures; no activation",
              "bundle_sha256":hashlib.sha256(bundle.encode()).hexdigest(),
              "accepted_fixture_sources":{k:{"path":v["source"],"sha256":v["sha256"],"parents_source":v.get("parents_source"),"parents_sha256":v.get("parents_sha256")} for k,v in fixtures.items()}, "cases":{}}
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width":1100,"height":800})
        context.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body="<html></html>"))
        page = context.new_page()
        def load(provider, html):
            page.goto(urls[provider])
            page.set_content(html)
            page.evaluate(identity)
            page.evaluate(bundle)
        def read(provider):
            return page.evaluate("""provider => {
                const r=SellerAgentsObservedAICodeReaders.readers[provider];
                return r.assistantMessages().flatMap(m=>r.findCodeBlocks(m).map(b=>r.readCodeText(b)));
            }""", provider)
        def check(provider, name, callback):
            key=provider+"_"+name
            try:
                callback()
                result["cases"][key]={"status":"PASS"}
            except Exception as exc:
                failures.append(key)
                result["cases"][key]={"status":"FAIL","error":str(exc)[:800]}
        for provider, data in fixtures.items():
            expected = [plain(h) for h in data["html"]]
            html = body(provider,data["html"])
            def exact():
                load(provider,html)
                assert read(provider)==expected, read(provider)
            check(provider,"observed_three_blocks_verbatim",exact)
            def long():
                load(provider,html)
                actual=read(provider)[-1]
                assert actual==expected[-1] and len(actual.splitlines())==120
                assert "001" in actual.splitlines()[0] and "120" in actual.splitlines()[-1]
            check(provider,"full_120_lines",long)
            def whitespace():
                code = "  <tag>\n\tA\u00a0B\n"
                block = data["html"][0]
                # Keep the observed code element attributes and replace its text only.
                from re import sub
                if provider=="deepseek":
                    block='<pre>'+escape(code)+'</pre>'
                else:
                    start=block.index(">")+1
                    code_start=block.index(">",block.index("<code"))+1
                    code_end=block.index("</code>")
                    block=block[:code_start]+escape(code)+block[code_end:]
                load(provider,body(provider,[block]))
                assert read(provider)==[code], read(provider)
            check(provider,"whitespace_entities_verbatim",whitespace)
            def user():
                wrong = html.replace('ds-markdown ds-assistant-message-main-content','user-markdown') if provider=="deepseek" else html.replace('data-testid="assistant-message"','data-testid="user-message"') if provider in ["claude","grok"] else html.replace("model-response","user-query")
                load(provider,wrong)
                assert read(provider)==[]
            check(provider,"user_code_not_assistant",user)
            def outside():
                load(provider,"".join(data["html"]))
                assert read(provider)==[]
            check(provider,"unowned_pre_not_assistant",outside)
            for label,style in [("hidden","display:none"),("collapsed","visibility:hidden"),("transparent","opacity:0")]:
                def hidden(style=style):
                    load(provider,'<div style="'+style+'">'+html+'</div>')
                    assert read(provider)==[]
                check(provider,label+"_parent",hidden)
            def editor():
                load(provider,'<div contenteditable="true">'+html+'</div>')
                assert read(provider)==[]
            check(provider,"draft_not_assistant",editor)
            mutations = {
                "detached_block": "b.remove()",
                "moved_block": "document.body.append(b)",
                "chat_navigation": "history.pushState({},'',location.pathname+'-changed')",
            }
            if provider=="grok":
                mutations["changed_local_message_witness"]="m.parentElement.id='response-other'"
            elif provider=="claude":
                mutations["changed_local_message_witness"]="m.closest('[role=article]').setAttribute('aria-label','Сообщение 4 из 6')"
            elif provider=="gemini":
                mutations["changed_local_message_witness"]="m.parentElement.id='other-turn'"
            else:
                mutations["changed_local_message_witness"]="m.classList.remove('ds-assistant-message-main-content')"
            for name, mutation in mutations.items():
                def changed(mutation=mutation):
                    load(provider,body(provider,[data["html"][0]]))
                    actual=page.evaluate("""({provider,mutation})=>{
                      const r=SellerAgentsObservedAICodeReaders.readers[provider],m=r.assistantMessages()[0],b=r.findCodeBlocks(m)[0];
                      const before=r.readCodeText(b);
                      new Function('m','b',mutation)(m,b);
                      return {before,after:r.readCodeText(b),anchor:r.geometryAnchor(b)!==null};
                    }""",{"provider":provider,"mutation":mutation})
                    assert actual=={"before":expected[0],"after":"","anchor":False},actual
                check(provider,name,changed)
            def no_activation():
                load(provider,html)
                assert page.evaluate("OzonAIAdapters.adapterForLocation('auto')===null")
                assert page.evaluate("SellerAgentsObservedAICodeReaders.forLocation()!==null")
            check(provider,"reader_does_not_activate_provider",no_activation)
            def wrong_origin():
                page.goto("https://example.invalid/fixture")
                page.set_content(html)
                page.evaluate(identity)
                page.evaluate(bundle)
                assert read(provider)==[]
            check(provider,"unrelated_origin",wrong_origin)
        browser.close()
    result["status"]="FAIL" if failures else "PASS"
    result["failures"]=failures
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"cases":len(result["cases"]),"failed":failures}))
    return 1 if failures else 0



def run_gemini_adapter(runtime: Path, output: Path, extra_cases=None, case_names=None):
    """B02 Gemini adapter on accepted structural fixtures; offline code only."""
    from html import escape
    output.mkdir(parents=True, exist_ok=True)
    observed_blocks = ['<pre _ngcontent-ng-c3582179313="" class="ng-tns-c3582179313-35"><code _ngcontent-ng-c3582179313="" role="text" data-test-id="code-content" class="code-container formatted ng-tns-c3582179313-35">OCTOPORT_UI_PROBE_V1 {&quot;case&quot;:&quot;single&quot;,&quot;value&quot;:17}\n</code></pre>', '<pre _ngcontent-ng-c3582179313="" class="ng-tns-c3582179313-36"><code _ngcontent-ng-c3582179313="" role="text" data-test-id="code-content" class="code-container formatted ng-tns-c3582179313-36">{\n  <span class="hljs-attr">&quot;case&quot;</span>: <span class="hljs-string">&quot;multi&quot;</span>,\n  <span class="hljs-attr">&quot;label&quot;</span>: <span class="hljs-string">&quot;Тест ё 😀&quot;</span>,\n  <span class="hljs-attr">&quot;values&quot;</span>: [\n    <span class="hljs-number">1</span>,\n    <span class="hljs-number">2</span>,\n    <span class="hljs-number">3</span>\n  ],\n  <span class="hljs-attr">&quot;literal&quot;</span>: <span class="hljs-string">&quot;&lt;tag&gt; &amp; quote&quot;</span>\n}\n</code></pre>', '<pre _ngcontent-ng-c3582179313="" class="ng-tns-c3582179313-45"><code _ngcontent-ng-c3582179313="" role="text" data-test-id="code-content" class="code-container formatted ng-tns-c3582179313-45">001 OCTOPORT_LONG_BEGIN_gemini\n002 probe\n003 probe\n004 probe\n005 probe\n006 probe\n007 probe\n008 probe\n009 probe\n010 probe\n011 probe\n012 probe\n013 probe\n014 probe\n015 probe\n016 probe\n017 probe\n018 probe\n019 probe\n020 probe\n021 probe\n022 probe\n023 probe\n024 probe\n025 probe\n026 probe\n027 probe\n028 probe\n029 probe\n030 probe\n031 probe\n032 probe\n033 probe\n034 probe\n035 probe\n036 probe\n037 probe\n038 probe\n039 probe\n040 probe\n041 probe\n042 probe\n043 probe\n044 probe\n045 probe\n046 probe\n047 probe\n048 probe\n049 probe\n050 probe\n051 probe\n052 probe\n053 probe\n054 probe\n055 probe\n056 probe\n057 probe\n058 probe\n059 probe\n060 probe\n061 probe\n062 probe\n063 probe\n064 probe\n065 probe\n066 probe\n067 probe\n068 probe\n069 probe\n070 probe\n071 probe\n072 probe\n073 probe\n074 probe\n075 probe\n076 probe\n077 probe\n078 probe\n079 probe\n080 probe\n081 probe\n082 probe\n083 probe\n084 probe\n085 probe\n086 probe\n087 probe\n088 probe\n089 probe\n090 probe\n091 probe\n092 probe\n093 probe\n094 probe\n095 probe\n096 probe\n097 probe\n098 probe\n099 probe\n100 probe\n101 probe\n102 probe\n103 probe\n104 probe\n105 probe\n106 probe\n107 probe\n108 probe\n109 probe\n110 probe\n111 probe\n112 probe\n113 probe\n114 probe\n115 probe\n116 probe\n117 probe\n118 probe\n119 probe\n120 OCTOPORT_LONG_END_gemini\n</code></pre>']
    bundle=(runtime/"shared/ai_adapters.js").read_text()
    identity=(runtime/"shared/conversation_identity.js").read_text()
    capabilities=(runtime/"shared/ai_delivery_capabilities.js").read_text()
    def button(label,attrs=""):
        return '<button aria-label="'+label+'" '+attrs+'>control</button>'
    send=button("Отправить сообщение")
    stop=button("Остановить генерацию ответа")
    voice=button("Начать голосовой ввод (^⇧D)")
    def root(text="",controls=None,extra=""):
        return '<div class="text-input-field"><rich-textarea><div class="ql-editor textarea new-input-ui" contenteditable="true" role="textbox" aria-label="Введите запрос для Gemini">'+escape(text)+'</div><div class="ql-clipboard" contenteditable="true" tabindex="-1">CLIPBOARD</div></rich-textarea>'+extra+(voice if controls is None else controls)+'</div>'
    def staged(name="report",ext="TXT"):
        return '<span class="gem-attachment-content"><span class="gem-attachment-extension-label">'+ext+'</span><span class="gem-attachment-text">'+name+'</span><button aria-label="close '+name+'">remove</button></span>'
    def sent(name="report"):
        return '<user-query-file-preview><div class="new-file-preview-container"><button class="new-file-preview-file" aria-label="'+name+'.txt"><div data-test-id="extension-label"> TXT </div><div data-test-id="filename-label">'+name+'</div></button></div></user-query-file-preview>'
    def pair(card="",code=None,ident="3f085f98b6b0fa2a"):
        return '<div class="conversation-container" id="'+ident+'"><user-query><user-query-content>'+card+'<div class="query-text"><h5 class="screen-reader-user-query-label">Ваш запрос</h5><p>REPORT</p><p>END</p></div></user-query-content></user-query><model-response><div><response-container><div class="response-content">'+("".join(observed_blocks) if code is None else code)+'</div></response-container></div></model-response></div>'
    desc='[{filename:"report.txt",byte_length:85}]'
    cases={}
    def case(name,html,js,expected,origin="https://gemini.google.com"):
        cases[name]=(html,js,expected,origin)
    case("registered_native_txt_adapter",root(),"return [OzonAIAdapters.adapterForLocation('auto')?.id,OzonAIDeliveryCapabilities.profile('gemini').status,BB2ConversationIdentity.providerForOrigin(location.origin)]",["gemini","implemented","gemini"])
    case("file_transport_supported_local_txt_limit",root(),"const f=OzonAIDeliveryCapabilities.supportsFile('gemini',{filename:'report.txt',byte_length:85});return [f.supported,f.status,f.reason,OzonAIDeliveryCapabilities.generatedTextDecision('gemini','x').representation,OzonAIDeliveryCapabilities.generatedTextDecision('gemini','x'.repeat(5000)).representation]",[True,"supported",None,"plain_text","text_document"])
    case("main_editor_not_ql_clipboard",root(),"return a.composerContext().composer.classList.contains('ql-editor')",True)
    case("empty_voice_ready",root(),"return a.classifyComposerControl(c).kind","ready")
    case("draft_with_send",root("draft",send),"return a.classifyComposerControl(c).kind","send_active")
    case("disabled_send",root("draft",button("Отправить сообщение","disabled")),"return a.classifyComposerControl(c).kind","send_disabled")
    case("aria_disabled_send",root("draft",button("Отправить сообщение",'aria-disabled="true"')),"return a.classifyComposerControl(c).kind","send_disabled")
    case("stop_wins_send",root("draft",send+stop),"return [a.classifyComposerControl(c).kind,a.sendButton(c)===null] ",["stop",True])
    case("progress_wins_enabled_send",root("draft",send,'<div role="progressbar">upload</div>'),"return a.classifyComposerControl(c).kind","busy")
    case("duplicate_send_unknown",root("draft",send+send),"return a.classifyComposerControl(c).kind","unknown")
    case("unknown_control",root("draft",button("unknown")),"return a.classifyComposerControl(c).kind","unknown")
    case("hidden_send_not_eligible",root("draft",button("Отправить сообщение","hidden")),"return a.classifyComposerControl(c).kind","unknown")
    case("outside_send_not_selected",root()+send,"return [a.classifyComposerControl(c).kind,a.sendButton(c)===null]",["ready",True])
    case("two_main_editors_unavailable",root()+root(),"return c===null",True)
    case("hidden_editor_does_not_compete",'<div hidden>'+root()+'</div>'+root(),"return c!==null",True)
    case("message_editor_not_composer",'<user-query>'+root()+'</user-query>',"return c===null",True)
    case("stale_context_after_navigation",root("draft",send),"history.pushState({},'',location.pathname+'-b');return a.classifyComposerControl(c).kind","unknown")
    case("write_multiline_only_main_editor",root(),"a.setComposerText(c.composer,'ONE\\nTWO');return [a.readComposerText(c.composer),document.querySelector('.ql-clipboard').textContent]",["ONE\nTWO","CLIPBOARD"])
    case("stop_blocks_write",root("draft",stop),"let code='';try{a.setComposerText(c.composer,'NEW')}catch(e){code=e.code};return [code,a.readComposerText(c.composer)]",["COMPOSER_NOT_AVAILABLE","draft"])
    case("paired_roles_local_ids_distinct",pair()+root(),"return [a.messageId(a.userMessages()[0]),a.messageId(a.assistantMessages()[0])]",["user:3f085f98b6b0fa2a","assistant:3f085f98b6b0fa2a"])
    case("duplicate_turn_id_not_unique",pair()+pair()+root(),"return [...a.userMessages(),...a.assistantMessages()].map(n=>a.messageId(n))",["","","",""])
    case("user_body_excludes_heading_card",pair(sent())+root(),"return a.messageText(a.userMessages()[0]).trim()","REPORT\nEND")
    case("sent_card_and_body",pair(sent())+root(),"return a.sentAttachmentMessage(a.userMessages()[0],"+desc+").text.trim()","REPORT\nEND")
    case("wrong_sent_filename",pair(sent("wrong"))+root(),"return a.sentAttachmentMessage(a.userMessages()[0],"+desc+")",None)
    case("assistant_card_is_not_user_delivery",pair(code=sent())+root(),"return a.sentAttachmentMessage(a.assistantMessages()[0],"+desc+")",None)
    case("composer_card_is_not_sent",pair()+root(controls=send,extra=staged()),"return a.sentAttachmentMessage(a.userMessages()[0],"+desc+")",None)
    case("missing_descriptor_not_sent",pair(sent())+root(),"return a.sentAttachmentMessage(a.userMessages()[0],[])",None)
    case("positive_ready_txt_card",root(controls=send,extra=staged()),"return a.attachmentReady("+desc+")",True)
    case("wrong_ready_name",root(controls=send,extra=staged("wrong")),"return a.attachmentReady("+desc+")",False)
    case("progress_not_ready",root(controls=send,extra=staged()+'<div role="progressbar">upload</div>'),"return a.attachmentReady("+desc+")",False)
    case("stop_not_ready",root(controls=stop,extra=staged()),"return a.attachmentReady("+desc+")",False)
    case("partial_card_not_ready",root(controls=send,extra=staged(ext="")),"return a.attachmentReady("+desc+")",False)
    case("native_upload_not_invented",root(),"let code='';try{a.attachFiles(null,[])}catch(e){code=e.code};return [a.attachmentSurface(),code]",[None,"TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE"])
    case("full_code_not_user_pre",pair()+root(),"""return a.assistantMessages().flatMap(m=>a.findCodeBlocks(m).map(b=>a.readCodeText(b))).length""",3)
    case("full_120_code_lines",pair()+root(),"""const m=a.assistantMessages()[0],blocks=a.findCodeBlocks(m),t=a.readCodeText(blocks[2]);return [t.trimEnd().split('\\n').length,t.includes('120 OCTOPORT_LONG_END_gemini')];""",[120,True])
    case("stop_not_message_complete",pair()+root(controls=stop),"return a.messageComplete(a.assistantMessages()[0])",False)
    case("unknown_not_message_complete",pair()+root("draft",button("unknown")),"return a.messageComplete(a.assistantMessages()[0])",False)
    case("idle_message_complete",pair()+root(),"return a.messageComplete(a.assistantMessages()[0])",True)
    case("wrong_origin_unavailable",root(),"return [a.matchesLocation(),c===null]",[False,True],"https://example.invalid")
    # Menu/input attributes observed in1442 JSON; parent placement below is
    # a structural fixture, not a claimed whole-page/provider capture.
    opener=button("Загрузка и инструменты")
    menu='<images-files-uploader data-test-id="uploader-images-files-button-advanced"><button data-test-id="local-images-files-uploader-button" aria-disabled="false">Загрузить файлы</button><input class="hidden-file-input" multiple type="file" accept=".txt,.pdf"></images-files-uploader>'
    image_input='<input type="file" multiple accept="image/*" class="hidden-file-input">'
    setup="let clicks=0;const b=c.root.querySelector('button[aria-label=\"Загрузка и инструменты\"]');b.addEventListener('click',()=>{clicks++;document.body.insertAdjacentHTML('beforeend',"+json.dumps(menu+image_input)+")});"
    prepare="await a.prepareAttachmentSurface(c,{deliveryId:'delivery-one',isCurrent:()=>true})"
    file="[new File(['BEGIN\\nMIDDLE\\nEND'],'report.txt',{type:'text/plain'})]"
    case("menu_closed_has_no_input",root(controls=voice+opener),"return a.attachmentSurface()",None)
    case("menu_open_selects_txt_not_image",root(controls=voice+opener),setup+"const s="+prepare+";return [clicks,s.kind,s.input.accept,s.root===c.root,document.querySelector('input[accept=\"image/*\"]').files.length]",[1,"file_input_v1",".txt,.pdf",True,0])
    case("delayed_menu_mount",root(controls=voice+opener),"let clicks=0;c.root.querySelector('button[aria-label=\"Загрузка и инструменты\"]').onclick=()=>{clicks++;setTimeout(()=>document.body.insertAdjacentHTML('beforeend',"+json.dumps(menu)+"),80)};const s="+prepare+";return [clicks,!!s]",[1,True])
    case("same_request_only_one_menu_click",root(controls=voice+opener),setup+"const one=a.prepareAttachmentSurface(c,{deliveryId:'delivery-one',isCurrent:()=>true}),two=a.prepareAttachmentSurface(c,{deliveryId:'delivery-one',isCurrent:()=>true});await Promise.all([one,two]);await a.prepareAttachmentSurface(c,{deliveryId:'delivery-one',isCurrent:()=>true});return clicks",1)
    case("native_txt_bytes_and_event",root(controls=voice+opener),setup+"const s="+prepare+";let changes=0;s.input.addEventListener('change',()=>changes++);a.attachFiles(s,"+file+");return [changes,s.input.files[0].name,await s.input.files[0].text(),document.querySelector('input[accept=\"image/*\"]').files.length]",[1,"report.txt","BEGIN\nMIDDLE\nEND",0])
    case("second_attach_keeps_original_file",root(controls=voice+opener),setup+"const s="+prepare+";a.attachFiles(s,"+file+");let code='';try{a.attachFiles(s,[new File(['replacement'],'report.txt')])}catch(e){code=e.code}return [code,await s.input.files[0].text()]",["TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE","BEGIN\nMIDDLE\nEND"])
    for name,files in [("pdf","[new File(['x'],'report.pdf')]"),("two","[new File(['x'],'one.txt'),new File(['y'],'two.txt')]"),("mime","[new File(['x'],'report.txt',{type:'image/png'})]"),("large","[new File([new Uint8Array(1048577)],'report.txt')]")]:
        case("native_reject_"+name,root(controls=voice+opener),setup+"const s="+prepare+";let code='';try{a.attachFiles(s,"+files+")}catch(e){code=e.code}return [code,s.input.files.length]",["TARGET_AI_FILE_TYPE_UNSUPPORTED",0])
    for name,change in [("path","history.pushState({},'',location.pathname+'-b')"),("composer","c.root.replaceWith(c.root.cloneNode(true))"),("input","s.input.replaceWith(s.input.cloneNode(true))"),("menu","s.inputRoot.replaceWith(s.inputRoot.cloneNode(true))"),("draft","c.composer.textContent='OWNER DRAFT'")]:
        case("native_stale_"+name,root(controls=voice+opener),setup+"const s="+prepare+";"+change+";let code='';try{a.attachFiles(s,"+file+")}catch(e){code=e.code}return [code,s.input.files.length]",["TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE",0])
    case("outside_preopened_menu_not_attributed",root(controls=voice+opener)+menu,"let clicks=0;c.root.querySelector('button[aria-label=\"Загрузка и инструменты\"]').onclick=()=>clicks++;const s="+prepare+";return [s,clicks]",[None,0])
    case("native_menu_inside_owned_root",root(controls=voice+opener,extra=menu),"return a.attachmentSurface()?.kind","file_input_v1")
    for name,markup in [("draft",root("OWNER DRAFT",send+opener)),("stop",root(controls=stop+opener)),("unknown",root(controls=opener)),("existing_card",root(controls=send+opener,extra=staged())),("duplicate_composer",root(controls=voice+opener)+root(controls=voice+opener)),("disabled_opener",root(controls=voice+button("Загрузка и инструменты","disabled")))]:
        case("menu_not_opened_"+name,markup,"let clicks=0;document.querySelectorAll('button').forEach(n=>n.onclick=()=>clicks++);const s="+prepare+";return [s,clicks]",[None,0])
    case("request_retired_before_menu",root(controls=voice+opener),setup+"const s=await a.prepareAttachmentSurface(c,{deliveryId:'delivery-one',isCurrent:()=>false});return [s,clicks]",[None,0])
    case("request_retired_during_menu",root(controls=voice+opener),setup+"let valid=true;b.addEventListener('click',()=>valid=false);const s=await a.prepareAttachmentSurface(c,{deliveryId:'delivery-one',isCurrent:()=>valid});return [s,clicks,a.attachmentSurface()]",[None,1,None])
    for name,bad in [("duplicate",menu+menu),("wrong_parent",menu.replace("images-files-uploader","unobserved-uploader")),("image_only",menu.replace(".txt,.pdf","image/*")),("disabled_input",menu.replace('multiple type','disabled multiple type')),("disabled_local",menu.replace('aria-disabled="false"','aria-disabled="true"'))]:
        case("native_unavailable_"+name,root(controls=voice+opener,extra=bad),"return a.attachmentSurface()",None)
    case("closed_menu_same_request_not_reclicked",root(controls=voice+opener),setup+"const s="+prepare+";s.inputRoot.remove();const again="+prepare+";return [again,clicks]",[None,1])
    case("new_delivery_after_consumed_menu",root(controls=voice+opener),setup+"const s="+prepare+";s.inputRoot.remove();document.querySelector('input[accept=\"image/*\"]').remove();const next=await a.prepareAttachmentSurface(c,{deliveryId:'delivery-two',isCurrent:()=>true});return [!!next,clicks]",[True,2])
    # Execute the actual composed attachClaimed function, with local request/file
    # boundaries. This verifies prepare-before-commit and unchanged no-hook flow.
    port=(runtime/"attachment_delivery_port_content.js").read_text()
    claimed=port[port.index("  async function attachClaimed("):port.index("  async function reconcileSendCommitted(")]
    port_fixture="""
      const calls=[];let valid=true;
      const runtime={id:'fixture-actor'},adapter=()=>a,current=()=>true,sameConversation=()=>valid;
      const waitForComposerAvailable=async()=>c,attachmentStrategySupported=p=>p.attachment_strategy==='file_input_v1';
      const recovery={adapter_id:'gemini',delivery_id:'delivery-one'},ownerPayload=x=>({delivery_id:x.delivery_id});
      const request=async(type)=>{calls.push(type);return {ok:true,attach_allowed:true,ready:true,recovery}};
      const buildFiles=async()=>({descriptors:[{filename:'report.txt',byte_length:16}],files:[new File(['BEGIN\\nMIDDLE\\nEND'],'report.txt',{type:'text/plain'})]});
      const ATTACH_READY_TIMEOUT_MS=20,waitAttachmentReady=async(active,descriptors)=>active.attachmentReady(descriptors);
      const stageMarker=()=>calls.push('marker'),assistantTurnIds=()=>[];
    """+claimed
    ready_install="s.input.addEventListener('change',()=>{c.root.insertAdjacentHTML('beforeend',"+json.dumps(staged())+");c.root.querySelector('button[aria-label=\"Начать голосовой ввод (^⇧D)\"]').setAttribute('aria-label','Отправить сообщение')});"
    case("port_prepare_commit_attach_ready_order",root(controls=voice+opener),setup+port_fixture+"b.addEventListener('click',()=>{calls.push('menu');const s=a.attachmentSurface()||{input:document.querySelector('images-files-uploader input')};"+ready_install+"});const result=await attachClaimed(recovery);return [result.delivery_id,clicks,calls]",["delivery-one",1,["menu","OZ_ATTACHMENT_COMMIT","OZ_ATTACHMENT_RECOVERY_GET","marker","OZ_ATTACHMENT_READY"]])
    case("port_context_change_no_commit",root(controls=voice+opener),setup+port_fixture+"b.addEventListener('click',()=>valid=false);let code='';try{await attachClaimed(recovery)}catch(e){code=e.code}return [code,calls,clicks]",["EXECUTION_CONTEXT_CHANGED",[],1])
    case("port_missing_surface_no_commit",root(controls=voice),port_fixture+"let code='';try{await attachClaimed(recovery)}catch(e){code=e.code}return [code,calls]",["TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE",[]])
    case("port_without_optional_hook_unchanged",root(controls=voice+opener,extra=menu),port_fixture+"a={...a,prepareAttachmentSurface:undefined};const s=a.attachmentSurface();"+ready_install+"const result=await attachClaimed(recovery);return [result.delivery_id,calls]",["delivery-one",["OZ_ATTACHMENT_COMMIT","OZ_ATTACHMENT_RECOVERY_GET","marker","OZ_ATTACHMENT_READY"]])
    if extra_cases:
        cases.update(extra_cases)
    if case_names is not None:
        assert set(case_names)<=set(cases)
        cases={name:cases[name] for name in case_names}
    result={"status":"RUNNING","scope":"B02 Gemini ordinary offline native TXT menu/attach/ready/sent and real composed port; no provider bytes/installed acceptance",
            "bundle_sha256":hashlib.sha256(bundle.encode()).hexdigest(),"cases":{}}
    failed=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        context=browser.new_context(viewport={"width":1100,"height":800})
        context.route("**/*",lambda route:route.fulfill(status=200,content_type="text/html",body="<html></html>"))
        page=context.new_page()
        for name,(html,js,expected,origin) in cases.items():
            try:
                page.goto(origin+"/app/fixture-a")
                page.set_content('<style>user-query,model-response,response-container,rich-textarea,images-files-uploader{display:block}</style>'+html)
                page.evaluate(identity);page.evaluate(capabilities);page.evaluate((runtime/"shared/web_file_attachment.js").read_text());page.evaluate(bundle)
                actual=page.evaluate("""js=>{
                  const a=SellerAgentsGeminiAdapter.create(OzonAIAdapters),c=a.composerContext();
                  return new (Object.getPrototypeOf(async function(){}).constructor)('a','c',js)(a,c);
                }""",js)
                assert actual==expected,{"actual":actual,"expected":expected}
                result["cases"][name]={"status":"PASS"}
            except Exception as exc:
                failed.append(name);result["cases"][name]={"status":"FAIL","error":str(exc)[:1000]}
        browser.close()
    result["status"]="FAIL" if failed else "PASS";result["failed"]=failed
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"cases":len(cases),"failed":failed}))
    return 1 if failed else 0



def run_grok_adapter(runtime: Path, output: Path):
    """B02 Grok code-only fixtures, accepted S08 roles and input/upload data."""
    from html import escape
    output.mkdir(parents=True, exist_ok=True)
    actual_messages = ['<div class="relative group flex flex-col justify-center w-full max-w-(--content-max-width) mx-auto pb-0.5 items-end" id="response-OBSERVED_ID_5"><div dir="auto" role="article" aria-labelledby="turn-heading-OBSERVED_ID_5" data-testid="user-message" class="message-bubble relative text-fg-primary min-h-7 chat-md prose prose-chat dark:prose-invert break-words max-w-[100%] @sm/mainview:max-w-[90%] has-[pre]:w-full px-4 py-2 overflow-x-auto bg-surface-user-bubble rounded-2xl"><h2 id="turn-heading-OBSERVED_ID_5" dir="auto" tabindex="-1" class="sr-only" data-no-copy="true">Ты</h2><div class="relative"><div class="relative response-content-markdown markdown chat-md chat-md-links [&amp;&gt;:first-child:not(.not-prose)]:mt-0 [&amp;&gt;:last-child:not(.not-prose)]:mb-0"><p dir="auto" class="break-words" node="[object Object]">Это безопасная проверка интерфейса. Не используй поиск, инструменты и выполнение кода.\nОтветь словом ГОТОВО, затем двумя отдельными блоками кода: javascript с одной строкой console.log(&quot;OCTOPORT_UI&quot;); и text с тремя строками ALPHA, BETA, GAMMA.</p></div></div><section class="inline-media-container flex flex-col gap-1 clear-both"></section></div><div class="-ml-1 w-full"></div><div class="order-first hidden @md/mainview:block h-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 -mr-[36px] @lg/mainview:-mr-12"><div class="min-h-7 py-4 flex flex-col gap-0.5"><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="Edit" data-state="closed"><span></span></button></div></div><div role="group" aria-labelledby="turn-heading-OBSERVED_ID_5" class="action-buttons h-8 mt-0.5 mb-2 flex flex-row flex-wrap w-full justify-end print:hidden"><div class="flex items-center gap-[2px] w-max min-w-0 max-w-full rounded-lg text-xs px-2 end-4 -mr-2"><span class="inline-flex items-center gap-[2px] opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [.last-response_&amp;]:opacity-100 has-[[data-state=open]]:opacity-100"><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="Edit" data-state="closed"><span><span class="t-icon-swap" data-state="a" aria-hidden="true"><span class="t-icon" data-icon="a"></span><span class="t-icon" data-icon="b"></span></span></span></button><span class="t-icon-swap" data-state="a"><span class="t-icon" data-icon="a"><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="Копировать" data-state="closed"><div><div class="[&amp;&gt;svg_*]:stroke-current"></div></div></button></span><span class="t-icon" data-icon="b" inert=""><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="Сохранить" data-state="closed"></button></span></span></span><span class="inline-flex items-center gap-[2px]"></span><span class="inline-flex items-center gap-[2px] opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [.last-response_&amp;]:opacity-100 has-[[data-state=open]]:opacity-100"></span></div></div></div>', '<div class="relative group flex flex-col justify-center w-full max-w-(--content-max-width) mx-auto pb-0.5 items-start" id="response-OBSERVED_ID_2"><div dir="auto" role="article" aria-labelledby="turn-heading-OBSERVED_ID_2" data-testid="assistant-message" class="message-bubble relative rounded-3xl text-fg-primary min-h-7 chat-md prose prose-chat dark:prose-invert break-words w-full max-w-none"><h2 id="turn-heading-OBSERVED_ID_2" dir="auto" tabindex="-1" class="sr-only" data-no-copy="true">Grok</h2><div class="thinking-container mb-1"><div class="flex flex-col"><div class="not-prose relative mb-2 text-sm"><button type="button" data-testid="canvas-trigger" aria-expanded="false" class="flex flex-row items-center gap-1 text-fg-secondary text-sm leading-6 w-fit pt-3 pb-0 focus:outline-none focus-visible:outline-none focus-visible:ring-0 cursor-pointer group/canvas"><span class="flex min-w-0 items-center gap-1"><span>Работало на протяжении 6s</span></span><span class="flex shrink-0 items-center justify-center"></span></button></div><div aria-hidden="true"></div></div></div><div class="relative"><div class="relative response-content-markdown markdown chat-md chat-md-links [&amp;&gt;:first-child:not(.not-prose)]:mt-0 [&amp;&gt;:last-child:not(.not-prose)]:mb-0"><div class="streamdown-chat-md"><div class="sd:space-y-4 sd:whitespace-normal sd:[&amp;&gt;*:first-child]:mt-0 sd:[&amp;&gt;*:last-child]:mb-0"><p dir="auto" class="break-words last:mb-0 max-md:leading-[155%] max-md:mb-4 max-md:last:mb-0 streamdown-first-block:mt-0">ГОТОВО</p>\n<div dir="auto" class="not-prose"><div class="chat-code-block relative not-prose @container/code-block my-3" data-testid="code-block"><div class="border border-border-l1 rounded-xl"><div class="flex flex-row px-4 py-2 h-10 items-center rounded-t-xl bg-surface-elevated pr-1 border-b border-border-l1 dark:bg-surface-inset"><span class="font-mono text-xs text-fg-secondary select-none">JavaScript</span><div class="ml-auto flex flex-row gap-0 print:hidden"><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 rounded-xl gap-1 px-2.5" aria-label="Copy JavaScript code"><div><div class="[&amp;&gt;svg_*]:stroke-current"></div></div><span class="t-copy-label-swap hidden @sm/code-block:inline-grid" data-state="copy" aria-hidden="true"><span class="t-copy-label" data-label="copy">Копировать</span><span class="t-copy-label" data-label="copied">Скопировано</span></span></button></div></div><div class="shiki not-prose relative [&amp;_pre]:overflow-auto [&amp;_pre]:rounded-b-lg [&amp;_pre]:px-4 [&amp;_pre]:py-4 !p-0"><pre class="shiki slack-ochin" tabindex="0" role="group" aria-label="JavaScript code"><code><span class="line"><span>console</span><span>.</span><span>log</span><span>(</span><span>&quot;OCTOPORT_UI&quot;</span><span>);</span></span></code></pre></div></div></div></div>\n<div dir="auto" class="not-prose"><div class="chat-code-block relative not-prose @container/code-block my-3" data-testid="code-block"><div class="border border-border-l1 rounded-xl"><div class="flex flex-row px-4 py-2 h-10 items-center rounded-t-xl bg-surface-elevated pr-1 border-b border-border-l1 dark:bg-surface-inset"><span class="font-mono text-xs text-fg-secondary select-none">text</span><div class="ml-auto flex flex-row gap-0 print:hidden"><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 rounded-xl gap-1 px-2.5" aria-label="Copy code"><div><div class="[&amp;&gt;svg_*]:stroke-current"></div></div><span class="t-copy-label-swap hidden @sm/code-block:inline-grid" data-state="copy" aria-hidden="true"><span class="t-copy-label" data-label="copy">Копировать</span><span class="t-copy-label" data-label="copied">Скопировано</span></span></button></div></div><div class="shiki not-prose relative [&amp;_pre]:overflow-auto [&amp;_pre]:rounded-b-lg [&amp;_pre]:px-4 [&amp;_pre]:py-4 !p-0"><pre class="shiki slack-ochin" tabindex="0" role="group" aria-label="Code"><code><span class="line"><span>ALPHA</span></span>\n<span class="line"><span>BETA</span></span>\n<span class="line"><span>GAMMA</span></span></code></pre></div></div></div></div></div><span hidden=""></span></div></div></div><section class="inline-media-container flex flex-col gap-1 clear-both"></section><div class="flex gap-2 mt-2 -ms-2 print:hidden"></div></div><div class="-ml-1 w-full"></div><div class="order-first hidden @md/mainview:block h-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 -ml-[36px] @lg/mainview:-ml-[40px]"><div class="min-h-7 py-4 flex flex-col gap-0.5"></div></div><div role="group" aria-labelledby="turn-heading-OBSERVED_ID_2" class="action-buttons h-8 mt-0.5 mb-2 flex flex-row flex-wrap w-full justify-between print:hidden"><div class="flex items-center gap-[2px] w-max rounded-lg text-xs px-2 start-0 @md/chat:start-3 -ml-4"><span class="inline-flex items-center gap-[2px] opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [.last-response_&amp;]:opacity-100 has-[[data-state=open]]:opacity-100"></span><span class="inline-flex items-center gap-[2px] opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [.last-response_&amp;]:opacity-100 has-[[data-state=open]]:opacity-100"><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="Копировать ответ" data-state="closed"><div><div class="[&amp;&gt;svg_*]:stroke-current"></div></div></button><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="Создать ссылку общего доступа" data-state="closed"><span></span></button><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0 aria-pressed:bg-fg-success/10 aria-pressed:text-fg-success hover:aria-pressed:bg-fg-success/15 hover:aria-pressed:text-fg-success data-[state=open]:aria-pressed:text-fg-success" aria-label="Like" aria-pressed="false" data-state="closed"><span></span></button><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0 aria-pressed:bg-fg-link/10 aria-pressed:text-fg-link hover:aria-pressed:bg-fg-link/15 hover:aria-pressed:text-fg-link data-[state=open]:aria-pressed:text-fg-link" aria-label="Dislike" aria-pressed="false" data-state="closed"><span></span></button><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="Regenerate" data-state="closed"><span></span></button><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="More actions" id="radix-_r_b1_" aria-haspopup="menu" aria-expanded="false" data-state="closed"><span></span></button></span></div></div></div>', '<div class="relative group flex flex-col justify-center w-full max-w-(--content-max-width) mx-auto pb-0.5 items-end" id="response-OBSERVED_ID_3"><div class="flex flex-row flex-wrap gap-2 mb-2 justify-end"><div class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none border border-border-l2 active:bg-button-secondary-fill-active aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 rounded-full group/chip relative min-w-0 gap-0 p-0 hover:bg-transparent text-fg-primary"><button type="button" aria-label="Открыть вложение" class="inline-flex h-full min-w-0 flex-1 items-center rounded-full ps-2 pe-2.5 transition-[padding] duration-200 ease-out-quint gap-1 cursor-pointer" data-state="closed"><span class="shrink-0 inline-flex text-fg-secondary"></span><span class="truncate max-w-full font-normal sm:max-w-[180px]">octoport-ui-large.txt</span></button></div></div><div dir="auto" role="article" aria-labelledby="turn-heading-OBSERVED_ID_3" data-testid="user-message" class="message-bubble relative text-fg-primary min-h-7 chat-md prose prose-chat dark:prose-invert break-words max-w-[100%] @sm/mainview:max-w-[90%] has-[pre]:w-full px-4 py-2 overflow-x-auto bg-surface-user-bubble rounded-2xl"><h2 id="turn-heading-OBSERVED_ID_3" dir="auto" tabindex="-1" class="sr-only" data-no-copy="true">Ты</h2><div class="relative"><div class="relative response-content-markdown markdown chat-md chat-md-links [&amp;&gt;:first-child:not(.not-prose)]:mt-0 [&amp;&gt;:last-child:not(.not-prose)]:mb-0"><p dir="auto" class="break-words" node="[object Object]">Прочитай приложенный файл; выпиши значения маркеров BEGIN, MIDDLE и END и последнюю строку. Не используй поиск, внешние инструменты, локальные команды, sandbox или выполнение кода.</p></div></div><section class="inline-media-container flex flex-col gap-1 clear-both"></section></div><div class="-ml-1 w-full"></div><div class="order-first hidden @md/mainview:block h-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 -mr-[36px] @lg/mainview:-mr-12"><div class="min-h-7 py-4 flex flex-col gap-0.5"></div></div><div role="group" aria-labelledby="turn-heading-OBSERVED_ID_3" class="action-buttons h-8 mt-0.5 mb-2 flex flex-row flex-wrap w-full justify-end print:hidden"><div class="flex items-center gap-[2px] w-max min-w-0 max-w-full rounded-lg text-xs px-2 end-4 -mr-2"><span class="inline-flex items-center gap-[2px] opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [.last-response_&amp;]:opacity-100 has-[[data-state=open]]:opacity-100"><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="Edit" data-state="closed"><span><span class="t-icon-swap" data-state="a" aria-hidden="true"><span class="t-icon" data-icon="a"></span><span class="t-icon" data-icon="b"></span></span></span></button><span class="t-icon-swap" data-state="a"><span class="t-icon" data-icon="a"><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="Копировать" data-state="closed"><div><div class="[&amp;&gt;svg_*]:stroke-current"></div></div></button></span><span class="t-icon" data-icon="b" inert=""><button type="button" data-slot="button" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium leading-[1.4] tracking-[-0.2px] cursor-pointer outline-hidden focus:outline-hidden focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-fg-accent transition-colors duration-100 [&amp;_svg]:shrink-0 select-none text-fg-secondary hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active hover:text-fg-primary border border-transparent aria-pressed:bg-button-secondary-fill-hover aria-pressed:text-fg-primary aria-checked:bg-button-secondary-fill-hover aria-checked:text-fg-primary aria-[current=page]:bg-button-secondary-fill-hover aria-[current=page]:text-fg-primary data-[state=open]:bg-button-secondary-fill-hover data-[state=open]:text-fg-primary h-8 gap-1 rounded-full overflow-hidden w-8 px-1.5 py-1.5 shrink-0" aria-label="Сохранить" data-state="closed"></button></span></span></span><span class="inline-flex items-center gap-[2px]"></span><span class="inline-flex items-center gap-[2px] opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [.last-response_&amp;]:opacity-100 has-[[data-state=open]]:opacity-100"></span></div></div></div>', '<div class="relative group flex flex-col justify-center w-full max-w-(--content-max-width) mx-auto pb-0.5 items-start" id="response-OBSERVED_ID_6"><div dir="auto" role="article" aria-labelledby="turn-heading-OBSERVED_ID_6" data-testid="assistant-message" class="message-bubble relative rounded-3xl text-fg-primary min-h-7 chat-md prose prose-chat dark:prose-invert break-words w-full max-w-none"><h2 id="turn-heading-OBSERVED_ID_6" dir="auto" tabindex="-1" class="sr-only" data-no-copy="true">Grok</h2><div class="thinking-container"><div class="flex flex-col"><div class="relative mb-2"><div class="relative flex flex-col gap-3"><div class="not-prose relative flex flex-col gap-2 text-sm"><div><div class="group/row z-[2] flex items-start gap-0.5 bg-surface-base"><div class="relative flex shrink-0 justify-center self-stretch"><div class="relative z-[2]"><div aria-label="Размышление выполнено" class="shrink-0 flex items-center justify-center relative focus:outline-none focus-visible:outline-none focus-visible:ring-0 cursor-default"><span class="flex items-center justify-center"></span></div></div></div><div class="min-w-0 flex-1 ps-0.5 pe-2"><span class="line-clamp-3 text-sm text-fg-secondary leading-6">Extracting markers and last line from the file</span></div></div></div></div></div></div><div class="not-prose"><div data-testid="canvas-working-indicator" class="flex flex-row items-center gap-1 pt-1 pb-3 text-sm leading-6 w-fit"><div class="flex shrink-0 items-center justify-center"><div class="relative z-[2] flex items-center justify-center"><span aria-hidden="true" class="flex shrink-0 h-3.5 w-3.5"><span class="grok-bot-lazy size-full"></span></span></div></div><span class="min-w-0 text-fg-secondary">Работа для<span class="tabular-nums"> 7s</span></span></div></div><div aria-hidden="true"></div></div></div><div class="relative"><div class="relative response-content-markdown markdown chat-md chat-md-links [&amp;&gt;:first-child:not(.not-prose)]:mt-0 [&amp;&gt;:last-child:not(.not-prose)]:mb-0"><div class="streamdown-chat-md"><div class="sd:space-y-4 sd:whitespace-normal sd:[&amp;&gt;*:first-child]:mt-0 sd:[&amp;&gt;*:last-child]:mb-0"></div><span hidden=""></span></div></div></div><section class="inline-media-container flex flex-col gap-1 clear-both"></section></div><div class="-ml-1 w-full"></div><div class="order-first hidden @md/mainview:block h-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 -ml-[36px] @lg/mainview:-ml-[40px]"><div class="min-h-7 py-4 flex flex-col gap-0.5"></div></div><div role="group" aria-labelledby="turn-heading-OBSERVED_ID_6" class="action-buttons h-8 mt-0.5 mb-2 flex flex-row flex-wrap w-full justify-between last-response opacity-0 pointer-events-none print:hidden"></div></div>']
    long_block = '<pre class="shiki slack-ochin" tabindex="0" role="group" aria-label="Code"><code><span class="line"><span>001 BEGIN_GROK_UI</span></span>\n<span class="line"><span>002 neutral</span></span>\n<span class="line"><span>003 neutral</span></span>\n<span class="line"><span>004 neutral</span></span>\n<span class="line"><span>005 neutral</span></span>\n<span class="line"><span>006 neutral</span></span>\n<span class="line"><span>007 neutral</span></span>\n<span class="line"><span>008 neutral</span></span>\n<span class="line"><span>009 neutral</span></span>\n<span class="line"><span>010 neutral</span></span>\n<span class="line"><span>011 neutral</span></span>\n<span class="line"><span>012 neutral</span></span>\n<span class="line"><span>013 neutral</span></span>\n<span class="line"><span>014 neutral</span></span>\n<span class="line"><span>015 neutral</span></span>\n<span class="line"><span>016 neutral</span></span>\n<span class="line"><span>017 neutral</span></span>\n<span class="line"><span>018 neutral</span></span>\n<span class="line"><span>019 neutral</span></span>\n<span class="line"><span>020 neutral</span></span>\n<span class="line"><span>021 neutral</span></span>\n<span class="line"><span>022 neutral</span></span>\n<span class="line"><span>023 neutral</span></span>\n<span class="line"><span>024 neutral</span></span>\n<span class="line"><span>025 neutral</span></span>\n<span class="line"><span>026 neutral</span></span>\n<span class="line"><span>027 neutral</span></span>\n<span class="line"><span>028 neutral</span></span>\n<span class="line"><span>029 neutral</span></span>\n<span class="line"><span>030 neutral</span></span>\n<span class="line"><span>031 neutral</span></span>\n<span class="line"><span>032 neutral</span></span>\n<span class="line"><span>033 neutral</span></span>\n<span class="line"><span>034 neutral</span></span>\n<span class="line"><span>035 neutral</span></span>\n<span class="line"><span>036 neutral</span></span>\n<span class="line"><span>037 neutral</span></span>\n<span class="line"><span>038 neutral</span></span>\n<span class="line"><span>039 neutral</span></span>\n<span class="line"><span>040 neutral</span></span>\n<span class="line"><span>041 neutral</span></span>\n<span class="line"><span>042 neutral</span></span>\n<span class="line"><span>043 neutral</span></span>\n<span class="line"><span>044 neutral</span></span>\n<span class="line"><span>045 neutral</span></span>\n<span class="line"><span>046 neutral</span></span>\n<span class="line"><span>047 neutral</span></span>\n<span class="line"><span>048 neutral</span></span>\n<span class="line"><span>049 neutral</span></span>\n<span class="line"><span>050 neutral</span></span>\n<span class="line"><span>051 neutral</span></span>\n<span class="line"><span>052 neutral</span></span>\n<span class="line"><span>053 neutral</span></span>\n<span class="line"><span>054 neutral</span></span>\n<span class="line"><span>055 neutral</span></span>\n<span class="line"><span>056 neutral</span></span>\n<span class="line"><span>057 neutral</span></span>\n<span class="line"><span>058 neutral</span></span>\n<span class="line"><span>059 neutral</span></span>\n<span class="line"><span>060 neutral</span></span>\n<span class="line"><span>061 neutral</span></span>\n<span class="line"><span>062 neutral</span></span>\n<span class="line"><span>063 neutral</span></span>\n<span class="line"><span>064 neutral</span></span>\n<span class="line"><span>065 neutral</span></span>\n<span class="line"><span>066 neutral</span></span>\n<span class="line"><span>067 neutral</span></span>\n<span class="line"><span>068 neutral</span></span>\n<span class="line"><span>069 neutral</span></span>\n<span class="line"><span>070 neutral</span></span>\n<span class="line"><span>071 neutral</span></span>\n<span class="line"><span>072 neutral</span></span>\n<span class="line"><span>073 neutral</span></span>\n<span class="line"><span>074 neutral</span></span>\n<span class="line"><span>075 neutral</span></span>\n<span class="line"><span>076 neutral</span></span>\n<span class="line"><span>077 neutral</span></span>\n<span class="line"><span>078 neutral</span></span>\n<span class="line"><span>079 neutral</span></span>\n<span class="line"><span>080 neutral</span></span>\n<span class="line"><span>081 neutral</span></span>\n<span class="line"><span>082 neutral</span></span>\n<span class="line"><span>083 neutral</span></span>\n<span class="line"><span>084 neutral</span></span>\n<span class="line"><span>085 neutral</span></span>\n<span class="line"><span>086 neutral</span></span>\n<span class="line"><span>087 neutral</span></span>\n<span class="line"><span>088 neutral</span></span>\n<span class="line"><span>089 neutral</span></span>\n<span class="line"><span>090 neutral</span></span>\n<span class="line"><span>091 neutral</span></span>\n<span class="line"><span>092 neutral</span></span>\n<span class="line"><span>093 neutral</span></span>\n<span class="line"><span>094 neutral</span></span>\n<span class="line"><span>095 neutral</span></span>\n<span class="line"><span>096 neutral</span></span>\n<span class="line"><span>097 neutral</span></span>\n<span class="line"><span>098 neutral</span></span>\n<span class="line"><span>099 neutral</span></span>\n<span class="line"><span>100 neutral</span></span>\n<span class="line"><span>101 neutral</span></span>\n<span class="line"><span>102 neutral</span></span>\n<span class="line"><span>103 neutral</span></span>\n<span class="line"><span>104 neutral</span></span>\n<span class="line"><span>105 neutral</span></span>\n<span class="line"><span>106 neutral</span></span>\n<span class="line"><span>107 neutral</span></span>\n<span class="line"><span>108 neutral</span></span>\n<span class="line"><span>109 neutral</span></span>\n<span class="line"><span>110 neutral</span></span>\n<span class="line"><span>111 neutral</span></span>\n<span class="line"><span>112 neutral</span></span>\n<span class="line"><span>113 neutral</span></span>\n<span class="line"><span>114 neutral</span></span>\n<span class="line"><span>115 neutral</span></span>\n<span class="line"><span>116 neutral</span></span>\n<span class="line"><span>117 neutral</span></span>\n<span class="line"><span>118 neutral</span></span>\n<span class="line"><span>119 neutral</span></span>\n<span class="line"><span>120 END_GROK_UI</span></span></code></pre>'
    bundle=(runtime/"shared/ai_adapters.js").read_text()
    sources=[(n,(runtime/n).read_text()) for n in ["shared/conversation_identity.js","shared/web_file_attachment.js","shared/ai_delivery_capabilities.js"]]
    def button(label,attrs=""):
        return '<button aria-label="'+label+'" '+attrs+'>control</button>'
    send=button("Отправить",'type="submit" data-testid="chat-submit"')
    stop=button("Остановить ответ модели")
    voice=button("Перейти в голосовой режим (Ctrl+⇧O)")
    def staged(name="report.txt",busy=False):
        return '<div role="list" aria-label="Вложения в беседе"><div role="listitem"><button aria-label="Открыть вложение">'+('<span role="status" class="animate-spin">Обработка</span>' if busy else '')+'<span>'+name+'</span></button><button aria-label="Удалить это вложение">remove</button></div></div>'
    def root(text="",controls=None,extra="",attrs=""):
        return '<div class="flex flex-col gap-0 justify-center w-full relative items-center"><div class="query-bar"><div data-testid="chat-input"><div><div class="tiptap ProseMirror" contenteditable="true" role="textbox" aria-label="Задай Grok любой вопрос">'+escape(text)+'</div></div></div>'+extra+(voice if controls is None else controls)+'</div><input type="file" class="hidden" multiple '+attrs+'></div>'
    def turn(role,body="",card="",ident="response-test"):
        return '<div id="'+ident+'">'+card+'<div role="article" data-testid="'+role+'-message" aria-labelledby="heading-'+ident+'"><h2 id="heading-'+ident+'">'+role+'</h2><div class="relative"><div class="response-content-markdown">'+body+'</div></div></div></div>'
    filecard='<div><button aria-label="Открыть вложение"><span>report.txt</span></button></div>'
    desc='[{filename:"report.txt",byte_length:16}]'
    cases={}
    def case(name,html,js,expected):cases[name]=(html,js,expected)
    case("registered_adapter_and_profile",root(),"return [OzonAIAdapters.adapterForLocation('auto')?.id,OzonAIDeliveryCapabilities.profile('grok').status,BB2ConversationIdentity.providerForOrigin(location.origin)]",["grok","implemented","grok"])
    case("known_idle_ready",root(),"return a.classifyComposerControl(c).kind","ready")
    case("draft_send",root("draft",send),"return a.classifyComposerControl(c).kind","send_active")
    case("disabled_send",root("draft",button("Отправить",'type="submit" data-testid="chat-submit" disabled')),"return a.classifyComposerControl(c).kind","send_disabled")
    case("stop_inside_excludes_send",root("draft",send+stop),"return [a.classifyComposerControl(c).kind,a.sendButton(c)===null]",["stop",True])
    case("stop_outside_idle_root_excludes_send",root("draft",send)+stop,"return [a.classifyComposerControl(c).kind,a.sendButton(c)===null]",["stop",True])
    case("duplicate_stop_unknown",root("draft",send+stop+stop),"return a.classifyComposerControl(c).kind","unknown")
    case("unknown_submit_label_not_send",root("draft",button("other",'type="submit" data-testid="chat-submit"')),"return a.classifyComposerControl(c).kind","unknown")
    case("duplicate_submit_unknown",root("draft",send+send),"return a.classifyComposerControl(c).kind","unknown")
    case("busy_upload_not_ready",root(controls=send,extra=staged(busy=True)),"return [a.classifyComposerControl(c).kind,a.attachmentReady("+desc+")]",["busy",False])
    case("positive_ready_filename",root(controls=send,extra=staged()),"return a.attachmentReady("+desc+")",True)
    case("wrong_ready_filename",root(controls=send,extra=staged("wrong.txt")),"return a.attachmentReady("+desc+")",False)
    case("two_upload_cards_not_ready",root(controls=send,extra=staged()+staged()),"return a.attachmentReady("+desc+")",False)
    case("native_surface_exact_input",root(),"return [a.attachmentSurface().kind,a.attachmentSurface().input.multiple]",["file_input_v1",True])
    case("unobserved_accept_attr_not_surface",root(attrs='accept=".txt"'),"return a.attachmentSurface()",None)
    case("disabled_native_input_not_surface",root(attrs="disabled"),"return a.attachmentSurface()",None)
    case("draft_no_attachment_overwrite",root("draft",send),"return a.attachmentSurface()",None)
    case("staged_file_no_second_attach",root(controls=send,extra=staged()),"return a.attachmentSurface()",None)
    case("write_only_main_editor",root(),"a.setComposerText(c.composer,'ONE\\nTWO');return a.readComposerText(c.composer)","ONE\nTWO")
    case("stop_blocks_write",root("draft",stop),"let code='';try{a.setComposerText(c.composer,'NEW')}catch(e){code=e.code};return [code,a.readComposerText(c.composer)]",["COMPOSER_NOT_AVAILABLE","draft"])
    case("native_file_event_and_bytes",root(),"""return (async()=>{
      const s=a.attachmentSurface(),events=[];s.input.addEventListener('input',()=>events.push('input'));s.input.addEventListener('change',()=>events.push('change'));
      a.attachFiles(s,[new File(['BEGIN\\nMIDDLE\\nEND'],'report.txt',{type:'text/plain'})]);
      const f=s.input.files[0];return [f.name,f.size,await f.text(),events.includes('input'),events.includes('change')];
    })()""",["report.txt",16,"BEGIN\nMIDDLE\nEND",True,True])
    case("stale_native_surface_not_used",root(),"const s=a.attachmentSurface();history.pushState({},'',location.pathname+'-b');let code='';try{a.attachFiles(s,[new File(['x'],'report.txt')])}catch(e){code=e.code};return code","TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE")
    case("unsupported_file_not_attached",root(),"let code='';try{a.attachFiles(a.attachmentSurface(),[new File(['x'],'report.pdf')])}catch(e){code=e.code};return code","TARGET_AI_FILE_TYPE_UNSUPPORTED")
    case("actual_S08_roles",''.join(actual_messages)+root(),"return [a.userMessages().length,a.assistantMessages().length]",[2,2])
    case("actual_S08_file_outside_rolediv",''.join(actual_messages)+root(),"""const n=a.userMessages().find(n=>n.querySelector('button[aria-label="Открыть вложение"]'));
      const r=a.sentAttachmentMessage(n,[{filename:'octoport-ui-large.txt',byte_length:1048576}]);
      return Boolean(r&&r.text===a.messageText(n)&&r.text.trim());""",True)
    case("sent_card_separate_body",turn("user","<p>REPORT</p>",filecard)+root(),"return a.sentAttachmentMessage(a.userMessages()[0],"+desc+").text.trim()","REPORT")
    case("composer_card_not_sent",turn("user","<p>REPORT</p>")+root(controls=send,extra=staged()),"return a.sentAttachmentMessage(a.userMessages()[0],"+desc+")",None)
    case("assistant_file_not_user_delivery",turn("assistant","<p>REPORT</p>",filecard)+root(),"return a.sentAttachmentMessage(document.querySelector('div[id^=response]'),"+desc+")",None)
    case("wrong_sent_name",turn("user","<p>REPORT</p>",filecard.replace("report.txt","wrong.txt"))+root(),"return a.sentAttachmentMessage(a.userMessages()[0],"+desc+")",None)
    case("duplicate_message_ids_not_witness",turn("user","<p>A</p>")+turn("user","<p>B</p>")+root(),"return a.userMessages().map(n=>a.messageId(n))",["",""])
    code='<div data-testid="code-block"><div><div class="shiki">'+long_block+'</div></div></div>'
    case("full_120_code",turn("assistant",code)+root(),"const m=a.assistantMessages()[0],b=a.findCodeBlocks(m)[0],t=a.readCodeText(b);return [t.split('\\n').length,t.includes('120 END_GROK_UI')]",[120,True])
    case("Stop_blocks_completion",turn("assistant","<p>ready</p>")+root(controls=stop),"return a.messageComplete(a.assistantMessages()[0])",False)
    case("hidden_root_unavailable",'<div hidden>'+root()+'</div>',"return c===null",True)
    result={"status":"RUNNING","scope":"B02 Grok offline code; actual accepted S08 messages plus observed composer/input/card structural fixtures; not installed",
            "bundle_sha256":hashlib.sha256(bundle.encode()).hexdigest(),"cases":{}}
    failed=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True);context=browser.new_context(viewport={"width":1100,"height":800})
        context.route("**/*",lambda route:route.fulfill(status=200,content_type="text/html",body="<html></html>"));page=context.new_page()
        for name,(html,js,expected) in cases.items():
            try:
                page.goto("https://grok.com/c/fixture-a")
                page.set_content("<style>.hidden{display:none}</style>"+html)
                for n,source in sources:page.evaluate(source)
                page.evaluate(bundle)
                actual=page.evaluate("""js=>{const a=SellerAgentsGrokAdapter.create(OzonAIAdapters),c=a.composerContext();return new Function('a','c',js)(a,c)}""",js)
                assert actual==expected,{"actual":actual,"expected":expected};result["cases"][name]={"status":"PASS"}
            except Exception as exc:
                failed.append(name);result["cases"][name]={"status":"FAIL","error":str(exc)[:1000]}
        browser.close()
    result["status"]="FAIL" if failed else "PASS";result["failed"]=failed
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"cases":len(cases),"failed":failed}))
    return 1 if failed else 0



def run_b02_delivery_watch(runtime: Path, output: Path, only_provider=None):
    """Actual batch-watch source with isolated ordinary code-test dependencies.
    No provider requests, real AI Send, installed harness or abort reproduction.
    Signed profile/authority is tested separately in the existing worker suites.
    """
    output.mkdir(parents=True,exist_ok=True)
    content=(runtime/"content_script.js").read_text();worker=(runtime/"service_worker.js").read_text()
    start=content.index("  async function runBatchDeliveryWatch(")
    watch=content[start:content.index("\n  function stopManualComposerWait(",start)]
    start=worker.index("function expectedDeliveryConfirmationBasis(")
    basis=worker[start:worker.index("\nfunction legacyConversationKey(",start)]
    identity=(runtime/"shared/conversation_identity.js").read_text()
    application=(runtime/"shared/application.js").read_text()
    commit_start=application.index("      let granted = false, committedDelivery = null;")
    commit_source=application[commit_start:application.index("\n    }\n    if (message.type === \"OZ_WORK_START\")",commit_start)]
    recovery_start=worker.index("function manualBatchRecoveryPayload(")
    recovery_source=worker[recovery_start:worker.index("\n}\n",recovery_start)+3]

    result={"status":"RUNNING","scope":"B02 actual batch-watch confirmation code, synthetic button/turns; no authority or installed acceptance",
            "content_sha256":hashlib.sha256(content.encode()).hexdigest(),"worker_sha256":hashlib.sha256(worker.encode()).hexdigest(),"cases":{}}
    failures=[]
    origins={"chatgpt":"https://chatgpt.com","alice":"https://alice.yandex.ru","qwen":"https://chat.qwen.ai","kimi":"https://www.kimi.ai","grok":"https://grok.com","gemini":"https://gemini.google.com","claude":"https://claude.ai","deepseek":"https://chat.deepseek.com"}
    if only_provider:origins={only_provider:origins[only_provider]}
    script=r"""async ({id,origin,scenario,watch,basis})=>{
      const key=origin+'|local:fixture',old=document.createElement('div'),button=document.createElement('button');
      old.id='OLD';old.textContent=scenario==='old_matching'?'REPORT':'OLD BODY';document.body.append(old,button);
      const requiresEpoch=['claude','deepseek'].includes(id),epoch1='11111111-1111-4111-8111-111111111111',epoch2='22222222-2222-4222-8222-222222222222';
      let epoch=epoch1;
      const rows=[old],messages=[],commits=[],diagnostics=[];let clicks=0,wakes=0,stage=scenario.startsWith('restore')?'ready':'send';
      if(scenario.includes('empty_baseline')){rows.length=0;old.remove()}
      if(scenario==='remount_matching')old.textContent='REPORT';
      function add(text){const n=document.createElement('div');n.id='NEW';n.textContent=text;rows.push(n);document.body.append(n)}
      if(scenario.startsWith('restore'))add('REPORT');
      button.addEventListener('click',()=>{clicks++;stage='ready';if(['matching','empty_baseline_matching'].includes(scenario))add('REPORT');else if(scenario==='wrong_text')add('OTHER');else if(scenario.startsWith('remount')){epoch=epoch2;if(rows.length)rows[0].id='REMOUNTED';else add('REPORT')}});
      const adapter={id,userMessages:()=>rows,messageId:n=>n.id,messageText:n=>n.textContent,messageObservationEpoch:()=>epoch};
      const env={
        HTMLElement,current:()=>true,currentAIAdapter:()=>adapter,userTurnIds:()=>rows.map(n=>n.id),
        canonicalText:v=>String(v||'').replace(/\s+/g,' ').trim(),
        sameConversation:(o,c)=>o===origin&&c==='local:fixture',conversationKeyFromLocation:()=>key,
        classifyComposerControl:()=>stage==='send'?{kind:'send_active',button}:{kind:id==='chatgpt'?'microphone':id+'_ready',button:null},
        recordContentDiagnostic:(...args)=>diagnostics.push(args),diagnosticForControlKind:k=>k,
        visible:n=>n.isConnected,controlDisabled:n=>n.disabled,saCheckDelivery:async()=>{},
        saContentContext:{work_active:true},runtimeId:'fixture-actor',manualEnabled:false,manualConversationKey:key,
        setManualBridgeReady:()=>{},toast:()=>{},sleep:async()=>{},DELIVERY_WATCH_INTERVAL_MS:1,BB2ConversationIdentity,origin
      };
      env.messages=messages;env.commits=commits;env.wake=()=>wakes++;env.wakes=()=>wakes;
      env.commitEpoch=p=>{if(scenario==='commit_remount')epoch=epoch2;return p.user_observation_epoch};
      const code=basis+
        "\nlet activeDeliveryWatch=null;\n"+
        "function stopDeliveryWatch(){if(activeDeliveryWatch)activeDeliveryWatch.cancelled=true;activeDeliveryWatch=null}\n"+
        "async function waitForDeliveryWatchWake(s){env.wake();if(env.wakes()>=3)s.cancelled=true}\n"+
        "async function sendRuntime(type,payload){"+
          "if(type==='OZ_WORK_SEND_COMMIT'){env.commits.push(payload);return {ok:true,click_allowed:true,send_click_committed:true,chatgpt_user_baseline:payload.chatgpt_user_baseline,user_observation_epoch:env.commitEpoch(payload)}}"+
          "if(type==='OZ_BATCH_DELIVERY_COMPLETE'){env.messages.push(payload);return {ok:acceptedDeliveryConfirmationBasis(env.origin,payload.confirmation_basis)}}"+
          "throw new Error('unexpected message '+type);}\n"+
        watch+"\nreturn {run:runBatchDeliveryWatch,basis:expectedDeliveryConfirmationBasis(origin)};";
      const built=new Function('env',...Object.keys(env),code),api=built(env,...Object.values(env));
      const recovery={delivery_mode:'batch_watch_v1',owner_kind:'autorun',owner_id:'fixture-run',run_id:'fixture-run',origin,conversation_id:'local:fixture',conversation_key:key,delivery_id:'fixture-delivery',outgoing_text:'REPORT',send_click_committed:scenario.startsWith('restore')};
      if(scenario.startsWith('restore') && scenario!=='restore_missing')recovery.chatgpt_user_baseline=scenario.includes('empty_baseline')?[]:['OLD'];
      if(requiresEpoch && scenario.startsWith('restore') && !['restore_missing','restore_epoch_missing'].includes(scenario))
        recovery.user_observation_epoch=scenario==='restore_epoch_changed'||scenario==='restore_empty_baseline_changed'?epoch2:epoch1;
      const outcome=await api.run(recovery);
      return {ok:outcome.delivered===true,clicks,commits:commits.length,completions:messages.length,
        serializedBaseline:commits[0]?.chatgpt_user_baseline||null,confirmedId:messages[0]?.confirmed_user_turn_id||null,
        basis:messages[0]?.confirmation_basis||null,expectedBasis:api.basis,epoch:commits[0]?.user_observation_epoch||null,code:outcome.code||null};
    }"""
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True);context=browser.new_context()
        context.route("**/*",lambda route:route.fulfill(status=200,content_type="text/html",body="<html></html>"));page=context.new_page()
        for provider,origin in origins.items():
            scenarios=["matching","empty_ready","wrong_text","old_matching","restore_known","restore_missing"]
            if provider in ["claude","deepseek"]:
                scenarios+=["remount_matching","remount_empty_baseline","empty_baseline_matching","restore_epoch_changed","restore_epoch_missing","restore_empty_baseline_changed","restore_empty_baseline_known","commit_remount"]
            for scenario in scenarios:
                name=provider+"_"+scenario
                try:
                    page.goto(origin+"/fixture");page.set_content("<html><body></body></html>");page.evaluate(identity)
                    actual=page.evaluate(script,{"id":provider,"origin":origin,"scenario":scenario,"watch":watch,"basis":basis})
                    positive=scenario in ["matching","restore_known","empty_baseline_matching","restore_empty_baseline_known"]
                    assert actual["ok"] is positive,actual
                    assert actual["clicks"]==(0 if scenario.startswith("restore") or scenario=="commit_remount" else 1),actual
                    assert actual["commits"]==(0 if scenario.startswith("restore") else 1),actual
                    assert actual["completions"]==(1 if positive else 0),actual
                    expected="microphone" if provider=="chatgpt" else "alice_ready" if provider=="alice" else provider+"_user_turn_ready"
                    if positive:assert actual["basis"]==expected and actual["confirmedId"]=="NEW",actual
                    if not scenario.startswith("restore"):
                        assert actual["serializedBaseline"]==([] if "empty_baseline" in scenario else ["OLD"]),actual
                        if provider in ["claude","deepseek"]:assert actual["epoch"]=="11111111-1111-4111-8111-111111111111",actual
                    if scenario in ["remount_matching","remount_empty_baseline","restore_epoch_changed","restore_epoch_missing","restore_empty_baseline_changed","commit_remount"]:
                        assert actual["code"]=="DELIVERY_BASELINE_CHANGED",actual
                    assert actual["expectedBasis"]==expected,actual
                    result["cases"][name]={"status":"PASS"}
                except Exception as exc:
                    failures.append(name);result["cases"][name]={"status":"FAIL","error":str(exc)[:1100]}
        # Exercise the actual worker storage/ACK/recovery serializers with ordinary
        # empty, populated and legacy baselines. Authority dependencies are isolated;
        # these cases make no installed or authorization-test claim.
        worker_script=r"""async ({commitSource,recoverySource,kind})=>{
          const epoch='11111111-1111-4111-8111-111111111111';
          let saved={operation_id:'owner',tab_id:1,status:'delivering',conversation_key:'fixture',
            origin:'https://chat.deepseek.com',conversation_id:'fixture',
            delivery:{delivery_id:'delivery',mode:'batch_watch_v1',phase:'inserted'}};
          const baseline=kind==='populated'?['OLD']:[];
          const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
          const commit=new AsyncFunction('message','key','id','mutateManualOperation','saAssertDeliveryOwner','saError',commitSource);
          const mutate=async(key,fn)=>{saved=await fn(saved)},guard=async()=>{},error=code=>Object.assign(new Error(code),{code});
          const first=await commit({delivery_id:'delivery',actor_id:'actor',chatgpt_user_baseline:baseline,
            ...(kind==='legacy'?{}:{user_observation_epoch:epoch})},'fixture','owner',mutate,guard,error);
          const second=await commit({delivery_id:'delivery',actor_id:'actor',chatgpt_user_baseline:['LATER'],
            user_observation_epoch:'22222222-2222-4222-8222-222222222222'},'fixture','owner',mutate,guard,error);
          const recover=new Function('MANUAL_OPERATION_STATUSES',recoverySource+';return manualBatchRecoveryPayload')({DELIVERING:'delivering'});
          const recovery=recover(saved,'RECOVERY'),expected=kind==='legacy'?null:epoch;
          return {first:first.click_allowed,second:second.click_allowed,
            epoch:[saved.delivery.sa_user_observation_epoch,first.user_observation_epoch,second.user_observation_epoch,recovery.user_observation_epoch],
            baseline:[first.chatgpt_user_baseline,second.chatgpt_user_baseline,recovery.chatgpt_user_baseline],
            expected,baselineExpected:baseline,committed:recovery.send_click_committed};
        }"""
        for kind in ["empty","populated","legacy"]:
            name="worker_observation_epoch_"+kind
            try:
                actual=page.evaluate(worker_script,{"commitSource":commit_source,"recoverySource":recovery_source,"kind":kind})
                assert actual["first"] is True and actual["second"] is False and actual["committed"] is True,actual
                assert actual["epoch"]==[actual["expected"]]*4,actual
                assert actual["baseline"]==[actual["baselineExpected"]]*3,actual
                result["cases"][name]={"status":"PASS"}
            except Exception as exc:
                failures.append(name);result["cases"][name]={"status":"FAIL","error":str(exc)[:1100]}
        browser.close()
    result["status"]="FAIL" if failures else "PASS";result["failed"]=failures
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"cases":len(result["cases"]),"failed":failures}))
    return 1 if failures else 0




def deepseek_send_arrow_fixture():
    """Exact accepted native arrow; reused by ordinary offline DOM fixtures."""
    return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.3125 0.980206C8.66767 1.05312 8.97902 1.2042 9.2627 1.43235C9.48724 1.613 9.73029 1.85795 9.97949 2.10716L14.707 6.8347L13.293 8.24876L9 3.95579V15.0417H7V3.95579L2.70703 8.24876L1.29297 6.8347L6.02051 2.10716C6.26971 1.85795 6.51277 1.613 6.7373 1.43235C6.97662 1.23988 7.28445 1.04404 7.6875 0.980206C7.8973 0.947029 8.1031 0.955183 8.3125 0.980206Z" fill="currentColor"></path></svg>'

def deepseek_stop_square_fixture():
    """Exact square Stop observed in both 09:05 streaming snapshots; code fixture only."""
    return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4.88C2 3.68009 2 3.08013 2.30557 2.65954C2.40426 2.52371 2.52371 2.40426 2.65954 2.30557C3.08013 2 3.68009 2 4.88 2H11.12C12.3199 2 12.9199 2 13.3405 2.30557C13.4763 2.40426 13.5957 2.52371 13.6944 2.65954C14 3.08013 14 3.68009 14 4.88V11.12C14 12.3199 14 12.9199 13.6944 13.3405C13.5957 13.4763 13.4763 13.5957 13.3405 13.6944C12.9199 14 12.3199 14 11.12 14H4.88C3.68009 14 3.08013 14 2.65954 13.6944C2.52371 13.5957 2.40426 13.4763 2.30557 13.3405C2 12.9199 2 12.3199 2 11.12V4.88Z" fill="currentColor"></path></svg>'


def run_observed_composers(runtime: Path, output: Path, only_provider=None, extra_cases=None, case_names=None):
    """B02 observed DeepSeek/Claude upload transitions: offline code only."""
    from html import escape
    output.mkdir(parents=True, exist_ok=True)
    bundle=(runtime/"shared/ai_adapters.js").read_text()
    sources=[(runtime/n).read_text() for n in ["shared/conversation_identity.js","shared/web_file_attachment.js","shared/ai_delivery_capabilities.js"]]
    arrow=deepseek_send_arrow_fixture()
    cases={}
    for provider in ([only_provider] if only_provider else ["deepseek","claude"]):
        def send(disabled=False,icon=None):
            if provider=="deepseek":
                return '<div role="button" class="ds-button ds-button--primary _52c986b'+(' ds-button--disabled' if disabled else '')+'">'+(arrow if icon is None else icon)+'</div>'
            return '<button type="button" data-testid="chat-input-send" aria-label="Отправить сообщение" '+('disabled' if disabled else '')+'>send</button>'
        stop='<button data-testid="chat-input-stop" aria-label="Остановить ответ">stop</button>'
        def staged(name="report.txt"):
            if provider=="deepseek":
                return '<div class="cd314545"><div class="_158cea4"><div class="_967f3f9"><div class="e70accd6">'+name+'</div></div><div class="_7103a25 _078ccb5">TXT 1MB</div></div></div>'
            return '<div data-testid="file-thumbnail" data-cds="MessageAttachmentsFile"><span data-cds="CardLink" role="button" title="'+name+'">'+name+'</span><span data-cds="Badge"><bdi>TXT</bdi></span><button aria-label="Удалить: '+name+'">remove</button></div>'
        def root(text="",buttons=None,extra="",input_attrs=""):
            controls=send(True) if buttons is None else buttons
            if provider=="deepseek":
                return '<div class="_77cefa5 _3d616d3">'+extra+'<div class="_020ab5b"><div class="_24fad49"><textarea placeholder="Сообщение для DeepSeek">'+escape(text)+'</textarea></div><div class="bf38813a"><input type="file" multiple accept=".pdf,.txt,.csv" '+input_attrs+'>'+controls+'</div></div></div>'
            return '<div class="flex w-full min-w-0 flex-col"><div><div class="tiptap ProseMirror" data-testid="chat-input" contenteditable="true" role="textbox" aria-label="Напишите запрос для Claude">'+escape(text)+'</div></div>'+extra+controls+'<input type="file" id="chat-input-file-upload-bottom" data-testid="file-upload" multiple accept="" style="opacity:0;width:0;height:0" '+input_attrs+'></div>'
        def case(name,html,js,expected,wrong_origin=False):
            cases[provider+"_"+name]=(provider,html,js,expected,wrong_origin)
        # Reduced DOM attributes from same-card 20 Oct upload traces, not a
        # fabricated provider run. Enabled Send and TXT alone are deliberately insufficient.
        def observed_upload(loading=False,percent="0%",disabled=False,outer_input=False):
            if provider=="deepseek":
                card='<div class="cd314545"><div class="_1c3b90b">'+(
                    '<svg role="img" aria-label="'+percent+'"></svg><span class="ds-loading"><svg data-icon="spin"></svg></span>' if loading else '<svg data-icon="file"></svg>'
                    )+'</div><div class="_158cea4"><div class="_967f3f9"><div class="e70accd6">report.txt</div></div><div class="_7103a25 _078ccb5">'+(
                    'Загрузка...' if loading else 'TXT 154.34KB')+'</div></div><div class="_8402d8c" tabindex="0">remove</div></div>'
                return root(buttons=send(disabled).replace('role="button"','role="button" tabindex="0"'),
                    extra='<div class="b40079d7 _2113217"><div class="_6d1b417"><div class="ds-animated-size-item"><div class="_25c7358 dafb6286" tabindex="0">'+card+'</div></div></div></div>')
            card='<div data-cds="MessageAttachmentsFile" data-testid="file-thumbnail" data-cds-attachment tabindex="-1"'+(
                ' data-state="pending" aria-busy="true"' if loading else '')+'>'+(
                '<span class="sr-only">report.txt</span>' if loading else '<span data-cds="CardLink" role="button" tabindex="0" title="report.txt"><span class="sr-only">report.txt</span></span>')+(
                '<div class="invisible">' if loading else '<div>')+'<bdi title="report.txt">report.txt</bdi><span data-cds="Badge"><bdi>TXT</bdi></span></div>'+(
                '<div data-cds="Skeleton" role="status">Загрузка…</div>' if loading else '')+'<button data-cds-attachment-remove aria-label="Удалить: report.txt">remove</button></div>'
            markup=root(buttons=send(disabled),extra='<div data-cds-composer-attachments>'+card+'</div>').replace('<div class="flex w-full min-w-0 flex-col">','<div data-cds="ChatComposer" class="flex w-full min-w-0 flex-col">',1)
            if outer_input:
                input_start=markup.index('<input');input_end=markup.index('>',input_start)+1
                native=markup[input_start:input_end];markup=markup[:input_start]+markup[input_end:]
                markup='<div class="flex w-full min-w-0 flex-col">'+markup+native+'</div>'
            return markup
        ready=observed_upload()
        desc="[{filename:'report.txt',byte_length:16}]"
        check="return [a.attachmentReady("+desc+"),a.classifyComposerControl(c).kind]"
        case("observed_ready_file_only",ready,check,[True,"send_active"])
        case("observed_ready_disabled_send",observed_upload(disabled=True),check,[True,"send_disabled"])
        case("loading_enabled_send_not_ready",observed_upload(True),check,[False,"busy"])
        case("hundred_percent_is_still_loading",observed_upload(True,"100%"),check,[False,"busy"])
        case("ready_filename_must_match",ready,"return a.attachmentReady([{filename:'other.txt',byte_length:16}])",False)
        case("ready_wrong_type",ready.replace('>TXT','>PDF'),"return a.attachmentReady("+desc+")",False)
        case("ready_hidden_card",ready.replace('class="cd314545"','class="cd314545" hidden') if provider=="deepseek" else ready.replace('data-testid="file-thumbnail"','data-testid="file-thumbnail" hidden'),"return a.attachmentReady("+desc+")",False)
        case("ready_missing_remove_witness",ready.replace('class="_8402d8c"','class="unknown-remove"').replace('data-cds-attachment-remove','data-unknown-remove'),"return a.attachmentReady("+desc+")",False)
        case("ready_duplicate_card",ready,"const n=c.root.querySelector('.cd314545,[data-testid=file-thumbnail]');n.after(n.cloneNode(true));return a.attachmentReady("+desc+")",False)
        case("ready_unknown_status",ready,"const n=c.root.querySelector('._7103a25,[data-cds=Badge]');n.textContent='Processing';return a.attachmentReady("+desc+")",False)
        case("ready_descriptor_limits",ready,"return [a.attachmentReady([]),a.attachmentReady([{filename:'report.txt',byte_length:-1}]),a.attachmentReady([{filename:'report.txt',byte_length:1048577}]),a.attachmentReady([{filename:'report.txt',byte_length:1.5}]),a.attachmentReady(["+desc[1:-1]+","+desc[1:-1]+"])]",[False]*5)
        case("ready_native_file_bytes",ready,"const i=c.root.querySelector('input'),d=new DataTransfer();d.items.add(new File(['1234567890123456'],'report.txt'));i.files=d.files;return [a.attachmentReady("+desc+"),a.attachmentReady([{filename:'report.txt',byte_length:15}])]",[True,False])
        case("ready_native_filename_mismatch",ready,"const i=c.root.querySelector('input'),d=new DataTransfer();d.items.add(new File(['1234567890123456'],'other.txt'));i.files=d.files;return a.attachmentReady("+desc+")",False)
        case("ready_stale_context",ready,"c.root.replaceWith(c.root.cloneNode(true));return a.classifyComposerControl(c).kind","unknown")
        case("same_card_loading_to_ready",observed_upload(True),"const card=c.root.querySelector('.cd314545,[data-testid=file-thumbnail]'),before=a.attachmentReady("+desc+");const doc=new DOMParser().parseFromString("+json.dumps(ready)+",'text/html'),n=doc.querySelector('.cd314545,[data-testid=file-thumbnail]');for(const x of [...card.attributes])card.removeAttribute(x.name);for(const x of n.attributes)card.setAttribute(x.name,x.value);card.innerHTML=n.innerHTML;return [before,card.isConnected,a.attachmentReady("+desc+")]",[False,True,True])
        case("cleanup_returns_empty_ready",ready,"c.root.querySelector('.b40079d7,[data-cds-composer-attachments]').remove();return [a.attachmentReady("+desc+"),a.classifyComposerControl(c).kind,!!a.attachmentSurface()]",[False,"ready",True])
        if provider=="deepseek":
            case("hundred_without_spin_still_not_ready",observed_upload(True,"100%").replace('<span class="ds-loading"><svg data-icon="spin"></svg></span>',''),"return a.attachmentReady("+desc+")",False)
            case("ready_arrow_without_tabindex_unknown",ready.replace('role="button" tabindex="0"','role="button"'),check,[False,"unknown"])
            case("loading_status_without_spinner_unknown",observed_upload(True).replace('<svg role="img" aria-label="0%"></svg><span class="ds-loading"><svg data-icon="spin"></svg></span>',''),check,[False,"unknown"])
        else:
            case("semantic_root_external_native_input",observed_upload(outer_input=True),check,[True,"send_active"])
            empty_semantic=observed_upload(outer_input=True)
            case("external_native_input_attach",empty_semantic,"c.root.querySelector('[data-cds-composer-attachments]').remove();const s=a.attachmentSurface();a.attachFiles(s,[new File(['1234567890123456'],'report.txt')]);return [s.root===c.root,s.inputRoot!==c.root,s.input.files[0].size]",[True,True,16])
            case("semantic_root_no_input_no_attach",ready,"c.root.querySelector('input').remove();c.root.querySelector('[data-cds-composer-attachments]').remove();return [!!a.composerContext(),a.attachmentSurface()]",[True,None])
            case("txt_and_enabled_send_under_skeleton_not_ready",observed_upload(True).replace(' data-state="pending" aria-busy="true"',''),check,[False,"busy"])
            case("pending_without_skeleton_not_ready",ready.replace('data-cds-attachment tabindex','data-state="pending" data-cds-attachment tabindex'),check,[False,"busy"])
            case("invisible_badge_not_ready",ready.replace('<div><bdi title','<div class="invisible"><bdi title'),check,[False,"unknown"])
        case("factory_route_status",root(),"return [a.id,a.integrationStatus().status,a.integrationStatus().registry_activated,OzonAIAdapters.adapterForLocation('auto')?.id===a.id]",[provider,"implemented",True,True])
        case("one_observed_composer",root(),"return !!c",True)
        case("observed_empty_send_state",root(),"return a.classifyComposerControl(c).kind","ready")
        if provider=="deepseek":
            observed_stop=send(False,deepseek_stop_square_fixture())
            case("observed_square_stop",root(buttons=observed_stop),"return [a.classifyComposerControl(c).kind,a.isGenerating(),a.sendButton(c),a.attachmentSurface()]",["stop",True,None,None])
            case("stop_with_draft_not_send",root("DRAFT",observed_stop),"return [a.classifyComposerControl(c).kind,a.sendButtonCandidates(c).length]",["stop",0])
            case("stop_set_text_closed",root(buttons=observed_stop),"try{a.setComposerText(c.composer,'DRAFT');return 'unexpected'}catch(e){return e.code}","COMPOSER_NOT_AVAILABLE")

        case("draft_enabled_send",root("draft",send()),"return [a.classifyComposerControl(c).kind,!!a.sendButton(c)]",["send_active",True])
        case("duplicate_send_unknown",root("draft",send()+send()),"return [a.classifyComposerControl(c).kind,a.sendButton(c)]",["unknown",None])
        case("progress_excludes_send",root("draft",send(),'<div role="progressbar">loading</div>'),"return [a.classifyComposerControl(c).kind,a.sendButton(c)]",["busy",None])
        case("hidden_editor_unavailable",'<div hidden>'+root()+'</div>',"return c",None)
        case("zero_size_editor_unavailable",root().replace('placeholder="Сообщение для DeepSeek"','style="width:0;height:0;padding:0;border:0" placeholder="Сообщение для DeepSeek"') if provider=="deepseek" else root().replace('class="tiptap ProseMirror"','style="display:none" class="tiptap ProseMirror"'),"return c",None)
        case("duplicate_editors_unknown",root()+root(),"return c",None)
        case("outside_controls_not_selected",root(buttons="")+send(),"return a.classifyComposerControl(c).kind","unknown")
        case("dialog_editor_excluded",'<div role="dialog">'+root()+'</div>',"return c",None)
        case("message_editor_excluded",'<div class="ds-message" data-testid="user-message">'+root()+'</div>',"return c",None)
        case("read_write_multiline",root(),"a.setComposerText(c.composer,'ONE\\nTWO');return a.readComposerText(c.composer)","ONE\nTWO")
        case("changed_url_rejects_context",root("draft",send()),"history.pushState({},'',location.pathname+'-b');return a.classifyComposerControl(c).kind","unknown")
        case("replaced_composer_rejects_context",root("draft",send()),"c.composer.replaceWith(c.composer.cloneNode(true));return a.classifyComposerControl(c).kind","unknown")
        case("wrong_origin_no_composer",root(),"return [a.matchesLocation(),c]",[False,None],True)
        case("observed_native_file_input",root(),"const s=a.attachmentSurface();return [s?.kind,s?.input.multiple]",["file_input_v1",True])
        case("disabled_input_unavailable",root(input_attrs="disabled"),"return a.attachmentSurface()",None)
        case("second_file_input_unavailable",root(extra='<input type="file" multiple>'),"return c",None)
        case("draft_preserved_no_attach",root("draft",send()),"return [a.attachmentSurface(),a.readComposerText(c.composer)]",[None,"draft"])
        case("staged_card_is_preview_only",root(buttons=send(),extra=staged()),"return [!!a.attachmentPreview('report.txt'),a.attachmentReady([{filename:'report.txt',byte_length:16}]),a.attachmentSurface()]",[True,False,None])
        case("wrong_filename_not_preview",root(buttons=send(),extra=staged("wrong.txt")),"return a.attachmentPreview('report.txt')",None)
        case("duplicate_card_not_preview",root(buttons=send(),extra=staged()+staged()),"return a.attachmentPreview('report.txt')",None)
        case("outside_card_not_preview",root()+staged(),"return a.attachmentPreview('report.txt')",None)
        case("no_synthetic_message_identity",root(),"const n=document.createElement('div');n.id='unverified';n.setAttribute('data-turn-key','unverified');return [a.messageId(n),a.messageComplete(n),a.sentAttachmentMessage(n,[{filename:'report.txt',byte_length:16}])]",["",False,None])
        case("native_file_bytes_and_events",root(),"""return (async()=>{
          const s=a.attachmentSurface(),events=[];s.input.addEventListener('input',()=>events.push('input'));s.input.addEventListener('change',()=>events.push('change'));
          a.attachFiles(s,[new File(['BEGIN\\nMIDDLE\\nEND'],'report.txt',{type:'text/plain'})]);
          const f=s.input.files[0];return [f.name,f.size,await f.text(),events.includes('input'),events.includes('change')];
        })()""",["report.txt",16,"BEGIN\nMIDDLE\nEND",True,True])
        case("stale_file_surface_rejected",root(),"const s=a.attachmentSurface();history.pushState({},'',location.pathname+'-b');let error='';try{a.attachFiles(s,[new File(['x'],'report.txt')])}catch(e){error=e.code}return error","TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE")
        case("unsupported_file_rejected",root(),"let error='';try{a.attachFiles(a.attachmentSurface(),[new File(['x'],'report.pdf')])}catch(e){error=e.code}return error","TARGET_AI_FILE_TYPE_UNSUPPORTED")
        case("second_attach_preserves_file",root(),"const s=a.attachmentSurface();a.attachFiles(s,[new File(['FIRST'],'report.txt')]);let error='';try{a.attachFiles(s,[new File(['SECOND'],'report.txt')])}catch(e){error=e.code}return [error,s.input.files[0].size] ",["TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE",5])
        case("changed_accept_unavailable",root(),"c.root.querySelector('input').setAttribute('accept','.pdf');return a.attachmentSurface()",None)
        if provider=="deepseek":
            case("captured_spin_busy_not_stop",root(buttons=send(True,'<svg data-icon="spin"><path d="busy"/></svg>')),"return [a.classifyComposerControl(c).kind,a.sendButton(c)]",["busy",None])
            case("unknown_icon_not_send",root("draft",send(False,'<svg><path d="UNKNOWN"/></svg>')),"return a.classifyComposerControl(c).kind","unknown")
            case("busy_blocks_text_write",root("draft",send(False,'<svg data-icon="spin"><path d="busy"/></svg>')),"let error='';try{a.setComposerText(c.composer,'NEW')}catch(e){error=e.code}return [error,a.readComposerText(c.composer)]",["COMPOSER_NOT_AVAILABLE","draft"])
        else:
            case("captured_stop_excludes_send",root("draft",send()+stop),"return [a.classifyComposerControl(c).kind,a.sendButton(c)]",["stop",None])
            case("stop_outside_idle_root_excludes_send",root("draft",send())+stop,"return [a.classifyComposerControl(c).kind,a.sendButton(c)]",["stop",None])
            case("stop_blocks_text_write",root("draft",stop),"let error='';try{a.setComposerText(c.composer,'NEW')}catch(e){error=e.code}return [error,a.readComposerText(c.composer)]",["COMPOSER_NOT_AVAILABLE","draft"])
            case("null_streaming_not_completion",root()+'<div data-testid="assistant-message">answer</div>',"return a.messageComplete(document.querySelector('[data-testid=assistant-message]'))",False)
            case("null_streaming_not_ready_or_upload",root()+'<div data-testid="assistant-message">answer</div>',"return [a.classifyComposerControl(c).kind,a.attachmentSurface()]",["unknown",None])
            case("explicit_streaming_blocks_send",root("draft",send())+'<div data-testid="assistant-message" data-is-streaming="true">answer</div>',"return [a.classifyComposerControl(c).kind,a.sendButton(c)]",["busy",None])
            case("explicit_false_clears_streaming_signal",root("draft",send())+'<div data-testid="assistant-message" data-is-streaming="false">answer</div>',"return a.classifyComposerControl(c).kind","send_active")
            case("null_streaming_blocks_write",root("draft",send())+'<div data-testid="assistant-message">answer</div>',"let error='';try{a.setComposerText(c.composer,'NEW')}catch(e){error=e.code}return [error,a.readComposerText(c.composer)]",["COMPOSER_NOT_AVAILABLE","draft"])

    if extra_cases:
        assert not set(extra_cases).intersection(cases)
        cases.update(extra_cases)
    if case_names is not None:
        assert set(case_names).issubset(cases), set(case_names)-set(cases)
        cases={k:v for k,v in cases.items() if k in case_names}
    result={"status":"RUNNING","scope":"B02 observed DeepSeek/Claude composer/native-input primitives only; no provider/UI/network/registry activation or delivery acceptance","bundle_sha256":hashlib.sha256(bundle.encode()).hexdigest(),"cases":{}}
    failures=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True);context=browser.new_context(viewport={"width":1100,"height":800})
        context.route("**/*",lambda route:route.fulfill(status=200,content_type="text/html",body="<html></html>"));page=context.new_page()
        for name,(provider,html,js,expected,wrong_origin) in cases.items():
            try:
                origin="https://example.invalid" if wrong_origin else ("https://chat.deepseek.com" if provider=="deepseek" else "https://claude.ai")
                page.goto(origin+"/chat/fixture-a");page.set_content(html)
                for code in sources:page.evaluate(code)
                page.evaluate(bundle)
                actual=page.evaluate("""({provider,js})=>{
                  const factory=provider==='deepseek'?SellerAgentsDeepSeekAdapter:SellerAgentsClaudeAdapter;
                  const a=factory.create(OzonAIAdapters),c=a.composerContext();return new Function('a','c',js)(a,c);
                }""",{"provider":provider,"js":js})
                assert actual==expected,{"actual":actual,"expected":expected}
                result["cases"][name]={"status":"PASS"}
            except Exception as exc:
                failures.append(name);result["cases"][name]={"status":"FAIL","error":str(exc)[:1200]}
        browser.close()
    result["status"]="FAIL" if failures else "PASS";result["failed"]=failures
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"cases":len(cases),"failed":failures}))
    return 1 if failures else 0



def run_parent_roots(runtime: Path, output: Path, only_provider=None, case_names=None):
    """Composed observed attributes, not a captured whole-page DOM.
    Ordinary message append/remount and code-selection tests; all routes local.
    Native/DOM witnesses are document-only, never permanent chat IDs.
    """
    output.mkdir(parents=True,exist_ok=True)
    bundle=(runtime/"shared/ai_adapters.js").read_text()
    sources=[(runtime/n).read_text() for n in ["shared/conversation_identity.js","shared/web_file_attachment.js","shared/ai_delivery_capabilities.js"]]
    port=(runtime/"attachment_delivery_port_content.js").read_text()
    port_helpers=port[port.index("  function normalizeText("):port.index("\n",port.index("  function normalizeText("))]
    port_helpers+="\n"+port[port.index("  function identity("):port.index("  function status(")]
    port_helpers+="\n"+port[port.index("  function matchingNewUserTurn("):port.index("  async function failDelivery(")]
    cases={}
    for provider in ([only_provider] if only_provider else ["deepseek","claude"]):
        if provider=="deepseek":
            user='<div class="_9663006"><div class="d29f3d7d ds-message _63c77b1"><div class="ds-collapsible-text">USER BODY</div></div></div>'
            assistant='<div class="_4f9bf79 _43c05b5"><div class="ds-message _63c77b1"><div class="ds-markdown ds-assistant-message-main-content"><div class="md-code-block"><pre>CODE ONE\nCODE TWO</pre></div></div></div></div>'
            composer='<div class="_77cefa5 _3d616d3"><div class="_020ab5b"><textarea placeholder="Сообщение для DeepSeek"></textarea><input type="file" multiple accept=".txt"><div role="button" class="ds-button ds-button--primary _52c986b ds-button--disabled">'+deepseek_send_arrow_fixture()+'</div></div></div>'
            html='<div class="ds-virtual-list ds-virtual-list--printable _2bd7b35"><div class="ds-virtual-list-items _6f2c522"><div class="ds-virtual-list-visible-items">'+user+assistant+'</div></div>'+composer+'</div>'
        else:
            user='<div role="article"><div class="relative flex min-w-0 flex-col gap-xs"><div id="_r_5u_"><div class="cds-user-message-body"><div data-testid="user-message">USER BODY</div></div></div></div></div>'
            assistant='<div role="article"><div class="contents"><div class="mt-xs"><div class="group group/message-row min-w-0"><div data-testid="assistant-message" data-turn-key="01a152d2-461b-71bf-b3b2-d887f0ede3c6" data-is-streaming="false"><div role="group"><pre class="code-block__code"><code>CODE ONE\nCODE TWO</code></pre><button data-testid="code-block-copy">copy</button></div></div></div></div></div></div>'
            composer='<div class="flex w-full min-w-0 flex-col"><div data-testid="chat-input" role="textbox" contenteditable="true"></div><input type="file" multiple accept="" id="chat-input-file-upload-bottom" data-testid="file-upload"><button data-testid="chat-input-send" aria-label="Отправить сообщение" disabled>send</button></div>'
            html='<div data-testid="chat-column">'+user+assistant+composer+'</div>'
        def case(name,js,expected,markup=html):
            cases[provider+"_"+name]=(provider,markup,js,expected)
        # Previously accepted S09 DS user/card and Claude S08 completed/1135 article ownership.
        dcard='<div class="eafda4ae"><div class="_25c7358 dafb6286" tabindex="0"><div class="cd314545"><div class="_1c3b90b"></div><div class="_158cea4"><div class="_967f3f9"><div class="e70accd6">report.txt</div></div><div class="_7103a25 _078ccb5">TXT 1MB</div></div></div></div></div>'
        ccard='<div class="group/thumbnail" data-testid="file-thumbnail"><button type="button"><div><h3>report.txt</h3></div><div><p class="uppercase">txt</p></div></button></div>'
        card=dcard if provider=="deepseek" else ccard
        install=("u.insertAdjacentHTML('afterbegin',"+json.dumps(card)+");") if provider=="deepseek" else ("u.closest('[role=article]').insertAdjacentHTML('afterbegin',"+json.dumps(card)+");")
        descriptor="[{filename:'report.txt',byte_length:16}]"
        read="a.sentAttachmentMessage(u,"+descriptor+")"
        case("owned_sent_file_excludes_card_text",install+"return "+read,{"text":"USER BODY"})
        case("sent_filename_mismatch",install+"return a.sentAttachmentMessage(u,[{filename:'other.txt',byte_length:16}])",None)
        case("sent_wrong_role",install+"return a.sentAttachmentMessage(v,"+descriptor+")",None)
        case("sent_hidden_card",install+"u.closest('.ds-message,[role=article]').querySelector('.cd314545,[data-testid=file-thumbnail]').hidden=true;return "+read,None)
        case("sent_duplicate_card",install+"const n=u.closest('.ds-message,[role=article]').querySelector('.eafda4ae,[data-testid=file-thumbnail]');n.after(n.cloneNode(true));return "+read,None)
        case("sent_loading_card",install+"u.closest('.ds-message,[role=article]').querySelector('.cd314545,[data-testid=file-thumbnail]').insertAdjacentHTML('beforeend','<div role=\"progressbar\">loading</div>');return "+read,None)
        case("sent_missing_descriptor",install+"return a.sentAttachmentMessage(u,[])",None)
        case("sent_card_wrong_owner",install+"const n=u.closest('.ds-message,[role=article]').querySelector('.eafda4ae,[data-testid=file-thumbnail]');a.composerContext().root.append(n);return "+read,None)
        case("sent_text_without_card", "return "+read,None)
        setup=install+"await SellerAgentsConversationSurface.ready(a);const i=identity(),recovery={origin:i.origin,conversation_id:i.conversation_id,conversation_key:conversationKey(),outgoing_text:'USER BODY',artifact_descriptors:"+descriptor+"},baseline=new Set(a.userMessages().map(n=>a.messageId(n)));"
        append=("const clone=u.parentElement.cloneNode(true);u.parentElement.parentElement.append(clone);") if provider=="deepseek" else ("const clone=u.closest('[role=article]').cloneNode(true);clone.querySelector('[id]').id='_r_new_';a.conversationRoot().insertBefore(clone,a.composerContext().root);")
        case("port_new_owned_file_match",setup+append+"return !!(await waitMatchingUserTurn(recovery,baseline,10))",True)
        case("port_old_file_not_reconfirmed",setup+"return await waitMatchingUserTurn(recovery,baseline,10)",None)
        case("port_remount_not_new_sent_file",setup+"u.replaceWith(u.cloneNode(true));return [sameConversation(recovery),await waitMatchingUserTurn(recovery,baseline,10)]",[False,None])
        case("port_wrong_conversation_no_match",setup+append+"recovery.conversation_id='other';return await waitMatchingUserTurn(recovery,baseline,10)",None)
        # Clearing confirmed history is not a new Start. The document tracker
        # must not confirm the OLD recovery even if a new surface is confirmed.
        case("port_empty_history_requires_start_witness",setup+"u.closest(a.id==='claude'?'[role=article]':'._9663006').remove();v.closest(a.id==='claude'?'[role=article]':'._4f9bf79').remove();SellerAgentsConversationSurface.confirmCurrent(a);await SellerAgentsConversationSurface.ready(a);const empty=identity();recovery.conversation_id=empty.conversation_id;recovery.conversation_key=conversationKey();const html="+json.dumps(user)+";if(a.id==='claude'){a.conversationRoot().insertAdjacentHTML('afterbegin',html)}else a.conversationRoot().querySelector('.ds-virtual-list-visible-items').insertAdjacentHTML('beforeend',html);const fresh=a.userMessages()[0];"+install.replace('u.','fresh.')+"return [sameConversation(recovery),await waitMatchingUserTurn(recovery,new Set(),10)]",[False,None])
        case("port_empty_root_remount_no_match",setup+"u.remove();v.remove();SellerAgentsConversationSurface.confirmCurrent(a);await SellerAgentsConversationSurface.ready(a);const empty=identity();recovery.conversation_id=empty.conversation_id;recovery.conversation_key=conversationKey();const root=a.conversationRoot();root.replaceWith(root.cloneNode(true));return [sameConversation(recovery),await waitMatchingUserTurn(recovery,new Set(),10)]",[False,None])
        case("observed_root_roles", "return [!!a.conversationRoot(),a.userMessages().length,a.assistantMessages().length,a.messageText(u).trim()]",[True,1,1,"USER BODY"])
        case("full_assistant_code","return a.findCodeBlocks(v).map(n=>a.readCodeText(n))",["CODE ONE\nCODE TWO"])
        case("user_has_no_code","return a.findCodeBlocks(u).length",0)
        case("document_witness_distinct_stable","const x=a.messageId(u),y=a.messageId(v);return [x.startsWith('local:'),y.startsWith('local:'),x!==y,x===a.messageId(u)]",[True,True,True,True])
        case("no_identity_attribute_written","return [u.id,u.getAttribute('data-conversation-id'),v.getAttribute('data-conversation-id')]",["",None,None])
        case("append_keeps_existing_witness","const id=a.messageId(u),copy=u.parentElement.cloneNode(true);if(a.id==='claude'){copy.parentElement;const wrap=u.closest('[role=article]').cloneNode(true);wrap.querySelector('[id]').id='_r_new_';a.conversationRoot().insertBefore(wrap,a.composerContext().root)}else u.parentElement.parentElement.append(copy);return a.messageId(u)===id",True)
        case("assistant_growth_keeps_user_witness","const id=a.messageId(u);v.querySelector('pre').textContent+=' MORE';return a.messageId(u)===id",True)
        case("user_edit_retires_epoch","const id=a.messageId(v);u.firstElementChild?u.firstElementChild.textContent='EDITED':u.textContent='EDITED';return a.messageId(v)!==id",True)
        case("remount_retires_all_witnesses","const id=a.messageId(v);u.replaceWith(u.cloneNode(true));return a.messageId(v)!==id",True)
        case("explicit_epoch_remount","const epoch=a.messageObservationEpoch();u.replaceWith(u.cloneNode(true));return [!!epoch,a.messageObservationEpoch()!==epoch]",[True,True])
        case("empty_observation_epoch","u.remove();v.remove();const epoch=a.messageObservationEpoch();return [!!epoch,a.userMessages().length,epoch===a.messageObservationEpoch()]",[True,0,True])
        case("root_replacement_retires_empty_epoch","u.remove();v.remove();const root=a.conversationRoot(),epoch=a.messageObservationEpoch();root.replaceWith(root.cloneNode(true));return [!!epoch,a.messageObservationEpoch()!==epoch]",[True,True])
        case("remove_retires_all_witnesses","const id=a.messageId(v);u.remove();return a.messageId(v)!==id",True)
        case("path_change_retires_witness","const id=a.messageId(u);history.pushState({},'',location.pathname+'-b');return a.messageId(u)!==id",True)
        case("unknown_upload_not_ready","return [a.attachmentReady([{filename:'report.txt',byte_length:16}]),a.sentAttachmentMessage(u,[{filename:'report.txt',byte_length:16}])]",[False,None])
        case("completion_boundary","return a.messageComplete(v)",provider=="claude")
        case("root_identity_document_only","const i=await SellerAgentsConversationSurface.ready(a);return [i.status,i.identity_scope,i.conversation_id?.startsWith('local:')]",["confirmed","document",True])
        case("remount_suspends_old_conversation","await SellerAgentsConversationSurface.ready(a);u.replaceWith(u.cloneNode(true));const i=await SellerAgentsConversationSurface.ready(a);return [i.status,i.conversation_id,i.source]",["unknown",None,"history_continuity_unverified"])
        case("missing_root_no_body_fallback","const root=a.conversationRoot();if(a.id==='claude')root.removeAttribute('data-testid');else root.classList.remove('_2bd7b35');const i=await SellerAgentsConversationSurface.ready(a);return [a.conversationRoot(),a.userMessages().length,i.status]",[None,0,"unknown"])
        case("composer_outside_root_not_owned","document.body.append(a.composerContext().root);return [a.conversationRoot(),a.userMessages().length]",[None,0])
        case("wrong_parent_not_message","u.parentElement.className='unobserved';return a.userMessages().length",0)
        if provider=="claude":
            case("native_turn_key_used_locally","return [a.messageId(v).endsWith(':assistant:01a152d2-461b-71bf-b3b2-d887f0ede3c6'),a.messageId(u).endsWith(':user:_r_5u_')]",[True,True])
            case("missing_turn_key_not_complete","v.removeAttribute('data-turn-key');return [a.messageId(v),a.messageComplete(v)]",["",False])
            case("first_turn_key_assignment_keeps_user","v.removeAttribute('data-turn-key');const id=a.messageId(u);v.setAttribute('data-turn-key','01a152d2-461b-71bf-b3b2-d887f0ede3c6');return [a.messageId(u)===id,!!a.messageId(v)]",[True,True])
            case("missing_streaming_not_ready","v.removeAttribute('data-is-streaming');return [a.messageComplete(v),a.classifyComposerControl(a.composerContext()).kind]",[False,"unknown"])
            case("observed_stop_blocks_completion","document.body.insertAdjacentHTML('beforeend','<button data-testid=\"chat-input-stop\" aria-label=\"Остановить ответ\">stop</button>');return [a.messageComplete(v),a.classifyComposerControl(a.composerContext()).kind]",[False,"stop"])
            case("observed_file_route","const p=a.deliveryCapabilities();return [p.status,p.attachment_strategy,p.attachment_pending_reason??null]",["implemented","file_input_v1",None])
        else:
            case("no_native_identity_inferred","return [u.getAttribute('data-turn-key'),v.getAttribute('data-message-id'),a.integrationStatus().registry_activated]",[None,None,True])
            # Minimal composed fixture from accepted 07:56 action attributes.
            # Boxes stand in for unlabeled SVG geometry; no icon meaning inferred.
            buttons=''.join('<div role="button" tabindex="0" class="ds-button db183363" style="width:18px;height:18px"'+(' aria-disabled="false"' if i==1 else '')+(' aria-label="Читать вслух"' if i==4 else '')+'></div>' for i in range(6))
            toolbar='<div class="ds-flex _0a3d93b"><div class="ds-flex _965abe9 _54866f7">'+buttons+'</div><div style="flex:1"></div></div>'
            terminal=html.replace(assistant,assistant[:-6]+toolbar+'</div>')
            def terminal_case(name,js,expected):
                case("terminal_"+name,js,expected,terminal)
            terminal_case("observed_natural_terminal","const e=a.completionObservation(v);return [e.status,e.reason,e.actionsObserved,a.messageComplete(v)]",["complete","observed_natural_terminal_toolbar",True,True])
            terminal_case("snapshot_key_not_identity","const id=a.messageId(v);v.parentElement.setAttribute('data-virtual-list-item-key','10');const first=a.completionObservation(v);v.parentElement.setAttribute('data-virtual-list-item-key','999');return [first.actionsObserved,a.completionObservation(v).actionsObserved,a.messageId(v)===id]",[True,True,True])
            terminal_case("terminal_text_not_capture_marker","v.querySelector('pre').textContent=Array.from({length:600},(_,i)=>i+1).join('\\n');return [a.completionObservation(v).actionsObserved,a.messageComplete(v)]",[True,True])
            terminal_case("missing_label_unrecognized","v.nextElementSibling.querySelector('[aria-label]').removeAttribute('aria-label');return a.completionObservation(v).actionsObserved",False)
            terminal_case("second_disabled_unrecognized","v.nextElementSibling.querySelector('[aria-disabled]').setAttribute('aria-disabled','true');return a.completionObservation(v).actionsObserved",False)
            terminal_case("second_state_absent_unrecognized","v.nextElementSibling.querySelector('[aria-disabled]').removeAttribute('aria-disabled');return a.completionObservation(v).actionsObserved",False)
            terminal_case("hidden_action_unrecognized","v.nextElementSibling.querySelector('[role=button]').hidden=true;return a.completionObservation(v).actionsObserved",False)
            terminal_case("hidden_toolbar_unrecognized","v.nextElementSibling.hidden=true;return a.completionObservation(v).actionsObserved",False)
            terminal_case("five_buttons_unrecognized","v.nextElementSibling.querySelector('[role=button]').remove();return a.completionObservation(v).actionsObserved",False)
            terminal_case("seven_buttons_unrecognized","const group=v.nextElementSibling.firstElementChild;group.append(group.firstElementChild.cloneNode(true));return a.completionObservation(v).actionsObserved",False)
            terminal_case("foreign_toolbar_ignored","document.body.append(v.nextElementSibling);return a.completionObservation(v).actionsObserved",False)
            terminal_case("nested_toolbar_not_sibling","v.append(v.nextElementSibling);return a.completionObservation(v).actionsObserved",False)
            terminal_case("extra_sibling_ambiguous","v.parentElement.append(document.createElement('div'));return a.completionObservation(v).actionsObserved",False)
            terminal_case("spinner_veto","a.composerContext().root.insertAdjacentHTML('beforeend','<span data-icon=\"spin\">busy</span>');const e=a.completionObservation(v);return [e.reason,e.actionsObserved,a.messageComplete(v)]",["composer_busy_or_unknown",False,False])
            terminal_case("unknown_primary_control_veto","a.composerContext().root.querySelector('svg path').setAttribute('d','unobserved');return a.completionObservation(v).actionsObserved",False)
            terminal_case("file_card_not_upload_ready","a.composerContext().root.insertAdjacentHTML('beforeend','<div class=\"cd314545\">report.txt</div>');return [a.completionObservation(v).actionsObserved,a.attachmentReady([{filename:'report.txt',byte_length:10}])]",[False,False])
            terminal_case("only_current_assistant","v.parentElement.parentElement.append(v.parentElement.cloneNode(true));return [a.completionObservation(v).actionsObserved,a.completionObservation(a.assistantMessages().at(-1)).actionsObserved]",[False,True])
            terminal_case("detached_assistant_ignored","v.remove();return a.completionObservation(v).actionsObserved",False)
            stop_svg=json.dumps(deepseek_stop_square_fixture())
            arrow_svg=json.dumps(deepseek_send_arrow_fixture())
            terminal_case("square_stop_veto","a.composerContext().root.querySelector('._52c986b').innerHTML="+stop_svg+";return [a.classifyComposerControl(a.composerContext()).kind,a.isGenerating(),a.messageComplete(v)]",["stop",True,False])
            terminal_case("disabled_action_class","v.nextElementSibling.querySelector('[aria-label]').classList.add('ds-button--disabled');return a.messageComplete(v)",False)
            terminal_case("noninteractive_action_css","v.nextElementSibling.querySelector('[aria-label]').style.pointerEvents='none';return a.messageComplete(v)",False)
            terminal_case("missing_terminal_class","v.parentElement.classList.remove('_43c05b5');return [a.assistantMessages().includes(v),a.messageComplete(v)]",[True,False])
            terminal_case("new_user_waits_for_own_answer","u.parentElement.parentElement.append(u.parentElement.cloneNode(true));return [a.completionObservation(v).reason,a.messageComplete(v)]",["current_user_response_not_observed",False])
            terminal_case("no_current_user","u.remove();return a.messageComplete(v)",False)
            terminal_case("new_streaming_assistant_excludes_old_toolbar","const next=v.parentElement.cloneNode(true);next.classList.remove('_43c05b5');next.lastElementChild.remove();v.parentElement.parentElement.append(next);return [a.assistantMessages().length,a.messageComplete(v),a.messageComplete(a.assistantMessages().at(-1))]",[2,False,False])
            terminal_case("text_alone_not_completion","v.nextElementSibling.remove();v.textContent='B02_CAPTURE_END';return [a.completionObservation(v).status,a.messageComplete(v)]",["unknown",False])
            terminal_case("same_assistant_natural_transition",
                "const parent=v.parentElement,toolbar=v.nextElementSibling,control=a.composerContext().root.querySelector('._52c986b');"
                "toolbar.remove();parent.classList.remove('_43c05b5');control.classList.remove('ds-button--disabled');control.innerHTML="+stop_svg+";"
                "const id=a.messageId(v),epoch=a.messageObservationEpoch();const early=[a.assistantMessages().includes(v),a.isGenerating(),a.messageComplete(v)];"
                "v.querySelector('pre').textContent+=' MORE';const late=[a.messageId(v)===id,a.messageObservationEpoch()===epoch,a.messageComplete(v)];"
                "parent.classList.add('_43c05b5');parent.append(toolbar);control.innerHTML="+arrow_svg+";control.classList.add('ds-button--disabled');"
                "return [early,late,a.messageId(v)===id,a.messageObservationEpoch()===epoch,a.classifyComposerControl(a.composerContext()).kind,a.messageComplete(v),a.findCodeBlocks(v).map(n=>a.readCodeText(n))]",
                [[True,True,False],[True,True,False],True,True,"ready",True,["CODE ONE\nCODE TWO MORE"]])

            terminal_case("observed_file_route","const p=a.deliveryCapabilities(),f=OzonAIDeliveryCapabilities.supportsFile('deepseek',{filename:'report.txt',byte_length:10});return [p.status,f.status,f.reason,a.integrationStatus().assistant_completion]",["implemented","supported",None,"observed_natural_terminal_toolbar"])

    if case_names is not None:
        assert set(case_names).issubset(cases), set(case_names)-set(cases)
        cases={k:v for k,v in cases.items() if k in case_names}
    result={"status":"RUNNING","scope":"B02 offline composed-observation parent/root/message lifecycle; no installed/provider or permanent-ID claim","bundle_sha256":hashlib.sha256(bundle.encode()).hexdigest(),"cases":{}}
    failures=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        context=browser.new_context(viewport={"width":1100,"height":800})
        context.route("**/*",lambda route:route.fulfill(status=200,content_type="text/html",body="<html></html>"))
        page=context.new_page()
        for name,(provider,html,js,expected) in cases.items():
            try:
                origin="https://chat.deepseek.com" if provider=="deepseek" else "https://claude.ai"
                page.goto(origin+"/chat/fixture-a")
                page.set_content('<style>[contenteditable]{min-height:24px} pre{white-space:pre-wrap}</style>'+html)
                for code in sources:page.evaluate(code)
                page.evaluate(bundle)
                actual=page.evaluate("""async ({provider,js,helpers})=>{
                  const a=(provider==='claude'?SellerAgentsClaudeAdapter:SellerAgentsDeepSeekAdapter).create(OzonAIAdapters);
                  const u=a.userMessages()[0],v=a.assistantMessages()[0];
                  const body="function adapter(){return a;}function current(){return true;}async function sleep(){await new Promise(r=>setTimeout(r,1));}\\n"+helpers+"\\n"+js;
                  return new (Object.getPrototypeOf(async function(){}).constructor)('a','u','v',body)(a,u,v);
                }""",{"provider":provider,"js":js,"helpers":port_helpers})
                assert actual==expected,{"actual":actual,"expected":expected}
                result["cases"][name]={"status":"PASS"}
            except Exception as exc:
                failures.append(name);result["cases"][name]={"status":"FAIL","error":str(exc)[:1400]}
        browser.close()
    result["status"]="FAIL" if failures else "PASS";result["failed"]=failures
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"cases":len(cases),"failed":failures}))
    return 1 if failures else 0

def run_standard_alice_files(runtime: Path, output: Path, observed=None, case_names=None):
    """Offline Standard attachment states and Alice composer continuity; no provider calls."""
    output.mkdir(parents=True, exist_ok=True)
    bundle=(runtime/"shared/ai_adapters.js").read_text()
    content=(runtime/"content_script.js").read_text()
    port=(runtime/"attachment_delivery_port_content.js").read_text()
    def extract(source,name):
        start=source.index("  function "+name+"(")
        return source[start:source.index("\n  }\n",start)+5]
    names=["visible","controlDisabled","buttonToken","chatgptInsideAssistantEditor",
           "chatgptComposerContextFromNode","chatgptPrimaryComposerContext","chatgptAllComposerControls",
           "chatgptBuiltinMicrophoneButton","chatgptMicrophoneButton","chatgptWorkSubmitButton",
           "chatgptStopButton","chatgptRecognizedSendControl","classifyChatgptComposerControl"]
    content_probe="(()=>{"+"\n".join(line for line in content.splitlines() if line.startswith("  const CHATGPT_"))+"\n"+"\n".join(extract(content,n) for n in names)+"\nconst sendButtonProfile=null,microphoneButtonProfile=null;globalThis.standardControl=classifyChatgptComposerControl;globalThis.standardContext=chatgptPrimaryComposerContext;})()"
    match_probe="(a,baseline,recovery)=>{const adapter=()=>a,normalizeText=s=>String(s||'').replace(/\\u00a0/g,' ').trim();"+extract(port,"matchingNewUserTurn")+";return matchingNewUserTurn(baseline,recovery);}"
    textbox='<div contenteditable="true" role="textbox" data-composer-markdown aria-label="Спросить ChatGPT"><p><br></p></div>'
    inputs='<input type="file" class="hidden" accept="image/*" aria-label="Сделать фото"><input type="file" class="hidden" multiple accept="image/*,video/*" aria-label="Прикрепить фото или видео"><input type="file" class="hidden" multiple accept="image/*" aria-label="Прикрепить фото"><input type="file" class="hidden" multiple aria-label="Прикрепить файлы">'
    voice='<button aria-label="Диктовать">dictate</button><button aria-label="Начать голосовой разговор">voice</button>'
    send='<button type="submit" aria-label="Отправить">send</button>'
    card='<span class="group/composer-attachment"><button class="composer-attachment-surface" aria-label="report.txt"><span class="truncate">report.txt</span></button><button aria-label="Удалить report.txt">remove</button></span>'
    def root(attachment='',controls=voice):
        zone='<div data-composer-attachments'+(' data-visible-attachments' if attachment else ' hidden')+'>'+attachment+'</div>'
        return '<div class="fixture-root">'+inputs+'<div><div><div data-composer-body>'+zone+textbox+controls+'</div></div></div></div>'
    ready=root(card,send)
    loading=root(card.replace('<button class="composer-attachment-surface" aria-label="report.txt">','<span class="composer-attachment-surface">').replace('</button><button aria-label="Удалить','</span><div role="progressbar" aria-label="Загрузка report.txt">loading</div><button aria-label="Удалить'),send)
    desc='[{filename:"report.txt",byte_length:3}]'
    native='new File(["ABC"],"report.txt",{type:"text/plain"})'
    legacy='<form><textarea id="prompt-textarea"></textarea><input id="upload-files" type="file" multiple></form>'
    alice='<div data-highlight-id="alice-input" class="AliceInput StandaloneRichInput"><div class="AliceInput-TextareaWrapper"><div aria-hidden="true" class="AliceInput-Textarea_clone">clone</div><textarea data-testid="inputbase-textarea"></textarea></div><div data-testid="input-controls-root" aria-busy="false"><button data-testid="InputControls-More-Button" aria-haspopup="menu">more</button><button data-testid="oknyx" aria-label="Алиса, начни слушать">voice</button></div></div><input type="file" data-testid="pick-file-input-element" accept="text/*,text/plain" style="display:none">'
    cases={}
    def case(name,html,js,expected,provider='chatgpt'):
        cases[name]=(html,js,expected,provider)
    case('standard_scope_without_invented_form',root(),'return [c.surfaceKind,c.root.className,c.nativeForm,c.form===c.root,c.root.contains(c.composer)]',['observed_standard','fixture-root',None,True,True])
    case('standard_picks_file_not_image_inputs',root(),'return [a.attachmentSurface().input.getAttribute("aria-label"),a.attachmentSurface().input.multiple,a.attachmentSurface().input.getAttribute("accept")]', ['Прикрепить файлы',True,None])
    case('standard_empty_voice_not_dictation',root(),'return standardControl().kind','microphone')
    case('standard_actual_content_scope',root(),'return standardContext().root===c.root',True)
    case('standard_loading_not_ready',loading,'return [a.attachmentReady('+desc+'),a.sendButton(c),standardControl().kind]',[False,None,'unknown'])
    case('standard_ready_card_and_send',ready,'return [a.attachmentReady('+desc+'),a.sendButton(c)?.getAttribute("aria-label"),standardControl().kind]',[True,'Отправить','send_active'])
    case('standard_name_remove_alone_not_ready',root('<span class="group/composer-attachment"><span class="truncate">report.txt</span><button aria-label="Удалить report.txt">remove</button></span>',send),'return a.attachmentReady('+desc+')',False)
    case('standard_progress_still_not_ready',root(card+'<span role="progressbar">100%</span>',send),'return a.attachmentReady('+desc+')',False)
    case('standard_busy_still_not_ready',root(card+'<span aria-busy="true">pending</span>',send),'return a.attachmentReady('+desc+')',False)
    case('standard_foreign_filename_rejected',ready,'return a.attachmentReady([{filename:"other.txt",byte_length:3}])',False)
    case('standard_substring_rejected',ready,'return a.attachmentReady([{filename:"port.txt",byte_length:3}])',False)
    case('standard_duplicate_cards_rejected',root(card+card,send),'return a.attachmentReady('+desc+')',False)
    case('standard_duplicate_zones_rejected',ready.replace(textbox,'<div data-composer-attachments>'+card+'</div>'+textbox),'return a.attachmentReady('+desc+')',False)
    case('standard_hidden_card_rejected',root('<span hidden>'+card+'</span>',send),'return a.attachmentReady('+desc+')',False)
    case('standard_old_message_card_not_preview','<article>'+card+'</article>'+root(),'return a.attachmentReady('+desc+')',False)
    case('standard_empty_descriptor_rejected',ready,'return a.attachmentReady([])',False)
    case('standard_duplicate_descriptor_rejected',ready,'return a.attachmentReady('+desc+'.concat('+desc+'))',False)
    for label,wrapper in [('hidden','hidden'),('opacity','style="opacity:0"'),('inert','inert'),('dialog','role="dialog"'),('user','data-message-role="user"')]:
        case('standard_'+label+'_composer_rejected','<div '+wrapper+'>'+root()+'</div>','return a.composerContext()',None)
    case('standard_hidden_clone_ignored','<div hidden>'+root()+'</div>'+root(),'return !!c',True)
    case('standard_duplicate_composer_rejected',root()+root(),'return [c,standardContext()]',[None,None])
    case('standard_duplicate_file_inputs_rejected',root().replace(inputs,inputs+'<input type="file" multiple aria-label="Прикрепить файлы">'),'return a.attachmentSurface()',None)
    case('standard_missing_file_input_not_global',root().replace('<input type="file" class="hidden" multiple aria-label="Прикрепить файлы">','')+'<input type="file" multiple aria-label="Прикрепить файлы">','return a.attachmentSurface()',None)
    case('standard_single_file_input_unobserved',root().replace('multiple aria-label="Прикрепить файлы"','aria-label="Прикрепить файлы"'),'return a.attachmentSurface()',None)
    case('standard_disabled_input_rejected',root().replace('multiple aria-label="Прикрепить файлы"','multiple disabled aria-label="Прикрепить файлы"'),'return a.attachmentSurface()',None)
    case('standard_native_file_bytes_and_retention',root(),'const s=a.attachmentSurface();let changes=0;s.input.addEventListener("change",()=>changes++);a.attachFiles(s,['+native+']);let code="";try{a.attachFiles(s,['+native+'])}catch(e){code=e.code}return [await s.input.files[0].text(),s.input.files.length,changes,a.attachmentSurface(),code]', ['ABC',1,1,None,'TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE'])
    changes={'url':'history.replaceState({},"","/c/other")','composer':'c.composer.replaceWith(c.composer.cloneNode(true))','root':'c.root.replaceWith(c.root.cloneNode(true))','input':'s.input.replaceWith(s.input.cloneNode(true))','draft':'c.composer.textContent="OWNER DRAFT"'}
    for label,change in changes.items():
        case('standard_stale_'+label+'_no_attach',root(),'const s=a.attachmentSurface();let changes=0;s.input.addEventListener("change",()=>changes++);'+change+';let code="";try{a.attachFiles(s,['+native+'])}catch(e){code=e.code}return [code,changes]', ['TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE',0])
    case('standard_stale_send_rejected',ready,'history.replaceState({},"","/c/other");return a.sendButton(c)',None)
    case('standard_ready_native_size_mismatch',ready,'const f=new DataTransfer();f.items.add('+native+');c.root.querySelector(\'input[aria-label="Прикрепить файлы"]\').files=f.files;return a.attachmentReady([{filename:"report.txt",byte_length:4}])',False)
    case('standard_unknown_sent_cannot_confirm_text',root()+'<section data-turn="user" data-turn-id="u1">REPORT</section>','return matchTurn(a,[],{outgoing_text:"REPORT",delivery_id:"d",artifact_descriptors:'+desc+'})',None)
    case('legacy_owned_input_preserved',legacy,'return [a.attachmentSurface().input.id,a.requiresSentAttachmentMessage(null)]',['upload-files',False])
    case('legacy_known_text_confirmation_preserved',legacy+'<section data-turn="user" data-turn-id="u1">REPORT</section>','return matchTurn(a,[],{outgoing_text:"REPORT"})','u1')
    case('legacy_known_ask_fallback','<form><div contenteditable="true" role="textbox" aria-label="Ask ChatGPT">draft</div></form>','return [!!c,c.root.tagName]',[True,'FORM'])
    case('alice_current_composer_not_clone',alice,'return [c.composer.tagName,c.root.getAttribute("data-highlight-id"),c.form,a.classifyComposerControl(c).kind]', ['TEXTAREA','alice-input',None,'ready'],'alice')
    case('alice_body_input_does_not_enable_native_route',alice,'let clicks=0,changes=0;const input=document.querySelector("input[type=file]");input.addEventListener("click",()=>clicks++);input.addEventListener("change",()=>changes++);const s=a.attachmentSurface();return [s.kind,s.input||null,s.composer===c.composer,clicks,changes]', ['drag_drop_v1',None,True,0,0],'alice')
    case('alice_hidden_clone_ignored','<div hidden>'+alice+'</div>'+alice,'return !!c',True,'alice')
    case('alice_duplicate_composer_rejected',alice+alice,'return c',None,'alice')
    case('alice_hidden_composer_rejected','<div style="opacity:0">'+alice+'</div>','return c',None,'alice')
    case('alice_disabled_composer_rejected',alice.replace('<textarea','<textarea disabled'),'return c',None,'alice')
    for label,change in {'draft':'c.composer.value="OWNER DRAFT"','busy':'document.querySelector(\'[data-testid="input-controls-root"]\').setAttribute("aria-busy","true")','stop':'document.querySelector(\'[data-testid="oknyx"]\').setAttribute("aria-label","Алиса, стоп")'}.items():
        case('alice_'+label+'_attachment_held',alice,change+';return a.attachmentSurface()',None,'alice')
    alice_changes={'url':'history.replaceState({},"","/chats/other")','composer':'c.composer.replaceWith(c.composer.cloneNode(true))','root':'c.root.replaceWith(c.root.cloneNode(true))','controls':'s.controls_root.replaceWith(s.controls_root.cloneNode(true))','marker':'s.capability_marker.replaceWith(s.capability_marker.cloneNode(true))'}
    for label,change in alice_changes.items():
        case('alice_stale_'+label+'_no_drop',alice,'const s=a.attachmentSurface();let drops=0;document.body.addEventListener("drop",()=>drops++);'+change+';let code="";try{a.attachFiles(s,['+native+'])}catch(e){code=e.code}return [code,drops]',['TARGET_AI_ATTACHMENT_SURFACE_CHANGED',0],'alice')
    case('alice_existing_local_drop_preserved',alice,'let drops=0,changes=0;document.body.addEventListener("drop",e=>{drops++;window.dropped=e.dataTransfer.files[0]});document.querySelector("input[type=file]").addEventListener("change",()=>changes++);a.attachFiles(a.attachmentSurface(),['+native+']);return [drops,changes,await dropped.text()]',[1,0,'ABC'],'alice')
    if observed:
        standard,alice_packet=observed
        name='B02_UPLOAD_STATE_20261020.txt'
        d=json.dumps([{'filename':name,'byte_length':158044}])
        case('actual_standard_before_input_scope',standard['before']['dom'],'return [!!c,c.nativeForm,a.attachmentSurface().input.getAttribute("aria-label"),standardControl().kind]',[True,None,'Прикрепить файлы','microphone'])
        case('actual_standard_loading',standard['afterUpload']['dom'],'return [a.attachmentReady('+d+'),a.sendButton(c),standardControl().kind]',[False,None,'unknown'])
        case('actual_standard_ready',standard['ready']['dom'],'return [a.attachmentReady('+d+'),a.sendButton(c)?.getAttribute("aria-label"),standardControl().kind]',[True,'Отправить','send_active'])
        case('actual_standard_sent_dom_empty',standard['before']['dom'],'return [a.requiresSentAttachmentMessage(null),'+json.dumps(standard['sent']['dom'])+']',[True,[]])
        actual_alice=alice_packet['before']['dom']['composer'][0]['grandparent']+alice_packet['before']['dom']['inputs'][0]['html']
        case('actual_alice_composer_body_input_partial',actual_alice,'return [!!c,c.root.getAttribute("data-highlight-id"),a.classifyComposerControl(c).kind,a.attachmentSurface().kind,document.querySelector(\'input[data-testid="pick-file-input-element"]\').parentElement.tagName]',[True,'alice-input','ready','drag_drop_v1','BODY'],'alice')
    if case_names is not None:
        assert set(case_names)<=set(cases)
        cases={n:cases[n] for n in case_names}
    result={'status':'RUNNING','scope':'offline Standard observed input/loading/ready, sent evidence gap, Alice composer continuity; no authorized UI/Send','cases':{},'source_sha256':hashlib.sha256(bundle.encode()).hexdigest()}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        context=browser.new_context(viewport={'width':1100,'height':800})
        context.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body='<html></html>'))
        page=context.new_page()
        for name,(html,js,expected,provider) in cases.items():
            try:
                page.goto(('https://chatgpt.com/c/' if provider=='chatgpt' else 'https://alice.yandex.ru/chats/')+'fixture')
                page.set_content('<style>.hidden,[hidden]{display:none!important}[contenteditable=true]{min-height:24px}svg{max-width:24px;max-height:24px}</style>'+html)
                for path in ['shared/conversation_identity.js','shared/ai_delivery_capabilities.js','shared/web_file_attachment.js','shared/ai_adapters.js']:
                    page.evaluate((runtime/path).read_text())
                page.evaluate(content_probe)
                page.evaluate('globalThis.matchTurn='+match_probe)
                actual=page.evaluate("([provider,js])=>{const a=OzonAIAdapters.ADAPTERS[provider],c=a.composerContext();return new (Object.getPrototypeOf(async function(){}).constructor)('a','c',js)(a,c)}",[provider,js])
                assert actual==expected,{'actual':actual,'expected':expected}
                result['cases'][name]={'status':'PASS'}
            except Exception as exc:
                result['cases'][name]={'status':'FAIL','error':str(exc)[:1600]}
        browser.close()
    failed=[n for n,c in result['cases'].items() if c['status']!='PASS']
    result.update(status='FAIL' if failed else 'PASS',failed=failed)
    (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'cases':len(cases),'failed':failed}))
    return int(bool(failed))


def run_alice_ready_sent(runtime: Path, output: Path, observed=None, case_names=None):
    """Offline Alice ready/sent ownership, including supplied DOM; no provider calls."""
    from html import escape
    output.mkdir(parents=True,exist_ok=True)
    bundle=(runtime/'shared/ai_adapters.js').read_text()
    port=(runtime/'attachment_delivery_port_content.js').read_text()
    start=port.index('  function matchingNewUserTurn(')
    matcher=port[start:port.index('\n  }\n',start)+5]
    probe="(a,baseline,recovery)=>{const adapter=()=>a,normalizeText=s=>String(s||'').replace(/\\u00a0/g,' ').trim();"+matcher+";return matchingNewUserTurn(baseline,recovery);}"
    value='REPORT\nline two <tag> ё 😀'
    desc='[{filename:"report.txt",byte_length:3}]'
    def card(sent=False,filename='report.txt'):
        classes='File_view_primary MessageAttachedFiles-Item_file' if sent else 'File_view_secondary InputFilesBlock-Item'
        remove='' if sent else '<button class="File-Remove" data-testid="file-remove-button" aria-label="Удалить">remove</button>'
        return '<div class="File '+classes+'" data-testid="file"><div class="File-Container"><span class="File-Title" data-testid="file-title"><span class="File-TitleOther">'+escape(filename[:-3])+'</span><span class="File-TitleRequired">'+escape(filename[-3:])+'</span></span><span class="File-Description">TXT · 0.003 КБ</span></div>'+remove+'</div>'
    def composer(cards=None,send='Отправить'):
        if cards is None:cards=card()
        files='<div class="InputFilesBlock" data-testid="input-files-block">'+cards+'</div>' if cards else ''
        return '<div class="AliceInput StandaloneRichInput" data-highlight-id="alice-input">'+files+'<textarea data-testid="inputbase-textarea"></textarea><div data-testid="input-controls-root" aria-busy="false"><button data-testid="InputControls-More-Button" aria-haspopup="menu">more</button></div><button data-testid="oknyx" aria-label="'+send+'">send</button></div>'
    def message(text=value,attachment=None,ident='request-a'):
        if attachment is None:attachment=card(True)
        return '<div class="Message Message_from_user" data-message-role="user" id="'+ident+'" data-request-id="'+ident+'"><h1 class="A11yHidden">Я</h1><div class="MessageBubble-Container_type_files MessageBubble-Container_from-user"><div class="MessageBubble" data-bubble-id="bubble-file"><div class="MessageBubble-UserRequest_fileUpload"><div class="MessageAttachedFiles" data-testid="message-attached-files"><div class="MessageAttachedFiles-Row" data-testid="message-attached-files-row">'+attachment+'</div></div></div></div></div><div class="MessageBubble-Container_type_text MessageBubble-Container_from-user"><div class="MessageBubble" data-bubble-id="bubble-text"><div class="AliceTextBubble AliceTextBubble_from_user">'+escape(text)+'</div></div></div><button>Копировать</button><button>Редактировать</button></div>'
    cases={}
    def case(name,html,js,expected):cases[name]=(html,js,expected)
    ready='return a.attachmentReady('+desc+')'
    read='return a.sentAttachmentMessage(a.userMessages()[0],'+desc+')'
    match='return matchTurn(a,[],{outgoing_text:'+json.dumps(value,ensure_ascii=False)+',artifact_descriptors:'+desc+'})'
    expected={'text':value,'filenames':['report.txt']}
    case('ready_split_exact_name',composer(),ready,True)
    case('ready_card_is_preview_not_filename_leaf',composer(),'return a.attachmentPreview("report.txt")?.getAttribute("data-testid")','file')
    case('ready_without_send_is_card_state',composer().replace('<button data-testid="oknyx" aria-label="Отправить">send</button>',''),ready,True)
    case('no_card_busy_false_send_not_ready',composer(''),ready,False)
    case('immediate_error_without_card',composer('').replace('data-testid="oknyx"','class="StandaloneOknyx_error" data-testid="oknyx"'),ready,False)
    case('error_with_card_held',composer().replace('data-testid="oknyx"','class="StandaloneOknyx_error" data-testid="oknyx"'),ready,False)
    case('controls_busy_held',composer().replace('aria-busy="false"','aria-busy="true"'),ready,False)
    case('stop_with_card_held',composer(send='Алиса, стоп'),ready,False)
    case('progress_even_100_held',composer(card()+'<span role="progressbar">100%</span>'),ready,False)
    case('card_busy_held',composer(card().replace('data-testid="file"','data-testid="file" aria-busy="true"')),ready,False)
    case('missing_remove_not_ready',composer(card().replace('<button class="File-Remove" data-testid="file-remove-button" aria-label="Удалить">remove</button>','')),ready,False)
    case('disabled_remove_not_ready',composer(card().replace('class="File-Remove"','disabled class="File-Remove"')),ready,False)
    case('wrong_filename_not_substring',composer(card(filename='old-report.txt')),ready,False)
    case('description_loading_not_ready',composer().replace('TXT · 0.003 КБ','Загрузка'),ready,False)
    case('description_absent_not_ready',composer().replace('TXT · 0.003 КБ',''),ready,False)
    case('duplicate_cards_not_ready',composer(card()+card()),ready,False)
    case('unexpected_extra_card_not_ready',composer(card()+card(filename='second.txt')),ready,False)
    case('two_exact_cards_ready',composer(card()+card(filename='second.txt')),'return a.attachmentReady('+desc+'.concat([{filename:"second.txt"}]))',True)
    case('duplicate_descriptors_rejected',composer(),'return a.attachmentReady('+desc+'.concat('+desc+'))',False)
    case('empty_descriptors_rejected',composer(),'return a.attachmentReady([])',False)
    case('neighbor_file_not_current_ready',card()+composer(''),ready,False)
    case('sent_file_not_current_ready',message()+composer(''),ready,False)
    case('two_composers_not_ready',composer()+composer(),ready,False)
    case('duplicate_title_ambiguous',composer().replace('<span class="File-Description">','<span class="File-Title" data-testid="file-title">report.txt</span><span class="File-Description">'),ready,False)
    for label,attr in [('hidden','hidden'),('aria_hidden','aria-hidden="true"'),('opacity','style="opacity:0"'),('inert','inert'),('dialog','role="dialog"')]:
        case('ready_'+label+'_rejected','<div '+attr+'>'+composer()+'</div>',ready,False)
        case('sent_'+label+'_rejected','<div '+attr+'>'+message()+'</div>',match,None)
    case('existing_card_prevents_second_drop',composer(),'return a.attachmentSurface()',None)
    case('owned_file_and_text',message(),read,expected)
    case('owned_file_matches_real_port',message(),match,'alice-observed-user:request-a')
    case('new_dynamic_request_and_bubble_ids',message(ident='request-new').replace('bubble-file','dynamic-file').replace('bubble-text','dynamic-text'),match,'alice-observed-user:request-new')
    case('text_only_never_file_confirmation',message(attachment=''),match,None)
    case('no_file_descriptor_no_confirmation',message(),'return a.sentAttachmentMessage(a.userMessages()[0],[])',None)
    case('baseline_not_new',message(),'return matchTurn(a,[a.messageId(a.userMessages()[0])],{outgoing_text:'+json.dumps(value)+',artifact_descriptors:'+desc+'})',None)
    case('remounted_baseline_not_new',message(),'const ids=a.userMessages().map(n=>a.messageId(n));const n=a.userMessages()[0];n.replaceWith(n.cloneNode(true));return matchTurn(a,ids,{outgoing_text:'+json.dumps(value)+',artifact_descriptors:'+desc+'})',None)
    case('old_neighbor_card_not_owned',message(attachment='')+message(text='OTHER',ident='neighbor'),match,None)
    case('old_and_new_same_text_only_new_receipt',message(ident='old')+message(ident='new'),'return matchTurn(a,[a.messageId(a.userMessages()[0])],{outgoing_text:'+json.dumps(value)+',artifact_descriptors:'+desc+'})','alice-observed-user:new')
    case('duplicate_ids_not_receipt',message()+message(),match,None)
    case('hidden_old_clone_ignored','<div hidden>'+message()+'</div>'+message(),match,'alice-observed-user:request-a')
    case('missing_request_id_not_receipt',message().replace('data-request-id="request-a"',''),match,None)
    case('id_request_mismatch_not_receipt',message().replace('data-request-id="request-a"','data-request-id="different"'),match,None)
    case('wrong_text_not_receipt',message(text='DIFFERENT'),match,None)
    case('wrong_sent_filename_not_substring',message(attachment=card(True,'old-report.txt')),match,None)
    case('composer_card_not_sent_proof',message(attachment=card()),match,None)
    case('sent_card_busy_not_receipt',message().replace('data-testid="file"','data-testid="file" aria-busy="true"'),match,None)
    case('sent_duplicate_cards_ambiguous',message(attachment=card(True)+card(True)),match,None)
    case('sent_extra_card_ambiguous',message(attachment=card(True)+card(True,'second.txt')),match,None)
    case('sent_two_exact_cards',message(attachment=card(True)+card(True,'second.txt')),'return a.sentAttachmentMessage(a.userMessages()[0],'+desc+'.concat([{filename:"second.txt"}]))',{'text':value,'filenames':['report.txt','second.txt']})
    case('sent_body_card_not_owned',message(attachment='').replace('<div class="AliceTextBubble',card(True)+'<div class="AliceTextBubble'),match,None)
    case('nested_user_not_owned',message(attachment=message(ident='nested')),match,None)
    case('assistant_root_not_user',message().replace('data-message-role="user"','data-message-role="alice"'),match,None)
    case('message_inside_composer_not_receipt',composer(message()),match,None)
    case('message_inside_another_role_not_receipt','<section data-message-role="alice">'+message()+'</section>',match,None)
    case('two_owned_text_bubbles_ambiguous',message().replace('</div></div></div><button>Копировать','</div><div class="AliceTextBubble AliceTextBubble_from_user">OTHER</div></div></div><button>Копировать'),match,None)
    case('hidden_text_not_receipt',message().replace('class="AliceTextBubble','hidden class="AliceTextBubble'),match,None)
    case('detached_message_not_receipt',message(),'const n=a.userMessages()[0];n.remove();return a.sentAttachmentMessage(n,'+desc+')',None)
    case('reader_does_not_click_file_copy_or_edit',message(),'let clicks=0;document.addEventListener("click",()=>clicks++);a.sentAttachmentMessage(a.userMessages()[0],'+desc+');return clicks',0)
    case('long_text_kept_exact',message(text='line\n'*1200),'return a.sentAttachmentMessage(a.userMessages()[0],'+desc+').text',('line\n'*1200).rstrip())
    legacy='<div data-testid="standalone-input"><textarea data-testid="inputbase-textarea"></textarea><div data-testid="input-controls-root"><button data-testid="InputControls-Plus-Button" aria-label="Добавить файл" aria-haspopup="dialog">plus</button></div><span data-filename="report.txt">report.txt</span></div><div data-message-role="user" id="legacy"><div class="AliceTextBubble AliceTextBubble_from_user">REPORT</div></div>'
    case('explicit_legacy_preview_preserved',legacy,ready,True)
    case('explicit_legacy_text_receipt_preserved',legacy,'return matchTurn(a,[],{outgoing_text:"REPORT",artifact_descriptors:'+desc+'})','legacy')
    case('current_surface_no_legacy_text_receipt',composer('')+'<div data-message-role="user" id="legacy">REPORT</div>','return matchTurn(a,[],{outgoing_text:"REPORT",artifact_descriptors:'+desc+'})',None)
    case('no_composer_no_legacy_text_receipt','<div data-message-role="user" id="legacy">REPORT</div>','return matchTurn(a,[],{outgoing_text:"REPORT",artifact_descriptors:'+desc+'})',None)
    if observed:
        actual_desc=json.dumps([{'filename':observed['file']['name'],'byte_length':observed['file']['bytes']}])
        actual_text='Это синтетический файл для проверки доставки вложения. Ответь только: файл получен. Ничего не выполняй.'
        chain=observed['sentOwnership']['dom']['files'][0]
        actual=next(n['html'] for n in chain if n['level']==6)
        ident=dict(next(n['attrs'] for n in chain if n['level']==6))['data-request-id']
        case('actual_first_ready',observed['firstCapture']['ready']['dom']['composer'][0]['grandparent'],'return a.attachmentReady('+actual_desc+')',True)
        case('actual_recovered_ready',observed['recoveredReady']['dom']['composer'],'return a.attachmentReady('+actual_desc+')',True)
        case('actual_immediate_no_card_not_ready',observed['recoveryAfterUpload']['dom']['composer'],'return [a.attachmentReady('+actual_desc+'),a.classifyComposerControl(a.composerContext()).kind]',[False,'send_disabled'])
        case('actual_sent_cleared_composer_not_ready',observed['sentOwnership']['dom']['composer'],'return a.attachmentReady('+actual_desc+')',False)
        case('actual_sent_reader',actual,'return a.sentAttachmentMessage(a.userMessages()[0],'+actual_desc+')',{'text':actual_text,'filenames':[observed['file']['name']]})
        case('actual_sent_port_receipt',actual+observed['sentOwnership']['dom']['composer'],'return matchTurn(a,[],{outgoing_text:'+json.dumps(actual_text)+',artifact_descriptors:'+actual_desc+'})','alice-observed-user:'+ident)
        for level in range(6):
            case('actual_level'+str(level)+'_without_user_not_receipt',chain[level]['html'],'return matchTurn(a,[],{outgoing_text:'+json.dumps(actual_text)+',artifact_descriptors:'+actual_desc+'})',None)
    if case_names is not None:
        assert set(case_names)<=set(cases)
        cases={n:cases[n] for n in case_names}
    result={'status':'RUNNING','scope':'Alice observed ready and sent ownership only; offline code, no provider UI/Send/byte identity','cases':{},'bundle_sha256':hashlib.sha256(bundle.encode()).hexdigest()}
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        context=browser.new_context(viewport={'width':1100,'height':800})
        context.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body='<html></html>'))
        page=context.new_page()
        for name,(html,js,want) in cases.items():
            try:
                page.goto('https://alice.yandex.ru/chat/offline-fixture/')
                page.set_content('<style>[hidden]{display:none!important}.A11yHidden{display:none}svg{max-width:24px;max-height:24px}</style>'+html)
                page.evaluate((runtime/'shared/conversation_identity.js').read_text());page.evaluate(bundle)
                page.evaluate('globalThis.matchTurn='+probe)
                actual=page.evaluate("js=>{const a=OzonAIAdapters.ADAPTERS.alice;return new (Object.getPrototypeOf(async function(){}).constructor)('a',js)(a)}",js)
                assert actual==want,{'actual':actual,'expected':want}
                result['cases'][name]={'status':'PASS'}
            except Exception as e:result['cases'][name]={'status':'FAIL','error':str(e)[:1600]}
        browser.close()
    failed=[n for n,v in result['cases'].items() if v['status']!='PASS']
    result.update(status='FAIL' if failed else 'PASS',failed=failed)
    (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'cases':len(cases),'failed':failed}))
    return int(bool(failed))


def run_standard_sent(runtime: Path, output: Path, observed=None, case_names=None):
    """Offline observed Standard sent-card ownership, using the real adapter and port matcher."""
    from html import escape
    output.mkdir(parents=True,exist_ok=True)
    bundle=(runtime/'shared/ai_adapters.js').read_text()
    port=(runtime/'attachment_delivery_port_content.js').read_text()
    start=port.index('  function matchingNewUserTurn(')
    matcher=port[start:port.index('\n  }\n',start)+5]
    probe="(a,baseline,recovery)=>{const adapter=()=>a,normalizeText=s=>String(s||'').replace(/\\u00a0/g,' ').trim();"+matcher+";return matchingNewUserTurn(baseline,recovery);}"
    text='REPORT\nline two <tag> ё 😀'
    desc='[{filename:"report.txt",byte_length:3}]'
    card='<span class="group/resource-card"><button class="peer/resource-card" type="button" aria-busy="false" aria-label="report.txt"></button><span><span class="truncate" title="report.txt">report.txt</span><span>Документ</span></span></span>'
    def message(value=text,attachment=card,ident='message-a',unit='fallback-turn-0:0:user'):
        return '<div class="group/user-message" data-chatgpt-search-unit-key="'+unit+'" data-chatgpt-search-message-ids="'+ident+'"><div class="file-row">'+attachment+'</div><div data-content-search-unit-key="'+unit+'"><div class="group/user-message"><div data-user-message-bubble="true"><div class="text-size-chat whitespace-pre-wrap" dir="auto">'+escape(value)+'</div></div><button aria-label="Скопировать сообщение">Copy</button><button>Редактировать сообщение</button></div></div></div>'
    legacy='<form><textarea id="prompt-textarea"></textarea><input id="upload-files" type="file" multiple></form>'
    modern='<div data-composer-body><div contenteditable="true" role="textbox" data-composer-markdown aria-label="Спросить ChatGPT">draft</div></div>'
    cases={}
    def case(name,html,js,expected):cases[name]=(html,js,expected)
    read='return a.sentAttachmentMessage(a.userMessages()[0],'+desc+')'
    match='return matchTurn(a,[],{outgoing_text:'+json.dumps(text,ensure_ascii=False)+',artifact_descriptors:'+desc+'})'
    expected={'text':text,'filenames':['report.txt']}
    case('owned_card_and_exact_body',message(),read,expected)
    case('owned_card_matches_real_port',message(),match,'chatgpt-observed-user:message-a')
    case('without_composer_still_owned',message(),'return [a.requiresSentAttachmentMessage(a.userMessages()[0]),a.messageText(a.userMessages()[0])]',[True,text])
    case('different_dynamic_message_and_unit',message(ident='message-b',unit='turn-seven:4:user'),match,'chatgpt-observed-user:message-b')
    case('no_fixed_heading_or_snapshot_key','<section><h4>You said:</h4>'+message(ident='message-c',unit='changed:2:user')+'</section>',match,'chatgpt-observed-user:message-c')
    case('baseline_message_not_new',message(),'return matchTurn(a,[a.messageId(a.userMessages()[0])],{outgoing_text:'+json.dumps(text)+',artifact_descriptors:'+desc+'})',None)
    case('old_and_new_same_text_only_new_receipt',message(ident='old')+message(ident='new',unit='fallback-turn-1:0:user'),'return matchTurn(a,[a.messageId(a.userMessages()[0])],{outgoing_text:'+json.dumps(text)+',artifact_descriptors:'+desc+'})','chatgpt-observed-user:new')
    case('remount_same_id_stays_baseline',message(),'const ids=a.userMessages().map(n=>a.messageId(n));const n=a.userMessages()[0];n.replaceWith(n.cloneNode(true));return matchTurn(a,ids,{outgoing_text:'+json.dumps(text)+',artifact_descriptors:'+desc+'})',None)
    case('duplicate_ids_no_receipt',message()+message(unit='different:1:user'),match,None)
    case('hidden_duplicate_id_ignored','<div hidden>'+message()+'</div>'+message(),match,'chatgpt-observed-user:message-a')
    case('legacy_wrapper_no_double_identity','<section data-turn="user" data-turn-id="legacy">'+message()+'</section>','return a.userMessages().map(n=>a.messageId(n))',['chatgpt-observed-user:message-a'])
    case('discovery_document_order',message(ident='first')+'<section data-turn="user" data-turn-id="legacy">legacy text</section>'+message(ident='last',unit='another:3:user'),'return a.userMessages().map(n=>a.messageId(n))',['chatgpt-observed-user:first','legacy','chatgpt-observed-user:last'])
    case('reader_does_not_click_copy_or_file',message(),'let clicks=0;document.addEventListener("click",()=>clicks++);a.sentAttachmentMessage(a.userMessages()[0],'+desc+');return clicks',0)
    case('missing_card_text_not_file',message(attachment=''),match,None)
    case('old_neighbor_card_not_owned',message(attachment='')+message(value='OTHER',ident='neighbor',unit='neighbor:1:user'),match,None)
    case('outside_card_not_owned',card+message(attachment=''),match,None)
    case('card_inside_text_body_rejected',message(attachment='').replace('<div data-user-message-bubble="true">',card+'<div data-user-message-bubble="true">'),match,None)
    case('pending_card_rejected',message().replace('aria-busy="false"','aria-busy="true"'),match,None)
    case('missing_busy_attribute_unknown',message().replace(' aria-busy="false"',''),match,None)
    case('progress_not_sent_proof',message(attachment=card+'<span role="progressbar">100%</span>'),match,None)
    case('disabled_card_rejected',message().replace('type="button"','type="button" disabled'),match,None)
    case('wrong_filename_not_substring',message().replace('report.txt','old-report.txt'),match,None)
    case('title_button_disagreement',message().replace('title="report.txt"','title="other.txt"'),match,None)
    case('filename_text_disagreement',message().replace('>report.txt</span>','>other.txt</span>'),match,None)
    case('duplicate_cards_ambiguous',message(attachment=card+card),match,None)
    case('duplicate_filename_descriptors',message(),'return a.sentAttachmentMessage(a.userMessages()[0],'+desc+'.concat('+desc+'))',None)
    case('empty_descriptor_rejected',message(),'return a.sentAttachmentMessage(a.userMessages()[0],[])',None)
    case('two_distinct_cards_and_descriptors',message(attachment=card+card.replace('report.txt','extra.txt')),'return a.sentAttachmentMessage(a.userMessages()[0],[{filename:"report.txt"},{filename:"extra.txt"}])',{'text':text,'filenames':['report.txt','extra.txt']})
    case('unexpected_extra_card_rejected',message(attachment=card+card.replace('report.txt','extra.txt')),match,None)
    case('wrong_outgoing_body_no_match',message(value='OTHER'),match,None)
    case('body_controls_excluded',message(), 'return a.messageText(a.userMessages()[0])',text)
    case('long_exact_body',message(value='line\n'*1200),'return a.sentAttachmentMessage(a.userMessages()[0],'+desc+').text','line\n'*1200)
    for name,attr in [('hidden','hidden'),('aria_hidden','aria-hidden="true"'),('opacity','style="opacity:0"'),('inert','inert'),('dialog','role="dialog"'),('composer','data-composer-body'),('assistant','data-message-role="assistant"')]:
        case(name+'_root_rejected','<div '+attr+'>'+message()+'</div>',match,None)
    case('body_key_mismatch_rejected',message().replace('data-content-search-unit-key="fallback-turn-0:0:user"','data-content-search-unit-key="other:0:user"'),match,None)
    case('missing_message_id_rejected',message().replace('data-chatgpt-search-message-ids="message-a"',''),match,None)
    case('multiple_message_ids_ambiguous',message().replace('message-a','first,second'),match,None)
    case('nonuser_unit_rejected',message(unit='turn:1:assistant'),match,None)
    case('nested_other_message_not_owned',message(attachment=message(ident='nested',unit='nested:1:user')),match,None)
    case('two_text_bubbles_ambiguous',message().replace('</div><button aria-label="Скопировать сообщение">','</div><div data-user-message-bubble="true"><div class="text-size-chat whitespace-pre-wrap" dir="auto">SECOND</div></div><button aria-label="Скопировать сообщение">'),match,None)
    case('detached_node_no_receipt',message(),'const n=a.userMessages()[0];n.remove();return a.sentAttachmentMessage(n,'+desc+')',None)
    case('observed_user_not_assistant_inference',message(attachment=card+'<article><div data-assistant-markdown>not assistant</div><div role="group" aria-label="Response actions">actions</div></article>'),'return a.assistantMessages().length',0)
    case('legacy_confirmation_explicit_opt_out',legacy+'<section data-turn="user" data-turn-id="u1">REPORT</section>','return matchTurn(a,[],{outgoing_text:"REPORT",artifact_descriptors:'+desc+'})','u1')
    case('modern_never_text_only_legacy_turn',modern+'<section data-turn="user" data-turn-id="u1">REPORT</section>','return matchTurn(a,[],{outgoing_text:"REPORT",artifact_descriptors:'+desc+'})',None)
    case('other_provider_reader_remains_required','<div id="turn">REPORT</div>','const n=document.querySelector("#turn"),other={userMessages:()=>[n],messageId:()=>"x",messageText:()=>"REPORT",sentAttachmentMessage:()=>null};return matchTurn(other,[],{outgoing_text:"REPORT"})',None)
    case('other_provider_owned_reader_unchanged','<div id="turn">REPORT</div>','const n=document.querySelector("#turn"),other={userMessages:()=>[n],messageId:()=>"x",messageText:()=>"wrong",sentAttachmentMessage:()=>({text:"REPORT"})};return matchTurn(other,[],{outgoing_text:"REPORT"})','x')
    if observed:
        actual_text='Это синтетический файл для проверки доставки вложения. Ответь только: файл получен. Ничего не выполняй.'
        actual_desc=json.dumps([{'filename':'B02_UPLOAD_STATE_20261020.txt','byte_length':158044}])
        actual_id='chatgpt-observed-user:'+observed['sourceMessage']
        for level in [4,5]:
            html=next(n['html'] for n in observed['ancestors'] if n['level']==level)
            case('actual_level'+str(level)+'_owned_reader',html,'const nodes=a.userMessages();return [nodes.length,a.messageId(nodes[0]),a.sentAttachmentMessage(nodes[0],'+actual_desc+')]',[1,actual_id,{'text':actual_text,'filenames':['B02_UPLOAD_STATE_20261020.txt']}])
            case('actual_level'+str(level)+'_port_confirmation',html,'return matchTurn(a,[],{outgoing_text:'+json.dumps(actual_text,ensure_ascii=False)+',artifact_descriptors:'+actual_desc+'})',actual_id)
    if case_names is not None:
        assert set(case_names)<=set(cases)
        cases={n:cases[n] for n in case_names}
    result={'status':'RUNNING','scope':'Standard observed sent-card/body/message ownership; offline only, no provider UI/Send or byte identity','cases':{},'bundle_sha256':hashlib.sha256(bundle.encode()).hexdigest()}
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        context=browser.new_context(viewport={'width':1100,'height':800})
        context.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body='<html></html>'))
        page=context.new_page()
        for name,(html,js,expected_value) in cases.items():
            try:
                page.goto('https://chatgpt.com/c/offline-sent-fixture')
                page.set_content('<style>[hidden]{display:none!important}span[class~="group/resource-card"]{position:relative;display:inline-block;min-width:160px;min-height:36px}button[class~="peer/resource-card"]{position:absolute;inset:0}svg{max-width:24px;max-height:24px}[contenteditable=true]{min-height:24px}</style>'+html)
                page.evaluate((runtime/'shared/conversation_identity.js').read_text());page.evaluate(bundle)
                page.evaluate('globalThis.matchTurn='+probe)
                actual=page.evaluate("js=>{const a=OzonAIAdapters.ADAPTERS.chatgpt;return new (Object.getPrototypeOf(async function(){}).constructor)('a',js)(a)}",js)
                assert actual==expected_value,{'actual':actual,'expected':expected_value}
                result['cases'][name]={'status':'PASS'}
            except Exception as e:result['cases'][name]={'status':'FAIL','error':str(e)[:1600]}
        browser.close()
    failed=[n for n,v in result['cases'].items() if v['status']!='PASS']
    result.update(status='FAIL' if failed else 'PASS',failed=failed)
    (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'cases':len(cases),'failed':failed}))
    return int(bool(failed))


def run_work_dot_initial(runtime: Path, output: Path, observed=None):
    """First Work/dot observations only; no inferred control scope or file delivery."""
    output.mkdir(parents=True, exist_ok=True)
    snapshot_root = Path('/root/octoport-control/testing/chromium-dot/dot-ai-snapshots')
    observed = observed or {
        'work': json.loads((snapshot_root/'GPT_WORK_UI_20261021T0136Z.json').read_text()),
        'dot': json.loads((snapshot_root/'DOT_UI_20261021T0141Z.json').read_text()),
    }
    source = (runtime/'shared/ai_adapters.js').read_text()
    identity = (runtime/'shared/conversation_identity.js').read_text()
    work, dot = observed['work'], observed['dot']
    work_html = work['dom']['composer'][0]['parent'] + ''.join(work['dom']['controls'])
    dot_composer = dot['dom']['composer'][0]['grandparent']
    articles = dot['dom']['articles']
    all_articles = ''.join(a['html'] for a in articles)
    # The known user/assistant pair and literal text are taken from the full witness.
    user, assistant = articles[2]['html'], articles[3]['html']
    cases = {}
    result = {'status':'RUNNING','scope':'offline Work/dot initial surface and dot text ownership; NOT full UI cycle',
              'source_sha256':hashlib.sha256(source.encode()).hexdigest(), 'cases':cases}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body='<html><body></body></html>'))
            def mount(url, html, mutate=None):
                page.goto(url)
                page.set_content(html)
                if mutate: page.evaluate(mutate)
                page.evaluate(identity)
                page.evaluate(source)
            def read():
                return page.evaluate('''()=>{const a=OzonAIAdapters.ADAPTERS.chatgpt,o=a.surfaceObservation();
                  const rows=role=>(role==='user'?a.userMessages():a.assistantMessages()).map(n=>({id:a.messageId(n),text:a.messageText(n),code:a.findCodeBlocks(n).length,complete:a.messageComplete(n)}));
                  return {surface:o?.kind||null,input:!!o?.composer,controlScope:!!o?.controlScope,
                    context:!!a.composerContext(),file:!!a.attachmentSurface(),users:rows('user'),assistants:rows('assistant')};}''')
            mount(dot['url'],dot_composer+all_articles)
            actual=read()
            expected_users=['dot-message:'+dict(a['attrs'])['data-message-id'] for a in articles if 'self' in dict(a['attrs'])['class'].split()]
            expected_assistants=['dot-message:'+dict(a['attrs'])['data-message-id'] for a in articles if 'self' not in dict(a['attrs'])['class'].split()]
            assert [a['id'] for a in actual['users']]==expected_users,actual
            assert [a['id'] for a in actual['assistants']]==expected_assistants,actual
            assert actual['surface']=='dot' and actual['input'] and not actual['controlScope'] and not actual['context'] and not actual['file'],actual
            assert all(not a['code'] and not a['complete'] for a in actual['users']+actual['assistants']),actual
            cases['all_eight_observed_articles']=actual
            mount(dot['url'],dot_composer+user+assistant)
            actual=read()
            assert actual['users'][0]['text']=='Они через мсп работают',actual
            assert actual['assistants'][0]['text']=='Да. Потоки работают через MCP: Remote Desktop Commander на Easyscript и GitHub. Режим интерфейса к их поручению не относится; в промптах его не будет.',actual
            cases['owned_text_excludes_actions_read_receipt_time']=actual
            # Ordinary alternate DOM states, not additional provider observations.
            variants={
                'dynamic_id': ("()=>{let a=document.querySelector('article');a.setAttribute('data-message-id','another-message');a.querySelector('.message-body').setAttribute('data-message-id','another-message');a.querySelector('.message-text').setAttribute('data-content-search-unit-key','another-message:message');}",1),
                'missing_outer_id':("()=>document.querySelector('article').removeAttribute('data-message-id')",0),
                'mismatched_body_id':("()=>document.querySelector('.message-body').setAttribute('data-message-id','other')",0),
                'mismatched_text_key':("()=>document.querySelector('.message-text').setAttribute('data-content-search-unit-key','other:message')",0),
                'missing_text_key':("()=>document.querySelector('.message-text').removeAttribute('data-content-search-unit-key')",0),
                'duplicate_visible_id':("()=>{let a=document.querySelector('article');a.after(a.cloneNode(true));}",0),
                'hidden_duplicate_ignored':("()=>{let a=document.querySelector('article'),b=a.cloneNode(true);b.hidden=true;a.after(b);}",1),
                'hidden_article':("()=>document.querySelector('article').hidden=true",0),
                'hidden_ancestor':("()=>document.body.style.visibility='hidden'",0),
                'opacity_zero':("()=>document.querySelector('article').style.opacity='0'",0),
                'hidden_text':("()=>document.querySelector('.message-text').hidden=true",0),
                'duplicate_text':("()=>{let a=document.querySelector('.message-text');a.after(a.cloneNode(true));}",0),
                'duplicate_fitted':("()=>{let a=document.querySelector('[data-fitted-message-text]');a.after(a.cloneNode(true));}",0),
                'missing_fitted':("()=>document.querySelector('[data-fitted-message-text]').removeAttribute('data-fitted-message-text')",0),
                'nested_article':("()=>document.querySelector('.message-text').append(document.createElement('article'))",0),
                'empty_body_id':("()=>document.querySelector('.message-body').setAttribute('data-message-id','')",0),
                'detached_message':("()=>document.querySelector('article').remove()",0),
            }
            for name,(mutation,count) in variants.items():
                mount(dot['url'],dot_composer+user,mutation)
                actual=read();assert len(actual['users'])==count and not actual['assistants'],(name,actual)
                if name=='dynamic_id':assert actual['users'][0]['id']=='dot-message:another-message',actual
                cases[name]=actual
            mount(dot['url'],dot_composer+user+assistant,"()=>{for(const n of document.querySelectorAll('[data-markdown-text-style]'))n.setAttribute('data-markdown-text-style','anything');}")
            actual=read();assert len(actual['users'])==1 and len(actual['assistants'])==1,actual
            cases['markdown_style_is_not_role']=actual
            mount(dot['url'],dot_composer+assistant,"()=>{document.querySelector('[data-fitted-message-text]').innerHTML='<pre><code>fixture code</code></pre><button>Copy</button>';}")
            actual=read();assert not actual['assistants'],actual
            cases['unknown_code_layout_not_enabled']=actual
            mount(dot['url'],dot_composer+user+assistant,"()=>{document.querySelector('[data-fitted-message-text]').insertAdjacentHTML('beforeend','<pre><code>plain fixture</code></pre>');}")
            actual=read();assert all(x['code']==0 and not x['complete'] for x in actual['users']+actual['assistants']),actual
            cases['fenced_text_does_not_enable_dot_commands']=actual
            for name,html,input_ok in [
                ('dot_composer_actual',dot_composer,True),
                ('dot_composer_duplicate',dot_composer+dot_composer,False),
                ('dot_composer_hidden','<div hidden>'+dot_composer+'</div>',False),
                ('dot_composer_missing_root',dot['dom']['composer'][0]['parent'],False),
                ('dot_composer_without_menu',dot_composer+''.join(dot['dom']['buttons']),True),
            ]:
                mount(dot['url'],html);actual=read()
                assert actual['surface']=='dot' and actual['input']==input_ok and not actual['context'] and not actual['controlScope'] and not actual['file'],(name,actual)
                cases[name]=actual
            for name,html,kind in [
                ('work_observed_parent_and_stop',work_html,'work'),
                ('work_duplicate_fields',work_html+work_html,None),
                ('work_hidden_field','<div hidden>'+work_html+'</div>',None),
                ('work_missing_parent',work['dom']['composer'][0]['html'],None),
                ('work_unknown_label',work_html.replace('Работайте с ChatGPT','Unknown label'),None),
                ('work_dialog_editor','<div role="dialog">'+work_html+'</div>',None),
            ]:
                mount(work['url'],html);actual=read()
                assert actual['surface']==kind and not actual['context'] and not actual['file'] and not actual['controlScope'],(name,actual)
                cases[name]=actual
            mount(work['url'],work_html+'<section data-turn="assistant" data-turn-id="legacy-work">Text</section>')
            actual=read();assert actual['assistants'] and not actual['assistants'][0]['complete'],actual
            cases['work_completion_not_inferred_from_text']=actual
            for name,url in [('dot_nodes_on_standard','https://chatgpt.com/c/fixture'),('dot_nodes_on_other_host','https://fixture.invalid/dots/home')]:
                mount(url,dot_composer+user+assistant);actual=read()
                assert actual['surface'] is None and not actual['users'] and not actual['assistants'],(name,actual)
                cases[name]=actual
            # Shared ChatGPT readers were changed: verify their existing legacy branch only.
            mount('https://chatgpt.com/c/fixture','<form><textarea id="prompt-textarea"></textarea></form><section data-turn="user" data-turn-id="legacy-u">Legacy prompt</section><section data-turn="assistant" data-turn-id="legacy-a"><pre><code>LEGACY</code></pre></section>')
            actual=read()
            assert actual['surface'] is None and actual['context'],actual
            assert actual['users'][0]['id']=='legacy-u' and actual['users'][0]['text']=='Legacy prompt',actual
            assert actual['assistants'][0]['id']=='legacy-a' and actual['assistants'][0]['code']==1 and actual['assistants'][0]['complete'],actual
            cases['affected_legacy_chatgpt_reader_preserved']=actual
            mount('https://chatgpt.com/c/fixture','<div data-composer-body><div contenteditable="true" role="textbox" data-composer-markdown aria-label="Спросить ChatGPT">Draft</div></div>')
            actual=read();assert actual['surface'] is None and actual['context'],actual
            cases['affected_standard_composer_preserved']=actual
        finally:
            browser.close()
    result['status']='PASS';result['case_count']=len(cases)
    (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return 0

def run_work_dot_files(runtime: Path, output: Path, observed=None):
    output.mkdir(parents=True, exist_ok=True)
    D=Path('/root/octoport-control/testing/chromium-dot/dot-ai-snapshots')
    observed=observed or {'work':json.loads((D/'WORK_CAPTURE_DOM_20261021T0205Z.json').read_text()),'dot':json.loads((D/'DOT_CAPTURE_20261021T0209Z.json').read_text())}
    w,d=observed['work'],observed['dot'];source=(runtime/'shared/ai_adapters.js').read_text();identity=(runtime/'shared/conversation_identity.js').read_text();content=(runtime/'content_script.js').read_text()
    work_root=w['before']['inputs'][7]['parent'];dot_root=d['before']['inputs'][0]['parent']
    work_user=w['sent']['dom']['cards'][0][4]['html'];work_assistant=w['assistantCode']['dom'][0][5]['html']
    dot_user=d['sentFinal'][0];dot_assistant=d['answer']['dom']['articles'][1]
    wf=[{'filename':'GPT_WORK_UI_20261021T0136Z.json','byte_length':8471},{'filename':'DOT_UI_20261021T0141Z.json','byte_length':54659}]
    df=[{'filename':'B02_UPLOAD_STATE_20261020.txt','byte_length':158044}]
    names=['visible','controlDisabled','buttonToken','chatgptInsideAssistantEditor','chatgptComposerContextFromNode','chatgptPrimaryComposerContext','chatgptAllComposerControls','chatgptBuiltinMicrophoneButton','chatgptMicrophoneButton','chatgptWorkSubmitButton','chatgptStopButton','chatgptRecognizedSendControl','classifyChatgptComposerControl']
    functions=[]
    for name in names:
        a=content.index('  function '+name+'(');b=content.index('\n  }\n',a)+5;functions.append(content[a:b])
    constants=[l for l in content.splitlines() if l.startswith('  const CHATGPT_')]
    classify='(function(){'+ '\n'.join(constants+functions)+'\nconst sendButtonProfile=null,microphoneButtonProfile=null;return classifyChatgptComposerControl().kind;})()'
    cases={};result={'status':'RUNNING','scope':'offline actual Work/dot common composer, file states, sent ownership and code readers; no per-message completion claim','source_sha256':hashlib.sha256(source.encode()).hexdigest(),'content_sha256':hashlib.sha256(content.encode()).hexdigest(),'cases':cases}
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        try:
            page=browser.new_page();page.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body='<html><body></body></html>'))
            def mount(which, extra='', attachments=None, control=None, mutate=None):
                o=w if which=='work' else d;root=work_root if which=='work' else dot_root
                page.goto(o['url']);page.set_content(root+extra)
                if attachments is not None:page.evaluate('(html)=>document.querySelector("[data-composer-attachments]").outerHTML=html',attachments)
                if control is not None:page.evaluate('(html)=>{let b=[...document.querySelectorAll("button")].find(b=>["Начать голосовой разговор","Отправить"].includes(b.getAttribute("aria-label")));b.outerHTML=html;}',control)
                if mutate:page.evaluate(mutate)
                page.evaluate(identity);page.evaluate(source)
            def state(desc):
                return page.evaluate('''ds=>{let a=OzonAIAdapters.ADAPTERS.chatgpt,c=a.composerContext(),s=a.attachmentSurface();return {kind:c?.surfaceKind||null,context:!!c,file:!!s,input:s?.input?.getAttribute('aria-label')||s?.input?.getAttribute('data-role')||null,ready:a.attachmentReady(ds),send:!!a.sendButton(c),required:a.requiresSentAttachmentMessage?.(),users:a.userMessages().length,assistants:a.assistantMessages().length};}''',desc)
            for which in ['work','dot']:
                desc=wf if which=='work' else df;mount(which);actual=state(desc)
                assert actual['kind']=='observed_'+which and actual['context'] and actual['file'] and not actual['ready'] and actual['required'],(which,actual)
                assert actual['input']==('Прикрепить файлы' if which=='work' else 'file-input'),actual
                cases[which+'_actual_native_root']=actual
                for name,mutation,expect_context,expect_file in [
                    ('duplicate_root','()=>{let c=OOPS;}',False,False),
                    ('hidden_root','()=>document.body.firstElementChild.hidden=true',False,False),
                    ('disabled_input','()=>{let n=[...document.querySelectorAll("input[type=file]")].find(n=>n.getAttribute("aria-label")==="Прикрепить файлы"||n.getAttribute("data-role")==="file-input");n.disabled=true;}',True,False),
                    ('missing_menu','()=>document.querySelector("[data-composer-navigation-target=add-context]").remove()',False,False),
                    ('draft_retained','()=>document.querySelector("[contenteditable=true]").textContent="Existing draft"',True,False),
                    ('second_editor','()=>{let e=document.querySelector("[contenteditable=true]");e.after(e.cloneNode(true));}',False,False),
                ]:
                    if name=='duplicate_root':mutation='()=>{let n=document.body.firstElementChild;n.after(n.cloneNode(true));}'
                    mount(which,mutate=mutation);actual=state(desc)
                    assert actual['context']==expect_context and actual['file']==expect_file,(which,name,actual)
                    cases[which+'_'+name]=actual
            # Full received loading and ready attachments; no inferred provider upload.
            mount('work',attachments=w['afterUpload']['dom']['attachments'][1],control=w['afterUpload']['dom']['controls'][-1]);actual=state(wf)
            assert not actual['ready'] and not actual['file'] and not actual['send'],actual
            cases['work_actual_progress_blocks_ready_send']=actual
            mount('work',attachments=w['ready']['dom']['attachments'][1]);actual=state(wf)
            assert not actual['ready'] and not actual['file'],actual
            cases['work_truncated_ready_cannot_confirm_two_json_cards']=actual
            mount('work',attachments=w['ready']['dom']['attachments'][1],control=w['sent']['dom']['stop'][0]['html']);actual=state(wf)
            assert not actual['ready'] and not actual['send'] and page.evaluate(classify)=='stop',actual
            cases['work_observed_stop_blocks_file_and_send']=actual
            mount('dot',attachments=d['loading']['dom']['attachments'][0],control=d['ready']['dom']['controls'][1]);actual=state(df)
            assert not actual['ready'] and not actual['send'] and page.evaluate(classify)=='unknown',actual
            cases['dot_spinner_without_progressbar_not_ready']=actual
            mount('dot',attachments=d['ready']['dom']['attachments'][0]['html'],control=d['ready']['dom']['controls'][1]);actual=state(df)
            assert actual['ready'] and actual['send'] and not actual['file'] and page.evaluate(classify)=='send_active',actual
            cases['dot_actual_ready_and_control']=actual
            for name,mutation in [
                ('wrong_name','()=>document.querySelector("span.truncate").textContent="other.txt"'),
                ('remove_disabled','()=>document.querySelector("button[aria-label^=Удалить]").disabled=true'),
                ('remove_absent','()=>document.querySelector("button[aria-label^=Удалить]").remove()'),
                ('duplicate_card','()=>{let n=document.querySelector("[class~=\\\"group/composer-attachment\\\"]");n.after(n.cloneNode(true));}'),
                ('busy_card','()=>document.querySelector("[data-composer-attachments]").setAttribute("aria-busy","true")'),
            ]:
                mount('dot',attachments=d['ready']['dom']['attachments'][0]['html'],mutate=mutation);actual=state(df)
                assert not actual['ready'],(name,actual);cases['dot_ready_'+name]=actual
            mount('dot',attachments=d['ready']['dom']['attachments'][0]['html']);actual=state(df+df);assert not actual['ready'];cases['dot_duplicate_descriptors_rejected']=actual
            # Current context must not resolve an old control after a remount.
            mount('dot',control=d['ready']['dom']['controls'][1]);actual=page.evaluate('''()=>{let a=OzonAIAdapters.ADAPTERS.chatgpt,c=a.composerContext();c.root.replaceWith(c.root.cloneNode(true));return a.sendButtonCandidates(c).length;}''');assert actual==0;cases['stale_context_after_remount']=actual
            def receipt(desc):return page.evaluate('''ds=>{let a=OzonAIAdapters.ADAPTERS.chatgpt,n=a.userMessages()[0];return n?{id:a.messageId(n),sent:a.sentAttachmentMessage(n,ds)}:null;}''',desc)
            mount('work',work_user);actual=receipt(wf);assert actual and actual['sent'] and actual['sent']['filenames']==[x['filename'] for x in wf],actual
            assert actual['sent']['text'].startswith('Продолжи ту же B02 с e4f35436'),actual
            cases['work_actual_owned_two_json_cards_not_image_receipt']=actual
            mount('dot',dot_user);actual=receipt(df);assert actual and actual['sent'] and actual['sent']['text']==d['testText'] and actual['sent']['filenames']==[df[0]['filename']],actual
            cases['dot_actual_final_sent_card_and_text']=actual
            mount('dot',d['sent']['dom']['articles'][0]);actual=receipt(df);assert actual is None,actual;cases['dot_pending_uuid_not_sent_receipt']=actual
            for name,mutation in [
                ('busy_file','()=>document.querySelector(".attachment-list button").setAttribute("aria-busy","true")'),
                ('wrong_file_title','()=>document.querySelector(".attachment-list span[title]").setAttribute("title","other.txt")'),
                ('wrong_open_label','()=>document.querySelector(".attachment-list button").setAttribute("aria-label","Open other.txt")'),
                ('missing_attachment','()=>document.querySelector(".attachment-list").remove()'),
                ('neighbor_attachment','()=>document.body.append(document.querySelector(".attachment-list"))'),
                ('duplicate_article','()=>{let a=document.querySelector("article");a.after(a.cloneNode(true));}'),
                ('hidden_card','()=>document.querySelector(".attachment-list").hidden=true'),
            ]:
                mount('dot',dot_user,mutate=mutation);actual=receipt(df);assert not actual or actual['sent'] is None,(name,actual);cases['dot_sent_'+name]=actual
            mount('dot',dot_user);actual=receipt([{'filename':'other.txt','byte_length':1}]);assert actual['sent'] is None;cases['dot_sent_descriptor_mismatch']=actual
            def codes():return page.evaluate('''()=>{let a=OzonAIAdapters.ADAPTERS.chatgpt;return a.assistantMessages().map(n=>({id:a.messageId(n),complete:a.messageComplete(n),blocks:a.findCodeBlocks(n).map(b=>({text:a.readCodeText(b),anchor:a.geometryAnchor(b)?.getAttribute('aria-label')}))}));}''')
            mount('dot',dot_assistant);actual=codes();assert len(actual)==1 and [b['text'] for b in actual[0]['blocks']]==['B02_UPLOAD_STATE_BEGIN','B02_UPLOAD_STATE_END'],actual
            assert all(b['anchor']=='Копировать код' for b in actual[0]['blocks']) and not actual[0]['complete'],actual
            cases['dot_actual_two_code_blocks_copy_ownership']=actual
            mount('work',work_assistant);actual=codes();assert len(actual)==1 and actual[0]['id'].startswith('work-message:') and len(actual[0]['blocks'])==1 and not actual[0]['complete'],actual
            assert actual[0]['blocks'][0]['text'].endswith('SELLER_AGENTS_I1_C1_v0.2.37_LOCAL_DEVELOPMENT.zip') and actual[0]['blocks'][0]['anchor']=='Копировать код',actual
            cases['work_actual_selected_assistant_code']=actual
            for name,which,mutation,count in [
                ('wrong_conversation','work','()=>document.querySelector("[data-chatgpt-selection-conversation-id]").setAttribute("data-chatgpt-selection-conversation-id","other")',0),
                ('duplicate_work_id','work','()=>{let n=document.querySelector("[data-chatgpt-selection-message-id]");n.after(n.cloneNode(true));}',0),
                ('work_hidden','work','()=>document.querySelector("[data-chatgpt-selection-message-id]").hidden=true',0),
                ('dot_user_code','dot','()=>document.querySelector("article").classList.add("self")',0),
            ]:
                mount(which,work_assistant if which=='work' else dot_assistant,mutate=mutation);actual=codes();assert len(actual)==count,(name,actual);cases[name]=actual
            for name,mutation in [
                ('missing_copy','()=>document.querySelector("button[aria-label=\\\"Копировать код\\\"]").remove()'),
                ('duplicate_copy','()=>{let n=document.querySelector("button[aria-label=\\\"Копировать код\\\"]");n.after(n.cloneNode(true));}'),
                ('missing_source','()=>document.querySelector("[data-code-block-source]").removeAttribute("data-code-block-source")'),
            ]:
                mount('dot',dot_assistant,mutate=mutation);actual=codes();assert len(actual)==1 and len(actual[0]['blocks'])==1 and actual[0]['blocks'][0]['text']=='B02_UPLOAD_STATE_END',(name,actual);cases['dot_code_'+name]=actual
            mount('dot',dot_assistant+''.join(d['answer']['dom']['status']));actual=codes();assert len(actual)==1 and not actual[0]['complete'];cases['global_computer_status_not_terminal_proof']=actual
            # Shared branch continuity changed by this increment; no unrelated AI suite.
            page.goto('https://chatgpt.com/c/fixture');page.set_content('<form><textarea id="prompt-textarea"></textarea><button aria-label="Send message"></button></form><section data-turn="assistant" data-turn-id="legacy"><pre><code>LEGACY</code></pre></section>');page.evaluate(identity);page.evaluate(source);actual=codes();assert actual[0]['blocks'][0]['text']=='LEGACY' and actual[0]['complete'];cases['affected_legacy_reader_continuity']=actual
        finally:browser.close()
    result['status']='PASS';result['case_count']=len(cases);(output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':'PASS','case_count':len(cases)}));return 0

def run(runtime: Path, output: Path, provider="all"):
    if provider == "work-dot-files":
        return run_work_dot_files(runtime, output)
    if provider == "work-dot-initial":
        return run_work_dot_initial(runtime, output)
    if provider == "alice-ready-sent":
        return run_alice_ready_sent(runtime, output)
    if provider == "standard-sent":
        return run_standard_sent(runtime, output)
    if provider == "standard-alice-files":
        return run_standard_alice_files(runtime, output)
    if provider == "deepseek-parent-roots":
        return run_parent_roots(runtime, output, "deepseek")
    if provider == "deepseek-composer":
        return run_observed_composers(runtime, output, "deepseek")
    if provider == "deepseek-delivery-watch":
        return run_b02_delivery_watch(runtime, output, "deepseek")
    if provider == "parent-roots":
        return run_parent_roots(runtime, output)
    if provider == "claude-delivery-watch":
        return run_b02_delivery_watch(runtime, output, "claude")
    if provider == "claude-composer":
        return run_observed_composers(runtime, output, "claude")
    if provider == "observed-composers":
        return run_observed_composers(runtime, output)
    if provider == "b02-delivery-watch":
        return run_b02_delivery_watch(runtime, output)
    if provider == "grok-adapter":
        return run_grok_adapter(runtime, output)
    if provider == "gemini-adapter":
        return run_gemini_adapter(runtime, output)
    if provider == "observed-readers":
        return run_observed_readers(runtime, output)
    if provider == "sent-attachment":
        return run_sent_attachment(runtime, output)
    if provider == "kimi-adapter":
        return run_kimi_adapter(runtime, output)
    if provider == "kimi":
        return run_kimi(runtime, output)
    output.mkdir(parents=True, exist_ok=True)
    source=(runtime/"shared/ai_adapters.js").read_text()
    identity_source=(runtime/"shared/conversation_identity.js").read_text()
    cases={
      "nested_explicit_outer_actions": '<article id="outer"><div data-message-author-role="assistant" id="inner"><pre data-assistant-stream-block><code>WB_HELP_V1 {}</code><button aria-label="Copy code"></button></pre></div><div role="group" aria-label="Response actions"></div></article>',
      "mixed_document_order": '<article id="first"><div data-assistant-markdown><pre><code>FIRST</code></pre></div><div role="group" aria-label="Response actions"></div></article><li data-message-role="assistant" id="last"><pre><code>LAST</code><button aria-label="Copy code"></button></pre></li>',
      "old_and_new_same_text": '<section data-turn="assistant" data-turn-id="old"><pre><code>SAME</code></pre></section><li data-message-role="assistant" id="new"><pre><code>SAME</code><button aria-label="Копировать код"></button></pre></li>',
      "plain_text_copy": '<article id="plain"><div data-assistant-markdown><code>OZON_HELP_V2 {}\nLINE2</code><button>Копировать код</button></div><div role="group" aria-label="Действия с ответом"></div></article>',
      "late_copy_pre": '<li data-message-role="assistant" id="late"><pre><code>WB_API_V1 {\n  "operation":"seller_info",\n  "params":{}\n}</code></pre></li>',
      "legacy_viewer_cm": '<section data-turn="assistant" id="legacy"><div><button aria-label="Copy"></button><div id="code-block-viewer">LEGACY</div></div><div><button aria-label="Copy"></button><div class="cm-content">CM</div></div></section>',
      "user_reject": '<li data-message-role="user" id="user"><pre><code>WB_API_V1 {}</code><button aria-label="Copy code"></button></pre><div role="group" aria-label="Response actions"></div></li>',
      "ambiguous_nested_user": '<article id="ambiguous"><div data-assistant-markdown><code>BAD</code><button aria-label="Copy code"></button></div><div data-message-role="user">nested user</div><div role="group" aria-label="Response actions"></div></article>',
      "unrelated_actions": '<article id="unrelated"><code>BAD</code><button aria-label="Copy code"></button><div role="group" aria-label="Response actions"></div></article>',
      "two_actions": '<article id="two"><div data-assistant-markdown><code>BAD</code><button aria-label="Copy code"></button></div><div role="group" aria-label="Response actions"></div><div role="group" aria-label="Response actions"></div></article>',
      "response_copy_only_plain": '<li data-message-role="assistant" id="response-only"><div id="shared"><code>WB_API_V1 {}</code><div data-assistant-message-actions data-message-actions role="group" aria-label="Response actions"><button id="response-copy" aria-label="Copy">Copy</button></div></div></li>',
      "response_copy_data_state_plain": '<li data-message-role="assistant" id="response-data-state"><div><code>WB_API_V1 {}</code><div data-message-actions role="group" aria-label="Response actions"><button id="response-copy-state" data-code-copy-state="idle" aria-label="Copy">Copy</button></div></div></li>',
      "fenced_response_copy": '<li data-message-role="assistant" id="fenced-response"><pre id="fenced-pre"><code>FENCED</code></pre><div data-message-actions role="group" aria-label="Response actions"><button id="response-copy-fenced" aria-label="Copy">Copy</button></div></li>',
      "real_and_response_copy": '<li data-message-role="assistant" id="both"><div id="real-root"><code>REAL</code><button id="real-copy" data-code-copy-state="idle" aria-label="Copy code"></button></div><div data-assistant-message-actions role="group" aria-label="Response actions"><button id="response-copy-both" aria-label="Copy">Copy</button></div></li>',
      "localized_response_copy": '<li data-message-role="assistant" id="localized-response"><div><code>BAD</code><div data-message-actions role="group" aria-label="Действия с ответом"><button id="localized-response-copy">Копировать</button></div></div></li>'
    }
    content_source=(runtime/"content_script.js").read_text()
    function_names = [
        "visible", "controlDisabled", "buttonToken", "chatgptInsideAssistantEditor",
        "chatgptAllComposerControls", "chatgptBuiltinMicrophoneButton",
        "chatgptMicrophoneButton", "chatgptWorkSubmitButton",
        "chatgptStopButton", "chatgptRecognizedSendControl", "classifyChatgptComposerControl",
    ]
    functions=[]
    for name in function_names:
        start=content_source.index("  function "+name+"(")
        end=content_source.index("\n  }\n",start)+5
        functions.append(content_source[start:end])

    constants=[line for line in content_source.splitlines() if line.startswith("  const CHATGPT_")]
    # Probe the real selection function, not the classification-only stub below.
    context_functions=[]
    for name in ["visible", "chatgptInsideAssistantEditor", "chatgptComposerContextFromNode", "chatgptPrimaryComposerContext"]:
        start=content_source.index("  function "+name+"(")
        end=content_source.index("\n  }\n",start)+5
        context_functions.append(content_source[start:end])
    context_probe = "(function(){" + "\n".join(constants+context_functions) + """
      const context=chatgptPrimaryComposerContext();
      return context ? {composer:context.composer.getAttribute('data-probe'),form:context.form.id} : null;
    })()"""
    composer_probe = "(function(){" + "\n".join(constants+functions) + """
      const sendButtonProfile=null, microphoneButtonProfile=null;
      function chatgptPrimaryComposerContext() {
        return {form:document.querySelector('#composer-form'),composer:document.querySelector('#composer')};
      }
      const result=classifyChatgptComposerControl();
      return {kind:result.kind, id:result.button?.id||null};
    })()"""
    result={"status":"RUNNING","scope":"offline synthetic Chromium adapter and composer-state classification","source_sha256":hashlib.sha256(source.encode()).hexdigest(),"content_source_sha256":hashlib.sha256(content_source.encode()).hexdigest(),"cases":{}}
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        try:
            page=browser.new_page()
            page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body="<html><body></body></html>"))
            page.goto("https://fixture.invalid/")  # Secure, fully local DOM fixture for Web Crypto.

            # Derived from the Tester's 19 Oct Standard UI observation: form,
            # contenteditable textbox, aria-label, no prompt id/testid.
            observed = '<div contenteditable="true" role="textbox" aria-label="Ask ChatGPT" data-probe="observed" style="height:24px"></div>'
            current = '<form id="observed-form">'+observed+'<button type="submit" aria-label="Send"></button></form>'
            legacy = '<form id="legacy-form"><textarea id="prompt-textarea" data-probe="legacy"></textarea></form>'
            selected = {"composer":"observed","form":"observed-form"}
            context_cases = {
                "observed_standard_form": (current, selected),
                "observed_hidden_clone": ('<div hidden>'+current.replace('observed-form','hidden-form')+'</div>'+current, selected),
                "observed_multiple_forms_rejected": (current+current.replace('observed-form','other-form'), None),
                "observed_two_fields_rejected": ('<form>'+observed+observed+'</form>', None),
                "observed_user_message_rejected": ('<li data-message-role="user">'+current+'</li>', None),
                "observed_assistant_message_rejected": ('<li data-message-role="assistant">'+current+'</li>', None),
                "observed_author_role_rejected": ('<div data-message-author-role="user">'+current+'</div>', None),
                "observed_section_turn_rejected": ('<section data-turn="user">'+current+'</section>', None),
                "observed_article_rejected": ('<article>'+current+'</article>', None),
                "observed_role_article_rejected": ('<div role="article">'+current+'</div>', None),
                "observed_writing_block_rejected": ('<div data-writing-block>'+current+'</div>', None),
                "observed_dialog_rejected": ('<div role="dialog">'+current+'</div>', None),
                "observed_outside_form_rejected": (observed, None),
                "unobserved_label_rejected": (current.replace('Ask ChatGPT','Edit message'), None),
                "legacy_prompt_preserved": (legacy, {"composer":"legacy","form":"legacy-form"}),
                "legacy_prompt_precedence": (legacy+current, {"composer":"legacy","form":"legacy-form"}),
            }
            for name,(html,expected) in context_cases.items():
                page.set_content(html)
                actual=page.evaluate(context_probe)
                assert actual == expected, (name,actual,expected)
                result["cases"][name]=actual
            for name,html in cases.items():
                page.set_content(html)
                page.evaluate(identity_source)
                page.evaluate(source)
                result["cases"][name]=page.evaluate("""()=>{const a=OzonAIAdapters.ADAPTERS.chatgpt;return a.assistantMessages().map(m=>{const blocks=a.findCodeBlocks(m);return {id:a.messageId(m),blocks:blocks.map(b=>a.readCodeText(b)),anchors:blocks.map(b=>a.geometryAnchor(b)?.id||null)};});}""")
            user_cases = {
                "attributed_user": ('<li data-message-role="user" id="u1"><h4 data-message-attribution>You said:</h4><div data-submit-message-animation-target><button data-user-message-bubble><p data-user-message-copy>Exact instruction</p></button><div data-user-message-actions>Copy Edit message</div></div></li>', "Exact instruction"),
                "localized_attribution": ('<li data-message-role="user" id="u2"><h4 data-message-attribution>Вы сказали:</h4><p data-user-message-copy>Exact instruction</p></li>', "Exact instruction"),
                "literal_label_in_body": ('<li data-message-role="user" id="u3"><h4 data-message-attribution>You said:</h4><p data-user-message-copy>You said: is part of my instruction</p></li>', "You said: is part of my instruction"),
                "ambiguous_bodies": ('<li data-message-role="user" id="u4"><p data-user-message-copy>First</p><p data-user-message-copy>Second</p></li>', ""),
                "legacy_user": ('<section data-turn="user" data-turn-id="u5">Exact instruction</section>', "Exact instruction"),
            }
            for name,(html,expected) in user_cases.items():
                page.set_content(html)
                page.evaluate(identity_source)
                page.evaluate(source)
                actual=page.evaluate("""()=>{const a=OzonAIAdapters.ADAPTERS.chatgpt,n=a.userMessages()[0];return {id:a.messageId(n),text:a.messageText(n)};}""")
                assert actual["text"] == expected, (name,actual)
                assert actual["id"].startswith("u"), (name,actual)
                result["cases"][name]=actual
            modern = '<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message" {attrs}>Send</button>'
            composer_cases = {
                "modern_submit_active": (modern.format(attrs=""), "work_send_active"),
                "modern_submit_aria_disabled": (modern.format(attrs='aria-disabled="true"'), "work_send_disabled"),
                "modern_submit_native_disabled": (modern.format(attrs="disabled"), "work_send_disabled"),
                "modern_submit_stop": (modern.format(attrs="").replace('aria-label="Send message"', 'aria-label="Stop generating"'), "stop"),
                "localized_submit_active": ('<button id="localized" data-composer-submit data-send-label="Envoyer" data-stop-label="Arrêter" aria-label="Envoyer">Envoyer</button>', "work_send_active"),
                "localized_submit_stop": ('<button id="localized" data-composer-submit data-send-label="Envoyer" data-stop-label="Arrêter" aria-label="Arrêter">Arrêter</button>', "stop"),
                "duplicate_submit_rejected": (modern.format(attrs="")+modern.format(attrs="").replace('id="modern"','id="other"'), "unknown"),
                "assistant_submit_rejected": ('<section data-turn="assistant">'+modern.format(attrs="")+'</section>', "unknown"),
                "outside_submit_rejected": ('</form>'+modern.format(attrs="")+'<form>', "unknown"),
                "legacy_work_submit": ('<button id="composer-submit-button" data-testid="send-button" disabled>Send</button>', "work_send_disabled"),
                "legacy_microphone": ('<button data-testid="composer-speech-button">Voice</button>', "microphone"),
                "active_send_with_microphone": ('<button aria-label="Send message">Send</button><button data-testid="composer-speech-button">Voice</button>', "send_active"),
                "disabled_send_with_microphone": ('<button aria-label="Send message" disabled>Send</button><button data-testid="composer-speech-button">Voice</button>', "microphone"),
                "stop_with_microphone": ('<button aria-label="Stop generating">Stop</button><button data-testid="composer-speech-button">Voice</button>', "stop"),
            }
            for name,(buttons,expected) in composer_cases.items():
                page.set_content('<form id="composer-form"><textarea id="composer"></textarea>'+buttons+'</form>')
                actual=page.evaluate(composer_probe)
                assert actual["kind"] == expected, (name,actual,expected)
                result["cases"][name]=actual
        finally:
            browser.close()
    assert [x["id"] for x in result["cases"]["nested_explicit_outer_actions"]]==["inner"]
    assert [x["id"] for x in result["cases"]["mixed_document_order"]]==["first","last"]
    assert [x["id"] for x in result["cases"]["old_and_new_same_text"]]==["old","new"]
    assert result["cases"]["old_and_new_same_text"][0]["blocks"]==["SAME"]
    assert result["cases"]["old_and_new_same_text"][1]["blocks"]==["SAME"]
    assert result["cases"]["plain_text_copy"][0]["blocks"]==["OZON_HELP_V2 {}\nLINE2"]
    assert result["cases"]["late_copy_pre"][0]["blocks"]==['WB_API_V1 {\n  "operation":"seller_info",\n  "params":{}\n}']
    assert result["cases"]["legacy_viewer_cm"][0]["blocks"]==["LEGACY","CM"]
    for name in ["user_reject","ambiguous_nested_user","unrelated_actions","two_actions"]:
        assert result["cases"][name]==[], (name,result["cases"][name])
    assert result["cases"]["response_copy_only_plain"][0]["blocks"]==[]
    assert result["cases"]["response_copy_data_state_plain"][0]["blocks"]==[]
    assert result["cases"]["localized_response_copy"][0]["blocks"]==[]
    assert result["cases"]["fenced_response_copy"][0]["blocks"]==["FENCED"]
    assert result["cases"]["fenced_response_copy"][0]["anchors"]==["fenced-pre"]
    assert result["cases"]["real_and_response_copy"][0]["blocks"]==["REAL"]
    assert result["cases"]["real_and_response_copy"][0]["anchors"]==["real-copy"]
    if provider == "all":
        run_kimi(runtime, output/"kimi")
        run_kimi_adapter(runtime, output/"kimi-adapter")
        result["additional_provider_results"] = {"kimi":"kimi/result.json","kimi_adapter":"kimi-adapter/result.json"}
    result["status"]="PASS"
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(result,ensure_ascii=False))
    return 0

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--provider",choices=["all","chatgpt","work-dot-files","work-dot-initial","alice-ready-sent","standard-sent","standard-alice-files","kimi","kimi-adapter","sent-attachment","observed-readers","gemini-adapter","grok-adapter","b02-delivery-watch","observed-composers","claude-composer","claude-delivery-watch","parent-roots","deepseek-parent-roots","deepseek-composer","deepseek-delivery-watch"],default="all")
    args=parser.parse_args()
    raise SystemExit(run(args.runtime.resolve(),args.output.resolve(),args.provider))
