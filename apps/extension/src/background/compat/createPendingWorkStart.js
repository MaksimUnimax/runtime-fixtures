async function createPendingWorkStart(tab, identity, options = {}) {
  const pending = await getPendingWorkStarts();
  const slot = String(tab);
  const now = new Date().toISOString();
  const existing = pending[slot] || null;
  if (existing) {
    const sameSurface = existing.origin === identity.origin && existing.ai_id === identity.ai_id;
    const unexpired = String(existing.expires_at || "") > now;
    if (sameSurface && unexpired) return { duplicate: true, transaction: existing };
    delete pending[slot];
    await storageSet({ [KEYS.PENDING_WORK_STARTS]: pending });
    await diagnostic("WORK_PENDING_START_STALE_RETIRED", { tab_id: tab, intent_id: existing.intent_id || null, revision: Number(existing.revision || 0), reason: unexpired ? "surface_changed" : "expired", external_request_executed: false });
  }
  const revision = Math.max(1, Number(options.revision || 1));
  const observedConversationId = String(options.observed_conversation_id || identity.conversation_id || "").trim().toLowerCase() || null;
  const conversationKey = String(options.conversation_key || "").trim().toLowerCase() || null;
  const expectedSessionRevision = Number.isFinite(Number(options.expected_session_revision)) ? Number(options.expected_session_revision) : null;
  const transaction = {
    version: 2,
    store_context: saStarts.get(Number(tab)) || null,
    admission_provenance: options.admission_provenance || null,
    state: OzonWorkSessionModel.STATES.PENDING_IDENTITY,
    intent_id: String(options.intent_id || "").trim() || `work-start-${crypto.randomUUID()}`,
    revision,
    tab_id: tab,
    origin: identity.origin,
    ai_id: identity.ai_id,
    conversation_key: conversationKey,
    expected_session_revision: expectedSessionRevision,
    created_at: now,
    expires_at: new Date(Date.now() + 120000).toISOString(),
    prompt_delivered: false,
    observed_conversation_id: observedConversationId,
    first_response_complete: false,
    send_commit_actor_id: null,
    send_committed_at: null,
    send_outcome: "not_started",
    assistant_baseline_ids: [],
    content_runtime_generation: null
  };
  pending[slot] = transaction;
  await diagnostic("WORK_START_PENDING_CREATED", { intent_id: transaction.intent_id, revision: transaction.revision, tab_id: tab, conversation_id: observedConversationId, state_before: options.state_before || null, state_after: transaction.state, external_request_executed: false });
  await saAdmissionMutationGuard({ operation: "start", tabId: tab, conversationKey, intentId: transaction.intent_id });
  await storageSet({ [KEYS.PENDING_WORK_STARTS]: pending });
  await diagnostic("WORK_START_PENDING_PERSISTED", { intent_id: transaction.intent_id, revision: transaction.revision, tab_id: tab, conversation_id: observedConversationId, external_request_executed: false });
  const readback = (await getPendingWorkStarts())[slot] || null;
  if (!readback || readback.intent_id !== transaction.intent_id || Number(readback.revision) !== transaction.revision || readback.origin !== transaction.origin || readback.ai_id !== transaction.ai_id) {
    throw Object.assign(new Error("Pending Work Start transaction was not durably read back before Send."), { code: "WORK_START_PENDING_COMMIT_READBACK_FAILED" });
  }
  await diagnostic("WORK_START_PENDING_COMMIT_ACK", { intent_id: transaction.intent_id, revision: transaction.revision, tab_id: tab, conversation_id: observedConversationId, external_request_executed: false });
  return { duplicate: false, transaction: readback };
}
