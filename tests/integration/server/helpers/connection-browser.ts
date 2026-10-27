import { SyncService } from "../../../../packages/server/sync/src/index.js";
import { r5bAiResolution } from "../../../regression/extension-core/client-i1/fixture-profile.js";
import { CredentialTransferService } from "../../../../packages/server/credential-transfer/src/index.js";
import { generateKeyPairSync, createHash, randomUUID } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { DatabaseRuntime } from "../../../../packages/server/db/src/index.js";
import {
  createAuthRepository,
  createSyncRepository,
  createSyncSnapshotReader,
  createCredentialTransferEpochFence,
  createEpochFencedCredentialTransferRepository,
  createConnectionCodeRepository,
  createDeviceAuthorizationRepository,
  createDeviceManagementRepository,
  createExtensionAuthRepository,
} from "../../../../packages/server/db/src/index.js";
import {
  AuthService,
  deriveAuthKeys,
} from "../../../../packages/server/auth/src/index.js";
import {
  ConnectionCodeService,
  DeviceManagementService,
} from "../../../../packages/server/device-management/src/index.js";
import {
  DeviceAuthorizationService,
  deriveDeviceAuthKeys,
} from "../../../../packages/server/device-auth/src/index.js";
import {
  ExtensionAuthService,
  deriveExtensionAuthKeys,
  createEphemeralAccessTokenSigningKey,
} from "../../../../packages/server/extension-auth/src/index.js";
import { BootstrapService } from "../../../../packages/server/bootstrap/src/index.js";
import {
  signBootstrapSnapshot,
  signBootstrapSnapshotV2,
  signHealthClaimV1,
  verifyBootstrapEnvelopeV2,
} from "../../../../packages/server/remote-config/src/index.js";
import { createApiApp } from "../../../../apps/api/src/app.js";
import { validateIsolatedDatabaseUrl } from "../../../../tooling/server/isolated-auth-lifecycle.js";

