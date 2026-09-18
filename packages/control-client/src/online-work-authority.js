/* Compatibility surface backed by the single autonomous evaluator. */
(() => {
  "use strict";
  const core = globalThis.SellerAgentsAutonomousWorkAuthority;
  if (!core) throw new Error("AUTONOMOUS_WORK_AUTHORITY_MISSING");
  Object.defineProperty(globalThis, "SellerAgentsOnlineWorkAuthority", {
    value: Object.freeze({ evaluate: input => core.evaluate(input, { requireHealth: input?.health !== undefined }) }),
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();
