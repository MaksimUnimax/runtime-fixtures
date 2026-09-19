import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createApiApp } from "../../../../apps/api/src/app.js";
import {
  createAuthRepository,
  createBetaAdmissionRepository,
  createCredentialTransferRepository,
  createDatabaseRuntime,
  createDeviceAuthorizationRepository,
  createDeviceManagementRepository,
  createExtensionAuthRepository,
} from "@product/db";
import { AuthService, deriveAuthKeys } from "@product/auth";
import { BetaAdmissionService } from "@product/beta-access";
import {
  DeviceAuthorizationService,
  deriveDeviceAuthKeys,
} from "@product/device-auth";
import {
  DeviceManagementService,
  PreEntitlementDeviceLimitResolver,
} from "@product/device-management";
import {
  ExtensionAuthService,
  deriveExtensionAuthKeys,
} from "@product/extension-auth";
import { BootstrapService } from "@product/bootstrap";
import type { BootstrapAiResolutionService } from "@product/bootstrap";
import { profileRevisionFingerprint } from "@product/adapter-registry";
import {
  signBootstrapSnapshotV2,
  signHealthClaimV1,
  verifyBootstrapEnvelopeV2,
} from "@product/remote-config";
import { CredentialTransferService } from "../../../../packages/server/credential-transfer/src/index.ts";

const fixtureKeysPath = process.env.SA_I1_FIXTURE_KEYS_PATH;
let persistedKeys: { root: string; privateKey: string } | null = null;
if (fixtureKeysPath) {
  try {
    persistedKeys = JSON.parse(readFileSync(fixtureKeysPath, "utf8")) as {
      root: string;
      privateKey: string;
    };
  } catch (_) {
    persistedKeys = null;
  }
}
const root = persistedKeys
  ? Buffer.from(persistedKeys.root, "base64")
  : randomBytes(32);
const apiPort = Number(process.env.SA_I1_API_PORT ?? "43100");
const signing = persistedKeys
  ? {
      privateKey: createPrivateKey({
        key: Buffer.from(persistedKeys.privateKey, "base64"),
        format: "der",
        type: "pkcs8",
      }),
      publicKey: undefined as unknown as ReturnType<typeof createPublicKey>,
    }
  : generateKeyPairSync("ed25519");
if (persistedKeys) signing.publicKey = createPublicKey(signing.privateKey);
const fixtureKeyId = process.env.SA_I1_KEY_ID ?? "i1-client-local";
const fixtureNamespace =
  (process.env.SA_I1_FIXTURE_NAMESPACE ?? randomUUID())
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 24) || "fixture";
const fixtureEmail = (name: string) =>
  `q1a-${fixtureNamespace}-${name}@example.test`;
const accessSigning = {
  privateKey: signing.privateKey,
  publicKey: signing.publicKey,
  keyId: fixtureKeyId,
};
const database = createDatabaseRuntime(process.env.DATABASE_URL!);
const betaAdmission = new BetaAdmissionService(
  createBetaAdmissionRepository(database),
);
const auth = new AuthService(
  createAuthRepository(database),
  deriveAuthKeys(root),
  undefined,
  () => "424242",
);
const deviceAuth = new DeviceAuthorizationService(
  createDeviceAuthorizationRepository(database),
  deriveDeviceAuthKeys(root),
);
const deviceLimitResolver =
  process.env.SA_I1_ALLOW_TWO_DEVICES === "1"
    ? {
        resolve: async () => ({
          maxActive: Number(process.env.SA_I1_MAX_ACTIVE_DEVICES ?? "2"),
          source: "R1_INSTALLED_TRANSFER_FIXTURE",
        }),
      }
    : new PreEntitlementDeviceLimitResolver();
