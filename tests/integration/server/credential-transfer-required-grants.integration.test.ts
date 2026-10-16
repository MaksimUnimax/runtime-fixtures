import { describe, expect, it } from "vitest";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";
import { proveCredentialTransferRequiredGrants } from "./credential-transfer-required-grants.proof.js";

const connectionString = process.env.DATABASE_URL;
requireI1DisposableDatabase(connectionString);
if (!connectionString) throw new Error("Disposable DATABASE_URL is required");

describe("required repository grants before API election", () => {
  it("rejects each missing grant without election or self-grant", async () => {
    await runMigrations({ connectionString });
    const result =
      await proveCredentialTransferRequiredGrants(connectionString);
    console.info("C06_REQUIRED_GRANTS_RESULT " + JSON.stringify(result));
    expect(result.verdict).toBe("PASS_SCOPED_REQUIRED_REPOSITORY_GRANTS");
    expect(result.observations).toHaveLength(6);
    expect(
      result.observations.every(
        (item) => item.rejected && !item.electionChanged,
      ),
    ).toBe(true);
    expect(result.excessObservations).toHaveLength(11);
    expect(
      result.excessObservations.every(
        (item) => item.rejected && !item.electionChanged,
      ),
    ).toBe(true);
    expect(result.membershipObservation).toEqual({
      rejected: true,
      electionChanged: false,
      setOption: true,
    });
    expect(result.checks.filter((item) => !item.passed)).toEqual([]);
    expect(result.failureTypes).toEqual([]);
    expect(Object.values(result.cleanup).every(Boolean)).toBe(true);
  }, 60_000);
});
