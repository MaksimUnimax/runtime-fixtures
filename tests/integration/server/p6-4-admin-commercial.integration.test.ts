import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../../apps/api/src/app.js";
import type { AppConfig } from "../../../packages/shared/src/index.js";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
  type AdminRole,
} from "../../../packages/server/admin-auth/src/index.js";
import {
  createAdminAuthRepository,
  createDatabaseRuntime,
  createP6AdminCommercialReadRepository,
  createP6AdminCompatibilityCommandAdapter,
  createP6AdminEntitlementCommandAdapter,
  createP6AdminPlanCommandAdapter,
  createP6AdminPriceCommandAdapter,
  createP3PolicyPublicationRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { computeP4PlanRevisionContentFingerprintV1 } from "../../../packages/server/plans/src/index.js";
import { createAdminCommercialService } from "../../../packages/server/admin-commercial/src/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for P6.4");
const NOW = new Date("2026-09-08T12:00:00.000Z");
const LATER = new Date("2026-09-09T12:00:00.000Z");
const EARLIER = new Date("2026-09-07T12:00:00.000Z");
const E08_FUTURE_OFFSET_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const futureFromExecutionClock = () =>
  new Date(Date.now() + E08_FUTURE_OFFSET_MS);
const config: AppConfig = {
  environment: "test",
  databaseUrl: connectionString,
  logLevel: "error",
  apiPort: 0,
  workerReadyDelayMs: 0,
};
type App = ReturnType<typeof createApiApp>;
type Session = { app: App; cookie: string; csrf: string; principalId: string };
type Value = {
  id: string;
  code: string;
  planId: string;
  amountMinor: number;
  assignmentRevision: number;
  contentFingerprintSha256: string;
  deprecatedAt: string | null;
  description: string;
  entitlements: unknown[];
  revision: number;
  selectedPriceRevisionId: string | null;
  state: string;
  status: string;
};
type Item = Value & {
  entitlementKey: string;
  browserFamily: string | null;
  blockedVersions: string[];
  linkedConfigVersions: string[];
};
type JsonBody = {
  id?: string;
  error: { code: string };
  value: Value;
  status: string;
  activationStatus: string;
  items: Item[];
  revisions: Value[];
  changed: boolean;
  nextCursor: string | null;
  effectiveValue: { value: boolean | number | string | null };
  revision: number;
  planId: string;
  browserFamily: string | null;
};
type Resp = { statusCode: number; json(): JsonBody };
let db: DatabaseRuntime;
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const id = () => randomUUID();
const key = (prefix: string) => `p64-${prefix}-${randomUUID().slice(0, 8)}`;
const rsn = (x: string) => `P6.4 ${x} operator reason`;
const iso = (d: Date) => d.toISOString();

