import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";
import { diffInventories } from "./diff.js";

const FAMILY = "OZON_SELLER" as const;
const BASE = "a".repeat(64);
const TARGET = "b".repeat(64);

function inventory(
  response: unknown,
  components: Record<string, unknown> = {},
  snapshotSha256: string = BASE,
) {
  const root = {
    openapi: "3.0.3",
    info: { title: "response reference integrity", version: "1" },
    ...(Object.keys(components).length > 0 ? { components } : {}),
    paths: {
      "/orders": {
        get: {
          responses: { "200": response },
        },
      },
    },
  };
  return buildCompleteOperationInventory({
    sourceFamily: FAMILY,
    snapshotSha256,
    filename: "openapi.json",
    bytes: Buffer.from(JSON.stringify(root)),
  });
}

const bodyResponse = (type: string) => ({
  description: "a valid response",
  content: {
    "application/json": { schema: { type } },
  },
});

describe("C03 unresolved OpenAPI response references fail closed", () => {
  it.each([
    { $ref: "#/components/responses/MissingA" },
    { $ref: "#/components/responses/MissingB" },
    { $ref: "remote.yaml#/components/responses/Other" },
    {
      $ref: "remote.yaml#/components/responses/Other",
      ...bodyResponse("string"),
    },
    { $ref: 42, ...bodyResponse("string") },
  ])("rejects unresolved or forged response reference %#", (response) => {
    expect(() => inventory(response)).toThrow(
      "APIWATCH_RESPONSE_REF_UNRESOLVED",
    );
  });

  it("rejects a self-reference and a two-response reference cycle", () => {
    expect(() =>
      inventory(
        { $ref: "#/components/responses/A" },
        { responses: { A: { $ref: "#/components/responses/A" } } },
      ),
    ).toThrow("APIWATCH_RESPONSE_REF_UNRESOLVED");
    expect(() =>
      inventory(
        { $ref: "#/components/responses/A" },
        {
          responses: {
            A: { $ref: "#/components/responses/B" },
            B: { $ref: "#/components/responses/A" },
          },
        },
      ),
    ).toThrow("APIWATCH_RESPONSE_REF_UNRESOLVED");
  });

  it.each([
    { $ref: "#/components/headers/Missing" },
    { $ref: "remote.yaml#/components/headers/Other" },
    {
      $ref: "remote.yaml#/components/headers/Other",
      schema: { type: "string" },
    },
    { $ref: 123, schema: { type: "string" } },
  ])("rejects unresolved or forged response-header reference %#", (header) => {
    expect(() =>
      inventory({
        description: "ok",
        headers: { "X-Trace": header },
      }),
    ).toThrow("APIWATCH_RESPONSE_HEADER_REF_UNRESOLVED");
  });

  it("rejects recursive local response-header references", () => {
    expect(() =>
      inventory(
        {
          description: "ok",
          headers: { "X-Trace": { $ref: "#/components/headers/Trace" } },
        },
        { headers: { Trace: { $ref: "#/components/headers/Trace" } } },
      ),
    ).toThrow("APIWATCH_RESPONSE_HEADER_REF_UNRESOLVED");
  });

  it("keeps a valid local response reference equivalent to inline content", () => {
    const resolved = inventory(
      { $ref: "#/components/responses/Good" },
      { responses: { Good: bodyResponse("string") } },
    );
    const inline = inventory(bodyResponse("string"));
    expect(resolved.operations[0]?.responseSchemaSha256).toBe(
      inline.operations[0]?.responseSchemaSha256,
    );

    const changed = inventory(
      { $ref: "#/components/responses/Good" },
      { responses: { Good: bodyResponse("integer") } },
      TARGET,
    );
    const diff = diffInventories({ base: resolved, target: changed });
    expect(diff.changedCount).toBe(1);
    expect(
      diff.operations[0]?.deltas.some(
        (delta) => delta.field === "responseSchemaSha256",
      ),
    ).toBe(true);
  });

  it("keeps a valid local header reference equivalent to inline definition", () => {
    const header = { description: "trace", schema: { type: "string" } };
    const withRef = inventory(
      {
        description: "ok",
        headers: { "X-Trace": { $ref: "#/components/headers/Trace" } },
      },
      { headers: { Trace: header } },
    );
    const inline = inventory({
      description: "ok",
      headers: { "X-Trace": header },
    });
    expect(withRef.operations[0]?.responseSchemaSha256).toBe(
      inline.operations[0]?.responseSchemaSha256,
    );
  });

  it("preserves existing no-body response hashes and annotation invariants", () => {
    const one = inventory({ description: "ok" });
    const two = inventory({ description: "another description" });
    expect(one.operations[0]?.responseSchemaSha256).toBe(
      two.operations[0]?.responseSchemaSha256,
    );
    expect(one.operations[0]?.responseStatusKeys).toEqual(["200"]);
  });
});
