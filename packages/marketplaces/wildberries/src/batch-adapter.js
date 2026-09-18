(() => {
  "use strict";
  const A = globalThis.SellerAgentsWBAdapter;
  const changed = () => { throw globalThis.SellerAgentsExecutionContext.error(); };
  const forbiddenPlan = () => {
    throw Object.assign(new Error("WB cache/coalescing/prefetch policy is not enabled"), { code: "WB_UNREVIEWED_PLAN" });
  };
  function create({ records, quota, finalize, diagnostic, workerId, provider = A.createProvider() }) {
    if (!records?.get || !records?.mutate || !quota?.prepare || !quota?.observe ||
      typeof finalize !== "function" || typeof diagnostic !== "function" || !workerId)
      throw new TypeError("WB application record, quota, finalization and diagnostic ports are required");
    const flights = new Map();
    async function admit({ source, context }) {
      await context.assertCurrent();
      const { snapshot } = context;
      if (snapshot.marketplace !== "wildberries" || await A.hash(String(source)) !== snapshot.commandHash) changed();
      let entries;
      try { entries = A.discover(source); }
      catch (error) { entries = [{ kind: "pre_execution_error", status: "pending", error: { code: error.code } }]; }
      return records.mutate(snapshot.conversationKey, async (old) => {
        await context.assertCurrent();
        if (old?.operation_id === snapshot.requestId) {
          if (old.execution_context?.commandHash !== snapshot.commandHash) changed();
          return old; // Completed, dispatched and unknown requests are never readmitted.
        }
        if (old?.status === "collecting") throw Object.assign(new Error("Another batch owns this dialogue"), { code: "BATCH_BUSY" });
        return { operation_id: snapshot.requestId, conversation_key: snapshot.conversationKey,
          execution_context: snapshot, status: "collecting", batch: { entries,
            next_index: 0, request_state: "idle", request_worker_session_id: null } };
      });
    }
    async function process({ context }) {
      const { snapshot } = context, key = snapshot.conversationKey;
      if (snapshot.marketplace !== "wildberries") changed();
      const ownerMatches = (owner) => owner?.operation_id === snapshot.requestId &&
        globalThis.SellerAgentsExecutionContext.fields.every((field) => owner.execution_context?.[field] === snapshot[field]);
      const isCollecting = (owner) => owner?.status === "collecting";
      const options = {
        conversationKey: key, ownerKind: "wildberries", ownerId: snapshot.requestId,
        getOwner: () => records.get(key), mutateOwner: (fn) => records.mutate(key, fn), ownerMatches, isCollecting,
        failOwner: (code) => records.mutate(key, (owner) => ownerMatches(owner) ?
          { ...owner, status: "failed", last_error: { code } } : owner),
        async finalizeOwner(owner, entries) {
          await context.assertCurrent();
          const saved = await records.mutate(key, async (current) => {
            await context.assertCurrent();
            return ownerMatches(current) && isCollecting(current) ? { ...current, status: "ready" } : current;
          });
          if (!ownerMatches(saved) || saved.status !== "ready") changed();
          await context.assertCurrent();
          // Application delivery consumes the existing local reports, without refetching.
          return finalize(saved, entries, context);
        },
      };
      const ports = createPorts(context, { quota, diagnostic, workerId, provider, flights });
      return globalThis.SellerAgentsGuardedBatchQueue.run(options, { context, ports });
    }
    return Object.freeze({ admit, process });
  }
  function createPorts(context, { quota, diagnostic, workerId, provider = A.createProvider(), flights = new Map() }) {
    const { snapshot } = context;
  const scope = async (command) => A.hash(JSON.stringify(["wildberries", snapshot.accountId,
        snapshot.credentialRevision, A.operation(command).host]));
      const ports = {
        normalizeKey: (key) => key, workerId, flights,
        singleFlight: globalThis.SellerAgentsLocalOperations.singleFlight,
        async preparePolicy(o) {
          await o.mutateOwner((owner) => {
            if (!o.ownerMatches(owner) || !o.isCollecting(owner)) return owner;
            const entries = owner.batch.entries.map((entry) => {
              if (entry.kind !== "command" || entry.status !== "pending") return entry;
              try { A.assertPolicy(entry.command, context); return entry; }
              catch (error) { return { ...entry, kind: "pre_execution_error", error: { code: error.code } }; }
            });
            return { ...owner, batch: { ...owner.batch, entries } };
          });
          return { ok: true };
        },
        async prepareCapability() { return { ok: true, source: "PINNED_REGISTRY_ONLY_NO_ACCOUNT_PROBE" }; },
        async prepareQueries(o) {
          const owner = await o.getOwner();
          if (owner.batch.entries.some((entry) => entry.query_group_id || entry.execution_command || entry.planning)) forbiddenPlan();
          return { ok: true, source: "EXPLICIT_COMMANDS_ONLY" };
        },
        diagnostic,
        // WB keeps its accepted last-moment C3G fence inside guardedFetch.
        // The queue still commits intent before entering this provider boundary.
        beforeProviderDispatch: async () => {},
        guidanceResult: A.localResult,
        policyErrorResult: () => A.localError({ code: "PERSONAL_DATA_DISABLED" }),
        planningErrorResult: forbiddenPlan, findGroup: forbiddenPlan, projectGroup: forbiddenPlan,
        groupError: forbiddenPlan, groupPlanning: forbiddenPlan, cachedResult: forbiddenPlan,
        async readCache() { return { hit: false, reason: "WB_CACHE_POLICY_NOT_ENABLED" }; },
        storeCache: forbiddenPlan, projectSingle: forbiddenPlan,
        reviewedAcquisitionProfile: () => null, acquisitionPlanning: () => null,
        coalescedOperation: null, providerId: "wildberries", bridgeErrorCode: "WB_BRIDGE_ERROR",
        executionError: (command, fingerprint, error) => A.localError(error, command?.operation, error?.external_request_executed === true),
        prepareQuota: async (command) => quota.prepare(await scope(command)),
        quotaMetadata: (value) => value,
        async persistQuotaWait(o) {
          await o.mutateOwner((owner) => o.ownerMatches(owner) && o.isCollecting(owner) ?
            { ...owner, batch: { ...owner.batch, request_state: "quota_waiting", quota_wait: o.quota } } : owner);
        },
        async execute(text, { executionCommand, onProviderResponse }) {
          const result = await provider.execute(text, { context, executionCommand, onProviderResponse });
          await context.assertCurrent();
          try { await quota.observe(await scope(executionCommand), result.response_meta?.retry_after); }
          catch (error) {
            // Commit the received result first; then stop before any further dispatch.
            result.stop_after_result = "QUOTA_OBSERVATION_FAILED_NO_RETRY";
          }
          return result;
        },
      };
    return ports;
  }
  globalThis.SellerAgentsWBBatch = Object.freeze({ create, createPorts });
})();
