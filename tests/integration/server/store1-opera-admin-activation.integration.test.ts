import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BootstrapIdentifiedSnapshotPayloadV2 } from "../../../packages/contracts/src/index.js";
import { signBootstrapSnapshotV2 } from "../../../packages/server/remote-config/src/index.js";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
} from "../../../packages/server/admin-auth/src/index.js";
import { AdminAiService } from "../../../packages/server/admin-ai/src/index.js";
import { AdminOpsService } from "../../../packages/server/admin-ops/src/index.js";
import { BetaAdmissionService } from "../../../packages/server/beta-access/src/index.js";
import { createAdminCommercialService } from "../../../packages/server/admin-commercial/src/index.js";
import {
  BootstrapAiResolutionService,
  BootstrapService,
  LocalClientAuthorityMaterializer,
} from "../../../packages/server/bootstrap/src/index.js";
import {
  ExtensionAuthService,
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
} from "../../../packages/server/extension-auth/src/index.js";
import {
  bindConfigSigningRing,
  createConfigSigningService,
  loadConfigSigningMaterial,
} from "../../../apps/api/src/bootstrap-signing.js";
import { resolveP3BootstrapPolicy } from "../../../packages/server/remote-config/src/index.js";
import type { AppConfig } from "../../../packages/shared/src/index.js";
import {
  authorizeAdminMutationInTransaction,
  createAdminAuthRepository,
  createAdminOpsRepository,
  createBetaAdmissionRepository,
  createBootstrapAiResolutionRepository,
  createExtensionAuthRepository,
  createP3BootstrapPolicyCatalogRepository,
  createDatabaseRuntime,
  createP3PolicyPublicationRepository,
  createP6AdminCommercialReadRepository,
  createP6AdminCompatibilityCommandAdapter,
  createP6AdminEntitlementCommandAdapter,
  createP6AdminPlanCommandAdapter,
  createP6AdminPriceCommandAdapter,
  createP7AdminAiCommandRepository,
  createP7AdminAiReadRepository,
  createProfileLifecycleRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { createApiApp } from "../../../apps/api/src/app.js";
import {
  STORE1_ACCEPTED_ARTIFACT_SHA256,
  STORE1_ACCEPTED_SOURCE_HEAD,
  STORE1_ACCEPTED_SOURCE_TREE,
  STORE1_CONTRACT,
  STORE1_POLICY_KEY,
  STORE1_PROFILE_SHA256,
  STORE1_VERSION,
  planStore1Activation,
  type Store1ActivationReadback,
  type Store1HttpInstruction,
  type Store1PackageAuthority,
  type Store1V2SignaturePreflightProof,
} from "../../../tooling/server/store1-opera-admin-activation.js";
import {
  extractStore1PackageSignatureEvidenceFromEntries,
  planStore1ActivationWithVerifiedPreflightForTest,
  runStore1V2SignaturePreflightWithEvidenceForTest,
  type Store1PackageSignatureEvidence,
  type Store1TrustBundle,
  type Store1V2SignaturePreflightTransport,
} from "../../../tooling/server/store1-v2-signature-preflight.js";
import { runStore1ReadOnlyPreflightWithEvidenceForTest } from "../../../tooling/server/store1-preflight-cli.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for STORE1 activation integration");

const NOW = new Date("2030-01-01T00:00:00.000Z");
const LATER = new Date("2030-01-02T00:00:00.000Z");
const REVIEWER_EMAIL = "opera-reviewer@example.test";
const REVIEWER_USER = "30000000-0000-4000-8000-000000000001";
const REVIEWER_ACCOUNT = "30000000-0000-4000-8000-000000000002";
const ADMIN_USER = "30000000-0000-4000-8000-000000000003";
const ADMIN_PRINCIPAL = "30000000-0000-4000-8000-000000000004";
const ADMIN_PORTAL = "30000000-0000-4000-8000-000000000005";
const REVIEWER_DEVICE = "30000000-0000-4000-8000-000000000006";
const REVIEWER_SESSION = "30000000-0000-4000-8000-000000000007";
const authority: Store1PackageAuthority = {
  sourceHead: STORE1_ACCEPTED_SOURCE_HEAD,
  sourceTree: STORE1_ACCEPTED_SOURCE_TREE,
  version: STORE1_VERSION,
  contractVersion: STORE1_CONTRACT,
  artifactSha256: STORE1_ACCEPTED_ARTIFACT_SHA256,
  filename: `OCTOPORT_v${STORE1_VERSION}_CHROMIUM_STORE.zip`,
};
const STORE1_TEST_SIGNING_PAIR = generateKeyPairSync("ed25519");
const STORE1_TEST_CONTROL_ORIGIN = "https://api.store1.test";
const VERIFIER_SOURCE = readFileSync(
  new URL("../../../packages/control-client/src/crypto.js", import.meta.url),
  "utf8",
);

