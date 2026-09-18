(() => {
  "use strict";
  const STATES = Object.freeze({
    INACTIVE: "inactive",
    PENDING_IDENTITY: "pending_identity",
    BINDING: "binding",
    ACTIVE_VISIBLE: "active_visible",
    ACTIVE_HIDDEN: "active_hidden",
    RECOVERING: "recovering",
    FINISHING: "finishing",
    ERROR: "error",
  });
  const ALLOWED = Object.freeze({
    inactive: new Set(["pending_identity", "binding", "error"]),
    pending_identity: new Set(["binding", "error", "inactive"]),
    binding: new Set(["active_visible", "error", "inactive"]),
    active_visible: new Set([
      "active_hidden",
      "recovering",
      "finishing",
      "error",
    ]),
    active_hidden: new Set([
      "active_visible",
      "recovering",
      "finishing",
      "error",
    ]),
    recovering: new Set(["active_visible", "active_hidden", "error"]),
    finishing: new Set(["inactive", "error"]),
    error: new Set([
      "inactive",
      "pending_identity",
      "binding",
      "recovering",
      "finishing",
    ]),
  });
  function normalize(record, key) {
    const state = Object.values(STATES).includes(record?.state)
      ? record.state
      : STATES.INACTIVE;
    return Object.freeze({
      version: 1,
      state,
      revision: Math.max(0, Number(record?.revision || 0)),
      conversation_key: key || record?.conversation_key || null,
      tab_id: Number(record?.tab_id || 0) || null,
      origin: record?.origin || null,
      ai_id: record?.ai_id || null,
      conversation_id: record?.conversation_id || null,
      start_intent_id: record?.start_intent_id || null,
      admission_provenance: record?.admission_provenance || null,
      updated_at: record?.updated_at || null,
      error: record?.error || null,
    });
  }
  function transition(record, next, patch = {}) {
    const current = normalize(record, record?.conversation_key || null);
    if (current.state !== next && !ALLOWED[current.state]?.has(next))
      throw Object.assign(
        new Error(
          `Illegal work-session transition ${current.state} -> ${next}`,
        ),
        { code: "WORK_SESSION_TRANSITION_REJECTED" },
      );
    return Object.freeze({
      ...current,
      ...patch,
      state: next,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
    });
  }
  globalThis.SellerAgentsWorkSessionModel = Object.freeze({
    STATES,
    normalize,
    transition,
  });
})();
