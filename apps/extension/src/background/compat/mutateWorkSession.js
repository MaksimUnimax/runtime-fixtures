async function mutateWorkSession(key, expectedRevision, nextState, patch = {}) {
  return withBindingWrite(async () => {
    OzonWorkSessionModel.assertStorageAvailable();
    let sessions;
    try { sessions = await getWorkSessions(); }
    catch (cause) {
      OzonWorkSessionModel.markStorageUnavailable();
      throw Object.assign(new Error("Work state could not be read"), {
        code: "WORK_STATE_COMMIT_UNCONFIRMED", stage: "read", cause,
      });
    }
    // Stale-context errors do not poison storage or unrelated dialogues.
    const next = transitionWorkSessionRecord(sessions, key, expectedRevision, nextState, patch);
    try {
      await storageSet({ [KEYS.WORK_SESSIONS]: sessions });
      const observed = await getWorkSessions();
      const canonical = globalThis.SellerAgentsBootstrapVerifier.canonicalJson;
      if (canonical(observed) !== canonical(sessions)) throw new Error("Work write readback mismatch");
    } catch (cause) {
      OzonWorkSessionModel.markStorageUnavailable();
      throw Object.assign(new Error("Work state write was not confirmed"), {
        code: "WORK_STATE_COMMIT_UNCONFIRMED", stage: "write_or_readback", cause,
      });
    }
    return next;
  });
}
