/* B02 observed Claude composer/file primitives.
 * Accepted 19 Oct DOM only. Message identity/common chat ancestry and upload-end
 * are incomplete: this factory is packaged but NOT activated in the registry.
 * It creates no instruction, click, execution, permanent ID or delivery receipt. */
(() => {
  "use strict";
  const ID = "claude", ORIGIN = "https://claude.ai";
  const EDITOR = "[data-testid=\"chat-input\"][contenteditable=\"true\"][role=\"textbox\"]", ROOT = "div.flex.w-full.min-w-0.flex-col", MESSAGE = "[data-testid=\"user-message\"],[data-testid=\"assistant-message\"]";
  const INPUT = "input[type=\"file\"][data-testid=\"file-upload\"]#chat-input-file-upload-bottom", CARD = "[data-testid=\"file-thumbnail\"]";
  const EXCLUDED = '[hidden],[aria-hidden="true"],[inert],[role="dialog"]';
  const fail = code => { throw Object.assign(new Error(code), {code}); };
  const matchesLocation = () => location.origin === ORIGIN;
  function rendered(node) {
    if (!(node instanceof HTMLElement) || !node.isConnected || node.closest(EXCLUDED)) return false;
    const rect = node.getBoundingClientRect();
    if (!node.getClientRects().length || rect.width <= 0 || rect.height <= 0) return false;
    for (let p = node; p instanceof Element; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse" ||
          s.contentVisibility === "hidden" || Number(s.opacity) === 0) return false;
    }
    return true;
  }
  const validName = name => typeof name === "string" && name.length > 4 && name.length <= 255 &&
    !/[\\/\u0000-\u001f]/u.test(name) && /\.txt$/i.test(name);
  function create({readComposerText, setComposerText}) {
    const reader = globalThis.SellerAgentsObservedAICodeReaders.readers[ID];
    function composerContext() {
      if (!matchesLocation()) return null;
      const editors = [...document.querySelectorAll(EDITOR)].filter(n => rendered(n) &&
        !n.closest(MESSAGE) && !n.closest('[aria-disabled="true"]') &&
        (n instanceof HTMLTextAreaElement ? !n.disabled && !n.readOnly : n.isContentEditable));
      if (editors.length !== 1) return null;
      const composer = editors[0], root = composer.closest(ROOT);
      if (!root || !rendered(root) || root.isContentEditable || root.closest(MESSAGE) ||
          root.parentElement?.closest(ROOT) || root.querySelectorAll(EDITOR).length !== 1 ||
          root.querySelectorAll('input[type="file"]').length !== 1 ||
          root.querySelectorAll(INPUT).length !== 1 || root.querySelector(MESSAGE)) return null;
      
      return {root, composer, form:composer.closest("form"), locationHref:location.href};
    }
    function currentContext(context) {
      if (!context || context.locationHref !== location.href) return null;
      const fresh = composerContext();
      return fresh && fresh.root === context.root && fresh.composer === context.composer ? fresh : null;
    }
    function cards(root) {
      return [...root.querySelectorAll(CARD)].filter(n => !n.closest(MESSAGE) && rendered(n));
    }
    function controls(context) {
      const c = currentContext(context);
      return c ? [...c.root.querySelectorAll("button")].filter(n => !n.closest(MESSAGE) && rendered(n)) : [];
    }
    function classify(context) {
      const c = currentContext(context);
      if (!c) return {kind:"unknown",button:null};
      const stops = [...document.querySelectorAll('button[data-testid="chat-input-stop"][aria-label="Остановить ответ"]')]
        .filter(n => !n.closest(MESSAGE) && rendered(n));
      if (stops.length) return {kind:stops.length === 1 ? "stop" : "unknown",
        button:stops.length === 1 && c.root.contains(stops[0]) ? stops[0] : null};
      // Busy was observed with a missing data-is-streaming attribute.
      // Only explicit false clears this signal; absence is not idle evidence.
      const assistantStates = [...document.querySelectorAll('[data-testid="assistant-message"]')].filter(rendered);
      if (assistantStates.some(n => n.getAttribute("data-is-streaming") === "true")) return {kind:"busy",button:null};
      if (assistantStates.some(n => n.getAttribute("data-is-streaming") !== "false")) return {kind:"unknown",button:null};
      if (c.root.querySelector('[role="progressbar"],[aria-busy="true"]')) return {kind:"busy",button:null};
      const sends = controls(c).filter(n => n.matches('button[data-testid="chat-input-send"][aria-label="Отправить сообщение"]'));
      if (sends.length !== 1) return {kind:"unknown",button:null};
      const button = sends[0], disabled = button.disabled || button.matches(":disabled") ||
        button.getAttribute("aria-disabled") === "true" || button.hasAttribute("data-disabled");
      return {kind:disabled ? "send_disabled" : "send_active",button};
    }
    function attachmentPreview(filename) {
      const c = composerContext();
      if (!c || !validName(filename)) return null;
      const list = cards(c.root);
      if (list.length !== 1) return null;
      const names = list[0].querySelectorAll('[data-cds="CardLink"][title]'),
        badges = list[0].querySelectorAll('[data-cds="Badge"]');
      return names.length === 1 && badges.length === 1 && names[0].getAttribute("title") === filename &&
        badges[0].textContent.trim() === "TXT" ? list[0] : null;
    }
    function attachmentSurface() {
      const c = composerContext();
      if (!c || !["ready","send_disabled"].includes(classify(c).kind) ||
          readComposerText(c.composer).trim() || cards(c.root).length) return null;
      const input = c.root.querySelector(INPUT);
      if (!(input instanceof HTMLInputElement) || !input.isConnected || !input.multiple ||
          input.disabled || input.matches(":disabled") || input.files?.length ||
          input.getAttribute("aria-disabled") === "true" || input.closest(EXCLUDED) ||
          !(input.getAttribute("accept") === "")) return null;
      return {kind:"file_input_v1",input,root:c.root,locationHref:c.locationHref};
    }
    return Object.freeze({
      id:ID, label:"Claude", matchesLocation, composerContext,
      classifyComposerControl:classify, allComposerControls:controls,
      readComposerText(composer) { return composerContext()?.composer === composer ? readComposerText(composer) : ""; },
      setComposerText(composer,value) {
        const c = composerContext();
        if (!c || c.composer !== composer || !["ready","send_active","send_disabled"].includes(classify(c).kind))
          fail("COMPOSER_NOT_AVAILABLE");
        setComposerText(composer,value);
        if (!currentContext(c) || readComposerText(composer) !== String(value || "")) fail("COMPOSER_CONTEXT_CHANGED");
      },
      sendButtonCandidates(context) {
        const s = classify(context);
        return s.kind === "send_active" ? [{button:s.button,score:2000}] : [];
      },
      sendButton(context) { return this.sendButtonCandidates(context)[0]?.button || null; },
      sendButtonFingerprint(button) {
        const s = classify(composerContext());
        return s.button === button && button instanceof HTMLElement ?
          [button.tagName,button.getAttribute("data-testid") || "",button.getAttribute("aria-label") || "",button.type].join("|") : "";
      },
      isGenerating() { return ["stop","busy","unknown"].includes(classify(composerContext()).kind); },
      assistantMessages:reader.assistantMessages,
      findCodeBlocks:reader.findCodeBlocks, readCodeText:reader.readCodeText, geometryAnchor:reader.geometryAnchor,
      // No ordinal, generated ID or text hash is promoted to a native message identity.
      messageId() { return ""; },
      messageComplete() { return false; },
      attachmentSurface, attachmentPreview,
      attachFiles(surface,files) {
        const c = attachmentSurface();
        if (!c || c.input !== surface?.input || c.root !== surface?.root ||
            c.locationHref !== surface?.locationHref || c.kind !== surface?.kind)
          fail("TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE");
        if (!Array.isArray(files) || files.length !== 1 || !(files[0] instanceof File) ||
            !validName(files[0].name) || files[0].size > 1024 * 1024 || !["","text/plain"].includes(files[0].type))
          fail("TARGET_AI_FILE_TYPE_UNSUPPORTED");
        return globalThis.OzonWebFileAttachment.setInputFiles(c.input,files);
      },
      // A filename/card plus enabled Send is not evidence of upload completion.
      attachmentReady() { return false; },
      sentAttachmentMessage() { return null; },
      integrationStatus() {
        return Object.freeze({status:"pending",message_identity:"not_observed",
          upload_end:"not_observed",registry_activated:false});
      }
    });
  }
  globalThis.SellerAgentsClaudeAdapter = Object.freeze({create});
})();
