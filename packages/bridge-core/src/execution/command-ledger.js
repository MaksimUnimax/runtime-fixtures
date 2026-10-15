/* Hash-only Work receipts. Uses the existing MANUAL_OPERATIONS writer. */
(() => {
  "use strict";
  const RETRY_WARNING = "Предыдущий запрос мог выполниться. Новый запуск может повторить действие и расход квоты";
  const MAX_MARKERS = 2000, BUFFER_TTL_MS = 3600000;
  const err = code => Object.assign(new Error(code), { code });
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const nonempty = value => typeof value === "string" && value.length > 0;
  function createCommandLedger({ store, canonicalJson, sha256, makeId = () => crypto.randomUUID(),
    now = () => Date.now(), assertContext, classifyReadOnly, readBuffer }) {
    if (!store?.mutate || !store?.get || [canonicalJson, sha256, assertContext, classifyReadOnly, readBuffer].some(fn => typeof fn !== "function"))
      throw err("COMMAND_LEDGER_PORTS_REQUIRED");
    const unknown = receipt => receipt.items.some(item => ["PROVIDER_INTENT", "UNKNOWN"].includes(item.state));
    async function check(context) {
      // This port may read context, never mutate authority or perform provider/DOM effects.
      if (!object(context) || await assertContext(context) !== true) throw err("EXECUTION_CONTEXT_CHANGED");
    }
    function ledger(current) {
      if (current?.r3_commands === undefined) return { schema: 2, origins: {}, receipts: {}, approvals: {}, deliveries: {} };
      const value = current.r3_commands;
      if (!object(value) || value.schema !== 2 || !["origins", "receipts", "approvals", "deliveries"].every(k => object(value[k])))
        throw err("COMMAND_HISTORY_UNKNOWN");
      return clone(value);
    }
    function capacity(data) {
      if (Object.keys(data.receipts).length + Object.keys(data.deliveries).length + Object.keys(data.approvals).length >= MAX_MARKERS)
        throw err("WORK_MARKER_CAPACITY_START_REQUIRED");
    }
    function compactCompletedWork(data, context) {
      // Only a new Work may retire completed history. Uncertain effects and their
      // ancestry remain durable fences, even when their payloads have expired.
      if (!nonempty(context.accountId) || !nonempty(context.workSessionId)) return;
      const removable = new Set(Object.entries(data.receipts).filter(([, receipt]) =>
        receipt.context?.accountId === context.accountId &&
        nonempty(receipt.context.workSessionId) && receipt.context.workSessionId !== context.workSessionId &&
        Array.isArray(receipt.items) && receipt.items.length > 0 && receipt.items.every(item => item.state === "RESULT")
      ).map(([id]) => id));
      const sameContext = (left, right) => object(left) && object(right) && canonicalJson(left) === canonicalJson(right);
      function confirmedDelivery(id, delivery) {
        const receipt = data.receipts[delivery?.executionId];
        return Boolean(receipt && delivery.state === "CONFIRMED" && delivery.deliveryId === id &&
          sameContext(delivery.context, receipt.context) && delivery.expiresAt === receipt.payloadExpiresAt &&
          nonempty(delivery.bufferDigest) && (receipt.deliveryBufferDigest === delivery.bufferDigest ||
            receipt.items.some(item => item.state === "RESULT" && item.bufferDigest === delivery.bufferDigest)));
      }
      function completedCopy(id, approval) {
        const delivery = data.deliveries[approval.consumedBy];
        const receipt = data.receipts[approval.executionId];
        return Boolean(approval.kind === "COPY" && approval.confirmationId === id && delivery && receipt &&
          confirmedDelivery(approval.consumedBy, delivery) && delivery.executionId === approval.executionId &&
          delivery.confirmationId === id && sameContext(approval.context, receipt.context) &&
          approval.bufferDigest === delivery.bufferDigest && approval.expiresAt === delivery.expiresAt &&
          Number.isSafeInteger(approval.deliveryRevision) && delivery.deliveryRevision === approval.deliveryRevision + 1);
      }
      for (const [id, delivery] of Object.entries(data.deliveries)) {
        const approval = data.approvals[delivery.confirmationId];
        if (!confirmedDelivery(id, delivery) || (delivery.original !== true &&
            (!approval || !completedCopy(delivery.confirmationId, approval)))) removable.delete(delivery.executionId);
      }
      // Resolve all receipt/approval dependencies together to a fixed point.
      // A retained uncertain effect protects every linked execution, regardless
      // of insertion order or the number of explicit retry generations.
      let changed;
      do {
        changed = false;
        for (const [id, receipt] of Object.entries(data.receipts)) {
          if (!removable.has(id) && removable.delete(receipt.predecessor)) changed = true;
        }
        for (const [id, approval] of Object.entries(data.approvals)) {
          if (approval.kind === "COPY") {
            // COPY consumes a deliveryId, while RETRY consumes an executionId.
            // A missing, uncertain or mismatched delivery remains a durable fence.
            if (!removable.has(approval.executionId) || (approval.consumedBy && !completedCopy(id, approval)))
              if (removable.delete(approval.executionId)) changed = true;
          } else if (approval.kind === "RETRY") {
            if (!removable.has(approval.predecessor) || (approval.consumedBy && !removable.has(approval.consumedBy))) {
              if (removable.delete(approval.predecessor)) changed = true;
              if (removable.delete(approval.consumedBy)) changed = true;
            }
          } else {
            for (const target of [approval.executionId, approval.predecessor, approval.consumedBy])
              if (removable.delete(target)) changed = true;
          }
        }
      } while (changed);
      for (const [id, approval] of Object.entries(data.approvals)) {
        if (approval.kind === "COPY" && removable.has(approval.executionId) &&
            (!approval.consumedBy || completedCopy(id, approval))) delete data.approvals[id];
        else if (approval.kind === "RETRY" && removable.has(approval.predecessor) &&
            (!approval.consumedBy || removable.has(approval.consumedBy))) delete data.approvals[id];
      }
      for (const [id, delivery] of Object.entries(data.deliveries)) {
        if (delivery.state === "CONFIRMED" && removable.has(delivery.executionId)) delete data.deliveries[id];
      }
      for (const id of removable) delete data.receipts[id];
      const origins = new Set([...Object.values(data.receipts), ...Object.values(data.approvals)]
        .map(record => record.blockOriginKey));
      for (const id of Object.keys(data.origins)) if (!origins.has(id)) delete data.origins[id];
    }
    async function mutate(conversationKey, context, fn) {
      await check(context);
      let result;
      await store.mutate(conversationKey, async current => {
        await check(context);
        const data = ledger(current);
        compactCompletedWork(data, context);
        result = fn(data);
        if (result?.then) throw err("COMMAND_WRITER_ASYNC_EFFECT_FORBIDDEN");
        return { ...(current || {}), r3_commands: data };
      });
      await check(context);
      return clone(result);
    }
    function receiptFor(data, id, context) {
      const receipt = data.receipts[id];
      if (!receipt || canonicalJson(receipt.context) !== canonicalJson(context)) throw err("COMMAND_CONTEXT_MISMATCH");
      return receipt;
    }
    function predecessorFor(data, id, context) {
      const receipt = data.receipts[id];
      // A new explicit approval uses current authority. It cannot change the original Work or binding.
      const stable = ["accountId", "principalEpoch", "conversationKey", "bindingId", "bindingRevision",
        "workSessionId", "workGeneration", "storeId", "marketplace", "aiFamily"];
      if (!receipt || stable.some(key => receipt.context[key] !== context[key])) throw err("COMMAND_CONTEXT_MISMATCH");
      return receipt;
    }
    function normalizeSelection(items) {
      if (!Array.isArray(items) || !items.length) throw err("RETRY_SELECTION_REQUIRED");
      const seen = new Set();
      return items.map(item => {
        if (!Number.isSafeInteger(item?.ordinal) || item.ordinal < 0 || seen.has(item.ordinal) || !nonempty(item.inputHash))
          throw err("RETRY_SELECTION_INVALID");
        seen.add(item.ordinal);
        if (classifyReadOnly(item) !== true) throw err("RETRY_READ_ONLY_REQUIRED");
        return { ordinal: item.ordinal, inputHash: item.inputHash };
      }).sort((a, b) => a.ordinal - b.ordinal);
    }
    async function blockKeys(input) {
      const { accountId, conversationBindingId, workSessionId, messageIdentity, blockOrdinal, blockText } = input || {};
      if (![accountId, conversationBindingId, workSessionId].every(nonempty) || !object(messageIdentity) ||
          !["provider-message", "document-local"].includes(messageIdentity.kind) || !nonempty(messageIdentity.id) ||
          (messageIdentity.kind === "document-local" && !nonempty(messageIdentity.documentKey)) ||
          !Number.isSafeInteger(blockOrdinal) || blockOrdinal < 0 || typeof blockText !== "string")
        throw err("BLOCK_IDENTITY_REQUIRED");
      const identity = { kind: messageIdentity.kind, id: messageIdentity.id };
      if (identity.kind === "document-local") identity.documentKey = messageIdentity.documentKey;
      const blockOriginKey = await sha256(canonicalJson({ version: 1, accountId, conversationBindingId, workSessionId,
        messageIdentity: identity, blockOrdinal }));
      return { blockOriginKey, blockVersion: await sha256(blockText),
        messageAnchorKey: await sha256(canonicalJson({ version: 1, accountId, conversationBindingId, workSessionId, messageIdentity: identity })) };

    }
    async function reserveCommand({ conversationKey, context, blockOriginKey, blockVersion, items, source = null }) {
      if (![conversationKey, blockOriginKey, blockVersion].every(nonempty) || !Array.isArray(items) || !items.length)
        throw err("COMMAND_INPUT_INVALID");
      const ordinals = new Set();
      const captured = items.map(item => {
        if (!Number.isSafeInteger(item.ordinal) || item.ordinal < 0 || ordinals.has(item.ordinal) || !nonempty(item.inputHash))
          throw err("COMMAND_INPUT_INVALID");
        ordinals.add(item.ordinal);
        return { ordinal: item.ordinal, inputHash: item.inputHash, state: "RESERVED", providerAttemptId: null };
      });
      const commandKey = await sha256(canonicalJson({ blockOriginKey, blockVersion, approvalRevision: 0 }));
      return mutate(conversationKey, context, data => {
        const existing = Object.values(data.receipts).find(r => r.commandKey === commandKey);
        if (existing) return { executionId: existing.executionId, dispatch: false, duplicate: true, unknown: unknown(existing), payloadExpiresAt: existing.payloadExpiresAt };
        const origin = data.origins[blockOriginKey];
        if (source) {
          if (!object(source) || !nonempty(source.messageAnchorKey) || !nonempty(source.documentKey) ||
              !["provider-message", "document-local"].includes(source.messageKind)) throw err("BLOCK_IDENTITY_REQUIRED");
          const sameWork = Object.values(data.receipts).filter(r => r.context?.workSessionId === context.workSessionId);
          if (sameWork.some(r => r.source?.messageKind === "document-local" &&
              (r.source.documentKey !== source.documentKey || unknown(r))))
            throw err("COMMAND_LOCAL_IDENTITY_UNCERTAIN_START_REQUIRED");
          if (sameWork.some(r => r.source?.messageAnchorKey === source.messageAnchorKey && unknown(r)))
            throw err("COMMAND_OUTCOME_UNKNOWN_EXPLICIT_RETRY_REQUIRED");
        }
        if (origin && Object.values(data.receipts).some(r => r.blockOriginKey === blockOriginKey && unknown(r)))
          throw err("COMMAND_OUTCOME_UNKNOWN_EXPLICIT_RETRY_REQUIRED");
        capacity(data);
        const executionId = makeId();
        data.origins[blockOriginKey] = origin || { approvalRevision: 0 };
        data.receipts[executionId] = { executionId, commandKey, blockOriginKey, blockVersion, approvalRevision: 0,
          context: clone(context), items: captured.map(item => ({ ...item, itemId: commandKey + ":" + item.ordinal })),
          createdAt: now(), payloadExpiresAt: now() + BUFFER_TTL_MS, predecessor: null,
          ...(source ? { source: clone(source) } : {}) };
        return { executionId, dispatch: false, duplicate: false, payloadExpiresAt: data.receipts[executionId].payloadExpiresAt };
      });
    }
    async function beginProviderAttempt({ conversationKey, context, executionId, ordinal }) {
      return mutate(conversationKey, context, data => {
        const receipt = receiptFor(data, executionId, context), item = receipt.items.find(i => i.ordinal === ordinal);
        if (!item) throw err("COMMAND_ITEM_MISSING");
        if (item.state !== "RESERVED") return { dispatch: false, state: item.state, providerAttemptId: item.providerAttemptId };
        if (now() >= receipt.payloadExpiresAt) throw err("COMMAND_EXPIRED");
        item.state = "PROVIDER_INTENT"; item.providerAttemptId = makeId(); item.intentAt = now();
        return { dispatch: true, providerAttemptId: item.providerAttemptId, itemId: item.itemId };
      });
    }
    async function recordProviderOutcome({ conversationKey, context, executionId, ordinal, providerAttemptId, outcome, bufferDigest = null }) {
      return mutate(conversationKey, context, data => {
        const receipt = receiptFor(data, executionId, context), item = receipt.items.find(i => i.ordinal === ordinal);
        if (!item || item.providerAttemptId !== providerAttemptId || item.state !== "PROVIDER_INTENT")
          throw err("PROVIDER_OUTCOME_OBSOLETE");
        if (!["RESULT", "UNKNOWN", "PROVEN_NOT_DISPATCHED"].includes(outcome)) throw err("PROVIDER_OUTCOME_INVALID");
        if (outcome === "RESULT" && !nonempty(bufferDigest)) throw err("RESULT_DIGEST_REQUIRED");
        // A transport timeout cannot be recorded as proof of absence by this API.
        if (outcome === "PROVEN_NOT_DISPATCHED") throw err("PROVIDER_ABSENCE_REQUIRES_SEPARATE_PROOF");
        item.state = outcome; item.bufferDigest = bufferDigest;
        return { recorded: true, state: outcome };
      });
    }
    async function previewRetry({ conversationKey, context, executionId, blockVersion, selection, parserContract, credentialRevision }) {
      const selected = normalizeSelection(selection);
      if (![blockVersion, parserContract].every(nonempty) || !nonempty(credentialRevision)) throw err("RETRY_PREVIEW_INVALID");
      return mutate(conversationKey, context, data => {
        const old = predecessorFor(data, executionId, context);
        if (!unknown(old)) throw err("RETRY_UNKNOWN_REQUIRED");
        for (const item of selected) {
          const original = old.items.find(i => i.ordinal === item.ordinal);
          if (!original || (blockVersion === old.blockVersion && original.inputHash !== item.inputHash))
            throw err("RETRY_SELECTION_CHANGED");
        }
        capacity(data);
        const confirmationId = makeId(), approvalRevision = data.origins[old.blockOriginKey].approvalRevision;
        data.approvals[confirmationId] = { kind: "RETRY", confirmationId, predecessor: executionId,
          blockOriginKey: old.blockOriginKey, blockVersion, approvalRevision, selection: selected,
          parserContract, credentialRevision, context: clone(context), expiresAt: now() + BUFFER_TTL_MS,
          consumedBy: null };
        return { confirmationId, warning: RETRY_WARNING, approvalRevision, selection: selected, requiresSeparateConfirmation: true };
      });
    }
    async function confirmRetry({ conversationKey, context, confirmationId, confirmed, selection, blockVersion, parserContract, credentialRevision }) {
      if (confirmed !== true) throw err("RETRY_EXPLICIT_CONFIRMATION_REQUIRED");
      const selected = normalizeSelection(selection);
      // The command hash is computed before entering the single writer, then checked against its immutable preview.
      const current = await store.get(conversationKey), preview = ledger(current).approvals[confirmationId];
      if (!preview || preview.kind !== "RETRY") throw err("RETRY_PREVIEW_MISSING");
      const commandKey = await sha256(canonicalJson({ blockOriginKey: preview.blockOriginKey,
        blockVersion: preview.blockVersion, approvalRevision: preview.approvalRevision + 1 }));
      return mutate(conversationKey, context, data => {
        const approval = data.approvals[confirmationId];
        if (!approval || approval.kind !== "RETRY" || canonicalJson(approval.context) !== canonicalJson(context)) throw err("RETRY_PREVIEW_MISSING");
        if (canonicalJson(selected) !== canonicalJson(approval.selection) || blockVersion !== approval.blockVersion ||
            parserContract !== approval.parserContract || credentialRevision !== approval.credentialRevision) throw err("RETRY_PREVIEW_CHANGED");
        if (approval.consumedBy) return { executionId: approval.consumedBy, duplicate: true, dispatch: false };
        if (now() >= approval.expiresAt) throw err("RETRY_CONFIRMATION_EXPIRED");
        const origin = data.origins[approval.blockOriginKey];
        if (origin.approvalRevision !== approval.approvalRevision) throw err("RETRY_APPROVAL_STALE");
        predecessorFor(data, approval.predecessor, context);
        capacity(data);
        const executionId = makeId();
        origin.approvalRevision++;
        approval.consumedBy = executionId;
        data.receipts[executionId] = { executionId, commandKey, blockOriginKey: approval.blockOriginKey,
          blockVersion: approval.blockVersion, approvalRevision: origin.approvalRevision, predecessor: approval.predecessor,
          context: clone(context), createdAt: now(), payloadExpiresAt: now() + BUFFER_TTL_MS,
          ...(data.receipts[approval.predecessor]?.source ? { source: clone(data.receipts[approval.predecessor].source) } : {}),
          items: selected.map(item => ({ ...item, itemId: commandKey + ":" + item.ordinal, state: "RESERVED", providerAttemptId: null })) };
        return { executionId, commandKey, payloadExpiresAt: data.receipts[executionId].payloadExpiresAt, duplicate: false, dispatch: false, predecessor: approval.predecessor, approvalRevision: origin.approvalRevision };
      });
    }
    async function recordDeliveryBuffer({ conversationKey, context, executionId, bufferDigest, expiresAt, previousDelivery = null }) {
      if (!nonempty(bufferDigest)) throw err("RESULT_DIGEST_REQUIRED");
      const buffer = await verifiedBuffer(executionId, context);
      if (buffer.digest !== bufferDigest || buffer.expiresAt !== expiresAt) throw err("COPY_BUFFER_MISMATCH");
      return mutate(conversationKey, context, data => {
        const receipt = receiptFor(data, executionId, context);
        if (expiresAt !== receipt.payloadExpiresAt || now() >= expiresAt)
          throw err("COPY_BUFFER_MISMATCH");
        if (previousDelivery) {
          if (!nonempty(previousDelivery.deliveryId) || !["CONFIRMED", "UNKNOWN"].includes(previousDelivery.state))
            throw err("COPY_PREVIOUS_DELIVERY_REQUIRED");
          if (!data.deliveries[previousDelivery.deliveryId]) {
            capacity(data);
            data.deliveries[previousDelivery.deliveryId] = { ...clone(previousDelivery), executionId,
              bufferDigest, expiresAt, context: clone(context), original: true };
          }
        }
        receipt.deliveryBufferDigest = bufferDigest;
        return { recorded: true };
      });
    }
    async function verifiedBuffer(executionId, context) {
      await check(context);
      const buffer = await readBuffer(executionId, context);
      if (!buffer || !nonempty(buffer.digest) || typeof buffer.payload !== "string" ||
          !Number.isFinite(buffer.expiresAt) || now() >= buffer.expiresAt ||
          canonicalJson(buffer.context) !== canonicalJson(context) || await sha256(buffer.payload) !== buffer.digest)
        throw err("COPY_BUFFER_UNAVAILABLE");
      await check(context);
      return buffer;
    }
    async function previewCopy({ conversationKey, context, executionId }) {
      const buffer = await verifiedBuffer(executionId, context);
      return mutate(conversationKey, context, data => {
        const receipt = receiptFor(data, executionId, context);
        if (buffer.expiresAt !== receipt.payloadExpiresAt || !(receipt.deliveryBufferDigest === buffer.digest || receipt.items.some(i => i.state === "RESULT" && i.bufferDigest === buffer.digest)))
          throw err("COPY_BUFFER_MISMATCH");
        capacity(data);
        const confirmationId = makeId(), deliveryRevision = receipt.deliveryRevision || 0;
        data.approvals[confirmationId] = { kind: "COPY", confirmationId, executionId, deliveryRevision,
          bufferDigest: buffer.digest, expiresAt: buffer.expiresAt, context: clone(context), consumedBy: null };
        return { confirmationId, deliveryRevision, bufferDigest: buffer.digest, expiresAt: buffer.expiresAt,
          requiresSeparateConfirmation: true };
      });
    }
    async function confirmCopy({ conversationKey, context, confirmationId, confirmed }) {
      if (confirmed !== true) throw err("COPY_EXPLICIT_CONFIRMATION_REQUIRED");
      const preview = ledger(await store.get(conversationKey)).approvals[confirmationId];
      if (!preview || preview.kind !== "COPY") throw err("COPY_PREVIEW_MISSING");
      const buffer = await verifiedBuffer(preview.executionId, context);
      return mutate(conversationKey, context, data => {
        const approval = data.approvals[confirmationId];
        if (!approval || approval.kind !== "COPY" || canonicalJson(approval.context) !== canonicalJson(context)) throw err("COPY_PREVIEW_MISSING");
        const receipt = receiptFor(data, approval.executionId, context);
        if (now() >= approval.expiresAt || buffer.digest !== approval.bufferDigest || buffer.expiresAt !== approval.expiresAt)
          throw err("COPY_BUFFER_UNAVAILABLE");
        if (approval.consumedBy) return { deliveryId: approval.consumedBy, duplicate: true, send: false };
        if ((receipt.deliveryRevision || 0) !== approval.deliveryRevision) throw err("COPY_CONFIRMATION_STALE");
        capacity(data);
        const deliveryId = makeId();
        receipt.deliveryRevision = approval.deliveryRevision + 1; approval.consumedBy = deliveryId;
        data.deliveries[deliveryId] = { deliveryId, executionId: receipt.executionId, state: "COPY_RESERVED",
          confirmationId, bufferDigest: buffer.digest, expiresAt: buffer.expiresAt,
          context: clone(context), deliveryRevision: receipt.deliveryRevision };
        return { deliveryId, duplicate: false, send: false };
      });
    }
    async function beginCopyDelivery({ conversationKey, context, deliveryId }) {
      const pending = ledger(await store.get(conversationKey)).deliveries[deliveryId];
      if (!pending) throw err("COPY_DELIVERY_MISSING");
      const buffer = await verifiedBuffer(pending.executionId, context);
      return mutate(conversationKey, context, data => {
        const delivery = data.deliveries[deliveryId];
        if (!delivery || canonicalJson(delivery.context) !== canonicalJson(context)) throw err("COPY_DELIVERY_MISSING");
        if (now() >= delivery.expiresAt || buffer.digest !== delivery.bufferDigest || buffer.expiresAt !== delivery.expiresAt)
          throw err("COPY_BUFFER_UNAVAILABLE");
        if (delivery.state !== "COPY_RESERVED") return { send: false, state: delivery.state };
        delivery.state = "DELIVERY_INTENT"; delivery.intentAt = now();
        return { send: true, deliveryId, bufferDigest: delivery.bufferDigest, expiresAt: delivery.expiresAt };
      });
    }
    async function recordCopyOutcome({ conversationKey, context, deliveryId, outcome }) {
      if (!["CONFIRMED", "UNKNOWN"].includes(outcome)) throw err("COPY_OUTCOME_INVALID");
      return mutate(conversationKey, context, data => {
        const delivery = data.deliveries[deliveryId];
        if (!delivery || canonicalJson(delivery.context) !== canonicalJson(context) || delivery.state !== "DELIVERY_INTENT")
          throw err("COPY_OUTCOME_OBSOLETE");
        delivery.state = outcome;
        return { recorded: true, state: outcome };
      });
    }
    return Object.freeze({ blockKeys, reserveCommand, beginProviderAttempt, recordProviderOutcome, recordDeliveryBuffer,
      previewRetry, confirmRetry, previewCopy, confirmCopy, beginCopyDelivery, recordCopyOutcome });
  }
  globalThis.SellerAgentsCommandLedger = Object.freeze({ createCommandLedger, RETRY_WARNING, MAX_MARKERS });
})();
