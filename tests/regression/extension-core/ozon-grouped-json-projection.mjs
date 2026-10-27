import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || ".");
const imported = path.join(root, "apps/extension/src/imported/ozon-v0.1.22/shared/ozon_contract.js");
const sourceMode = fs.existsSync(imported);
let source = fs.readFileSync(sourceMode ? imported : path.join(root, "shared/ozon_contract.js"), "utf8");
if (sourceMode) {
  const patches = JSON.parse(fs.readFileSync(path.join(root, "apps/extension/application-patches.json"), "utf8"));
  for (const patch of patches.filter(row => row.target === "shared/ozon_contract.js")) {
    assert.equal(source.split(patch.old).length - 1, 1, "one exact OzonContract patch preimage");
    source = source.replace(patch.old, patch.new);
  }
}
const context = { console, TextEncoder, structuredClone, Date, JSON, Object, Number, String, Boolean, Array, WeakSet, Set, Map };
context.globalThis = context;
vm.runInNewContext(source, context);
const ozon = context.OzonContract;
assert.equal(typeof ozon?.projectAnalyticsDataResult, "function");

// This covers the projection boundary itself. Buffer recovery is a separate
// consumer (PR360); it is deliberately not replaced with a fixture here.
for (const ownValue of [{ marker: "KEEP" }, "KEEP_PRIMITIVE", null]) {
  const input = JSON.parse(JSON.stringify({
    ordinary: "OUTER_OK",
    result: { ordinary: "RESULT_OK", data: [{ metrics: [5], ordinary: "ROW_OK" }], totals: [5] },
  }));
  for (const target of [input, input.result, input.result.data[0]]) {
    Object.defineProperty(target, "__proto__", {
      value: ownValue, enumerable: true, writable: true, configurable: true,
    });
  }
  const persistedInput = JSON.parse(JSON.stringify(input));
  const projected = ozon.projectAnalyticsDataResult(persistedInput, ["revenue"], ["revenue"]);
  assert.deepEqual(Array.from(projected.result.data[0].metrics), [5]);
  assert.equal(projected.ordinary, "OUTER_OK");
  assert.equal(projected.result.ordinary, "RESULT_OK");
  assert.equal(projected.result.data[0].ordinary, "ROW_OK");
  for (const target of [projected, projected.result, projected.result.data[0]]) {
    assert.equal(Object.hasOwn(target, "__proto__"), true, "own JSON data field survives projection");
    assert.equal(JSON.stringify(target["__proto__"]), JSON.stringify(ownValue));
    assert.equal(Object.getPrototypeOf(target).marker, undefined, "data cannot alter the prototype");
  }
  const serialized = JSON.parse(JSON.stringify(projected));
  for (const target of [serialized, serialized.result, serialized.result.data[0]]) {
    assert.equal(Object.hasOwn(target, "__proto__"), true, "own JSON field survives persistence");
    assert.equal(JSON.stringify(target["__proto__"]), JSON.stringify(ownValue));
  }
}

const commands = context.OzonContractFactory.createOzonContract({
  operations: { synthetic_read: {
    method: "POST", path: "/synthetic-no-network", provider: "seller_api",
    effect: "READ", execution_enabled: false,
  } },
});
assert.throws(
  () => commands.normalizeCommand(JSON.parse('{"operation":"synthetic_read","params":{"__proto__":{"fixture_only":"DO_NOT_SEND"}}}')),
  error => error?.code === "TRANSPORT_INJECTION_REJECTED",
  "preserving result fields must not admit prototype keys in command parameters",
);
console.log(JSON.stringify({
  status: "PASS", cases: 4, level: sourceMode ? "SOURCE" : "COMPOSED_RUNTIME",
  scope: "Ozon grouped JSON projection and command transport rejection",
  buffer_recovery_acceptance: false, installed_acceptance: false, live_provider_calls: 0,
}));
