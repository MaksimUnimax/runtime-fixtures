import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import baseline from "./canonical-schema-baseline.json";
import * as schema from "./schema";

const { generateDrizzleJson, generateMigration } = createRequire(
  import.meta.url,
)("drizzle-kit/api") as typeof import("drizzle-kit/api");
const drizzle = new URL("../drizzle/", import.meta.url);
const snapshot = JSON.parse(
  fs.readFileSync(new URL("meta/0058_snapshot.json", drizzle), "utf8"),
) as ReturnType<typeof generateDrizzleJson>;
const current = generateDrizzleJson(schema, snapshot.prevId);

// These inline REFERENCES clauses are SQL-owned physical identities, including
// the two older exchange fields. They must remain real names in both generator
// inputs; an alias accepted only by a test cannot rename an existing constraint.
const physicalKeys = [
  {
    name: "device_authorizations_exchanged_device_id_fkey",
    table: "device_authorizations",
    column: "exchanged_device_id",
    target: "devices",
    source: "0005_p2_5_device_management.sql",
  },
  {
    name: "device_authorizations_exchanged_session_id_fkey",
    table: "device_authorizations",
    column: "exchanged_session_id",
    target: "sessions",
    source: "0005_p2_5_device_management.sql",
  },
  {
    name: "account_connection_credentials_account_id_fkey",
    table: "account_connection_credentials",
    column: "account_id",
    target: "accounts",
    source: "0062_account_connection_codes.sql",
  },
  {
    name: "account_connection_credentials_issued_by_user_id_fkey",
    table: "account_connection_credentials",
    column: "issued_by_user_id",
    target: "users",
    source: "0062_account_connection_codes.sql",
  },
  {
    name: "connection_exchange_receipts_credential_id_fkey",
    table: "connection_exchange_receipts",
    column: "credential_id",
    target: "account_connection_credentials",
    source: "0062_account_connection_codes.sql",
  },
  {
    name: "connection_exchange_receipts_device_id_fkey",
    table: "connection_exchange_receipts",
    column: "device_id",
    target: "devices",
    source: "0062_account_connection_codes.sql",
  },
  {
    name: "connection_exchange_receipts_session_id_fkey",
    table: "connection_exchange_receipts",
    column: "session_id",
    target: "sessions",
    source: "0062_account_connection_codes.sql",
  },
  {
    name: "devices_credential_transfer_approved_by_user_id_fkey",
    table: "devices",
    column: "credential_transfer_approved_by_user_id",
    target: "users",
    source: "0062_account_connection_codes.sql",
  },
] as const;

describe("canonical physical foreign-key identity", () => {
  it("anchors all eight physical names in their original inline SQL declarations", () => {
    for (const key of physicalKeys) {
      const sql = fs.readFileSync(new URL(key.source, drizzle), "utf8");
      const canonical = baseline.foreignKeys.find(
        (entry) => entry.tableFrom === key.table && entry.name === key.name,
      );
      expect(canonical, key.name).toMatchObject({
        tableTo: key.target,
        columnsFrom: [key.column],
        columnsTo: ["id"],
        onDelete: "restrict",
        onUpdate: "restrict",
      });
      // All eight inline default names fit without PostgreSQL truncation.
      expect(key.name).toBe(key.table + "_" + key.column + "_fkey");
      expect(Buffer.byteLength(key.name)).toBeLessThanOrEqual(63);
      const declaration = new RegExp(
        '"?' +
          key.column +
          '"?\\s+uuid(?:\\s+NOT NULL)?\\s+REFERENCES\\s+"?' +
          key.target +
          '"?\\s*\\(\\s*"?id"?\\s*\\)\\s+ON DELETE RESTRICT\\s+ON UPDATE RESTRICT',
        "i",
      );
      expect(sql, fileURLToPath(new URL(key.source, drizzle))).toMatch(
        declaration,
      );
      for (const model of [snapshot, current]) {
        const actual =
          model.tables["public." + key.table]!.foreignKeys[key.name];
        expect(actual?.name, key.name).toBe(key.name);
      }
    }
  });

  it.each(physicalKeys)(
    "alters $name through its existing canonical DROP target",
    async (key) => {
      const next = structuredClone(current);
      next.tables["public." + key.table]!.foreignKeys[key.name]!.onDelete =
        "cascade";
      const sql = (await generateMigration(snapshot, next)).map((statement) =>
        statement.trim(),
      );
      expect(sql).toEqual([
        'ALTER TABLE "' + key.table + '" DROP CONSTRAINT "' + key.name + '";',
        'ALTER TABLE "' +
          key.table +
          '" ADD CONSTRAINT "' +
          key.name +
          '" FOREIGN KEY ("' +
          key.column +
          '") REFERENCES "public"."' +
          key.target +
          '"("id") ON DELETE cascade ON UPDATE restrict;',
      ]);
    },
  );

  it.each(physicalKeys)(
    "removes $name through its existing canonical DROP target",
    async (key) => {
      const next = structuredClone(current);
      delete next.tables["public." + key.table]!.foreignKeys[key.name];
      const sql = (await generateMigration(snapshot, next)).map((statement) =>
        statement.trim(),
      );
      expect(sql).toEqual([
        'ALTER TABLE "' + key.table + '" DROP CONSTRAINT "' + key.name + '";',
      ]);
    },
  );
});
