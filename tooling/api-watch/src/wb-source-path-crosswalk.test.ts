import { describe, expect, it } from "vitest";
import {
  buildProductCrosswalk,
  extractProductRegistry,
} from "./product-registry.js";
import type { OperationInventory, ProductRegistryEntry } from "./types.js";

const family = "WILDBERRIES" as const;
const sourcePath = "/api/v1/supplies/{ID}";
const runtimePath = "/api/v1/supplies/{supplyId}";

function entry(
  overrides: Partial<ProductRegistryEntry> = {},
): ProductRegistryEntry {
  return {
    sourceFamily: family,
    runtimeAlias: "fbw_supply",
    method: "GET",
    normalizedPath: runtimePath,
    executionEnabled: true,
    effect: "READ",
    privacyClass: "standard",
    runtimeSafetyClass: null,
    workflowRole: null,
    entitlementKey: null,
    currentness: "current",
    blockedReason: null,
    providerMetadata: {
      source_openapi: "07-orders-fbw.yaml",
      source_path: sourcePath,
    },
    ...overrides,
  };
}

function inventory(
  route = sourcePath,
  method = "GET",
  sourceFamily = family as ProductRegistryEntry["sourceFamily"],
): OperationInventory {
  return {
    sourceFamily,
    snapshotSha256: "a".repeat(64),
    pathCount: 1,
    operationCount: 1,
    operationsByMethod: { [method]: 1 },
    deprecatedCount: 0,
    operationIdPresentCount: 0,
    operationIdMissingCount: 1,
    operations: [
      {
        sourceFamily,
        documentKey: "WB_07_ORDERS_FBW",
        snapshotSha256: "a".repeat(64),
        identity: `${sourceFamily}:${method}:${route}`,
        method,
        path: route,
        operationId: null,
        tags: [],
        deprecated: false,
        summaryHash: null,
        securitySchemeReferences: [],
        requestBodyPresent: false,
        parameterCount: 1,
        responseStatusKeys: ["200"],
      },
    ],
  };
}

function crosswalk(entries = [entry()], source = inventory()) {
  return buildProductCrosswalk({
    reportId: "wb-source-path-fixture",
    inventory: source,
    runtimeEntries: entries,
    createdAt: new Date("2026-10-22T16:28:17Z"),
  }).rows;
}

function expectSeparate(rows: ReturnType<typeof crosswalk>) {
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.crosswalkState).sort()).toEqual([
    "RUNTIME_ONLY",
    "SOURCE_ONLY",
  ]);
}

describe("WB explicit source-path placeholder correspondence", () => {
  it.each([
    ["fbw_supply", ""],
    ["fbw_supply_goods", "/goods"],
    ["fbw_supply_package", "/package"],
  ])(
    "maps existing %s to its declared official route",
    async (alias, suffix) => {
      const entries = await extractProductRegistry({ sourceFamily: family });
      const selected = entries.find((item) => item.runtimeAlias === alias);
      expect(selected).toBeDefined();
      expect(selected!.normalizedPath).toBe(runtimePath + suffix);
      expect(selected!.providerMetadata.source_path).toBe(sourcePath + suffix);
      const before = JSON.stringify(selected);
      const rows = crosswalk([selected!], inventory(sourcePath + suffix));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sourceIdentity: `${family}:GET:${sourcePath + suffix}`,
        documentKey: "WB_07_ORDERS_FBW",
        runtimeAlias: alias,
        crosswalkState: "MAPPED_ENABLED",
        reviewState: "NO_ACTION",
      });
      expect(JSON.stringify(selected)).toBe(before);
    },
  );

  it("preserves an exact runtime path in a previously captured source", () => {
    const rows = crosswalk([entry()], inventory(runtimePath));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      crosswalkState: "MAPPED_ENABLED",
      sourceIdentity: `${family}:GET:${runtimePath}`,
      runtimeAlias: "fbw_supply",
    });
  });

  it("preserves an exact runtime path observed in another family document", () => {
    const rows = buildProductCrosswalk({
      reportId: "legacy-other-document",
      inventory: inventory("/unrelated"),
      runtimeEntries: [entry()],
      familySourceIdentities: new Set([`${family}:GET:${runtimePath}`]),
    }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.crosswalkState).toBe("SOURCE_ONLY");
  });

  it("does not infer a renamed placeholder without explicit source metadata", () => {
    expectSeparate(crosswalk([entry({ providerMetadata: {} })]));
  });

  it.each([
    "/api/v2/supplies/{ID}",
    "/api/v1/orders/{ID}",
    "/api/v1/supplies/{ID}/goods",
    "/api/v1/supplies/123",
    "/api/v1/supplies/{ID}.json",
    "api/v1/supplies/{ID}",
  ])(
    "does not redirect the mapping to a different declared path %s",
    (route) => {
      expectSeparate(
        crosswalk(
          [entry({ providerMetadata: { source_path: route } })],
          inventory(route),
        ),
      );
    },
  );

  it("does not interpret WB source metadata for another marketplace", () => {
    expectSeparate(
      crosswalk(
        [entry({ sourceFamily: "OZON_SELLER" })],
        inventory(sourcePath, "GET", "OZON_SELLER"),
      ),
    );
  });

  it("does not merge different HTTP methods", () => {
    expectSeparate(crosswalk([entry()], inventory(sourcePath, "POST")));
  });

  it("preserves an ordinary exact route without a declaration", () => {
    const rows = crosswalk([
      entry({ normalizedPath: sourcePath, providerMetadata: {} }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.crosswalkState).toBe("MAPPED_ENABLED");
  });

  it("keeps two runtime aliases for one declared source identity ambiguous", () => {
    const rows = crosswalk([entry(), entry({ runtimeAlias: "other_alias" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      crosswalkState: "AMBIGUOUS_RUNTIME_MAPPING",
      reviewState: "BLOCKING_RISK",
    });
  });

  it("preserves the disabled state of an explicitly mapped operation", () => {
    const rows = crosswalk([entry({ executionEnabled: false })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      crosswalkState: "MAPPED_DISABLED",
      executionEnabled: false,
    });
  });

  it("uses the declared source identity for family-wide absence suppression", () => {
    const source = inventory("/unrelated");
    const rows = buildProductCrosswalk({
      reportId: "other-document",
      inventory: source,
      runtimeEntries: [entry()],
      familySourceIdentities: new Set([`${family}:GET:${sourcePath}`]),
    }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.crosswalkState).toBe("SOURCE_ONLY");
  });

  it("still reports a declared source route missing from the entire family", () => {
    const rows = buildProductCrosswalk({
      reportId: "absent-source",
      inventory: inventory("/unrelated"),
      runtimeEntries: [entry()],
      familySourceIdentities: new Set([`${family}:GET:/unrelated`]),
    }).rows;
    expect(
      rows.find((row) => row.crosswalkState === "RUNTIME_ONLY"),
    ).toMatchObject({
      sourceIdentity: `${family}:GET:${sourcePath}`,
      reviewState: "BLOCKING_RISK",
      documentKey: null,
    });
  });

  it.each([
    ["/x/{a}/{a}", "/x/{b}/{c}"],
    ["/x/{a}/{b}", "/x/{c}/{c}"],
    ["/x/{a}/fixed", "/x/fixed/{b}"],
  ])(
    "rejects non-bijective or displaced placeholders: %s -> %s",
    (runtime, declared) => {
      expectSeparate(
        crosswalk(
          [
            entry({
              normalizedPath: runtime,
              providerMetadata: { source_path: declared },
            }),
          ],
          inventory(declared),
        ),
      );
    },
  );
});
