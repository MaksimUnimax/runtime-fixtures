/* Content-side identity evidence only. The worker owns reservation and all permissions. */
(() => {
  "use strict";
  const PROTOCOL = 2, documentKey = crypto.randomUUID(), localMessages = new WeakMap();
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  function messageIdentity(adapter, node) {
    const id = adapter?.messageId?.(node);
    if (typeof id === "string" && id.length && id.length <= 512 && !/[\u0000-\u001f]/.test(id))
      return { kind: "provider-message", id };
    if (!node || typeof node !== "object") fail("COMMAND_MESSAGE_IDENTITY_REQUIRED");
    if (!localMessages.has(node)) localMessages.set(node, crypto.randomUUID());
    return { kind: "document-local", id: localMessages.get(node), documentKey };
  }
  async function capture({ context, adapter, binding, conversationKey }) {
    if (context?.command_protocol !== PROTOCOL) fail("COMMAND_PROTOCOL_RELOAD_REQUIRED");
    if (!context.work_session_id || !context.binding_id || !context.work_active || !binding?.root?.isConnected || !binding?.section?.isConnected)
      fail("COMMAND_CONTEXT_CHANGED");
    const messages = adapter?.assistantMessages?.() || [];
    if (!messages.includes(binding.section)) fail("COMMAND_MESSAGE_IDENTITY_REQUIRED");
    const roots = adapter.findCodeBlocks(binding.section), ordinal = roots.indexOf(binding.root);
    if (ordinal < 0) fail("COMMAND_BLOCK_IDENTITY_REQUIRED");
    return Object.freeze({ protocol: PROTOCOL, documentKey, workSessionId: context.work_session_id,
      bindingId: context.binding_id, conversationKey, messageIdentity: messageIdentity(adapter, binding.section),
      blockOrdinal: ordinal });
  }
  function baselineId(identity) { return identity.kind === "provider-message" ? identity.id : "r3-local:" + identity.id; }
  function baselineIds(adapter, messages) {
    return ["r3-document:" + documentKey, ...messages.map(node => baselineId(messageIdentity(adapter, node)))];
  }
  async function readBlock({ context, adapter, source, conversationKey }) {
    if (!source?.messageIdentity || source.bindingId !== context?.binding_id || source.workSessionId !== context?.work_session_id ||
        source.conversationKey !== conversationKey) fail("COMMAND_CONTEXT_CHANGED");
    if (source.messageIdentity.kind === "document-local" && source.documentKey !== documentKey)
      fail("COMMAND_LOCAL_IDENTITY_UNCERTAIN_START_REQUIRED");
    const matches = (adapter?.assistantMessages?.() || []).filter(node => {
      const found = messageIdentity(adapter, node), expected = source.messageIdentity;
      return found.kind === expected.kind && found.id === expected.id &&
        (found.kind !== "document-local" || found.documentKey === expected.documentKey);
    });
    if (matches.length !== 1) fail("COMMAND_MESSAGE_IDENTITY_REQUIRED");
    const section = matches[0], root = adapter.findCodeBlocks(section)[source.blockOrdinal];
    if (!root) fail("COMMAND_BLOCK_IDENTITY_REQUIRED");
    const proof = await capture({ context, adapter, binding: { root, section }, conversationKey });
    const commandText = String((adapter.readCodeTextAsync ? await adapter.readCodeTextAsync(root) : adapter.readCodeText(root)) || "");
    const afterRead = await capture({ context, adapter, binding: { root, section }, conversationKey });
    if (JSON.stringify(afterRead) !== JSON.stringify(proof)) fail("COMMAND_CONTEXT_CHANGED");
    if (!commandText || commandText.length > 524288) fail("COMMAND_BLOCK_INVALID");
    return { ok: true, command_text: commandText, command_source: proof };
  }
  globalThis.SellerAgentsCommandSource = Object.freeze({ PROTOCOL, capture, readBlock, messageIdentity, baselineId, baselineIds });
})();