function store1PackageEvidence(): Store1PackageSignatureEvidence {
  const der = STORE1_TEST_SIGNING_PAIR.publicKey.export({
    format: "der",
    type: "spki",
  });
  const trustBundle: Store1TrustBundle = {
    trustBundleVersion: "bootstrap_trust_bundle_v1",
    algorithm: "Ed25519",
    publicKeyFormat: "spki_der",
    publicKeyEncoding: "base64",
    fingerprintAlgorithm: "sha256",
    fingerprintEncoding: "lowercase_hex",
    keys: [
      {
        keyId: "store1-preprod-base",
        publicKey: der.toString("base64"),
        fingerprintSha256: createHash("sha256").update(der).digest("hex"),
        lifecycle: "ACTIVE",
        trustEligibility: "SIGNING_AND_VERIFICATION",
      },
    ],
  };
  const packagedConfig = {
    environment: "PREPRODUCTION",
    controlApiOrigin: STORE1_TEST_CONTROL_ORIGIN,
    portalOrigin: "https://app.store1.test",
    extensionVersion: STORE1_VERSION,
    contractVersion: STORE1_CONTRACT,
    trustBundle,
  };
  const serviceWorker = Buffer.from(
    "globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__=" +
      JSON.stringify(JSON.stringify(packagedConfig)) +
      ";",
  );
  return extractStore1PackageSignatureEvidenceFromEntries(
    authority,
    new Map([
      ["service_worker.js", serviceWorker],
      ["shared/bootstrap_verifier.js", Buffer.from(VERIFIER_SOURCE)],
    ]),
  );
}

const config: AppConfig = {
  environment: "test",
  databaseUrl: connectionString,
  logLevel: "error",
  apiPort: 0,
  workerReadyDelayMs: 0,
};

