import { describe, expect, it } from "vitest";
import {
  BetaAdmissionService,
  betaPayloadHash,
  betaRequestIdHash,
} from "./index.js";

describe("S1.1 beta admission domain", () => {
  it("uses explicit modes and one-way request identities", () => {
    expect(betaRequestIdHash("request-123456789")).not.toContain(
      "request-123456789",
    );
    expect(
      betaPayloadHash({
        requestId: "request-123456789",
        expectedRevision: 1,
        action: "ADD_CAPACITY",
        amount: 100,
        reason: "launch",
      }),
    ).toBe(
      betaPayloadHash({
        requestId: "request-123456789",
        expectedRevision: 1,
        action: "ADD_CAPACITY",
        amount: 100,
        reason: "launch",
      }),
    );
  });

  it("rejects malformed capacity commands before repository mutation", async () => {
    let calls = 0;
    const service = new BetaAdmissionService({
      resolve: async () => ({ kind: "NONE" }),
      read: async () => ({
        mode: "CLOSED",
        capacity: 0,
        admitted: 0,
        remaining: 0,
        revision: 1,
        updatedAt: new Date(),
      }),
      mutate: async () => {
        calls += 1;
        return { kind: "CONFLICT" };
      },
      readIdentityInvitation: async () => null,
      inviteIdentity: async () => ({ kind: "CONFLICT" as const }),
      revokeIdentityInvitation: async () => ({ kind: "NOT_FOUND" as const }),
    });
    await expect(
      service.mutate({
        actorPrincipalId: "actor",
        requestId: "request-123456789",
        correlationId: "corr",
        expectedRevision: 1,
        action: "ADD_CAPACITY",
        amount: 0,
        reason: "bad",
      }),
    ).resolves.toEqual({ kind: "CONFLICT" });
    expect(calls).toBe(0);
  });

  it("binds targeted invitation input without exposing the normalized email in hashes", async () => {
    let captured:
      | {
          requestIdHash: string;
          payloadHash: string;
          identityHash: string;
          expiresAt: Date;
        }
      | undefined;
    const clock = new Date("2030-01-01T00:00:00.000Z");
    const service = new BetaAdmissionService(
      {
        resolve: async () => ({ kind: "NONE" }),
        read: async () => ({
          mode: "CLOSED",
          capacity: 1,
          admitted: 0,
          remaining: 1,
          revision: 1,
          updatedAt: clock,
        }),
        mutate: async () => ({ kind: "CONFLICT" }),
        readIdentityInvitation: async () => null,
        inviteIdentity: async (input) => {
          captured = input;
          return { kind: "CONFLICT" as const };
        },
        revokeIdentityInvitation: async () => ({ kind: "NOT_FOUND" as const }),
      },
      () => clock,
    );
    await service.createIdentityInvitation({
      actorPrincipalId: "actor",
      requestId: "invite-request-1234",
      correlationId: "corr",
      expectedRevision: 1,
      normalizedIdentityTarget: "reviewer@example.test",
      reason: "store reviewer",
    });
    expect(captured).toBeDefined();
    expect(captured!.requestIdHash).not.toContain("invite-request-1234");
    expect(captured!.payloadHash).not.toContain("reviewer@example.test");
    expect(captured!.identityHash).not.toContain("reviewer@example.test");
    expect(captured!.expiresAt.toISOString()).toBe("2030-01-02T00:00:00.000Z");
  });
});
