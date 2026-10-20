/* Gemini B02 adapter from accepted 19 Oct DOM.
 * The paired container ID is a document-local turn witness, not a chat ID.
 * Native UI filechooser was observed, but no usable DOM file input/drop
 * surface was captured. File injection therefore remains unavailable.
 * No click, clipboard, execution or signed authority is created here. */
(() => {
  "use strict";
  const ORIGIN = "https://gemini.google.com";
  const ROOT = ".text-input-field";
  const EDITOR = 'rich-textarea > .ql-editor[contenteditable="true"][role="textbox"]';
  const MESSAGE = "user-query, model-response";
  const EXCLUDED = '[hidden],[aria-hidden="true"],[inert],[role="dialog"]';
  const SEND = "Отправить сообщение";
  const STOP = "Остановить генерацию ответа";
  const VOICE = "Начать голосовой ввод (^⇧D)";
  const matchesLocation = () => location.origin === ORIGIN;
  const fail = code => { throw Object.assign(new Error(code), { code }); };
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
  const txt = d => typeof d?.filename === "string" && d.filename.length > 4 &&
    d.filename.length <= 255 && !/[\\/\u0000-\u001f]/u.test(d.filename) && /\.txt$/i.test(d.filename) &&
    Number.isSafeInteger(d.byte_length) && d.byte_length >= 0 && d.byte_length <= 1024 * 1024;
  function create({ readComposerText, setComposerText }) {
    const reader = globalThis.SellerAgentsObservedAICodeReaders.readers.gemini;
    function own(node, role) {
      if (!matchesLocation() || !(node instanceof HTMLElement) || !node.matches(role) ||
          !rendered(node) || node.isContentEditable || node.parentElement?.closest(MESSAGE) ||
          node.querySelector(MESSAGE) ||
          [...node.querySelectorAll("[contenteditable]")].some(n => n.isContentEditable)) return false;
      const parent = node.parentElement;
      return Boolean(parent?.matches(".conversation-container[id]") && parent.id &&
        parent.querySelectorAll(role).length === 1);
    }
    const userMessages = () => [...document.querySelectorAll("user-query")].filter(n => own(n, "user-query"));
    const assistantMessages = () => reader.assistantMessages().filter(n => own(n, "model-response"));
    function messageId(node) {
      const role = own(node, "user-query") ? "user" : own(node, "model-response") ? "assistant" : "";
      const id = node?.parentElement?.id || "";
      if (!role || id.length > 220 || /[\s|\u0000-\u001f]/u.test(id)) return "";
      const peers = role === "user" ? userMessages() : assistantMessages();
      return peers.filter(n => n.parentElement.id === id).length === 1 ? role + ":" + id : "";
    }
    function composerContext() {
      if (!matchesLocation()) return null;
      const editors = [...document.querySelectorAll(EDITOR)].filter(n =>
        rendered(n) && n.isContentEditable && !n.closest(MESSAGE) && !n.closest('[aria-disabled="true"]'));
      if (editors.length !== 1) return null;
      const composer = editors[0], root = composer.closest(ROOT);
      if (!root || !rendered(root) || root.isContentEditable || root.closest(MESSAGE) ||
          root.parentElement?.closest(ROOT) || [...root.querySelectorAll(EDITOR)].filter(rendered).length !== 1) return null;
      return { root, composer, form: composer.closest("form"), locationHref: location.href };
    }
    function currentContext(context) {
      if (!context || context.locationHref !== location.href) return null;
      const current = composerContext();
      return current && current.root === context.root && current.composer === context.composer ? current : null;
    }
    function controls(context) {
      const c = currentContext(context);
      return c ? [...c.root.querySelectorAll("button")].filter(n =>
        n.closest(ROOT) === c.root && !n.closest(MESSAGE) && rendered(n)) : [];
    }
    function classify(context) {
      const c = currentContext(context);
      if (!c) return { kind: "unknown", button: null };
      const all = controls(c), stops = all.filter(n => n.getAttribute("aria-label") === STOP);
      if (stops.length) return { kind: stops.length === 1 ? "stop" : "unknown", button: stops.length === 1 ? stops[0] : null };
      if (c.root.querySelector('[role="progressbar"], [aria-busy="true"]')) return { kind: "busy", button: null };
      const sends = all.filter(n => n.getAttribute("aria-label") === SEND);
      if (sends.length === 1) {
        const button = sends[0], disabled = button.disabled || button.matches(":disabled") || button.getAttribute("aria-disabled") === "true";
        return { kind: disabled ? "send_disabled" : "send_active", button };
      }
      if (sends.length) return { kind: "unknown", button: null };
      const voice = all.filter(n => n.getAttribute("aria-label") === VOICE);
      return voice.length === 1 && !readComposerText(c.composer).trim() &&
        !c.root.querySelector(".gem-attachment-content") ? { kind: "ready", button: null } : { kind: "unknown", button: null };
    }
    function visibleText(node) {
      const read = n => {
        if (n.nodeType === Node.TEXT_NODE) return n.nodeValue || "";
        if (!(n instanceof Element) || n.matches('h5.screen-reader-user-query-label,button,user-query-file-preview,[hidden],[aria-hidden="true"],[inert]')) return "";
        const s = getComputedStyle(n);
        if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse") return "";
        return [...n.childNodes].map(read).join("") + (/^(P|DIV|BR|LI|PRE)$/.test(n.tagName) ? "\n" : "");
      };
      return read(node);
    }
    function messageText(node) {
      if (own(node, "user-query")) {
        const parts = [...node.querySelectorAll(".query-text")].filter(n => n.closest("user-query") === node && rendered(n));
        return parts.length === 1 ? visibleText(parts[0]) : "";
      }
      return own(node, "model-response") ? node.innerText || "" : "";
    }
    function attachmentPreview(filename) {
      const c = composerContext();
      if (!c || !txt({ filename, byte_length: 0 })) return null;
      const cards = [...c.root.querySelectorAll(".gem-attachment-content")].filter(rendered);
      if (cards.length !== 1) return null;
      const names = cards[0].querySelectorAll(".gem-attachment-text");
      const ext = cards[0].querySelectorAll(".gem-attachment-extension-label");
      return names.length === 1 && ext.length === 1 &&
        names[0].textContent === filename.slice(0, -4) && ext[0].textContent.trim().toUpperCase() === "TXT" ? cards[0] : null;
    }
    return Object.freeze({
      id: "gemini", label: "Gemini", matchesLocation,
      userMessages, assistantMessages, messageId, messageText,
      findCodeBlocks: reader.findCodeBlocks, readCodeText: reader.readCodeText, geometryAnchor: reader.geometryAnchor,
      composerContext,
      readComposerText(composer) { return composerContext()?.composer === composer ? readComposerText(composer) : ""; },
      setComposerText(composer, value) {
        const c = composerContext();
        if (!c || c.composer !== composer || !["ready","send_active","send_disabled"].includes(classify(c).kind)) fail("COMPOSER_NOT_AVAILABLE");
        setComposerText(composer, value);
        if (!currentContext(c) || readComposerText(composer) !== String(value || "")) fail("COMPOSER_CONTEXT_CHANGED");
      },
      classifyComposerControl: classify,
      allComposerControls: controls,
      sendButtonCandidates(context) { const c = classify(context); return c.kind === "send_active" ? [{ button: c.button, score: 2000 }] : []; },
      sendButton(context) { return this.sendButtonCandidates(context)[0]?.button || null; },
      sendButtonFingerprint(button) {
        const c = classify(composerContext());
        return c.button === button && button instanceof HTMLButtonElement ?
          [button.tagName, button.getAttribute("aria-label") || ""].join("|") : "";
      },
      isGenerating() { return ["stop","busy","unknown"].includes(classify(composerContext()).kind); },
      messageComplete(node) {
        return own(node, "model-response") && Boolean(messageId(node)) &&
          ["ready","send_active","send_disabled"].includes(classify(composerContext()).kind) && Boolean(messageText(node));
      },
      deliveryCapabilities() { return globalThis.OzonAIDeliveryCapabilities?.profile?.("gemini") || null; },
      attachmentSurface() { return null; },
      attachFiles() { fail("TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE"); },
      attachmentPreview,
      attachmentReady(descriptors) {
        const c = composerContext();
        return Boolean(c && Array.isArray(descriptors) && descriptors.length === 1 && txt(descriptors[0]) &&
          attachmentPreview(descriptors[0].filename) &&
          ["send_active","send_disabled"].includes(classify(c).kind) &&
          !c.root.querySelector('[role="progressbar"], [aria-busy="true"]'));
      },
      sentAttachmentMessage(node, descriptors) {
        if (!own(node, "user-query") || !messageId(node) || !Array.isArray(descriptors) ||
            descriptors.length !== 1 || !txt(descriptors[0])) return null;
        const cards = [...node.querySelectorAll("user-query-file-preview button.new-file-preview-file")].filter(rendered);
        if (cards.length !== 1 || cards[0].getAttribute("aria-label") !== descriptors[0].filename) return null;
        const ext = cards[0].querySelectorAll('[data-test-id="extension-label"]');
        const name = cards[0].querySelectorAll('[data-test-id="filename-label"]');
        if (ext.length !== 1 || name.length !== 1 || ext[0].textContent.trim().toUpperCase() !== "TXT" ||
            name[0].textContent !== descriptors[0].filename.slice(0, -4)) return null;
        const text = messageText(node);
        return text.trim() ? Object.freeze({ text }) : null;
      }
    });
  }
  globalThis.SellerAgentsGeminiAdapter = Object.freeze({ create });
})();
