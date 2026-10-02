import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

function parseTsv(relative) {
  const lines = read(relative).trimEnd().split("\n");
  const headers = lines.shift().split("\t");
  return lines.map((line) =>
    Object.fromEntries(
      line.split("\t").map((value, index) => [headers[index], value]),
    ),
  );
}

const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const numeric = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-numeric-fixtures-v1.json",
  ),
);
const protocol = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-gold-protocol-v1.json",
  ),
);

assert.equal(protocol.schemaVersion, "business_scenario_gold_protocol_v1");
assert.equal(coverage.schemaVersion, protocol.sourceCoverageSchema);
assert.equal(numeric.schemaVersion, protocol.sourceNumericSchema);
assert.deepEqual(protocol.marketplaces, ["OZON", "WILDBERRIES"]);
assert.deepEqual(protocol.checkLayers, [
  "provider_fact",
  "deterministic_arithmetic",
  "owner_semantic_verdict",
]);

const readiness = parseTsv(coverage.readiness.path);
const readinessIds = readiness.map((row) => row.ID);
const scenarioIds = coverage.scenarios.map((row) => row.id);
assert.equal(scenarioIds.length, protocol.expectedScenarioCount);
assert.deepEqual(
  scenarioIds,
  readinessIds,
  "protocol must use canonical scenario order",
);
assert.equal(
  new Set(scenarioIds).size,
  scenarioIds.length,
  "duplicate scenario ID",
);

const numericCases = new Map(numeric.cases.map((row) => [row.id, row]));
const numericKinds = new Map();
for (const row of numeric.cases) {
  const rows = numericKinds.get(row.kind) ?? [];
  rows.push(row.id);
  numericKinds.set(row.kind, rows);
}
for (const rows of numericKinds.values()) rows.sort();

function numericCaseDefinitions(binding) {
  if (binding.mode === "OWNER_ONLY_BOUNDARY") return [];
  const caseIds =
    binding.mode === "EXECUTABLE_CASE" ? [binding.caseId] : binding.caseIds;
  return caseIds.map((caseId) => {
    const row = numericCases.get(caseId);
    assert.ok(row, caseId + ": referenced numeric case missing");
    return row;
  });
}

const referencedLabels = new Set(
  coverage.scenarios.flatMap((row) => row.numericFixtures ?? []),
);
assert.deepEqual(
  new Set(Object.keys(protocol.numericBindings)),
  referencedLabels,
  "numeric semantic binding set must exactly match scenario references",
);

const bindingCounts = {
  EXECUTABLE_KIND: 0,
  EXECUTABLE_CASE: 0,
  OWNER_ONLY_BOUNDARY: 0,
};
for (const [label, binding] of Object.entries(protocol.numericBindings)) {
  assert.ok(
    bindingCounts[binding.mode] !== undefined,
    label + ": unknown binding mode",
  );
  bindingCounts[binding.mode] += 1;
  if (binding.mode === "EXECUTABLE_KIND") {
    assert.ok(
      numericKinds.has(binding.kind),
      label + ": executable kind missing",
    );
    assert.deepEqual(
      binding.caseIds,
      numericKinds.get(binding.kind),
      label + ": executable case list drift",
    );
  } else if (binding.mode === "EXECUTABLE_CASE") {
    const row = numericCases.get(binding.caseId);
    assert.ok(row, label + ": executable case missing");
    assert.equal(
      row.kind,
      binding.kind,
      label + ": executable case kind drift",
    );
  } else {
    assert.equal(
      binding.reason,
      "NO_EXECUTABLE_NUMERIC_RULE_BOUND_IN_V1",
      label + ": owner-only boundary requires explicit reason",
    );
  }
}
assert.deepEqual(bindingCounts, protocol.bindingCounts);

