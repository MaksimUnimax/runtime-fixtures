import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  buildProductCrosswalk,
  extractProductRegistry,
  productIdentity,
  WB_PRODUCT_REGISTRY_PATH,
} from "./product-registry.js";
import type { OperationInventory } from "./types.js";

describe("A7 product registry crosswalk", () => {
  it("statically extracts the current Ozon registries by provider", async () => {
    const seller = await extractProductRegistry({
      sourceFamily: "OZON_SELLER",
    });
    const performance = await extractProductRegistry({
      sourceFamily: "OZON_PERFORMANCE",
    });
    expect(seller.length).toBeGreaterThan(0);
    expect(performance.length).toBeGreaterThan(0);
    expect(
      seller.every((row) => row.providerMetadata.provider === "seller_api"),
    ).toBe(true);
    expect(
      performance.every(
        (row) => row.providerMetadata.provider === "performance_api",
      ),
    ).toBe(true);
  });

  it("statically extracts the pinned WB registry without evaluating JavaScript", async () => {
    const rows = await extractProductRegistry({ sourceFamily: "WILDBERRIES" });
    expect(rows.length).toBeGreaterThan(0);
    const source = await readFile(
      new URL(
        "../../../migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(/\beval\s*\(|\bFunction\s*\(|vm\.runIn/);
  });

  it("retires disabled WB analytics aliases from the effective registry while preserving the donor", async () => {
    const donor = await extractProductRegistry({
      sourceFamily: "WILDBERRIES",
      filePath: WB_PRODUCT_REGISTRY_PATH,
    });
    const effective = await extractProductRegistry({
      sourceFamily: "WILDBERRIES",
    });

    expect(
      donor.find((row) => row.runtimeAlias === "banned_products_shadowed"),
    ).toMatchObject({
      method: "GET",
      normalizedPath: "/api/v1/analytics/banned-products/shadowed",
      executionEnabled: true,
      currentness: "current",
    });
    expect(
      donor.find((row) => row.runtimeAlias === "analytics_item_rating_v1"),
    ).toMatchObject({
      method: "POST",
      normalizedPath: "/api/analytics/v1/item-rating",
      executionEnabled: true,
      currentness: "current",
    });
    expect(
      donor.find((row) => row.runtimeAlias === "goods_return"),
    ).toMatchObject({
      method: "GET",
      normalizedPath: "/api/v1/analytics/goods-return",
      executionEnabled: true,
      currentness: "current",
    });
    expect(
      donor.find((row) => row.runtimeAlias === "analytics_item_returns"),
    ).toBeUndefined();

    expect(
      effective.find((row) => row.runtimeAlias === "banned_products_shadowed"),
    ).toBeUndefined();
    expect(
      effective.find((row) => row.runtimeAlias === "analytics_item_rating_v1"),
    ).toBeUndefined();
    expect(
      effective.find((row) => row.runtimeAlias === "analytics_item_returns"),
    ).toMatchObject({
      method: "GET",
      normalizedPath: "/api/analytics/v1/item-returns",
      executionEnabled: true,
      currentness: "current",
      providerMetadata: {
        host: "analytics",
        category: "analytics",
        body_required: false,
        privacy: "standard",
        response_mode: "json",
        read_kind: "direct",
        effect: "READ",
        source_openapi: "12-reports.yaml",
        source_path: "/api/analytics/v1/item-returns",
        source_readonly: true,
        query_keys: ["dateFrom", "dateTo", "status", "limit", "offset"],
        required_query_keys: [
          "dateFrom",
          "dateTo",
          "status",
          "limit",
          "offset",
        ],
      },
    });
    expect(
      effective.find((row) => row.runtimeAlias === "banned_products_blocked"),
    ).toBeDefined();
    expect(
      effective.find((row) => row.runtimeAlias === "analytics_item_rating_v2"),
    ).toBeDefined();
    expect(effective).toHaveLength(donor.length - 1);
  });

  it("projects the composed WB FBS body requirement while preserving the frozen donor", async () => {
    const donor = await extractProductRegistry({
      sourceFamily: "WILDBERRIES",
      filePath: WB_PRODUCT_REGISTRY_PATH,
    });
    const effective = await extractProductRegistry({
      sourceFamily: "WILDBERRIES",
    });
    const donorStatus = donor.find(
      (row) => row.runtimeAlias === "fbs_order_statuses",
    );
    const effectiveStatus = effective.find(
      (row) => row.runtimeAlias === "fbs_order_statuses",
    );
    expect(donorStatus).toMatchObject({
      method: "POST",
      normalizedPath: "/api/v3/orders/status",
    });
    expect(donorStatus?.providerMetadata.body_required).toBe(false);
    expect(effectiveStatus).toMatchObject({
      method: "POST",
      normalizedPath: "/api/v3/orders/status",
    });
    expect(effectiveStatus?.providerMetadata.body_required).toBe(true);
  });

  it("uses source family + method + path rather than alias", () => {
    const inventory: OperationInventory = {
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "a",
      pathCount: 1,
      operationCount: 1,
      operationsByMethod: { GET: 1 },
      deprecatedCount: 0,
      operationIdPresentCount: 0,
      operationIdMissingCount: 1,
      operations: [
        {
          sourceFamily: "OZON_SELLER",
          snapshotSha256: "a",
          identity: "OZON_SELLER:GET:/x",
          method: "GET",
          path: "/x",
          operationId: null,
          tags: [],
          deprecated: false,
          summaryHash: null,
          securitySchemeReferences: [],
          requestBodyPresent: false,
          parameterCount: 0,
          responseStatusKeys: [],
        },
      ],
    };
    const result = buildProductCrosswalk({
      reportId: "r",
      inventory,
      runtimeEntries: [
        {
          sourceFamily: "OZON_SELLER",
          runtimeAlias: "different",
          method: "GET",
          normalizedPath: "/x",
          executionEnabled: true,
          effect: "READ",
          privacyClass: "safe",
          runtimeSafetyClass: null,
          workflowRole: null,
          entitlementKey: null,
          currentness: "current",
          blockedReason: null,
          providerMetadata: {},
        },
      ],
    });
    expect(result.rows[0]?.crosswalkState).toBe("MAPPED_ENABLED");
    expect(
      productIdentity({
        sourceFamily: "OZON_SELLER",
        method: "GET",
        normalizedPath: "/x",
      }),
    ).toBe("OZON_SELLER:GET:/x");
  });

  it("preserves source document scope and leaves runtime-only rows unscoped", () => {
    const inventory: OperationInventory = {
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "a",
      pathCount: 1,
      operationCount: 1,
      operationsByMethod: { GET: 1 },
      deprecatedCount: 0,
      operationIdPresentCount: 0,
      operationIdMissingCount: 1,
      operations: [
        {
          sourceFamily: "OZON_SELLER",
          documentKey: "seller-v2",
          snapshotSha256: "a",
          identity: "OZON_SELLER:GET:/x",
          method: "GET",
          path: "/x",
          operationId: null,
          tags: [],
          deprecated: false,
          summaryHash: null,
          securitySchemeReferences: [],
          requestBodyPresent: false,
          parameterCount: 0,
          responseStatusKeys: [],
        },
      ],
    };
    const runtime = {
      sourceFamily: "OZON_SELLER" as const,
      runtimeAlias: "runtime",
      method: "GET",
      normalizedPath: "/runtime-only",
      executionEnabled: false,
      effect: "READ",
      privacyClass: "safe",
      runtimeSafetyClass: null,
      workflowRole: null,
      entitlementKey: null,
      currentness: null,
      blockedReason: null,
      providerMetadata: {},
    };
    const result = buildProductCrosswalk({
      reportId: "r",
      inventory,
      runtimeEntries: [runtime],
    });
    const scoped = result.rows.find((row) => row.sourceIdentity.endsWith("/x"));
    expect(scoped?.documentKey).toBe("seller-v2");
    expect(scoped?.crosswalkId).toMatch(/:DOCUMENT_SCOPE:[0-9a-f]{64}$/);
    expect(scoped!.crosswalkId.length).toBeLessThanOrEqual(520);
    expect(
      result.rows.find((row) => row.crosswalkState === "RUNTIME_ONLY")
        ?.documentKey,
    ).toBeNull();
  });

  it("marks duplicate identities ambiguous and never auto-enables them", () => {
    const inventory = {
      sourceFamily: "WILDBERRIES",
      snapshotSha256: "b",
      pathCount: 1,
      operationCount: 1,
      operationsByMethod: { GET: 1 },
      deprecatedCount: 0,
      operationIdPresentCount: 0,
      operationIdMissingCount: 1,
      operations: [
        {
          sourceFamily: "WILDBERRIES",
          snapshotSha256: "b",
          identity: "WILDBERRIES:GET:/x",
          method: "GET",
          path: "/x",
          operationId: null,
          tags: [],
          deprecated: false,
          summaryHash: null,
          securitySchemeReferences: [],
          requestBodyPresent: false,
          parameterCount: 0,
          responseStatusKeys: [],
        },
      ],
    } as OperationInventory;
    const base = {
      sourceFamily: "WILDBERRIES" as const,
      method: "GET",
      normalizedPath: "/x",
      executionEnabled: true,
      effect: "READ",
      privacyClass: "standard",
      runtimeSafetyClass: null,
      workflowRole: null,
      entitlementKey: null,
      currentness: "current",
      blockedReason: null,
      providerMetadata: {},
    };
    const result = buildProductCrosswalk({
      reportId: "r",
      inventory,
      runtimeEntries: [
        { ...base, runtimeAlias: "a" },
        { ...base, runtimeAlias: "b" },
      ],
    });
    expect(result.rows[0]?.crosswalkState).toBe("AMBIGUOUS_RUNTIME_MAPPING");
    expect(result.rows[0]?.reviewState).toBe("BLOCKING_RISK");
  });
});