const deviceManagement = new DeviceManagementService(
  createDeviceManagementRepository(database),
  root,
  accessSigning,
  {
    resolve: async (accountId, at) => {
      if ((await betaAdmission.resolve(accountId)).kind === "BETA")
        return { kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT" as const };
      return deviceLimitResolver.resolve(accountId, at);
    },
  },
);
const extensionAuth = new ExtensionAuthService(
  createExtensionAuthRepository(database),
  deriveExtensionAuthKeys(root),
  undefined,
  accessSigning,
);
const r5bProfileContent = {
  schemaVersion: "adapter_profile_v1",
  page: {
    identityStrategy: "page_identity",
    conversationStrategy: "conversation_root",
    composerStrategy: "composer_root",
  },
  selectors: {
    conversation: {
      strategy: "conversation_root",
      primary: {
        kind: "packaged_selector_reference",
        reference: "conversation-root",
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling",
    },
    composer: {
      strategy: "composer_root",
      primary: {
        kind: "packaged_selector_reference",
        reference: "composer-root",
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling",
    },
    send: {
      strategy: "send_control",
      primary: {
        kind: "packaged_selector_reference",
        reference: "send-control",
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling",
    },
    assistantResponse: {
      strategy: "assistant_response",
      primary: {
        kind: "packaged_selector_reference",
        reference: "assistant-response",
      },
      fallbacks: [],
      timeoutMs: 1000,
      observationMode: "polling",
    },
  },
  observation: { mode: "polling", intervalMs: 500 },
  contours: [
    {
      key: "page_identity",
      required: true,
      expectedState: "PRESENT",
      strategy: "page_identity",
    },
    {
      key: "conversation_root",
      required: true,
      expectedState: "PRESENT",
      strategy: "conversation_root",
    },
    {
      key: "composer_root",
      required: true,
      expectedState: "INTERACTIVE",
      strategy: "composer_root",
    },
    {
      key: "send_control",
      required: true,
      expectedState: "INTERACTIVE",
      strategy: "send_control",
    },
  ],
} as const;
const r5bProfileCompatibility = {
  schemaVersion: "profile_compatibility_v1",
  contractVersion: "control_plane_v1",
  browserFamilies: ["chrome"],
  minimumBrowserVersions: [],
  minimumExtensionVersion: null,
} as const;
const r5bProfileSha256 = profileRevisionFingerprint({
  content: r5bProfileContent,
  compatibility: r5bProfileCompatibility,
});
const r5bAiResolution = {
  resolve: async (input: {
    detected: { family: string; surface: string; variant: string | null };
  }) => ({
    status: "RESOLVED" as const,
    detected: input.detected,
    profile: {
      profileKey: "r5b-chatgpt-profile",
      revision: 1,
      scopeVariant: null,
      schemaVersion: "adapter_profile_v1" as const,
      contentSha256: r5bProfileSha256,
      content: r5bProfileContent,
      compatibility: r5bProfileCompatibility,
    },
  }),
} as unknown as BootstrapAiResolutionService;
const bootstrap = new BootstrapService(
  {
    resolve: async () => ({
      configVersion: 1,
      signingKeyId: fixtureKeyId,
      sourceFingerprintSha256: createHash("sha256")
        .update(signing.publicKey.export({ format: "der", type: "spki" }))
        .digest("hex"),
      compatibility: {
        extension: { status: "SUPPORTED", minimumVersion: null },
        browser: { status: "SUPPORTED" },
      },
      features: {},
    }),
  },
  {
    signV2: async (keyId, payload) =>
      signBootstrapSnapshotV2(payload, keyId, signing.privateKey),
    signHealth: async (keyId, claim) =>
      signHealthClaimV1(claim, keyId, signing.privateKey),
  },
  undefined,
  undefined,
  r5bAiResolution,
  betaAdmission,
  undefined,
  {
    resolve: async () => {
      const observedAt = new Date(Date.now() - 1_000);
      return {
        status: "PASS" as const,
        observedAt,
        expiresAt: new Date(observedAt.getTime() + 60_000),
      };
    },
  },
  {
    verifyV2: (input: unknown) =>
      verifyBootstrapEnvelopeV2(
        input,
        new Map([[fixtureKeyId, signing.publicKey]]),
      ),
  },
);
const app = createApiApp({
  config: {
    environment: "test",
    databaseUrl: process.env.DATABASE_URL!,
    logLevel: "warn",
    apiPort,
    workerReadyDelayMs: 0,
  },
  isInfrastructureReady: async () => true,
  authService: auth,
  deviceAuthorizationService: deviceAuth,
  deviceManagementService: deviceManagement,
  extensionAuthService: extensionAuth,
  bootstrapService: bootstrap,
  credentialTransferService: new CredentialTransferService(
    createCredentialTransferRepository(database),
  ),
});

// R5B-R1 only: deterministic provider quota fixture at the test boundary.
// This route is deliberately outside /v1 and is never part of production API
// composition. It records safe installation markers and status counters only.
const r5bProviderFixture = {
  window: "q1a-r5b-r1-window-1",
  threshold: 1,
  requests: [] as Array<{
    sequence: number;
    installation: string;
    status: number;
  }>,
};
app.post("/q1a-r5b-r1/provider/reset", async (request, reply) => {
  const body = (request.body ?? {}) as { threshold?: unknown };
  const requestedThreshold = Number(body.threshold);
  if (
    Number.isInteger(requestedThreshold) &&
    requestedThreshold >= 0 &&
    requestedThreshold <= 1
  )
    r5bProviderFixture.threshold = requestedThreshold;
  r5bProviderFixture.requests.length = 0;
  return reply.send({
    ok: true,
    window: r5bProviderFixture.window,
    threshold: r5bProviderFixture.threshold,
  });
});
app.get("/q1a-r5b-r1/provider/state", async (_request, reply) =>
  reply.send({
    window: r5bProviderFixture.window,
    threshold: r5bProviderFixture.threshold,
    global_request_count: r5bProviderFixture.requests.length,
    provider_429_count: r5bProviderFixture.requests.filter(
      (row) => row.status === 429,
    ).length,
    requests: r5bProviderFixture.requests,
  }),
);
app.post("/q1a-r5b-r1/provider", async (request, reply) => {
  const installation = String(
    request.headers["x-q1a-installation"] ?? "unknown",
  ).slice(0, 24);
  const body = (request.body ?? {}) as { path?: unknown };
  const path = String(body.path ?? "");
  // Capability discovery is a separate seller-info read.  It must receive a
  // contract-valid response but must not consume the provider-global quota
  // window used by the business request assertions below.
  if (path === "/v1/seller/info")
    return reply
      .code(200)
      .header("content-type", "application/json")
      .send({ subscription: { type: "PREMIUM_PRO", is_premium: true } });
  const sequence = r5bProviderFixture.requests.length + 1;
  const status = sequence <= r5bProviderFixture.threshold ? 200 : 429;
  r5bProviderFixture.requests.push({ sequence, installation, status });
  return reply
    .code(status)
    .header("content-type", "application/json")
    .header("retry-after", status === 429 ? "2" : "")
    .send(
      status === 429
        ? { error: "SYNTHETIC_PROVIDER_RATE_LIMIT" }
        : { result: { data: [{ dimensions: [], metrics: [0] }], totals: [0] } },
    );
});

function loopbackDatabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
async function prepareExistingFixtureAccounts(): Promise<void> {
  if (
    process.env.PRODUCT_CONTROL_PLANE_E2E !== "1" ||
    process.env.SA_I1_SKIP_FIXTURE_SETUP === "1"
  )
    return;
  if (!loopbackDatabaseUrl(process.env.DATABASE_URL))
    throw new Error(
      "PRODUCT_CONTROL_PLANE_E2E fixture setup requires a loopback DATABASE_URL",
    );
  const emails =
    process.env.SA_I1_SAME_ACCOUNT_TWO_EMAILS === "1"
      ? [
          fixtureEmail("one"),
          fixtureEmail("two"),
          fixtureEmail("three"),
          fixtureEmail("attacker"),
        ]
      : [fixtureEmail("one"), fixtureEmail("two")];
  const betaBefore = await database.query<{
    mode: string;
    capacity: number;
    admitted: number;
  }>("SELECT mode,capacity,admitted FROM beta_admission_state WHERE id=1");
  if (betaBefore.rows.length !== 1)
    throw new Error("fixture setup expected one beta admission state row");
  await database.transaction(async (tx) => {
    const existing = await tx.query<{ normalized_identifier: string }>(
      "SELECT normalized_identifier FROM user_identities WHERE provider='EMAIL' AND normalized_identifier=ANY($1::varchar[])",
      [emails],
    );
    if (existing.rows.length)
      throw new Error(
        `fixture identity collision for ${existing.rows.map((row) => row.normalized_identifier).join(",")}`,
      );
    const sameAccount = process.env.SA_I1_SAME_ACCOUNT_TWO_EMAILS === "1";
    const userIds = sameAccount
      ? [randomUUID(), randomUUID()]
      : [randomUUID(), randomUUID()];
    const accountIds = sameAccount
      ? [randomUUID(), randomUUID()]
      : [randomUUID(), randomUUID()];
    const allIds = [...userIds, ...accountIds];
    const collision = await tx.query<{ table_name: string; id: string }>(
      "SELECT 'users' AS table_name,id::text FROM users WHERE id=ANY($1::uuid[]) UNION ALL SELECT 'accounts' AS table_name,id::text FROM accounts WHERE id=ANY($1::uuid[]) UNION ALL SELECT 'user_identities' AS table_name,id::text FROM user_identities WHERE id=ANY($1::uuid[]) UNION ALL SELECT 'account_memberships' AS table_name,id::text FROM account_memberships WHERE id=ANY($1::uuid[])",
      [allIds],
    );
    if (collision.rows.length)
      throw new Error(
        `fixture UUID collision in ${collision.rows[0].table_name}`,
      );
    await tx.query("INSERT INTO users(id) VALUES($1),($2)", userIds);
    await tx.query("INSERT INTO accounts(id) VALUES($1),($2)", accountIds);
    await tx.query(
      "INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$3,'OWNER'),($2,$4,'OWNER')",
      [...accountIds, ...userIds],
    );
    await tx.query(
      sameAccount
        ? "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at) VALUES($1,'EMAIL',$3,now()),($1,'EMAIL',$4,now()),($1,'EMAIL',$5,now()),($2,'EMAIL',$6,now())"
        : "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at) VALUES($1,'EMAIL',$3,now()),($2,'EMAIL',$4,now())",
      sameAccount
        ? [userIds[0], userIds[1], emails[0], emails[1], emails[2], emails[3]]
        : [...userIds, ...emails],
    );
  });
  const betaAfter = await database.query<{
    mode: string;
    capacity: number;
    admitted: number;
  }>("SELECT mode,capacity,admitted FROM beta_admission_state WHERE id=1");
  const before = betaBefore.rows[0],
    after = betaAfter.rows[0];
  const unchanged = Boolean(
    after &&
      before.mode === after.mode &&
      Number(before.capacity) === Number(after.capacity) &&
      Number(before.admitted) === Number(after.admitted),
  );
  if (!unchanged)
    throw new Error(
      "fixture setup changed beta admission mode/capacity/admitted",
    );
  if (process.env.SA_I1_FIXTURE_EVIDENCE_PATH)
    writeFileSync(
      process.env.SA_I1_FIXTURE_EVIDENCE_PATH,
      JSON.stringify({
        existing_fixture_accounts: 2,
        beta_unchanged: true,
        fixture_namespace: fixtureNamespace,
        fixture_emails: emails,
      }),
    );
}
void (async () => {
  if (fixtureKeysPath && !persistedKeys)
    writeFileSync(
      fixtureKeysPath,
      JSON.stringify({
        root: root.toString("base64"),
        privateKey: signing.privateKey
          .export({ format: "der", type: "pkcs8" })
          .toString("base64"),
      }),
      { mode: 0o600 },
    );
  const spki = signing.publicKey.export({ format: "der", type: "spki" });
  const publicTrustBundle = {
    trustBundleVersion: "bootstrap_trust_bundle_v1",
    algorithm: "Ed25519",
    publicKeyFormat: "spki_der",
    publicKeyEncoding: "base64",
    fingerprintAlgorithm: "sha256",
    fingerprintEncoding: "lowercase_hex",
    keys: [
      {
        keyId: accessSigning.keyId,
        publicKey: spki.toString("base64"),
        fingerprintSha256: createHash("sha256").update(spki).digest("hex"),
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
  if (process.env.SA_I1_PUBLIC_TRUST_BUNDLE_PATH)
    writeFileSync(
      process.env.SA_I1_PUBLIC_TRUST_BUNDLE_PATH,
      JSON.stringify(publicTrustBundle),
    );
  await prepareExistingFixtureAccounts();
  await app.listen({ host: "127.0.0.1", port: apiPort });
  process.once("SIGINT", async () => {
    await app.close();
    await database.close();
  });
  process.once("SIGTERM", async () => {
    await app.close();
    await database.close();
  });
})();
