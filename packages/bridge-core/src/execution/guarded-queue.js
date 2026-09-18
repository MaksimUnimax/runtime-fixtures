(() => {
  "use strict";
  // The same async fences surround every marketplace's queue ports. The application
  // owns the durable record; the core never reads browser settings or credentials.
  async function run(options, { context, ports }) {
    const original = options;
    const check = async () => { if (context) await context.assertCurrent(); };
    const guarded = (fn) => async (...args) => {
      await check();
      const result = await fn(...args);
      await check();
      return result;
    };
    try {
      await check();
      const guardedPorts = { ...ports };
      for (const name of ["preparePolicy", "prepareCapability", "prepareQueries", "diagnostic",
        "readCache", "prepareQuota", "persistQuotaWait", "beforeProviderDispatch", "execute", "storeCache"])
        if (typeof ports[name] === "function") guardedPorts[name] = guarded(ports[name]);
      return await globalThis.SellerAgentsBatchQueue.create(guardedPorts).process({
        ...options,
        getOwner: guarded(options.getOwner),
        mutateOwner: (fn) => original.mutateOwner(async (current) => {
          await check();
          return fn(current);
        }),
        finalizeOwner: guarded(options.finalizeOwner),
      });
    } catch (error) {
      if (!error?.execution_context_error) throw error;
      const current = await original.getOwner();
      if (original.ownerMatches(current) && original.isCollecting(current))
        await original.failOwner(error.code, error.message);
      return { ok: false, code: error.code };
    }
  }
  globalThis.SellerAgentsGuardedBatchQueue = Object.freeze({ run });
})();
