(() => {
  "use strict";
  const fields = Object.freeze([
    "accountId",
    "storeId",
    "marketplace",
    "credentialRevision",
    "conversationKey",
    "bindingId",
    "bindingRevision",
    "workSessionId",
    "policyRevision",
    "commandHash",
    "requestId",
  ]);
  const authorityFields = Object.freeze(["scopeKey", "principalEpoch", "accessEpoch", "grantEpoch", "workGeneration", "aiFamily"]);
  function error(code = "EXECUTION_CONTEXT_CHANGED") {
    return Object.assign(
      new Error(
        "Контекст запущенного пакета изменился. Остаток остановлен; выберите магазин и явно запустите новую команду.",
      ),
      { code, execution_context_error: true, external_request_executed: false },
    );
  }
  function snapshot(input) {
    const output = {};
    for (const field of fields) {
      const value = input?.[field];
      if (
        !["string", "number"].includes(typeof value) ||
        !String(value).length ||
        (typeof value === "number" && !Number.isFinite(value))
      )
        throw error("EXECUTION_CONTEXT_MISSING");
      output[field] = value;
    }
    if (input?.authGeneration !== undefined) {
      if (!Number.isSafeInteger(input.authGeneration) || input.authGeneration < 0)
        throw error("EXECUTION_CONTEXT_MISSING");
      output.authGeneration = input.authGeneration;
    }
    if (authorityFields.some(field => input?.[field] !== undefined)) {
      for (const field of authorityFields) {
        const value = input[field];
        if (["scopeKey", "aiFamily"].includes(field) ? typeof value !== "string" || !value : !Number.isSafeInteger(value) || value < 0)
          throw error("EXECUTION_CONTEXT_MISSING");
        output[field] = value;
      }
    }
    return Object.freeze(output);
  }
  function assertSame(expected, live) {
    if (live?.active !== true || fields.some((field) => expected[field] !== live[field]) ||
        (expected.authGeneration !== undefined && expected.authGeneration !== live.authGeneration) ||
        authorityFields.some(field => expected[field] !== undefined && expected[field] !== live[field]))
      throw error();
  }
  function createGuard(expected, readCurrent) {
    const pinned = snapshot(expected);
    if (typeof readCurrent !== "function")
      throw error("EXECUTION_CONTEXT_READER_MISSING");
    async function assertCurrent() {
      const current = await readCurrent();
      assertSame(pinned, current);
      return current;
    }
    return Object.freeze({ snapshot: pinned, assertCurrent });
  }
  globalThis.SellerAgentsExecutionContext = Object.freeze({
    snapshot,
    assertSame,
    createGuard,
    error,
    fields,
    authorityFields,
  });
})();
