import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";

type Location = "path" | "operation" | "reference";
type Shape = "schema" | "content" | "both" | "neither";
const value = {
  name: "search",
  in: "querystring",
};
const content = {
  "application/x-www-form-urlencoded": {
    schema: { type: "object", properties: { filter: { type: "string" } } },
  },
};
function inventory(version: string, shape: Shape, location: Location) {
  const parameter = {
    ...value,
    ...(shape === "schema" || shape === "both"
      ? { schema: { type: "string" } }
      : {}),
    ...(shape === "content" || shape === "both" ? { content } : {}),
  };
  const operation = {
    responses: { "200": { description: "ok" } },
    ...(location === "operation"
      ? { parameters: [parameter] }
      : location === "reference"
        ? { parameters: [{ $ref: "#/components/parameters/Search" }] }
        : {}),
  };
  const root = {
    openapi: version,
    info: { title: "OAS32 querystring", version: "1" },
    ...(location === "reference"
      ? { components: { parameters: { Search: parameter } } }
      : {}),
    paths: {
      "/search": {
        ...(location === "path" ? { parameters: [parameter] } : {}),
        get: operation,
      },
    },
  };
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: "a".repeat(64),
    filename: "oas32-querystring.json",
    bytes: Buffer.from(JSON.stringify(root)),
  });
}

describe("C03 OAS3.2 querystring parameters require media content", () => {
  it.each(["path", "operation", "reference"] as const)(
    "rejects schema-only querystring in %s",
    (location) => {
      expect(() => inventory("3.2.0", "schema", location)).toThrow(
        "APIWATCH_QUERYSTRING_CONTENT_REQUIRED",
      );
    },
  );
  it.each(["path", "operation", "reference"] as const)(
    "accepts legal content-only querystring in %s",
    (location) => {
      const ops = inventory("3.2.0", "content", location).operations;
      expect(ops).toHaveLength(1);
      expect(ops[0]?.parameterCount).toBe(1);
    },
  );
  it.each(["path", "operation", "reference"] as const)(
    "keeps missing wire declaration fail-closed in %s",
    (location) => {
      expect(() => inventory("3.2.0", "neither", location)).toThrow(
        "APIWATCH_PARAMETER_SCHEMA_CONTENT_MISSING",
      );
    },
  );
  it.each(["path", "operation", "reference"] as const)(
    "keeps ambiguous schema/content declaration fail-closed in %s",
    (location) => {
      expect(() => inventory("3.2.0", "both", location)).toThrow(
        "APIWATCH_PARAMETER_SCHEMA_CONTENT_CONFLICT",
      );
    },
  );
  it("does not accept querystring in OpenAPI 3.1", () => {
    expect(() => inventory("3.1.2", "content", "operation")).toThrow(
      "APIWATCH_PARAMETER_IDENTITY_INVALID",
    );
  });
  it("keeps query and querystring exclusive", () => {
    const root = {
      openapi: "3.2.0",
      info: { title: "querystring exclusion", version: "1" },
      paths: {
        "/search": {
          parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
          get: {
            parameters: [{ ...value, content }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    expect(() =>
      buildCompleteOperationInventory({
        sourceFamily: "OZON_SELLER",
        snapshotSha256: "a".repeat(64),
        filename: "oas32-exclusion.json",
        bytes: Buffer.from(JSON.stringify(root)),
      }),
    ).toThrow("APIWATCH_QUERYSTRING_PARAMETER_CONFLICT");
  });
});
