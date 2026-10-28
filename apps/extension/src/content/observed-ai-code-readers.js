/* S04-S06 code DOM observed 19 Oct 2026: DeepSeek, Claude, Gemini, Grok.
 * Read-only readers; no composer, Copy click, Send, completion, chat-ID
 * authority or provider activation. Message/parent nodes are local witnesses.
 * DeepSeek/Claude snapshots did not supply persistent message IDs. */
(() => {
  "use strict";
  const EXCLUDED = '[hidden], [aria-hidden="true"], [inert], [contenteditable="true"], [role="dialog"]';
  function rendered(node) {
    if (!(node instanceof HTMLElement) || !node.isConnected ||
        node.isContentEditable || node.closest(EXCLUDED)) return false;
    const rect = node.getBoundingClientRect();
    if (!node.getClientRects().length || rect.width <= 0 || rect.height <= 0) return false;
    for (let p = node; p instanceof Element; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse" ||
          s.contentVisibility === "hidden" || Number(s.opacity) === 0) return false;
    }
    return true;
  }
  function editableDescendant(node) {
    return [...node.querySelectorAll("[contenteditable]")].some(n => n.isContentEditable);
  }
  const SPECS = Object.freeze({
    deepseek: {
      origin: "https://chat.deepseek.com",
      message: ".ds-markdown.ds-assistant-message-main-content",
      block: ".md-code-block > pre",
      context(message) {
        const parent = message.parentElement;
        return parent?.matches(".ds-message") && !parent.parentElement?.closest(".ds-message") &&
          parent.querySelectorAll(this.message).length === 1
          ? { parent, witness: "" } : null;
      },
      content(block, message) {
        return block.parentElement?.matches(".md-code-block") &&
          block.parentElement.parentElement === message ? block : null;
      }
    },
    claude: {
      origin: "https://claude.ai",
      message: '[data-testid="assistant-message"]',
      block: "pre.code-block__code",
      context(message) {
        const roles = '[data-testid="assistant-message"], [data-testid="user-message"]';
        if (message.parentElement?.closest(roles) || message.querySelector(roles)) return null;
        const article = message.closest('[role="article"]');
        return article && article.querySelectorAll(roles).length === 1
          ? { parent: article, witness: article.getAttribute("aria-label") || "" } : null;
      },
      content(block, message) {
        const group = block.closest('[role="group"]');
        const codes = [...block.querySelectorAll(":scope > code")];
        return group && message.contains(group) && group.querySelectorAll("pre.code-block__code").length === 1 &&
          codes.length === 1 && block.querySelectorAll("code").length === 1 ? codes[0] : null;
      }
    },
    grok: {
      origin: "https://grok.com",
      message: 'div[data-testid="assistant-message"][role="article"]',
      block: '.response-content-markdown [data-testid="code-block"] pre.shiki',
      context(message) {
        const roles = '[data-testid="assistant-message"], [data-testid="user-message"]';
        const parent = message.parentElement;
        return parent?.matches('div[id^="response-"]') && parent.id.length > 9 &&
          !message.parentElement?.closest(roles) && !message.querySelector(roles) &&
          parent.querySelectorAll(roles).length === 1
          ? { parent, witness: parent.id + "|" + (message.getAttribute("aria-labelledby") || "") } : null;
      },
      content(block, message) {
        const owner = block.closest('[data-testid="code-block"]');
        const codes = [...block.querySelectorAll(":scope > code")];
        return owner && owner.closest(this.message) === message &&
          owner.querySelectorAll("pre.shiki").length === 1 &&
          codes.length === 1 && block.querySelectorAll("code").length === 1 ? codes[0] : null;
      }
    },
    gemini: {
      origin: "https://gemini.google.com",
      message: "model-response",
      block: 'response-container pre > code[data-test-id="code-content"]',
      context(message) {
        const parent = message.parentElement;
        if (!parent?.matches(".conversation-container[id]") || !parent.id ||
            message.closest("user-query") || message.parentElement?.closest("model-response") ||
            message.querySelector("model-response, user-query") ||
            parent.querySelectorAll("model-response").length !== 1) return null;
        return { parent, witness: parent.id };
      },
      content(code, message) {
        const pre = code.parentElement, response = code.closest("response-container");
        return pre?.matches("pre") && pre.querySelectorAll("code").length === 1 &&
          response && response.closest("model-response") === message ? code : null;
      }
    }
  });
  function createReader(spec) {
    const captures = new WeakMap();
    const matchesLocation = () => globalThis.location?.origin === spec.origin;
    function context(message) {
      if (!matchesLocation() || !(message instanceof Element) || !message.matches(spec.message) ||
          !rendered(message)) return null;
      return spec.context(message);
    }
    function blockContext(block, message) {
      const owner = context(message);
      if (!owner || !(block instanceof Element) || !block.matches(spec.block) ||
          block.closest(spec.message) !== message || !rendered(block) || editableDescendant(block)) return null;
      const content = spec.content(block, message);
      if (!content || content.isContentEditable || editableDescendant(content)) return null;
      return { message, content, parent: owner.parent, witness: owner.witness };
    }
    function assistantMessages() {
      return matchesLocation() ? [...document.querySelectorAll(spec.message)].filter(m => context(m)) : [];
    }
    function findCodeBlocks(message) {
      if (!context(message)) return [];
      return [...message.querySelectorAll(spec.block)].filter(block => {
        const c = blockContext(block, message);
        if (!c) return false;
        captures.set(block, { ...c, href: location.href });
        return true;
      });
    }
    function current(block) {
      const old = block instanceof Element ? captures.get(block) : null;
      if (!old || old.href !== location.href) return null;
      const c = blockContext(block, old.message);
      return c && c.content === old.content && c.parent === old.parent && c.witness === old.witness ? c : null;
    }
    return Object.freeze({
      matchesLocation, assistantMessages, findCodeBlocks,
      readCodeText(block) { const c = current(block); return c ? String(c.content.textContent || "") : ""; },
      geometryAnchor(block) { return current(block) ? block : null; }
    });
  }
  const readers = Object.freeze(Object.fromEntries(
    Object.entries(SPECS).map(([id, spec]) => [id, createReader(spec)])
  ));
  globalThis.SellerAgentsObservedAICodeReaders = Object.freeze({
    readers,
    forLocation() { return Object.values(readers).find(r => r.matchesLocation()) || null; }
  });
})();
