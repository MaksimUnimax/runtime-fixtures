/* Kimi DOM adapter from accepted 19 Oct observations.
 * Loading is busy, not an observed Stop. Signed-profile/delivery authority
 * remains independent; this module never clicks Send or executes code. */
(() => {
  "use strict";
  const ORIGIN = "https://www.kimi.ai";
  const ROOT = '.chat-editor[data-testid="chat-editor"]';
  const EDITOR = '.chat-input-editor[contenteditable="true"][role="textbox"]';
  const MESSAGE = ".chat-content-item";
  const USER = ".chat-content-item-user";
  const ASSISTANT = ".chat-content-item-assistant";
  const REASONING = ".thinking-container, .toolcall-content-text";
  const EXCLUDED = '[hidden], [aria-hidden="true"], [inert], [role="dialog"]';
  const MAX_TXT_BYTES = 1024 * 1024;
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  const matchesLocation = () => location.origin === ORIGIN;

  // Layout/CSS eligibility is not proof of an installed UI click or upload.
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
  function ownMessage(node, role) {
    return matchesLocation() && node instanceof HTMLElement && node.matches(MESSAGE + role) &&
      !node.matches(role === USER ? ASSISTANT : USER) && !node.parentElement?.closest(MESSAGE) &&
      !node.closest(REASONING) && !node.isContentEditable && rendered(node);
  }
  function txtName(name) {
    return typeof name === "string" && name.length > 4 && name.length <= 255 &&
      !/[\\/\u0000-\u001f]/u.test(name) && /\.txt$/i.test(name);
  }
  function create({ readComposerText, setComposerText }) {
    const reader = globalThis.SellerAgentsKimiCodeReader;
    const composerContext = () => {
      if (!matchesLocation()) return null;
      const editors = [...document.querySelectorAll(EDITOR)]
        .filter(n => rendered(n) && n.isContentEditable && !n.closest(MESSAGE) && !n.closest('[aria-disabled="true"]'));
      if (editors.length !== 1) return null;
      const composer = editors[0], root = composer.closest(ROOT);
      if (!root || !rendered(root) || root.isContentEditable || root.parentElement?.closest(ROOT) ||
          root.closest(MESSAGE) || [...root.querySelectorAll(EDITOR)].filter(rendered).length !== 1) return null;
      return { composer, root, form: composer.closest("form"), locationHref: location.href };
    };
    const currentContext = context => {
      if (!context || context.locationHref !== location.href) return null;
      const fresh = composerContext();
      return fresh && fresh.root === context.root && fresh.composer === context.composer ? fresh : null;
    };
    const cards = root => [...root.querySelectorAll('[data-testid="input-attachment-list"] .file-card-container')]
      .filter(n => n.closest(ROOT) === root && !n.closest(MESSAGE));
    const cardReady = card => rendered(card) && card.classList.contains("success") &&
      !card.matches('.loading, .error, .failed, [aria-busy="true"]') &&
      !card.querySelector('[aria-busy="true"], [role="progressbar"], .loading-pure, .send-loading');
    const classify = context => {
      const current = currentContext(context);
      if (!current) return { kind: "unknown", button: null };
      const buttons = [...current.root.querySelectorAll(".send-button-container")]
        .filter(n => n.closest(ROOT) === current.root && !n.closest(MESSAGE) && rendered(n));
      if (buttons.length !== 1) return { kind: "unknown", button: null };
      const button = buttons[0];
      if (button.classList.contains("loading") || button.querySelector(".send-loading, .loading-pure"))
        return { kind: "busy", button: null };
      const attached = cards(current.root);
      if (attached.length > 1 || attached.some(card => !cardReady(card)))
        return { kind: "unknown", button: null };
      const disabled = button.classList.contains("disabled") || button.getAttribute("aria-disabled") === "true" ||
        button.hasAttribute("disabled") || getComputedStyle(button).pointerEvents === "none";
      const hasText = Boolean(readComposerText(current.composer).trim());
      if (disabled) return { kind: !hasText && !attached.length ? "ready" : "send_disabled", button };
      return { kind: hasText || attached.length ? "send_active" : "unknown", button };
    };
    const userMessages = () => [...document.querySelectorAll(MESSAGE + USER)].filter(n => ownMessage(n, USER));
    const assistantMessages = () => reader.assistantMessages();
    const messageId = node => {
      if (!ownMessage(node, USER) && !ownMessage(node, ASSISTANT)) return "";
      const id = node.getAttribute("data-archer-id") || "";
      if (!id || id.length > 256 || /[\s|\u0000-\u001f]/u.test(id)) return "";
      const turn = node.getAttribute("data-conversation-turn-id");
      if (node.matches(USER) && turn !== null && turn !== id) return "";
      const equal = [...document.querySelectorAll(MESSAGE + "[data-archer-id]")]
        .filter(n => (ownMessage(n, USER) || ownMessage(n, ASSISTANT)) && n.getAttribute("data-archer-id") === id);
      return equal.length === 1 ? id : "";
    };
    const messageText = node => {
      const user = ownMessage(node, USER), assistant = ownMessage(node, ASSISTANT);
      if ((!user && !assistant) || node.querySelector(MESSAGE)) return "";
      if (user) return String(node.innerText || "");
      return [...node.querySelectorAll(".toolcall-rollup__flat")]
        .filter(n => n.closest(MESSAGE) === node && !n.closest(REASONING) && rendered(n) &&
          !n.isContentEditable && !n.querySelector(REASONING + ", " + MESSAGE + ", [contenteditable]"))
        .map(n => n.innerText || "").join("\n");
    };
    const attachmentSurface = () => {
      const context = composerContext();
      if (!context || readComposerText(context.composer).trim() || cards(context.root).length ||
          classify(context).kind !== "ready") return null;
      const inputs = [...context.root.querySelectorAll('input[type="file"]')]
        .filter(n => n.closest(ROOT) === context.root && !n.closest(MESSAGE));
      if (inputs.length !== 1) return null;
      const input = inputs[0];
      if (!(input instanceof HTMLInputElement) || !input.isConnected || !input.classList.contains("hidden-input") || input.disabled || !input.multiple ||
          input.getAttribute("aria-disabled") === "true" || input.closest('[inert], [role="dialog"], [aria-hidden="true"]') ||
          input.parentElement?.closest("[hidden]") || input.files?.length || input.accept !== "") return null;
      return { kind: "file_input_v1", input, root: context.root, locationHref: context.locationHref };
    };
    const attachmentPreview = filename => {
      const context = composerContext();
      if (!context || !txtName(filename)) return null;
      const found = cards(context.root);
      if (found.length !== 1 || !rendered(found[0])) return null;
      const card = found[0], names = [...card.querySelectorAll(".file-card-info-name")],
        extensions = [...card.querySelectorAll(".file-ext")];
      return names.length === 1 && extensions.length === 1 &&
        names[0].textContent === filename.slice(0, -4) && extensions[0].textContent.trim().toUpperCase() === "TXT"
        ? card : null;
    };
    const adapter = {
      id: "kimi", label: "Kimi", matchesLocation,
      userMessages, assistantMessages, messageId, messageText,
      findCodeBlocks: reader.findCodeBlocks, readCodeText: reader.readCodeText, geometryAnchor: reader.geometryAnchor,
      composerContext,
      readComposerText: composer => {
        const current = composerContext();
        return current?.composer === composer ? readComposerText(composer) : "";
      },
      setComposerText(composer, value) {
        const current = composerContext();
        if (current?.composer !== composer || !["ready", "send_active", "send_disabled"].includes(classify(current).kind)) fail("COMPOSER_NOT_AVAILABLE");
        setComposerText(composer, value);
        if (!currentContext(current) || readComposerText(composer) !== String(value || ""))
          fail("COMPOSER_CONTEXT_CHANGED");
      },
      classifyComposerControl: classify,
      allComposerControls(context) {
        const current = currentContext(context);
        return current ? [...current.root.querySelectorAll('.send-button-container, [role="button"], button')]
          .filter(n => n.closest(ROOT) === current.root && !n.closest(MESSAGE) && rendered(n)) : [];
      },
      sendButtonCandidates(context) {
        const state = classify(context);
        return state.kind === "send_active" ? [{ button: state.button, score: 2000 }] : [];
      },
      sendButton(context) { return this.sendButtonCandidates(context)[0]?.button || null; },
      sendButtonFingerprint(button) {
        const state = classify(composerContext());
        return state.button === button && button instanceof HTMLElement ?
          [button.tagName, "send-button-container", button.getAttribute("aria-label") || ""].join("|") : "";
      },
      isGenerating() { return classify(composerContext()).kind === "busy"; },
      messageComplete(message) {
        return ownMessage(message, ASSISTANT) &&
          ["ready", "send_active", "send_disabled"].includes(classify(composerContext()).kind) &&
          Boolean(messageText(message));
      },
      deliveryCapabilities() { return globalThis.OzonAIDeliveryCapabilities?.profile?.("kimi") || null; },
      attachmentSurface, attachmentPreview,
      attachFiles(surface, files) {
        const current = attachmentSurface();
        if (!current || surface?.kind !== current.kind || surface.root !== current.root ||
            surface.input !== current.input || surface.locationHref !== current.locationHref)
          fail("TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE");
        if (!Array.isArray(files) || files.length !== 1 || !(files[0] instanceof File) ||
            !txtName(files[0].name) || files[0].size > MAX_TXT_BYTES ||
            !["", "text/plain"].includes(files[0].type)) fail("TARGET_AI_FILE_TYPE_UNSUPPORTED");
        return globalThis.OzonWebFileAttachment.setInputFiles(current.input, files);
      },
      attachmentReady(descriptors) {
        if (!Array.isArray(descriptors) || descriptors.length !== 1 || !txtName(descriptors[0]?.filename) ||
            !Number.isSafeInteger(descriptors[0].byte_length) || descriptors[0].byte_length < 0 ||
            descriptors[0].byte_length > MAX_TXT_BYTES) return false;
        const preview = attachmentPreview(descriptors[0].filename);
        return Boolean(preview && cardReady(preview) &&
          ["send_active", "send_disabled"].includes(classify(composerContext()).kind));
      }
    };
    return Object.freeze(adapter);
  }
  globalThis.SellerAgentsKimiAdapter = Object.freeze({ create });
})();
