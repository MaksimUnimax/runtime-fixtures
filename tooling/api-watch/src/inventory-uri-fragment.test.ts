import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";
import { diffInventories } from "./diff.js";

type Slot = "request" | "response" | "parameter";
const slots: Slot[] = ["request", "response", "parameter"];
const encoded = [
  "#/components/schemas/%50ayload",
  "#%2Fcomponents%2Fschemas%2FPayload",
];
function inventory(
  ref: string,
  schemas: Record<string, unknown>,
  slot: Slot = "request",
  version = "3.1.0",
  siblings: Record<string, unknown> = {},
) {
  const schema = { $ref: ref, ...siblings };
  const content = { "application/json": { schema } };
  const document = {
    openapi: version,
    info: { title: "C03 synthetic URI pointer", version: "1" },
    components: { schemas },
    paths: {
      "/items": {
        post: {
          ...(slot === "request" ? { requestBody: { content } } : {}),
          ...(slot === "parameter"
            ? { parameters: [{ name: "filter", in: "query", schema }] }
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
  };
  const bytes = Buffer.from(JSON.stringify(document));
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    documentKey: "synthetic-uri",
    snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
    filename: "uri-fragment.json",
    bytes,
  });
}
function change(
  a: ReturnType<typeof inventory>,
  b: ReturnType<typeof inventory>,
) {
  expect(a.operationCount).toBe(1);
  expect(b.operationCount).toBe(1);
  return diffInventories({ base: a, target: b }).operations[0]!.state;
}
const payload = (minLength: number) => ({ type: "string", minLength });

describe("C03 URI-encoded local JSON Pointer contracts", () => {
  for (const version of ["3.0.3", "3.1.0"])
    for (const slot of slots)
      for (const ref of encoded) {
        it(`${version} ${slot} ${ref}: detects target constraint change`, () => {
          expect(
            change(
              inventory(ref, { Payload: payload(1) }, slot, version),
              inventory(ref, { Payload: payload(2) }, slot, version),
            ),
          ).toBe("CHANGED");
        });
        it(`${version} ${slot} ${ref}: matches plain reference`, () => {
          const schemas = { Payload: payload(1) };
          expect(
            change(
              inventory("#/components/schemas/Payload", schemas, slot, version),
              inventory(ref, schemas, slot, version),
            ),
          ).toBe("UNCHANGED");
        });
      }
  for (const slot of slots) {
    it(`${slot}: ordinary local target changes remain detectable`, () => {
      expect(
        change(
          inventory(
            "#/components/schemas/Payload",
            { Payload: payload(1) },
            slot,
          ),
          inventory(
            "#/components/schemas/Payload",
            { Payload: payload(2) },
            slot,
          ),
        ),
      ).toBe("CHANGED");
    });
    for (const [key, token] of [
      ["with/slash", "with%7E1slash"],
      ["with~tilde", "with%7E0tilde"],
      ["雪", "%E9%9B%AA"],
    ]) {
      it(`${slot}: decode URI then pointer escape for ${key}`, () => {
        const ref = "#/components/schemas/Container/properties/" + token;
        const schemas = (min: number) => ({
          Container: { type: "object", properties: { [key!]: payload(min) } },
        });
        expect(
          change(
            inventory(ref, schemas(1), slot),
            inventory(ref, schemas(2), slot),
          ),
        ).toBe("CHANGED");
      });
    }
    it(`${slot}: percent decoding occurs exactly once`, () => {
      const schemas = {
        Container: {
          properties: {
            "a%2Fb": { type: "string" },
            a: { b: { type: "integer" } },
          },
        },
      };
      expect(
        change(
          inventory(
            "#/components/schemas/Container/properties/a%252Fb",
            schemas,
            slot,
          ),
          inventory(
            "#/components/schemas/Container/properties/a/b",
            schemas,
            slot,
          ),
        ),
      ).toBe("CHANGED");
    });
    it(`${slot}: valid array-index pointer reaches its schema`, () => {
      const ref = "#/components/schemas/Payload/allOf/0";
      expect(
        change(
          inventory(ref, { Payload: { allOf: [payload(1)] } }, slot),
          inventory(ref, { Payload: { allOf: [payload(2)] } }, slot),
        ),
      ).toBe("CHANGED");
    });
    it(`${slot}: recursive encoded aliases terminate and match plain references`, () => {
      const plain = "#/components/schemas/Node";
      const escaped = "#/components/schemas/%4Eode";
      const schemas = (ref: string) => ({
        Node: {
          type: "object",
          properties: { value: { type: "string" }, next: { $ref: ref } },
        },
      });
      expect(
        change(
          inventory(plain, schemas(plain), slot),
          inventory(escaped, schemas(escaped), slot),
        ),
      ).toBe("UNCHANGED");
    });
  }
  it("a literal percent is not decoded a second time into a different target", () => {
    const ref = "#/components/schemas/Container/properties/a%252Fb";
    const schemas = (min: number) => ({
      Container: { properties: { "a%2Fb": payload(min) } },
    });
    expect(change(inventory(ref, schemas(1)), inventory(ref, schemas(2)))).toBe(
      "CHANGED",
    );
  });
  it("array indices with leading zero do not alias a valid index", () => {
    const schemas = { Payload: { allOf: [payload(1)] } };
    expect(
      change(
        inventory("#/components/schemas/Payload/allOf/0", schemas),
        inventory("#/components/schemas/Payload/allOf/00", schemas),
      ),
    ).toBe("CHANGED");
  });
  for (const ref of [
    "#/components/schemas/%GG",
    "#/components/schemas/%E0%A4%A",
    "#/components/schemas/Missing",
  ]) {
    it(`invalid or missing ${ref} remains unresolved without a crash`, () => {
      expect(
        change(
          inventory(ref, { Payload: payload(1) }),
          inventory(ref, { Payload: payload(2) }),
        ),
      ).toBe("UNCHANGED");
    });
  }
  it("invalid tilde escape does not select a similarly named property", () => {
    const ref = "#/components/schemas/Container/properties/a~2b";
    const schemas = (min: number) => ({
      Container: { properties: { "a~2b": payload(min) } },
    });
    expect(change(inventory(ref, schemas(1)), inventory(ref, schemas(2)))).toBe(
      "UNCHANGED",
    );
  });
  it("inherited __proto__ is not an actual empty schema", () => {
    const schemas = { Empty: {} };
    expect(
      change(
        inventory("#/components/schemas/__proto__", schemas),
        inventory("#/components/schemas/Empty", schemas),
      ),
    ).toBe("CHANGED");
  });
  it("own __proto__ schema property remains valid", () => {
    const ref = "#/components/schemas/Container/properties/__proto__";
    const schemas = (min: number) => ({
      Container: {
        properties: Object.fromEntries([["__proto__", payload(min)]]),
      },
    });
    expect(change(inventory(ref, schemas(1)), inventory(ref, schemas(2)))).toBe(
      "CHANGED",
    );
  });
  for (const version of ["3.0.3", "3.1.0"]) {
    it(`${version}: encoded reference preserves the dialect sibling rule`, () => {
      const schemas = { Payload: { type: "string" } };
      expect(
        change(
          inventory(encoded[0]!, schemas, "request", version, { maxLength: 5 }),
          inventory(encoded[0]!, schemas, "request", version, { maxLength: 8 }),
        ),
      ).toBe(version === "3.1.0" ? "CHANGED" : "UNCHANGED");
    });
  }
  for (const literal of ["default", "const", "enum"]) {
    it(`literal ${literal} reference is not dereferenced`, () => {
      const data = { $ref: encoded[0]! };
      const schemas = (min: number) => ({
        Wrapper: {
          type: "object",
          [literal]: literal === "enum" ? [data] : data,
        },
        Payload: payload(min),
      });
      expect(
        change(
          inventory("#/components/schemas/Wrapper", schemas(1)),
          inventory("#/components/schemas/Wrapper", schemas(2)),
        ),
      ).toBe("UNCHANGED");
    });
  }
  for (const ref of [
    "https://example.invalid/schema.json#/Payload",
    "#Payload",
  ]) {
    it(`unsupported external or anchor ${ref} is not fetched or aliased`, () => {
      expect(
        change(
          inventory(ref, { Payload: payload(1) }),
          inventory(ref, { Payload: payload(2) }),
        ),
      ).toBe("UNCHANGED");
    });
  }
});

type ExtensionSlot = "parameter" | "request" | "media" | "header" | "security";
function extensionInventory(
  location: ExtensionSlot,
  extension: unknown,
  minimum: number,
  version: string,
) {
  const extra = { "x-vendor": extension };
  const plainContent = { "application/json": { schema: { type: "string" } } };
  const document = {
    openapi: version,
    info: { title: "C03 synthetic review extension", version: "1" },
    components: {
      schemas: { Payload: payload(minimum) },
      ...(location === "security"
        ? {
            securitySchemes: {
              auth: { type: "apiKey", in: "header", name: "X-Key", ...extra },
            },
          }
        : {}),
    },
    paths: {
      "/items": {
        post: {
          ...(location === "parameter"
            ? {
                parameters: [
                  {
                    name: "filter",
                    in: "query",
                    schema: { type: "string" },
                    ...extra,
                  },
                ],
              }
            : {}),
          ...(location === "request"
            ? { requestBody: { content: plainContent, ...extra } }
            : {}),
          ...(location === "security" ? { security: [{ auth: [] }] } : {}),
          responses: {
            "200": {
              description: "ok",
              ...(location === "media"
                ? {
                    content: {
                      "application/json": {
                        schema: { type: "string" },
                        ...extra,
                      },
                    },
                  }
                : {}),
              ...(location === "header"
                ? {
                    headers: {
                      "x-limit": { schema: { type: "string" }, ...extra },
                    },
                  }
                : {}),
            },
          },
        },
      },
    },
  };
  const bytes = Buffer.from(JSON.stringify(document));
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    documentKey: "synthetic-review-extension",
    snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
    filename: "extension-boundary.json",
    bytes,
  });
}

