"""Focused Chromium regression for ChatGPT assistant/code ownership compatibility.
Synthetic DOM only: no live ChatGPT, marketplace, auth or installed-browser acceptance.
"""
from pathlib import Path
import argparse,hashlib,json
from playwright.sync_api import sync_playwright

def run(runtime: Path, output: Path):
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
    result["status"]="PASS"
    (output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(result,ensure_ascii=False))
    return 0

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    raise SystemExit(run(args.runtime.resolve(),args.output.resolve()))
