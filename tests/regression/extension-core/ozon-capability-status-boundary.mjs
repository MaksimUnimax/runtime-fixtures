import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
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

function classify(status) {
  if (status === "PASS") return "CLEAN_PASS";
  if (status.startsWith("PASS_")) return "QUALIFIED_PASS";
  if (status.startsWith("PARTIAL_")) return "PARTIAL";
  if (status.startsWith("REOPENED_")) return "REOPENED";
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  assert.fail("UNKNOWN_OZON_HISTORICAL_STATUS: " + status);
}

const rows = parseTsv("docs/product/readiness/BUSINESS_SCENARIOS.tsv");
const statusColumn = "Исторический_статус_Ozon";
const expectedIds = [
  ...Array.from(
    { length: 20 },
    (_, index) => "STD-" + String(index + 1).padStart(2, "0"),
  ),
  ...Array.from(
    { length: 25 },
    (_, index) => "CAP-" + String(index + 1).padStart(2, "0"),
  ),
];

assert.equal(rows.length, 45, "canonical scenario count drift");
assert.deepEqual(
  rows.map((row) => row.ID),
  expectedIds,
  "canonical scenario ordering/ID drift",
);
assert.equal(new Set(expectedIds).size, 45, "duplicate canonical scenario ID");

const historicalTerminalIds = new Set(expectedIds.slice(0, 44));
assert.equal(historicalTerminalIds.size, 44);
assert.ok(!historicalTerminalIds.has("CAP-25"));

const byId = new Map(rows.map((row) => [row.ID, row]));
assert.equal(
  byId.get("CAP-22")[statusColumn],
  "PARTIAL_WITH_COMPETITOR_DISCOVERY_COVERAGE_BOUNDARY",
);
assert.equal(
  byId.get("CAP-24")[statusColumn],
  "REOPENED__STORAGE_PLACEMENT_REQUIRED_FOR_UNIT_ECONOMICS",
);
assert.equal(byId.get("CAP-25")[statusColumn], "IN_PROGRESS");
assert.equal(
  byId.get("CAP-18")[statusColumn],
  "PASS_WITH_PRODUCT_LEVEL_COVERAGE_AND_EXPLICIT_DATA_READINESS_GUIDANCE",
);

const counts = {
  CLEAN_PASS: 0,
  QUALIFIED_PASS: 0,
  PARTIAL: 0,
  REOPENED: 0,
  IN_PROGRESS: 0,
};
const historicalCounts = {
  CLEAN_PASS: 0,
  QUALIFIED_PASS: 0,
  PARTIAL: 0,
  REOPENED: 0,
};
const statusRows = rows.map((row) => {
  const status = row[statusColumn];
  assert.ok(status, row.ID + ": missing historical Ozon status");
  const category = classify(status);
  counts[category] += 1;
  if (historicalTerminalIds.has(row.ID)) {
    assert.notEqual(
      category,
      "IN_PROGRESS",
      row.ID + ": historical terminal cannot be IN_PROGRESS",
    );
    historicalCounts[category] += 1;
  }
  return { id: row.ID, status, category };
});

assert.deepEqual(counts, {
  CLEAN_PASS: 26,
  QUALIFIED_PASS: 16,
  PARTIAL: 1,
  REOPENED: 1,
  IN_PROGRESS: 1,
});
assert.deepEqual(historicalCounts, {
  CLEAN_PASS: 26,
  QUALIFIED_PASS: 16,
  PARTIAL: 1,
  REOPENED: 1,
});
assert.equal(
  historicalCounts.CLEAN_PASS,
  26,
  "historical 44 terminal set must not be treated as 44 clean PASS",
);
assert.notEqual(
  historicalCounts.CLEAN_PASS,
  historicalTerminalIds.size,
  "terminal status was incorrectly collapsed into clean PASS",
);

const partialIds = statusRows
  .filter((row) => row.category === "PARTIAL")
  .map((row) => row.id);
const reopenedIds = statusRows
  .filter((row) => row.category === "REOPENED")
  .map((row) => row.id);
const inProgressIds = statusRows
  .filter((row) => row.category === "IN_PROGRESS")
  .map((row) => row.id);
const guidanceGapIds = statusRows
  .filter((row) => row.status.includes("GUIDANCE_GAP"))
  .map((row) => row.id);

assert.deepEqual(partialIds, ["CAP-22"]);
assert.deepEqual(reopenedIds, ["CAP-24"]);
assert.deepEqual(inProgressIds, ["CAP-25"]);
assert.deepEqual(guidanceGapIds, ["CAP-16", "CAP-21"]);
assert.ok(
  guidanceGapIds.every(
    (id) => classify(byId.get(id)[statusColumn]) === "QUALIFIED_PASS",
  ),
  "guidance gaps must remain qualified rather than clean PASS",
);

const plan = read("docs/product/readiness/TEST_PLAN.md");
for (const required of [
  "44 terminal",
  "CAP-24 был переоткрыт",
  "CAP-22 остался PARTIAL",
  "CAP-25 IN_PROGRESS",
]) {
  assert.ok(
    plan.includes(required),
    "TEST_PLAN historical boundary missing: " + required,
  );
}

console.log(
  JSON.stringify({
    status: "PASS",
    currentScenarioCount: rows.length,
    historicalTerminalCount: historicalTerminalIds.size,
    currentStatusCounts: counts,
    historicalTerminalStatusCounts: historicalCounts,
    partialIds,
    reopenedIds,
    inProgressIds,
    guidanceGapIds,
    aggregateClaim: "HISTORICAL_TERMINAL_IS_NOT_CLEAN_PASS",
  }),
);