assert.deepEqual(Object.keys(protocol.periodCatalog).sort(), [
  "GOLD_MONTH_2026_09_MSK",
  "GOLD_SNAPSHOT_2026_09_30_MSK",
]);
assert.deepEqual(protocol.periodCatalog.GOLD_MONTH_2026_09_MSK, {
  kind: "RANGE",
  start: "2026-09-01T00:00:00+03:00",
  end: "2026-09-30T23:59:59+03:00",
  timezone: "Europe/Moscow",
  purpose: "SYNTHETIC_REPRODUCIBLE_GOLD_PERIOD_ONLY",
});
assert.deepEqual(protocol.periodCatalog.GOLD_SNAPSHOT_2026_09_30_MSK, {
  kind: "SNAPSHOT",
  at: "2026-09-30T12:00:00+03:00",
  timezone: "Europe/Moscow",
  purpose: "SYNTHETIC_REPRODUCIBLE_GOLD_SNAPSHOT_ONLY",
});
assert.equal(protocol.definitionIndex.length, 90);
assert.equal(
  sha256(canonical(protocol.definitionIndex)),
  protocol.definitionIndexSha256,
  "definition index hash drift",
);
const definitionIndex = new Map();
for (const row of protocol.definitionIndex) {
  const key = [row.scenarioId, row.marketplace].join("::");
  assert.ok(!definitionIndex.has(key), "duplicate definition index " + key);
  assert.match(row.definitionsHash, /^[0-9a-f]{64}$/);
  assert.ok(protocol.periodCatalog[row.periodRef], key + ": unknown periodRef");
  definitionIndex.set(key, row);
}

const allowedCoverage = new Set([
  "DIRECT",
  "COMPOSITE",
  "BOUNDARY",
  "EXTERNAL_CONTEXT",
  "CONTRIBUTION_ONLY",
  "LOCAL_FILE_HISTORY",
]);
const cards = [];
const keys = new Set();

for (const scenario of coverage.scenarios) {
  assert.ok(
    scenario.identifiers?.length,
    scenario.id + ": identifiers missing",
  );
  assert.ok(scenario.metrics?.length, scenario.id + ": metrics missing");
  assert.ok(scenario.periodPolicy, scenario.id + ": period policy missing");
  assert.ok(
    scenario.continuationPolicy,
    scenario.id + ": continuation policy missing",
  );
  assert.ok(scenario.omissionPolicy, scenario.id + ": omission policy missing");
  assert.ok(
    scenario.numericFixtures?.length,
    scenario.id + ": numeric semantic label missing",
  );

  for (const marketplace of protocol.marketplaces) {
    const prefix = marketplace === "OZON" ? "ozon" : "wb";
    const coverageState = scenario[prefix + "Coverage"];
    const operations = scenario[prefix + "Operations"];
    assert.ok(
      allowedCoverage.has(coverageState),
      scenario.id + "/" + marketplace + ": bad coverage",
    );
    assert.ok(
      Array.isArray(operations) && operations.length > 0,
      scenario.id + "/" + marketplace + ": operations missing",
    );
    assert.equal(
      new Set(operations).size,
      operations.length,
      scenario.id + "/" + marketplace + ": duplicate operation",
    );
    assert.ok(
      operations.every((value) => typeof value === "string" && value),
      scenario.id + "/" + marketplace + ": invalid operation alias",
    );

    const periodRef =
      scenario.periodPolicy === "CURRENT_SNAPSHOT"
        ? "GOLD_SNAPSHOT_2026_09_30_MSK"
        : "GOLD_MONTH_2026_09_MSK";
    const periodDefinition = protocol.periodCatalog[periodRef];
    const definitionPayload = {
      protocolSchemaVersion: protocol.schemaVersion,
      coverageSchemaVersion: coverage.schemaVersion,
      readinessSemanticProjectionSha256:
        coverage.readiness.semanticProjectionSha256,
      authorities: coverage.authorities,
      checkLayers: protocol.checkLayers,
      scenarioId: scenario.id,
      marketplace,
      coverageState,
      operations,
      identifiers: scenario.identifiers,
      metrics: scenario.metrics,
      periodPolicy: scenario.periodPolicy,
      periodRef,
      periodDefinition,
      continuationPolicy: scenario.continuationPolicy,
      omissionPolicy: scenario.omissionPolicy,
      externalDependency: scenario.externalDependency,
      numericSourceSchema: numeric.schemaVersion,
      numericLabels: scenario.numericFixtures,
      numericBindings: Object.fromEntries(
        scenario.numericFixtures.map((label) => [
          label,
          protocol.numericBindings[label],
        ]),
      ),
      numericCaseDefinitions: Object.fromEntries(
        scenario.numericFixtures.map((label) => [
          label,
          numericCaseDefinitions(protocol.numericBindings[label]),
        ]),
      ),
      statusPolicy: {
        providerFactStatus: protocol.providerFactStatus,
        arithmeticStatuses: ["AUTOMATABLE_SOURCE_ONLY", "OWNER_ONLY_BOUNDARY"],
        ownerSemanticDefaultStatus: protocol.ownerSemanticDefaultStatus,
        externalDependencyDefaultStatus:
          protocol.externalDependencyDefaultStatus,
      },
      ownerVerdictSchema: protocol.ownerVerdictSchema,
      globalPolicies: coverage.globalPolicies,
    };
    const definitionsHash = sha256(canonical(definitionPayload));
    const definitionRecord = definitionIndex.get(
      [scenario.id, marketplace].join("::"),
    );
    assert.ok(
      definitionRecord,
      scenario.id + "/" + marketplace + ": definition missing",
    );
    assert.equal(definitionRecord.periodRef, periodRef);
    assert.equal(
      definitionRecord.definitionsHash,
      definitionsHash,
      scenario.id + "/" + marketplace + ": definition hash drift",
    );

    const fact = {
      scenarioId: scenario.id,
      marketplace,
      layer: "provider_fact",
      status: protocol.providerFactStatus,
      coverageState,
      operations,
      periodRef,
      definitionsHash,
    };
    const bindings = scenario.numericFixtures.map(
      (label) => protocol.numericBindings[label],
    );
    assert.ok(
      bindings.every(Boolean),
      scenario.id + ": dangling numeric label",
    );
    const arithmeticAutomatable = bindings.every(
      (binding) => binding.mode !== "OWNER_ONLY_BOUNDARY",
    );
    const arithmetic = {
      scenarioId: scenario.id,
      marketplace,
      layer: "deterministic_arithmetic",
      status: arithmeticAutomatable
        ? "AUTOMATABLE_SOURCE_ONLY"
        : "OWNER_ONLY_BOUNDARY",
      semanticLabels: scenario.numericFixtures,
      periodRef,
      definitionsHash,
    };
    const semantic = {
      scenarioId: scenario.id,
      marketplace,
      layer: "owner_semantic_verdict",
      status: scenario.externalDependency
        ? protocol.externalDependencyDefaultStatus
        : protocol.ownerSemanticDefaultStatus,
      externalDependency: scenario.externalDependency,
      periodRef,
      definitionsHash,
    };

    for (const card of [fact, arithmetic, semantic]) {
      const key = [card.scenarioId, card.marketplace, card.layer].join("::");
      assert.ok(!keys.has(key), "duplicate gold card " + key);
      keys.add(key);
      cards.push(card);
    }
  }
}