let db: DatabaseRuntime;
let app: ReturnType<typeof createApiApp>;
let cookie = "";
let csrf = "";
let adminSessionCredential = "";
let reviewerBearer = "";
const readback: Store1ActivationReadback = {};

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) {
  return db.query<T>(text, values);
}
async function seedV2BaseConfig() {
  const publication = createP3PolicyPublicationRepository(db);
  const keyId = "store1-preprod-base";
  const publicKeySpkiDer = STORE1_TEST_SIGNING_PAIR.publicKey.export({
    format: "der",
    type: "spki",
  });
  const context = {
    actorType: "SYSTEM" as const,
    correlationId: "store1-base-config",
    reason: "STORE1 disposable base config fixture",
  };
  await publication.registerSigningKey({ keyId, publicKeySpkiDer }, context);
  await publication.activateSigningKey(keyId, context);
  await publication.publishConfigRelease(
    {
      contractVersion: STORE1_CONTRACT,
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
      signingKeyId: keyId,
      compatibilityPolicyRevisionIds: [],
      featureRuleRevisionIds: [],
      featureRolloutRevisionIds: [],
      publishedAt: NOW,
    },
    context,
  );
}
async function seedClosedReviewer() {
  await q(
    "INSERT INTO users(id,status,created_at,updated_at) VALUES($1,'ACTIVE',$3,$3),($2,'ACTIVE',$3,$3)",
    [REVIEWER_USER, ADMIN_USER, NOW],
  );
  await q(
    "INSERT INTO accounts(id,status,display_name,created_at,updated_at) VALUES($1,'ACTIVE','Opera reviewer',$2,$2)",
    [REVIEWER_ACCOUNT, NOW],
  );
  await q(
    "INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$2,'OWNER')",
    [REVIEWER_ACCOUNT, REVIEWER_USER],
  );
  await q(
    "INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at) VALUES($1,'EMAIL',$2,$3)",
    [REVIEWER_USER, REVIEWER_EMAIL, NOW],
  );
  await q(
    "INSERT INTO beta_admission_state(id,mode,capacity,admitted,revision,updated_at) VALUES(1,'CLOSED',1,1,1,$1) ON CONFLICT(id) DO UPDATE SET mode='CLOSED',capacity=1,admitted=1,revision=1,updated_at=$1",
    [NOW],
  );
  await q(
    "INSERT INTO beta_admissions(account_id,user_id,admitted_at) VALUES($1,$2,$3)",
    [REVIEWER_ACCOUNT, REVIEWER_USER, NOW],
  );
}
async function seedAdminSession() {
  await q(
    "INSERT INTO portal_sessions(id,user_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",
    [ADMIN_PORTAL, ADMIN_USER, "store1-admin-source", NOW, LATER],
  );
  await q(
    "INSERT INTO admin_principals(id,user_id,status,revision,created_at,updated_at) VALUES($1,$2,'ACTIVE',1,$3,$3)",
    [ADMIN_PRINCIPAL, ADMIN_USER, NOW],
  );
  await q(
    "INSERT INTO admin_role_grants(admin_principal_id,role,granted_at) VALUES($1,'ADMIN_OWNER',$2)",
    [ADMIN_PRINCIPAL, NOW],
  );
  const auth = new AdminAuthService(
    createAdminAuthRepository(db),
    deriveAdminAuthKeys(Buffer.alloc(32, 91)),
    () => NOW,
    () => Buffer.alloc(32, 93).toString("base64url"),
  );
  const elevated = await auth.createAdminSession(
    { sessionId: ADMIN_PORTAL, userId: ADMIN_USER, createdAt: NOW },
    "store1-admin-session",
  );
  if (!elevated.ok) throw new Error("admin fixture failed: " + elevated.code);
  csrf = auth.csrf(elevated.value.sessionToken);
  adminSessionCredential = elevated.value.sessionToken;
  cookie =
    "pcp_admin_session=" +
    elevated.value.sessionToken +
    "; pcp_admin_csrf=" +
    csrf;
  return auth;
}
async function seedReviewerExtensionCredential() {
  await q(
    "INSERT INTO devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$2,$3,'opera',$4)",
    [REVIEWER_DEVICE, REVIEWER_ACCOUNT, REVIEWER_USER, STORE1_VERSION],
  );
  await q(
    "INSERT INTO sessions(id,device_id,account_id,token_family_id) VALUES($1,$2,$3,$4)",
    [REVIEWER_SESSION, REVIEWER_DEVICE, REVIEWER_ACCOUNT, randomUUID()],
  );
  const extensionAuth = new ExtensionAuthService(
    createExtensionAuthRepository(db),
    deriveExtensionAuthKeys(Buffer.alloc(32, 74)),
    undefined,
    createEphemeralAccessTokenSigningKey("store1-preflight-test"),
  );
  const issued = await extensionAuth.issue(REVIEWER_SESSION);
  if (!issued.ok) throw new Error("reviewer extension credential failed");
  reviewerBearer = issued.value.accessToken;
  return extensionAuth;
}
async function call(instruction: Store1HttpInstruction) {
  const path = instruction.path.replace(
    "<REVIEWER_EMAIL_PRIVATE>",
    encodeURIComponent(REVIEWER_EMAIL),
  );
  return app.inject({
    method: instruction.method,
    url: path,
    headers: {
      cookie,
      ...(instruction.method === "POST" ? { "x-csrf-token": csrf } : {}),
    },
    payload: instruction.body,
  });
}

function invalidateAfterPost(path: string) {
  if (path.includes("/compatibility/releases/")) delete readback.release;
  else if (path.includes("/compatibility/policies/")) delete readback.policies;
  else if (path.includes("/compatibility/config-releases/"))
    delete readback.config;
  else if (path === "/v1/admin/ai/registry/adapters") {
    delete readback.adapters;
    delete readback.adapterNextCursor;
  } else if (path === "/v1/admin/ai/registry/surfaces") {
    delete readback.surfaces;
    delete readback.surfaceNextCursor;
  } else if (path === "/v1/admin/ai/registry/variants") {
    delete readback.variants;
    delete readback.variantNextCursor;
  } else if (path === "/v1/admin/ai/profiles") {
    delete readback.profiles;
    delete readback.profileNextCursor;
  } else if (path.includes("/v1/admin/ai/profiles/")) {
    delete readback.profileRevisions;
    delete readback.profileRevisionNextCursor;
  } else if (path === "/v1/admin/ai/assignments") {
    delete readback.assignments;
    delete readback.assignmentNextCursor;
  } else if (path.includes("/v1/admin/ai/assignments/")) {
    delete readback.assignments;
    delete readback.assignmentNextCursor;
  }
}
function one<T>(items: T[]): T | null {
  if (items.length > 1) throw new Error("STORE1_TEST_READBACK_AMBIGUOUS");
  return items[0] ?? null;
}

