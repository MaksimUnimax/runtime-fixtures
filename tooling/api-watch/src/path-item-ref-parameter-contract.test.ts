import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";

type Source = "paths" | "components";

function referenced(
  version: string,
  parameter: Record<string, unknown>,
  source: Source,
  override = false,
) {
  const get = {
    ...(override
      ? { parameters: [{ name: "p", in: "query", schema: { type: "string" } }] }
      : {}),
    responses: { "200": { description: "ok" } },
  };
  const shared = { parameters: [parameter], get };
  const document = {
    openapi: version,
    info: { title: "Path Item reference contract", version: "1" },
    ...(source === "components"
      ? { components: { pathItems: { Shared: shared } } }
      : {}),
    paths: {
      ...(source === "paths" ? { "/shared": shared } : {}),
      "/items": {
        $ref:
          source === "components"
            ? "#/components/pathItems/Shared"
            : "#/paths/~1shared",
      },
    },
  };
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: "a".repeat(64),
    filename: "path-item-ref.json",
    bytes: Buffer.from(JSON.stringify(document)),
  });
}

describe("C03 Path Item references retain the parameter wire contract", () => {
  for (const version of ["3.0.3", "3.1.2", "3.2.0"]) {
    it("rejects missing schema/content via #/paths in " + version, () => {
      expect(() =>
        referenced(version, { name: "p", in: "query" }, "paths"),
      ).toThrow("APIWATCH_PARAMETER_SCHEMA_CONTENT_MISSING");
    });
    it(
      "rejects invalid overridden Path parameter via #/paths in " + version,
      () => {
        expect(() =>
          referenced(version, { name: "p", in: "query" }, "paths", true),
        ).toThrow("APIWATCH_PARAMETER_SCHEMA_CONTENT_MISSING");
      },
    );
    it("accepts legal schema-only via #/paths in " + version, () => {
      expect(
        referenced(
          version,
          { name: "p", in: "query", schema: { type: "string" } },
          "paths",
        ).operations.length,
      ).toBeGreaterThan(0);
    });
  }
  for (const version of ["3.1.2", "3.2.0"]) {
    it(
      "rejects missing schema/content via components.pathItems in " + version,
      () => {
        expect(() =>
          referenced(version, { name: "p", in: "query" }, "components"),
        ).toThrow("APIWATCH_PARAMETER_SCHEMA_CONTENT_MISSING");
      },
    );
    it(
      "rejects overridden invalid parameter via components.pathItems in " +
        version,
      () => {
        expect(() =>
          referenced(version, { name: "p", in: "query" }, "components", true),
        ).toThrow("APIWATCH_PARAMETER_SCHEMA_CONTENT_MISSING");
      },
    );
    it(
      "accepts legal schema-only via components.pathItems in " + version,
      () => {
        expect(
          referenced(
            version,
            { name: "p", in: "query", schema: { type: "string" } },
            "components",
          ).operations,
        ).toHaveLength(1);
      },
    );
  }
  it("keeps OpenAPI 3.0 components.pathItems fail-closed", () => {
    expect(() =>
      referenced(
        "3.0.3",
        { name: "p", in: "query", schema: { type: "string" } },
        "components",
      ),
    ).toThrow("APIWATCH_PATH_ITEM_REF_INVALID_TARGET");
  });
});
