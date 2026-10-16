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
            page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body="<html><body></body></html>"))
            page.goto("https://fixture.invalid/")  # Secure, fully local DOM fixture for Web Crypto.
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
