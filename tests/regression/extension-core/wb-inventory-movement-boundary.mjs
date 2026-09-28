import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const fixture = JSON.parse(
  read("tests/regression/extension-core/fixtures/wb-inventory-movement-boundary-v1.json"),
);
const coverage = JSON.parse(
  read("tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json"),
);

function loadGlobal(relative, name) {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read(relative), context, { filename: relative });
  return context[name];
}

const wb = loadGlobal(
  coverage.authorities.wildberries.registryPath,
  "WBOperations",
);
const std11 = coverage.scenarios.find((row) => row.id === "STD-11");
assert.ok(std11, "STD-11 coverage row missing");
assert.equal(fixture.schemaVersion, "wb_inventory_movement_boundary_v1");
assert.equal(fixture.scope.scenarioId, "STD-11");
assert.equal(fixture.scope.liveValues, false);
assert.equal(fixture.scope.runtimeChanged, false);
assert.equal(fixture.scope.sharedRegistryChanged, false);

const deprecated = fixture.officialSource.deprecatedOperation;
const replacement = fixture.officialSource.replacementOperation;
const current = wb.OPERATIONS[deprecated.operationAlias];
assert.ok(current, "goods_return missing from accepted WB registry");
assert.equal(current.method, deprecated.method);
assert.equal(current.path, deprecated.path);
assert.equal(current.effect, "READ");
assert.equal(current.execution_enabled, true);
assert.equal(current.current, fixture.registryGap.goodsReturnExpectedCurrent);
assert.equal(deprecated.disableDate, "2026-10-26");
assert.ok(deprecated.movementFields.includes("returnType"));
assert.ok(deprecated.movementFields.includes("status"));
assert.ok(replacement.movementFields.includes("returnStatus"));
assert.deepEqual(replacement.statusEnum, ["active", "archive"]);
assert.equal(replacement.limitMax, 1000);

const replacementPresent = Object.values(wb.OPERATIONS).some(
  (meta) => meta.path === replacement.path,
);
assert.equal(
  replacementPresent,
  fixture.registryGap.replacementExpectedPresent,
  "item-returns registry state changed; re-review STD-11 authority handoff",
);

assert.equal(std11.wbCoverage, "BOUNDARY");
assert.ok(std11.wbOperations.includes("goods_return"));
assert.ok(std11.metrics.includes("goods_return_movement:provider_event"));
assert.ok(std11.metrics.includes("writeoff_transfer_cause:unverified"));
assert.equal(std11.externalDependency, fixture.registryGap.code);
assert.deepEqual(std11.numericFixtures, ["movement_evidence"]);
assert.equal(fixture.rules.missing, "MISSING_NOT_ZERO");
assert.match(fixture.rules.causalityBoundary, /DOES_NOT_PROVE/);

console.log(JSON.stringify({
  status: "PASS",
  scenario: std11.id,
  currentMovementAlias: deprecated.operationAlias,
  deprecatedDisableDate: deprecated.disableDate,
  replacementPath: replacement.path,
  replacementPresent,
  liveValues: false,
}));