type JsonResponse = {
  statusCode: number;
  json(): unknown;
};

function captureRead(path: string, response: JsonResponse) {
  const body = response.json();
  if (path === `/v1/admin/compatibility/releases/${STORE1_VERSION}`) {
    readback.release =
      response.statusCode === 404
        ? null
        : (body as NonNullable<Store1ActivationReadback["release"]>);
    return;
  }
  if (path.startsWith("/v1/admin/compatibility/policies?")) {
    readback.policies = (
      body as { items: NonNullable<Store1ActivationReadback["policies"]> }
    ).items;
    return;
  }
  if (path.startsWith("/v1/admin/compatibility/config-releases/latest?")) {
    readback.config =
      response.statusCode === 404
        ? null
        : (body as NonNullable<Store1ActivationReadback["config"]>);
    return;
  }
  if (path.startsWith("/v1/admin/ai/registry/adapters?")) {
    const page = body as {
      items: NonNullable<Store1ActivationReadback["adapters"]>;
      nextCursor: string | null;
    };
    readback.adapters = [...(readback.adapters ?? []), ...page.items];
    readback.adapterNextCursor = page.nextCursor;
    return;
  }
  if (path.includes("/surfaces?")) {
    const page = body as {
      items: NonNullable<Store1ActivationReadback["surfaces"]>;
      nextCursor: string | null;
    };
    readback.surfaces = [...(readback.surfaces ?? []), ...page.items];
    readback.surfaceNextCursor = page.nextCursor;
    return;
  }
  if (path.includes("/variants?")) {
    const page = body as {
      items: NonNullable<Store1ActivationReadback["variants"]>;
      nextCursor: string | null;
    };
    readback.variants = [...(readback.variants ?? []), ...page.items];
    readback.variantNextCursor = page.nextCursor;
    return;
  }
  if (path.startsWith("/v1/admin/ai/profiles?")) {
    const page = body as {
      items: NonNullable<Store1ActivationReadback["profiles"]>;
      nextCursor: string | null;
    };
    readback.profiles = [...(readback.profiles ?? []), ...page.items];
    readback.profileNextCursor = page.nextCursor;
    return;
  }
  if (path.includes("/revisions?limit=100") && path.includes("/profiles/")) {
    const page = body as {
      items: NonNullable<Store1ActivationReadback["profileRevisions"]>;
      nextCursor: string | null;
    };
    readback.profileRevisions = [
      ...(readback.profileRevisions ?? []),
      ...page.items,
    ];
    readback.profileRevisionNextCursor = page.nextCursor;
    return;
  }
  if (path.startsWith("/v1/admin/ai/assignments?")) {
    const page = body as {
      items: NonNullable<Store1ActivationReadback["assignments"]>;
      nextCursor: string | null;
    };
    readback.assignments = [...(readback.assignments ?? []), ...page.items];
    readback.assignmentNextCursor = page.nextCursor;
    return;
  }
  if (path === "/v1/admin/beta/admission") {
    readback.betaState = body as NonNullable<
      Store1ActivationReadback["betaState"]
    >;
    return;
  }
  if (path.startsWith("/v1/admin/users?")) {
    const user = one(
      (
        body as {
          items: Array<{
            id: string;
            status: "ACTIVE" | "SUSPENDED";
            emails: Array<{ email: string; verifiedAt: string | null }>;
          }>;
        }
      ).items,
    );
    readback.reviewerUser = user
      ? {
          id: user.id,
          status: user.status,
          queriedEmailVerified: user.emails.some(
            (value) =>
              value.email.toLowerCase() === REVIEWER_EMAIL.toLowerCase() &&
              value.verifiedAt !== null,
          ),
        }
      : null;
    return;
  }
  if (path.startsWith("/v1/admin/accounts?")) {
    const page = body as {
      items: NonNullable<Store1ActivationReadback["reviewerAccounts"]>;
      nextCursor: string | null;
    };
    readback.reviewerAccounts = [
      ...(readback.reviewerAccounts ?? []),
      ...page.items,
    ];
    readback.reviewerAccountNextCursor = page.nextCursor;
    return;
  }
  if (path.startsWith("/v1/admin/beta/admission/accounts/")) {
    readback.reviewerAdmission = body as NonNullable<
      Store1ActivationReadback["reviewerAdmission"]
    >;
    return;
  }
  throw new Error("STORE1_TEST_UNHANDLED_READ " + path);
}

