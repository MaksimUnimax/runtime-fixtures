/* Qwen guest/authorized DOM share an adapter, never an AI account identity.
 * The complete Markdown code is read only on an explicit command/review action.
 * Monaco's visible lines are deliberately not an executable-code fallback. */
(() => {
  "use strict";
  const MESSAGE = ".qwen-chat-message";
  const ASSISTANT = MESSAGE + ".qwen-chat-message-assistant";
  const USER = MESSAGE + ".qwen-chat-message-user";
  const CODE = "pre.qwen-markdown-code";
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  function create({ visible, readComposerText, setComposerText }) {
    const messageId = node => {
      if (!(node instanceof Element) || !node.matches(MESSAGE)) return "";
      const ids = [...new Set([node, ...node.querySelectorAll("[data-msg-id]")]
        .filter(value => value.closest(MESSAGE) === node)
        .map(value => value.getAttribute("data-msg-id")).filter(Boolean))];
      return ids.length === 1 ? ids[0] : "";
    };
    const codeBlocks = message => message instanceof Element ?
      [...message.querySelectorAll(CODE)].filter(node => node.closest(MESSAGE) === message) : [];
    const composerContext = () => {
      const composers = [...document.querySelectorAll("textarea.message-input-textarea")].filter(visible);
      if (composers.length !== 1) return null;
      const composer = composers[0], root = composer.closest(".message-input-container");
      return root && visible(root) ? { composer, root } : null;
    };
    const classify = context => {
      if (!context?.root?.isConnected || !context.composer?.isConnected) return { kind: "unknown", button: null };
      // Qwen keeps distinct structural controls when accessible labels are localized.
      // A visible Stop always excludes sending; ambiguous controls stay closed.
      const stops = [...context.root.querySelectorAll('.chat-prompt-send-button > button.stop-button, button[aria-label="Stop"]')].filter(visible);
      if (stops.length) return { kind: stops.length === 1 ? "stop" : "unknown", button: stops.length === 1 ? stops[0] : null };
      const buttons = [...context.root.querySelectorAll('.chat-prompt-send-button > button.send-button, button[aria-label="Send"]')].filter(visible);
      if (buttons.length !== 1) return { kind: "unknown", button: null };
      const button = buttons[0], disabled = button.disabled || button.getAttribute("aria-disabled") === "true";
      return { kind: disabled ? (readComposerText(context.composer).trim() ? "send_disabled" : "ready") : "send_active", button };
    };
    const attachmentCards = root => [...root.querySelectorAll(".file-card-list .fileitem-btn")];
    const attachmentSurface = () => {
      const context = composerContext();
      if (!context?.root?.isConnected || !context.composer?.isConnected || readComposerText(context.composer).trim() || attachmentCards(context.root).length) return null;
      const inputs = [...context.root.querySelectorAll('input[type="file"]')];
      if (inputs.length !== 1) return null;
      const input = inputs[0];
      if (!(input instanceof HTMLInputElement) || !input.isConnected || input.disabled || input.files?.length) return null;
      return { kind: "file_input_v1", input, root: context.root };
    };
    const attachmentPreview = filename => {
      const context = composerContext();
      if (!context?.root?.isConnected || !context.composer?.isConnected || typeof filename !== "string" || !filename) return null;
      const cards = attachmentCards(context.root);
      if (cards.length !== 1) return null;
      const card = cards[0], names = [...card.querySelectorAll(".fileitem-file-name")];
      return card.isConnected && visible(card) && names.length === 1 && names[0].textContent === filename ? card : null;
    };
    const adapter = {
      id: "qwen", label: "Qwen",
      matchesLocation: () => location.origin === "https://chat.qwen.ai",
      assistantMessages: () => [...document.querySelectorAll(ASSISTANT)],
      userMessages: () => [...document.querySelectorAll(USER)],
      messageId,
      messageText(node) {
        if (!(node instanceof Element)) return "";
        const body = node.matches(USER) ? node.querySelector(".chat-user-message-container[data-msg-id]") : node;
        return String(body?.innerText || body?.textContent || "");
      },
      findCodeBlocks: codeBlocks,
      readCodeText() { return ""; },
      async readCodeTextAsync(block) {
        const section = block?.closest?.(ASSISTANT), id = messageId(section), ordinal = codeBlocks(section).indexOf(block);
        if (!block?.isConnected || !section?.isConnected || !id || ordinal < 0) fail("QWEN_CODE_IDENTITY_REQUIRED");
        const response = await chrome.runtime.sendMessage({ type: "OZ_QWEN_READ_CODE", messageId: id, blockOrdinal: ordinal });
        if (!block.isConnected || !section.isConnected || messageId(section) !== id || codeBlocks(section)[ordinal] !== block)
          fail("QWEN_CODE_CONTEXT_CHANGED");
        if (!response?.ok || typeof response.text !== "string" || !response.text.length || response.text.length > 524288)
          fail("QWEN_COMPLETE_CODE_UNAVAILABLE");
        return response.text;
      },
      geometryAnchor: block => block?.isConnected ? block : null,
      composerContext, readComposerText, setComposerText,
      classifyComposerControl: classify,
      sendButtonCandidates(context) { const state = classify(context); return state.kind === "send_active" ? [{ button: state.button, score: 2000 }] : []; },
      sendButton(context) { const state = classify(context); return state.kind === "send_active" ? state.button : null; },
      sendButtonFingerprint(button) {
        return button instanceof HTMLElement ? [button.tagName, button.getAttribute("aria-label") || "", button.getAttribute("type") || ""].join("|") : "";
      },
      isGenerating() { return classify(composerContext()).kind === "stop"; },
      messageComplete(message) { return Boolean(message?.isConnected && !this.isGenerating() && this.messageText(message)); },
      deliveryCapabilities() { return globalThis.OzonAIDeliveryCapabilities?.profile?.("qwen") || null; },
      attachmentSurface,
      attachFiles(surface, files) {
        const current = attachmentSurface();
        if (!current || surface?.kind !== current.kind || surface.root !== current.root || surface.input !== current.input)
          fail("TARGET_AI_ATTACHMENT_SURFACE_UNAVAILABLE");
        if (!Array.isArray(files) || files.length !== 1 || !/\.txt$/i.test(String(files[0]?.name || "")))
          fail("TARGET_AI_FILE_TYPE_UNSUPPORTED");
        return globalThis.OzonWebFileAttachment.setInputFiles(current.input, files);
      },
      attachmentPreview,
      attachmentReady(descriptors) {
        if (!Array.isArray(descriptors) || descriptors.length !== 1 || !/\.txt$/i.test(String(descriptors[0]?.filename || ""))) return false;
        const preview = attachmentPreview(descriptors[0].filename);
        if (!preview || preview.matches('[aria-busy="true"]') || preview.querySelector('[aria-busy="true"]')) return false;
        // The observed finished TXT icon replaces the upload spinner. A card/name alone is not readiness.
        const icons = [...preview.querySelectorAll(".fileitem-icon-wrapper .fileitem-icon use")];
        return icons.length === 1 && (icons[0].getAttribute("href") || icons[0].getAttribute("xlink:href")) === "#qwenFileicon-txt1";
      }
    };
    return Object.freeze(adapter);
  }
  globalThis.SellerAgentsQwenAdapter = Object.freeze({ create });
})();
