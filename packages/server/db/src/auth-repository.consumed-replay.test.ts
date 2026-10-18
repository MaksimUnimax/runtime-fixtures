import { describe, expect, it, vi } from "vitest";
import { createAuthRepository } from "./auth-repository.js";
import type { DatabaseRuntime } from "./index.js";

const FUTURE = new Date("2040-01-01T00:00:00.000Z");
function replayFixture() {
  const sqls: string[] = [];
  const query = async (sql: string) => {
    sqls.push(sql);
    if (sql.startsWith("INSERT INTO auth_rate_limit_buckets")) {
      return { rows: [{ count: 1 }] };
    }
    if (sql.startsWith("SELECT * FROM otp_challenges")) {
      return {
        rows: [
          {
            id: "synthetic-consumed-challenge",
            normalized_identity_target: "seller@example.test",
            verification_hash: "synthetic-stored-artifact",
            attempt_count: 0,
            max_attempts: 5,
            expires_at: FUTURE,
            consumed_at: new Date("2026-10-01T00:00:00Z"),
            invalidated_at: null,
          },
        ],
      };
    }
    if (
      sql.startsWith("SELECT r.user_id,s.expires_at FROM otp_verify_replays")
    ) {
      return { rows: [{ user_id: "synthetic-user", expires_at: FUTURE }] };
    }
    throw new Error("UNEXPECTED_SYNTHETIC_SQL");
  };
  const runtime = {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ query }),
  } as unknown as DatabaseRuntime;
  return { repository: createAuthRepository(runtime), sqls };
}
function input(verify: (identity: string, artifact: string) => boolean) {
  return {
    challengeId: "synthetic-consumed-challenge",
    code: "654321",
    ipKey: "synthetic-ip",
    correlationId: "synthetic-request",
    idempotencyHash: "synthetic-opaque-replay-key",
    verify,
    sessionHash: "synthetic-session-hash",
    expiresAt: FUTURE,
  };
}
describe("consumed OTP replay code validation (synthetic repository boundary)", () => {
  it("rejects wrong code even with an existing matching idempotency key", async () => {
    const { repository, sqls } = replayFixture();
    const verify = vi.fn(() => false);
    const result = await repository.verifyOtp(input(verify));
    expect(result).toEqual({ ok: false, code: "AUTH_OTP_INVALID" });
    expect(verify).toHaveBeenCalledExactlyOnceWith(
      "seller@example.test",
      "synthetic-stored-artifact",
    );
    expect(
      sqls.some((sql) => sql.includes("SELECT r.user_id,s.expires_at")),
    ).toBe(false);
    expect(
      sqls.some((sql) =>
        sql.includes("UPDATE otp_challenges SET attempt_count"),
      ),
    ).toBe(false);
  });
  it("preserves correct-code replay of the still-active original session", async () => {
    const { repository } = replayFixture();
    const verify = vi.fn(() => true);
    const result = await repository.verifyOtp(input(verify));
    expect(result).toEqual({
      ok: true,
      value: { sessionToken: "", expiresAt: FUTURE },
    });
    expect(verify).toHaveBeenCalledExactlyOnceWith(
      "seller@example.test",
      "synthetic-stored-artifact",
    );
  });
});
