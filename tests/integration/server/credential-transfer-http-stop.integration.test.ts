import { describe, expect, it } from "vitest";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";
import { proveCredentialTransferHttpStop } from "./credential-transfer-http-stop.proof.js";

const connectionString = process.env.DATABASE_URL;
requireI1DisposableDatabase(connectionString);
if (!connectionString) throw new Error("Disposable DATABASE_URL required");

describe("real HTTP ACK shutdown after PostgreSQL commit", () => {
  it("drains without false success, replay or rollback of the committed ACK", async () => {
    await runMigrations({ connectionString });
    const result = await proveCredentialTransferHttpStop(connectionString);
    expect(result.verdict).toBe("PASS_SCOPED_REAL_HTTP_ACK_STOP");
    expect(result.failureTypes).toEqual([]);
    expect(result.total).toBe(46);
    expect(result.passed).toBe(46);
    expect(result.checks.filter((check) => !check.passed)).toEqual([]);
    expect(Object.values(result.cleanup).every(Boolean)).toBe(true);
  }, 60_000);
});
