import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";
import { diffInventories } from "./diff.js";

type MediaCase = {
  rootConsumes?: string[];
  rootProduces?: string[];
  operationConsumes?: string[];
  operationProduces?: string[];
  payload?: "body" | "formData" | "none";
};

function inventory(input: MediaCase) {
  const parameters =
    input.payload === "none"
      ? []
      : input.payload === "formData"
        ? [{ name: "value", in: "formData", type: "string", required: true }]
        : [
            {
              name: "value",
              in: "body",
              required: true,
              schema: { type: "string" },
            },
          ];
  const post: Record<string, unknown> = {
    operationId: "sample",
    parameters,
    responses: {
      "200": { description: "ok", schema: { type: "string" } },
    },
    ...(input.operationConsumes === undefined
      ? {}
      : { consumes: input.operationConsumes }),
    ...(input.operationProduces === undefined
      ? {}
      : { produces: input.operationProduces }),
  };
  const document = {
    swagger: "2.0",
    info: { title: "Synthetic media contract", version: "1.0" },
    ...(input.rootConsumes === undefined
      ? {}
      : { consumes: input.rootConsumes }),
    ...(input.rootProduces === undefined
      ? {}
      : { produces: input.rootProduces }),
    paths: { "/sample": { post } },
  };
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: "a".repeat(64),
    filename: "swagger2-media.json",
    bytes: new TextEncoder().encode(JSON.stringify(document)),
  });
}

function compare(before: MediaCase, after: MediaCase) {
  const original = inventory(before);
  const modified = inventory(after);
  const diff = diffInventories({ base: original, target: modified });
  return {
    original: original.operations[0]!,
    modified: modified.operations[0]!,
    changed: diff.changedCount,
    state: diff.operations[0]!.state,
    fields: diff.operations[0]!.deltas.map((delta) => delta.field),
  };
}

describe("Swagger 2.0 effective MIME contracts and stable unrelated hashes", () => {
  it("detects a root consumes change for a request body without changing the response fingerprint", () => {
    const result = compare(
      { rootConsumes: ["application/json"] },
      { rootConsumes: ["text/plain"] },
    );
    expect(result.state).toBe("CHANGED");
    expect(result.changed).toBe(1);
    expect(result.fields).toContain("requestSchemaSha256");
    expect(result.fields).not.toContain("responseSchemaSha256");
    expect(result.original.requestSchemaSha256).not.toBe(
      result.modified.requestSchemaSha256,
    );
  });

  it("detects a root produces change independently of the request contract", () => {
    const result = compare(
      { rootProduces: ["application/json"] },
      { rootProduces: ["text/plain"] },
    );
    expect(result.state).toBe("CHANGED");
    expect(result.fields).toContain("responseSchemaSha256");
    expect(result.fields).not.toContain("requestSchemaSha256");
    expect(result.original.responseSchemaSha256).not.toBe(
      result.modified.responseSchemaSha256,
    );
  });

  it("ignores changed root MIME types when both are overridden on the operation", () => {
    const result = compare(
      {
        rootConsumes: ["application/json"],
        rootProduces: ["application/json"],
        operationConsumes: ["text/plain"],
        operationProduces: ["application/xml"],
      },
      {
        rootConsumes: ["application/x-www-form-urlencoded"],
        rootProduces: ["image/png"],
        operationConsumes: ["text/plain"],
        operationProduces: ["application/xml"],
      },
    );
    expect(result.state).toBe("UNCHANGED");
  });

  it("treats an explicit empty operation consumes list as clearing inherited root consumes", () => {
    expect(
      compare(
        { rootConsumes: ["application/json"] },
        { rootConsumes: ["application/json"], operationConsumes: [] },
      ).fields,
    ).toContain("requestSchemaSha256");
    expect(
      compare(
        { rootConsumes: ["application/json"], operationConsumes: [] },
        { rootConsumes: ["text/plain"], operationConsumes: [] },
      ).state,
    ).toBe("UNCHANGED");
  });

  it("treats an explicit empty operation produces list as clearing inherited root produces", () => {
    expect(
      compare(
        { rootProduces: ["application/json"] },
        { rootProduces: ["application/json"], operationProduces: [] },
      ).fields,
    ).toContain("responseSchemaSha256");
    expect(
      compare(
        { rootProduces: ["application/json"], operationProduces: [] },
        { rootProduces: ["text/plain"], operationProduces: [] },
      ).state,
    ).toBe("UNCHANGED");
  });

  it("does not fingerprint consumes for a request with no body or form fields", () => {
    const result = compare(
      { rootConsumes: ["application/json"], payload: "none" },
      { rootConsumes: ["text/plain"], payload: "none" },
    );
    expect(result.state).toBe("UNCHANGED");
    expect(result.original.requestSchemaSha256).toBeNull();
    expect(result.modified.requestSchemaSha256).toBeNull();
  });

  it("detects consumes for Swagger 2.0 formData request parameters", () => {
    const result = compare(
      {
        rootConsumes: ["application/x-www-form-urlencoded"],
        payload: "formData",
      },
      { rootConsumes: ["multipart/form-data"], payload: "formData" },
    );
    expect(result.state).toBe("CHANGED");
    expect(result.fields).toContain("requestSchemaSha256");
  });

  it("treats MIME lists as order-insensitive sets, including duplicate entries", () => {
    const result = compare(
      {
        rootConsumes: ["application/json", "text/plain"],
        rootProduces: ["application/xml", "application/json"],
      },
      {
        rootConsumes: ["text/plain", "application/json", "text/plain"],
        rootProduces: [
          "application/json",
          "application/xml",
          "application/xml",
        ],
      },
    );
    expect(result.state).toBe("UNCHANGED");
  });

  it("preserves fingerprint identity for unchanged Swagger 2.0 documents without MIME declarations", () => {
    const result = compare({}, {});
    expect(result.state).toBe("UNCHANGED");
    expect(result.original.requestSchemaSha256).toEqual(
      result.modified.requestSchemaSha256,
    );
    expect(result.original.responseSchemaSha256).toEqual(
      result.modified.responseSchemaSha256,
    );
    // Existing no-media inventory hashes must remain byte-exact.
    expect(result.original.requestSchemaSha256).toBe(
      "8f3d8a04fb57ffc6582404bfdfe718211c734ce25664bbebea59091e8afb6d8a",
    );
    expect(result.original.responseSchemaSha256).toBe(
      "fba3b301e3f02920a4d49df5d5b6a89db15a83aec204850f8d93291985aadb27",
    );
  });
});