async function clean() {
  await q("DROP TRIGGER IF EXISTS p64_plan_failure ON audit_events");
  await q("DROP TRIGGER IF EXISTS p64_price_failure ON audit_events");
  await q("DROP TRIGGER IF EXISTS p64_def_failure ON audit_events");
  await q("DROP TRIGGER IF EXISTS p64_override_failure ON audit_events");
  await q("DROP TRIGGER IF EXISTS p64_compat_failure ON audit_events");
  await q(
    "DROP FUNCTION IF EXISTS p64_fail_plan(),p64_fail_price(),p64_fail_def(),p64_fail_override(),p64_fail_compat()",
  );
  await q(
    "TRUNCATE beta_admission_mutations,beta_admissions,beta_admission_state,extension_release_contracts,extension_release_browsers,extension_releases,billing_reconciliation_jobs,checkout_intents,billing_events,subscription_transitions,payments,subscriptions,price_sale_assignments,price_revisions,prices,plan_entitlements,plan_revisions,entitlement_definitions,plans,config_release_compatibility_policies,config_releases,compatibility_policy_blocked_versions,compatibility_policy_revisions,admin_sessions,admin_role_grants,admin_principals,audit_events,account_memberships,portal_sessions,user_identities,accounts,users CASCADE",
  );
  await q(
    "INSERT INTO beta_admission_state(id,mode,capacity,admitted,revision,updated_at) VALUES(1,'CLOSED',0,0,1,$1)",
    [NOW],
  );
}
async function n(table: string, where = "TRUE", args: unknown[] = []) {
  const r = await q<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE ${where}`,
    args,
  );
  return Number(r.rows[0]!.count);
}
async function admin(
  role: AdminRole = "ADMIN_OWNER",
  revokeConfigPermissionAfterRouteAuth = false,
): Promise<Session> {
  const userId = id(),
    principalId = id(),
    portalId = id();
  await q(
    "INSERT INTO users(id,status,created_at,updated_at) VALUES($1,'ACTIVE',$2,$2)",
    [userId, NOW],
  );
  await q(
    "INSERT INTO portal_sessions(id,user_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",
    [portalId, userId, `portal-${portalId}`, NOW, LATER],
  );
  await q(
    "INSERT INTO admin_principals(id,user_id,status,revision,created_at,updated_at) VALUES($1,$2,'ACTIVE',1,$3,$3)",
    [principalId, userId, NOW],
  );
  await q(
    "INSERT INTO admin_role_grants(admin_principal_id,role,granted_at) VALUES($1,$2,$3)",
    [principalId, role, NOW],
  );
  const auth = new AdminAuthService(
    createAdminAuthRepository(db),
    deriveAdminAuthKeys(Buffer.alloc(32, 91)),
    () => NOW,
    () => `admin-${id()}`,
  );
  const elevated = await auth.createAdminSession(
    { sessionId: portalId, userId, createdAt: NOW },
    id(),
  );
  if (!elevated.ok) throw new Error(`admin fixture failed: ${elevated.code}`);
  const token = elevated.value.sessionToken,
    csrf = auth.csrf(token);
  const compatibility = createP6AdminCompatibilityCommandAdapter(db);
  const service = createAdminCommercialService(
    createP6AdminCommercialReadRepository(db),
    {
      plans: createP6AdminPlanCommandAdapter(db),
      prices: createP6AdminPriceCommandAdapter(db),
      overrides: createP6AdminEntitlementCommandAdapter(db),
      compatibility: revokeConfigPermissionAfterRouteAuth
        ? {
            ...compatibility,
            publishAdminConfigRelease: async (command, context) => {
              // This service method is reached only after the HTTP route guard
              // has authorized the request. Revoke before the adapter opens
              // its transaction to exercise the transaction-time check.
              await q(
                "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1 AND revoked_at IS NULL",
                [principalId, NOW],
              );
              return compatibility.publishAdminConfigRelease(command, context);
            },
          }
        : compatibility,
    },
  );
  const app = createApiApp({
    config,
    isInfrastructureReady: async () => true,
    adminAuthService: auth,
    adminCommercialService: service,
  });
  return {
    app,
    cookie: `pcp_admin_session=${token}; pcp_admin_csrf=${csrf}`,
    csrf,
    principalId,
  };
}
async function withAdmin<T>(
  role: AdminRole,
  work: (f: Session) => Promise<T>,
  revokeConfigPermissionAfterRouteAuth = false,
) {
  const f = await admin(role, revokeConfigPermissionAfterRouteAuth);
  try {
    return await work(f);
  } finally {
    await f.app.close();
  }
}
async function call(
  f: Session,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<Resp> {
  return f.app.inject({
    method,
    url,
    payload: body,
    headers: {
      cookie: f.cookie,
      ...(method === "POST" ? { "x-csrf-token": f.csrf } : {}),
    },
  });
}
const code = (r: Resp) => r.json().error.code;
const val = (r: Resp) => r.json().value;
function accepted(r: Resp) {
  expect(r.statusCode).toBe(200);
  expect(r.json().status).toBe("applied");
}
async function def(f: Session, type: "BOOLEAN" | "INTEGER" = "BOOLEAN") {
  const entitlementKey = key(type.toLowerCase());
  const r = await call(
    f,
    "POST",
    "/v1/admin/commercial/entitlements/definitions",
    {
      entitlementKey,
      valueType: type,
      securityClassification: type === "BOOLEAN" ? "CAPABILITY" : "LIMIT",
      description: `${type} definition`,
      reason: rsn("definition"),
    },
  );
  accepted(r);
  return { entitlementKey, value: val(r) };
}
async function plan(f: Session) {
  const p = await call(f, "POST", "/v1/admin/commercial/plans", {
    code: key("plan"),
    reason: rsn("plan"),
  });
  accepted(p);
  const planId = val(p).id as string;
  const d = await call(
    f,
    "POST",
    `/v1/admin/commercial/plans/${planId}/revisions`,
    { displayName: "P6.4 plan", description: "A plan", reason: rsn("draft") },
  );
  accepted(d);
  return { planId, draft: val(d) };
}
async function publishedPlan(f: Session) {
  const p = await plan(f);
  const r = await call(
    f,
    "POST",
    `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/publish`,
    {
      expectedContentFingerprint: p.draft.contentFingerprintSha256,
      reason: rsn("publish"),
    },
  );
  accepted(r);
  return { ...p, published: val(r) };
}
async function price(f: Session) {
  const p = await publishedPlan(f);
  const c = await call(f, "POST", "/v1/admin/commercial/prices", {
    planId: p.planId,
    code: key("price"),
    marketKey: "ru",
    channelKey: "web",
    reason: rsn("price"),
  });
  accepted(c);
  const priceId = val(c).id as string;
  const d = await call(
    f,
    "POST",
    `/v1/admin/commercial/prices/${priceId}/revisions`,
    {
      planRevisionId: p.published.id,
      amountMinor: 1990,
      currency: "RUB",
      billingIntervalUnit: "MONTH",
      billingIntervalCount: 1,
      effectiveFrom: iso(NOW),
      effectiveTo: null,
      reason: rsn("price draft"),
    },
  );
  accepted(d);
  return { ...p, priceId, draft: val(d) };
}
async function account() {
  const accountId = id();
  await q(
    "INSERT INTO accounts(id,status,display_name,created_at,updated_at) VALUES($1,'ACTIVE','P6.4',$2,$2)",
    [accountId, NOW],
  );
  return accountId;
}
async function boundAccount(
  f: Session,
  d: { entitlementKey: string },
  planValue: boolean,
) {
  const p = await plan(f);
  const set = await call(
    f,
    "POST",
    `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/entitlements/${d.entitlementKey}/set`,
    {
      expectedContentFingerprint: p.draft.contentFingerprintSha256,
      value: { kind: "BOOLEAN", value: planValue },
      reason: rsn("bind plan"),
    },
  );
  accepted(set);
  const pub = await call(
    f,
    "POST",
    `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/publish`,
    {
      expectedContentFingerprint: val(set).contentFingerprintSha256,
      reason: rsn("bind publish"),
    },
  );
  accepted(pub);
  const a = await account();
  await q(
    "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,started_at,current_period_start,current_period_end,cancel_at_period_end,state_reason,created_at,updated_at) VALUES($1,$2,'ACTIVE',1,$3,$4,$4,$5,false,'fixture',$4,$4)",
    [id(), a, val(pub).id, EARLIER, LATER],
  );
  return { accountId: a };
}
async function publishCompat(
  f: Session,
  policyKey = key("policy"),
  browserFamily: "chrome" | "yandex_chromium" | null = "chrome",
  extra: Record<string, unknown> = {},
) {
  const r = await call(
    f,
    "POST",
    `/v1/admin/compatibility/policies/${policyKey}/publish`,
    {
      contractVersion: "control_plane_v1",
      browserFamily,
      minimumExtensionVersion: null,
      recommendedExtensionVersion: null,
      minimumBrowserVersion: browserFamily ? "120" : null,
      maintenanceMode: false,
      maintenanceCode: null,
      blockedVersions: [],
      ...extra,
      reason: rsn("compat"),
    },
  );
  return r;
}
async function publishRelease(f: Session, version = "0.2.4") {
  return call(
    f,
    "POST",
    `/v1/admin/compatibility/releases/${version}/publish`,
    {
      version,
      releaseChannel: "stable",
      artifactSha256: "d".repeat(64),
      supportedContracts: ["control_plane_v2"],
      supportedBrowsers: ["opera"],
      reason: rsn("release"),
    },
  );
}
async function seedConfigSigningKey(active = true) {
  const keyId = key("config-signing");
  const publicKeySpkiDer = generateKeyPairSync("ed25519").publicKey.export({
    format: "der",
    type: "spki",
  });
  const publication = createP3PolicyPublicationRepository(db);
  const systemContext = {
    actorType: "SYSTEM" as const,
    correlationId: id(),
    reason: "integration fixture",
  };
  await publication.registerSigningKey(
    { keyId, publicKeySpkiDer },
    systemContext,
  );
  if (active) await publication.activateSigningKey(keyId, systemContext);
  return keyId;
}
async function seedConfigBaseline(
  compatibilityPolicyRevisionIds: string[] = [],
) {
  const signingKeyId = await seedConfigSigningKey();
  const publication = createP3PolicyPublicationRepository(db);
  const release = await publication.publishConfigRelease(
    {
      contractVersion: "control_plane_v2",
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
      signingKeyId,
      compatibilityPolicyRevisionIds,
      featureRuleRevisionIds: [],
      featureRolloutRevisionIds: [],
      publishedAt: NOW,
    },
    {
      actorType: "SYSTEM",
      correlationId: id(),
      reason: "integration baseline",
    },
  );
  return { configVersion: release.configVersion, signingKeyId };
}
function configReleaseBody(
  expectedLatestConfigVersion: number,
  policyRevisionId: string,
) {
  return {
    contractVersion: "control_plane_v2" as const,
    expectedLatestConfigVersion,
    compatibilityPolicyRevisionIds: [policyRevisionId],
    reason: rsn("publish config release"),
  };
}

describe.sequential("P6.4 behavioral real PostgreSQL acceptance matrix", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString);
    await db.ready();
    await runMigrations({ connectionString });
  });
  beforeEach(clean);
  afterAll(async () => db.close());

  describe("A authorization", () => {
    it("[A01] OWNER performs plan.manage mutation successfully", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await call(f, "POST", "/v1/admin/commercial/plans", {
          code: key("a01"),
          reason: rsn("a01"),
        });
        accepted(r);
        expect(await n("plans")).toBe(1);
      }));
    it("[A02] OWNER performs price.manage mutation successfully", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f);
        const r = await call(f, "POST", "/v1/admin/commercial/prices", {
          planId: p.planId,
          code: key("a02"),
          marketKey: "ru",
          channelKey: "web",
          reason: rsn("a02"),
        });
        accepted(r);
        expect(await n("prices")).toBe(1);
      }));
    it("[A03] OWNER performs entitlement-definition plan.manage mutation successfully", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await def(f);
        expect(await n("entitlement_definitions")).toBe(1);
      }));
    it("[A04] OWNER performs entitlement.override mutation successfully", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          a = await account();
        const r = await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("a04"),
          },
        );
        accepted(r);
        expect(await n("account_entitlement_overrides")).toBe(1);
      }));
    it("[A05] OWNER performs compatibility.manage publish successfully", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await publishCompat(f, key("a05"), null);
        expect(r.statusCode).toBe(200);
        expect(r.json().activationStatus).toBe(
          "REVISION_PUBLISHED_NOT_AUTO_ACTIVATED",
        );
      }));
    it("[A05b] OWNER publishes STORE-1 v2 release and compatibility policy", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const release = await publishRelease(f);
        expect(release.statusCode).toBe(200);
        expect(release.json()).toMatchObject({
          version: "0.2.4",
          artifactSha256: "d".repeat(64),
        });
        expect(release.json()).not.toHaveProperty("reason");
        expect(release.json()).not.toHaveProperty("privateKey");
        const auditAfterPublish = await n("audit_events", "actor_type='ADMIN'");
        const duplicate = await publishRelease(f);
        expect(duplicate.statusCode).toBe(409);
        expect(await n("extension_releases")).toBe(1);
        expect(await n("audit_events", "actor_type='ADMIN'")).toBe(
          auditAfterPublish,
        );
        await publishCompat(f, "store1.opera.v2", "opera", {
          contractVersion: "control_plane_v2",
          minimumExtensionVersion: "0.2.4",
          recommendedExtensionVersion: "0.2.4",
          minimumBrowserVersion: "136",
        });
        expect(
          (
            await q("SELECT contract_version FROM extension_release_contracts")
          ).rows.map((row) => row.contract_version),
        ).toEqual(["control_plane_v2"]);
        expect(
          (
            await q("SELECT browser_family FROM extension_release_browsers")
          ).rows.map((row) => row.browser_family),
        ).toEqual(["opera"]);
        expect(
          (await q("SELECT artifact_sha256 FROM extension_releases")).rows[0]
            ?.artifact_sha256,
        ).toBe("d".repeat(64));
        expect(
          (
            await q(
              "SELECT contract_version,minimum_browser_version FROM compatibility_policy_revisions WHERE policy_key='store1.opera.v2'",
            )
          ).rows[0],
        ).toMatchObject({
          contract_version: "control_plane_v2",
          minimum_browser_version: "136",
        });
        expect(
          (await q("SELECT mode FROM beta_admission_state WHERE id=1")).rows[0]
            ?.mode,
        ).toBe("CLOSED");
      }));
    it("[A05e] OWNER add-only config link preserves current v2 baseline and rejects no-op replay", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const existingPolicy = await publishCompat(
          f,
          key("existing-v2"),
          "chrome",
          { contractVersion: "control_plane_v2" },
        );
        const baseline = await seedConfigBaseline([
          String(existingPolicy.json().id),
        ]);
        const policy = await publishCompat(f, key("store1-v2"), "opera", {
          contractVersion: "control_plane_v2",
          minimumExtensionVersion: "0.2.4",
          recommendedExtensionVersion: "0.2.4",
        });
        expect(policy.statusCode).toBe(200);
        const correlationId = id();
        const reason = rsn("publish config release");
        const response = await f.app.inject({
          method: "POST",
          url: "/v1/admin/compatibility/config-releases/publish",
          headers: {
            cookie: f.cookie,
            "x-csrf-token": f.csrf,
            "x-request-id": correlationId,
          },
          payload: configReleaseBody(
            baseline.configVersion,
            String(policy.json().id),
          ),
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        const publishedConfig = response.json();
        expect(publishedConfig).toMatchObject({
          contractVersion: "control_plane_v2",
          snapshotVersion: "bootstrap_snapshot_v2",
          envelopeVersion: "bootstrap_envelope_v2",
          signingKeyId: baseline.signingKeyId,
        });
        expect(publishedConfig.configVersion).toEqual(expect.any(Number));
        expect(publishedConfig.configVersion).toBeGreaterThan(
          baseline.configVersion,
        );
        expect(publishedConfig).not.toHaveProperty("privateKey");
        expect(
          (
            await q(
              "SELECT policy_revision_id FROM config_release_compatibility_policies WHERE config_version=$1 ORDER BY policy_revision_id",
              [publishedConfig.configVersion],
            )
          ).rows.map((row) => row.policy_revision_id),
        ).toEqual(
          [String(existingPolicy.json().id), String(policy.json().id)].sort(),
        );
        const audit = (
          await q<{
            actor_type: string;
            actor_id: string;
            correlation_id: string;
            reason: string;
          }>(
            "SELECT actor_type,actor_id,correlation_id,reason FROM audit_events WHERE action='CONFIG_RELEASE_PUBLISHED' AND actor_type='ADMIN'",
          )
        ).rows[0];
        expect(audit).toEqual({
          actor_type: "ADMIN",
          actor_id: f.principalId,
          correlation_id: correlationId,
          reason,
        });
        const replay = await call(
          f,
          "POST",
          "/v1/admin/compatibility/config-releases/publish",
          configReleaseBody(
            Number(publishedConfig.configVersion),
            String(policy.json().id),
          ),
        );
        expect(replay.statusCode).toBe(409);
        expect(code(replay)).toBe("ADMIN_CONFLICT");
        expect(await n("config_releases")).toBe(2);
        expect(await n("beta_admission_state", "mode='OPEN'")).toBe(0);
      }));
    it("[A05f] transaction-time config permission revocation prevents config/link/audit mutation", async () =>
      withAdmin(
        "ADMIN_OWNER",
        async (f) => {
          const policy = await publishCompat(f, key("revoked-v2"), "opera", {
            contractVersion: "control_plane_v2",
          });
          const baseline = await seedConfigBaseline();
          const beforeAudit = await n("audit_events");
          const response = await call(
            f,
            "POST",
            "/v1/admin/compatibility/config-releases/publish",
            configReleaseBody(baseline.configVersion, String(policy.json().id)),
          );
          expect(response.statusCode).toBe(403);
          expect(code(response)).toBe("ADMIN_FORBIDDEN");
          expect(await n("config_releases")).toBe(1);
          expect(await n("config_release_compatibility_policies")).toBe(0);
          expect(await n("audit_events")).toBe(beforeAudit);
        },
        true,
      ));
    it("[A05g] ADMIN_OPS config publication is denied with no mutation", async () =>
      withAdmin("ADMIN_OPS", async (f) => {
        const beforeAudit = await n("audit_events");
        const response = await call(
          f,
          "POST",
          "/v1/admin/compatibility/config-releases/publish",
          configReleaseBody(1, id()),
        );
        expect(response.statusCode).toBe(403);
        expect(await n("config_releases")).toBe(0);
        expect(await n("config_release_compatibility_policies")).toBe(0);
        expect(await n("audit_events")).toBe(beforeAudit);
      }));
    it("[A05h] missing policy and revoked baseline signing authority fail closed without new publication", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const policy = await publishCompat(f, key("source-v2"), "opera", {
          contractVersion: "control_plane_v2",
        });
        const baseline = await seedConfigBaseline();
        const missingSource = await call(
          f,
          "POST",
          "/v1/admin/compatibility/config-releases/publish",
          configReleaseBody(baseline.configVersion, id()),
        );
        expect(missingSource.statusCode).toBe(404);
        expect(code(missingSource)).toBe("ADMIN_RESOURCE_NOT_FOUND");
        expect(await n("config_releases")).toBe(1);

        const publication = createP3PolicyPublicationRepository(db);
        await publication.revokeSigningKey(
          {
            keyId: baseline.signingKeyId,
            reasonCode: "store1-test-revoke",
          },
          {
            actorType: "SYSTEM",
            correlationId: id(),
            reason: "integration fixture revoke",
          },
        );
        const revokedSigningKey = await call(
          f,
          "POST",
          "/v1/admin/compatibility/config-releases/publish",
          configReleaseBody(baseline.configVersion, String(policy.json().id)),
        );
        expect(revokedSigningKey.statusCode).toBe(409);
        expect(code(revokedSigningKey)).toBe("ADMIN_CONFLICT");
        expect(await n("config_releases")).toBe(1);
        expect(await n("config_release_compatibility_policies")).toBe(0);
      }));
    it("[A05c] ADMIN_OPS is denied release publication without release or audit", async () =>
      withAdmin("ADMIN_OPS", async (f) => {
        const auditBefore = await n("audit_events", "actor_type='ADMIN'");
        const r = await publishRelease(f);
        expect(r.statusCode).toBe(403);
        expect(await n("extension_releases")).toBe(0);
        expect(await n("audit_events", "actor_type='ADMIN'")).toBe(auditBefore);
      }));
    it("[A05d] transaction-time revoked compatibility role denies release and audit", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await q(
          "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1 AND revoked_at IS NULL",
          [f.principalId, NOW],
        );
        const auditBefore = await n("audit_events", "actor_type='ADMIN'");
        await expect(
          createP6AdminCompatibilityCommandAdapter(db).publishExtensionRelease(
            {
              version: "0.2.4",
              releaseChannel: "stable",
              artifactSha256: "d".repeat(64),
              releasedAt: NOW,
              supportedContracts: ["control_plane_v2"],
              supportedBrowsers: ["opera"],
            },
            {
              actorType: "ADMIN",
              actorId: f.principalId,
              correlationId: id(),
              reason: rsn("revoked"),
            },
          ),
        ).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
        expect(await n("extension_releases")).toBe(0);
        expect(await n("audit_events", "actor_type='ADMIN'")).toBe(auditBefore);
      }));
    it("[A06] ADMIN_OPS performs compatibility.read successfully", async () =>
      withAdmin("ADMIN_OPS", async (f) => {
        const r = await call(
          f,
          "GET",
          "/v1/admin/compatibility/policies?limit=1",
        );
        expect(r.statusCode).toBe(200);
        expect(r.json().items).toEqual([]);
      }));
    it("[A07] ADMIN_OPS compatibility.manage mutation is forbidden", async () =>
      withAdmin("ADMIN_OPS", async (f) => {
        const r = await publishCompat(f, key("a07"));
        expect(r.statusCode).toBe(403);
        expect(code(r)).toBe("ADMIN_FORBIDDEN");
        expect(await n("compatibility_policy_revisions")).toBe(0);
      }));
    it("[A08] ADMIN_OPS plan.manage mutation is forbidden", async () =>
      withAdmin("ADMIN_OPS", async (f) => {
        const r = await call(f, "POST", "/v1/admin/commercial/plans", {
          code: key("a08"),
          reason: rsn("a08"),
        });
        expect(r.statusCode).toBe(403);
        expect(code(r)).toBe("ADMIN_FORBIDDEN");
        expect(await n("plans")).toBe(0);
      }));
    it("[A09] ADMIN_OPS price.manage mutation is forbidden", async () =>
      withAdmin("ADMIN_OPS", async (f) => {
        const r = await call(f, "POST", "/v1/admin/commercial/prices", {
          planId: id(),
          code: key("a09"),
          marketKey: "ru",
          channelKey: "web",
          reason: rsn("a09"),
        });
        expect(r.statusCode).toBe(403);
        expect(code(r)).toBe("ADMIN_FORBIDDEN");
        expect(await n("prices")).toBe(0);
      }));
    it("[A10] ADMIN_OPS entitlement.override mutation is forbidden", async () =>
      withAdmin("ADMIN_OPS", async (f) => {
        const r = await call(
          f,
          "POST",
          `/v1/admin/accounts/${id()}/entitlement-overrides/${key("a10")}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("a10"),
          },
        );
        expect(r.statusCode).toBe(403);
        expect(code(r)).toBe("ADMIN_FORBIDDEN");
        expect(await n("account_entitlement_overrides")).toBe(0);
      }));
    it("[A11] ADMIN_SUPPORT commercial mutation is forbidden", async () =>
      withAdmin("ADMIN_SUPPORT", async (f) => {
        const r = await call(f, "POST", "/v1/admin/commercial/plans", {
          code: key("a11"),
          reason: rsn("a11"),
        });
        expect(r.statusCode).toBe(403);
        expect(code(r)).toBe("ADMIN_FORBIDDEN");
        expect(await n("plans")).toBe(0);
      }));
    it("[A12] ADMIN_BILLING_READONLY commercial mutation is forbidden", async () =>
      withAdmin("ADMIN_BILLING_READONLY", async (f) => {
        const r = await call(f, "POST", "/v1/admin/commercial/plans", {
          code: key("a12"),
          reason: rsn("a12"),
        });
        expect(r.statusCode).toBe(403);
        expect(code(r)).toBe("ADMIN_FORBIDDEN");
        expect(await n("plans")).toBe(0);
      }));
    it("[A13] revoked role before transaction-time authority denies without domain or audit write", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await q(
          "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1",
          [f.principalId, NOW],
        );
        const before = await n("audit_events", "actor_type='ADMIN'");
        await expect(
          createP6AdminPlanCommandAdapter(db).createPlan(
            { code: key("a13") },
            {
              actorType: "ADMIN",
              actorId: f.principalId,
              correlationId: id(),
              reason: rsn("a13"),
            },
          ),
        ).rejects.toThrow("ADMIN_FORBIDDEN");
        expect(await n("plans")).toBe(0);
        expect(await n("audit_events", "actor_type='ADMIN'")).toBe(before);
      }));
    it("[A14] suspended principal before transaction-time authority denies without domain or audit write", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await q("UPDATE admin_principals SET status='SUSPENDED' WHERE id=$1", [
          f.principalId,
        ]);
        const before = await n("audit_events", "actor_type='ADMIN'");
        await expect(
          createP6AdminPlanCommandAdapter(db).createPlan(
            { code: key("a14") },
            {
              actorType: "ADMIN",
              actorId: f.principalId,
              correlationId: id(),
              reason: rsn("a14"),
            },
          ),
        ).rejects.toThrow("ADMIN_FORBIDDEN");
        expect(await n("plans")).toBe(0);
        expect(await n("audit_events", "actor_type='ADMIN'")).toBe(before);
      }));
  });

  describe("B plan", () => {
    it("[B01] create plan persists expected safe fields", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const c = key("b01"),
          r = await call(f, "POST", "/v1/admin/commercial/plans", {
            code: c,
            reason: rsn("b01"),
          });
        accepted(r);
        expect(
          (await q("SELECT code,status FROM plans")).rows[0],
        ).toMatchObject({ code: c, status: "DRAFT" });
      }));
    it("[B02] duplicate plan code returns accepted conflict and creates no second plan", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const c = key("b02");
        accepted(
          await call(f, "POST", "/v1/admin/commercial/plans", {
            code: c,
            reason: rsn("first"),
          }),
        );
        const r = await call(f, "POST", "/v1/admin/commercial/plans", {
          code: c,
          reason: rsn("duplicate"),
        });
        expect(r.statusCode).toBe(409);
        expect(await n("plans")).toBe(1);
      }));
    it("[B03] create draft plan revision persists revision 1 and DRAFT", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f);
        expect(p.draft).toMatchObject({ revision: 1, state: "DRAFT" });
      }));
    it("[B04] creating new draft for ARCHIVED plan is rejected", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f);
        await q("UPDATE plans SET status='ARCHIVED' WHERE id=$1", [p.planId]);
        const r = await call(
          f,
          "POST",
          `/v1/admin/commercial/plans/${p.planId}/revisions`,
          { displayName: "x", description: "x", reason: rsn("b04") },
        );
        expect(r.statusCode).toBe(409);
        expect(await n("plan_revisions")).toBe(1);
      }));
    it("[B05] inspected draft fingerprint equals accepted P4 calculation", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          r = await call(f, "GET", `/v1/admin/commercial/plans/${p.planId}`),
          d = r.json().revisions[0];
        expect(d.contentFingerprintSha256).toBe(
          computeP4PlanRevisionContentFingerprintV1({
            planRevisionId: d.id,
            planId: p.planId,
            revision: d.revision,
            displayName: d.displayName,
            description: d.description,
            entitlements: d.entitlements,
          }),
        );
      }));
    it("[B06] update draft changes mutable content and generates new fingerprint", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/update`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              description: "Changed",
              reason: rsn("b06"),
            },
          );
        accepted(r);
        expect(val(r).description).toBe("Changed");
        expect(val(r).contentFingerprintSha256).not.toBe(
          p.draft.contentFingerprintSha256,
        );
      }));
    it("[B07] semantic no-op draft update returns changed=false without audit mutation", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          before = await n("audit_events", "actor_type='ADMIN'");
        const r = await call(
          f,
          "POST",
          `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/update`,
          {
            expectedContentFingerprint: p.draft.contentFingerprintSha256,
            displayName: p.draft.displayName,
            reason: rsn("b07"),
          },
        );
        accepted(r);
        expect(r.json().changed).toBe(false);
        expect(await n("audit_events", "actor_type='ADMIN'")).toBe(before);
      }));
    it("[B08] stale draft fingerprint maps to ADMIN_STATE_STALE", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/update`,
            {
              expectedContentFingerprint: "0".repeat(64),
              description: "stale",
              reason: rsn("b08"),
            },
          );
        expect(r.statusCode).toBe(409);
        expect(code(r)).toBe("ADMIN_STATE_STALE");
      }));
    it("[B09] set BOOLEAN entitlement persists typed BOOLEAN value", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          p = await plan(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/entitlements/${d.entitlementKey}/set`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              value: { kind: "BOOLEAN", value: true },
              reason: rsn("b09"),
            },
          );
        accepted(r);
        expect(val(r).entitlements[0].value).toEqual({
          kind: "BOOLEAN",
          value: true,
        });
        expect(
          (await q("SELECT boolean_value,integer_value FROM plan_entitlements"))
            .rows[0],
        ).toMatchObject({ boolean_value: true, integer_value: null });
      }));
    it("[B10] set INTEGER entitlement persists typed INTEGER value", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f, "INTEGER"),
          p = await plan(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/entitlements/${d.entitlementKey}/set`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              value: { kind: "INTEGER", value: 7 },
              reason: rsn("b10"),
            },
          );
        accepted(r);
        expect(val(r).entitlements[0].value).toEqual({
          kind: "INTEGER",
          value: 7,
        });
        expect(
          (await q("SELECT integer_value FROM plan_entitlements")).rows[0]!
            .integer_value,
        ).toBe("7");
      }));
    it("[B11] entitlement type mismatch is rejected and draft remains unchanged", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f, "INTEGER"),
          p = await plan(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/entitlements/${d.entitlementKey}/set`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              value: { kind: "BOOLEAN", value: true },
              reason: rsn("b11"),
            },
          );
        expect(r.statusCode).toBe(409);
        expect(await n("plan_entitlements")).toBe(0);
      }));
    it("[B12] deprecated entitlement definition rejects new draft SET", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          p = await plan(f);
        await q(
          "UPDATE entitlement_definitions SET deprecated_at=$2 WHERE entitlement_key=$1",
          [d.entitlementKey, NOW],
        );
        const r = await call(
          f,
          "POST",
          `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/entitlements/${d.entitlementKey}/set`,
          {
            expectedContentFingerprint: p.draft.contentFingerprintSha256,
            value: { kind: "BOOLEAN", value: true },
            reason: rsn("b12"),
          },
        );
        expect(r.statusCode).toBe(409);
        expect(await n("plan_entitlements")).toBe(0);
      }));
    it("[B13] remove existing draft entitlement updates fingerprint and persistence", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          p = await plan(f);
        const s = await call(
          f,
          "POST",
          `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/entitlements/${d.entitlementKey}/set`,
          {
            expectedContentFingerprint: p.draft.contentFingerprintSha256,
            value: { kind: "BOOLEAN", value: true },
            reason: rsn("set"),
          },
        );
        const r = await call(
          f,
          "POST",
          `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/entitlements/${d.entitlementKey}/remove`,
          {
            expectedContentFingerprint: val(s).contentFingerprintSha256,
            reason: rsn("remove"),
          },
        );
        accepted(r);
        expect(val(r).entitlements).toEqual([]);
        expect(await n("plan_entitlements")).toBe(0);
      }));
    it("[B14] remove absent entitlement preserves accepted P4 changed=false semantic", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          p = await plan(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/entitlements/${d.entitlementKey}/remove`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              reason: rsn("b14"),
            },
          );
        accepted(r);
        expect(r.json().changed).toBe(false);
      }));
    it("[B15] publish draft revision creates immutable PUBLISHED revision semantics", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/publish`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              reason: rsn("b15"),
            },
          );
        accepted(r);
        expect(val(r).state).toBe("PUBLISHED");
      }));
    it("[B16] modifying published revision is rejected and persisted revision remains unchanged", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await publishedPlan(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/revisions/${p.published.id}/update`,
            {
              expectedContentFingerprint: p.published.contentFingerprintSha256,
              description: "mutate",
              reason: rsn("b16"),
            },
          );
        expect(r.statusCode).toBe(409);
        expect(
          (await q("SELECT description FROM plan_revisions")).rows[0]!
            .description,
        ).toBe("A plan");
      }));
    it("[B17] DRAFT plan cannot become ACTIVE without a published revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/status`,
            {
              expectedStatus: "DRAFT",
              targetStatus: "ACTIVE",
              reason: rsn("b17"),
            },
          );
        expect(r.statusCode).toBe(409);
      }));
    it("[B18] plan becomes ACTIVE after a valid published revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await publishedPlan(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/status`,
            {
              expectedStatus: "DRAFT",
              targetStatus: "ACTIVE",
              reason: rsn("b18"),
            },
          );
        accepted(r);
        expect(val(r).status).toBe("ACTIVE");
      }));
    it("[B19] ACTIVE plan becomes HIDDEN using accepted status command", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await publishedPlan(f);
        accepted(
          await call(
            f,
            "POST",
            `/v1/admin/commercial/plans/${p.planId}/status`,
            {
              expectedStatus: "DRAFT",
              targetStatus: "ACTIVE",
              reason: rsn("active"),
            },
          ),
        );
        const r = await call(
          f,
          "POST",
          `/v1/admin/commercial/plans/${p.planId}/status`,
          {
            expectedStatus: "ACTIVE",
            targetStatus: "HIDDEN",
            reason: rsn("b19"),
          },
        );
        accepted(r);
        expect(val(r).status).toBe("HIDDEN");
      }));
    it("[B20] injected plan audit failure rolls the entire domain mutation back", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await q(
          "CREATE OR REPLACE FUNCTION p64_fail_plan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PLAN_CREATED' THEN RAISE EXCEPTION 'p64 plan audit'; END IF; RETURN NEW; END; $$",
        );
        await q(
          "CREATE TRIGGER p64_plan_failure AFTER INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p64_fail_plan()",
        );
        const r = await call(f, "POST", "/v1/admin/commercial/plans", {
          code: key("b20"),
          reason: rsn("b20"),
        });
        expect(r.statusCode).toBe(503);
        expect(await n("plans")).toBe(0);
        await q("DROP TRIGGER p64_plan_failure ON audit_events");
        await q("DROP FUNCTION p64_fail_plan()");
      }));
  });

  describe("C price", () => {
    it("[C01] create price persists plan/code/market/channel/status", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          c = key("c01"),
          r = await call(f, "POST", "/v1/admin/commercial/prices", {
            planId: p.planId,
            code: c,
            marketKey: "ru",
            channelKey: "web",
            reason: rsn("c01"),
          });
        accepted(r);
        expect(
          (
            await q(
              "SELECT plan_id,code,market_key,channel_key,status FROM prices",
            )
          ).rows[0],
        ).toMatchObject({
          plan_id: p.planId,
          code: c,
          market_key: "ru",
          channel_key: "web",
          status: "DRAFT",
        });
      }));
    it("[C02] duplicate price code is rejected without duplicate row", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          c = key("c02");
        accepted(
          await call(f, "POST", "/v1/admin/commercial/prices", {
            planId: p.planId,
            code: c,
            marketKey: "ru",
            channelKey: "web",
            reason: rsn("first"),
          }),
        );
        const r = await call(f, "POST", "/v1/admin/commercial/prices", {
          planId: p.planId,
          code: c,
          marketKey: "ru",
          channelKey: "web",
          reason: rsn("duplicate"),
        });
        expect(r.statusCode).toBe(409);
        expect(await n("prices")).toBe(1);
      }));
    it("[C03] create price for missing plan is rejected", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await call(f, "POST", "/v1/admin/commercial/prices", {
          planId: id(),
          code: key("c03"),
          marketKey: "ru",
          channelKey: "web",
          reason: rsn("c03"),
        });
        expect(r.statusCode).toBe(404);
        expect(code(r)).toBe("ADMIN_RESOURCE_NOT_FOUND");
      }));
    it("[C04] create price for archived plan is rejected", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f);
        await q("UPDATE plans SET status='ARCHIVED' WHERE id=$1", [p.planId]);
        const r = await call(f, "POST", "/v1/admin/commercial/prices", {
          planId: p.planId,
          code: key("c04"),
          marketKey: "ru",
          channelKey: "web",
          reason: rsn("c04"),
        });
        expect(r.statusCode).toBe(409);
        expect(await n("prices")).toBe(0);
      }));
    it("[C05] create draft price revision against valid published plan revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f);
        expect(p.draft).toMatchObject({ revision: 1, state: "DRAFT" });
      }));
    it("[C06] draft price revision rejects plan revision belonging to another plan", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const a = await publishedPlan(f),
          b = await publishedPlan(f),
          c = await call(f, "POST", "/v1/admin/commercial/prices", {
            planId: a.planId,
            code: key("c06"),
            marketKey: "ru",
            channelKey: "web",
            reason: rsn("c06"),
          });
        const r = await call(
          f,
          "POST",
          `/v1/admin/commercial/prices/${val(c).id}/revisions`,
          {
            planRevisionId: b.published.id,
            amountMinor: 1,
            currency: "RUB",
            billingIntervalUnit: "MONTH",
            billingIntervalCount: 1,
            effectiveFrom: iso(NOW),
            effectiveTo: null,
            reason: rsn("c06"),
          },
        );
        expect(r.statusCode).toBe(409);
        expect(await n("price_revisions")).toBe(0);
      }));
    it("[C07] accepted P4 semantics permit drafting against an unpublished plan revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          c = await call(f, "POST", "/v1/admin/commercial/prices", {
            planId: p.planId,
            code: key("c07"),
            marketKey: "ru",
            channelKey: "web",
            reason: rsn("c07"),
          }),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${val(c).id}/revisions`,
            {
              planRevisionId: p.draft.id,
              amountMinor: 1,
              currency: "RUB",
              billingIntervalUnit: "MONTH",
              billingIntervalCount: 1,
              effectiveFrom: iso(NOW),
              effectiveTo: null,
              reason: rsn("c07"),
            },
          );
        expect(r.statusCode).toBe(200);
        expect(await n("price_revisions")).toBe(1);
      }));
    it("[C08] update draft price terms changes fingerprint", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/update`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              amountMinor: 2990,
              reason: rsn("c08"),
            },
          );
        accepted(r);
        expect(val(r).amountMinor).toBe(2990);
        expect(val(r).contentFingerprintSha256).not.toBe(
          p.draft.contentFingerprintSha256,
        );
      }));
    it("[C09] semantic no-op draft price update returns changed=false", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          before = await n("audit_events", "actor_type='ADMIN'"),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/update`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              amountMinor: p.draft.amountMinor,
              reason: rsn("c09"),
            },
          );
        accepted(r);
        expect(r.json().changed).toBe(false);
        expect(await n("audit_events", "actor_type='ADMIN'")).toBe(before);
      }));
    it("[C10] stale price draft fingerprint maps to ADMIN_STATE_STALE", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/update`,
            {
              expectedContentFingerprint: "0".repeat(64),
              amountMinor: 2,
              reason: rsn("c10"),
            },
          );
        expect(r.statusCode).toBe(409);
        expect(code(r)).toBe("ADMIN_STATE_STALE");
      }));
    it("[C11] publish valid draft price revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/publish`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              reason: rsn("c11"),
            },
          );
        accepted(r);
        expect(val(r).state).toBe("PUBLISHED");
      }));
    it("[C12] published price revision is immutable to draft update", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          pub = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/publish`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              reason: rsn("pub"),
            },
          ),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/update`,
            {
              expectedContentFingerprint: val(pub).contentFingerprintSha256,
              amountMinor: 2,
              reason: rsn("c12"),
            },
          );
        expect(r.statusCode).toBe(409);
        expect(
          (await q("SELECT amount_minor FROM price_revisions")).rows[0]!
            .amount_minor,
        ).toBe("1990");
      }));
    it("[C13] price cannot activate without required published revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          c = await call(f, "POST", "/v1/admin/commercial/prices", {
            planId: p.planId,
            code: key("c13"),
            marketKey: "ru",
            channelKey: "web",
            reason: rsn("c13"),
          }),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${val(c).id}/status`,
            {
              expectedStatus: "DRAFT",
              targetStatus: "ACTIVE",
              reason: rsn("c13"),
            },
          );
        expect(r.statusCode).toBe(409);
      }));
    it("[C14] valid price status transition succeeds", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f);
        accepted(
          await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/publish`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              reason: rsn("c14 publish"),
            },
          ),
        );
        const r = await call(
          f,
          "POST",
          `/v1/admin/commercial/prices/${p.priceId}/status`,
          {
            expectedStatus: "DRAFT",
            targetStatus: "ACTIVE",
            reason: rsn("c14"),
          },
        );
        accepted(r);
        expect(val(r).status).toBe("ACTIVE");
      }));
    it("[C15] stale expected price status maps to ADMIN_STATE_STALE", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/status`,
            {
              expectedStatus: "ACTIVE",
              targetStatus: "HIDDEN",
              reason: rsn("c15"),
            },
          );
        expect(r.statusCode).toBe(409);
        expect(code(r)).toBe("ADMIN_STATE_STALE");
      }));
    it("[C16] first sale assignment creates accepted assignmentRevision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          pub = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/publish`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              reason: rsn("pub"),
            },
          ),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/sale-assignments`,
            {
              expectedLatestAssignmentRevision: null,
              selectedPriceRevisionId: val(pub).id,
              effectiveFrom: iso(NOW),
              reason: rsn("c16"),
            },
          );
        accepted(r);
        expect(val(r).assignmentRevision).toBe(1);
      }));
    it("[C17] stale expectedLatestAssignmentRevision maps to ADMIN_STATE_STALE", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          pub = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/publish`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              reason: rsn("pub"),
            },
          );
        accepted(
          await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/sale-assignments`,
            {
              expectedLatestAssignmentRevision: null,
              selectedPriceRevisionId: val(pub).id,
              effectiveFrom: iso(NOW),
              reason: rsn("first"),
            },
          ),
        );
        const r = await call(
          f,
          "POST",
          `/v1/admin/commercial/prices/${p.priceId}/sale-assignments`,
          {
            expectedLatestAssignmentRevision: null,
            selectedPriceRevisionId: null,
            effectiveFrom: iso(LATER),
            reason: rsn("c17"),
          },
        );
        expect(r.statusCode).toBe(409);
        expect(code(r)).toBe("ADMIN_STATE_STALE");
      }));
    it("[C18] assignment outside selected revision effective window is rejected", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f);
        const update = await call(
          f,
          "POST",
          `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/update`,
          {
            expectedContentFingerprint: p.draft.contentFingerprintSha256,
            effectiveTo: LATER.toISOString(),
            reason: rsn("window"),
          },
        );
        accepted(update);
        const pub = await call(
          f,
          "POST",
          `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/publish`,
          {
            expectedContentFingerprint: val(update).contentFingerprintSha256,
            reason: rsn("pub"),
          },
        );
        accepted(pub);
        const r = await call(
          f,
          "POST",
          `/v1/admin/commercial/prices/${p.priceId}/sale-assignments`,
          {
            expectedLatestAssignmentRevision: null,
            selectedPriceRevisionId: val(pub).id,
            effectiveFrom: iso(LATER),
            reason: rsn("c18"),
          },
        );
        expect(r.statusCode).toBe(409);
      }));
    it("[C19] selected null closes sale according to accepted P4 assignment semantics", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          pub = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/publish`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              reason: rsn("pub"),
            },
          );
        accepted(
          await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/sale-assignments`,
            {
              expectedLatestAssignmentRevision: null,
              selectedPriceRevisionId: val(pub).id,
              effectiveFrom: iso(NOW),
              reason: rsn("open"),
            },
          ),
        );
        const r = await call(
          f,
          "POST",
          `/v1/admin/commercial/prices/${p.priceId}/sale-assignments`,
          {
            expectedLatestAssignmentRevision: 1,
            selectedPriceRevisionId: null,
            effectiveFrom: iso(LATER),
            reason: rsn("c19"),
          },
        );
        accepted(r);
        expect(val(r).selectedPriceRevisionId).toBeNull();
      }));
    it("[C20] price inspection fingerprint and terms are persisted safely", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          r = await call(f, "GET", `/v1/admin/commercial/prices/${p.priceId}`);
        expect(r.statusCode).toBe(200);
        expect(r.json().revisions[0]).toMatchObject({
          amountMinor: 1990,
          currency: "RUB",
        });
        expect(r.json().revisions[0].contentFingerprintSha256).toMatch(
          /^[0-9a-f]{64}$/,
        );
      }));
    it("[C21] injected price audit failure rolls mutation back", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await q(
          "CREATE OR REPLACE FUNCTION p64_fail_price() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PRICE_CREATED' THEN RAISE EXCEPTION 'p64 price audit'; END IF; RETURN NEW; END; $$",
        );
        await q(
          "CREATE TRIGGER p64_price_failure AFTER INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p64_fail_price()",
        );
        const p = await plan(f),
          r = await call(f, "POST", "/v1/admin/commercial/prices", {
            planId: p.planId,
            code: key("c21"),
            marketKey: "ru",
            channelKey: "web",
            reason: rsn("c21"),
          });
        expect(r.statusCode).toBe(503);
        expect(await n("prices")).toBe(0);
        await q("DROP TRIGGER p64_price_failure ON audit_events");
        await q("DROP FUNCTION p64_fail_price()");
      }));
  });

  describe("D definitions", () => {
    it("[D01] create BOOLEAN/CAPABILITY definition", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f);
        expect(d.value).toMatchObject({
          valueType: "BOOLEAN",
          securityClassification: "CAPABILITY",
        });
      }));
    it("[D02] create INTEGER/LIMIT definition", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f, "INTEGER");
        expect(d.value).toMatchObject({
          valueType: "INTEGER",
          securityClassification: "LIMIT",
        });
      }));
    it("[D03] duplicate entitlement definition rejected", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          r = await call(
            f,
            "POST",
            "/v1/admin/commercial/entitlements/definitions",
            {
              entitlementKey: d.entitlementKey,
              valueType: "BOOLEAN",
              securityClassification: "CAPABILITY",
              description: "duplicate",
              reason: rsn("d03"),
            },
          );
        expect(r.statusCode).toBe(409);
        expect(await n("entitlement_definitions")).toBe(1);
      }));
    it("[D04] update definition description succeeds", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/entitlements/definitions/${d.entitlementKey}/description`,
            {
              expectedDescription: "BOOLEAN definition",
              newDescription: "Updated",
              reason: rsn("d04"),
            },
          );
        accepted(r);
        expect(val(r).description).toBe("Updated");
      }));
    it("[D05] stale expectedDescription maps to ADMIN_STATE_STALE", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/entitlements/definitions/${d.entitlementKey}/description`,
            {
              expectedDescription: "wrong",
              newDescription: "Updated",
              reason: rsn("d05"),
            },
          );
        expect(r.statusCode).toBe(409);
        expect(code(r)).toBe("ADMIN_STATE_STALE");
      }));
    it("[D06] deprecate definition persists deprecatedAt", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/commercial/entitlements/definitions/${d.entitlementKey}/deprecate`,
            { reason: rsn("d06") },
          );
        accepted(r);
        expect(val(r).deprecatedAt).toBeTruthy();
      }));
    it("[D07] deprecated definition cannot receive a new account SET override", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f);
        await call(
          f,
          "POST",
          `/v1/admin/commercial/entitlements/definitions/${d.entitlementKey}/deprecate`,
          { reason: rsn("deprecate") },
        );
        const a = await account(),
          r = await call(
            f,
            "POST",
            `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
            {
              expectedLatestRevision: null,
              value: { kind: "BOOLEAN", value: true },
              effectiveFrom: iso(NOW),
              expiresAt: null,
              reason: rsn("d07"),
            },
          );
        expect(r.statusCode).toBe(409);
        expect(await n("account_entitlement_overrides")).toBe(0);
      }));
    it("[D08] exact entitlementKey read filter returns only requested definition", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const a = await def(f),
          b = await def(f),
          r = await call(
            f,
            "GET",
            `/v1/admin/commercial/entitlements/definitions?entitlementKey=${a.entitlementKey}`,
          );
        expect(r.json().items.map((x) => x.entitlementKey)).toEqual([
          a.entitlementKey,
        ]);
        expect(b.entitlementKey).not.toBe(a.entitlementKey);
      }));
    it("[D09] safe definition projection contains allowed fields and no audit data", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          r = await call(
            f,
            "GET",
            `/v1/admin/commercial/entitlements/definitions?entitlementKey=${d.entitlementKey}`,
          );
        expect(r.statusCode).toBe(200);
        expect(JSON.stringify(r.json())).not.toMatch(/audit|operator|reason/i);
      }));
    it("[D10] injected definition audit failure rolls mutation back", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await q(
          "CREATE OR REPLACE FUNCTION p64_fail_def() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ENTITLEMENT_DEFINITION_CREATED' THEN RAISE EXCEPTION 'p64 definition audit'; END IF; RETURN NEW; END; $$",
        );
        await q(
          "CREATE TRIGGER p64_def_failure AFTER INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p64_fail_def()",
        );
        const r = await call(
          f,
          "POST",
          "/v1/admin/commercial/entitlements/definitions",
          {
            entitlementKey: key("d10"),
            valueType: "BOOLEAN",
            securityClassification: "CAPABILITY",
            description: "rollback",
            reason: rsn("d10"),
          },
        );
        expect(r.statusCode).toBe(503);
        expect(await n("entitlement_definitions")).toBe(0);
        await q("DROP TRIGGER p64_def_failure ON audit_events");
        await q("DROP FUNCTION p64_fail_def()");
      }));
  });

  describe("E overrides", () => {
    it("[E01] first SET creates revision 1", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          a = await account(),
          r = await call(
            f,
            "POST",
            `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
            {
              expectedLatestRevision: null,
              value: { kind: "BOOLEAN", value: true },
              effectiveFrom: iso(NOW),
              expiresAt: null,
              reason: rsn("e01"),
            },
          );
        accepted(r);
        expect(val(r).revision).toBe(1);
      }));
    it("[E02] subsequent SET with expected revision creates next revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          a = await account();
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("one"),
          },
        );
        const r = await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: 1,
            value: { kind: "BOOLEAN", value: false },
            effectiveFrom: iso(LATER),
            expiresAt: null,
            reason: rsn("e02"),
          },
        );
        accepted(r);
        expect(val(r).revision).toBe(2);
      }));
    it("[E03] CLEAR creates next accepted revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          a = await account();
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("set"),
          },
        );
        const r = await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/clear`,
          {
            expectedLatestRevision: 1,
            effectiveFrom: iso(LATER),
            expiresAt: null,
            reason: rsn("e03"),
          },
        );
        accepted(r);
        expect(val(r)).toMatchObject({ revision: 2, operation: "CLEAR" });
      }));
    it("[E04] stale expectedLatestRevision maps to ADMIN_STATE_STALE", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          a = await account();
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("set"),
          },
        );
        const r = await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: false },
            effectiveFrom: iso(LATER),
            expiresAt: null,
            reason: rsn("e04"),
          },
        );
        expect(r.statusCode).toBe(409);
        expect(code(r)).toBe("ADMIN_STATE_STALE");
      }));
    it("[E05] wrong typed value is rejected without new override revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f, "INTEGER"),
          a = await account(),
          r = await call(
            f,
            "POST",
            `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
            {
              expectedLatestRevision: null,
              value: { kind: "BOOLEAN", value: true },
              effectiveFrom: iso(NOW),
              expiresAt: null,
              reason: rsn("e05"),
            },
          );
        expect(r.statusCode).toBe(409);
        expect(await n("account_entitlement_overrides")).toBe(0);
      }));
    it("[E06] unknown entitlement definition is rejected", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await call(
          f,
          "POST",
          `/v1/admin/accounts/${await account()}/entitlement-overrides/${key("unknown")}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("e06"),
          },
        );
        expect(r.statusCode).toBe(404);
        expect(await n("account_entitlement_overrides")).toBe(0);
      }));
    it("[E07] missing account is rejected without override row", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          r = await call(
            f,
            "POST",
            `/v1/admin/accounts/${id()}/entitlement-overrides/${d.entitlementKey}/set`,
            {
              expectedLatestRevision: null,
              value: { kind: "BOOLEAN", value: true },
              effectiveFrom: iso(NOW),
              expiresAt: null,
              reason: rsn("e07"),
            },
          );
        expect(r.statusCode).toBe(404);
        expect(await n("account_entitlement_overrides")).toBe(0);
      }));
    it("[E08] future-dated override does not affect resolution before effectiveFrom", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          b = await boundAccount(f, d, false);
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${b.accountId}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(futureFromExecutionClock()),
            expiresAt: null,
            reason: rsn("e08"),
          },
        );
        const r = await call(
          f,
          "GET",
          `/v1/admin/accounts/${b.accountId}/entitlements/${d.entitlementKey}`,
        );
        expect(r.json().effectiveValue.value).toBe(false);
      }));
    it("[E09] active SET override supersedes plan value", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          b = await boundAccount(f, d, false);
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${b.accountId}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(EARLIER),
            expiresAt: null,
            reason: rsn("e09"),
          },
        );
        const r = await call(
          f,
          "GET",
          `/v1/admin/accounts/${b.accountId}/entitlements/${d.entitlementKey}`,
        );
        expect(r.json().effectiveValue.value).toBe(true);
      }));
    it("[E10] expired override falls back to plan value", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          b = await boundAccount(f, d, true);
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${b.accountId}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: false },
            effectiveFrom: iso(EARLIER),
            expiresAt: iso(new Date(EARLIER.getTime() + 1000)),
            reason: rsn("e10"),
          },
        );
        const r = await call(
          f,
          "GET",
          `/v1/admin/accounts/${b.accountId}/entitlements/${d.entitlementKey}`,
        );
        expect(r.json().effectiveValue.value).toBe(true);
      }));
    it("[E11] active CLEAR falls back to plan value", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          b = await boundAccount(f, d, true);
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${b.accountId}/entitlement-overrides/${d.entitlementKey}/clear`,
          {
            expectedLatestRevision: null,
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("e11"),
          },
        );
        const r = await call(
          f,
          "GET",
          `/v1/admin/accounts/${b.accountId}/entitlements/${d.entitlementKey}`,
        );
        expect(r.json().effectiveValue.value).toBe(true);
      }));
    it("[E12] history is newest-first and continuation cursor returns distinct rows", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          a = await account();
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(EARLIER),
            expiresAt: null,
            reason: rsn("one"),
          },
        );
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: 1,
            value: { kind: "BOOLEAN", value: false },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("two"),
          },
        );
        const first = await call(
            f,
            "GET",
            `/v1/admin/accounts/${a}/entitlement-overrides?limit=1`,
          ),
          second = await call(
            f,
            "GET",
            `/v1/admin/accounts/${a}/entitlement-overrides?limit=1&cursor=${first.json().nextCursor}`,
          );
        expect(first.json().items[0].revision).toBe(2);
        expect(second.json().items[0].revision).toBe(1);
        expect(second.json().items[0].id).not.toBe(first.json().items[0].id);
      }));
    it("[E13] cursor cannot be reused for another account or incompatible filter", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          other = await def(f),
          a = await account(),
          b = await account();
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("e13"),
          },
        );
        const page = await call(
            f,
            "GET",
            `/v1/admin/accounts/${a}/entitlement-overrides?limit=1`,
          ),
          x = page.json().items[0].id;
        expect(
          code(
            await call(
              f,
              "GET",
              `/v1/admin/accounts/${b}/entitlement-overrides?limit=1&cursor=${x}`,
            ),
          ),
        ).toBe("INVALID_REQUEST");
        expect(
          code(
            await call(
              f,
              "GET",
              `/v1/admin/accounts/${a}/entitlement-overrides?limit=1&entitlementKey=${other.entitlementKey}&cursor=${x}`,
            ),
          ),
        ).toBe("INVALID_REQUEST");
      }));
    it("[E14] freeform operator reason is absent from safe override history", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          a = await account();
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: "private operator explanation",
          },
        );
        const r = await call(
          f,
          "GET",
          `/v1/admin/accounts/${a}/entitlement-overrides?limit=1`,
        );
        expect(JSON.stringify(r.json())).not.toContain(
          "private operator explanation",
        );
      }));
    it("[E15] injected override audit failure rolls mutation back", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          a = await account();
        await q(
          "CREATE OR REPLACE FUNCTION p64_fail_override() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ACCOUNT_ENTITLEMENT_OVERRIDE_SET' THEN RAISE EXCEPTION 'p64 override audit'; END IF; RETURN NEW; END; $$",
        );
        await q(
          "CREATE TRIGGER p64_override_failure AFTER INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p64_fail_override()",
        );
        const r = await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("e15"),
          },
        );
        expect(r.statusCode).toBe(503);
        expect(await n("account_entitlement_overrides")).toBe(0);
        await q("DROP TRIGGER p64_override_failure ON audit_events");
        await q("DROP FUNCTION p64_fail_override()");
      }));
  });

  describe("F compatibility", () => {
    it("[F01] OWNER publishes global compatibility revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await publishCompat(f, key("f01"), null);
        expect(r.statusCode).toBe(200);
        expect(r.json().browserFamily).toBeNull();
      }));
    it("[F02] OWNER publishes chrome-scoped compatibility revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await publishCompat(f, key("f02"), "chrome");
        expect(r.statusCode).toBe(200);
        expect(r.json().browserFamily).toBe("chrome");
      }));
    it("[F03] OWNER publishes yandex_chromium revision", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await publishCompat(f, key("f03"), "yandex_chromium");
        expect(r.statusCode).toBe(200);
        expect(r.json().browserFamily).toBe("yandex_chromium");
      }));
    it("[F04] sequential publishes for the same policy create increasing revisions", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = key("f04");
        expect((await publishCompat(f, p)).json().revision).toBe(1);
        expect((await publishCompat(f, p)).json().revision).toBe(2);
      }));
    it("[F05] blockedVersions persist and safe read returns sorted values", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = key("f05");
        await publishCompat(f, p, "chrome", {
          blockedVersions: ["2.0.0", "1.0.0"],
        });
        const r = await call(
          f,
          "GET",
          `/v1/admin/compatibility/policies?policyKey=${p}`,
        );
        expect(r.json().items[0].blockedVersions).toEqual(["1.0.0", "2.0.0"]);
      }));
    it("[F06] invalid minimum/recommended relationship is rejected", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await publishCompat(f, key("f06"), "chrome", {
          minimumExtensionVersion: "2.0.0",
          recommendedExtensionVersion: "1.0.0",
        });
        expect(r.statusCode).toBe(400);
        expect(await n("compatibility_policy_revisions")).toBe(0);
      }));
    it("[F07] maintenanceMode and maintenanceCode invariant is enforced", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await publishCompat(f, key("f07"), "chrome", {
          maintenanceMode: true,
          maintenanceCode: null,
        });
        expect(r.statusCode).toBe(400);
        expect(await n("compatibility_policy_revisions")).toBe(0);
      }));
    it("[F08] transaction-time compatibility.manage denial prevents revision and audit", async () =>
      withAdmin("ADMIN_OPS", async (f) => {
        const before = await n("audit_events", "actor_type='ADMIN'");
        const r = await publishCompat(f, key("f08"));
        expect(r.statusCode).toBe(403);
        expect(await n("compatibility_policy_revisions")).toBe(0);
        expect(await n("audit_events", "actor_type='ADMIN'")).toBe(before);
      }));
    it("[F09] concurrent same-policy publication produces distinct sequential revisions", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = key("f09"),
          results = await Promise.all([
            publishCompat(f, p),
            publishCompat(f, p),
          ]);
        expect(results.every((r) => r.statusCode === 200)).toBe(true);
        expect(
          (
            await q(
              "SELECT revision FROM compatibility_policy_revisions ORDER BY revision",
            )
          ).rows.map((x) => x.revision),
        ).toEqual([1, 2]);
      }));
    it("[F10] injected compatibility audit failure rolls publication back", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await q(
          "CREATE OR REPLACE FUNCTION p64_fail_compat() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'p64 compat audit'; END; $$",
        );
        await q(
          "CREATE TRIGGER p64_compat_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION p64_fail_compat()",
        );
        const r = await publishCompat(f, key("f10"));
        expect(r.statusCode).toBe(503);
        expect(await n("compatibility_policy_revisions")).toBe(0);
        await q("DROP TRIGGER p64_compat_failure ON audit_events");
        await q("DROP FUNCTION p64_fail_compat()");
      }));
    it("[F11] publication creates no config release", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await publishCompat(f, key("f11"));
        expect(await n("config_releases")).toBe(0);
      }));
    it("[F12] publication mutates no bootstrap/config rollout", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await publishCompat(f, key("f12"));
        expect(await n("config_release_compatibility_policies")).toBe(0);
        expect(await n("config_releases")).toBe(0);
      }));
    it("[F13] linkedConfigVersions is empty for an unlinked policy", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = key("f13");
        await publishCompat(f, p);
        const r = await call(
          f,
          "GET",
          `/v1/admin/compatibility/policies?policyKey=${p}`,
        );
        expect(r.json().items[0].linkedConfigVersions).toEqual([]);
      }));
    it("[F14] existing SYSTEM compatibility publication path remains readable", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = key("f14");
        await q(
          "INSERT INTO compatibility_policy_revisions(id,policy_key,revision,contract_version,browser_family,published_at,created_at) VALUES($1,$2,1,'control_plane_v1','chrome',$3,$3)",
          [id(), p, NOW],
        );
        const r = await call(
          f,
          "GET",
          `/v1/admin/compatibility/policies?policyKey=${p}`,
        );
        expect(r.statusCode).toBe(200);
        expect(r.json().items).toHaveLength(1);
      }));
  });

  describe("G reads and privacy", () => {
    it("[G01] plan list exact ID/code filtering and stable ordering", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const a = await call(f, "POST", "/v1/admin/commercial/plans", {
            code: key("g01a"),
            reason: rsn("g01"),
          }),
          b = await call(f, "POST", "/v1/admin/commercial/plans", {
            code: key("g01b"),
            reason: rsn("g01"),
          });
        const byId = await call(
            f,
            "GET",
            `/v1/admin/commercial/plans?planId=${val(a).id}`,
          ),
          byCode = await call(
            f,
            "GET",
            `/v1/admin/commercial/plans?code=${val(b).code}`,
          );
        expect(byId.json().items[0].id).toBe(val(a).id);
        expect(byCode.json().items[0].code).toBe(val(b).code);
      }));
    it("[G02] plan cursor invalid under incompatible status scope", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await plan(f);
        const first = await call(
            f,
            "GET",
            "/v1/admin/commercial/plans?limit=1",
          ),
          r = await call(
            f,
            "GET",
            `/v1/admin/commercial/plans?status=ACTIVE&limit=1&cursor=${first.json().items[0].id}`,
          );
        expect(r.statusCode).toBe(400);
        expect(code(r)).toBe("INVALID_REQUEST");
      }));
    it("[G03] price list exact plan/market/channel filtering", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          a = await call(f, "POST", "/v1/admin/commercial/prices", {
            planId: p.planId,
            code: key("g03a"),
            marketKey: "ru",
            channelKey: "web",
            reason: rsn("g03"),
          });
        await call(f, "POST", "/v1/admin/commercial/prices", {
          planId: p.planId,
          code: key("g03b"),
          marketKey: "us",
          channelKey: "app",
          reason: rsn("g03"),
        });
        const r = await call(
          f,
          "GET",
          "/v1/admin/commercial/prices?marketKey=ru&channelKey=web",
        );
        expect(r.json().items.map((x) => x.id)).toEqual([val(a).id]);
      }));
    it("[G04] price cursor invalid under incompatible query scope", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          a = await call(f, "POST", "/v1/admin/commercial/prices", {
            planId: p.planId,
            code: key("g04"),
            marketKey: "ru",
            channelKey: "web",
            reason: rsn("g04"),
          }),
          r = await call(
            f,
            "GET",
            `/v1/admin/commercial/prices?planId=${id()}&limit=1&cursor=${val(a).id}`,
          );
        expect(r.statusCode).toBe(400);
        expect(code(r)).toBe("INVALID_REQUEST");
      }));
    it("[G05] plan inspection returns safe revisions/entitlements/fingerprint without audit reason", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          r = await call(f, "GET", `/v1/admin/commercial/plans/${p.planId}`);
        expect(r.json().revisions[0].contentFingerprintSha256).toMatch(
          /^[0-9a-f]{64}$/,
        );
        expect(JSON.stringify(r.json())).not.toMatch(/audit|operator|reason/i);
      }));
    it("[G06] price inspection returns safe revisions/assignments without assignment reason", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          r = await call(f, "GET", `/v1/admin/commercial/prices/${p.priceId}`);
        expect(r.statusCode).toBe(200);
        expect(r.json().revisions).toHaveLength(1);
        expect(JSON.stringify(r.json())).not.toMatch(
          /operator|private reason/i,
        );
      }));
    it("[G07] definition pagination uses canonical cursor and deterministic continuation", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const ks = [key("g07a"), key("g07b"), key("g07c")].sort();
        for (const k of ks) {
          const r = await call(
            f,
            "POST",
            "/v1/admin/commercial/entitlements/definitions",
            {
              entitlementKey: k,
              valueType: "BOOLEAN",
              securityClassification: "CAPABILITY",
              description: k,
              reason: rsn("g07"),
            },
          );
          accepted(r);
        }
        const first = await call(
            f,
            "GET",
            "/v1/admin/commercial/entitlements/definitions?limit=2",
          ),
          second = await call(
            f,
            "GET",
            `/v1/admin/commercial/entitlements/definitions?limit=2&cursor=${first.json().nextCursor}`,
          );
        expect(second.json().items.map((x) => x.entitlementKey)).toEqual([
          ks[2],
        ]);
      }));
    it("[G08] override history account/filter cursor isolation and safe projection", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          a = await account(),
          b = await account();
        await call(
          f,
          "POST",
          `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: "secret",
          },
        );
        const page = await call(
            f,
            "GET",
            `/v1/admin/accounts/${a}/entitlement-overrides?limit=1`,
          ),
          wrong = await call(
            f,
            "GET",
            `/v1/admin/accounts/${b}/entitlement-overrides?limit=1&cursor=${page.json().items[0].id}`,
          );
        expect(code(wrong)).toBe("INVALID_REQUEST");
        expect(JSON.stringify(page.json())).not.toContain("secret");
      }));
    it("[G09] effective read returns accepted P4 source/value resolution", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          b = await boundAccount(f, d, false);
        const set = await call(
          f,
          "POST",
          `/v1/admin/accounts/${b.accountId}/entitlement-overrides/${d.entitlementKey}/set`,
          {
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: true },
            effectiveFrom: iso(EARLIER),
            expiresAt: null,
            reason: rsn("g09"),
          },
        );
        accepted(set);
        const r = await call(
          f,
          "GET",
          `/v1/admin/accounts/${b.accountId}/entitlements/${d.entitlementKey}`,
        );
        expect(r.json()).toMatchObject({
          effectiveValue: { kind: "BOOLEAN", value: true },
          source: "ACCOUNT_OVERRIDE",
        });
      }));
    it("[G10] compatibility read exposes safe policy data without signing/config payload", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = key("g10");
        expect((await publishCompat(f, p)).statusCode).toBe(200);
        const r = await call(
          f,
          "GET",
          `/v1/admin/compatibility/policies?policyKey=${p}`,
        );
        expect(JSON.stringify(r.json())).not.toMatch(
          /privateKey|signingKey|cohort|configPayload/i,
        );
      }));
  });

  describe("H concurrency and regression", () => {
    it("[H01] concurrent plan draft updates with same fingerprint yield one winner and one stale", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await plan(f),
          body = (description: string) => ({
            expectedContentFingerprint: p.draft.contentFingerprintSha256,
            description,
            reason: rsn("h01"),
          }),
          r = await Promise.all([
            call(
              f,
              "POST",
              `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/update`,
              body("one"),
            ),
            call(
              f,
              "POST",
              `/v1/admin/commercial/plans/${p.planId}/revisions/${p.draft.id}/update`,
              body("two"),
            ),
          ]);
        expect(r.filter((x) => x.statusCode === 200)).toHaveLength(1);
        expect(
          r.filter(
            (x) => x.statusCode === 409 && code(x) === "ADMIN_STATE_STALE",
          ),
        ).toHaveLength(1);
      }));
    it("[H02] concurrent price draft updates with same fingerprint yield one winner and one stale", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          body = (amountMinor: number) => ({
            expectedContentFingerprint: p.draft.contentFingerprintSha256,
            amountMinor,
            reason: rsn("h02"),
          }),
          r = await Promise.all([
            call(
              f,
              "POST",
              `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/update`,
              body(2000),
            ),
            call(
              f,
              "POST",
              `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/update`,
              body(3000),
            ),
          ]);
        expect(r.filter((x) => x.statusCode === 200)).toHaveLength(1);
        expect(
          r.filter(
            (x) => x.statusCode === 409 && code(x) === "ADMIN_STATE_STALE",
          ),
        ).toHaveLength(1);
      }));
    it("[H03] concurrent sale assignments with same expected revision yield one winner and one stale", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          pub = await call(
            f,
            "POST",
            `/v1/admin/commercial/prices/${p.priceId}/revisions/${p.draft.id}/publish`,
            {
              expectedContentFingerprint: p.draft.contentFingerprintSha256,
              reason: rsn("pub"),
            },
          ),
          body = (d: Date) => ({
            expectedLatestAssignmentRevision: null,
            selectedPriceRevisionId: val(pub).id,
            effectiveFrom: iso(d),
            reason: rsn("h03"),
          }),
          r = await Promise.all([
            call(
              f,
              "POST",
              `/v1/admin/commercial/prices/${p.priceId}/sale-assignments`,
              body(NOW),
            ),
            call(
              f,
              "POST",
              `/v1/admin/commercial/prices/${p.priceId}/sale-assignments`,
              body(LATER),
            ),
          ]);
        expect(r.filter((x) => x.statusCode === 200)).toHaveLength(1);
        expect(
          r.filter(
            (x) => x.statusCode === 409 && code(x) === "ADMIN_STATE_STALE",
          ),
        ).toHaveLength(1);
      }));
    it("[H04] concurrent account override writes with same expected revision yield one winner and one stale", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const d = await def(f),
          a = await account(),
          body = (v: boolean) => ({
            expectedLatestRevision: null,
            value: { kind: "BOOLEAN", value: v },
            effectiveFrom: iso(NOW),
            expiresAt: null,
            reason: rsn("h04"),
          }),
          r = await Promise.all([
            call(
              f,
              "POST",
              `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
              body(true),
            ),
            call(
              f,
              "POST",
              `/v1/admin/accounts/${a}/entitlement-overrides/${d.entitlementKey}/set`,
              body(false),
            ),
          ]);
        expect(r.filter((x) => x.statusCode === 200)).toHaveLength(1);
        expect(
          r.filter(
            (x) => x.statusCode === 409 && code(x) === "ADMIN_STATE_STALE",
          ),
        ).toHaveLength(1);
      }));
    it("[H05] admin role revoke racing a mutation never authorizes stale session snapshot", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        await q(
          "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1",
          [f.principalId, NOW],
        );
        await expect(
          createP6AdminPlanCommandAdapter(db).createPlan(
            { code: key("h05") },
            {
              actorType: "ADMIN",
              actorId: f.principalId,
              correlationId: id(),
              reason: rsn("h05"),
            },
          ),
        ).rejects.toThrow("ADMIN_FORBIDDEN");
        expect(await n("plans")).toBe(0);
      }));
    it("[H06] accepted P6.3 subscription mutation remains behind shared admin authorization", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await call(
          f,
          "GET",
          "/v1/admin/billing/subscriptions?limit=1",
        );
        expect([200, 404]).toContain(r.statusCode);
        expect(await n("plans")).toBe(0);
      }));
    it("[H07] accepted P6.2 principal authorization composition remains intact", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const r = await call(f, "GET", "/v1/admin/principals?limit=1");
        expect([200, 404]).toContain(r.statusCode);
        expect(await n("plans")).toBe(0);
      }));
    it("[H08] P4 catalog data remains readable after P6 composition", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = await price(f),
          r = await call(f, "GET", `/v1/admin/commercial/prices/${p.priceId}`);
        expect(r.statusCode).toBe(200);
        expect(r.json().planId).toBe(p.planId);
      }));
    it("[H09] P3 compatibility resolution remains unchanged until an independent config release", async () =>
      withAdmin("ADMIN_OWNER", async (f) => {
        const p = key("h09");
        expect((await publishCompat(f, p)).statusCode).toBe(200);
        expect(await n("config_releases")).toBe(0);
        const r = await call(
          f,
          "GET",
          `/v1/admin/compatibility/policies?policyKey=${p}`,
        );
        expect(r.json().items[0].linkedConfigVersions).toEqual([]);
      }));
  });
});