describe("C03 independent review P2 boundaries", () => {
  for (const version of ["3.0.3", "3.1.0"]) {
    for (const location of [
      "parameter",
      "request",
      "media",
      "header",
      "security",
    ] as const) {
      for (const shape of ["direct", "nested"] as const) {
        it(`${version} ${location} ${shape}: extension refs are literal data`, () => {
          const ref = "#%2Fcomponents%2Fschemas%2FPayload";
          const extension =
            shape === "direct"
              ? { $ref: ref }
              : { schema: { $ref: ref }, nested: [{ $ref: ref }] };
          expect(
            change(
              extensionInventory(location, extension, 1, version),
              extensionInventory(location, extension, 9, version),
            ),
          ).toBe("UNCHANGED");
        });
      }
      it(`${version} ${location}: literal extension spelling changes remain visible`, () => {
        expect(
          change(
            extensionInventory(
              location,
              { $ref: "#/components/schemas/Payload" },
              1,
              version,
            ),
            extensionInventory(
              location,
              { $ref: "#%2Fcomponents%2Fschemas%2FPayload" },
              1,
              version,
            ),
          ),
        ).toBe("CHANGED");
      });
    }
    for (const slot of slots) {
      const schemas = (minimum: number) => ({
        Container: { type: "object", properties: { "A#B": payload(minimum) } },
      });
      const raw = "#/components/schemas/Container/properties/A#B";
      const valid = "#/components/schemas/Container/properties/A%23B";
      it(`${version} ${slot}: raw second fragment separator must not resolve`, () => {
        expect(
          change(
            inventory(raw, schemas(1), slot, version),
            inventory(raw, schemas(9), slot, version),
          ),
        ).toBe("UNCHANGED");
      });
      it(`${version} ${slot}: percent-encoded hash remains a valid property name`, () => {
        expect(
          change(
            inventory(valid, schemas(1), slot, version),
            inventory(valid, schemas(9), slot, version),
          ),
        ).toBe("CHANGED");
      });
      it(`${version} ${slot}: invalid and encoded hash are not equivalent references`, () => {
        expect(
          change(
            inventory(raw, schemas(1), slot, version),
            inventory(valid, schemas(1), slot, version),
          ),
        ).toBe("CHANGED");
      });
      it(`${version} ${slot}: x-prefixed actual schema property is not an extension`, () => {
        const target = (minimum: number) => ({
          Container: {
            type: "object",
            properties: {
              "x-payload": { $ref: "#/components/schemas/Payload" },
            },
          },
          Payload: payload(minimum),
        });
        expect(
          change(
            inventory(
              "#/components/schemas/Container",
              target(1),
              slot,
              version,
            ),
            inventory(
              "#/components/schemas/Container",
              target(9),
              slot,
              version,
            ),
          ),
        ).toBe("CHANGED");
      });
    }
    it(`${version}: x-prefixed actual header still resolves its schema reference`, () => {
      const make = (minimum: number) => {
        const bytes = Buffer.from(
          JSON.stringify({
            openapi: version,
            info: { title: "C03 named header control", version: "1" },
            components: {
              headers: { Limit: { schema: payload(minimum) } },
            },
            paths: {
              "/items": {
                get: {
                  responses: {
                    "200": {
                      description: "ok",
                      headers: {
                        "x-limit": { $ref: "#/components/headers/Limit" },
                      },
                    },
                  },
                },
              },
            },
          }),
        );
        return buildCompleteOperationInventory({
          sourceFamily: "OZON_SELLER",
          documentKey: "synthetic-named-header",
          snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
          filename: "named-header.json",
          bytes,
        });
      };
      expect(change(make(1), make(9))).toBe("CHANGED");
    });
  }
});

