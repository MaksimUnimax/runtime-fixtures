import { describe, expect, it } from "vitest";
import { proveDatabaseRuntimeRecovery } from "./database-runtime-recovery.proof.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Disposable DATABASE_URL required");

describe.sequential("real PostgreSQL pool transaction recovery", () => {
  it("preserves first errors and removes unconfirmed connections without replay", async () => {
    // The proof validates the exact connected disposable identity before DDL.
    // It uses only its own scratch schema and does not need product migrations.
    const result = await proveDatabaseRuntimeRecovery(connectionString);
    expect(result.verdict).toBe("PASS_SCOPED_REAL_PG_POOL_RECOVERY");
    expect(result.total).toBe(53);
    expect(result.passed).toBe(53);
    expect(result.failureTypes).toEqual([]);
    expect(Object.values(result.cleanup).every(Boolean)).toBe(true);
  }, 60_000);
});
