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

describe("OpenAPI path/operation parameter overrides", () => {
  const make = (
    pathType: string,
    overrideType: string,
    pageType = "integer",
    referenced = false,
  ) =>
    buildCompleteOperationInventory({
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "c".repeat(64),
      filename: "path-override.json",
      bytes: Buffer.from(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "override", version: "1" },
          ...(referenced
            ? {
                components: {
                  parameters: {
                    PathId: {
                      name: "id",
                      in: "path",
                      required: true,
                      schema: { type: pathType },
                    },
                    OperationId: {
                      name: "id",
                      in: "path",
                      required: true,
                      schema: { type: overrideType },
                    },
                  },
                },
              }
            : {}),
          paths: {
            "/items/{id}": {
              parameters: [
                referenced
                  ? { $ref: "#/components/parameters/PathId" }
                  : {
                      name: "id",
                      in: "path",
                      required: true,
                      schema: { type: pathType },
                    },
                {
                  name: "page",
                  in: "query",
                  schema: { type: pageType },
                },
              ],
              get: {
                operationId: "getItems",
                parameters: [
                  referenced
                    ? { $ref: "#/components/parameters/OperationId" }
                    : {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: { type: overrideType },
                      },
                ],
                responses: { "200": { description: "OK" } },
              },
            },
          },
        }),
      ),
    });

  it("does not report a breaking change to a shadowed path parameter", () => {
    const before = make("string", "integer");
    const after = make("boolean", "integer");
    expect(state(before, after)).toBe("UNCHANGED");
    expect(before.operations[0]!.parameterCount).toBe(2);
    expect(after.operations[0]!.parameterCount).toBe(2);
    expect(after.operations[0]!.parameterSchemaSha256).toBe(
      before.operations[0]!.parameterSchemaSha256,
    );
  });

  it("still detects effective operation overrides and inherited parameter changes", () => {
    expect(state(make("string", "integer"), make("string", "string"))).toBe(
      "CHANGED",
    );
    expect(
      state(make("string", "integer"), make("string", "integer", "string")),
    ).toBe("CHANGED");
  });

  it("resolves referenced parameters before matching override identities", () => {
    const before = make("string", "integer", "integer", true);
    const after = make("boolean", "integer", "integer", true);
    expect(state(before, after)).toBe("UNCHANGED");
    expect(before.operations[0]!.parameterCount).toBe(2);
  });

  it("retains different locations with the same name as separate parameters", () => {
    const baseline = make("string", "integer");
    const withQueryId = buildCompleteOperationInventory({
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "d".repeat(64),
      filename: "different-location.json",
      bytes: Buffer.from(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "override", version: "1" },
          paths: {
            "/items/{id}": {
              parameters: [
                {
                  name: "id",
                  in: "path",
                  required: true,
                  schema: { type: "string" },
                },
                { name: "page", in: "query", schema: { type: "integer" } },
              ],
              get: {
                operationId: "getItems",
                parameters: [
                  {
                    name: "id",
                    in: "path",
                    required: true,
                    schema: { type: "integer" },
                  },
                  { name: "id", in: "query", schema: { type: "string" } },
                ],
                responses: { "200": { description: "OK" } },
              },
            },
          },
        }),
      ),
    });
    expect(withQueryId.operations[0]!.parameterCount).toBe(3);
    expect(state(baseline, withQueryId)).toBe("CHANGED");
  });

  it("recognizes a Swagger 2 referenced body parameter", () => {
    const result = buildCompleteOperationInventory({
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "e".repeat(64),
      filename: "referenced-body.json",
      bytes: Buffer.from(
        JSON.stringify({
          swagger: "2.0",
          info: { title: "body", version: "1" },
          parameters: {
            Payload: {
              name: "body",
              in: "body",
              required: true,
              schema: {
                type: "object",
                properties: { id: { type: "string" } },
              },
            },
          },
          paths: {
            "/items": {
              post: {
                parameters: [{ $ref: "#/parameters/Payload" }],
                responses: { "200": { description: "OK" } },
              },
            },
          },
        }),
      ),
    });
    expect(result.operations[0]!.requestBodyPresent).toBe(true);
    expect(result.operations[0]!.requestSchemaSha256).toBeTruthy();
    expect(result.operations[0]!.parameterCount).toBe(1);
  });
});

