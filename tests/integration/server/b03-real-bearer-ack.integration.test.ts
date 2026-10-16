import { describe, expect, it } from "vitest";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { proveSignedBearerAckWithTransferAuthority } from "./b03-real-bearer-ack.proof.js";

const configuredUrl = process.env.DATABASE_URL;
if (!configuredUrl)
  throw new Error("DATABASE_URL is required for real PostgreSQL tests");
const connectionString = configuredUrl;
const name = new URL(connectionString).pathname.slice(1);
if (
  name !== "octoport_a_test" &&
  name !== "octoport_b_test" &&
  name !== "octoport_c_test" &&
  name !== "product_control_plane_test"
)
  throw new Error("Unexpected disposable transfer test database");
const expectedDatabase = name;

describe.sequential("B03 signed access through real ACK route", () => {
  it("recovers a committed ACK after losing its response with a real signed bearer", async () => {
    await runMigrations({ connectionString });
    const result = await proveSignedBearerAckWithTransferAuthority(
      connectionString,
      expectedDatabase,
    );
    expect(result.verdict).toBe("PASS_SCOPED_EXISTING_HTTP_ACK_CONSUMER");
    expect(result.checks).toHaveLength(6);
  }, 45_000);
});
