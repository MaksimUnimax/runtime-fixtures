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
    """New staged Kimi adapter/registry consumers; prior reader30 is not rerun."""
    from html import escape
    output.mkdir(parents=True, exist_ok=True)
    files = ["shared/conversation_identity.js", "shared/web_file_attachment.js",
             "shared/ai_delivery_capabilities.js", "shared/ai_adapters.js"]
    sources = [(name, (runtime/name).read_text()) for name in files]
    content = (runtime/"content_script.js").read_text()
    functions = []
    for name in ["primaryComposerContext", "allComposerControls", "sendButtonCandidates",
                 "sendButton", "stopButton", "recognizedSendControl", "classifyComposerControl"]:
        start = content.index("  function "+name+"(")
        end = content.index("\n  }\n", start)+5
        functions.append(content[start:end])
    consumers = "\n".join(functions)
    result = {"status":"RUNNING", "scope":"offline staged Kimi adapter/registry and existing consumer delegation; no activation/live UI",
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
            check("registered_but_planned_cannot_activate",editor(),"""() => ({
                id:OzonAIAdapters.ADAPTERS.kimi.id,origin:OzonAIAdapters.ADAPTERS.kimi.matchesLocation(),
                mode:OzonAIAdapters.normalizeMode('kimi'),auto:OzonAIAdapters.adapterForLocation()===null,
                explicit:OzonAIAdapters.adapterForLocation('kimi')===null,
                capability:OzonAIDeliveryCapabilities.profile('kimi').status,
                fileAllowed:OzonAIDeliveryCapabilities.fileDispatchDecision('kimi',{filename:'sample.txt',byte_length:4}).dispatch_allowed
            })""",{"id":"kimi","origin":True,"mode":"kimi","auto":True,"explicit":True,"capability":"planned","fileAllowed":False})
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
            held=page.evaluate("(function(){function currentAIAdapter(){return OzonAIAdapters.adapterForLocation();}"+consumers+"return primaryComposerContext()===null && sendButtonCandidates(null).length===0 && classifyComposerControl().kind==='unknown';})()")
            assert held is True
            result["cases"]["ordinary_work_selection_stays_closed"]={"status":"PASS"}
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


def run(runtime: Path, output: Path, provider="all"):
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
                "legacy_work_submit_active": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', "work_send_active"),
                "legacy_work_submit_stop": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Stop generating">Stop</button>', "stop"),
                "legacy_work_submit_aria_disabled": ('<button id="composer-submit-button" data-testid="send-button" aria-disabled="true" aria-label="Send message">Send</button>', "work_send_disabled"),
                "legacy_work_submit_active_and_stop": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="other-stop" aria-label="Stop generating">Stop</button>', "stop"),
                "legacy_work_submit_stop_and_microphone": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Stop generating">Stop</button><button data-testid="composer-speech-button">Voice</button>', "stop"),
                "legacy_work_submit_unrelated_stop": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="voice-recorder" aria-label="Stop recording">Stop recording</button>', "work_send_active"),
                "legacy_work_submit_ambiguous_generation_stops": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="stop-one" aria-label="Stop generating">Stop</button><button id="stop-two" aria-label="Stop generating">Stop</button>', "unknown"),
                "legacy_work_submit_generic_stop": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Stop">Stop</button>', "unknown"),
                "legacy_work_submit_generation_stop_with_unrelated_control": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Stop generating">Stop</button><button id="voice-recorder" aria-label="Stop recording">Stop recording</button>', "stop"),
                "legacy_work_submit_misleading_stop_id": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="record-stop" data-testid="stop-button" aria-label="Stop recording">Stop recording</button>', "unknown"),
                "legacy_work_submit_stop_id_verified": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="generation-stop" data-testid="stop-button" aria-label="Stop generating">Stop</button>', "stop"),
                "legacy_work_submit_stop_id_only": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="unlabeled-stop" data-testid="stop-button"></button>', "unknown"),
                "modern_work_submit_conflicting_labels": ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Send message" aria-label="Send message">Send</button>', "unknown"),
                "modern_work_submit_unmatched_declared_labels": ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Unexpected control">Unexpected</button>', "unknown"),
                "legacy_work_submit_title_only_stop": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message" title="Stop generating">Send</button>', "unknown"),
                "legacy_work_send_label_only_mismatch": ('<button id="composer-submit-button" data-testid="send-button" data-send-label="Send message" aria-label="Unexpected control">Send</button>', "unknown"),
                "legacy_work_stop_label_equals_send_label": ('<button id="composer-submit-button" data-testid="send-button" data-send-label="Stop generating" aria-label="Stop generating">Stop</button>', "unknown"),
                "legacy_work_send_label_missing_aria": ('<button id="composer-submit-button" data-testid="send-button" data-send-label="Send message">Send</button>', "unknown"),
                "modern_work_send_label_only_mismatch": ('<button id="modern" data-composer-submit data-send-label="Send message" aria-label="Unexpected control">Unexpected</button>', "unknown"),
                "legacy_work_declared_stop_without_send": ('<button id="composer-submit-button" data-testid="send-button" data-stop-label="Stop generating" aria-label="Stop generating">Stop</button>', "stop"),
                "legacy_work_deceptive_recording_stop": ('<button id="composer-submit-button" data-testid="send-button" data-stop-label="Stop recording" aria-label="Stop recording">Stop recording</button>', "unknown"),
                "legacy_work_deceptive_archive_stop": ('<button id="composer-submit-button" data-testid="send-button" data-stop-label="Archive request" aria-label="Archive request">Archive</button>', "unknown"),
                "legacy_work_with_unrelated_declared_recording": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="record-stop" data-stop-label="Stop recording" aria-label="Stop recording">Stop recording</button>', "work_send_active"),
                "standalone_declared_recording_stop": ('<button id="record-stop" data-stop-label="Stop recording" aria-label="Stop recording">Stop recording</button>', "unknown"),
                "modern_work_recording_stop_declared": ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop recording" aria-label="Stop recording">Stop recording</button>', "unknown"),
                "modern_work_mismatched_stop_labels": ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Cancel generation" aria-label="Stop generating">Stop</button>', "unknown"),
                "modern_work_declared_unknown_action": ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Delete draft" aria-label="Delete draft">Delete</button>', "unknown"),
                "legacy_microphone": ('<button data-testid="composer-speech-button">Voice</button>', "microphone"),
                "active_send_with_microphone": ('<button aria-label="Send message">Send</button><button data-testid="composer-speech-button">Voice</button>', "send_active"),
                "disabled_send_with_microphone": ('<button aria-label="Send message" disabled>Send</button><button data-testid="composer-speech-button">Voice</button>', "microphone"),
                "stop_with_microphone": ('<button aria-label="Stop generating">Stop</button><button data-testid="composer-speech-button">Voice</button>', "stop"),
            }
            composer_cases.update({
                'r9_manual_aria_and_text_before': ('<button id="ambiguous" aria-label="Stop">Stop</button><button id="manual-send" aria-label="Send message">Send</button>', 'unknown'),
                'r9_manual_aria_and_text_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="ambiguous" aria-label="Stop">Stop</button>', 'unknown'),
                'r9_manual_aria_only_before': ('<button id="ambiguous" aria-label="Stop"></button><button id="manual-send" aria-label="Send message">Send</button>', 'unknown'),
                'r9_manual_aria_only_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="ambiguous" aria-label="Stop"></button>', 'unknown'),
                'r9_manual_title_only_before': ('<button id="ambiguous" title="Stop"></button><button id="manual-send" aria-label="Send message">Send</button>', 'unknown'),
                'r9_manual_title_only_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="ambiguous" title="Stop"></button>', 'unknown'),
                'r9_manual_name_only_before': ('<button id="ambiguous" name="Stop"></button><button id="manual-send" aria-label="Send message">Send</button>', 'unknown'),
                'r9_manual_name_only_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="ambiguous" name="Stop"></button>', 'unknown'),
                'r9_manual_type_only_before': ('<button id="ambiguous" type="Stop"></button><button id="manual-send" aria-label="Send message">Send</button>', 'unknown'),
                'r9_manual_type_only_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="ambiguous" type="Stop"></button>', 'unknown'),
                'r9_manual_text_only_before': ('<button id="ambiguous">Stop</button><button id="manual-send" aria-label="Send message">Send</button>', 'unknown'),
                'r9_manual_text_only_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="ambiguous">Stop</button>', 'unknown'),
                'r9_manual_cancel_title_before': ('<button id="ambiguous" title="Cancel generation"></button><button id="manual-send" aria-label="Send message">Send</button>', 'unknown'),
                'r9_manual_cancel_title_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="ambiguous" title="Cancel generation"></button>', 'unknown'),
                'r9_manual_russian_title_before': ('<button id="ambiguous" title="Остановить"></button><button id="manual-send" aria-label="Send message">Send</button>', 'unknown'),
                'r9_manual_russian_title_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="ambiguous" title="Остановить"></button>', 'unknown'),
                'r9_manual_semantic_stop_before': ('<button id="ambiguous" data-composer-submit data-stop-label="Stop" aria-label="Stop"></button><button id="manual-send" aria-label="Send message">Send</button>', 'unknown'),
                'r9_manual_semantic_stop_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="ambiguous" data-composer-submit data-stop-label="Stop" aria-label="Stop"></button>', 'unknown'),
                'r9_manual_verified_voice_before': ('<button id="voice" data-testid="voice-stop" aria-label="End voice session"></button><button id="manual-send" aria-label="Send message">Send</button>', 'send_active'),
                'r9_manual_verified_voice_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="voice" data-testid="voice-stop" aria-label="End voice session"></button>', 'send_active'),
                'r9_manual_verified_recording_before': ('<button id="recording" aria-label="Stop recording">Stop recording</button><button id="manual-send" aria-label="Send message">Send</button>', 'send_active'),
                'r9_manual_verified_recording_after': ('<button id="manual-send" aria-label="Send message">Send</button><button id="recording" aria-label="Stop recording">Stop recording</button>', 'send_active'),
                'r9_manual_multiple_generic_stops': ('<button id="ambiguous" aria-label="Stop"></button><button id="manual-send" aria-label="Send message">Send</button><button id="second" title="Stop"></button>', 'unknown'),
                'r9_legacy_aria_and_text_before': ('<button id="ambiguous" aria-label="Stop">Stop</button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'unknown'),
                'r9_legacy_aria_and_text_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="ambiguous" aria-label="Stop">Stop</button>', 'unknown'),
                'r9_legacy_aria_only_before': ('<button id="ambiguous" aria-label="Stop"></button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'unknown'),
                'r9_legacy_aria_only_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="ambiguous" aria-label="Stop"></button>', 'unknown'),
                'r9_legacy_title_only_before': ('<button id="ambiguous" title="Stop"></button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'unknown'),
                'r9_legacy_title_only_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="ambiguous" title="Stop"></button>', 'unknown'),
                'r9_legacy_name_only_before': ('<button id="ambiguous" name="Stop"></button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'unknown'),
                'r9_legacy_name_only_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="ambiguous" name="Stop"></button>', 'unknown'),
                'r9_legacy_type_only_before': ('<button id="ambiguous" type="Stop"></button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'unknown'),
                'r9_legacy_type_only_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="ambiguous" type="Stop"></button>', 'unknown'),
                'r9_legacy_text_only_before': ('<button id="ambiguous">Stop</button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'unknown'),
                'r9_legacy_text_only_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="ambiguous">Stop</button>', 'unknown'),
                'r9_legacy_cancel_title_before': ('<button id="ambiguous" title="Cancel generation"></button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'unknown'),
                'r9_legacy_cancel_title_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="ambiguous" title="Cancel generation"></button>', 'unknown'),
                'r9_legacy_russian_title_before': ('<button id="ambiguous" title="Остановить"></button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'unknown'),
                'r9_legacy_russian_title_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="ambiguous" title="Остановить"></button>', 'unknown'),
                'r9_legacy_semantic_stop_before': ('<button id="ambiguous" data-composer-submit data-stop-label="Stop" aria-label="Stop"></button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'unknown'),
                'r9_legacy_semantic_stop_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="ambiguous" data-composer-submit data-stop-label="Stop" aria-label="Stop"></button>', 'unknown'),
                'r9_legacy_verified_voice_before': ('<button id="voice" data-testid="voice-stop" aria-label="End voice session"></button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'work_send_active'),
                'r9_legacy_verified_voice_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="voice" data-testid="voice-stop" aria-label="End voice session"></button>', 'work_send_active'),
                'r9_legacy_verified_recording_before': ('<button id="recording" aria-label="Stop recording">Stop recording</button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', 'work_send_active'),
                'r9_legacy_verified_recording_after': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="recording" aria-label="Stop recording">Stop recording</button>', 'work_send_active'),
                'r9_legacy_multiple_generic_stops': ('<button id="ambiguous" aria-label="Stop"></button><button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="second" title="Stop"></button>', 'unknown'),
                'r9_modern_aria_and_text_before': ('<button id="ambiguous" aria-label="Stop">Stop</button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'unknown'),
                'r9_modern_aria_and_text_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="ambiguous" aria-label="Stop">Stop</button>', 'unknown'),
                'r9_modern_aria_only_before': ('<button id="ambiguous" aria-label="Stop"></button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'unknown'),
                'r9_modern_aria_only_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="ambiguous" aria-label="Stop"></button>', 'unknown'),
                'r9_modern_title_only_before': ('<button id="ambiguous" title="Stop"></button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'unknown'),
                'r9_modern_title_only_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="ambiguous" title="Stop"></button>', 'unknown'),
                'r9_modern_name_only_before': ('<button id="ambiguous" name="Stop"></button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'unknown'),
                'r9_modern_name_only_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="ambiguous" name="Stop"></button>', 'unknown'),
                'r9_modern_type_only_before': ('<button id="ambiguous" type="Stop"></button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'unknown'),
                'r9_modern_type_only_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="ambiguous" type="Stop"></button>', 'unknown'),
                'r9_modern_text_only_before': ('<button id="ambiguous">Stop</button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'unknown'),
                'r9_modern_text_only_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="ambiguous">Stop</button>', 'unknown'),
                'r9_modern_cancel_title_before': ('<button id="ambiguous" title="Cancel generation"></button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'unknown'),
                'r9_modern_cancel_title_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="ambiguous" title="Cancel generation"></button>', 'unknown'),
                'r9_modern_russian_title_before': ('<button id="ambiguous" title="Остановить"></button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'unknown'),
                'r9_modern_russian_title_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="ambiguous" title="Остановить"></button>', 'unknown'),
                'r9_modern_semantic_stop_before': ('<button id="ambiguous" data-composer-submit data-stop-label="Stop" aria-label="Stop"></button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'unknown'),
                'r9_modern_semantic_stop_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="ambiguous" data-composer-submit data-stop-label="Stop" aria-label="Stop"></button>', 'unknown'),
                'r9_modern_verified_voice_before': ('<button id="voice" data-testid="voice-stop" aria-label="End voice session"></button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'work_send_active'),
                'r9_modern_verified_voice_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="voice" data-testid="voice-stop" aria-label="End voice session"></button>', 'work_send_active'),
                'r9_modern_verified_recording_before': ('<button id="recording" aria-label="Stop recording">Stop recording</button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', 'work_send_active'),
                'r9_modern_verified_recording_after': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="recording" aria-label="Stop recording">Stop recording</button>', 'work_send_active'),
                'r9_modern_multiple_generic_stops': ('<button id="ambiguous" aria-label="Stop"></button><button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="second" title="Stop"></button>', 'unknown'),
                'manual_send_with_generic_stop_id': ('<button id="manual-send" aria-label="Send message">Send</button><button id="unverified-stop" data-testid="stop"></button>', 'unknown'),
                'manual_send_with_generic_stop_id_first': ('<button id="unverified-stop" data-testid="stop"></button><button id="manual-send" aria-label="Send message">Send</button>', 'unknown'),
                'legacy_work_send_with_generic_stop_id': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="unverified-stop" data-testid="stop"></button>', 'unknown'),
                'modern_work_send_with_generic_stop_id': ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button><button id="unverified-stop" data-testid="stop"></button>', 'unknown'),
                'manual_send_with_generation_stop_id_only': ('<button id="manual-send" aria-label="Send message">Send</button><button id="unverified-stop" data-testid="generation-stop"></button>', 'unknown'),
                'manual_send_with_unlabeled_voice_stop': ('<button id="manual-send" aria-label="Send message">Send</button><button id="unverified-stop" data-testid="voice-stop"></button>', 'unknown'),
                'manual_send_with_identified_voice_stop': ('<button id="manual-send" aria-label="Send message">Send</button><button id="voice" data-testid="voice-stop" aria-label="End voice session"></button>', 'send_active'),
                'manual_send_with_verified_generic_generation_stop': ('<button id="manual-send" aria-label="Send message">Send</button><button id="generation" data-testid="stop" aria-label="Stop generating"></button>', 'stop'),
                'manual_send_with_generic_stop_id_recording_label': ('<button id="manual-send" aria-label="Send message">Send</button><button id="unverified-stop" data-testid="stop" aria-label="Stop recording"></button>', 'unknown'),
                "legacy_work_submit_localized_send": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Envoyer">Envoyer</button>', "work_send_active"),
                'legacy_work_submit_icon_only': ('<button id="composer-submit-button" data-testid="send-button"><svg></svg></button>', 'unknown'),
                'legacy_work_submit_empty': ('<button id="composer-submit-button" data-testid="send-button"></button>', 'unknown'),
                'legacy_work_submit_unexpected_label': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Unexpected control"></button>', 'unknown'),
                'legacy_work_submit_text_send': ('<button id="composer-submit-button" data-testid="send-button">Send</button>', 'work_send_active'),
                'legacy_work_submit_russian_send': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Отправить сообщение"></button>', 'work_send_active'),
                'standalone_voice_stop_id': ('<button id="voice" data-testid="voice-stop" aria-label="End voice session"></button>', 'unknown'),
                'standalone_voice_stop_id_empty': ('<button id="voice" data-testid="voice-stop"></button>', 'unknown'),
                'standalone_generic_stop': ('<button id="recording" aria-label="Stop"></button>', 'unknown'),
                'standalone_localized_recording_stop': ('<button id="recording" aria-label="Arrêter">Arrêter</button>', 'unknown'),
                'standalone_localized_declared_recording_stop': ('<button id="recording" data-stop-label="Arrêter" aria-label="Arrêter">Arrêter</button>', 'unknown'),
                'legacy_work_with_localized_recording': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="recording" aria-label="Arrêter">Arrêter</button>', 'work_send_active'),
                'legacy_work_with_voice_stop_id': ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button><button id="voice" data-testid="voice-stop" aria-label="End voice session"></button>', 'work_send_active'),
                'localized_submit_stop_without_send_pair': ('<button id="modern" data-composer-submit data-stop-label="Arrêter" aria-label="Arrêter">Arrêter</button>', 'unknown'),
                'localized_submit_recording_pair': ('<button id="modern" data-composer-submit data-send-label="Record" data-stop-label="Arrêter" aria-label="Arrêter">Arrêter</button>', 'unknown'),
                'standalone_localized_send_stop_attributes': ('<button id="recording" data-send-label="Envoyer" data-stop-label="Arrêter" aria-label="Arrêter">Arrêter</button>', 'unknown'),
            })
            # R10: each exception must withstand independent evidence from every token field.
            r10_sends = {
                "manual": ('<button id="manual-send" aria-label="Send message">Send</button>', "send_active", "manual-send"),
                "legacy": ('<button id="composer-submit-button" data-testid="send-button" aria-label="Send message">Send</button>', "work_send_active", "composer-submit-button"),
                "modern": ('<button id="modern" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating" aria-label="Send message">Send</button>', "work_send_active", "modern"),
            }
            r10_expected_control_ids = {}
            r10_signals = {"generation": "Stop generating", "cancel": "Cancel generation", "generic": "Stop", "russian": "Прервать генерацию", "localized": "Arrêter"}
            for variant, (send_html, send_kind, send_id) in r10_sends.items():
                for exception, label, testid in [("voice", "End voice session", "voice-stop"), ("recording", "Stop recording", "")]:
                    for field in ["title", "name", "type", "text", "data-testid", "data-send-label", "data-stop-label"]:
                        for signal_name, signal in r10_signals.items():
                            attrs = {"id": "non-generation", "aria-label": label}
                            if testid:
                                attrs["data-testid"] = testid
                            body = ""
                            if field == "text":
                                body = signal
                            else:
                                attrs[field] = (testid + " " + signal).strip() if field == "data-testid" else signal
                            stop_html = "<button " + " ".join(f'{key}="{value}"' for key, value in attrs.items()) + ">" + body + "</button>"
                            for order, html in [("before", stop_html + send_html), ("after", send_html + stop_html)]:
                                name = f"r10_{variant}_{exception}_{field}_{signal_name}_{order}"
                                composer_cases[name] = (html, "unknown")
                                r10_expected_control_ids[name] = None
                    # Matching labels repeated in visible text/title remain valid.
                    stop_html = f'<button id="non-generation" aria-label="{label}" title="{label}" data-testid="{testid}">{label}</button>'
                    for order, html in [("before", stop_html + send_html), ("after", send_html + stop_html)]:
                        name = f"r10_{variant}_{exception}_consistent_{order}"
                        composer_cases[name] = (html, send_kind)
                        r10_expected_control_ids[name] = send_id
            for name,(buttons,expected) in composer_cases.items():
                page.set_content('<form id="composer-form"><textarea id="composer"></textarea>'+buttons+'</form>')
                actual=page.evaluate(composer_probe)
                assert actual["kind"] == expected, (name,actual,expected)
                result["cases"][name]=actual
            expected_control_ids = {
                "legacy_work_submit_stop": "composer-submit-button",
                "legacy_work_submit_active": "composer-submit-button",
                "legacy_work_submit_active_and_stop": "other-stop",
                "legacy_work_submit_unrelated_stop": "composer-submit-button",
                "legacy_work_submit_ambiguous_generation_stops": None,
                "legacy_work_submit_generic_stop": None,
                "legacy_work_submit_generation_stop_with_unrelated_control": "composer-submit-button",
                "legacy_work_submit_misleading_stop_id": None,
                "legacy_work_submit_stop_id_verified": "generation-stop",
                "legacy_work_submit_stop_id_only": None,
                "modern_work_submit_conflicting_labels": None,
                "modern_work_submit_unmatched_declared_labels": None,
                "legacy_work_submit_title_only_stop": None,
                "legacy_work_send_label_only_mismatch": None,
                "legacy_work_stop_label_equals_send_label": None,
                "legacy_work_send_label_missing_aria": None,
                "modern_work_send_label_only_mismatch": None,
                "legacy_work_declared_stop_without_send": "composer-submit-button",
                "legacy_work_deceptive_recording_stop": None,
                "legacy_work_deceptive_archive_stop": None,
                "legacy_work_with_unrelated_declared_recording": "composer-submit-button",
                "standalone_declared_recording_stop": None,
                "modern_work_recording_stop_declared": None,
                "modern_work_mismatched_stop_labels": None,
                "modern_work_declared_unknown_action": None,
            }
            expected_control_ids.update({
                'r9_manual_aria_and_text_before': None,
                'r9_manual_aria_and_text_after': None,
                'r9_manual_aria_only_before': None,
                'r9_manual_aria_only_after': None,
                'r9_manual_title_only_before': None,
                'r9_manual_title_only_after': None,
                'r9_manual_name_only_before': None,
                'r9_manual_name_only_after': None,
                'r9_manual_type_only_before': None,
                'r9_manual_type_only_after': None,
                'r9_manual_text_only_before': None,
                'r9_manual_text_only_after': None,
                'r9_manual_cancel_title_before': None,
                'r9_manual_cancel_title_after': None,
                'r9_manual_russian_title_before': None,
                'r9_manual_russian_title_after': None,
                'r9_manual_semantic_stop_before': None,
                'r9_manual_semantic_stop_after': None,
                'r9_manual_verified_voice_before': 'manual-send',
                'r9_manual_verified_voice_after': 'manual-send',
                'r9_manual_verified_recording_before': 'manual-send',
                'r9_manual_verified_recording_after': 'manual-send',
                'r9_manual_multiple_generic_stops': None,
                'r9_legacy_aria_and_text_before': None,
                'r9_legacy_aria_and_text_after': None,
                'r9_legacy_aria_only_before': None,
                'r9_legacy_aria_only_after': None,
                'r9_legacy_title_only_before': None,
                'r9_legacy_title_only_after': None,
                'r9_legacy_name_only_before': None,
                'r9_legacy_name_only_after': None,
                'r9_legacy_type_only_before': None,
                'r9_legacy_type_only_after': None,
                'r9_legacy_text_only_before': None,
                'r9_legacy_text_only_after': None,
                'r9_legacy_cancel_title_before': None,
                'r9_legacy_cancel_title_after': None,
                'r9_legacy_russian_title_before': None,
                'r9_legacy_russian_title_after': None,
                'r9_legacy_semantic_stop_before': None,
                'r9_legacy_semantic_stop_after': None,
                'r9_legacy_verified_voice_before': 'composer-submit-button',
                'r9_legacy_verified_voice_after': 'composer-submit-button',
                'r9_legacy_verified_recording_before': 'composer-submit-button',
                'r9_legacy_verified_recording_after': 'composer-submit-button',
                'r9_legacy_multiple_generic_stops': None,
                'r9_modern_aria_and_text_before': None,
                'r9_modern_aria_and_text_after': None,
                'r9_modern_aria_only_before': None,
                'r9_modern_aria_only_after': None,
                'r9_modern_title_only_before': None,
                'r9_modern_title_only_after': None,
                'r9_modern_name_only_before': None,
                'r9_modern_name_only_after': None,
                'r9_modern_type_only_before': None,
                'r9_modern_type_only_after': None,
                'r9_modern_text_only_before': None,
                'r9_modern_text_only_after': None,
                'r9_modern_cancel_title_before': None,
                'r9_modern_cancel_title_after': None,
                'r9_modern_russian_title_before': None,
                'r9_modern_russian_title_after': None,
                'r9_modern_semantic_stop_before': None,
                'r9_modern_semantic_stop_after': None,
                'r9_modern_verified_voice_before': 'modern',
                'r9_modern_verified_voice_after': 'modern',
                'r9_modern_verified_recording_before': 'modern',
                'r9_modern_verified_recording_after': 'modern',
                'r9_modern_multiple_generic_stops': None,
                'manual_send_with_generic_stop_id': None,
                'manual_send_with_generic_stop_id_first': None,
                'legacy_work_send_with_generic_stop_id': None,
                'modern_work_send_with_generic_stop_id': None,
                'manual_send_with_generation_stop_id_only': None,
                'manual_send_with_unlabeled_voice_stop': None,
                'manual_send_with_identified_voice_stop': 'manual-send',
                'manual_send_with_verified_generic_generation_stop': 'generation',
                'manual_send_with_generic_stop_id_recording_label': None,
                "legacy_work_submit_localized_send": "composer-submit-button",
                'legacy_work_submit_icon_only': None,
                'legacy_work_submit_empty': None,
                'legacy_work_submit_unexpected_label': None,
                'legacy_work_submit_text_send': 'composer-submit-button',
                'legacy_work_submit_russian_send': 'composer-submit-button',
                'standalone_voice_stop_id': None,
                'standalone_voice_stop_id_empty': None,
                'standalone_generic_stop': None,
                'standalone_localized_recording_stop': None,
                'standalone_localized_declared_recording_stop': None,
                'legacy_work_with_localized_recording': 'composer-submit-button',
                'legacy_work_with_voice_stop_id': 'composer-submit-button',
                'localized_submit_stop_without_send_pair': None,
                'localized_submit_recording_pair': None,
                'standalone_localized_send_stop_attributes': None,
            })
            expected_control_ids.update(r10_expected_control_ids)
            for case_name, expected_id in expected_control_ids.items():
                assert result["cases"][case_name]["id"] == expected_id, (
                    case_name, result["cases"][case_name], expected_id
                )
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
    parser.add_argument("--provider",choices=["all","chatgpt","kimi","kimi-adapter"],default="all")
    args=parser.parse_args()
    raise SystemExit(run(args.runtime.resolve(),args.output.resolve(),args.provider))
