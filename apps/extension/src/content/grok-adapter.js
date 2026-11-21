/* Grok B02 DOM adapter: accepted S08 and 11:30-11:31 observations.
 * response-* is a local message witness, never a permanent chat ID.
 * Busy common ancestry was not captured; a visible native Stop excludes
 * sending even if outside the retained idle root. No click or authority here. */
(() => {
  "use strict";
  const ORIGIN = "https://grok.com";
  const ROOT = "div.flex.flex-col.gap-0.justify-center.w-full.relative.items-center";
  const EDITOR = '[data-testid="chat-input"] .tiptap.ProseMirror:is([role="textbox"],[role="combobox"])[contenteditable="true"]';
  const MESSAGE = 'div[id^="response-"]';
  const ROLES = '[data-testid="user-message"],[data-testid="assistant-message"]';
  const LIST = '[role="list"][aria-label="Вложения в беседе"]';
  const STOP = "Остановить ответ модели";
  const EXCLUDED = '[hidden],[aria-hidden="true"],[inert],[role="dialog"]';
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
  const txt = d => typeof d?.filename === "string" && d.filename.length > 4 && d.filename.length <= 255 &&
    !/[\\/\u0000-\u001f]/u.test(d.filename) && /\.txt$/i.test(d.filename) &&
    Number.isSafeInteger(d.byte_length) && d.byte_length >= 0 && d.byte_length <= 1024 * 1024;
  function create({ readComposerText, setComposerText }) {
    const reader = globalThis.SellerAgentsObservedAICodeReaders.readers.grok;
    function roleNode(node, role) {
      if (!matchesLocation() || !(node instanceof HTMLElement) || !node.matches(MESSAGE) ||
          !rendered(node) || node.isContentEditable || node.parentElement?.closest(MESSAGE) ||
          node.querySelector(MESSAGE) ||
          [...node.querySelectorAll("[contenteditable]")].some(n => n.isContentEditable)) return null;
      const roles = [...node.querySelectorAll(ROLES)];
      return roles.length === 1 && roles[0].parentElement === node &&
        roles[0].matches('div[role="article"][data-testid="'+role+'-message"]') && rendered(roles[0]) ? roles[0] : null;
    }
    const userMessages = () => [...document.querySelectorAll(MESSAGE)].filter(n => roleNode(n,"user"));
    const assistantMessages = () => {
      const eligible = new Set(reader.assistantMessages());
      return [...document.querySelectorAll(MESSAGE)].filter(n => eligible.has(roleNode(n,"assistant")));
    };
    function messageId(node) {
      if (!roleNode(node,"user") && !roleNode(node,"assistant")) return "";
      const id = node.id;
      return id.length > 9 && id.length <= 256 && !/[\s|\u0000-\u001f]/u.test(id) &&
        [...userMessages(),...assistantMessages()].filter(n => n.id === id).length === 1 ? id : "";
    }
    function messageText(node) {
      const role = roleNode(node,"user") || roleNode(node,"assistant");
      if (!role) return "";
      const markdown = [...role.querySelectorAll(".response-content-markdown")]
        .filter(n => n.closest(ROLES) === role && rendered(n));
      return markdown.length === 1 ? markdown[0].innerText || "" : "";
    }
    function composerContext() {
      if (!matchesLocation()) return null;
      const editors = [...document.querySelectorAll(EDITOR)].filter(n =>
        rendered(n) && n.isContentEditable && !n.closest(MESSAGE) && !n.closest('[aria-disabled="true"]'));
      if (editors.length !== 1) return null;
      const composer = editors[0], root = composer.closest(ROOT);
      if (!root || !rendered(root) || root.isContentEditable || root.closest(MESSAGE) ||
          root.parentElement?.closest(ROOT) || [...root.querySelectorAll(EDITOR)].filter(rendered).length !== 1 ||
          root.querySelectorAll('input[type="file"]').length !== 1) return null;
      return { root, composer, form: composer.closest("form"), locationHref: location.href };
    }
    function currentContext(context) {
      if (!context || context.locationHref !== location.href) return null;
      const fresh = composerContext();
      return fresh && fresh.composer === context.composer && fresh.root === context.root ? fresh : null;
    }
    const cards = root => [...root.querySelectorAll(LIST+' > [role="listitem"]')]
      .filter(n => !n.closest(MESSAGE) && rendered(n));
    const cardReady = card => rendered(card) && !card.querySelector('[role="status"],[role="progressbar"],.animate-spin,[aria-busy="true"]') &&
      !/Обработка/.test(card.innerText || "");
    function controls(context) {
      const c = currentContext(context);
      return c ? [...c.root.querySelectorAll("button")].filter(n => !n.closest(MESSAGE) && rendered(n)) : [];
    }
    function classify(context) {
      const c = currentContext(context);
      if (!c) return { kind:"unknown", button:null };
      const stops = [...document.querySelectorAll('button[aria-label="'+STOP+'"]')]
        .filter(n => !n.closest(MESSAGE) && rendered(n));
      if (stops.length) return { kind:stops.length === 1 ? "stop" : "unknown",
        button:stops.length === 1 && c.root.contains(stops[0]) ? stops[0] : null };
      const staged = cards(c.root);
      if (staged.length > 1 || staged.some(n => !cardReady(n))) return { kind:"busy", button:null };
      const all = controls(c), sends = all.filter(n => n.matches('button[type="submit"][data-testid="chat-submit"][aria-label="Отправить"]'));
      if (sends.length === 1) {
        const button = sends[0], disabled = button.disabled || button.matches(":disabled") || button.getAttribute("aria-disabled") === "true";
        if (disabled) return { kind:!readComposerText(c.composer).trim() && !staged.length ? "ready" : "send_disabled", button };
        return { kind:readComposerText(c.composer).trim() || staged.length ? "send_active" : "unknown", button };
      }
      if (sends.length) return { kind:"unknown", button:null };
      const voice = all.filter(n => n.getAttribute("aria-label") === "Перейти в голосовой режим (Ctrl+⇧O)");
      return voice.length === 1 && !readComposerText(c.composer).trim() && !staged.length ?
        { kind:"ready", button:null } : { kind:"unknown", button:null };
    }
    function attachmentPreview(filename) {
      const c = composerContext();
      if (!c || !txt({ filename, byte_length:0 })) return null;
      const list = cards(c.root);
      if (list.length !== 1) return null;
      const open = [...list[0].querySelectorAll('button[aria-label="Открыть вложение"]')].filter(rendered);
      return open.length === 1 && open[0].textContent.trim() === filename ? list[0] : null;
    }
    function attachmentSurface() {
      const c = composerContext();
      if (!c || classify(c).kind !== "ready" || readComposerText(c.composer).trim() || cards(c.root).length) return null;
      const input = c.root.querySelector('input[type="file"]');
      if (!(input instanceof HTMLInputElement) || !input.isConnected || !input.classList.contains("hidden") ||
          !input.multiple || input.hasAttribute("accept") || input.disabled || input.matches(":disabled") ||
          input.files?.length || input.getAttribute("aria-disabled") === "true" ||
          input.closest('[inert],[role="dialog"],[aria-hidden="true"]') || input.parentElement?.closest("[hidden]")) return null;
      return { kind:"file_input_v1", input, root:c.root, locationHref:c.locationHref };
    }
    return Object.freeze({
      id:"grok", label:"Grok", matchesLocation, userMessages, assistantMessages, messageId, messageText,
      findCodeBlocks(node) { const role = roleNode(node,"assistant"); return role ? reader.findCodeBlocks(role) : []; },
      readCodeText:reader.readCodeText, geometryAnchor:reader.geometryAnchor,
      composerContext,
      readComposerText(composer) { return composerContext()?.composer === composer ? readComposerText(composer) : ""; },
      setComposerText(composer,value) {
        const c = composerContext();
        if (!c || c.composer !== composer || !["ready","send_active","send_disabled"].includes(classify(c).kind)) fail("COMPOSER_NOT_AVAILABLE");
        setComposerText(composer,value);
        if (!currentContext(c) || readComposerText(composer) !== String(value || "")) fail("COMPOSER_CONTEXT_CHANGED");
      },
      classifyComposerControl:classify, allComposerControls:controls,
      sendButtonCandidates(context) { const s = classify(context); return s.kind === "send_active" ? [{button:s.button,score:2000}] : []; },
      sendButton(context) { return this.sendButtonCandidates(context)[0]?.button || null; },
      sendButtonFingerprint(button) {
        const s = classify(composerContext());
        return s.button === button && button instanceof HTMLButtonElement ?
          [button.tagName,button.getAttribute("data-testid"),button.getAttribute("aria-label")].join("|") : "";
      },
      isGenerating() { return ["stop","busy","unknown"].includes(classify(composerContext()).kind); },
      messageComplete(node) { return Boolean(roleNode(node,"assistant") && messageId(node) &&
        ["ready","send_active","send_disabled"].includes(classify(composerContext()).kind) && messageText(node)); },
      deliveryCapabilities() { return globalThis.OzonAIDeliveryCapabilities?.profile?.("grok") || null; },
      attachmentSurface, attachmentPreview,
      attachFiles(surface,files) {
        const c = attachmentSurface();
        if (!c || c.input !== surface?.input || c.root !== surface?.root || c.locationHref !== surface?.locationHref || c.kind !== surface?.kind)
          fail("TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE");
        if (!Array.isArray(files) || files.length !== 1 || !(files[0] instanceof File) ||
            !txt({filename:files[0].name,byte_length:files[0].size}) || !["","text/plain"].includes(files[0].type))
          fail("TARGET_AI_FILE_TYPE_UNSUPPORTED");
        return globalThis.OzonWebFileAttachment.setInputFiles(c.input,files);
      },
      attachmentReady(descriptors) {
        return Boolean(Array.isArray(descriptors) && descriptors.length === 1 && txt(descriptors[0]) &&
          attachmentPreview(descriptors[0].filename) && cardReady(attachmentPreview(descriptors[0].filename)) &&
          ["send_active","send_disabled"].includes(classify(composerContext()).kind));
      },
      sentAttachmentMessage(node,descriptors) {
        if (!roleNode(node,"user") || !messageId(node) || !Array.isArray(descriptors) ||
            descriptors.length !== 1 || !txt(descriptors[0])) return null;
        const open = [...node.querySelectorAll('button[aria-label="Открыть вложение"]')]
          .filter(n => n.closest(MESSAGE) === node && rendered(n));
        const text = messageText(node);
        return open.length === 1 && open[0].textContent.trim() === descriptors[0].filename && text.trim() ?
          Object.freeze({text}) : null;
      }
    });
  }
  globalThis.SellerAgentsGrokAdapter = Object.freeze({create});
})();