assert.equal(cards.length, protocol.expectedLogicalCardCount);
assert.equal(keys.size, protocol.expectedLogicalCardCount);
assert.equal(cards.filter((card) => card.layer === "provider_fact").length, 90);
assert.equal(
  cards.filter((card) => card.layer === "deterministic_arithmetic").length,
  90,
);
assert.equal(
  cards.filter((card) => card.layer === "owner_semantic_verdict").length,
  90,
);
assert.equal(protocol.providerFactStatus, "SOURCE_DEFINED_NOT_LIVE_ACCEPTED");
assert.equal(protocol.ownerSemanticDefaultStatus, "PENDING_OWNER");
assert.equal(protocol.externalDependencyDefaultStatus, "PENDING_EXTERNAL");
const allowedStatusByLayer = new Map([
  ["provider_fact", new Set(["SOURCE_DEFINED_NOT_LIVE_ACCEPTED"])],
  [
    "deterministic_arithmetic",
    new Set(["AUTOMATABLE_SOURCE_ONLY", "OWNER_ONLY_BOUNDARY"]),
  ],
  ["owner_semantic_verdict", new Set(["PENDING_OWNER", "PENDING_EXTERNAL"])],
]);
for (const card of cards) {
  assert.ok(
    allowedStatusByLayer.get(card.layer)?.has(card.status),
    "unexpected gold card status: " +
      [card.scenarioId, card.marketplace, card.layer, card.status].join("/"),
  );
}

const manual = protocol.ownerVerdictSchema;
const ownerVerdictFields = [
  "scenarioId",
  "marketplace",
  "periodRef",
  "definitionsHash",
  "resultClass",
  "verdict",
];
const ownerVerdictTupleFields = [
  "scenarioId",
  "marketplace",
  "periodRef",
  "definitionsHash",
];
assert.deepEqual(manual.requiredFields, ownerVerdictFields);
assert.deepEqual(manual.allowedFields, ownerVerdictFields);
assert.deepEqual(manual.tupleFields, ownerVerdictTupleFields);
assert.equal(manual.tupleBinding, "EXACT_DEFINITION_INDEX_ROW");
assert.deepEqual(manual.allowedVerdicts, ["PASS", "FAIL", "BLOCKED"]);
assert.deepEqual(manual.allowedResultClasses, [
  "USEFUL",
  "NOT_USEFUL",
  "INCOMPLETE",
  "UNKNOWN",
]);

