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
          ttlMs: number;
        }
      | undefined;
    const clock = new Date("2030-01-01T00:00:00.000Z");
    const service = new BetaAdmissionService({
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
    });
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
    expect(captured!.ttlMs).toBe(24 * 60 * 60_000);
  });

  it("passes the configured 24-hour TTL as a duration independent of app clock skew", async () => {
    const fastAppClock = new Date("2026-10-16T12:00:00.000Z");
    let request: Record<string, unknown> | undefined;
    const service = new BetaAdmissionService({
      resolve: async () => ({ kind: "NONE" }),
      read: async () => ({
        mode: "CLOSED",
        capacity: 1,
        admitted: 0,
        remaining: 1,
        revision: 1,
        updatedAt: fastAppClock,
      }),
      mutate: async () => ({ kind: "CONFLICT" }),
      readIdentityInvitation: async () => null,
      inviteIdentity: async (input) => {
        request = input as unknown as Record<string, unknown>;
        return { kind: "CONFLICT" as const };
      },
      revokeIdentityInvitation: async () => ({ kind: "NOT_FOUND" as const }),
    });
    await service.createIdentityInvitation({
      actorPrincipalId: "11111111-1111-4111-8111-111111111111",
      requestId: "ttl-clock-skew-1",
      correlationId: "ttl-clock-skew",
      expectedRevision: 1,
      normalizedIdentityTarget: "ttl@example.test",
      reason: "synthetic TTL",
    });
    expect(request?.ttlMs).toBe(24 * 60 * 60_000);
  });

  it("rejects local-part controls and invisible direction overrides before inviting an identity", async () => {
    let repositoryCalls = 0;
    const service = new BetaAdmissionService({
      resolve: async () => ({ kind: "NONE" }),
      read: async () => ({
        mode: "CLOSED",
        capacity: 1,
        admitted: 0,
        remaining: 1,
        revision: 1,
        updatedAt: new Date(),
      }),
      mutate: async () => ({ kind: "CONFLICT" }),
      readIdentityInvitation: async () => null,
      inviteIdentity: async () => {
        repositoryCalls++;
        return { kind: "NOT_FOUND" as const };
      },
      revokeIdentityInvitation: async () => ({ kind: "NOT_FOUND" as const }),
    });
    const request = {
      actorPrincipalId: "synthetic-beta-admin",
      requestId: "synthetic-localpart-controls",
      correlationId: "synthetic-localpart-correlation",
      expectedRevision: 1,
      reason: "synthetic invitation identity validation",
    };
    for (const normalizedIdentityTarget of [
      "reader\u0000tag@example.test",
      "reader\u0001tag@example.test",
      "reader\u001ftag@example.test",
      "reader\u007ftag@example.test",
      "reader\u0085tag@example.test",
      "reader\u061ctag@example.test",
      "reader\u200etag@example.test",
      "reader\u202etag@example.test",
      "reader\u2066tag@example.test",
    ]) {
      await expect(
        service.createIdentityInvitation({
          ...request,
          normalizedIdentityTarget,
        }),
      ).resolves.toEqual({ kind: "CONFLICT" });
    }
    expect(repositoryCalls).toBe(0);
    await service.createIdentityInvitation({
      ...request,
      normalizedIdentityTarget: "mañana+tag@bücher.example",
    });
    expect(repositoryCalls).toBe(1);
  });

  it("rejects malformed invitation domain labels before repository mutation", async () => {
    let invitations = 0;
    const forwardedTargets: string[] = [];
    const service = new BetaAdmissionService({
      resolve: async () => ({ kind: "NONE" }),
      read: async () => ({
        mode: "CLOSED",
        capacity: 1,
        admitted: 0,
        remaining: 1,
        revision: 1,
        updatedAt: new Date(),
      }),
      mutate: async () => ({ kind: "CONFLICT" }),
      readIdentityInvitation: async () => null,
      inviteIdentity: async (input) => {
        invitations += 1;
        forwardedTargets.push(input.normalizedIdentityTarget);
        return { kind: "CONFLICT" as const };
      },
      revokeIdentityInvitation: async () => ({ kind: "NOT_FOUND" as const }),
    });
    const request = {
      actorPrincipalId: "synthetic-beta-admin",
      requestId: "synthetic-invitation-request",
      correlationId: "synthetic-correlation",
      expectedRevision: 1,
      reason: "domain validation regression",
    };
    for (const normalizedIdentityTarget of [
      "reviewer@.example.test",
      "reviewer@example..test",
      "reviewer@example.test.",
      "reviewer@-example.test",
      "reviewer@example-.test",
      "reviewer@a_b.test",
      "reviewer@a!b.test",
      "reviewer@a+b.test",
      "reviewer@a\u05d0.example",
      "reviewer@\u05d0a.example",
      "reviewer@ab\u200dcd.example",
      "reviewer@ab\u200ccd.example",
      "reviewer@xn--.example",
      "reviewer@ab--cd.example",
      `reviewer@${[63, 63, 63, 62].map((n, i) => String.fromCharCode(97 + i).repeat(n)).join(".")}`,
      `reviewer@${"a".repeat(64)}.test`,
      `reviewer@${"ü".repeat(64)}.test`,
      `reviewer@${["a", "b", "c", "d"].map((letter) => letter.repeat(63)).join(".")}`,
    ]) {
      await expect(
        service.createIdentityInvitation({
          ...request,
          normalizedIdentityTarget,
        }),
      ).resolves.toEqual({ kind: "CONFLICT" });
    }
    expect(invitations).toBe(0);
    const validTargets = [
      "reviewer+tag@bücher.example",
      "reviewer@\u05e9\u05dc\u05d5\u05dd.example",
      `reviewer@${[63, 63, 63, 61].map((n, i) => String.fromCharCode(97 + i).repeat(n)).join(".")}`,
      `reviewer@${"a".repeat(63)}.test`,
      `reviewer@${"ü".repeat(50)}.test`,
    ];
    for (const normalizedIdentityTarget of validTargets) {
      await service.createIdentityInvitation({
        ...request,
        normalizedIdentityTarget,
      });
    }
    expect(invitations).toBe(5);
    expect(forwardedTargets).toEqual(validTargets);
  });
});
