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
const slice = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/wb-search-query-field-schema-slice-v1.json",
  ),
);
const coverage = JSON.parse(
  read(
    "tests/regression/extension-core/fixtures/business-scenario-coverage-v1.json",
  ),
);
const catalog = JSON.parse(read(slice.sources.catalog.reuseFixture));

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
const scenarios = new Map(coverage.scenarios.map((row) => [row.id, row]));

function assertOperation(source) {
  const meta = wb.OPERATIONS[source.operationAlias];
  assert.ok(meta, "missing WB operation " + source.operationAlias);
  if (source.host)
    assert.equal(
      meta.host,
      source.host,
      source.operationAlias + ": host drift",
    );
  if (source.method)
    assert.equal(
      meta.method,
      source.method,
      source.operationAlias + ": method drift",
    );
  if (source.path)
    assert.equal(
      meta.path,
      source.path,
      source.operationAlias + ": path drift",
    );
  assert.equal(meta.effect, "READ");
  assert.equal(meta.execution_enabled, true);
  assert.equal(meta.current, true);
  return meta;
}

function projectSearchFacts(input) {
  if (
    typeof input.period !== "string" ||
    !input.period ||
    !Array.isArray(input.rows) ||
    !Array.isArray(input.aiSuggestions)
  )
    return { status: "INCOMPLETE", reason: "PERIOD_OR_ROWS_MISSING" };

  const keys = new Set();
  for (const row of input.rows) {
    if (
      !row ||
      typeof row.text !== "string" ||
      !row.text ||
      !Number.isInteger(row.nmId)
    )
      return {
        status: "INCOMPLETE",
        reason: "PROVIDER_SEARCH_FACT_IDENTITY_MISSING",
      };

    const frequency = row.frequency?.current;
    const median = row.medianPosition?.current;
    if (!Number.isInteger(frequency) || !Number.isInteger(median))
      return { status: "INCOMPLETE", reason: "PROVIDER_SEARCH_METRIC_MISSING" };

    const key = [input.period, row.nmId, row.text].join("\u0000");
    if (keys.has(key))
      return {
        status: "INCOMPLETE",
        reason: "DUPLICATE_SEARCH_FACT_BUSINESS_KEY",
      };
    keys.add(key);
  }

  return {
    status: "PASS",
    providerFactCount: input.rows.length,
    aiSuggestionCount: input.aiSuggestions.length,
    aiSuggestionsAreProviderFacts: false,
  };
}

function monthlyHistory(rows) {
  if (!Array.isArray(rows))
    return { status: "INCOMPLETE", reason: "HISTORY_ROWS_MISSING" };
  const keys = new Set();
  for (const row of rows) {
    if (
      !row ||
      typeof row.period !== "string" ||
      !row.period ||
      typeof row.product !== "string" ||
      !row.product ||
      typeof row.query !== "string" ||
      !row.query
    )
      return { status: "INCOMPLETE", reason: "HISTORY_BUSINESS_KEY_MISSING" };
    keys.add(JSON.stringify([row.period, row.product, row.query]));
  }
  return {
    uniqueBusinessKeys: keys.size,
    providerTopSetProvesFullUniverse: false,
    ownerManagedLocalFilesRequired: true,
  };
}

assert.equal(slice.schemaVersion, "wb_search_query_field_schema_slice_v1");
assert.deepEqual(slice.scope.scenarioIds, ["CAP-21", "CAP-25"]);
assert.equal(slice.scope.liveValues, false);
assert.equal(slice.scope.acceptedOperationMappingChanged, false);
assert.equal(
  slice.authority.mirrorCommit,
  "5057bdb9bf16dea24000e3ca79e1934f7761d7fe",
);
assert.equal(
  slice.authority.specBlobSha,
  "de25972f376a6804e34c6842830c45cfed644d61",
);
assert.equal(
  slice.authority.itemSearchTextsRequestBlobSha,
  "db409c3a9fa78c063494f7e479f4f5db927695b3",
);
assert.equal(
  slice.authority.itemSearchTextsResponseBlobSha,
  "cab23a32f01cff71f1fc805fc4b0ebb457127b49",
);
assert.equal(
  slice.authority.tableSearchTextItemBlobSha,
  "7aab48bab75a6f9e2013bb99b692c4180b2ea6cb",
);
assert.equal(
  slice.authority.tableDetailsRequestBlobSha,
  "b9b9ebea52275579564a88e53ba183f4f7d40d43",
);
assert.equal(
  slice.authority.tableDetailsResponseBlobSha,
  "7b23d6638897c3af481f6c9dbadb6dfcc5129e91",
);
assert.equal(
  slice.authority.tableItemItemBlobSha,
  "5e2a4f8b1799f2a15dcac4d5ec32572da86719a7",
);

