import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";
import { diffInventories } from "./diff.js";
import { inventoryIdentity, productIdentity } from "./product-registry.js";

function snapshot(pathItem: Record<string, unknown>, hash: string) {
  const root = {
    openapi: "3.2.0",
    info: { title: "method case", version: "1" },
    paths: { "/items": pathItem },
  };
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: hash.repeat(64),
    filename: "method-case.json",
    bytes: Buffer.from(JSON.stringify(root)),
  });
}
const methodOperation = {
  operationId: "customSearch",
  responses: { "200": { description: "ok" } },
};

describe("C03 OAS3.2 custom HTTP methods remain case-sensitive in consumers", () => {
  it("preserves exact wire method spelling through the semantic diff", () => {
    const base = snapshot({}, "a");
    const target = snapshot(
      { additionalOperations: { "m-SEARCH": methodOperation } },
      "b",
    );
    expect(target.operations[0]?.method).toBe("m-SEARCH");
    const result = diffInventories({
      base,
      target,
      createdAt: new Date("2026-10-28T00:00:00Z"),
    });
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]?.after?.method).toBe("m-SEARCH");
    expect(result.methodCountsAfter["m-SEARCH"]).toBe(1);
  });

  it("preserves custom capitalization in registry and inventory identity", () => {
    expect(
      productIdentity({
        sourceFamily: "OZON_SELLER",
        method: "m-SEARCH",
        normalizedPath: "/items",
      }),
    ).toBe("OZON_SELLER:m-SEARCH:/items");
    expect(
      inventoryIdentity({
        sourceFamily: "OZON_SELLER",
        method: "m-SEARCH",
        path: "/items",
      }),
    ).toBe("OZON_SELLER:m-SEARCH:/items");
  });

  it("keeps legacy standard methods and fixed QUERY case-normalized", () => {
    for (const method of ["get", "GET"]) {
      expect(
        productIdentity({
          sourceFamily: "OZON_SELLER",
          method,
          normalizedPath: "/items",
        }),
      ).toBe("OZON_SELLER:GET:/items");
    }
    expect(
      inventoryIdentity({
        sourceFamily: "OZON_SELLER",
        method: "query",
        path: "/items",
      }),
    ).toBe("OZON_SELLER:QUERY:/items");
  });
});
