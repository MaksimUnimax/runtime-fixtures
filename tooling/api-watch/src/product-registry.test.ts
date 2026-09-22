import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildProductCrosswalk, extractProductRegistry, productIdentity } from "./product-registry.js";
import type { OperationInventory } from "./types.js";

describe("A7 product registry crosswalk", () => {
  it("statically extracts the current Ozon registries by provider", async () => {
    const seller = await extractProductRegistry({ sourceFamily: "OZON_SELLER" });
    const performance = await extractProductRegistry({ sourceFamily: "OZON_PERFORMANCE" });
    expect(seller.length).toBeGreaterThan(0);
    expect(performance.length).toBeGreaterThan(0);
    expect(seller.every((row) => row.providerMetadata.provider === "seller_api")).toBe(true);
    expect(performance.every((row) => row.providerMetadata.provider === "performance_api")).toBe(true);
  });

  it("statically extracts the pinned WB registry without evaluating JavaScript", async () => {
    const rows = await extractProductRegistry({ sourceFamily: "WILDBERRIES" });
    expect(rows.length).toBeGreaterThan(0);
    const source = await readFile(new URL("../../../migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/\beval\s*\(|\bFunction\s*\(|vm\.runIn/);
  });

  it("uses source family + method + path rather than alias", () => {
    const inventory: OperationInventory = {
      sourceFamily: "OZON_SELLER", snapshotSha256: "a", pathCount: 1, operationCount: 1,
      operationsByMethod: { GET: 1 }, deprecatedCount: 0, operationIdPresentCount: 0, operationIdMissingCount: 1,
      operations: [{ sourceFamily: "OZON_SELLER", snapshotSha256: "a", identity: "OZON_SELLER:GET:/x", method: "GET", path: "/x", operationId: null, tags: [], deprecated: false, summaryHash: null, securitySchemeReferences: [], requestBodyPresent: false, parameterCount: 0, responseStatusKeys: [] }],
    };
    const result = buildProductCrosswalk({ reportId: "r", inventory, runtimeEntries: [{ sourceFamily: "OZON_SELLER", runtimeAlias: "different", method: "GET", normalizedPath: "/x", executionEnabled: true, effect: "READ", privacyClass: "safe", runtimeSafetyClass: null, workflowRole: null, entitlementKey: null, currentness: "current", blockedReason: null, providerMetadata: {} }] });
    expect(result.rows[0]?.crosswalkState).toBe("MAPPED_ENABLED");
    expect(productIdentity({ sourceFamily: "OZON_SELLER", method: "GET", normalizedPath: "/x" })).toBe("OZON_SELLER:GET:/x");
  });

  it("marks duplicate identities ambiguous and never auto-enables them", () => {
    const inventory = { sourceFamily: "WILDBERRIES", snapshotSha256: "b", pathCount: 1, operationCount: 1, operationsByMethod: { GET: 1 }, deprecatedCount: 0, operationIdPresentCount: 0, operationIdMissingCount: 1, operations: [{ sourceFamily: "WILDBERRIES", snapshotSha256: "b", identity: "WILDBERRIES:GET:/x", method: "GET", path: "/x", operationId: null, tags: [], deprecated: false, summaryHash: null, securitySchemeReferences: [], requestBodyPresent: false, parameterCount: 0, responseStatusKeys: [] }] } as OperationInventory;
    const base = { sourceFamily: "WILDBERRIES" as const, method: "GET", normalizedPath: "/x", executionEnabled: true, effect: "READ", privacyClass: "standard", runtimeSafetyClass: null, workflowRole: null, entitlementKey: null, currentness: "current", blockedReason: null, providerMetadata: {} };
    const result = buildProductCrosswalk({ reportId: "r", inventory, runtimeEntries: [{ ...base, runtimeAlias: "a" }, { ...base, runtimeAlias: "b" }] });
    expect(result.rows[0]?.crosswalkState).toBe("AMBIGUOUS_RUNTIME_MAPPING");
    expect(result.rows[0]?.reviewState).toBe("BLOCKING_RISK");
  });
});