describe("Parameter Object default-false equivalence", () => {
  const source = (options: {
    field?: string;
    value?: unknown;
    location?: "query" | "path" | "header" | "cookie";
    swagger2?: boolean;
  }) => {
    const location = options.location ?? "query";
    const parameter: Record<string, unknown> = {
      name: "page",
      in: location,
      schema: { type: "array", items: { type: "integer" } },
    };
    if (location === "path") parameter.required = true;
    if (options.field) parameter[options.field] = options.value;
    const operation = {
      operationId: "getItems",
      parameters: [parameter],
      responses: { "200": { description: "OK" } },
    };
    const document = {
      ...(options.swagger2 ? { swagger: "2.0" } : { openapi: "3.0.3" }),
      info: { title: "default-false", version: "1" },
      paths: {
        [location === "path" ? "/items/{page}" : "/items"]: { get: operation },
      },
    };
    return buildCompleteOperationInventory({
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "f".repeat(64),
      filename: "default-false.json",
      bytes: Buffer.from(JSON.stringify(document)),
    });
  };

  for (const field of [
    "required",
    "deprecated",
    "allowEmptyValue",
    "allowReserved",
  ]) {
    it(`treats omitted versus explicit ${field}: false as equivalent for a query parameter`, () => {
      const before = source({});
      const after = source({ field, value: false });
      expect(state(before, after)).toBe("UNCHANGED");
      expect(after.operations[0]!.parameterSchemaSha256).toBe(
        before.operations[0]!.parameterSchemaSha256,
      );
    });

    it(`still detects ${field}: true as an actual change`, () => {
      expect(state(source({}), source({ field, value: true }))).toBe("CHANGED");
    });
  }

  describe("Parameter serialization defaults", () => {
    for (const location of ["query", "path", "header", "cookie"] as const) {
      const defaultStyle =
        location === "query" || location === "cookie" ? "form" : "simple";
      const defaultExplode = defaultStyle === "form";

      it(`ignores an explicit default style for ${location}`, () => {
        expect(
          state(
            source({ location }),
            source({ location, field: "style", value: defaultStyle }),
          ),
        ).toBe("UNCHANGED");
      });

      it(`ignores an explicit default explode for ${location}`, () => {
        expect(
          state(
            source({ location }),
            source({ location, field: "explode", value: defaultExplode }),
          ),
        ).toBe("UNCHANGED");
      });
    }

    it("detects non-default query style and explode", () => {
      expect(
        state(source({}), source({ field: "style", value: "simple" })),
      ).toBe("CHANGED");
      expect(
        state(source({}), source({ field: "explode", value: false })),
      ).toBe("CHANGED");
    });

    it("detects non-default header style and path explode", () => {
      expect(
        state(
          source({ location: "header" }),
          source({ location: "header", field: "style", value: "form" }),
        ),
      ).toBe("CHANGED");
      expect(
        state(
          source({ location: "path" }),
          source({ location: "path", field: "explode", value: true }),
        ),
      ).toBe("CHANGED");
    });
  });

  it("does not erase an explicitly invalid path parameter required: false", () => {
    expect(
      state(
        source({ location: "path" }),
        source({ location: "path", field: "required", value: false }),
      ),
    ).toBe("CHANGED");
  });

  it("uses the same optional required: false default for Swagger 2 query parameters", () => {
    expect(
      state(
        source({ swagger2: true }),
        source({ swagger2: true, field: "required", value: false }),
      ),
    ).toBe("UNCHANGED");
  });
});

describe("Response Object header semantics", () => {
  const make = (
    options: {
      headerType?: string;
      headerName?: string;
      required?: boolean;
      noHeader?: boolean;
      extraHeader?: boolean;
      viaReference?: boolean;
      description?: string;
      bodyType?: string;
      contentTypeHeader?: boolean;
    } = {},
  ) => {
    const header = {
      description: options.description ?? "request correlation",
      schema: { type: options.headerType ?? "string" },
      ...(options.required === undefined ? {} : { required: options.required }),
    };
    const headers: Record<string, unknown> = {};
    if (!options.noHeader)
      headers[options.headerName ?? "X-Request-ID"] = options.viaReference
        ? { $ref: "#/components/headers/Correlation" }
        : header;
    if (options.extraHeader)
      headers["X-Rate-Limit"] = { schema: { type: "integer" } };
    if (options.contentTypeHeader)
      headers["Content-Type"] = { schema: { type: "integer" } };
    return buildCompleteOperationInventory({
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "8".repeat(64),
      filename: "response-header-contract.json",
      bytes: Buffer.from(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "response header contract", version: "1" },
          components: { headers: { Correlation: header } },
          paths: {
            "/items": {
              get: {
                operationId: "listItems",
                responses: {
                  "200": {
                    description: "OK",
                    headers,
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            name: { type: options.bodyType ?? "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ),
    });
  };

  it("detects a changed response header schema even when the body is unchanged", () => {
    expect(state(make(), make({ headerType: "integer" }))).toBe("CHANGED");
  });

  it("detects removal and addition of response headers", () => {
    expect(state(make(), make({ noHeader: true }))).toBe("CHANGED");
    expect(state(make(), make({ extraHeader: true }))).toBe("CHANGED");
  });

  it("detects a newly required response header", () => {
    expect(state(make(), make({ required: true }))).toBe("CHANGED");
  });

  it("resolves referenced response headers before fingerprinting them", () => {
    expect(
      state(
        make({ viaReference: true }),
        make({ viaReference: true, headerType: "integer" }),
      ),
    ).toBe("CHANGED");
  });

  it("does not report a change for header case or documentation only", () => {
    expect(state(make(), make({ headerName: "x-request-id" }))).toBe(
      "UNCHANGED",
    );
    expect(state(make(), make({ description: "new documentation" }))).toBe(
      "UNCHANGED",
    );
  });

  it("ignores Content-Type response header and keeps body schema changes", () => {
    expect(state(make(), make({ contentTypeHeader: true }))).toBe("UNCHANGED");
    expect(state(make(), make({ bodyType: "integer" }))).toBe("CHANGED");
  });

  it("detects a changed Swagger 2 response header schema", () => {
    const sw2 = (headerType: string) =>
      buildCompleteOperationInventory({
        sourceFamily: "OZON_SELLER",
        snapshotSha256: "9".repeat(64),
        filename: "response-header-swagger2.json",
        bytes: Buffer.from(
          JSON.stringify({
            swagger: "2.0",
            info: { title: "legacy header", version: "1" },
            paths: {
              "/items": {
                get: {
                  operationId: "listItems",
                  responses: {
                    "200": {
                      description: "OK",
                      schema: { type: "object" },
                      headers: { "X-Rate-Limit": { type: headerType } },
                    },
                  },
                },
              },
            },
          }),
        ),
      });
    expect(state(sw2("integer"), sw2("string"))).toBe("CHANGED");
  });

  it("considers a response header with required:false equivalent to default", () => {
    expect(state(make(), make({ required: false }))).toBe("UNCHANGED");
  });
});
