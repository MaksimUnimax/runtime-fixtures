import { describe, expect, it } from "vitest";
import {
  parseConnectionIssueAttempt,
  selectConnectionIssueAttempt,
  requestConnectionCode,
} from "./connection-code-outcome";
const accountId = "11111111-1111-4111-8111-111111111111";
const input = { accountId, expectedGeneration: 0, mode: "CREATE" as const };
const key = "11111111-2222-4333-8444-555555555555";
describe("connection issuance outcomes", () => {
  it("keeps the original intent and key after reload and rejects a changed account or mode", () => {
    const attempt = selectConnectionIssueAttempt(undefined, input, () => key);
    const restored = parseConnectionIssueAttempt(
      JSON.stringify(attempt),
      accountId,
    );
    expect(
      selectConnectionIssueAttempt(restored, input, () => {
        throw new Error("must not create another attempt");
      }),
    ).toEqual(attempt);
    expect(
      parseConnectionIssueAttempt(
        JSON.stringify(attempt),
        "99999999-9999-4999-8999-999999999999",
      ),
    ).toBeUndefined();
    expect(() =>
      selectConnectionIssueAttempt(
        restored,
        { ...input, mode: "REPLACE_REVOKE_DEVICES" },
        () => key,
      ),
    ).toThrow("CONNECTION_PREVIOUS_OUTCOME_UNKNOWN");
  });
  it("does not persist an extra code or accept malformed operation metadata", () => {
    expect(
      parseConnectionIssueAttempt(
        JSON.stringify({ input, key, code: "secret" }),
        accountId,
      ),
    ).toBeUndefined();
    expect(
      parseConnectionIssueAttempt(
        JSON.stringify({ input: { ...input, code: "secret" }, key }),
        accountId,
      ),
    ).toBeUndefined();
    expect(parseConnectionIssueAttempt("{", accountId)).toBeUndefined();
  });
  it("keeps network failure, truncation, malformed success and server failure unknown", async () => {
    for (const send of [
      () => Promise.reject(new Error("network")),
      async () => new Response("{"),
      async () => Response.json({ status: "created" }),
      async () =>
        Response.json({ error: { code: "INTERNAL_ERROR" } }, { status: 503 }),
    ])
      expect(await requestConnectionCode(send)).toEqual({ kind: "UNKNOWN" });
  });
  it("requires fresh login without abandoning the saved operation", async () => {
    expect(
      await requestConnectionCode(async () =>
        Response.json(
          { error: { code: "CONNECTION_REAUTH_REQUIRED" } },
          { status: 403 },
        ),
      ),
    ).toEqual({ kind: "REAUTH_REQUIRED" });
    expect(
      await requestConnectionCode(async () =>
        Response.json(
          { error: { code: "CONNECTION_CODE_RATE_LIMITED" } },
          { status: 429 },
        ),
      ),
    ).toEqual({ kind: "RATE_LIMITED" });
  });
  it("accepts a confirmed replay without inventing the one-time secret", async () => {
    const body = {
      status: "already_issued",
      credential: {
        credentialId: "22222222-2222-4222-8222-222222222222",
        generation: 1,
        createdAt: "2026-10-27T06:00:00.000Z",
        active: true,
      },
    };
    const response = await requestConnectionCode(async () =>
      Response.json(body),
    );
    expect(response.kind).toBe("CONFIRMED");
    if (response.kind === "CONFIRMED")
      expect("code" in response.value).toBe(false);
  });
});
