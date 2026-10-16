import { describe, expect, it } from "vitest";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";
import { proveCredentialTransferLateStop } from "./credential-transfer-late-stop.proof.js";

const connectionString = process.env.DATABASE_URL;
requireI1DisposableDatabase(connectionString);
if (!connectionString) throw new Error("Disposable DATABASE_URL required");

describe("terminal service after committed transfer mutation", () => {
  it("withholds late success and bytes without undoing PostgreSQL COMMIT", async () => {
    await runMigrations({ connectionString });
    const result = await proveCredentialTransferLateStop(connectionString);
    expect(result.verdict).toBe("PASS_SCOPED_LATE_STOP_AFTER_PG_COMMIT");
    expect(result.total).toBe(19);
    expect(result.passed).toBe(19);
    expect(result.failureTypes).toEqual([]);
    expect(Object.values(result.cleanup).every(Boolean)).toBe(true);
  }, 60_000);
});
