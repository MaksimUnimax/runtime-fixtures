import { describe, expect, it } from "vitest";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";
import { proveCredentialTransferSchemaResolution } from "./credential-transfer-schema-resolution.proof.js";

const connectionString = process.env.DATABASE_URL;
const database = requireI1DisposableDatabase(connectionString);
if (!connectionString) throw new Error("DATABASE_URL is required");

describe("credential transfer canonical transaction schema", () => {
  it("ignores caller shadow tables and removes its own test resources", async () => {
    await runMigrations({ connectionString });
    const result = await proveCredentialTransferSchemaResolution(
      connectionString,
      database,
    );
    expect(result.error).toBeNull();
    expect(result.cleanupErrors).toEqual([]);
    expect(result.total).toBe(11);
    expect(result.passed).toBe(11);
    expect(result.checks.filter((check) => !check.passed)).toEqual([]);
  }, 60_000);
});
