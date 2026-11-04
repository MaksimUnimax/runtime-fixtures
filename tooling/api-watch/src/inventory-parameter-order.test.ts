import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";
import { diffInventories } from "./diff.js";
import { classifyApiImpact } from "./impact.js";

type Schema = Record<string, unknown>;

function parameter(name: string, schema: Schema) {
  return { name, in: "query", content: { "application/json": { schema } } };
}

function inventory(version: string, parameters: unknown[]) {
  const bytes = Buffer.from(
    JSON.stringify({
      openapi: version,
      info: { title: "Parameter ordering fixture", version: "1" },
      paths: {
        "/items": {
          get: {
            parameters,
            responses: { "200": { description: "OK" } },
          },
        },
      },
    }),
  );
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
    filename: "parameters.json",
    bytes,
  });
}

const cosmetic: [string, Schema, Schema][] = [
  [
    "nested object key order",
    { type: "string", maxLength: 10 },
    { maxLength: 10, type: "string" },
  ],
  [
    "nested description",
    { type: "string", description: "z" },
    { type: "string", description: "a" },
  ],
  [
    "enum alternative order",
    { type: "string", enum: ["z", "a"] },
    { type: "string", enum: ["a", "z"] },
  ],
  [
    "required name order",
    {
      type: "object",
      required: ["z", "a"],
      properties: { a: { type: "string" }, z: { type: "string" } },
    },
    {
      type: "object",
      required: ["a", "z"],
      properties: { a: { type: "string" }, z: { type: "string" } },
    },
  ],
  [
    "literal default object key order",
    { type: "object", default: { z: 1, a: 2 } },
    { type: "object", default: { a: 2, z: 1 } },
  ],
  [
    "logical branch order",
    { allOf: [{ type: "string" }, { maxLength: 10 }] },
    { allOf: [{ maxLength: 10 }, { type: "string" }] },
  ],
];

const semantic: [string, Schema, Schema][] = [
  ["type", { type: "string" }, { type: "integer" }],
  [
    "bound",
    { type: "string", maxLength: 10 },
    { type: "string", maxLength: 9 },
  ],
  [
    "enum membership",
    { type: "string", enum: ["z", "a"] },
    { type: "string", enum: ["z", "b"] },
  ],
  [
    "required membership",
    { type: "object", required: ["a"] },
    { type: "object", required: ["z"] },
  ],
  [
    "literal default array order",
    { type: "array", items: { type: "integer" }, default: [1, 2] },
    { type: "array", items: { type: "integer" }, default: [2, 1] },
  ],
  [
    "literal extension description",
    { type: "string", "x-data": { description: "z" } },
    { type: "string", "x-data": { description: "a" } },
  ],
];

for (const version of ["3.0.3", "3.1.0"]) {
  describe(`canonical parameter collection ordering / OAS ${version}`, () => {
    it.each(cosmetic)(
      "ignores %s before sorting distinct parameters",
      (_name, before, after) => {
        const base = inventory(version, [
          parameter("a", before),
          parameter("z", before),
        ]);
        const target = inventory(version, [
          parameter("a", before),
          parameter("z", after),
        ]);
        // Actual different snapshots: an equal snapshot identifier must not mask a defect.
        expect(base.snapshotSha256).not.toBe(target.snapshotSha256);
        const diff = diffInventories({ base, target });
        expect(diff.operations[0]?.state).toBe("UNCHANGED");
        expect(classifyApiImpact(diff).overallSeverity).toBe(
          "NO_POLICY_IMPACT",
        );
        expect(target.operations[0]?.parameterSchemaSha256).toBe(
          base.operations[0]?.parameterSchemaSha256,
        );
      },
    );

    it.each(semantic)("retains real %s changes", (_name, before, after) => {
      const base = inventory(version, [
        parameter("a", before),
        parameter("z", before),
      ]);
      const target = inventory(version, [
        parameter("a", before),
        parameter("z", after),
      ]);
      const diff = diffInventories({ base, target });
      expect(diff.operations[0]?.state).toBe("CHANGED");
      expect(
        diff.operations[0]?.deltas.some(
          (delta) => delta.field === "parameterSchemaSha256",
        ),
      ).toBe(true);
      expect(classifyApiImpact(diff).overallSeverity).toBe("REVIEW_REQUIRED");
    });

    it("ignores parameter sequence and nested key order together", () => {
      const base = inventory(version, [
        parameter("a", { type: "string", maxLength: 10 }),
        parameter("z", { type: "string", maxLength: 10 }),
      ]);
      const target = inventory(version, [
        parameter("z", { maxLength: 10, type: "string" }),
        parameter("a", { type: "string", maxLength: 10 }),
      ]);
      expect(diffInventories({ base, target }).operations[0]?.state).toBe(
        "UNCHANGED",
      );
    });

    it("retains a changed parameter name", () => {
      const schema = { type: "string", maxLength: 10 };
      const base = inventory(version, [
        parameter("a", schema),
        parameter("z", schema),
      ]);
      const target = inventory(version, [
        parameter("a", schema),
        parameter("b", schema),
      ]);
      expect(diffInventories({ base, target }).operations[0]?.state).toBe(
        "CHANGED",
      );
    });
  });
}
