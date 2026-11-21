import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import baseline from "./canonical-schema-baseline.json";
import * as schema from "./schema";

// The kit's ESM bundle contains CommonJS dependencies. Load its supported CJS
// entry point so Vitest does not turn those requires into ESM runtime errors.
const { generateDrizzleJson, generateMigration } = createRequire(
  import.meta.url,
)("drizzle-kit/api") as typeof import("drizzle-kit/api");

const drizzleDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const metadataDirectory = path.join(drizzleDirectory, "meta");
const snapshotFile = fs
  .readdirSync(metadataDirectory)
  .filter((name) => /^\d+_snapshot\.json$/.test(name))
  .sort()
  .at(-1)!;
const snapshot = JSON.parse(
  fs.readFileSync(path.join(metadataDirectory, snapshotFile), "utf8"),
) as ReturnType<typeof generateDrizzleJson>;
const current = generateDrizzleJson(schema, snapshot.prevId);

// Compare SQL expressions without treating qualification, whitespace or the
// ordering of a literal IN set as changes to the constraint.
function normalizeSql(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const sql = String(value)
    .replace(
      /\bin\s*\(\s*('(?:[^']|'')*'(?:\s*,\s*'(?:[^']|'')*')*)\s*\)/gi,
      (_, values: string) =>
        `IN(${values
          .match(/'(?:[^']|'')*'/g)!
          .sort()
          .join(",")})`,
    )
    .replace(/"\w+"\./g, "")
    .replace(/"(\w+)"/g, "$1");
  let result = "";
  let quoted = false;
  for (let index = 0; index < sql.length; index++) {
    const character = sql[index]!;
    if (character === "'") {
      result += character;
      if (quoted && sql[index + 1] === "'") {
        result += sql[++index];
      } else {
        quoted = !quoted;
      }
    } else if (quoted) {
      result += character;
    } else if (!/\s/.test(character)) {
      result += character.toLowerCase();
    }
  }
  // Drizzle preserves harmless outer grouping present in a declaration.
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0;
    let insideString = false;
    let enclosesWholeExpression = true;
    for (let index = 0; index < result.length - 1; index++) {
      const character = result[index];
      if (character === "'") {
        if (insideString && result[index + 1] === "'") index++;
        else insideString = !insideString;
      } else if (!insideString) {
        if (character === "(") depth++;
        if (character === ")" && --depth === 0) {
          enclosesWholeExpression = false;
          break;
        }
      }
    }
    if (!enclosesWholeExpression) break;
    result = result.slice(1, -1);
  }
  return result;
}

function expectIndex(
  tableName: string,
  expected: (typeof baseline.canonicalIndexes)[number],
) {
  const table = current.tables[`public.${tableName}`]!;
  const index = table.indexes[expected.name];
  expect(index, `${tableName}.${expected.name}`).toBeDefined();
  expect(index!.isUnique).toBe(expected.isUnique);
  expect(
    index!.columns.map(
      (column: { expression: string; asc: boolean; nulls: string }) => ({
        name: column.expression,
        asc: column.asc,
        nulls: column.nulls,
      }),
    ),
  ).toEqual(expected.columns);
  expect(normalizeSql(index!.where)).toBe(normalizeSql(expected.where));
}

