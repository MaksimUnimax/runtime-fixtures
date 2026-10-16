import { describe, expect, it } from "vitest";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { proveCredentialTransferTestAuthority } from "./credential-transfer-test-authority.proof.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Disposable DATABASE_URL required");
const name = new URL(connectionString).pathname.slice(1);
if (
  name !== "octoport_a_test" &&
  name !== "octoport_b_test" &&
  name !== "octoport_c_test" &&
  name !== "product_control_plane_test"
)
  throw new Error("Unexpected disposable transfer test database");
const expectedDatabase = name;

describe("explicit credential-transfer test authority", () => {
  it("keeps mandatory fencing while adapting ordinary test consumers", async () => {
    await runMigrations({ connectionString });
    const result = await proveCredentialTransferTestAuthority(
      connectionString,
      expectedDatabase,
    );
    expect(result.verdict).toBe("PASS_SCOPED_TEST_CONSUMER_AUTHORITY");
    expect(result.checks.filter((check) => !check.passed)).toEqual([]);
    expect(Object.values(result.cleanup).every(Boolean)).toBe(true);
  }, 45_000);
});
