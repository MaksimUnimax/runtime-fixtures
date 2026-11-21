import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import baseline from "./canonical-schema-baseline.json";
import * as schema from "./schema";

const { generateDrizzleJson, generateMigration } = createRequire(
  import.meta.url,
)("drizzle-kit/api") as typeof import("drizzle-kit/api");

const snapshot = JSON.parse(
  fs.readFileSync(
    fileURLToPath(
      new URL("../drizzle/meta/0058_snapshot.json", import.meta.url),
    ),
    "utf8",
  ),
) as ReturnType<typeof generateDrizzleJson>;
const current = generateDrizzleJson(schema, snapshot.prevId);
const journal = JSON.parse(
  fs.readFileSync(
    fileURLToPath(new URL("../drizzle/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: unknown[] };
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

describe("current connection schema source baseline", () => {
  it("retains the historical source prefix and the additive 0062/0063 suffix", () => {
    // Independent golden hashes of immutable journal tuples in the pinned
    // integration base. Later appended migrations do not rewrite this prefix.
    expect(digest(JSON.stringify(journal.entries.slice(0, 50)))).toBe(
      "8bdaa4c1744178b59ec4c7edcfaf98556e3cb91cef5ee64ba28a2ae9863b5efc",
    );
    expect(digest(JSON.stringify(journal.entries.slice(0, 52)))).toBe(
      "90440a5e42afa4136efa9c61dc5951dfa02a943e10aeef828aae9dce6db3fe3a",
    );
    expect(baseline.canonicalJournalPrefix).toEqual(
      journal.entries.slice(0, 52),
    );
    for (const [name, hash] of [
      [
        "0062_account_connection_codes.sql",
        "d0c6243d0fda6f86d1ac65bbb61604902ac150765cb53445953ab1000b4ddc06",
      ],
      [
        "0063_connection_revocation_shape.sql",
        "7b5795f1f9cfd289cdbe7dd8a920be3c28445385aa9883b8773feb53d95b87bb",
      ],
    ]) {
      expect(
        digest(
          fs.readFileSync(
            fileURLToPath(new URL(`../drizzle/${name}`, import.meta.url)),
          ),
        ),
        name,
      ).toBe(hash);
    }
  });

  it("models both already-migrated enrollment tables and nullable legacy-device additions", () => {
    for (const table of [
      "account_connection_credentials",
      "connection_exchange_receipts",
    ]) {
      expect(snapshot.tables[`public.${table}`], table).toBeDefined();
      expect(current.tables[`public.${table}`], table).toBeDefined();
    }
    const device = current.tables["public.devices"]!;
    for (const [name, expected] of Object.entries(
      baseline.connectionDeviceColumns,
    )) {
      expect(
        {
          type: device.columns[name]!.type,
          notNull: device.columns[name]!.notNull,
          default: device.columns[name]!.default ?? null,
        },
        name,
      ).toEqual(expected);
      expect(snapshot.tables["public.devices"]!.columns[name], name).toEqual(
        device.columns[name],
      );
    }
    expect(
      current.tables["public.account_connection_credentials"]!.columns.id!
        .primaryKey,
    ).toBe(true);
    expect(
      current.tables["public.connection_exchange_receipts"]!
        .compositePrimaryKeys.connection_exchange_receipts_pkey!.columns,
    ).toEqual(["credential_id", "operation_hash"]);
  });

  it("detects the stale donor snapshot that would recreate existing enrollment objects", async () => {
    const stale = structuredClone(snapshot);
    delete stale.tables["public.account_connection_credentials"];
    delete stale.tables["public.connection_exchange_receipts"];
    const device = stale.tables["public.devices"]!;
    for (const column of [
      "connection_credential_id",
      "credential_transfer_approved_at",
      "credential_transfer_approved_by_user_id",
    ]) {
      delete device.columns[column];
    }
    const approvalKey = "devices_credential_transfer_approved_by_user_id_fkey";
    expect(device.foreignKeys[approvalKey]?.name).toBe(approvalKey);
    delete device.foreignKeys[approvalKey];
    delete device.foreignKeys.devices_connection_credential_account_fk;
    delete device.indexes.devices_connection_credential_index;
    delete device.checkConstraints.devices_credential_transfer_approval_shape;

    const ddl = await generateMigration(stale, current);
    expect(ddl).toHaveLength(16);
    const sql = ddl.join("\n");
    expect(sql).toContain('CREATE TABLE "account_connection_credentials"');
    expect(sql).toContain('CREATE TABLE "connection_exchange_receipts"');
    for (const column of [
      "connection_credential_id",
      "credential_transfer_approved_at",
      "credential_transfer_approved_by_user_id",
    ]) {
      expect(sql).toContain(`ALTER TABLE "devices" ADD COLUMN "${column}"`);
    }
    expect(sql).not.toMatch(
      /(?:^|;\s*)\s*(?:DROP|RENAME|TRUNCATE|DELETE|UPDATE)\b/,
    );
  });

  it("retains the account-scoped composite device credential relationship", async () => {
    const key =
      current.tables["public.devices"]!.foreignKeys
        .devices_connection_credential_account_fk!;
    expect(key).toMatchObject({
      tableTo: "account_connection_credentials",
      columnsFrom: ["connection_credential_id", "account_id"],
      columnsTo: ["id", "account_id"],
      onDelete: "restrict",
      onUpdate: "restrict",
    });
    const wrong = structuredClone(snapshot);
    const wrongKey =
      wrong.tables["public.devices"]!.foreignKeys
        .devices_connection_credential_account_fk!;
    wrongKey.columnsFrom = ["connection_credential_id"];
    wrongKey.columnsTo = ["id"];
    const ddl = await generateMigration(wrong, current);
    expect(ddl.length).toBeGreaterThan(0);
    expect(ddl.join("\n")).toContain(
      "devices_connection_credential_account_fk",
    );
  });

  it("detects a return to the pre-0063 revocation CHECK", async () => {
    const stale = structuredClone(snapshot);
    stale.tables[
      "public.account_connection_credentials"
    ]!.checkConstraints.account_connection_credentials_revocation_shape!.value =
      "(revoked_at IS NULL AND revocation_reason IS NULL) OR (revoked_at >= created_at AND revocation_reason IS NOT NULL)";
    const ddl = await generateMigration(stale, current);
    expect(ddl.length).toBeGreaterThan(0);
    expect(ddl.join("\n")).toContain(
      "account_connection_credentials_revocation_shape",
    );
    expect(
      current.tables["public.account_connection_credentials"]!.checkConstraints
        .account_connection_credentials_revocation_shape!.value,
    ).toContain("revoked_at IS NOT NULL");
  });

  it("retains SQL-owned approval guards outside the ORM snapshot model", () => {
    const sql = fs.readFileSync(
      fileURLToPath(
        new URL(
          "../drizzle/0062_account_connection_codes.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(sql).toContain(
      "CREATE FUNCTION public.octoport_guard_connection_transfer_approval()",
    );
    expect(sql).toContain("CREATE TRIGGER connection_transfer_approval_guard");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.octoport_guard_connection_transfer_approval() FROM PUBLIC",
    );
    expect(Object.keys(snapshot.tables)).toHaveLength(79);
    expect(Object.keys(snapshot.enums)).toHaveLength(52);
  });
});
