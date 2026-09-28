import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const composition = JSON.parse(read(fixture.registryEvidence.compositionPath));

function loadFrozenDonor() {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read(coverage.authorities.wildberries.registryPath), context, {
    filename: coverage.authorities.wildberries.registryPath,
  });
  return context.WBOperations;
}

function registrySources() {
  const sources =
    composition.isolated_bundles?.[fixture.registryEvidence.bundle]
      ?.reference_sources;
  assert.ok(Array.isArray(sources), "WB effective registry composition missing");
  const donorIndex = sources.indexOf(coverage.authorities.wildberries.registryPath);
  const credentialsIndex = sources.findIndex((value) =>
    value.endsWith("/wb_credentials.js"),
  );
  assert.equal(donorIndex, 0, "frozen WB donor must remain first in bundle");
  assert.ok(credentialsIndex > donorIndex, "WB registry overlay boundary missing");
  return sources.slice(donorIndex, credentialsIndex);
}

function loadEffectiveRegistry({ analyticsOverlaySource } = {}) {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  for (const relative of registrySources()) {
    const source =
      relative === fixture.registryEvidence.analyticsOverlayPath &&
      analyticsOverlaySource !== undefined
        ? analyticsOverlaySource
        : read(relative);
    vm.runInContext(source, context, { filename: relative });
  }
  assert.ok(context.WBOperations?.OPERATIONS, "effective WB registry missing");
  return context.WBOperations;
}

function replacementRows(registry) {
  const replacement = fixture.officialSource.replacementOperation;
  return Object.entries(registry.OPERATIONS).filter(
    ([, meta]) => meta.path === replacement.path,
  );
}

function assertCurrentReplacement(registry, expectedPresent, label) {
  const pinned = fixture.registryEvidence.pinnedCandidate;
  const replacement = fixture.officialSource.replacementOperation;
  const rows = replacementRows(registry);
  if (!expectedPresent) {
    assert.equal(rows.length, 0, `${label}: replacement unexpectedly present`);
    assert.equal(
      registry.OPERATIONS[pinned.alias],
      undefined,
      `${label}: replacement alias unexpectedly present`,
    );
    return null;
  }
  if (rows.length !== 1 || !registry.OPERATIONS[pinned.alias])
    throw new Error(`${label}: current item returns authority missing`);
  const current = registry.OPERATIONS[pinned.alias];
  if (
    current !== rows[0][1] ||
    current.method !== replacement.method ||
    current.path !== replacement.path ||
    current.effect !== "READ" ||
    current.execution_enabled !== true ||
    current.current !== true ||
    JSON.stringify(Array.from(current.required_query_keys || [])) !==
      JSON.stringify(pinned.requiredQuery) ||
    JSON.stringify(Array.from(current.query_keys || [])) !==
      JSON.stringify(pinned.requiredQuery)
  )
    throw new Error(`${label}: current item returns authority drift`);
  return current;
}

const donor = loadFrozenDonor();
const effective = loadEffectiveRegistry();
const std11 = coverage.scenarios.find((row) => row.id === "STD-11");
assert.ok(std11, "STD-11 coverage row missing");
assert.equal(fixture.schemaVersion, "wb_inventory_movement_boundary_v1");
assert.equal(fixture.scope.scenarioId, "STD-11");
assert.equal(fixture.scope.liveValues, false);
assert.equal(fixture.scope.runtimeChanged, false);
assert.equal(fixture.scope.sharedRegistryChanged, false);

const deprecated = fixture.officialSource.deprecatedOperation;
const replacement = fixture.officialSource.replacementOperation;
const donorGoodsReturn = donor.OPERATIONS[deprecated.operationAlias];
const effectiveGoodsReturn = effective.OPERATIONS[deprecated.operationAlias];
for (const [label, current] of [
  ["donor", donorGoodsReturn],
  ["effective", effectiveGoodsReturn],
]) {
  assert.ok(current, `${label}: goods_return missing`);
  assert.equal(current.method, deprecated.method);
  assert.equal(current.path, deprecated.path);
  assert.equal(current.effect, "READ");
  assert.equal(current.execution_enabled, true);
  assert.equal(current.current, fixture.coverageBoundary.goodsReturnExpectedCurrent);
}
assert.equal(deprecated.disableDate, "2026-10-26");
assert.ok(deprecated.movementFields.includes("returnType"));
assert.ok(deprecated.movementFields.includes("status"));
assert.ok(replacement.movementFields.includes("returnStatus"));
assert.deepEqual(replacement.statusEnum, ["active", "archive"]);
assert.equal(replacement.limitMax, 1000);

assertCurrentReplacement(
  donor,
  fixture.registryEvidence.frozenDonorExpectedReplacementPresent,
  "frozen donor",
);
assertCurrentReplacement(
  effective,
  fixture.registryEvidence.acceptedEffectiveExpectedReplacementPresent,
  "accepted effective registry",
);

let pinnedCandidateDetected = false;
let driftNegativeRejected = false;
const overlayOverridePath = process.argv[2];
if (overlayOverridePath) {
  const overlaySource = fs.readFileSync(path.resolve(overlayOverridePath), "utf8");
  const overlaySha256 = crypto.createHash("sha256").update(overlaySource).digest("hex");
  assert.equal(
    overlaySha256,
    fixture.registryEvidence.pinnedCandidate.overlaySha256,
    "pinned C analytics overlay bytes changed",
  );
  const combined = loadEffectiveRegistry({ analyticsOverlaySource: overlaySource });
  assertCurrentReplacement(
    combined,
    fixture.registryEvidence.pinnedCandidate.replacementExpectedPresent,
    "pinned C effective registry",
  );
  assert.equal(
    donor.OPERATIONS[fixture.registryEvidence.pinnedCandidate.alias],
    undefined,
    "frozen donor must remain unchanged by effective addition",
  );
  assert.equal(
    combined.OPERATIONS[deprecated.operationAlias].current,
    fixture.coverageBoundary.goodsReturnExpectedCurrent,
    "deprecated goods_return currentness changed before its retirement boundary",
  );
  const driftedOverlay = overlaySource.replaceAll(
    replacement.path,
    `${replacement.path}-drift`,
  );
  assert.throws(
    () =>
      assertCurrentReplacement(
        loadEffectiveRegistry({ analyticsOverlaySource: driftedOverlay }),
        true,
        "drifted effective registry",
      ),
    /current item returns authority/,
    "drifted effective addition must fail current-authority validation",
  );
  driftNegativeRejected = true;
  pinnedCandidateDetected = true;
}

assert.equal(std11.wbCoverage, "BOUNDARY");
assert.ok(std11.wbOperations.includes("goods_return"));
assert.ok(std11.metrics.includes("return_movement:provider_event"));
assert.ok(std11.metrics.includes("writeoff_transfer_cause:unverified"));
assert.equal(std11.externalDependency, fixture.coverageBoundary.code);
assert.deepEqual(std11.numericFixtures, ["movement_evidence"]);
assert.equal(fixture.rules.missing, "MISSING_NOT_ZERO");
assert.match(fixture.rules.causalityBoundary, /DOES_NOT_PROVE/);

console.log(
  JSON.stringify({
    status: "PASS",
    scenario: std11.id,
    currentMovementAlias: deprecated.operationAlias,
    deprecatedDisableDate: deprecated.disableDate,
    replacementPath: replacement.path,
    donorReplacementPresent: replacementRows(donor).length === 1,
    acceptedEffectiveReplacementPresent: replacementRows(effective).length === 1,
    pinnedCandidateDetected,
    driftNegativeRejected,
    liveValues: false,
  }),
);
