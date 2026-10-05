/* Compatibility facade: origin authority stays packaged; identity logic is shared. */
(() => {
  "use strict";
  const core = globalThis.SellerAgentsConversationIdentity;
  const PROVIDERS = Object.freeze({
    "https://chatgpt.com": "chatgpt",
    "https://chat.openai.com": "chatgpt",
    "https://alice.yandex.ru": "alice"
  });
  function providerForOrigin(origin) { return PROVIDERS[core.originOf(origin)] || null; }
  function conversationIdFromPath(pathname) {
    const ids = core.locator(pathname, "https://identity.invalid")?.ids || [];
    return ids.length === 1 ? ids[0] : null;
  }
  function canonicalConversationId(origin, canonicalHref) {
    const ids = core.locator(canonicalHref, origin)?.ids || [];
    return ids.length === 1 ? ids[0] : null;
  }
  function resolveWithEvidence(input = {}) {
    return core.resolveEvidence({ ...input, provider: providerForOrigin(input.origin),
      explicitIds: input.explicitIds || (input.activeConversationId ? [input.activeConversationId] : []),
      requiresExplicitId: providerForOrigin(input.origin) === "alice" });
  }
  // URL-only callers receive UNKNOWN. Live consumers must provide an observed
  // conversation surface; extracting an ID is not an authorization proof.
  function resolve(input) { return resolveWithEvidence(input); }
  globalThis.BB2ConversationIdentity = Object.freeze({
    providerForOrigin, conversationIdFromPath, canonicalConversationId,
    resolve, resolveWithEvidence, isLocal: core.isLocal
  });
})();
