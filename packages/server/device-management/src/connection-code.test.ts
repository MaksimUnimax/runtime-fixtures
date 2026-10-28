import { describe, expect, it, vi } from "vitest";
import {
  createEphemeralAccessTokenSigningKey,
  deriveActivationRefreshToken,
  deriveExtensionAuthKeys,
  verifyAccessToken,
} from "@product/extension-auth";
import {
  CONNECTION_OWNER_FRESHNESS_MS,
  ConnectionCodeService,
  connectionCodeVerifier,
  connectionOperationHash,
  connectionRefreshToken,
  deriveConnectionCodeKeys,
  generateConnectionCode,
  validConnectionCode,
  type ConnectionCodeRepository,
  type ConnectionPortalPrincipal,
} from "./connection-code.js";

const now = new Date("2030-01-01T12:00:00.000Z");
const root = Buffer.alloc(32, 17);
const signing = createEphemeralAccessTokenSigningKey(
  "synthetic-connection-code",
);
const accountId = "10000000-0000-4000-8000-000000000001";
const principal: ConnectionPortalPrincipal = {
  userId: "10000000-0000-4000-8000-000000000002",
  sessionId: "10000000-0000-4000-8000-000000000003",
  authenticatedAt: now,
};
const credential = {
  credentialId: "10000000-0000-4000-8000-000000000004",
  generation: 1,
  createdAt: now,
  active: true,
};
const activation = {
  kind: "activated" as const,
  accountId,
  deviceId: "10000000-0000-4000-8000-000000000005",
  sessionId: "10000000-0000-4000-8000-000000000006",
  refreshTokenExpiresAt: new Date("2030-01-31T12:00:00.000Z"),
};
const code = generateConnectionCode(Buffer.alloc(32, 7));
const idempotencyKey = "synthetic-enroll-attempt-0001";
const peerIp = "198.51.100.17";
const issueInput = {
  accountId,
  mode: "CREATE" as const,
  expectedGeneration: 0,
  idempotencyKey,
};
function fixture(overrides: Partial<ConnectionCodeRepository> = {}) {
  const consumeRate = vi
    .fn<ConnectionCodeRepository["consumeRate"]>()
    .mockResolvedValue({ allowed: true });
  const issue = vi
    .fn<ConnectionCodeRepository["issue"]>()
    .mockResolvedValue({ kind: "created", credential, revokedDevices: 0 });
  const exchange = vi
    .fn<ConnectionCodeRepository["exchange"]>()
    .mockResolvedValue(activation);
  const status = vi
    .fn<ConnectionCodeRepository["status"]>()
    .mockResolvedValue({ kind: "ok", credential });
  const repository: ConnectionCodeRepository = {
    listTransferDevices: vi.fn().mockResolvedValue({ kind: "ok", devices: [] }),
    approveTransfer: vi.fn().mockResolvedValue({
      kind: "approved",
      deviceId: activation.deviceId,
      approvedAt: now,
    }),
    consumeRate,
    issue,
    exchange,
    status,
    ...overrides,
  };
  const resolve = vi.fn().mockResolvedValue({
    kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT" as const,
  });
  return {
    service: new ConnectionCodeService(
      repository,
      root,
      signing,
      { resolve },
      () => now,
      () => Buffer.alloc(32, 7),
    ),
    consumeRate,
    issue,
    exchange,
    status,
    resolve,
  };
}

