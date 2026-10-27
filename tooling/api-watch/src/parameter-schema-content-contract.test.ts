import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";

type ParameterShape = "schema" | "content" | "both";
type Location = "path" | "operation" | "local-ref";

function inventory(version: string, shape: ParameterShape, location: Location) {
  const schema = { type: "string" };
  const content = {
    "application/json": { schema: { type: "integer" } },
  };
  const parameter = {
    name: "filter",
    in: "query",
    ...(shape === "schema" || shape === "both" ? { schema } : {}),
    ...(shape === "content" || shape === "both" ? { content } : {}),
  };
  const operationParameters =
    location === "operation"
      ? [parameter]
      : location === "local-ref"
        ? [{ $ref: "#/components/parameters/Filter" }]
        : undefined;
  const document = {
    openapi: version,
    info: { title: "fixture", version: "1" },
    ...(location === "local-ref"
      ? { components: { parameters: { Filter: parameter } } }
      : {}),
    paths: {
      "/items": {
        ...(location === "path" ? { parameters: [parameter] } : {}),
        get: {
          ...(operationParameters ? { parameters: operationParameters } : {}),
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: "a".repeat(64),
    filename: "parameter.json",
    bytes: Buffer.from(JSON.stringify(document)),
  });
}

describe("C03 OpenAPI parameter schema/content trust boundary", () => {
  for (const version of ["3.0.3", "3.1.0", "3.2.0"]) {
    it.each(["path", "operation", "local-ref"] as const)(
      "rejects simultaneous schema and content in %s for OpenAPI " + version,
      (location) => {
        expect(() => inventory(version, "both", location)).toThrow(
          "APIWATCH_PARAMETER_SCHEMA_CONTENT_CONFLICT",
        );
      },
    );

    it(
      "preserves both legal single-form declarations for OpenAPI " + version,
      () => {
        expect(
          inventory(version, "schema", "operation").operations,
        ).toHaveLength(1);
        expect(
          inventory(version, "content", "operation").operations,
        ).toHaveLength(1);
        expect(
          inventory(version, "schema", "path").operations[0]?.parameterCount,
        ).toBe(1);
        expect(
          inventory(version, "content", "local-ref").operations[0]
            ?.parameterCount,
        ).toBe(1);
      },
    );
  }

  it("does not reject Swagger 2 body parameters with a schema", () => {
    const document = {
      swagger: "2.0",
      info: { title: "fixture", version: "1" },
      paths: {
        "/items": {
          post: {
            parameters: [
              {
                name: "payload",
                in: "body",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const result = buildCompleteOperationInventory({
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "a".repeat(64),
      filename: "swagger.json",
      bytes: Buffer.from(JSON.stringify(document)),
    });
    expect(result.operations[0]?.requestBodyPresent).toBe(true);
  });
});
