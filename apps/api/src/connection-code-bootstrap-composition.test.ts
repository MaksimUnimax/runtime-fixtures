import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BootstrapService } from "@product/bootstrap";
import {
  ConnectionCodeService,
  type ConnectionCodeRepository,
} from "@product/device-management";
import {
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
  ExtensionAuthService,
  type AccessTokenIdentity,
  type ExtensionAuthRepository,
} from "@product/extension-auth";
import {
  signBootstrapSnapshot,
  signBootstrapSnapshotV2,
  verifyBootstrapEnvelopeV2,
} from "@product/remote-config";
import type { AppConfig } from "@product/shared";
import { createApiApp } from "./app.js";

// Exercise the real route/service/token/signature chain. Persistence and the
// admission decision are explicit in-memory fixtures; this is not a DB, browser,
// real grant, credential-transfer approval, or marketplace acceptance test.
const uuid = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const accountId = uuid(1);
const first = { accountId, deviceId: uuid(2), sessionId: uuid(3) };
const second = { accountId, deviceId: uuid(4), sessionId: uuid(5) };
const now = new Date("2030-01-01T12:00:00.000Z");
const code = "octo1_" + Buffer.alloc(32, 7).toString("base64url");
const aiKeys = [
  "ai.chatgpt",
  "ai.alice",
  "ai.qwen",
  "ai.deepseek",
  "ai.grok",
  "ai.claude",
  "ai.gemini",
  "ai.kimi",
] as const;
const config: AppConfig = {
  environment: "test",
  databaseUrl: "postgres://fixture@localhost:5432/unused_composition_fixture",
  logLevel: "silent" as AppConfig["logLevel"],
  apiPort: 0,
  workerReadyDelayMs: 0,
};

