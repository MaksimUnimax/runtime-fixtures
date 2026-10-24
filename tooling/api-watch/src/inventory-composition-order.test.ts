import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";
import { diffInventories } from "./diff.js";

type Slot = "request" | "response" | "parameter";
type Combinator = "allOf" | "anyOf" | "oneOf";
const slots: Slot[] = ["request", "response", "parameter"];
const combinators: Combinator[] = ["allOf", "anyOf", "oneOf"];

function branches(key: Combinator): Record<string, unknown>[] {
  return key === "allOf"
    ? [{ type: "string", minLength: 1 }, { maxLength: 10 }]
    : [
        { type: "string", minLength: 1 },
        { type: "integer", minimum: 0 },
      ];
}

function inventory(
  schema: unknown,
  slot: Slot = "request",
  version = "3.1.0",
  extra: Record<string, unknown> = {},
) {
  const content = { "application/json": { schema } };
  const document = {
    openapi: version,
    info: { title: "synthetic composition contract", version: "1" },
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
    ...extra,
  };
  const bytes = Buffer.from(JSON.stringify(document));
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: createHash("sha256").update(bytes).digest("hex"),
    filename: "composition-order.json",
    bytes,
  });
}

function change(
  before: ReturnType<typeof inventory>,
  after: ReturnType<typeof inventory>,
) {
  expect(before.operationCount).toBe(1);
  expect(after.operationCount).toBe(1);
  return diffInventories({ base: before, target: after }).operations[0]!.state;
}

describe("C03 logical schema branch order versus ordered data", () => {
  for (const version of ["3.0.3", "3.1.0"]) {
    for (const slot of slots) {
      for (const key of combinators) {
        it(`${version} ${slot}: ${key} branch permutation is not a contract change`, () => {
          const items = branches(key);
          expect(
            change(
              inventory({ [key]: items }, slot, version),
              inventory({ [key]: [...items].reverse() }, slot, version),
            ),
          ).toBe("UNCHANGED");
        });
      }
    }
  }

  for (const slot of slots) {
    for (const key of combinators) {
      it(`${slot}: a real ${key} constraint change stays detectable`, () => {
        const original = branches(key);
        const revised = [{ ...original[0], minLength: 2 }, original[1]];
        expect(
          change(
            inventory({ [key]: original }, slot),
            inventory({ [key]: revised }, slot),
          ),
        ).toBe("CHANGED");
      });
    }
    it(`${slot}: oneOf duplicate branches retain exact-one semantics`, () => {
      const branch = { type: "string" };
      expect(
        change(
          inventory({ oneOf: [branch] }, slot),
          inventory({ oneOf: [branch, branch] }, slot),
        ),
      ).toBe("CHANGED");
    });
    it(`${slot}: prefixItems order remains significant`, () => {
      const items = [{ type: "string" }, { type: "integer" }];
      expect(
        change(
          inventory({ type: "array", prefixItems: items }, slot),
          inventory({ type: "array", prefixItems: [...items].reverse() }, slot),
        ),
      ).toBe("CHANGED");
    });
    it(`${slot}: referenced logical branches are order independent`, () => {
      const extra = {
        components: {
          schemas: {
            A: { type: "string", minLength: 1 },
            B: { maxLength: 10 },
          },
        },
      };
      const items = [
        { $ref: "#/components/schemas/A" },
        { $ref: "#/components/schemas/B" },
      ];
      expect(
        change(
          inventory({ allOf: items }, slot, "3.1.0", extra),
          inventory({ allOf: [...items].reverse() }, slot, "3.1.0", extra),
        ),
      ).toBe("UNCHANGED");
    });
  }

  for (const key of combinators) {
    for (const literal of ["default", "const", "enum"]) {
      it(`${literal}: a literal property named ${key} retains array order`, () => {
        const first = { [key]: [1, 2] };
        const second = { [key]: [2, 1] };
        const a = {
          type: "object",
          [literal]: literal === "enum" ? [first] : first,
        };
        const b = {
          type: "object",
          [literal]: literal === "enum" ? [second] : second,
        };
        expect(change(inventory(a), inventory(b))).toBe("CHANGED");
      });
    }
    it(`extension data containing ${key} is not a schema applicator`, () => {
      expect(
        change(
          inventory({ type: "string", "x-business": { [key]: [1, 2] } }),
          inventory({ type: "string", "x-business": { [key]: [2, 1] } }),
        ),
      ).toBe("CHANGED");
    });
  }

  it("nested logical branches normalize recursively", () => {
    const a = {
      allOf: [{ anyOf: branches("anyOf") }, { not: { type: "null" } }],
    };
    const b = {
      allOf: [
        { not: { type: "null" } },
        { anyOf: branches("anyOf").reverse() },
      ],
    };
    expect(change(inventory(a), inventory(b))).toBe("UNCHANGED");
  });
});