const search = slice.sources.searchTexts;
const details = slice.sources.details;
assertOperation(search);
assertOperation(details);
const cardsMeta = assertOperation({
  operationAlias: slice.sources.catalog.operationAlias,
  host: catalog.source.host,
  method: catalog.source.method,
  path: catalog.source.path,
});
assert.equal(cardsMeta.host, "content");

assert.equal(search.request.maxNmIds, 50);
assert.deepEqual(search.request.topOrderBy, [
  "openCard",
  "addToCart",
  "openToCart",
  "orders",
  "cartToOrder",
]);
assert.equal(search.request.standardTariffTextLimitMax, 30);
assert.equal(search.request.advancedTariffTextLimitMax, 100);
assert.equal(search.continuation, null);
assert.equal(search.response.rowGrain[0], "text");
assert.equal(search.response.rowGrain[1], "nmId");
assert.equal(search.response.fields.text.role, "provider_search_query_text");
assert.equal(
  search.response.fields["frequency.current"].role,
  "provider_query_frequency_current",
);
assert.equal(
  search.response.fields["medianPosition.current"].role,
  "provider_median_search_position",
);
assert.equal(
  search.response.fields["avgPosition.current"].role,
  "provider_average_search_position",
);

assert.equal(details.request.maxNmIds, 50);
assert.deepEqual(details.request.positionCluster, [
  "all",
  "firstHundred",
  "secondHundred",
  "below",
]);
assert.equal(details.request.limitMax, 1000);
assert.equal(details.request.offsetRequired, true);
assert.equal(details.response.rowGrain[0], "nmId");
assert.equal(slice.sources.catalog.join, "search nmId -> cards_list nmID");
assert.equal(catalog.source.rowGrain[0], "nmID");

const cap21 = scenarios.get("CAP-21");
const cap25 = scenarios.get("CAP-25");
assert.ok(cap21 && cap25, "CAP-21/CAP-25 missing");
assert.deepEqual(cap21.wbOperations, slice.acceptedMappingSnapshot["CAP-21"]);
assert.deepEqual(cap25.wbOperations, slice.acceptedMappingSnapshot["CAP-25"]);
assert.deepEqual(cap21.numericFixtures, ["search_fact_boundary"]);
assert.deepEqual(cap25.numericFixtures, ["search_dedup"]);
assert.equal(cap21.omissionPolicy, "MISSING_NOT_ZERO");
assert.equal(cap25.omissionPolicy, "MISSING_NOT_ZERO");
assert.equal(
  cap21.externalDependency,
  "SEARCH_ANALYTICS_ENTITLEMENT_MAY_BE_REQUIRED",
);
assert.equal(cap25.externalDependency, "PRIOR_MONTH_FILES_OWNER_MANAGED");

const c = slice.syntheticCases;
assert.deepEqual(projectSearchFacts(c.providerFacts), c.providerFacts.expected);
assert.deepEqual(
  projectSearchFacts({
    period: c.duplicateFact.period,
    rows: c.duplicateFact.rows,
    aiSuggestions: [],
  }),
  c.duplicateFact.expected,
);
assert.deepEqual(
  projectSearchFacts({
    period: c.missingMetric.period,
    rows: c.missingMetric.rows,
    aiSuggestions: [],
  }),
  c.missingMetric.expected,
);
assert.deepEqual(
  monthlyHistory(c.monthlyHistory.rows),
  c.monthlyHistory.expected,
);