describe("Swagger 2.0 invalid MIME declarations fail closed", () => {
  it.each([
    ["root consumes string", "rootConsumes", "text/plain", "body"],
    ["root produces string", "rootProduces", "text/plain", "body"],
    ["operation consumes string", "operationConsumes", "text/plain", "body"],
    ["operation produces null", "operationProduces", null, "body"],
    [
      "root consumes mixed member types",
      "rootConsumes",
      ["application/json", 3],
      "body",
    ],
    [
      "operation produces blank media value",
      "operationProduces",
      ["   "],
      "body",
    ],
    [
      "root consumes malformed on a bodyless request",
      "rootConsumes",
      "text/plain",
      "none",
    ],
  ] as const)(
    "rejects %s rather than silently treating it as undeclared",
    (_name, field, value, payload) => {
      const malformed = { [field]: value, payload } as unknown as MediaCase;
      expect(() => inventory(malformed)).toThrow(
        "APIWATCH_SWAGGER2_MEDIA_DECLARATION_INVALID",
      );
    },
  );

  it("does not let a valid operation override conceal a malformed root declaration", () => {
    const malformed = {
      rootConsumes: "text/plain",
      operationConsumes: ["application/json"],
    } as unknown as MediaCase;
    expect(() => inventory(malformed)).toThrow(
      "APIWATCH_SWAGGER2_MEDIA_DECLARATION_INVALID",
    );
  });

  it("rejects malformed root consumes even when no operations are present", () => {
    const invalidRoot = {
      swagger: "2.0",
      info: { title: "empty", version: "1" },
      paths: {},
      consumes: "text/plain",
    };
    expect(() =>
      buildCompleteOperationInventory({
        sourceFamily: "OZON_SELLER",
        snapshotSha256: "a".repeat(64),
        filename: "invalid-root.json",
        bytes: new TextEncoder().encode(JSON.stringify(invalidRoot)),
      }),
    ).toThrow("APIWATCH_SWAGGER2_MEDIA_DECLARATION_INVALID");
  });
});