type VerifiedEntryOptions = {
  authenticatedAccountId?: string;
  authenticatedDeviceId?: string;
  authenticatedBrowserVersion?: string;
  authenticatedOrigin?: string;
  now?: Date;
  tamperSignature?: boolean;
};

function verifiedPreflightInput(options?: VerifiedEntryOptions) {
  if (!readback.config) throw new Error("STORE1_TEST_CONFIG_REQUIRED");
  const issuedAt = NOW.toISOString();
  const payload: BootstrapIdentifiedSnapshotPayloadV2 = {
    snapshotVersion: "bootstrap_snapshot_v2",
    contractVersion: STORE1_CONTRACT,
    configVersion: readback.config.configVersion,
    issuedAt,
    expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
    offlineGraceUntil: new Date(NOW.getTime() + 24 * 60 * 60_000).toISOString(),
    serverTime: issuedAt,
    accessBasis: "BETA",
    account: { id: REVIEWER_ACCOUNT, status: "ACTIVE" },
    subscription: { state: "NONE", planRevision: null },
    devicePolicy: { status: "ACTIVE" },
    entitlements: {},
    compatibility: {
      extension: { status: "SUPPORTED", minimumVersion: null },
      browser: { status: "SUPPORTED" },
    },
    features: {},
    ai: { status: "UNCONFIGURED" },
  };
  const signed = signBootstrapSnapshotV2(
    payload,
    readback.config.signingKeyId,
    STORE1_TEST_SIGNING_PAIR.privateKey,
  );
  const envelope = options?.tamperSignature
    ? { ...signed, signature: "AA" }
    : signed;
  const packageEvidence = store1PackageEvidence();
  const transport: Store1V2SignaturePreflightTransport = {
    async readLatestConfig() {
      return readback.config!;
    },
    async issueBootstrap(_path, request) {
      return {
        envelope,
        authenticatedContext: {
          accountId: options?.authenticatedAccountId ?? REVIEWER_ACCOUNT,
          deviceId: options?.authenticatedDeviceId ?? request.deviceId,
          browserFamily: "opera",
          browserVersion:
            options?.authenticatedBrowserVersion ?? request.browser.version,
          controlApiOrigin:
            options?.authenticatedOrigin ?? STORE1_TEST_CONTROL_ORIGIN,
        },
      };
    },
  };
  return {
    packageEvidence,
    expectedAccountId: REVIEWER_ACCOUNT,
    deviceId: REVIEWER_DEVICE,
    browserVersion: "136",
    transport,
    now: () => options?.now ?? NOW,
  };
}

async function signatureProofFixture(
  options?: VerifiedEntryOptions,
): Promise<Store1V2SignaturePreflightProof> {
  return runStore1V2SignaturePreflightWithEvidenceForTest(
    verifiedPreflightInput(options),
  );
}

async function verifiedPlanFixture(options?: VerifiedEntryOptions) {
  return planStore1ActivationWithVerifiedPreflightForTest({
    ...verifiedPreflightInput(options),
    readback,
  });
}
async function runPlanner(maxSteps = 40, injectSignatureProof = false) {
  const mutations: string[] = [];
  for (let step = 0; step < maxSteps; step += 1) {
    const plan = planStore1Activation(authority, readback);
    if (plan.status === "READY") return { plan, mutations };
    if (plan.status === "BLOCKED" || plan.status === "CONFLICT") {
      if (
        injectSignatureProof &&
        (plan.code === "STORE1_V2_SIGNATURE_PREFLIGHT_REQUIRED" ||
          plan.code === "STORE1_V2_SIGNATURE_PREFLIGHT_STALE")
      ) {
        readback.signaturePreflight = await signatureProofFixture();
        continue;
      }
      return { plan, mutations };
    }
    const response = await call(plan.next);
    if (plan.status === "READ") {
      expect([200, 404]).toContain(response.statusCode);
      captureRead(plan.next.path, response);
    } else {
      expect(response.statusCode).toBe(200);
      mutations.push(plan.next.path);
      invalidateAfterPost(plan.next.path);
    }
  }
  throw new Error("STORE1_TEST_PLAN_DID_NOT_CONVERGE");
}

type RoutedFetchCall = {
  method: string;
  path: string;
  cookie: string | null;
  authorization: string | null;
  status?: number;
  body?: unknown;
};

