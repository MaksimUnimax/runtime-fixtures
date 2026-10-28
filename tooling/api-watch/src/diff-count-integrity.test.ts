import { describe, expect, it } from "vitest";
import { diffInventories } from "./diff.js";
import type { OperationInventory, OperationInventoryItem } from "./types.js";

const family = "OZON_SELLER" as const;
const operation: OperationInventoryItem = {
  sourceFamily: family,
  snapshotSha256: "a".repeat(64),
  identity: "OZON_SELLER:GET:/orders",
  method: "GET",
  path: "/orders",
  operationId: "getOrders",
  tags: ["orders"],
  deprecated: false,
  summaryHash: null,
  securitySchemeReferences: ["sellerAuth"],
  requestBodyPresent: false,
  parameterCount: 0,
  responseStatusKeys: ["200"],
};
function inventory(sha: string): OperationInventory {
  return {
    sourceFamily: family,
    snapshotSha256: sha,
    pathCount: 1,
    operationCount: 1,
    operationsByMethod: { GET: 1 },
    deprecatedCount: 0,
    operationIdPresentCount: 1,
    operationIdMissingCount: 0,
    operations: [{ ...operation, snapshotSha256: sha }],
  };
}

describe("C03 fail closed on inconsistent declared inventory operation count", () => {
  it("rejects base count smaller than the actual operations", () => {
    const base = inventory("a".repeat(64));
    const target = inventory("b".repeat(64));
    base.operationCount = 0;
    expect(() => diffInventories({ base, target })).toThrow(
      "DIFF_INVENTORY_COUNT_MISMATCH",
    );
  });
  it("rejects target count larger than actual operations", () => {
    const base = inventory("a".repeat(64));
    const target = inventory("b".repeat(64));
    target.operationCount = 2;
    expect(() => diffInventories({ base, target })).toThrow(
      "DIFF_INVENTORY_COUNT_MISMATCH",
    );
  });
  it("preserves the unchanged valid inventory path", () => {
    const base = inventory("a".repeat(64));
    const target = inventory("b".repeat(64));
    expect(base.operations[0]!.snapshotSha256).toBe(base.snapshotSha256);
    expect(target.operations[0]!.snapshotSha256).toBe(target.snapshotSha256);
    const result = diffInventories({ base, target });
    expect(result.baseOperationCount).toBe(1);
    expect(result.targetOperationCount).toBe(1);
    expect(result.unchangedCount).toBe(1);
  });
});
