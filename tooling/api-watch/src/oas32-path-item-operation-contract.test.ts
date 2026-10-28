import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";

const operation = (id: string) => ({
  operationId: id,
  responses: { "200": { description: "ok" } },
});
const pathParameter = {
  name: "token",
  in: "header",
  schema: { type: "string" },
};

type Source = "inline" | "components" | "paths";
function inventory(
  item: Record<string, unknown>,
  version = "3.2.0",
  source: Source = "inline",
) {
  const shared = source === "paths" ? { "/shared": item } : {};
  const root = {
    openapi: version,
    info: { title: "OAS32 Path Item method contract", version: "1" },
    ...(source === "components"
      ? { components: { pathItems: { Shared: item } } }
      : {}),
    paths: {
      ...shared,
      "/items":
        source === "components"
          ? { $ref: "#/components/pathItems/Shared" }
          : source === "paths"
            ? { $ref: "#/paths/~1shared" }
            : item,
    },
  };
  const result = buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: "a".repeat(64),
    filename: "oas32-methods.json",
    bytes: Buffer.from(JSON.stringify(root)),
  });
  return result.operations.filter((op) => op.path === "/items");
}

const allMethods = {
  parameters: [pathParameter],
  get: operation("getItems"),
  query: operation("queryItems"),
  additionalOperations: {
    COPY: operation("copyItems"),
    LINK: operation("linkItems"),
  },
};

describe("C03 OAS 3.2 Path Item QUERY/additionalOperations inventory parity", () => {
  it.each(["inline", "components", "paths"] as const)(
    "inventories all four distinct operations and common parameters via %s",
    (source) => {
      const ops = inventory(allMethods, "3.2.0", source);
      expect(ops.map((op) => op.method)).toEqual([
        "GET",
        "QUERY",
        "COPY",
        "LINK",
      ]);
      expect(ops.map((op) => op.operationId)).toEqual([
        "getItems",
        "queryItems",
        "copyItems",
        "linkItems",
      ]);
      expect(ops.map((op) => op.parameterCount)).toEqual([1, 1, 1, 1]);
      expect(new Set(ops.map((op) => op.identity)).size).toBe(4);
    },
  );

  it("preserves case-sensitive custom HTTP method identity", () => {
    const ops = inventory({
      get: operation("getItems"),
      additionalOperations: { "m-SEARCH": operation("searchItems") },
    });
    expect(ops.map((op) => op.method)).toEqual(["GET", "m-SEARCH"]);
    expect(ops[1]?.identity).toContain(":m-SEARCH:/items");
  });

  it.each(["inline", "components"] as const)(
    "rejects an invalid QUERY Operation Object via %s",
    (source) => {
      expect(() =>
        inventory({ get: operation("get"), query: {} }, "3.2.0", source),
      ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
    },
  );

  it.each(["inline", "components"] as const)(
    "rejects malformed additionalOperations containers via %s",
    (source) => {
      for (const extra of [null, [], "COPY", 12]) {
        expect(() =>
          inventory(
            { get: operation("get"), additionalOperations: extra },
            "3.2.0",
            source,
          ),
        ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
      }
    },
  );

  it.each(["inline", "components"] as const)(
    "rejects an invalid mapped operation and non-HTTP-token key via %s",
    (source) => {
      expect(() =>
        inventory(
          { get: operation("get"), additionalOperations: { COPY: {} } },
          "3.2.0",
          source,
        ),
      ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
      expect(() =>
        inventory(
          {
            get: operation("get"),
            additionalOperations: { "bad method": operation("bad") },
          },
          "3.2.0",
          source,
        ),
      ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
    },
  );

  it.each(["inline", "components"] as const)(
    "refuses fixed HTTP method collisions hidden in additionalOperations via %s",
    (source) => {
      for (const forbidden of ["GET", "post", "QUERY"]) {
        expect(() =>
          inventory(
            {
              get: operation("get"),
              additionalOperations: { [forbidden]: operation("duplicate") },
            },
            "3.2.0",
            source,
          ),
        ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
      }
    },
  );

  it.each(["3.0.3", "3.1.2"] as const)(
    "does not silently consume 3.2-only fields in OpenAPI %s",
    (version) => {
      for (const source of ["inline", "components"] as const) {
        const pathItem = { get: operation("get"), query: operation("query") };
        // components.pathItems does not exist in 3.0, so use #/paths there.
        const loc =
          version === "3.0.3" && source === "components" ? "paths" : source;
        expect(() => inventory(pathItem, version, loc)).toThrow(
          "APIWATCH_PATH_ITEM_REF_INVALID_TARGET",
        );
        expect(() =>
          inventory(
            {
              get: operation("get"),
              additionalOperations: { COPY: operation("copy") },
            },
            version,
            loc,
          ),
        ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
      }
    },
  );

  it("continues to allow legal fixed GET without 3.2 additions in 3.1", () => {
    expect(
      inventory({ get: operation("get") }, "3.1.2", "components"),
    ).toHaveLength(1);
  });

  it("rejects a referenced $ref sibling with conflicting QUERY", () => {
    const item = { query: operation("base") };
    const doc = {
      openapi: "3.2.0",
      info: { title: "reference sibling", version: "1" },
      components: { pathItems: { Shared: item } },
      paths: {
        "/items": {
          $ref: "#/components/pathItems/Shared",
          query: operation("conflict"),
        },
      },
    };
    expect(() =>
      buildCompleteOperationInventory({
        sourceFamily: "OZON_SELLER",
        snapshotSha256: "a".repeat(64),
        filename: "collision.json",
        bytes: Buffer.from(JSON.stringify(doc)),
      }),
    ).toThrow("APIWATCH_PATH_ITEM_REF_CONFLICT");
  });
});
