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

describe("local references respect schema position and dialect", () => {
  function referenced(
    siblings: Record<string, unknown>,
    slot: "request" | "response" | "parameter",
    version = "3.1.0",
  ) {
    return inventory({}, slot, {
      openapi: version,
      components: {
        schemas: {
          Payload: { $ref: "#/components/schemas/Base", ...siblings },
          Base: { type: "string" },
        },
      },
    });
  }

  it.each(["request", "response", "parameter"] as const)(
    "detects OpenAPI3.1 ref sibling constraints in %s",
    (slot) => {
      expect(
        state(
          referenced({ maxLength: 10 }, slot),
          referenced({ maxLength: 20 }, slot),
        ),
      ).toBe("CHANGED");
    },
  );

  it.each(["3.0.3", "3.1.0"])(
    "ignores documentation beside a schema ref in %s",
    (version) => {
      expect(
        state(
          referenced({}, "request", version),
          referenced({ description: "new explanation" }, "request", version),
        ),
      ).toBe("UNCHANGED");
    },
  );

  it("keeps the OpenAPI3.0 reference sibling rule", () => {
    expect(
      state(
        referenced({ maxLength: 10 }, "request", "3.0.3"),
        referenced({ maxLength: 20 }, "request", "3.0.3"),
      ),
    ).toBe("UNCHANGED");
  });

  it.each(["default", "enum"])(
    "does not dereference literal $ref keys inside %s",
    (keyword) => {
      const make = (type: string) =>
        inventory({}, "request", {
          components: {
            schemas: {
              Payload: {
                type: "object",
                [keyword]:
                  keyword === "enum"
                    ? [{ $ref: "#/components/schemas/Unused" }]
                    : { $ref: "#/components/schemas/Unused" },
              },
              Unused: { type },
            },
          },
        });
      expect(state(make("string"), make("integer"))).toBe("UNCHANGED");
    },
  );

  it("detects different literal ref strings even when the named schemas are equal", () => {
    const make = (name: string) =>
      inventory({}, "request", {
        components: {
          schemas: {
            Payload: {
              type: "object",
              enum: [{ $ref: "#/components/schemas/" + name }],
            },
            A: { type: "string" },
            B: { type: "string" },
          },
        },
      });
    expect(state(make("A"), make("B"))).toBe("CHANGED");
  });

  it("does not interpret OpenAPI3.1 non-schema Reference Object siblings as constraints", () => {
    const make = (required: boolean) =>
      inventory({}, "request", {
        openapi: "3.1.0",
        components: {
          requestBodies: {
            Body: {
              required: false,
              content: { "application/json": { schema: { type: "string" } } },
            },
          },
        },
        paths: {
          "/items": {
            post: {
              requestBody: {
                $ref: "#/components/requestBodies/Body",
                required,
              },
              responses: { "200": { description: "ok" } },
            },
          },
        },
      });
    expect(state(make(true), make(false))).toBe("UNCHANGED");
  });
  it("keeps sibling constraints on recursive OpenAPI3.1 schema edges", () => {
    const make = (maxProperties: number) =>
      inventory({}, "request", {
        openapi: "3.1.0",
        components: {
          schemas: {
            Payload: {
              type: "object",
              properties: {
                next: { $ref: "#/components/schemas/Payload", maxProperties },
              },
            },
          },
        },
      });
    expect(state(make(10), make(20))).toBe("CHANGED");
  });

  it("keeps Swagger2 body default values literal", () => {
    const make = (name: string) =>
      inventory({}, "request", {
        openapi: undefined,
        swagger: "2.0",
        definitions: {
          Payload: {
            type: "object",
            default: { $ref: "#/definitions/" + name },
          },
          A: { type: "string" },
          B: { type: "string" },
        },
        paths: {
          "/items": {
            post: {
              parameters: [
                {
                  name: "payload",
                  in: "body",
                  schema: { $ref: "#/definitions/Payload" },
                },
              ],
              responses: { "200": { description: "ok" } },
            },
          },
        },
      });
    expect(state(make("A"), make("B"))).toBe("CHANGED");
  });
});
