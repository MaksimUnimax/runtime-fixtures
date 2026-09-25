import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const abs = (relative) => path.join(ROOT, relative);
const read = (relative) => fs.readFileSync(abs(relative), "utf8");
const sha256File = (relative) =>
  createHash("sha256")
    .update(fs.readFileSync(abs(relative)))
    .digest("hex");
const sha256Text = (value) => createHash("sha256").update(value).digest("hex");
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

function loadGlobal(relative, name) {
  const context = {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read(relative), context, { filename: relative });
  return context[name];
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

assert.equal(coverage.schemaVersion, "business_scenario_coverage_v1");
assert.equal(numeric.schemaVersion, "business_scenario_numeric_fixtures_v1");
assert.equal(
  sha256File(coverage.authorities.ozon.registryPath),
  coverage.authorities.ozon.registrySha256,
  "Ozon registry drift requires mapping review",
);
assert.equal(
  sha256File(coverage.authorities.wildberries.registryPath),
  coverage.authorities.wildberries.registrySha256,
  "WB registry drift requires mapping review",
);

const readinessRows = parseTsv(coverage.readiness.path);
assert.equal(readinessRows.length, coverage.readiness.expectedRows);
const semanticProjection = readinessRows
  .map(
    (row) =>
      coverage.readiness.semanticColumns
        .map((column) => row[column])
        .join("\t") + "\n",
  )
  .join("");
assert.equal(
  sha256Text(semanticProjection),
  coverage.readiness.semanticProjectionSha256,
  "readiness semantics drift requires explicit mapping review",
);

const readinessIds = readinessRows.map((row) => row.ID);
const mappedIds = coverage.scenarios.map((row) => row.id);
assert.deepEqual(
  mappedIds,
  readinessIds,
  "coverage manifest must account for every readiness row in order",
);
assert.equal(
  new Set(mappedIds).size,
  mappedIds.length,
  "scenario IDs must be unique",
);

const wb = loadGlobal(
  coverage.authorities.wildberries.registryPath,
  "WBOperations",
);
const ozon = loadGlobal(
  coverage.authorities.ozon.registryPath,
  "OzonOperationRegistry",
);
const allowedCoverage = new Set([
  "DIRECT",
  "COMPOSITE",
  "BOUNDARY",
  "EXTERNAL_CONTEXT",
  "CONTRIBUTION_ONLY",
  "LOCAL_FILE_HISTORY",
]);
const allowedContinuation = new Set([
  "EXPLICIT_ONLY",
  "EXPLICIT_PAGINATION",
  "EXPLICIT_REPORT_LIFECYCLE",
  "EXPLICIT_NEXT_READ",
]);
const boundaryCoverage = new Set([
  "BOUNDARY",
  "EXTERNAL_CONTEXT",
  "CONTRIBUTION_ONLY",
  "LOCAL_FILE_HISTORY",
]);
const wbHosts = new Set();
let wbOperationRefs = 0;
let ozonOperationRefs = 0;
for (const row of coverage.scenarios) {
  assert.ok(
    allowedCoverage.has(row.ozonCoverage),
    `${row.id}: invalid Ozon coverage state`,
  );
  assert.ok(
    allowedCoverage.has(row.wbCoverage),
    `${row.id}: invalid WB coverage state`,
  );
  assert.ok(
    allowedContinuation.has(row.continuationPolicy),
    `${row.id}: continuation must remain explicit`,
  );
  assert.equal(
    row.omissionPolicy,
    "MISSING_NOT_ZERO",
    `${row.id}: missing/403/unready must not become zero`,
  );
  assert.ok(
    row.identifiers.length > 0,
    `${row.id}: identifier grain must be explicit`,
  );
  assert.ok(
    row.metrics.length > 0,
    `${row.id}: metrics/units must be explicit`,
  );
  assert.ok(
    row.ozonOperations.length > 0 && row.wbOperations.length > 0,
    `${row.id}: both marketplace mappings required`,
  );
  assert.equal(
    new Set(row.ozonOperations).size,
    row.ozonOperations.length,
    `${row.id}: duplicate Ozon operation`,
  );
  assert.equal(
    new Set(row.wbOperations).size,
    row.wbOperations.length,
    `${row.id}: duplicate WB operation`,
  );
  for (const alias of row.ozonOperations) {
    const meta = ozon.OPERATIONS[alias];
    assert.ok(meta, `${row.id}: missing Ozon operation ${alias}`);
    assert.equal(
      meta.execution_enabled,
      true,
      `${row.id}/${alias}: Ozon operation disabled`,
    );
    assert.equal(
      meta.effect,
      "READ",
      `${row.id}/${alias}: Ozon operation not READ`,
    );
    assert.equal(
      meta.currentness,
      "current",
      `${row.id}/${alias}: Ozon operation not current`,
    );
    ozonOperationRefs++;
  }
  for (const alias of row.wbOperations) {
    const meta = wb.OPERATIONS[alias];
    assert.ok(meta, `${row.id}: missing WB operation ${alias}`);
    assert.equal(
      meta.execution_enabled,
      true,
      `${row.id}/${alias}: WB operation disabled`,
    );
    assert.equal(
      meta.effect,
      "READ",
      `${row.id}/${alias}: WB operation not READ`,
    );
    assert.equal(
      meta.current,
      true,
      `${row.id}/${alias}: WB operation not current`,
    );
    assert.notEqual(
      meta.privacy,
      "blocked_pii",
      `${row.id}/${alias}: direct PII surface forbidden`,
    );
    wbHosts.add(meta.host);
    wbOperationRefs++;
  }
  if (
    boundaryCoverage.has(row.wbCoverage) ||
    boundaryCoverage.has(row.ozonCoverage)
  )
    assert.ok(
      row.externalDependency,
      `${row.id}: bounded coverage must state its external/semantic boundary`,
    );
}

const calculators = {
  sales_totals(input) {
    if (!input.complete)
      return { status: "INCOMPLETE", money: null, units: null };
    return {
      status: "COMPLETE",
      money: input.rows.reduce((sum, row) => sum + Number(row.money), 0),
      units: input.rows.reduce((sum, row) => sum + Number(row.units), 0),
    };
  },
  daily_rank(input) {
    const rows = input.rows.map((row) => ({
      ...row,
      money: Number(row.money),
    }));
    const best = [...rows]
      .sort((a, b) => b.money - a.money || a.day.localeCompare(b.day))
      .slice(0, 3)
      .map((row) => row.day);
    const worst = [...rows]
      .sort((a, b) => a.money - b.money || a.day.localeCompare(b.day))
      .slice(0, 3)
      .map((row) => row.day);
    return { best, worst };
  },
  percent_change(input) {
    const current = Number(input.current),
      previous = Number(input.previous);
    if (
      !Number.isFinite(current) ||
      !Number.isFinite(previous) ||
      previous === 0
    )
      return null;
    return ((current - previous) / Math.abs(previous)) * 100;
  },
  warehouse_sort(input) {
    return [...input.rows]
      .sort(
        (a, b) =>
          Number(b.units) - Number(a.units) ||
          String(a.warehouse).localeCompare(String(b.warehouse)),
      )
      .map((row) => row.warehouse);
  },
  days_cover(input) {
    if (
      !input.complete ||
      input.demandUnits === null ||
      input.demandUnits === undefined
    )
      return null;
    const stock = Number(input.stock),
      demand = Number(input.demandUnits),
      days = Number(input.days);
    if (
      ![stock, demand, days].every(Number.isFinite) ||
      stock < 0 ||
      demand <= 0 ||
      days <= 0
    )
      return null;
    return stock / (demand / days);
  },
  drr(input) {
    if (!input.complete) return null;
    const spend = Number(input.spend),
      revenue = Number(input.revenue);
    if (!Number.isFinite(spend) || !Number.isFinite(revenue) || revenue <= 0)
      return null;
    return (spend / revenue) * 100;
  },
  platform_contribution(input) {
    const values = [
      input.revenue,
      input.fees,
      input.storage,
      input.logistics,
      input.ads,
    ].map(Number);
    assert.ok(values.every(Number.isFinite));
    return {
      label: "platform_contribution",
      amount:
        values[0] - values.slice(1).reduce((sum, value) => sum + value, 0),
      isNetProfit: false,
    };
  },
  top_n_join(input) {
    const catalog = new Map(input.catalog.map((row) => [row.id, row]));
    const ranked = [...input.sales]
      .sort(
        (a, b) =>
          Number(b.money) - Number(a.money) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .slice(0, input.n);
    const missingCatalog = ranked
      .filter((row) => !catalog.has(row.id))
      .map((row) => row.id);
    const top = ranked
      .filter((row) => catalog.has(row.id))
      .map((row) => ({
        id: row.id,
        name: catalog.get(row.id).name,
        money: row.money,
      }));
    return { top, missingCatalog };
  },
  join_unique(input) {
    const ids = input.right.map((row) => row.id);
    return {
      status: new Set(ids).size === ids.length ? "UNIQUE" : "DUPLICATE_KEY",
    };
  },
  search_dedup(input) {
    const keys = input.rows.map(
      (row) => `${row.period}\u0000${row.product}\u0000${row.query}`,
    );
    return {
      uniqueCount: new Set(keys).size,
      pageCountProvesCompleteness: false,
    };
  },
  causal_boundary(input) {
    return {
      claim: "HYPOTHESIS_NOT_PROVEN_CAUSE",
      factorCount: input.signals.length,
    };
  },
};

for (const row of numeric.cases) {
  assert.ok(
    calculators[row.kind],
    `${row.id}: unknown calculator kind ${row.kind}`,
  );
  assert.deepEqual(
    calculators[row.kind](row.input),
    row.expected,
    `${row.id}: deterministic fixture mismatch`,
  );
}

const requiredKinds = new Set([
  "sales_totals",
  "daily_rank",
  "percent_change",
  "warehouse_sort",
  "days_cover",
  "drr",
  "platform_contribution",
  "top_n_join",
  "join_unique",
  "search_dedup",
  "causal_boundary",
]);
assert.deepEqual(
  new Set(numeric.cases.map((row) => row.kind)),
  requiredKinds,
  "numeric rule coverage drift",
);

console.log(
  JSON.stringify({
    status: "PASS",
    scenarioRows: mappedIds.length,
    ozonOperationRefs,
    wbOperationRefs,
    wbHosts: [...wbHosts].sort(),
    numericCases: numeric.cases.length,
    semanticProjectionSha256: coverage.readiness.semanticProjectionSha256,
    ozonRegistrySha256: coverage.authorities.ozon.registrySha256,
    wbRegistrySha256: coverage.authorities.wildberries.registrySha256,
  }),
);
