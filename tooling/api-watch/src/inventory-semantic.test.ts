import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";
import { diffInventories } from "./diff.js";

function inventory(
  schema: unknown,
  slot: "request" | "response" | "parameter" = "request",
  extra: Record<string, unknown> = {},
) {
  const content = {
    "application/json": { schema: { $ref: "#/components/schemas/Payload" } },
  };
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: "a".repeat(64),
    filename: "schema.json",
    bytes: Buffer.from(
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "fixture", version: "1" },
        components: { schemas: { Payload: schema } },
        paths: {
          "/items": {
            post: {
              ...(slot === "request" ? { requestBody: { content } } : {}),
              ...(slot === "parameter"
                ? {
                    parameters: [
                      {
                        in: "query",
                        name: "filter",
                        schema: { $ref: "#/components/schemas/Payload" },
                      },
                    ],
                  }
                : {}),
              responses: {
                "200": {
                  description: "ok",
                  ...(slot === "response" ? { content } : {}),
                },
              },
            },
          },
        },
        ...extra,
      }),
    ),
  });
}

function state(
  before: ReturnType<typeof inventory>,
  after: ReturnType<typeof inventory>,
) {
  return diffInventories({ base: before, target: after }).operations[0]!.state;
}

describe("semantic field names versus schema annotations", () => {
  for (const slot of ["request", "response", "parameter"] as const) {
    it.each(["description", "example", "examples", "__proto__"])(
      "detects a real %s field change in " + slot,
      (name) => {
        const schema = (type: string) => ({
          type: "object",
          properties: Object.fromEntries([[name, { type }]]),
        });
        expect(
          state(
            inventory(schema("string"), slot),
            inventory(schema("integer"), slot),
          ),
        ).toBe("CHANGED");
      },
    );
  }

  it.each(["default", "enum"])(
    "preserves meaningful object keys inside %s values",
    (keyword) => {
      const schema = (text: string) => ({
        type: "object",
        [keyword]:
          keyword === "enum" ? [{ description: text }] : { description: text },
      });
      expect(state(inventory(schema("one")), inventory(schema("two")))).toBe(
        "CHANGED",
      );
    },
  );

  it("still ignores descriptions and examples on schema nodes, including named fields", () => {
    const schema = (text: string) => ({
      type: "object",
      description: text,
      example: { description: text },
      properties: {
        description: { type: "string", description: text, example: text },
      },
    });
    expect(state(inventory(schema("one")), inventory(schema("two")))).toBe(
      "UNCHANGED",
    );
  });

  it("keeps equivalent literal enum values stable across key and enum ordering", () => {
    expect(
      state(
        inventory({
          enum: [{ description: "a", id: 1 }, { description: "b" }],
        }),
        inventory({
          enum: [{ description: "b" }, { id: 1, description: "a" }],
        }),
      ),
    ).toBe("UNCHANGED");
  });

  it.each(["description", "example", "examples"])(
    "preserves a security scheme named %s",
    (name) => {
      const extra = (header: string, scope = "read") => ({
        security: [{ [name]: [scope] }],
        components: {
          schemas: { Payload: { type: "string" } },
          securitySchemes: {
            [name]: {
              type: "oauth2",
              flows: {
                clientCredentials: {
                  tokenUrl: `https://example.invalid/${header}`,
                  scopes: { read: "Read", write: "Write" },
                },
              },
            },
          },
        },
      });
      expect(
        state(
          inventory({}, "request", extra("X-A")),
          inventory({}, "request", extra("X-B")),
        ),
      ).toBe("CHANGED");
      expect(
        state(
          inventory({}, "request", extra("X-A", "read")),
          inventory({}, "request", extra("X-A", "write")),
        ),
      ).toBe("CHANGED");
    },
  );

  it("still ignores security scheme documentation", () => {
    const extra = (description: string) => ({
      security: [{ bearer: [] }],
      components: {
        schemas: { Payload: {} },
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer", description },
        },
      },
    });
    expect(
      state(
        inventory({}, "request", extra("one")),
        inventory({}, "request", extra("two")),
      ),
    ).toBe("UNCHANGED");
  });
});
