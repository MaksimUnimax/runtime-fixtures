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



def run_gemini_adapter(runtime: Path, output: Path):
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
    case("registered_text_only_adapter",root(),"return [OzonAIAdapters.adapterForLocation('auto')?.id,OzonAIDeliveryCapabilities.profile('gemini').status,BB2ConversationIdentity.providerForOrigin(location.origin)]",["gemini","text_only","gemini"])
    case("file_transport_pending_not_supported",root(),"const f=OzonAIDeliveryCapabilities.supportsFile('gemini',{filename:'report.txt',byte_length:85});return [f.supported,f.status,f.reason,OzonAIDeliveryCapabilities.generatedTextDecision('gemini','x').representation,OzonAIDeliveryCapabilities.generatedTextDecision('gemini','x'.repeat(5000)).representation]",[False,"pending","attachment_surface_not_observed","plain_text","text_document"])
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
    result={"status":"RUNNING","scope":"B02 Gemini offline composer/message/code/TXT recognition; no provider activation/native upload/installed acceptance",
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
                page.set_content('<style>user-query,model-response,response-container,rich-textarea{display:block}</style>'+html)
                page.evaluate(identity);page.evaluate(capabilities);page.evaluate(bundle)
                actual=page.evaluate("""js=>{
                  const a=SellerAgentsGeminiAdapter.create(OzonAIAdapters),c=a.composerContext();
                  return new Function('a','c',js)(a,c);
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



def run_b02_delivery_watch(runtime: Path, output: Path):
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
    result={"status":"RUNNING","scope":"B02 actual batch-watch confirmation code, synthetic button/turns; no authority or installed acceptance",
            "content_sha256":hashlib.sha256(content.encode()).hexdigest(),"worker_sha256":hashlib.sha256(worker.encode()).hexdigest(),"cases":{}}
    failures=[]
    origins={"chatgpt":"https://chatgpt.com","alice":"https://alice.yandex.ru","qwen":"https://chat.qwen.ai","kimi":"https://www.kimi.ai","grok":"https://grok.com","gemini":"https://gemini.google.com"}
    script=r"""async ({id,origin,scenario,watch,basis})=>{
      const key=origin+'|local:fixture',old=document.createElement('div'),button=document.createElement('button');
      old.id='OLD';old.textContent=scenario==='old_matching'?'REPORT':'OLD BODY';document.body.append(old,button);
      const rows=[old],messages=[],commits=[],diagnostics=[];let clicks=0,wakes=0,stage=scenario.startsWith('restore')?'ready':'send';
      function add(text){const n=document.createElement('div');n.id='NEW';n.textContent=text;rows.push(n);document.body.append(n)}
      if(scenario.startsWith('restore'))add('REPORT');
      button.addEventListener('click',()=>{clicks++;stage='ready';if(scenario==='matching')add('REPORT');else if(scenario==='wrong_text')add('OTHER')});
      const adapter={id,userMessages:()=>rows,messageId:n=>n.id,messageText:n=>n.textContent};
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
      const code=basis+
        "\nlet activeDeliveryWatch=null;\n"+
        "function stopDeliveryWatch(){if(activeDeliveryWatch)activeDeliveryWatch.cancelled=true;activeDeliveryWatch=null}\n"+
        "async function waitForDeliveryWatchWake(s){env.wake();if(env.wakes()>=3)s.cancelled=true}\n"+
        "async function sendRuntime(type,payload){"+
          "if(type==='OZ_WORK_SEND_COMMIT'){env.commits.push(payload);return {ok:true,click_allowed:true,send_click_committed:true,chatgpt_user_baseline:payload.chatgpt_user_baseline}}"+
          "if(type==='OZ_BATCH_DELIVERY_COMPLETE'){env.messages.push(payload);return {ok:acceptedDeliveryConfirmationBasis(env.origin,payload.confirmation_basis)}}"+
          "throw new Error('unexpected message '+type);}\n"+
        watch+"\nreturn {run:runBatchDeliveryWatch,basis:expectedDeliveryConfirmationBasis(origin)};";
      const built=new Function('env',...Object.keys(env),code),api=built(env,...Object.values(env));
      const recovery={delivery_mode:'batch_watch_v1',owner_kind:'autorun',owner_id:'fixture-run',run_id:'fixture-run',origin,conversation_id:'local:fixture',conversation_key:key,delivery_id:'fixture-delivery',outgoing_text:'REPORT',send_click_committed:scenario.startsWith('restore')};
      if(scenario==='restore_known')recovery.chatgpt_user_baseline=['OLD'];
      const outcome=await api.run(recovery);
      return {ok:outcome.delivered===true,clicks,commits:commits.length,completions:messages.length,
        serializedBaseline:commits[0]?.chatgpt_user_baseline||null,confirmedId:messages[0]?.confirmed_user_turn_id||null,
        basis:messages[0]?.confirmation_basis||null,expectedBasis:api.basis};
    }"""
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True);context=browser.new_context()
        context.route("**/*",lambda route:route.fulfill(status=200,content_type="text/html",body="<html></html>"));page=context.new_page()
        for provider,origin in origins.items():
            for scenario in ["matching","empty_ready","wrong_text","old_matching","restore_known","restore_missing"]:
                name=provider+"_"+scenario
                try:
                    page.goto(origin+"/fixture");page.set_content("<html><body></body></html>");page.evaluate(identity)
                    actual=page.evaluate(script,{"id":provider,"origin":origin,"scenario":scenario,"watch":watch,"basis":basis})
                    positive=scenario in ["matching","restore_known"]
                    assert actual["ok"] is positive,actual
                    assert actual["clicks"]==(0 if scenario.startswith("restore") else 1),actual
                    assert actual["commits"]==actual["clicks"],actual
                    assert actual["completions"]==(1 if positive else 0),actual
                    expected="microphone" if provider=="chatgpt" else "alice_ready" if provider=="alice" else provider+"_user_turn_ready"
                    if positive:assert actual["basis"]==expected and actual["confirmedId"]=="NEW",actual
                    if not scenario.startswith("restore"):assert actual["serializedBaseline"]==["OLD"],actual
                    assert actual["expectedBasis"]==expected,actual
                    result["cases"][name]={"status":"PASS"}
                except Exception as exc:
                    failures.append(name);result["cases"][name]={"status":"FAIL","error":str(exc)[:1100]}
        browser.close()
    result["status"]="FAIL" if failures else "PASS";result["failed"]=failures
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"cases":len(result["cases"]),"failed":failures}))
    return 1 if failures else 0


def run(runtime: Path, output: Path, provider="all"):
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
    parser.add_argument("--provider",choices=["all","chatgpt","kimi","kimi-adapter","sent-attachment","observed-readers","gemini-adapter","grok-adapter","b02-delivery-watch"],default="all")
    args=parser.parse_args()
    raise SystemExit(run(args.runtime.resolve(),args.output.resolve(),args.provider))