describe("connection code: secret lifecycle and enrollment service", () => {
  it("accepts only a canonical 32-byte secret, never a public account ID or user code", () => {
    expect(validConnectionCode(code)).toBe(true);
    for (const bad of [
      accountId,
      "ABCD-EFGH",
      "123456",
      code + "=",
      " " + code,
      code + "\n",
      code.slice(1),
      null,
      {},
      generateConnectionCode(Buffer.alloc(32)).slice(0, -1) + "B",
    ])
      expect(validConnectionCode(bad)).toBe(false);
    expect(() => generateConnectionCode(Buffer.alloc(16))).toThrow();
    expect(() => deriveConnectionCodeKeys(Buffer.alloc(16))).toThrow();
  });

  it("separates verification, operations, rates and old activation refresh derivation", () => {
    const keys = deriveConnectionCodeKeys(root);
    const verifier = connectionCodeVerifier(keys, code);
    expect(verifier).not.toContain(code);
    expect(
      new Set(Object.values(keys).map((key) => key.toString("hex"))).size,
    ).toBe(5);
    expect(connectionOperationHash(keys, "issue", idempotencyKey)).not.toBe(
      connectionOperationHash(keys, "exchange", idempotencyKey),
    );
    expect(connectionRefreshToken(keys, code, idempotencyKey)).not.toBe(
      deriveActivationRefreshToken(
        deriveExtensionAuthKeys(root),
        code,
        idempotencyKey,
      ),
    );
    expect(
      connectionCodeVerifier(
        deriveConnectionCodeKeys(Buffer.alloc(32, 18)),
        code,
      ),
    ).not.toBe(verifier);
  });

  it("reveals the new secret only on the original successful issuance", async () => {
    const f = fixture();
    const result = await f.service.issue(
      issueInput,
      principal,
      "synthetic-correlation",
    );
    expect(result).toEqual({
      kind: "CREATED",
      code,
      credential,
      revokedDevices: 0,
    });
    const persisted = f.issue.mock.calls[0]![0];
    expect(persisted.verifierHash).toBe(
      connectionCodeVerifier(deriveConnectionCodeKeys(root), code),
    );
    expect(JSON.stringify(persisted)).not.toContain(code);
    expect(persisted.portalUserId).toBe(principal.userId);
    expect(persisted.portalSessionId).toBe(principal.sessionId);
    expect(persisted.freshAfter.getTime()).toBe(
      now.getTime() - CONNECTION_OWNER_FRESHNESS_MS,
    );
  });

  it("does not reveal a replacement secret or rotate again on an already committed issue", async () => {
    const f = fixture();
    f.issue.mockResolvedValue({ kind: "already-issued", credential });
    const result = await f.service.issue(
      issueInput,
      principal,
      "synthetic-correlation",
    );
    expect(result).toEqual({ kind: "ALREADY_ISSUED", credential });
    expect(result).not.toHaveProperty("code");
  });

  it.each([-1, CONNECTION_OWNER_FRESHNESS_MS + 1, Number.NaN])(
    "rejects non-fresh portal authority before touching issuance at age %s",
    async (age) => {
      const f = fixture();
      const result = await f.service.issue(
        issueInput,
        {
          ...principal,
          authenticatedAt: new Date(now.getTime() - age),
        },
        "synthetic-correlation",
      );
      expect(["REAUTH_REQUIRED", "INVALID"]).toContain(result.kind);
      expect(f.consumeRate).not.toHaveBeenCalled();
      expect(f.issue).not.toHaveBeenCalled();
    },
  );

  it("keeps ordinary and emergency replacement explicit and fingerprinted", async () => {
    const f = fixture();
    await f.service.issue(
      { ...issueInput, expectedGeneration: 1, mode: "REPLACE_KEEP_DEVICES" },
      principal,
      "synthetic-correlation",
    );
    await f.service.issue(
      { ...issueInput, expectedGeneration: 1, mode: "REPLACE_REVOKE_DEVICES" },
      principal,
      "synthetic-correlation",
    );
    const first = f.issue.mock.calls[0]![0],
      second = f.issue.mock.calls[1]![0];
    expect(first.operationHash).toBe(second.operationHash);
    expect(first.requestFingerprint).not.toBe(second.requestFingerprint);
    expect(first.mode).toBe("REPLACE_KEEP_DEVICES");
    expect(second.mode).toBe("REPLACE_REVOKE_DEVICES");
    expect(second.expectedGeneration).toBe(1);
  });

  it("refuses ambiguous create/replace intent without persistence", async () => {
    const f = fixture();
    for (const input of [
      { ...issueInput, expectedGeneration: 1 },
      { ...issueInput, mode: "REPLACE_KEEP_DEVICES" as const },
      { ...issueInput, expectedGeneration: -1 },
    ])
      expect(
        (await f.service.issue(input, principal, "synthetic-correlation")).kind,
      ).toBe("INVALID");
    expect(f.issue).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", "FORBIDDEN"],
    ["reauth-required", "REAUTH_REQUIRED"],
    ["conflict", "CONFLICT"],
  ] as const)(
    "preserves the repository issue denial %s",
    async (kind, expected) => {
      const f = fixture();
      f.issue.mockResolvedValue({ kind });
      expect(
        await f.service.issue(issueInput, principal, "synthetic-correlation"),
      ).toEqual({ kind: expected });
    },
  );

  it("rate-limits issuance without storing a new verifier", async () => {
    const f = fixture();
    f.consumeRate.mockResolvedValue({ allowed: false, retryAfterSeconds: 31 });
    expect(
      await f.service.issue(issueInput, principal, "synthetic-correlation"),
    ).toEqual({ kind: "RATE_LIMITED", retryAfterSeconds: 31 });
    expect(f.issue).not.toHaveBeenCalled();
  });

  it("exchanges for a signed independent device session and not an account-wide bearer", async () => {
    const f = fixture();
    const result = await f.service.exchange(
      { code, idempotencyKey },
      peerIp,
      "synthetic-correlation",
    );
    expect(result.kind).toBe("ACTIVATED");
    if (result.kind !== "ACTIVATED") throw new Error("activation expected");
    expect(result.refreshToken).not.toBe(code);
    expect(
      await verifyAccessToken(signing, result.accessToken, now),
    ).toMatchObject({
      accountId,
      deviceId: activation.deviceId,
      sessionId: activation.sessionId,
    });
    const persisted = f.exchange.mock.calls[0]![0];
    expect(persisted).not.toHaveProperty("accountId");
    expect(persisted).not.toHaveProperty("code");
    expect(JSON.stringify(persisted)).not.toContain(code);
    expect(JSON.stringify(f.consumeRate.mock.calls)).not.toContain(peerIp);
    expect(persisted.deviceLabel).toBeNull();
    await expect(persisted.resolveLimit(accountId, now)).resolves.toEqual({
      kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT",
    });
    expect(f.resolve).toHaveBeenCalledWith(accountId, now);
  });

  it("uses separate refresh credentials for separate installations with the same code", async () => {
    const f = fixture();
    const one = await f.service.exchange(
      { code, idempotencyKey },
      peerIp,
      "synthetic-correlation",
    );
    const two = await f.service.exchange(
      { code, idempotencyKey: idempotencyKey + "-other" },
      peerIp,
      "synthetic-correlation",
    );
    if (one.kind !== "ACTIVATED" || two.kind !== "ACTIVATED")
      throw new Error("activation expected");
    expect(one.refreshToken).not.toBe(two.refreshToken);
    expect(f.exchange.mock.calls[0]![0].operationHash).not.toBe(
      f.exchange.mock.calls[1]![0].operationHash,
    );
  });

  it("replays the same refresh credential without extending its durable expiry", async () => {
    const f = fixture();
    const expiry = new Date(now.getTime() + 10 * 60_000);
    f.exchange.mockResolvedValue({
      ...activation,
      kind: "replay",
      refreshTokenExpiresAt: expiry,
    });
    const one = await f.service.exchange(
      { code, idempotencyKey },
      peerIp,
      "synthetic-correlation",
    );
    const two = await f.service.exchange(
      { code, idempotencyKey },
      peerIp,
      "synthetic-correlation",
    );
    if (one.kind !== "ACTIVATED" || two.kind !== "ACTIVATED")
      throw new Error("activation expected");
    expect(one.replay).toBe(true);
    expect(one.refreshToken).toBe(two.refreshToken);
    expect(one.refreshTokenExpiresAt).toEqual(expiry);
  });

  it("binds an exchange retry to its original device label", async () => {
    const f = fixture();
    await f.service.exchange(
      { code, idempotencyKey, deviceLabel: "Browser one" },
      peerIp,
      "synthetic-correlation",
    );
    await f.service.exchange(
      { code, idempotencyKey, deviceLabel: "Browser two" },
      peerIp,
      "synthetic-correlation",
    );
    expect(f.exchange.mock.calls[0]![0].operationHash).toBe(
      f.exchange.mock.calls[1]![0].operationHash,
    );
    expect(f.exchange.mock.calls[0]![0].requestFingerprint).not.toBe(
      f.exchange.mock.calls[1]![0].requestFingerprint,
    );
  });

  it.each([
    ["closed", "CLOSED"],
    ["conflict", "CONFLICT"],
    ["limit", "DEVICE_LIMIT_REACHED"],
    ["subscription-required", "SUBSCRIPTION_REQUIRED"],
    ["invalid-limit", "SERVICE_UNAVAILABLE"],
  ] as const)(
    "does not mint access or refresh credentials after repository %s",
    async (kind, expected) => {
      const f = fixture();
      f.exchange.mockResolvedValue({ kind });
      expect(
        await f.service.exchange(
          { code, idempotencyKey },
          peerIp,
          "synthetic-correlation",
        ),
      ).toEqual({ kind: expected });
    },
  );

  it("fails closed for an expired durable refresh result", async () => {
    const f = fixture();
    f.exchange.mockResolvedValue({ ...activation, refreshTokenExpiresAt: now });
    expect(
      await f.service.exchange(
        { code, idempotencyKey },
        peerIp,
        "synthetic-correlation",
      ),
    ).toEqual({ kind: "SERVICE_UNAVAILABLE" });
  });

  it("rejects malformed enrollment before persistence and bounds labels", async () => {
    const f = fixture();
    for (const input of [
      { code: accountId, idempotencyKey },
      { code, idempotencyKey: "short" },
      { code, idempotencyKey, deviceLabel: "x".repeat(81) },
      { code, idempotencyKey, deviceLabel: "new\nbrowser" },
      { code, idempotencyKey, deviceLabel: "new\u0085browser" },
    ])
      expect(
        (await f.service.exchange(input, peerIp, "synthetic-correlation")).kind,
      ).toBe("INVALID");
    expect(f.exchange).not.toHaveBeenCalled();
    expect(f.consumeRate).not.toHaveBeenCalled();
  });

  it("blocks rate-limited enrollment without trying to issue a session", async () => {
    const f = fixture();
    f.consumeRate.mockResolvedValue({ allowed: false, retryAfterSeconds: 12 });
    expect(
      await f.service.exchange(
        { code, idempotencyKey },
        peerIp,
        "synthetic-correlation",
      ),
    ).toEqual({ kind: "RATE_LIMITED", retryAfterSeconds: 12 });
    expect(f.exchange).not.toHaveBeenCalled();
  });
});
