import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";

type ParameterShape = "schema" | "content" | "both" | "neither";
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

  // OpenAPI 3 Parameter Objects require at least one wire definition.
  for (const version of ["3.0.3", "3.1.2", "3.2.0"]) {
    it.each(["path", "operation", "local-ref"] as const)(
      "rejects missing schema and content in %s for OpenAPI " + version,
      (location) => {
        expect(() => inventory(version, "neither", location)).toThrow(
          "APIWATCH_PARAMETER_SCHEMA_CONTENT_MISSING",
        );
      },
    );
  }

  // Parameter.content defines exactly one media representation in OAS 3.
  // The root Swagger parser validates the document envelope, not this field.
  for (const version of ["3.0.3", "3.1.2", "3.2.0"]) {
    for (const placement of ["path", "operation", "local-ref"] as const) {
      it(
        "rejects empty or multiple content media types in " +
          placement +
          " for " +
          version,
        () => {
          const media = {
            "application/json": { schema: { type: "integer" } },
            "text/plain": { schema: { type: "string" } },
          };
          const inventoryWithContent = (content: unknown) => {
            const parameter = { in: "query", name: "filter", content };
            const location =
              placement === "path" ? { parameters: [parameter] } : {};
            const operationParameters =
              placement === "operation"
                ? [parameter]
                : placement === "local-ref"
                  ? [{ $ref: "#/components/parameters/Filter" }]
                  : undefined;
            const document = {
              openapi: version,
              info: { title: "content cardinality", version: "1" },
              ...(placement === "local-ref"
                ? { components: { parameters: { Filter: parameter } } }
                : {}),
              paths: {
                "/items": {
                  ...location,
                  get: {
                    ...(operationParameters
                      ? { parameters: operationParameters }
                      : {}),
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
          };
          for (const invalid of [{}, media, [], null]) {
            expect(() => inventoryWithContent(invalid)).toThrow(
              "APIWATCH_PARAMETER_CONTENT_CARDINALITY_INVALID",
            );
          }
          expect(
            inventoryWithContent({
              "application/json": media["application/json"],
            }).operations[0]?.parameterCount,
          ).toBe(1);
        },
      );
    }
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
