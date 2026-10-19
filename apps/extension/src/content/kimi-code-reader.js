/* Observed Kimi final-code DOM, 19 Oct 2026.
 * Read-only component: no Start/Send, clipboard action, completion inference,
 * identity authority or provider activation. IDs are context-change witnesses.
 * Frozen donor and signed-profile gates stay independent of this reader. */
(() => {
  "use strict";
  const MESSAGE = ".chat-content-item";
  const ASSISTANT = ".chat-content-item.chat-content-item-assistant";
  const USER = ".chat-content-item-user";
  const REASONING = ".thinking-container, .toolcall-content-text";
  const EXCLUDED = '[hidden], [aria-hidden="true"], [inert], [contenteditable="true"], [role="dialog"]';
  const captures = new WeakMap();
  const matchesLocation = () => globalThis.location?.origin === "https://www.kimi.ai";

  function rendered(node) {
    if (!(node instanceof HTMLElement) || !node.isConnected || node.isContentEditable || node.closest(EXCLUDED)) return false;
    const rect = node.getBoundingClientRect();
    if (!node.getClientRects().length || rect.width <= 0 || rect.height <= 0) return false;
    for (let parent = node; parent instanceof Element; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden" ||
          style.visibility === "collapse" || style.contentVisibility === "hidden" ||
          Number(style.opacity) === 0) return false;
    }
    return true;
  }

  function eligibleMessage(message) {
    return matchesLocation() && message instanceof Element &&
      message.matches(ASSISTANT) && !message.closest(USER) &&
      !message.parentElement?.closest(MESSAGE) && !message.closest(REASONING) &&
      rendered(message);
  }

  function blockContext(block, message) {
    if (!eligibleMessage(message) || !(block instanceof Element) ||
        !block.matches("pre") || block.closest(MESSAGE) !== message ||
        block.closest(REASONING) || !rendered(block)) return null;
    const content = block.parentElement;
    const segment = block.closest(".segment-code");
    const markdown = block.closest(".markdown-container");
    const final = markdown?.closest(".toolcall-rollup__flat");
    if (!content?.matches(".segment-code-content") || !segment ||
        !markdown?.contains(segment) || !final || !message.contains(final) ||
        final.closest(MESSAGE) !== message) return null;
    const codes = [...block.querySelectorAll(":scope > code")];
    if (codes.length !== 1 || block.querySelectorAll("code").length !== 1 ||
        codes[0].isContentEditable ||
        [...codes[0].querySelectorAll("[contenteditable]")].some(node => node.isContentEditable) ||
        codes[0].querySelector(MESSAGE + ", " + REASONING)) return null;
    return { message, code: codes[0] };
  }

  function assistantMessages() {
    if (!matchesLocation()) return [];
    return [...document.querySelectorAll(ASSISTANT)].filter(eligibleMessage);
  }

  function findCodeBlocks(message) {
    if (!eligibleMessage(message)) return [];
    const blocks = [];
    for (const block of message.querySelectorAll(".segment-code-content > pre")) {
      const context = blockContext(block, message);
      if (!context) continue;
      captures.set(block, {
        ...context,
        href: location.href,
        observedMessageId: message.getAttribute("data-archer-id")
      });
      blocks.push(block);
    }
    return blocks;
  }

  function currentCapture(block) {
    const captured = block instanceof Element ? captures.get(block) : null;
    if (!captured || !matchesLocation() || location.href !== captured.href ||
        captured.message.getAttribute("data-archer-id") !== captured.observedMessageId) return null;
    const current = blockContext(block, captured.message);
    return current?.code === captured.code ? current : null;
  }

  function readCodeText(block) {
    const current = currentCapture(block);
    return current ? String(current.code.textContent || "") : "";
  }

  function geometryAnchor(block) {
    return currentCapture(block) ? block : null;
  }

  globalThis.SellerAgentsKimiCodeReader = Object.freeze({
    assistantMessages, findCodeBlocks, readCodeText, geometryAnchor
  });
})();