function fixture() {
  const root = Buffer.alloc(32, 23);
  const accessSigning = createEphemeralAccessTokenSigningKey(
    "synthetic-composition-access",
  );
  const snapshotSigning = generateKeyPairSync("ed25519");
  const active = new Map<string, AccessTokenIdentity>([
    [first.sessionId, first],
    [second.sessionId, second],
  ]);
  let betaEnabled = true;
  const unused = async () => {
    throw new Error("unused fixture method");
  };
  const exchange = vi
    .fn<ConnectionCodeRepository["exchange"]>()
    .mockResolvedValueOnce({
      kind: "activated",
      ...first,
      refreshTokenExpiresAt: new Date("2030-01-31T12:00:00.000Z"),
    })
    .mockResolvedValueOnce({
      kind: "activated",
      ...second,
      refreshTokenExpiresAt: new Date("2030-01-31T12:00:00.000Z"),
    });
  const repository: ConnectionCodeRepository = {
    consumeRate: async () => ({ allowed: true }),
    exchange,
    issue: unused,
    status: unused,
    listTransferDevices: unused,
    approveTransfer: unused,
  };
  const authRepository: ExtensionAuthRepository = {
    authorize: async (sessionId) => active.get(sessionId),
    consumeRefreshRate: unused,
    authorizeFromRefreshHash: unused,
    createRefresh: unused,
    rotateRefresh: unused,
  };
  const connection = new ConnectionCodeService(
    repository,
    root,
    accessSigning,
    { resolve: async () => ({ kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT" }) },
    () => now,
  );
  const auth = new ExtensionAuthService(
    authRepository,
    deriveExtensionAuthKeys(root),
    () => now,
    accessSigning,
  );
  const beta = {
    resolve: vi.fn(async (_accountId: string) =>
      betaEnabled ? { kind: "BETA" as const } : { kind: "NONE" as const },
    ),
  };
  const bootstrap = new BootstrapService(
    {
      resolve: async () => ({
        configVersion: 1,
        signingKeyId: "synthetic-composition-bootstrap",
        sourceFingerprintSha256: "a".repeat(64),
        compatibility: {
          extension: { status: "SUPPORTED" as const, minimumVersion: "0.2.42" },
          browser: { status: "SUPPORTED" as const },
        },
        features: {},
      }),
    },
    {
      sign: async (_key, payload) =>
        signBootstrapSnapshot(
          payload,
          "synthetic-composition-bootstrap",
          snapshotSigning.privateKey,
        ),
      signV2: async (_key, payload) =>
        signBootstrapSnapshotV2(
          payload,
          "synthetic-composition-bootstrap",
          snapshotSigning.privateKey,
        ),
    },
    { now: () => now },
    undefined,
    undefined,
    beta,
  );
  const app = createApiApp({
    config,
    isInfrastructureReady: async () => true,
    connectionCodeService: connection,
    extensionAuthService: auth,
    bootstrapService: bootstrap,
  });
  type Enrollment = {
    accountId: string;
    deviceId: string;
    sessionId: string;
    accessToken: string;
    refreshToken: string;
    authenticationMethod: string;
  };
  async function connect(attempt: number) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/connection-codes/exchange",
      headers: {
        "idempotency-key": `synthetic-composition-attempt-${attempt}`,
      },
      payload: { code },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.body.includes(code)).toBe(false);
    const enrollment = response.json<Enrollment>();
    expect(enrollment.authenticationMethod).toBe("ACCOUNT_CONNECTION_CODE");
    return enrollment;
  }
  function requestBootstrap(
    enrollment: Enrollment,
    deviceId = enrollment.deviceId,
  ) {
    return app.inject({
      method: "POST",
      url: "/v1/bootstrap",
      headers: { authorization: `Bearer ${enrollment.accessToken}` },
      payload: {
        contractVersion: "control_plane_v2",
        extensionVersion: "0.2.42",
        browser: { family: "chrome", version: "130" },
        deviceId,
        lastConfigVersion: null,
      },
    });
  }
  function verified(response: { json: () => unknown }) {
    const result = verifyBootstrapEnvelopeV2(
      response.json(),
      new Map([["synthetic-composition-bootstrap", snapshotSigning.publicKey]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("synthetic signature verification failed");
    return result.payload;
  }
  return {
    app,
    connect,
    requestBootstrap,
    verified,
    exchange,
    active,
    beta,
    setBeta: (value: boolean) => {
      betaEnabled = value;
    },
  };
}

describe("connection code to signed bootstrap composition", () => {
  it("keeps two independent sessions on the same account and all eight beta AI keys", async () => {
    const f = fixture();
    try {
      const one = await f.connect(1),
        two = await f.connect(2);
      expect(one).toMatchObject(first);
      expect(two).toMatchObject(second);
      expect(one.accessToken === two.accessToken).toBe(false);
      expect(one.refreshToken === two.refreshToken).toBe(false);
      for (const enrollment of [one, two]) {
        const response = await f.requestBootstrap(enrollment);
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        const payload = f.verified(response);
        expect(payload.account.id).toBe(accountId);
        expect(payload.accessBasis).toBe("BETA");
        expect(payload.devicePolicy.status).toBe("ACTIVE");
        for (const key of aiKeys) expect(payload.entitlements[key]).toBe(true);
      }
      expect(f.exchange).toHaveBeenCalledTimes(2);
      expect(f.beta.resolve.mock.calls.map(([id]) => id)).toEqual([
        accountId,
        accountId,
      ]);
    } finally {
      await f.app.close();
    }
  });

  it("rejects a foreign device and changed or inactive session identity without disabling the other installation", async () => {
    const f = fixture();
    try {
      const one = await f.connect(1),
        two = await f.connect(2);
      expect((await f.requestBootstrap(one, two.deviceId)).statusCode).toBe(
        403,
      );
      f.active.set(one.sessionId, { ...first, accountId: uuid(99) });
      expect((await f.requestBootstrap(one)).statusCode).toBe(401);
      f.active.delete(one.sessionId);
      expect((await f.requestBootstrap(one)).statusCode).toBe(401);
      const surviving = await f.requestBootstrap(two);
      expect(surviving.statusCode).toBe(200);
      expect(f.verified(surviving).account.id).toBe(accountId);
    } finally {
      await f.app.close();
    }
  });

  it("does not turn a valid connection session into beta access when admission becomes NONE", async () => {
    const f = fixture();
    try {
      const enrollment = await f.connect(1);
      const before = await f.requestBootstrap(enrollment);
      expect(before.statusCode).toBe(200);
      expect(f.verified(before).accessBasis).toBe("BETA");
      f.setBeta(false);
      const after = await f.requestBootstrap(enrollment);
      expect(after.statusCode).toBe(200);
      const payload = f.verified(after);
      expect(payload.account.id).toBe(accountId);
      expect(payload.accessBasis).toBe("NONE");
      for (const key of aiKeys)
        expect(payload.entitlements[key]).not.toBe(true);
    } finally {
      await f.app.close();
    }
  });
});