export async function runConnectionBrowser(
  database: DatabaseRuntime,
  databaseUrl: string,
) {
  validateIsolatedDatabaseUrl(databaseUrl);
  const directory = process.env.SA_CONNECTION_BROWSER_ROOT;
  if (!directory || !directory.startsWith("/tmp/octoport-connection-r142-"))
    throw new Error("OWN_BROWSER_ROOT_REQUIRED");
  const pair = generateKeyPairSync("ed25519"),
    root = Buffer.alloc(32, 73),
    access = createEphemeralAccessTokenSigningKey("connection-browser-only");
  const limits = {
    resolve: async () => ({
      maxActive: 20,
      source: "ISOLATED_CONNECTION_BROWSER",
    }),
  };
  const spki = pair.publicKey.export({ type: "spki", format: "der" });
  const trustBundle = {
    trustBundleVersion: "bootstrap_trust_bundle_v1",
    algorithm: "Ed25519",
    publicKeyFormat: "spki_der",
    publicKeyEncoding: "base64",
    fingerprintAlgorithm: "sha256",
    fingerprintEncoding: "lowercase_hex",
    keys: [
      {
        keyId: "connection-browser-only",
        publicKey: spki.toString("base64"),
        fingerprintSha256: createHash("sha256").update(spki).digest("hex"),
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
  await writeFile(
    resolve(directory, "public-trust.json"),
    JSON.stringify(trustBundle),
    { mode: 0o644 },
  );
  const transferFence =
    process.env.SA_CONNECTION_BROWSER_SCENARIO === "key_transfer"
      ? createCredentialTransferEpochFence(database, randomUUID())
      : undefined;
  if (transferFence) await transferFence.claim();
  const app = createApiApp({
    config: {
      environment: "test",
      databaseUrl,
      logLevel: "fatal",
      apiPort: 43100,
      workerReadyDelayMs: 0,
    },
    isInfrastructureReady: async () => true,
    ...(transferFence
      ? {
          credentialTransferService: new CredentialTransferService(
            createEpochFencedCredentialTransferRepository(transferFence),
          ),
        }
      : {}),
    syncService: new SyncService(
      createSyncRepository(database),
      createSyncSnapshotReader(database),
    ),
    authService: new AuthService(
      createAuthRepository(database),
      deriveAuthKeys(root),
      undefined,
      () => "424242",
    ),
    connectionCodeService: new ConnectionCodeService(
      createConnectionCodeRepository(database),
      root,
      access,
      limits,
    ),
    deviceAuthorizationService: new DeviceAuthorizationService(
      createDeviceAuthorizationRepository(database),
      deriveDeviceAuthKeys(root),
    ),
    deviceManagementService: new DeviceManagementService(
      createDeviceManagementRepository(database),
      root,
      access,
      limits,
    ),
    extensionAuthService: new ExtensionAuthService(
      createExtensionAuthRepository(database),
      deriveExtensionAuthKeys(root),
      undefined,
      access,
    ),
    bootstrapService: new BootstrapService(
      {
        resolve: async () => ({
          configVersion: 1,
          signingKeyId: "connection-browser-only",
          sourceFingerprintSha256: createHash("sha256")
            .update(spki)
            .digest("hex"),
          compatibility: {
            extension: { status: "SUPPORTED", minimumVersion: null },
            browser: { status: "SUPPORTED" },
          },
          features: {},
        }),
      },
      {
        sign: async (id, payload) =>
          signBootstrapSnapshot(payload, id, pair.privateKey),
        signV2: async (id, payload) =>
          signBootstrapSnapshotV2(payload, id, pair.privateKey),
        signHealth: async (id, claim) =>
          signHealthClaimV1(claim, id, pair.privateKey),
      },
      undefined,
      undefined,
      process.env.SA_CONNECTION_BROWSER_SCENARIO === "work_cycle"
        ? r5bAiResolution
        : undefined,
      { resolve: async () => ({ kind: "BETA" as const }) },
      undefined,
      {
        resolve: async () => {
          const observedAt = new Date();
          return {
            status: "PASS" as const,
            observedAt,
            expiresAt: new Date(observedAt.getTime() + 60000),
          };
        },
      },
      {
        verifyV2: (input) =>
          verifyBootstrapEnvelopeV2(
            input,
            new Map([["connection-browser-only", pair.publicKey]]),
          ),
      },
    ),
  });
  const requests: Array<{ method: string; path: string; status: number }> = [];
  const exchangeEvidence: Array<{
    attemptSha256: string;
    accountId: string;
    deviceId: string;
    sessionId: string;
    responseDropped: boolean;
  }> = [];
  const syncEvidence: Array<{
    outcomes: string[];
    codes: Array<string | null>;
  }> = [];
  app.addHook("onSend", async (request, _reply, payload) => {
    if (
      process.env.SA_CONNECTION_BROWSER_SCENARIO === "auth_recovery" &&
      request.url === "/v1/connection-codes/exchange" &&
      _reply.statusCode === 200 &&
      typeof payload === "string"
    ) {
      const body = JSON.parse(payload) as {
        accountId: string;
        deviceId: string;
        sessionId: string;
      };
      const drop = exchangeEvidence.length === 1;
      exchangeEvidence.push({
        attemptSha256: createHash("sha256")
          .update(String(request.headers["idempotency-key"]))
          .digest("hex"),
        accountId: body.accountId,
        deviceId: body.deviceId,
        sessionId: body.sessionId,
        responseDropped: drop,
      });
      await writeFile(
        resolve(directory, "exchange-evidence.json"),
        JSON.stringify(exchangeEvidence, null, 2),
        { mode: 0o600 },
      );
      if (drop) {
        _reply.hijack();
        _reply.raw.destroy();
      }
    }
    if (request.url === "/v1/sync" && typeof payload === "string") {
      const body = JSON.parse(payload) as {
        results?: Array<{ outcome: string; code?: string | null }>;
      };
      if (Array.isArray(body.results))
        syncEvidence.push({
          outcomes: body.results.map((row) => row.outcome),
          codes: body.results.map((row) => row.code ?? null),
        });
    }
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    requests.push({
      method: request.method,
      path: request.url.split("?")[0]!,
      status: reply.statusCode,
    });
  });
  try {
    await app.listen({ host: "127.0.0.1", port: 43100 });
    const code = await new Promise<number>((done, reject) => {
      const child = spawn(
        "/usr/bin/python3",
        [
          resolve(
            "tests/regression/extension-core/client-i1/browser_connection_code.py",
          ),
          "--output",
          directory,
        ],
        { env: process.env, stdio: "ignore" },
      );
      child.once("error", reject);
      child.once("close", (value) => done(value ?? 1));
    });
    const result = JSON.parse(
      await readFile(resolve(directory, "result.json"), "utf8"),
    ) as { status: string; checks: Record<string, boolean>; stage?: string };
    await writeFile(
      resolve(directory, "http-events.json"),
      JSON.stringify(requests, null, 2) + "\n",
      { mode: 0o600 },
    );
    await writeFile(
      resolve(directory, "sync-evidence.json"),
      JSON.stringify(syncEvidence, null, 2),
    );
    if (
      process.env.SA_CONNECTION_BROWSER_SCENARIO === "work_cycle" &&
      result.status === "PASS" &&
      !syncEvidence.some((row) => row.outcomes.includes("ACK"))
    )
      throw new Error("ACTUAL_SYNC_ACK_NOT_OBSERVED");
    if (
      process.env.SA_CONNECTION_BROWSER_SCENARIO === "auth_recovery" &&
      result.status === "PASS"
    ) {
      const lost = exchangeEvidence[1],
        restored = exchangeEvidence[2];
      if (
        !lost?.responseDropped ||
        !restored ||
        lost.attemptSha256 !== restored.attemptSha256 ||
        lost.deviceId !== restored.deviceId ||
        lost.sessionId !== restored.sessionId ||
        lost.accountId !== restored.accountId
      )
        throw new Error("EXCHANGE_REPLAY_CHANGED_INSTALLATION");
    }
    if (code !== 0 || result.status !== "PASS")
      throw new Error(
        "CONNECTION_BROWSER_FAILED_" + (result.stage ?? "unknown"),
      );
    return result;
  } finally {
    await app.close();
    transferFence?.deactivate();
  }
}
