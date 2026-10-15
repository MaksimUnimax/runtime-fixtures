/* Fixed, bounded reader for the code node displayed by Qwen's Monaco view.
 * Runs in MAIN only for a browser-authenticated extension content sender.
 * No application store, auth state, network, clipboard, or arbitrary JS access. */
function saQwenCodeInPage(expectedHref, messageId, blockOrdinal) {
  const unavailable = () => ({ ok: false, code: "QWEN_COMPLETE_CODE_UNAVAILABLE" });
  const own = (object, key) => {
    if (!object || (typeof object !== "object" && typeof object !== "function")) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  };
  try {
    if (location.origin !== "https://chat.qwen.ai" || location.href !== expectedHref) return unavailable();
    const selector = ".qwen-chat-message";
    const idFor = node => {
      const ids = [...new Set([node, ...node.querySelectorAll("[data-msg-id]")]
        .filter(value => value.closest(selector) === node)
        .map(value => value.getAttribute("data-msg-id")).filter(Boolean))];
      return ids.length === 1 ? ids[0] : null;
    };
    const messages = [...document.querySelectorAll(selector + ".qwen-chat-message-assistant")]
      .filter(node => node.isConnected && idFor(node) === messageId);
    if (messages.length !== 1) return unavailable();
    const section = messages[0];
    const blocks = [...section.querySelectorAll("pre.qwen-markdown-code")]
      .filter(node => node.closest(selector) === section);
    const block = blocks[blockOrdinal];
    if (!block?.isConnected) return unavailable();
    const keys = Object.getOwnPropertyNames(block).filter(key => key.startsWith("__reactFiber$"));
    if (keys.length !== 1) return unavailable();
    // Exactly the observed immediate Markdown code component; no ancestor search.
    const component = own(own(block, keys[0]), "return");
    const markdownCode = own(own(component, "memoizedProps"), "token");
    const value = own(markdownCode, "text");
    if (own(markdownCode, "type") !== "code" || typeof value !== "string" || !value.length || value.length > 524288)
      return unavailable();
    return { ok: true, text: value };
  } catch (_) { return unavailable(); }
}
async function saReadQwenCode(message, sender) {
  const invalid = () => ({ ok: false, code: "QWEN_CODE_SENDER_INVALID" });
  if (sender?.id !== chrome.runtime.id || sender?.frameId !== 0 || !Number.isInteger(sender?.tab?.id) ||
      typeof sender.documentId !== "string" || !sender.documentId.length) return invalid();
  let senderUrl;
  try { senderUrl = new URL(sender.url); } catch (_) { return invalid(); }
  if (senderUrl.origin !== "https://chat.qwen.ai" ||
      typeof message.messageId !== "string" || !message.messageId.length || message.messageId.length > 512 ||
      /[\u0000-\u001f]/.test(message.messageId) || !Number.isInteger(message.blockOrdinal) ||
      message.blockOrdinal < 0 || message.blockOrdinal > 127) return invalid();
  const before = await saBrowserPage(sender.tab.id);
  if (before.origin !== senderUrl.origin || before.aiFamily !== "qwen") return invalid();
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
      world: "MAIN", func: saQwenCodeInPage,
      args: [before.url, message.messageId, message.blockOrdinal]
    });
  } catch (_) { return { ok: false, code: "QWEN_COMPLETE_CODE_UNAVAILABLE" }; }
  if ((await saBrowserPage(sender.tab.id)).url !== before.url || results?.length !== 1 ||
      results[0].documentId !== sender.documentId || results[0].frameId !== 0)
    return { ok: false, code: "QWEN_CODE_CONTEXT_CHANGED" };
  const result = results[0].result;
  return result?.ok === true && typeof result.text === "string" && result.text.length > 0 && result.text.length <= 524288 ?
    { ok: true, text: result.text } : { ok: false, code: "QWEN_COMPLETE_CODE_UNAVAILABLE" };
}