// CAP-25 owner-file identity is the complete tuple of accepted strings.
// Embedded delimiters are data; distinct tuples must never alias each other.
let monthlyHistoryCases = 0;
function checkHistory(name, rows, expectedCount) {
  assert.deepEqual(
    monthlyHistory(rows),
    {
      uniqueBusinessKeys: expectedCount,
      providerTopSetProvesFullUniverse: false,
      ownerManagedLocalFilesRequired: true,
    },
    name,
  );
  monthlyHistoryCases++;
}
const historyAliases = [
  { period: "2026-08", product: "1001\u0000sub", query: "dress" },
  { period: "2026-08", product: "1001", query: "sub\u0000dress" },
];
checkHistory("history distinct product/query delimiter tuples", historyAliases, 2);
checkHistory("history true duplicate", [historyAliases[0], historyAliases[0]], 1);
checkHistory("history duplicate beside distinct tuple", [...historyAliases, historyAliases[0]], 2);
const shiftedDelimiters = [
  { period: "a\u0000b", product: "c", query: "d" },
  { period: "a", product: "b\u0000c", query: "d" },
  { period: "a", product: "b", query: "c\u0000d" },
];
checkHistory("history all tuple boundaries", shiftedDelimiters, 3);
checkHistory("history permutation", [...shiftedDelimiters].reverse(), 3);
checkHistory("history empty input", [], 0);
checkHistory("history literal escape differs from delimiter", [
  { period: "2026-08", product: "1001\\u0000sub", query: "dress" },
  historyAliases[0],
], 2);
checkHistory("history exact Unicode strings stay distinct", [
  { period: "2026-08", product: "1001", query: "é" },
  { period: "2026-08", product: "1001", query: "e\u0301" },
  { period: "2026-08", product: "1001", query: "\ud800" },
  { period: "2026-08", product: "1001", query: "�" },
], 4);
checkHistory("history existing nonempty-string acceptance", [
  { period: " ", product: " ", query: " " },
], 1);
const historyAlphabet = ["a", "a\u0000b", "b\u0000a", "\u0000", "x\\0y", "\"\\\n", "платье🚀"];
const historyGrid = historyAlphabet.flatMap((period) =>
  historyAlphabet.flatMap((product) =>
    historyAlphabet.map((query) => ({ period, product, query })),
  ),
);
checkHistory("history complete accepted-string Cartesian set", historyGrid, 343);
checkHistory("history Cartesian duplicate copies", [...historyGrid, ...historyGrid], 343);
for (const field of ["period", "product", "query"]) {
  for (const value of [undefined, null, "", 1, false, [], {}]) {
    const row = { period: "2026-08", product: "1001", query: "dress" };
    if (value === undefined) delete row[field];
    else row[field] = value;
    assert.deepEqual(monthlyHistory([row]), {
      status: "INCOMPLETE", reason: "HISTORY_BUSINESS_KEY_MISSING",
    }, "history invalid " + field + " / " + String(value));
    monthlyHistoryCases++;
  }
}
for (const rows of [undefined, null, "rows", 1, false, {}]) {
  assert.deepEqual(monthlyHistory(rows), {
    status: "INCOMPLETE", reason: "HISTORY_ROWS_MISSING",
  }, "history non-array input " + String(rows));
  monthlyHistoryCases++;
}
for (const row of [null, undefined, {}, [], "row", 1, false]) {
  assert.deepEqual(monthlyHistory([row]), {
    status: "INCOMPLETE", reason: "HISTORY_BUSINESS_KEY_MISSING",
  }, "history invalid row " + String(row));
  monthlyHistoryCases++;
}
const frozenHistory = Object.freeze(historyAliases.map((row) => Object.freeze({ ...row })));
const historyBefore = JSON.stringify(frozenHistory);
checkHistory("history frozen input", frozenHistory, 2);
assert.equal(JSON.stringify(frozenHistory), historyBefore, "history input not mutated");
const detachedHistoryResult = monthlyHistory(frozenHistory);
detachedHistoryResult.uniqueBusinessKeys = -1;
checkHistory("history detached return", frozenHistory, 2);

assert.equal(
  slice.rules.modelIdeas,
  "AI_SUGGESTIONS_MUST_REMAIN_SEPARATE_FROM_PROVIDER_SEARCH_FACTS",
);
assert.equal(
  slice.rules.missing,
  "MISSING_OR_UNAVAILABLE_SEARCH_FACT_IS_UNKNOWN_NOT_ZERO",
);
assert.equal(
  slice.rules.pageCount,
  "PAGE_OR_REQUEST_COUNT_NEVER_PROVES_SEMANTIC_COMPLETENESS",
);

console.log(
  JSON.stringify({
    status: "PASS",
    scenarios: slice.scope.scenarioIds,
    searchTextLimit: [30, 100],
    maxNmIds: 50,
    completeSemanticUniverseClaimed: false,
    aiSuggestionsAreProviderFacts: false,
    acceptedOperationMappingChanged: false,
    liveValues: false,
    monthlyHistoryCases,
  }),
);
