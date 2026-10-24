import { describe, expect, it } from "vitest";
import {
  requestOtpChallenge,
  selectOtpVerifyAttempt,
  verifyOtpChallenge,
} from "./otp-outcome.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const validChallengeId = "22222222-2222-4222-8222-222222222222";
const validExpiry = "2026-10-23T05:30:00.000Z";
const acceptedChallenge = {
  status: "accepted",
  challengeId: validChallengeId,
  expiresAt: validExpiry,
};
const authenticated = { status: "authenticated", expiresAt: validExpiry };

describe("portal OTP request outcomes", () => {
  it("accepts only the documented 202 accepted challenge", async () => {
    expect(
      await requestOtpChallenge(async () => json(acceptedChallenge, 202)),
    ).toEqual({ kind: "READY", challengeId: validChallengeId });
  });

  it.each([
    null,
    {},
    { ...acceptedChallenge, challengeId: "" },
    { ...acceptedChallenge, challengeId: "   " },
    { ...acceptedChallenge, challengeId: 123 },
    { ...acceptedChallenge, challengeId: null },
    { ...acceptedChallenge, challengeId: "not-a-uuid" },
    { ...acceptedChallenge, status: "authenticated" },
    { ...acceptedChallenge, expiresAt: null },
    { ...acceptedChallenge, expiresAt: "2026-02-30T05:30:00.000Z" },
  ])(
    "does not advance on malformed successful challenge payload %#",
    async (payload) => {
      expect(await requestOtpChallenge(async () => json(payload, 202))).toEqual(
        {
          kind: "INVALID_RESPONSE",
        },
      );
    },
  );

  it.each([200, 201, 204, 206])(
    "rejects undocumented successful HTTP status %i for OTP request",
    async (status) => {
      const response =
        status === 204
          ? new Response(null, { status })
          : json(acceptedChallenge, status);
      expect(await requestOtpChallenge(async () => response)).toEqual({
        kind: "INVALID_RESPONSE",
      });
    },
  );

  it("rejects successful HTTP with invalid JSON", async () => {
    const result = await requestOtpChallenge(
      async () => new Response("not-json", { status: 202 }),
    );
    expect(result).toEqual({ kind: "INVALID_RESPONSE" });
  });

  it("handles a rejected network request without throwing", async () => {
    expect(
      await requestOtpChallenge(async () => {
        throw new TypeError("synthetic-network-error");
      }),
    ).toEqual({ kind: "UNAVAILABLE" });
  });

  it("checks HTTP status before interpreting an error body", async () => {
    const result = await requestOtpChallenge(
      async () => new Response("<html>service failure</html>", { status: 503 }),
    );
    expect(result).toEqual({ kind: "SERVER_ERROR" });
  });

  it("distinguishes rate limits and closed beta without disclosing response data", async () => {
    expect(
      await requestOtpChallenge(async () => json({ error: "unknown" }, 429)),
    ).toEqual({ kind: "RATE_LIMITED" });
    expect(
      await requestOtpChallenge(async () =>
        json(
          { error: { code: "BETA_CLOSED", detail: "synthetic-private" } },
          403,
        ),
      ),
    ).toEqual({ kind: "BETA_CLOSED" });
    expect(
      await requestOtpChallenge(async () =>
        json({ error: { code: "BETA_CAPACITY_REACHED" } }, 403),
      ),
    ).toEqual({ kind: "BETA_CLOSED" });
  });
});

describe("portal OTP verification outcomes", () => {
  it("requires the documented authenticated HTTP 200 response", async () => {
    expect(
      await verifyOtpChallenge(async () => json(authenticated, 200)),
    ).toEqual({ kind: "VERIFIED" });
  });

  it.each([201, 202, 204, 206])(
    "rejects undocumented successful HTTP status %i for verification",
    async (status) => {
      const response =
        status === 204
          ? new Response(null, { status })
          : json(authenticated, status);
      expect(await verifyOtpChallenge(async () => response)).toEqual({
        kind: "INVALID_RESPONSE",
      });
    },
  );

  it.each([
    null,
    {},
    { ...authenticated, status: "accepted" },
    { ...authenticated, expiresAt: null },
    { ...authenticated, expiresAt: "2026-02-30T05:30:00.000Z" },
  ])("rejects malformed HTTP 200 verification body %#", async (body) => {
    expect(await verifyOtpChallenge(async () => json(body, 200))).toEqual({
      kind: "INVALID_RESPONSE",
    });
  });

  it("rejects HTTP 200 without valid JSON rather than redirecting", async () => {
    expect(
      await verifyOtpChallenge(
        async () => new Response("not-json", { status: 200 }),
      ),
    ).toEqual({ kind: "INVALID_RESPONSE" });
  });

  it("preserves retryability on rejected network requests", async () => {
    expect(
      await verifyOtpChallenge(async () => {
        throw new Error("synthetic-network-error");
      }),
    ).toEqual({ kind: "UNAVAILABLE" });
  });

  it("distinguishes a server outage from a wrong OTP", async () => {
    expect(
      await verifyOtpChallenge(
        async () => new Response("<html>unavailable</html>", { status: 503 }),
      ),
    ).toEqual({ kind: "SERVER_ERROR" });
  });

  it("does not mistake rejected or non-JSON responses for success", async () => {
    expect(
      await verifyOtpChallenge(
        async () => new Response("<html>rejected</html>", { status: 401 }),
      ),
    ).toEqual({ kind: "CODE_REJECTED" });
    expect(
      await verifyOtpChallenge(async () =>
        json({ error: { code: "INVALID_OTP" } }, 400),
      ),
    ).toEqual({ kind: "CODE_REJECTED" });
  });

  it("distinguishes beta closure and rate limiting", async () => {
    expect(
      await verifyOtpChallenge(async () =>
        json({ error: { code: "BETA_CAPACITY_REACHED" } }, 403),
      ),
    ).toEqual({ kind: "BETA_CLOSED" });
    expect(
      await verifyOtpChallenge(async () =>
        json({ error: "rate-limited" }, 429),
      ),
    ).toEqual({ kind: "RATE_LIMITED" });
  });
});

describe("portal OTP verification idempotency identity", () => {
  it("reuses the original key for a retry of the same challenge and same code", () => {
    let minted = 0;
    const generate = () => `key-${++minted}`;
    const first = selectOtpVerifyAttempt(
      undefined,
      validChallengeId,
      "123456",
      generate,
    );
    const retry = selectOtpVerifyAttempt(
      first,
      validChallengeId,
      "123456",
      generate,
    );
    expect(retry).toBe(first);
    expect(minted).toBe(1);
  });

  it("uses a new key when the user corrects the code on the same challenge", () => {
    let minted = 0;
    const generate = () => `key-${++minted}`;
    const wrong = selectOtpVerifyAttempt(
      undefined,
      validChallengeId,
      "111111",
      generate,
    );
    const corrected = selectOtpVerifyAttempt(
      wrong,
      validChallengeId,
      "222222",
      generate,
    );
    expect(corrected.key).not.toBe(wrong.key);
    expect(corrected.code).toBe("222222");
    expect(minted).toBe(2);
  });

  it("does not share a verification key between different challenges", () => {
    let minted = 0;
    const generate = () => `key-${++minted}`;
    const old = selectOtpVerifyAttempt(
      undefined,
      validChallengeId,
      "123456",
      generate,
    );
    const renewed = selectOtpVerifyAttempt(
      old,
      "33333333-3333-4333-8333-333333333333",
      "123456",
      generate,
    );
    expect(renewed.key).not.toBe(old.key);
    expect(minted).toBe(2);
  });
});