function routeBackedFetch(calls: RoutedFetchCall[]): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.origin !== STORE1_TEST_CONTROL_ORIGIN)
      throw new Error("STORE1_TEST_ORIGIN_MISMATCH");
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const call: RoutedFetchCall = {
      method,
      path: url.pathname + url.search,
      cookie: headers.get("cookie"),
      authorization: headers.get("authorization"),
      ...(typeof init?.body === "string"
        ? { body: JSON.parse(init.body) as unknown }
        : {}),
    };
    calls.push(call);
    const response = await app.inject({
      method: method as "GET" | "POST",
      url: url.pathname + url.search,
      headers: Object.fromEntries(headers.entries()),
      ...(typeof init?.body === "string" ? { payload: init.body } : {}),
    });
    call.status = response.statusCode;
    return new Response(response.body, {
      status: response.statusCode,
      headers: {
        "content-type": String(
          response.headers["content-type"] ?? "application/json",
        ),
      },
    });
  }) as typeof fetch;
}

async function runHttpPreflight(reviewerCredential = reviewerBearer) {
  const directory = mkdtempSync(join(tmpdir(), "store1-http-preflight-"));
  const adminPath = join(directory, "admin-session");
  const reviewerPath = join(directory, "reviewer-bearer");
  try {
    writeFileSync(adminPath, adminSessionCredential, { mode: 0o600 });
    writeFileSync(reviewerPath, reviewerCredential, { mode: 0o600 });
    chmodSync(adminPath, 0o600);
    chmodSync(reviewerPath, 0o600);
    const calls: RoutedFetchCall[] = [];
    const result = await runStore1ReadOnlyPreflightWithEvidenceForTest(
      {
        manifestPath: "/test/manifest.json",
        packagePath: "/test/package.zip",
        reviewerEmail: REVIEWER_EMAIL,
        deviceId: REVIEWER_DEVICE,
        browserVersion: "136",
        adminSessionFile: adminPath,
        reviewerDeviceBearerFile: reviewerPath,
      },
      store1PackageEvidence(),
      { fetchImpl: routeBackedFetch(calls), now: () => NOW },
    );
    return { result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe.sequential("STORE-1 ordinary-admin whole-sequence rehearsal", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString!);
    await db.ready();
    await q("DROP SCHEMA public CASCADE");
    await q("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await q("CREATE SCHEMA public");
    await runMigrations({ connectionString: connectionString! });
    await seedV2BaseConfig();
    await seedClosedReviewer();
    const adminAuth = await seedAdminSession();
    const extensionAuth = await seedReviewerExtensionCredential();
    const beta = new BetaAdmissionService(createBetaAdmissionRepository(db));
    const p3Catalog = createP3BootstrapPolicyCatalogRepository(db);
    const signingMaterial = loadConfigSigningMaterial({
      CONFIG_SIGNING_KEY_ID: "store1-preprod-base",
      CONFIG_SIGNING_PRIVATE_KEY_PEM_B64: Buffer.from(
        STORE1_TEST_SIGNING_PAIR.privateKey.export({
          format: "pem",
          type: "pkcs8",
        }),
      ).toString("base64"),
    });
    await bindConfigSigningRing(signingMaterial, (keyId) =>
      p3Catalog.findSigningKey(keyId),
    );
    const bootstrapAi = new BootstrapAiResolutionService(
      createBootstrapAiResolutionRepository(db),
    );
    const localClientAuthority = new LocalClientAuthorityMaterializer(
      p3Catalog,
      bootstrapAi,
    );
    app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      extensionAuthService: extensionAuth,
      bootstrapService: new BootstrapService(
        { resolve: (input) => resolveP3BootstrapPolicy(input, p3Catalog) },
        createConfigSigningService(signingMaterial, p3Catalog),
        { now: () => NOW },
        undefined,
        bootstrapAi,
        beta,
        undefined,
        undefined,
        undefined,
        localClientAuthority,
      ),
      adminAuthService: adminAuth,
      adminOpsService: new AdminOpsService(
        createAdminOpsRepository(db),
        {} as never,
      ),
      adminCommercialService: createAdminCommercialService(
        createP6AdminCommercialReadRepository(db),
        {
          plans: createP6AdminPlanCommandAdapter(db),
          prices: createP6AdminPriceCommandAdapter(db),
          overrides: createP6AdminEntitlementCommandAdapter(db),
          compatibility: createP6AdminCompatibilityCommandAdapter(db),
        },
      ),
      adminAiService: new AdminAiService(
        createP7AdminAiReadRepository(db),
        createP7AdminAiCommandRepository(db),
        createProfileLifecycleRepository(db, {
          beforeMutation: authorizeAdminMutationInTransaction,
        }),
      ),
      betaAdmissionService: beta,
    });
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  it("runs B10 against real admin and signed bootstrap handlers without catalog writes", async () => {
    const before = await q<{ releases: string; configReleases: string }>(
      'SELECT (SELECT count(*)::text FROM extension_releases) AS releases, (SELECT count(*)::text FROM config_releases) AS "configReleases"',
    );
    const { result, calls } = await runHttpPreflight();
    expect(result).toMatchObject({
      status: "POST",
      signature: { verified: true },
      nextActionPreview: {
        method: "POST",
        path: `/v1/admin/compatibility/releases/${STORE1_VERSION}/publish`,
        executed: false,
      },
      bootstrapMayUpdateDeviceOrAuthState: true,
      catalogMutationExecuted: false,
    });
    expect(
      calls.filter((call) => call.method === "POST").map((call) => call.path),
    ).toEqual(["/v1/bootstrap"]);
    expect(calls.find((call) => call.path === "/v1/bootstrap")).toMatchObject({
      method: "POST",
      status: 200,
      body: {
        contractVersion: "control_plane_v2",
        extensionVersion: STORE1_VERSION,
        browser: { family: "opera", version: "136" },
        deviceId: REVIEWER_DEVICE,
        lastConfigVersion: null,
      },
    });
    expect(
      calls
        .filter((call) => call.method === "GET")
        .every((call) => [200, 404].includes(call.status ?? 0)),
    ).toBe(true);
    expect(
      calls.some(
        (call) => call.cookie === `pcp_admin_session=${adminSessionCredential}`,
      ),
    ).toBe(true);
    expect(
      calls.some((call) => call.authorization === `Bearer ${reviewerBearer}`),
    ).toBe(true);
    expect(
      calls.every(
        (call) => call.cookie !== `pcp_admin_session=${reviewerBearer}`,
      ),
    ).toBe(true);
    expect(
      calls.every(
        (call) => call.authorization !== `Bearer ${adminSessionCredential}`,
      ),
    ).toBe(true);
    const after = await q<{ releases: string; configReleases: string }>(
      'SELECT (SELECT count(*)::text FROM extension_releases) AS releases, (SELECT count(*)::text FROM config_releases) AS "configReleases"',
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("rejects invalid or revoked reviewer credentials and stops before bootstrap for unadmitted accounts", async () => {
    await expect(
      runHttpPreflight("not-a-reviewer-token-123456"),
    ).rejects.toThrow("STORE1_AUTHENTICATION_FAILED");

    await q("UPDATE devices SET status='REVOKED',revoked_at=$2 WHERE id=$1", [
      REVIEWER_DEVICE,
      NOW,
    ]);
    await expect(runHttpPreflight()).rejects.toThrow(
      "STORE1_AUTHENTICATION_FAILED",
    );
    await q("UPDATE devices SET status='ACTIVE',revoked_at=NULL WHERE id=$1", [
      REVIEWER_DEVICE,
    ]);

    await q("DELETE FROM beta_admissions WHERE account_id=$1", [
      REVIEWER_ACCOUNT,
    ]);
    const unadmitted = await runHttpPreflight();
    expect(unadmitted.result).toMatchObject({
      status: "BLOCKED",
      catalogMutationExecuted: false,
    });
    expect(unadmitted.calls.some((call) => call.path === "/v1/bootstrap")).toBe(
      false,
    );
    await q(
      "INSERT INTO beta_admissions(account_id,user_id,admitted_at) VALUES($1,$2,$3)",
      [REVIEWER_ACCOUNT, REVIEWER_USER, NOW],
    );
  });

  it("blocks all catalog writes until signature proof and fails closed on mismatch", async () => {
    const missing = await runPlanner();
    expect(missing.plan).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_REQUIRED",
    });
    expect(missing.mutations).toEqual([]);

    readback.signaturePreflight = JSON.parse(
      JSON.stringify(await signatureProofFixture()),
    ) as Store1V2SignaturePreflightProof;
    const untrusted = await runPlanner();
    expect(untrusted.plan).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_UNTRUSTED",
    });
    expect(untrusted.mutations).toEqual([]);

    readback.signaturePreflight = await signatureProofFixture();
    readback.config = {
      ...readback.config!,
      contentHashSha256: "d".repeat(64),
    };
    const mismatched = await runPlanner();
    expect(mismatched.plan).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_STALE",
    });
    expect(mismatched.mutations).toEqual([]);
    delete readback.config;
    delete readback.signaturePreflight;
  });

  it("production planning entry verifies envelope/context/freshness before returning a POST", async () => {
    const primed = await runPlanner();
    expect(primed.plan).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_REQUIRED",
    });
    expect(primed.mutations).toEqual([]);
    readback.release = null;

    readback.signaturePreflight = JSON.parse(
      JSON.stringify(await signatureProofFixture()),
    ) as Store1V2SignaturePreflightProof;
    const forged = planStore1Activation(authority, readback);
    expect(forged).toMatchObject({
      status: "BLOCKED",
      code: "STORE1_V2_SIGNATURE_PREFLIGHT_UNTRUSTED",
    });
    delete readback.signaturePreflight;

    await expect(
      verifiedPlanFixture({ tamperSignature: true }),
    ).rejects.toThrow("STORE1_V2_SIGNATURE_INVALID_SIGNATURE");
    await expect(
      verifiedPlanFixture({
        authenticatedAccountId: "30000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toThrow("STORE1_V2_AUTHENTICATED_CONTEXT_MISMATCH");
    await expect(
      verifiedPlanFixture({
        authenticatedOrigin: "https://wrong-origin.example.test",
      }),
    ).rejects.toThrow("STORE1_V2_AUTHENTICATED_CONTEXT_MISMATCH");
    await expect(
      verifiedPlanFixture({
        now: new Date(NOW.getTime() + 15 * 60_000),
      }),
    ).rejects.toThrow("STORE1_V2_SIGNATURE_EXPIRED");

    const verified = await verifiedPlanFixture();
    expect(verified.plan).toMatchObject({
      status: "POST",
      next: {
        method: "POST",
        path: `/v1/admin/compatibility/releases/${STORE1_VERSION}/publish`,
      },
    });

    const releases = await q<{ count: string }>(
      "SELECT count(*)::text AS count FROM extension_releases",
    );
    expect(releases.rows[0]?.count).toBe("0");
    delete readback.release;
    delete readback.signaturePreflight;
  });

  it("converges via authenticated HTTP only after signature proof and replay is mutation-free", async () => {
    const first = await runPlanner(40, true);
    expect(first.plan).toMatchObject({ status: "READY" });
    expect(first.mutations.slice(0, 7)).toEqual([
      `/v1/admin/compatibility/releases/${STORE1_VERSION}/publish`,
      "/v1/admin/compatibility/policies/" + STORE1_POLICY_KEY + "/publish",
      "/v1/admin/compatibility/config-releases/publish",
      "/v1/admin/ai/registry/adapters",
      "/v1/admin/ai/registry/surfaces",
      "/v1/admin/ai/profiles",
      expect.stringMatching(/^\/v1\/admin\/ai\/profiles\/[^/]+\/revisions$/),
    ]);
    expect(
      first.mutations.some((path) => path.includes("/registry/variants")),
    ).toBe(false);
    expect(
      first.mutations.some(
        (path) => path.includes("/profiles/") && path.includes("/revisions"),
      ),
    ).toBe(true);
    expect(first.mutations.some((path) => path.includes("/assignments"))).toBe(
      true,
    );
    const release = await q<{ artifact: string }>(
      "SELECT artifact_sha256 AS artifact FROM extension_releases WHERE version=$1",
      [STORE1_VERSION],
    );
    expect(release.rows[0]?.artifact).toBe(authority.artifactSha256);
    const profile = await q<{ contentSha: string }>(
      "SELECT content_sha256 AS \"contentSha\" FROM adapter_profile_revisions WHERE state='PUBLISHED' ORDER BY revision DESC LIMIT 1",
    );
    expect(profile.rows[0]?.contentSha).toBe(STORE1_PROFILE_SHA256);
    const beta = await q<{ mode: string; admitted: number }>(
      "SELECT mode,admitted FROM beta_admission_state WHERE id=1",
    );
    expect(beta.rows[0]).toMatchObject({ mode: "CLOSED", admitted: 1 });

    const auditBefore = await q<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events",
    );
    const second = await runPlanner();
    expect(second.plan).toMatchObject({ status: "READY" });
    expect(second.mutations).toEqual([]);
    const auditAfter = await q<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events",
    );
    expect(auditAfter.rows[0]?.count).toBe(auditBefore.rows[0]?.count);
  });
});
