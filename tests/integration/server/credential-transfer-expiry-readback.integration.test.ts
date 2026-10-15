import { describe, expect, it } from "vitest";
import { proveExpiryReadback } from "./credential-transfer-expiry-readback.proof.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for disposable PostgreSQL tests");

describe("credential transfer expiry authoritative readback", () => {
  it("returns committed revisions/terminal states and propagates serialization conflicts", async () => {
    const result = await proveExpiryReadback(connectionString);
    expect(result.cleanup).toBe(true);
    expect(result.total).toBe(15);
    expect(result.checks.filter((check) => !check.passed)).toEqual([]);
    expect(result.passed).toBe(15);
  }, 60_000);
});
