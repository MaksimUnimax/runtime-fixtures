import { describe, expect, it } from "vitest";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { proveCredentialTransferEpochHandoff } from "./credential-transfer-epoch-handoff.proof.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";

const connectionString = process.env.DATABASE_URL;
requireI1DisposableDatabase(connectionString);
if (!connectionString) throw new Error("Disposable DATABASE_URL is required");

describe("credential transfer epoch handoff between separate PG pools", () => {
  it("serializes replacement after old COMMIT or ROLLBACK and rejects stale work", async () => {
    await runMigrations({ connectionString });
    const result = await proveCredentialTransferEpochHandoff(connectionString);
    expect(result.verdict).toBe("PASS_SCOPED_TWO_POOL_EPOCH_HANDOFF");
    expect(result.failureTypes).toEqual([]);
    expect(result.observations.map((item) => item.outcome)).toEqual([
      "commit",
      "rollback",
    ]);
    expect(result.checks.filter((item) => !item.passed)).toEqual([]);
    expect(Object.values(result.cleanup).every(Boolean)).toBe(true);
  }, 60_000);
});
