import { describe, expect, it } from "vitest";
import { diffInventories } from "./diff.js";
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
