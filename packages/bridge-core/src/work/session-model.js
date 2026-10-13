(() => {
  "use strict";
  let storageUnavailable = false;
  function assertStorageAvailable() {
    if (storageUnavailable) throw Object.assign(new Error("Work storage remains unconfirmed"), { code: "WORK_STATE_COMMIT_UNCONFIRMED" });
  }
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
    const normalized = {
      version: 1,
      state,
      revision: Math.max(0, Number(record?.revision || 0)),
      conversation_key: key || record?.conversation_key || null,
      tab_id: Number(record?.tab_id || 0) || null,
      origin: record?.origin || null,
      ai_id: record?.ai_id || null,
      conversation_id: record?.conversation_id || null,
      start_intent_id: record?.start_intent_id || null,
      // An absent legacy terminal marker is not proof of resumable work.
      work_session_id: record?.work_session_id || record?.start_intent_id || null,
      work_generation: Number.isSafeInteger(record?.work_generation) && record.work_generation >= 0
        ? record.work_generation : 0,
      terminal_state_known: record?.terminal_state_known === true,
      finished: record?.finished === true,
      finished_at: record?.finished_at || null,
      updated_at: record?.updated_at || null,
      error: record?.error || null,
    };
    if (Object.prototype.hasOwnProperty.call(record || {}, "admission_provenance"))
      normalized.admission_provenance = record.admission_provenance || null;
    if (Object.prototype.hasOwnProperty.call(record || {}, "prompt_tree"))
      normalized.prompt_tree = record.prompt_tree ? JSON.parse(JSON.stringify(record.prompt_tree)) : null;
    return Object.freeze(normalized);
  }
  function transition(record, next, patch = {}) {
    assertStorageAvailable();
    const current = normalize(record, record?.conversation_key || null);
    if (current.state !== next && !ALLOWED[current.state]?.has(next))
      throw Object.assign(
        new Error(
          `Illegal work-session transition ${current.state} -> ${next}`,
        ),
        { code: "WORK_SESSION_TRANSITION_REJECTED" },
      );
    const newStart = next === STATES.BINDING &&
      typeof patch.start_intent_id === "string" && patch.start_intent_id.length > 0 &&
      patch.start_intent_id !== current.work_session_id;
    if (current.finished && !newStart && ![STATES.INACTIVE, STATES.FINISHING, STATES.ERROR].includes(next))
      throw Object.assign(new Error("Finished work requires a new explicit Start"), { code: "WORK_SESSION_FINISHED" });
    const finishing = next === STATES.FINISHING && !current.finished;
    const generation = current.work_generation + (newStart || finishing ? 1 : 0);
    if (!Number.isSafeInteger(generation))
      throw Object.assign(new Error("Work generation exhausted"), { code: "WORK_GENERATION_EXHAUSTED" });
    return Object.freeze({
      ...current,
      ...patch,
      ...(finishing || newStart ||
          Object.prototype.hasOwnProperty.call(current, "prompt_tree") ||
          Object.prototype.hasOwnProperty.call(patch, "prompt_tree")
        ? { prompt_tree: finishing ? null :
            Object.prototype.hasOwnProperty.call(patch, "prompt_tree")
              ? (patch.prompt_tree ? JSON.parse(JSON.stringify(patch.prompt_tree)) : null)
              : newStart ? null : current.prompt_tree }
        : {}),
      work_session_id: newStart ? patch.start_intent_id : current.work_session_id,
      work_generation: generation,
      terminal_state_known: newStart || finishing || current.terminal_state_known,
      finished: newStart ? false : finishing || current.finished,
      finished_at: newStart ? null : finishing ? new Date().toISOString() : current.finished_at,
      // Resume may refresh the binding but cannot manufacture a new Work identity.
      start_intent_id: newStart ? patch.start_intent_id :
        next === STATES.FINISHING || next === STATES.INACTIVE ? (patch.start_intent_id ?? current.start_intent_id) : current.start_intent_id,
      state: next,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
    });
  }
  globalThis.SellerAgentsWorkSessionModel = Object.freeze({
    STATES,
    normalize,
    transition,
    assertStorageAvailable,
    markStorageUnavailable() { storageUnavailable = true; },
    canResume(record) {
      const work = normalize(record, record?.conversation_key);
      return !storageUnavailable && work.state === STATES.INACTIVE && work.terminal_state_known && !work.finished && Boolean(work.work_session_id);
    },
  });
})();