describe("canonical schema baseline", () => {
  it("does not regenerate existing canonical objects from unchanged declarations", async () => {
    expect(await generateMigration(snapshot, current)).toEqual([]);
  });

  it("retains every modeled canonical table and the full enum vocabulary", () => {
    for (const table of baseline.modeledTables) {
      expect(snapshot.tables[`public.${table}`], table).toBeDefined();
    }
    for (const [name, values] of Object.entries(baseline.addedEnums)) {
      expect(snapshot.enums[`public.${name}`]?.values, name).toEqual(values);
    }
    // Shared browser representation is preserved; canonical SQL remains the
    // authority for the physical enum order and is pinned below.
    expect([...snapshot.enums["public.browser_family"]!.values].sort()).toEqual(
      ["chrome", "yandex_chromium", "opera", "firefox", "safari"].sort(),
    );
  });

  it.each(Object.entries(baseline.missingSnapshotTableShapes))(
    "preserves columns, defaults, checks and indexes for %s",
    (name, expected) => {
      const table = current.tables[`public.${name}`]!;
      expect(snapshot.tables[`public.${name}`], name).toBeDefined();
      expect(Object.keys(table.columns).sort()).toEqual(
        Object.keys(expected.columns).sort(),
      );
      for (const [columnName, shape] of Object.entries(expected.columns)) {
        const column = table.columns[columnName]!;
        expect(
          { type: column.type, notNull: column.notNull },
          `${name}.${columnName}`,
        ).toEqual({ type: shape.type, notNull: shape.notNull });
        expect(
          normalizeSql(column.default),
          `${name}.${columnName} default`,
        ).toBe(normalizeSql(shape.default));
      }
      expect(Object.keys(table.checkConstraints).sort()).toEqual(
        Object.keys(expected.checks).sort(),
      );
      for (const [checkName, expression] of Object.entries(expected.checks)) {
        expect(
          normalizeSql(table.checkConstraints[checkName]!.value),
          checkName,
        ).toBe(normalizeSql(expression));
      }
      expect(Object.keys(table.indexes).sort()).toEqual(
        expected.indexes.map((index) => index.name).sort(),
      );
      for (const index of expected.indexes) expectIndex(name, index);
    },
  );

  it("preserves exact canonical FK names, columns and actions in snapshot and model", () => {
    const sort = <T extends { tableFrom: string; name: string }>(rows: T[]) =>
      rows.sort((left, right) => {
        const a = left.tableFrom + "." + left.name;
        const b = right.tableFrom + "." + right.name;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    const expected = sort(
      baseline.foreignKeys.map((key) => ({
        key: key.name,
        name: key.name,
        tableFrom: key.tableFrom,
        tableTo: key.tableTo,
        columnsFrom: key.columnsFrom,
        columnsTo: key.columnsTo,
        onDelete: key.onDelete,
        onUpdate: key.onUpdate,
      })),
    );
    for (const [label, model] of [
      ["snapshot", snapshot],
      ["model", current],
    ] as const) {
      type CanonicalForeignKey = Pick<
        (typeof baseline.foreignKeys)[number],
        | "name"
        | "tableFrom"
        | "tableTo"
        | "columnsFrom"
        | "columnsTo"
        | "onDelete"
        | "onUpdate"
      >;
      const actual = sort(
        Object.values<{ foreignKeys: Record<string, CanonicalForeignKey> }>(
          model.tables,
        ).flatMap((table) =>
          Object.entries(table.foreignKeys).map(([name, key]) => ({
            key: name,
            name: key.name,
            tableFrom: key.tableFrom,
            tableTo: key.tableTo,
            columnsFrom: key.columnsFrom,
            columnsTo: key.columnsTo,
            onDelete: key.onDelete,
            onUpdate: key.onUpdate,
          })),
        ),
      );
      expect(actual, label).toEqual(expected);
    }
  });

  it("preserves canonical partial uniqueness and descending lookup indexes", () => {
    for (const index of baseline.canonicalIndexes)
      expectIndex(index.table, index);
  });

  it("represents the canonical CHECK expressions across all owned tables", () => {
    for (const expected of baseline.canonicalChecks) {
      const check =
        current.tables[`public.${expected.table}`]!.checkConstraints[
          expected.name
        ];
      expect(check, expected.name).toBeDefined();
      // Canonical0033 explicitly casts these varchar columns to text. The
      // declaration's literal IN comparison uses the same text coercion.
      const expression = expected.name.endsWith("_browser_family")
        ? expected.expression.replace(/::text/g, "")
        : expected.expression;
      expect
        .soft(normalizeSql(check!.value), expected.name)
        .toBe(normalizeSql(expression));
    }
  });

  it("preserves canonical composite primary keys and UNIQUE constraints", () => {
    for (const expected of baseline.canonicalPrimaryKeys) {
      const key =
        current.tables[`public.${expected.table}`]!.compositePrimaryKeys[
          expected.name
        ];
      expect(key?.columns, expected.name).toEqual(expected.columns);
    }
    for (const expected of baseline.canonicalUniqueConstraints) {
      const key =
        current.tables[`public.${expected.table}`]!.uniqueConstraints[
          expected.name
        ];
      expect(key?.columns, expected.name).toEqual(expected.columns);
    }
  });

  it("preserves all historical SQL bytes, journal tuples and custom SQL objects", () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(metadataDirectory, "_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    expect(
      journal.entries.slice(0, baseline.canonicalJournalPrefix.length),
    ).toEqual(baseline.canonicalJournalPrefix);
    const sql: string[] = [];
    for (const [name, expectedHash] of Object.entries(baseline.sqlSha256)) {
      const bytes = fs.readFileSync(path.join(drizzleDirectory, name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        expectedHash,
      );
      sql.push(bytes.toString("utf8"));
    }
    const canonicalSql = sql.join("\n");
    for (const name of baseline.sqlOwnedTables) {
      expect(canonicalSql, name).toMatch(
        new RegExp(
          `CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?(?:"?public"?\\.)?"?${name}"?\\s*\\(`,
          "i",
        ),
      );
    }
    for (const object of baseline.preservedCustomSql)
      expect(canonicalSql).toContain(object);
    expect(canonicalSql).toContain(
      "CREATE TABLE octoport_transfer_fence.writer_epoch",
    );
    expect(canonicalSql).toContain(
      "CREATE TABLE octoport_transfer_fence.authorized_transactions",
    );
    expect(canonicalSql).toContain(
      '"device_authorizations_idempotency_key_hash_unique"',
    );
  });
});
