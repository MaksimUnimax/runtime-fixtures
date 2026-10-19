import { describe, expect, it } from "vitest";
import { canonicalSemanticDiff, diffInventories } from "./diff.js";
import { InMemoryApiWatchStore } from "./authority.js";
import type { OperationInventory, OperationInventoryItem } from "./types.js";
import { buildCompleteOperationInventory } from "./inventory.js";

const FAMILY = "OZON_SELLER" as const;
const BASE_SHA = "a".repeat(64);
const TARGET_SHA = "b".repeat(64);

function operation(
  overrides: Partial<OperationInventoryItem> = {},
): OperationInventoryItem {
  const method = overrides.method ?? "GET";
  const path = overrides.path ?? "/items";
  return {
    sourceFamily: FAMILY,
    snapshotSha256: BASE_SHA,
    identity: `${FAMILY}:${method}:${path}`,
    method,
    path,
    operationId: "listItems",
    tags: ["items"],
    deprecated: false,
    summaryHash: "summary-a",
    securitySchemeReferences: ["bearerAuth"],
    requestBodyPresent: false,
    parameterCount: 1,
    responseStatusKeys: ["200"],
    ...overrides,
  };
}

function inventory(
  operations: OperationInventoryItem[],
  snapshotSha256 = BASE_SHA,
): OperationInventory {
  const byMethod: Record<string, number> = {};
  for (const item of operations)
    byMethod[item.method] = (byMethod[item.method] ?? 0) + 1;
  return {
    sourceFamily: FAMILY,
    snapshotSha256,
    pathCount: new Set(operations.map((item) => item.path)).size,
    operationCount: operations.length,
    operationsByMethod: byMethod,
    deprecatedCount: operations.filter((item) => item.deprecated).length,
    operationIdPresentCount: operations.filter(
      (item) => item.operationId !== null,
    ).length,
    operationIdMissingCount: operations.filter(
      (item) => item.operationId === null,
    ).length,
    operations,
  };
}

function compare(
  base: OperationInventoryItem[],
  target: OperationInventoryItem[],
) {
  return diffInventories({
    base: inventory(base, BASE_SHA),
    target: inventory(target, TARGET_SHA),
    createdAt: new Date("2026-09-22T00:00:00Z"),
  });
}

describe("C03 duplicate semantic identity fail-closed", () => {
  it("rejects duplicate identities in the base inventory rather than hiding a removal", () => {
    const duplicated = [
      operation({ operationId: "first" }),
      operation({ operationId: "second" }),
    ];
    expect(() =>
      diffInventories({
        base: inventory(duplicated),
        target: inventory([operation({ operationId: "second" })], TARGET_SHA),
      }),
    ).toThrow("DIFF_DUPLICATE_OPERATION_IDENTITY");
  });

  it("rejects duplicate identities in the target inventory rather than hiding an addition", () => {
    const duplicated = [
      operation({ operationId: "first" }),
      operation({ operationId: "second" }),
    ];
    expect(() =>
      diffInventories({
        base: inventory([operation({ operationId: "first" })]),
        target: inventory(duplicated, TARGET_SHA),
      }),
    ).toThrow("DIFF_DUPLICATE_OPERATION_IDENTITY");
  });
});

// These tests exercise the canonicalizer's fallback ordering when two
// *synthetic* semantic identities share the preceding family/path/method keys.
// buildCompleteOperationInventory constructs sourceFamily:method:path identities
// and cannot emit either pair. These are deliberately non-builder fixtures,
// not evidence of two accepted WB documents with overlapping routes.
describe("C03 canonical fallback order for synthetic semantic identities", () => {
  it("preserves canonical bytes for fabricated equal-key operations in either order", () => {
    const first = operation({
      identity: "SYNTHETIC:A:GET:/orders",
      path: "/orders",
      operationId: "readA",
    });
    const second = operation({
      identity: "SYNTHETIC:B:GET:/orders",
      path: "/orders",
      operationId: "readB",
    });
    const diff = diffInventories({
      base: inventory([]),
      target: inventory([first, second], TARGET_SHA),
      createdAt: new Date("2026-10-19T00:00:00Z"),
    });
    expect(diff.operations).toHaveLength(2);
    expect(
      canonicalSemanticDiff({
        ...diff,
        operations: [...diff.operations].reverse(),
      }),
    ).toEqual(canonicalSemanticDiff(diff));
  });
});