function namedMapInventory(
  version: string,
  property: string,
  binding: "inline" | "header-ref",
  media: string,
  minimum: number,
  extensionAt?: "encoding" | "header",
  headerName = "x-trace",
) {
  const extension = { schema: { $ref: "#/components/schemas/Payload" } };
  const header = {
    schema: extensionAt
      ? { type: "integer" }
      : { $ref: "#/components/schemas/Payload" },
    ...(extensionAt === "header" ? { "x-vendor": extension } : {}),
  };
  const document = {
    openapi: version,
    info: { title: "C03 named OpenAPI maps", version: "1" },
    components: {
      schemas: { Payload: payload(minimum) },
      headers: { Trace: header },
    },
    paths: {
      "/items": {
        post: {
          requestBody: {
            content: {
              [media]: {
                schema: {
                  type: "object",
                  properties: { [property]: { type: "string" } },
                },
                encoding: {
                  [property]: {
                    headers: {
                      [headerName]:
                        binding === "inline"
                          ? header
                          : { $ref: "#/components/headers/Trace" },
                    },
                    ...(extensionAt === "encoding"
                      ? { "x-vendor": extension }
                      : {}),
                  },
                },
              },
            },
          },
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
  const bytes = Buffer.from(JSON.stringify(document));
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    documentKey: "synthetic-named-openapi-map",
    snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
    filename: "named-map.json",
    bytes,
  });
}

describe("C03 independent R2 named OpenAPI map boundary", () => {
  for (const version of ["3.0.3", "3.1.0"]) {
    for (const property of ["item", "x-item"]) {
      for (const binding of ["inline", "header-ref"] as const) {
        for (const media of ["multipart/form-data", "x-custom/form-data"]) {
          it(`${version} ${property} ${binding} ${media}: real named header detects schema changes`, () => {
            expect(
              change(
                namedMapInventory(version, property, binding, media, 1),
                namedMapInventory(version, property, binding, media, 9),
              ),
            ).toBe("CHANGED");
          });
        }
      }
      for (const extensionAt of ["encoding", "header"] as const) {
        it(`${version} ${property} ${extensionAt}: actual extension data stays literal`, () => {
          expect(
            change(
              namedMapInventory(
                version,
                property,
                "inline",
                "multipart/form-data",
                1,
                extensionAt,
              ),
              namedMapInventory(
                version,
                property,
                "inline",
                "multipart/form-data",
                9,
                extensionAt,
              ),
            ),
          ).toBe("UNCHANGED");
        });
      }
    }
    it(`${version}: ordinary header name control still detects a real schema change`, () => {
      expect(
        change(
          namedMapInventory(
            version,
            "item",
            "inline",
            "multipart/form-data",
            1,
            undefined,
            "trace",
          ),
          namedMapInventory(
            version,
            "item",
            "inline",
            "multipart/form-data",
            9,
            undefined,
            "trace",
          ),
        ),
      ).toBe("CHANGED");
    });
  }
});

// Outer schema enum is a set of allowed values; arrays inside a value are data.
// Likewise arbitrary extension payloads must stay literal in every fingerprint phase.
describe("C03 extension literal fingerprint canonicalization", () => {
  const changedExtensionValues: Array<[string, unknown, unknown]> = [
    ["description key", { description: "alpha" }, { description: "beta" }],
    ["example key", { example: "alpha" }, { example: "beta" }],
    ["examples key", { examples: ["alpha"] }, { examples: ["beta"] }],
    ["literal enum order", { enum: ["A", "B"] }, { enum: ["B", "A"] }],
    [
      "literal required order",
      { required: ["A", "B"] },
      { required: ["B", "A"] },
    ],
    [
      "nested schema-shaped data",
      { schema: { description: "alpha" } },
      { schema: { description: "beta" } },
    ],
  ];
  for (const version of ["3.0.3", "3.1.0"]) {
    for (const slot of slots) {
      const schemaInventory = (schema: Record<string, unknown>) =>
        inventory(
          "#/components/schemas/Payload",
          { Payload: schema },
          slot,
          version,
        );
      for (const [label, before, after] of changedExtensionValues) {
        it(`${version} ${slot} ${label}: extension value change is not erased`, () => {
          expect(
            change(
              schemaInventory({ type: "string", "x-vendor": before }),
              schemaInventory({ type: "string", "x-vendor": after }),
            ),
          ).toBe("CHANGED");
        });
      }
      it(`${version} ${slot}: outer schema enum permutation is unchanged`, () => {
        expect(
          change(
            schemaInventory({ type: "string", enum: ["A", "B"] }),
            schemaInventory({ type: "string", enum: ["B", "A"] }),
          ),
        ).toBe("UNCHANGED");
      });
      it(`${version} ${slot}: an array within an enum value keeps its order`, () => {
        expect(
          change(
            schemaInventory({ type: "array", enum: [["A", "B"]] }),
            schemaInventory({ type: "array", enum: [["B", "A"]] }),
          ),
        ).toBe("CHANGED");
      });
      it(`${version} ${slot}: actual schema description remains cosmetic`, () => {
        expect(
          change(
            schemaInventory({ type: "string", description: "alpha" }),
            schemaInventory({ type: "string", description: "beta" }),
          ),
        ).toBe("UNCHANGED");
      });
      it(`${version} ${slot}: x-prefixed property name is not an extension`, () => {
        expect(
          change(
            schemaInventory({
              type: "object",
              properties: {
                "x-business": { type: "string", description: "alpha" },
              },
            }),
            schemaInventory({
              type: "object",
              properties: {
                "x-business": { type: "string", description: "beta" },
              },
            }),
          ),
        ).toBe("UNCHANGED");
      });
      it(`${version} ${slot}: extension object key order is cosmetic`, () => {
        expect(
          change(
            schemaInventory({
              type: "string",
              "x-vendor": { description: "same", values: [1, 2] },
            }),
            schemaInventory({
              type: "string",
              "x-vendor": { values: [1, 2], description: "same" },
            }),
          ),
        ).toBe("UNCHANGED");
      });
    }
    for (const property of ["item", "x-item"]) {
      it(`${version} ${property}: encoding-map entry keeps actual header annotations cosmetic`, () => {
        const documentInventory = (description: string) => {
          const document = {
            openapi: version,
            info: { title: "C03 synthetic canonical encoding", version: "1" },
            paths: {
              "/items": {
                post: {
                  requestBody: {
                    content: {
                      "multipart/form-data": {
                        schema: {
                          type: "object",
                          properties: { [property]: { type: "string" } },
                        },
                        encoding: {
                          [property]: {
                            headers: {
                              "x-trace": {
                                description,
                                schema: { type: "string", minLength: 1 },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  responses: { "200": { description: "ok" } },
                },
              },
            },
          };
          const bytes = Buffer.from(JSON.stringify(document));
          return buildCompleteOperationInventory({
            sourceFamily: "OZON_SELLER",
            documentKey: "canonical-encoding",
            snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
            filename: "canonical-encoding.json",
            bytes,
          });
        };
        expect(
          change(documentInventory("alpha"), documentInventory("beta")),
        ).toBe("UNCHANGED");
      });
    }
  }
});
