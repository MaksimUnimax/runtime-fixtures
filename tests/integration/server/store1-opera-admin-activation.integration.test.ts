import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
} from "../../../packages/server/admin-auth/src/index.js";
import { AdminAiService } from "../../../packages/server/admin-ai/src/index.js";
import { AdminOpsService } from "../../../packages/server/admin-ops/src/index.js";
import { BetaAdmissionService } from "../../../packages/server/beta-access/src/index.js";
import { createAdminCommercialService } from "../../../packages/server/admin-commercial/src/index.js";
import type { AppConfig } from "../../../packages/shared/src/index.js";
import {
  authorizeAdminMutationInTransaction,
  createAdminAuthRepository,
  createAdminOpsRepository,
  createBetaAdmissionRepository,
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
  STORE1_CONTRACT,
  STORE1_POLICY_KEY,
  STORE1_PROFILE_SHA256,
  STORE1_VERSION,
  planStore1Activation,
  type Store1ActivationReadback,
  type Store1HttpInstruction,
  type Store1PackageAuthority,
} from "../../../tooling/server/store1-opera-admin-activation.js";

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
const authority: Store1PackageAuthority = {
  sourceHead: "891b89f198f89e52eef78d6da89a28641e7dcdce",
  sourceTree: "1437625f4deda50df2cfc4c45842e422913ab0e3",
  version: STORE1_VERSION,
  contractVersion: STORE1_CONTRACT,
  artifactSha256:
    "6914b0193f16c0dbcdc5ca59e031f1e190dad6bda5ebb37d6b5d31d147efd5af",
  filename: "OCTOPORT_v0.2.4_CHROMIUM_STORE.zip",
};
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
  const publicKeySpkiDer = generateKeyPairSync("ed25519").publicKey.export({
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
    () => "store1-admin-" + randomUUID(),
  );
  const elevated = await auth.createAdminSession(
    { sessionId: ADMIN_PORTAL, userId: ADMIN_USER, createdAt: NOW },
    "store1-admin-session",
  );
  if (!elevated.ok) throw new Error("admin fixture failed: " + elevated.code);
  csrf = auth.csrf(elevated.value.sessionToken);
  cookie =
    "pcp_admin_session=" +
    elevated.value.sessionToken +
    "; pcp_admin_csrf=" +
    csrf;
  return auth;
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
  if (path === "/v1/admin/compatibility/releases/0.2.4") {
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

async function runPlanner(maxSteps = 40) {
  const mutations: string[] = [];
  for (let step = 0; step < maxSteps; step += 1) {
    const plan = planStore1Activation(authority, readback);
    if (plan.status === "READY") return { plan, mutations };
    if (plan.status === "BLOCKED" || plan.status === "CONFLICT")
      throw new Error(plan.code + ": " + plan.detail);
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
    const beta = new BetaAdmissionService(createBetaAdmissionRepository(db));
    app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
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

  it("converges via authenticated HTTP and replay is mutation-free", async () => {
    const first = await runPlanner();
    expect(first.plan).toMatchObject({ status: "READY" });
    expect(first.mutations.slice(0, 7)).toEqual([
      "/v1/admin/compatibility/releases/0.2.4/publish",
      "/v1/admin/compatibility/policies/" + STORE1_POLICY_KEY + "/publish",
      "/v1/admin/compatibility/config-releases/publish",
      "/v1/admin/ai/registry/adapters",
      "/v1/admin/ai/registry/surfaces",
      "/v1/admin/ai/registry/variants",
      "/v1/admin/ai/profiles",
    ]);
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