const allowedOwnerVerdictFields = new Set(manual.allowedFields);
function validateOwnerVerdict(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return false;
  }
  const fields = Object.keys(record);
  if (
    fields.length !== manual.requiredFields.length ||
    fields.some((field) => !allowedOwnerVerdictFields.has(field)) ||
    manual.requiredFields.some(
      (field) => !Object.prototype.hasOwnProperty.call(record, field),
    )
  ) {
    return false;
  }
  if (
    manual.requiredFields.some((field) => typeof record[field] !== "string")
  ) {
    return false;
  }
  if (!manual.allowedVerdicts.includes(record.verdict)) return false;
  if (!manual.allowedResultClasses.includes(record.resultClass)) return false;
  const definition = definitionIndex.get(
    [record.scenarioId, record.marketplace].join("::"),
  );
  return Boolean(
    definition &&
      definition.periodRef === record.periodRef &&
      definition.definitionsHash === record.definitionsHash,
  );
}

for (const forbidden of [
  "rawProviderPayload",
  "token",
  "otp",
  "cookies",
  "accountId",
  "storeId",
  "deviceId",
  "sessionId",
  "conversationId",
  "fullAiTranscript",
]) {
  assert.ok(
    manual.forbiddenFields.includes(forbidden),
    "missing privacy ban: " + forbidden,
  );
  assert.ok(
    !allowedOwnerVerdictFields.has(forbidden),
    "forbidden field leaked into allowlist: " + forbidden,
  );
}

const firstDefinition = protocol.definitionIndex[0];
const siblingDefinition = protocol.definitionIndex[1];
const validManualVerdict = {
  scenarioId: firstDefinition.scenarioId,
  marketplace: firstDefinition.marketplace,
  periodRef: firstDefinition.periodRef,
  definitionsHash: firstDefinition.definitionsHash,
  resultClass: "USEFUL",
  verdict: "PASS",
};
assert.equal(validateOwnerVerdict(validManualVerdict), true);
assert.equal(
  validateOwnerVerdict({
    ...validManualVerdict,
    definitionsHash: siblingDefinition.definitionsHash,
  }),
  false,
  "definition hash from another tuple must fail closed",
);
assert.equal(
  validateOwnerVerdict({ ...validManualVerdict, note: "not allowed" }),
  false,
  "unspecified manual metadata field must fail closed",
);
assert.equal(
  validateOwnerVerdict({ ...validManualVerdict, storeId: "forbidden" }),
  false,
  "privacy-sensitive field must fail closed",
);
assert.equal(
  validateOwnerVerdict({
    ...validManualVerdict,
    scenarioId: [validManualVerdict.scenarioId],
  }),
  false,
  "non-string scenario identity must fail closed",
);
assert.equal(
  validateOwnerVerdict({
    ...validManualVerdict,
    marketplace: [validManualVerdict.marketplace],
  }),
  false,
  "non-string marketplace identity must fail closed",
);

const liveColumns = [
  "Ozon_ChatGPT_Standard",
  "Ozon_ChatGPT_Work",
  "Ozon_Alice",
  "WB_ChatGPT_Standard",
  "WB_ChatGPT_Work",
  "WB_Alice",
];
assert.ok(
  readiness.every((row) =>
    liveColumns.every((column) => row[column] === "NOT_RUN"),
  ),
  "current live AI matrix changed; semantic protocol requires explicit manual-result integration review",
);

console.log(
  JSON.stringify({
    status: "PASS",
    scenarioCount: scenarioIds.length,
    marketplaceCount: protocol.marketplaces.length,
    checkLayerCount: protocol.checkLayers.length,
    logicalCards: cards.length,
    numericBindings: bindingCounts,
    arithmeticAutomatableCards: cards.filter(
      (card) =>
        card.layer === "deterministic_arithmetic" &&
        card.status === "AUTOMATABLE_SOURCE_ONLY",
    ).length,
    arithmeticOwnerBoundaryCards: cards.filter(
      (card) =>
        card.layer === "deterministic_arithmetic" &&
        card.status === "OWNER_ONLY_BOUNDARY",
    ).length,
    ownerPendingCards: cards.filter(
      (card) => card.layer === "owner_semantic_verdict",
    ).length,
    definitionIndexRows: protocol.definitionIndex.length,
    definitionIndexSha256: protocol.definitionIndexSha256,
  }),
);