describe("C03 canonical fallback for synthetic Unicode-equivalent identities", () => {
  it("orders fabricated NFC/NFD tie identities by exact code units, not locale collation", () => {
    const firstIdentity = "SYNTHETIC:" + String.fromCharCode(0xc9);
    const secondIdentity = "SYNTHETIC:E" + String.fromCharCode(0x301);
    expect(firstIdentity).not.toEqual(secondIdentity);
    const mk = (identity: string) =>
      operation({
        identity,
        path: "/orders",
      });
    const diff = diffInventories({
      base: inventory([]),
      target: inventory([mk(firstIdentity), mk(secondIdentity)], TARGET_SHA),
      createdAt: new Date("2026-10-19T00:00:00Z"),
    });
    expect(diff.operations).toHaveLength(2);
    expect(
      canonicalSemanticDiff({
        ...diff,
        operations: [...diff.operations].reverse(),
      }),
    ).toEqual(canonicalSemanticDiff(diff));
  });
});

describe("A4 semantic API diffs", () => {
  it("C03 detects requiredness, type, enum, request, response and security changes from OpenAPI", () => {
    const make = (
      schema: unknown,
      responseSchema: unknown,
      security: unknown,
    ) =>
      buildCompleteOperationInventory({
        sourceFamily: FAMILY,
        snapshotSha256: BASE_SHA,
        bytes: Buffer.from(
          JSON.stringify({
            openapi: "3.0.3",
            info: { title: "fixture", version: "1" },
            components: { schemas: { Payload: schema } },
            security: security,
            paths: {
              "/items": {
                post: {
                  requestBody: {
                    required: true,
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/Payload" },
                      },
                    },
                  },
                  responses: {
                    "200": {
                      description: "ok",
                      content: {
                        "application/json": { schema: responseSchema },
                      },
                    },
                  },
                },
              },
            },
          }),
        ),
        filename: "openapi.json",
      }).operations[0]!;
    const base = make(
      {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string", enum: ["a", "b"] } },
      },
      { type: "string" },
      [{ bearer: [] }],
    );
    const cases = [
      make(
        {
          type: "object",
          required: [],
          properties: { id: { type: "string", enum: ["a", "b"] } },
        },
        { type: "string" },
        [{ bearer: [] }],
      ),
      make(
        {
          type: "object",
          required: ["id"],
          properties: { id: { type: "integer", enum: ["a", "b"] } },
        },
        { type: "string" },
        [{ bearer: [] }],
      ),
      make(
        {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "object", properties: { value: { type: "string" } } },
          },
        },
        { type: "string" },
        [{ bearer: [] }],
      ),
      make(
        {
          type: "object",
          required: ["id"],
          properties: { id: { type: "array", items: { type: "string" } } },
        },
        { type: "string" },
        [{ bearer: [] }],
      ),
      make(
        {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", enum: ["a", "c"] } },
        },
        { type: "string" },
        [{ bearer: [] }],
      ),
      make(
        {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", enum: ["a", "b"] },
            extra: { type: "boolean" },
          },
        },
        { type: "string" },
        [{ bearer: [] }],
      ),
      make(
        {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", enum: ["a", "b"] } },
        },
        { type: "integer" },
        [{ bearer: [] }],
      ),
      make(
        {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", enum: ["a", "b"] } },
        },
        { type: "string" },
        [{ apiKey: [] }],
      ),
    ];
    for (const target of cases) {
      const diff = compare([base], [target]);
      expect(diff.operations[0]?.state).toBe("CHANGED");
      expect(diff.operations[0]?.deltas.length).toBeGreaterThan(0);
    }
  });

  it("C03 preserves distinct OpenAPI paths with empty URL segments", () => {
    const make = (paths: Record<string, unknown>, sha256: string) =>
      buildCompleteOperationInventory({
        sourceFamily: FAMILY,
        snapshotSha256: sha256,
        bytes: Buffer.from(
          JSON.stringify({
            openapi: "3.0.3",
            info: { title: "synthetic paths", version: "1" },
            paths,
          }),
        ),
        filename: "openapi.json",
      });
    const operation = (operationId: string) => ({
      get: {
        operationId,
        responses: { "200": { description: "ok" } },
      },
    });
    const base = make({ "/orders/detail": operation("original") }, BASE_SHA);
    const target = make(
      {
        "/orders/detail": operation("original"),
        "/orders//detail": operation("additional"),
      },
      TARGET_SHA,
    );
    expect(base.operationCount).toBe(1);
    expect(target.operationCount).toBe(2);
    expect(target.operations.map((item) => item.identity)).toEqual([
      "OZON_SELLER:GET:/orders//detail",
      "OZON_SELLER:GET:/orders/detail",
    ]);
    const added = diffInventories({ base, target });
    expect(added.addedCount).toBe(1);
    expect(added.unchangedCount).toBe(1);
    expect(added.operations.map((item) => item.state)).toEqual([
      "ADDED",
      "UNCHANGED",
    ]);
    const removed = diffInventories({ base: target, target: base });
    expect(removed.removedCount).toBe(1);
    expect(removed.unchangedCount).toBe(1);
    expect(removed.operations.map((item) => item.state)).toEqual([
      "REMOVED",
      "UNCHANGED",
    ]);
  });

  it("C03 resolves local OpenAPI Path Item refs and detects contract deltas", () => {
    const build = (
      oas: "3.0.3" | "3.1.0",
      status: string,
      referenced: boolean,
      sha256: string,
    ) => {
      const operation = {
        get: {
          operationId: "listOrders",
          responses: { [status]: { description: "synthetic" } },
        },
      };
      const document =
        oas === "3.1.0"
          ? {
              openapi: oas,
              info: { title: "ref", version: "1" },
              components: { pathItems: { Orders: operation } },
              paths: {
                "/orders": referenced
                  ? { $ref: "#/components/pathItems/Orders" }
                  : operation,
              },
            }
          : {
              openapi: oas,
              info: { title: "ref", version: "1" },
              paths: {
                "/prototype": operation,
                "/orders": referenced
                  ? { $ref: "#/paths/~1prototype" }
                  : operation,
              },
            };
      return buildCompleteOperationInventory({
        sourceFamily: FAMILY,
        snapshotSha256: sha256,
        bytes: Buffer.from(JSON.stringify(document)),
        filename: "openapi.json",
      });
    };
    for (const oas of ["3.0.3", "3.1.0"] as const) {
      const inline = build(oas, "200", false, BASE_SHA);
      const base = build(oas, "200", true, BASE_SHA);
      const target = build(oas, "201", true, TARGET_SHA);
      expect(base.operationCount).toBe(inline.operationCount);
      expect(base.operations.find((op) => op.path === "/orders")?.method).toBe(
        "GET",
      );
      const diff = diffInventories({ base, target });
      expect(diff.changedCount).toBe(base.operationCount);
      expect(diff.operations.find((op) => op.path === "/orders")?.state).toBe(
        "CHANGED",
      );
      expect(
        diff.operations.find((op) => op.path === "/orders")?.deltas,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "responseStatusKeys" }),
        ]),
      );
    }
  });

  it("C03 preserves nonconflicting local Path Item reference siblings", () => {
    const inventory = buildCompleteOperationInventory({
      sourceFamily: FAMILY,
      snapshotSha256: BASE_SHA,
      filename: "openapi.json",
      bytes: Buffer.from(
        JSON.stringify({
          openapi: "3.1.0",
          info: { title: "ref siblings", version: "1" },
          components: {
            pathItems: {
              Shared: {
                get: { responses: { "200": { description: "ok" } } },
              },
            },
          },
          paths: {
            "/orders": {
              $ref: "#/components/pathItems/Shared",
              post: { responses: { "204": { description: "ok" } } },
            },
          },
        }),
      ),
    });
    expect(inventory.operations.map((op) => op.method)).toEqual([
      "GET",
      "POST",
    ]);
    expect(inventory.operations.every((op) => op.path === "/orders")).toBe(
      true,
    );
  });

  it("C03 refuses unresolved, recursive, external and overlapping Path Item refs", () => {
    const build = (pathItem: unknown, referenced: unknown = {}) =>
      buildCompleteOperationInventory({
        sourceFamily: FAMILY,
        snapshotSha256: BASE_SHA,
        filename: "openapi.json",
        bytes: Buffer.from(
          JSON.stringify({
            openapi: "3.1.0",
            info: { title: "invalid ref", version: "1" },
            components: { pathItems: { Shared: referenced } },
            paths: { "/orders": pathItem },
          }),
        ),
      });
    expect(() => build({ $ref: "#/components/pathItems/Missing" })).toThrow(
      "APIWATCH_PATH_ITEM_REF_UNRESOLVED",
    );
    expect(() => build({ $ref: "remote.yml#/paths/~1orders" })).toThrow(
      "APIWATCH_PATH_ITEM_REF_UNSUPPORTED",
    );
    expect(() =>
      build(
        { $ref: "#/components/pathItems/Shared" },
        { $ref: "#/components/pathItems/Shared" },
      ),
    ).toThrow("APIWATCH_PATH_ITEM_REF_CYCLE_OR_DEPTH");
    expect(() =>
      build(
        {
          $ref: "#/components/pathItems/Shared",
          get: { responses: { "201": { description: "local" } } },
        },
        { get: { responses: { "200": { description: "ref" } } } },
      ),
    ).toThrow("APIWATCH_PATH_ITEM_REF_CONFLICT");
  });

  it("C03 decodes URI-fragment local Path Item refs but rejects invalid pointer escapes", () => {
    const operation = {
      get: { responses: { "200": { description: "ok" } } },
    };
    const pathItems = Object.fromEntries([
      ["Shared", operation],
      ["Bad~2Name", operation],
      ["__proto__", operation],
      ["constructor", operation],
    ]);
    const build = (ref: string) =>
      buildCompleteOperationInventory({
        sourceFamily: FAMILY,
        snapshotSha256: BASE_SHA,
        filename: "openapi.json",
        bytes: Buffer.from(
          JSON.stringify({
            openapi: "3.1.0",
            info: { title: "pointers", version: "1" },
            components: { pathItems },
            paths: { "/orders": { $ref: ref } },
          }),
        ),
      });
    for (const ref of [
      "#/components/pathItems/Shared",
      "#%2Fcomponents%2FpathItems%2FShared",
      "#/components/pathItems/Bad~02Name",
      "#/components/pathItems/__proto__",
      "#/components/pathItems/constructor",
    ]) {
      expect(build(ref).operations.map((op) => op.path)).toEqual(["/orders"]);
    }
    expect(() => build("#/components/pathItems/Bad~2Name")).toThrow(
      "APIWATCH_PATH_ITEM_REF_INVALID",
    );
    expect(() => build("#/%ZZ")).toThrow("APIWATCH_PATH_ITEM_REF_INVALID");
    expect(() => build("#/components/pathItems/toString")).toThrow(
      "APIWATCH_PATH_ITEM_REF_UNRESOLVED",
    );
  });

  it("C03 retains referenced inline fingerprints and limits local reference depth", () => {
    const shared = {
      parameters: [{ name: "count", in: "query", schema: { type: "integer" } }],
      get: {
        security: [{ bearer: [] }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "string" } },
                },
              },
            },
          },
        },
      },
    };
    const make = (referenced: boolean, sha256: string) =>
      buildCompleteOperationInventory({
        sourceFamily: FAMILY,
        snapshotSha256: sha256,
        filename: "openapi.json",
        bytes: Buffer.from(
          JSON.stringify({
            openapi: "3.1.0",
            info: { title: "hash parity", version: "1" },
            components: {
              pathItems: { Shared: shared },
              securitySchemes: {
                bearer: { type: "http", scheme: "bearer" },
              },
            },
            paths: {
              "/orders": referenced
                ? { $ref: "#/components/pathItems/Shared" }
                : shared,
            },
          }),
        ),
      });
    const inline = make(false, BASE_SHA);
    const referenced = make(true, TARGET_SHA);
    expect(
      diffInventories({ base: inline, target: referenced }).unchangedCount,
    ).toBe(1);
    for (const field of [
      "parameterSchemaSha256",
      "responseSchemaSha256",
      "securityRequirementsSha256",
    ] as const)
      expect(referenced.operations[0]?.[field]).toBe(
        inline.operations[0]?.[field],
      );

    const chain = (pathItems: Record<string, unknown>) =>
      buildCompleteOperationInventory({
        sourceFamily: FAMILY,
        snapshotSha256: BASE_SHA,
        filename: "openapi.json",
        bytes: Buffer.from(
          JSON.stringify({
            openapi: "3.1.0",
            info: { title: "bounded chain", version: "1" },
            components: { pathItems },
            paths: { "/orders": { $ref: "#/components/pathItems/P0" } },
          }),
        ),
      });
    expect(
      chain({
        P0: { $ref: "#/components/pathItems/P1" },
        P1: { get: { responses: { "200": {} } } },
      }).operationCount,
    ).toBe(1);
    const tooDeep = Object.fromEntries(
      Array.from({ length: 66 }, (_, i) => [
        `P${i}`,
        i === 65
          ? { get: { responses: { "200": {} } } }
          : { $ref: `#/components/pathItems/P${i + 1}` },
      ]),
    );
    expect(() => chain(tooDeep)).toThrow(
      "APIWATCH_PATH_ITEM_REF_CYCLE_OR_DEPTH",
    );
  });

  it("C03 rejects a Path Item ref into an unrelated component even with a get key", () => {
    const build = (ref: string, pathItem: Record<string, unknown>) =>
      buildCompleteOperationInventory({
        sourceFamily: FAMILY,
        snapshotSha256: BASE_SHA,
        filename: "openapi.json",
        bytes: Buffer.from(
          JSON.stringify({
            openapi: "3.1.0",
            info: { title: "wrong target", version: "1" },
            components: {
              parameters: {
                get: { name: "count", in: "query" },
              },
              pathItems: {
                Shared: pathItem,
              },
            },
            paths: { "/orders": { $ref: ref } },
          }),
        ),
      });
    expect(() =>
      build("#/components/parameters", {
        get: { responses: { "200": {} } },
      }),
    ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
    expect(() =>
      build("#/components/pathItems/Shared", {
        get: { name: "count", in: "query" },
      }),
    ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
    expect(() =>
      build("#/components/pathItems/Shared", {
        get: { responses: null },
      }),
    ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
    expect(() =>
      build("#/components/pathItems/Shared", {
        name: "not a path item",
      }),
    ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
    expect(
      build("#/components/pathItems/Shared", {
        summary: "permitted",
        get: { responses: { "200": {} } },
        "x-reference": true,
      }).operations.map((operation) => operation.method),
    ).toEqual(["GET"]);
  });

  it("C03 detects response-level local ref target changes", () => {
    const build = (responseSchema: unknown) =>
      buildCompleteOperationInventory({
        sourceFamily: FAMILY,
        snapshotSha256: BASE_SHA,
        bytes: Buffer.from(
          JSON.stringify({
            openapi: "3.0.3",
            info: { title: "x", version: "1" },
            components: {
              responses: {
                Item: {
                  description: "item",
                  content: {
                    "application/json": { schema: responseSchema },
                  },
                },
              },
            },
            paths: {
              "/x": {
                get: {
                  responses: {
                    "200": { $ref: "#/components/responses/Item" },
                  },
                },
              },
            },
          }),
        ),
        filename: "openapi.json",
      }).operations[0]!;
    const result = compare(
      [build({ type: "string" })],
      [build({ type: "integer" })],
    );
    expect(result.operations[0]?.state).toBe("CHANGED");
    expect(result.operations[0]?.deltas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "responseSchemaSha256" }),
      ]),
    );
  });

  it("C03 ignores schema descriptions, object key order, and enum order", () => {
    const build = (schema: unknown) =>
      buildCompleteOperationInventory({
        sourceFamily: FAMILY,
        snapshotSha256: BASE_SHA,
        bytes: Buffer.from(
          JSON.stringify({
            openapi: "3.0.3",
            info: { title: "x", version: "1" },
            paths: {
              "/x": {
                get: {
                  parameters: [{ in: "query", name: "q", schema }],
                  responses: { "200": {} },
                },
              },
            },
          }),
        ),
        filename: "openapi.json",
      }).operations[0]!;
    expect(
      compare(
        [build({ type: "string", enum: ["a", "b"], description: "one" })],
        [build({ description: "two", enum: ["b", "a"], type: "string" })],
      ).operations[0]?.state,
    ).toBe("UNCHANGED");
  });
  it("A4-01 identical inventories are all UNCHANGED", () => {
    const diff = compare([operation()], [operation()]);
    expect(diff.unchangedCount).toBe(1);
    expect(diff.operations[0]?.state).toBe("UNCHANGED");
  });

  it("A4-02 detects an added GET operation", () => {
    const diff = compare([], [operation()]);
    expect(diff.addedCount).toBe(1);
    expect(diff.operations[0]?.state).toBe("ADDED");
  });

  it("A4-03 detects a removed GET operation", () => {
    const diff = compare([operation()], []);
    expect(diff.removedCount).toBe(1);
    expect(diff.operations[0]?.state).toBe("REMOVED");
  });

  it("A4-04 treats an operationId rename as CHANGED", () => {
    const diff = compare(
      [operation()],
      [operation({ operationId: "renamed" })],
    );
    expect(diff.changedCount).toBe(1);
    expect(diff.operations[0]?.deltas).toContainEqual({
      field: "operationId",
      before: "listItems",
      after: "renamed",
    });
  });

  it("A4-05 detects deprecated false to true", () => {
    const diff = compare([operation()], [operation({ deprecated: true })]);
    expect(diff.operations[0]?.deltas).toContainEqual({
      field: "deprecated",
      before: false,
      after: true,
    });
  });

  it("A4-06 detects a tag addition", () => {
    const diff = compare(
      [operation()],
      [operation({ tags: ["items", "seller"] })],
    );
    expect(diff.operations[0]?.state).toBe("CHANGED");
  });

  it("A4-07 ignores tag ordering", () => {
    const diff = compare(
      [operation({ tags: ["items", "seller"] })],
      [operation({ tags: ["seller", "items"] })],
    );
    expect(diff.operations[0]?.state).toBe("UNCHANGED");
  });

  it("A4-08 detects a security reference addition", () => {
    const diff = compare(
      [operation()],
      [operation({ securitySchemeReferences: ["bearerAuth", "sellerAuth"] })],
    );
    expect(diff.operations[0]?.state).toBe("CHANGED");
  });

  it("A4-09 ignores security reference ordering", () => {
    const diff = compare(
      [operation({ securitySchemeReferences: ["a", "b"] })],
      [operation({ securitySchemeReferences: ["b", "a"] })],
    );
    expect(diff.operations[0]?.state).toBe("UNCHANGED");
  });

  it("A4-10 detects request-body absence to presence", () => {
    const diff = compare(
      [operation()],
      [operation({ requestBodyPresent: true })],
    );
    expect(diff.operations[0]?.state).toBe("CHANGED");
  });

  it("A4-11 detects a parameter-count change", () => {
    const diff = compare([operation()], [operation({ parameterCount: 2 })]);
    expect(diff.operations[0]?.state).toBe("CHANGED");
  });

  it("A4-12 detects a response status addition", () => {
    const diff = compare(
      [operation()],
      [operation({ responseStatusKeys: ["200", "201"] })],
    );
    expect(diff.operations[0]?.state).toBe("CHANGED");
  });

  it("A4-13 detects a response status removal", () => {
    const diff = compare(
      [operation({ responseStatusKeys: ["200", "404"] })],
      [operation({ responseStatusKeys: ["200"] })],
    );
    expect(diff.operations[0]?.state).toBe("CHANGED");
  });

  it("A4-14 ignores response status ordering", () => {
    const diff = compare(
      [operation({ responseStatusKeys: ["200", "404"] })],
      [operation({ responseStatusKeys: ["404", "200"] })],
    );
    expect(diff.operations[0]?.state).toBe("UNCHANGED");
  });

  it("A4-15 treats a method change as REMOVE plus ADD", () => {
    const diff = compare(
      [operation()],
      [operation({ method: "POST", identity: `${FAMILY}:POST:/items` })],
    );
    expect(diff.removedCount).toBe(1);
    expect(diff.addedCount).toBe(1);
  });

  it("A4-16 treats a path change as REMOVE plus ADD", () => {
    const diff = compare(
      [operation()],
      [operation({ path: "/orders", identity: `${FAMILY}:GET:/orders` })],
    );
    expect(diff.removedCount).toBe(1);
    expect(diff.addedCount).toBe(1);
  });

  it("A4-17 rejects comparison across source families", () => {
    expect(() =>
      diffInventories({
        base: inventory([operation()]),
        target: { ...inventory([operation()]), sourceFamily: "WILDBERRIES" },
      }),
    ).toThrow("DIFF_SOURCE_FAMILY_MISMATCH");
  });

  it("A4-18 compares complete volume without truncation", () => {
    const operations = Array.from({ length: 100 }, (_, index) =>
      operation({
        path: `/items/${index}`,
        identity: `${FAMILY}:GET:/items/${index}`,
      }),
    );
    const diff = compare([], operations);
    expect(diff.operations).toHaveLength(100);
    expect(diff.addedCount).toBe(100);
  });

  it("A4-19 canonical ordering is independent of input order", () => {
    const first = [
      operation(),
      operation({ path: "/orders", identity: `${FAMILY}:GET:/orders` }),
    ];
    const second = [...first].reverse();
    expect(
      compare(first, second).operations.map((item) => item.identity),
    ).toEqual(
      [
        ...compare(second, first).operations.map((item) => item.identity),
      ].sort(),
    );
  });

  it("A4-20 generates a deterministic DIFF_SHA256", () => {
    const first = compare(
      [operation()],
      [operation({ operationId: "renamed" })],
    );
    const second = compare(
      [operation()],
      [operation({ operationId: "renamed" })],
    );
    expect(first.diffSha256).toBe(second.diffSha256);
  });

  it("A4-21 persists the same diff idempotently", async () => {
    const diff = compare(
      [operation()],
      [operation({ operationId: "renamed" })],
    );
    const store = new InMemoryApiWatchStore();
    const one = await store.saveSemanticDiff(diff);
    const two = await store.saveSemanticDiff({
      ...diff,
      createdAt: new Date("2027-01-01T00:00:00Z"),
    });
    expect(two.createdAt).toEqual(one.createdAt);
    expect(
      await store.findSemanticDiff(
        FAMILY,
        BASE_SHA,
        TARGET_SHA,
        diff.diffSha256,
      ),
    ).toEqual(one);
  });

  it("A4-22 persists normalized metadata and no raw Swagger body", async () => {
    const diff = compare(
      [operation()],
      [operation({ operationId: "renamed" })],
    );
    const stored = await new InMemoryApiWatchStore().saveSemanticDiff(diff);
    expect(JSON.stringify(stored)).not.toContain("responses");
    expect(JSON.stringify(stored)).not.toContain("description");
  });
});
