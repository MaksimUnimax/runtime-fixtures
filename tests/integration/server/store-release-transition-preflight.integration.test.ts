import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
} from "../../../packages/server/admin-auth/src/index.js";
import { AdminAiService } from "../../../packages/server/admin-ai/src/index.js";
import { createAdminCommercialService } from "../../../packages/server/admin-commercial/src/index.js";
import type { AppConfig } from "../../../packages/shared/src/index.js";
import { createApiApp } from "../../../apps/api/src/app.js";
import {
  createAdminAuthRepository,
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
import {
  STORE1_AI_SURFACE,
  STORE1_BROWSER,
  STORE1_BROWSER_MINIMUM,
  STORE1_POLICY_KEY,
  STORE1_PROFILE_COMPATIBILITY,
  STORE1_PROFILE_CONTENT,
  STORE1_PROFILE_KEY,
} from "../../../tooling/server/store1-opera-admin-activation.js";
import {
  readStoreReleaseTransitionTarget,
  runStoreReleaseTransitionPreflight,
  type ReadOnlyJsonGet,
  type StoreReleaseTransitionTarget,
} from "../../../tooling/server/store-release-transition-preflight.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error(
    "DATABASE_URL is required for release transition integration",
  );

const NOW = new Date("2030-02-01T00:00:00.000Z");
const LATER = new Date("2030-02-02T00:00:00.000Z");
const USER = "41000000-0000-4000-8000-000000000001";
const PRINCIPAL = "41000000-0000-4000-8000-000000000002";
const PORTAL = "41000000-0000-4000-8000-000000000003";
const SIGNING_KEY = "release-transition-key";
const systemContext = (suffix: string) => ({
  actorType: "SYSTEM" as const,
  correlationId: "release-transition-" + suffix,
  reason: "release transition disposable fixture",
});
const adminContext = (suffix: string) => ({
  actorType: "ADMIN" as const,
  actorId: PRINCIPAL,
  correlationId: "release-transition-admin-" + suffix,
  reason: "release transition disposable fixture",
});

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
let candidateDirectory = "";
let transitionTarget: StoreReleaseTransitionTarget;

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) {
  return db.query<T>(text, values);
}

async function resetTransitionCatalog() {
  await q(
    "TRUNCATE " +
      [
        "adapter_profile_assignment_revisions",
        "adapter_profile_assignments",
        "adapter_profile_revisions",
        "adapter_profiles",
        "ai_variants",
        "ai_surfaces",
        "ai_adapters",
        "config_release_rollout_revisions",
        "config_release_feature_rules",
        "config_release_compatibility_policies",
        "config_releases",
        "signing_key_events",
        "signing_keys",
        "compatibility_policy_blocked_versions",
        "compatibility_policy_revisions",
        "extension_release_browsers",
        "extension_release_contracts",
        "extension_releases",
        "audit_events",
      ].join(",") +
      " RESTART IDENTITY CASCADE",
  );
}

async function seedV2BaseConfig() {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ format: "der", type: "spki" });
  const publication = createP3PolicyPublicationRepository(db);
  await publication.registerSigningKey(
    { keyId: SIGNING_KEY, publicKeySpkiDer: publicKey },
    systemContext("register-key"),
  );
  await publication.activateSigningKey(
    SIGNING_KEY,
    systemContext("activate-key"),
  );
  return publication.publishConfigRelease(
    {
      contractVersion: "control_plane_v2",
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
      signingKeyId: SIGNING_KEY,
      compatibilityPolicyRevisionIds: [],
      featureRuleRevisionIds: [],
      featureRolloutRevisionIds: [],
      publishedAt: NOW,
    },
    systemContext("base-config"),
  );
}

async function seedStoreCatalog(version: string, artifactSha256: string) {
  const publication = createP3PolicyPublicationRepository(db);
  await publication.publishExtensionRelease(
    {
      version,
      releaseChannel: "stable",
      artifactSha256,
      releasedAt: NOW,
      supportedContracts: ["control_plane_v2"],
      supportedBrowsers: [STORE1_BROWSER],
    },
    systemContext("release-" + version),
  );
  const policy = await publication.publishCompatibilityPolicyRevision(
    {
      policyKey: STORE1_POLICY_KEY,
      contractVersion: "control_plane_v2",
      browserFamily: STORE1_BROWSER,
      minimumExtensionVersion: version,
      recommendedExtensionVersion: version,
      minimumBrowserVersion: STORE1_BROWSER_MINIMUM,
      maintenanceMode: false,
      maintenanceCode: null,
      blockedVersions: [],
      publishedAt: NOW,
    },
    systemContext("policy-" + version),
  );
  await publication.publishConfigRelease(
    {
      contractVersion: "control_plane_v2",
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
      signingKeyId: SIGNING_KEY,
      compatibilityPolicyRevisionIds: [policy.id],
      featureRuleRevisionIds: [],
      featureRolloutRevisionIds: [],
      publishedAt: new Date(NOW.getTime() + 1000),
    },
    systemContext("config-" + version),
  );

  const commands = createP7AdminAiCommandRepository(db);
  const adapter = await commands.createAdapter({
    machineKey: "chatgpt",
    displayName: "ChatGPT",
    description: "STORE transition fixture",
    actorId: PRINCIPAL,
    correlationId: "release-transition-adapter-" + version,
    reason: "fixture",
  });
  const surface = await commands.createSurface({
    adapterId: adapter.id,
    machineKey: STORE1_AI_SURFACE,
    displayName: "Web",
    actorId: PRINCIPAL,
    correlationId: "release-transition-surface-" + version,
    reason: "fixture",
  });
  const profile = await commands.createProfile({
    adapterId: adapter.id,
    surfaceId: surface.id,
    variantId: null,
    machineKey: STORE1_PROFILE_KEY,
    displayName: "ChatGPT Web Opera",
    actorId: PRINCIPAL,
    correlationId: "release-transition-profile-" + version,
    reason: "fixture",
  });
  const lifecycle = createProfileLifecycleRepository(db);
  const draft = await lifecycle.createDraftProfileRevision({
    profileId: profile.id,
    content: STORE1_PROFILE_CONTENT,
    compatibility: STORE1_PROFILE_COMPATIBILITY,
    context: adminContext("profile-draft-" + version),
  });
  await lifecycle.markProfileRevisionCandidate({
    profileId: profile.id,
    revision: draft.revision,
    context: adminContext("profile-candidate-" + version),
  });
  const published = await lifecycle.publishProfileRevision({
    profileId: profile.id,
    revision: draft.revision,
    context: adminContext("profile-publish-" + version),
  });
  const assignment = await lifecycle.createAssignmentScope({
    scope: {
      adapterId: adapter.id,
      surfaceId: surface.id,
      variantId: null,
      browserFamily: STORE1_BROWSER,
      subjectKind: "ACCOUNT",
    },
    context: adminContext("assignment-scope-" + version),
  });
  await lifecycle.assignDirect({
    assignmentId: assignment.id,
    baselineProfileRevisionId: published.id,
    expectedLatestAssignmentRevision: null,
    context: adminContext("assignment-direct-" + version),
  });
}

async function snapshot() {
  const sql =
    "SELECT " +
    "(SELECT count(*)::text FROM extension_releases) AS releases," +
    "(SELECT count(*)::text FROM compatibility_policy_revisions) AS policies," +
    "(SELECT count(*)::text FROM config_releases) AS configs," +
    "(SELECT count(*)::text FROM ai_adapters) AS adapters," +
    "(SELECT count(*)::text FROM ai_surfaces) AS surfaces," +
    "(SELECT count(*)::text FROM adapter_profiles) AS profiles," +
    "(SELECT count(*)::text FROM adapter_profile_revisions) AS revisions," +
    "(SELECT count(*)::text FROM adapter_profile_assignments) AS assignments," +
    '(SELECT count(*)::text FROM adapter_profile_assignment_revisions) AS "assignmentRevisions"';
  const result = await q<{
    releases: string;
    policies: string;
    configs: string;
    adapters: string;
    surfaces: string;
    profiles: string;
    revisions: string;
    assignments: string;
    assignmentRevisions: string;
  }>(sql);
  return result.rows[0]!;
}

function apiGetter(options: { policyUnavailable?: boolean } = {}) {
  const paths: string[] = [];
  const get: ReadOnlyJsonGet = async (path) => {
    paths.push(path);
    if (
      options.policyUnavailable &&
      path.startsWith("/v1/admin/compatibility/policies?")
    )
      return { status: 503, body: { error: { code: "SERVICE_UNAVAILABLE" } } };
    const response = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie },
    });
    let body: unknown = {};
    if (response.body) {
      try {
        body = response.json();
      } catch {
        body = { code: "NON_JSON_RESPONSE" };
      }
    }
    return { status: response.statusCode, body };
  };
  return { get, paths };
}

function mismatchCodes(
  report: Awaited<ReturnType<typeof runStoreReleaseTransitionPreflight>>,
) {
  return report.mismatches.map((item) => item.code);
}

describe.sequential("STORE release transition read-only preflight", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString!);
    await db.ready();
    await q("DROP SCHEMA public CASCADE");
    await q("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await q("CREATE SCHEMA public");
    await runMigrations({ connectionString: connectionString! });

    await q(
      "INSERT INTO users(id,status,created_at,updated_at) VALUES($1,'ACTIVE',$2,$2)",
      [USER, NOW],
    );
    await q(
      "INSERT INTO portal_sessions(id,user_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",
      [PORTAL, USER, "release-transition-admin-source", NOW, LATER],
    );
    await q(
      "INSERT INTO admin_principals(id,user_id,status,revision,created_at,updated_at) VALUES($1,$2,'ACTIVE',1,$3,$3)",
      [PRINCIPAL, USER, NOW],
    );
    await q(
      "INSERT INTO admin_role_grants(admin_principal_id,role,granted_at) VALUES($1,'ADMIN_OWNER',$2)",
      [PRINCIPAL, NOW],
    );

    const adminAuth = new AdminAuthService(
      createAdminAuthRepository(db),
      deriveAdminAuthKeys(Buffer.alloc(32, 81)),
      () => NOW,
      () => Buffer.alloc(32, 82).toString("base64url"),
    );
    const elevated = await adminAuth.createAdminSession(
      { sessionId: PORTAL, userId: USER, createdAt: NOW },
      "release-transition-admin-session",
    );
    if (!elevated.ok)
      throw new Error("release transition admin session fixture failed");
    cookie = "pcp_admin_session=" + elevated.value.sessionToken;

    app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      adminAuthService: adminAuth,
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
        createProfileLifecycleRepository(db),
      ),
    });
    await app.ready();

    candidateDirectory = mkdtempSync(
      join(tmpdir(), "release-transition-integration-"),
    );
    const packageName = "OCTOPORT_v0.2.8_CHROMIUM_STORE.zip";
    const packagePath = join(candidateDirectory, packageName);
    const manifestPath = join(candidateDirectory, "B1_RC_MANIFEST.json");
    const bytes = Buffer.from("release-transition-integration-package");
    writeFileSync(packagePath, bytes);
    const artifactSha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: "b1_release_candidate_v2",
        authoritySha256: "9".repeat(64),
        source: {
          head: "3".repeat(40),
          tree: "4".repeat(40),
        },
        productVersion: "0.2.8",
        contractVersion: "control_plane_v2",
        migrationLevel: 54,
        packages: {
          chromium: {
            filename: packageName,
            sha256: artifactSha256,
            bytes: bytes.length,
            inventoryCount: 44,
            version: "0.2.8",
            browser: "chromium",
          },
        },
      }),
    );
    transitionTarget = readStoreReleaseTransitionTarget(
      manifestPath,
      packagePath,
    );
  });

  beforeEach(async () => {
    await resetTransitionCatalog();
    await seedV2BaseConfig();
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
    if (candidateDirectory)
      rmSync(candidateDirectory, { recursive: true, force: true });
  });

  async function runReadOnly(options: { policyUnavailable?: boolean } = {}) {
    const before = await snapshot();
    const { get, paths } = apiGetter(options);
    const report = await runStoreReleaseTransitionPreflight(
      transitionTarget,
      get,
    );
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(paths.length).toBeGreaterThan(0);
    expect(
      paths.every(
        (path) =>
          !path.includes("/publish") &&
          !path.includes("/direct") &&
          !path.includes("/rollout") &&
          !path.includes("/candidate"),
      ),
    ).toBe(true);
    return { report, paths };
  }

  it("reports the complete gap for an empty transition catalog with zero writes", async () => {
    const { report } = await runReadOnly();
    expect(report.status).toBe("MISMATCH");
    expect(mismatchCodes(report)).toEqual(
      expect.arrayContaining([
        "RELEASE_MISSING",
        "POLICY_MISSING",
        "CONFIG_TARGET_POLICY_UNAVAILABLE",
        "ADAPTER_MISSING",
      ]),
    );
  });

  it("reports all target mismatches from the known previous release", async () => {
    await seedStoreCatalog("0.2.7", "7".repeat(64));
    const { report } = await runReadOnly();
    expect(report.status).toBe("MISMATCH");
    expect(mismatchCodes(report)).toEqual(
      expect.arrayContaining([
        "RELEASE_MISSING",
        "POLICY_TARGET_MISMATCH",
        "CONFIG_TARGET_POLICY_UNAVAILABLE",
      ]),
    );
    expect(
      report.checks.find((item) => item.component === "profileRevision"),
    ).toMatchObject({ status: "READY", code: "PROFILE_REVISION_READY" });
    expect(
      report.checks.find((item) => item.component === "assignment"),
    ).toMatchObject({ status: "READY", code: "ASSIGNMENT_READY" });
  });

  it("accepts legacy scalar release when admin GET returns null browser membership rows", async () => {
    await seedStoreCatalog(
      transitionTarget.productVersion,
      transitionTarget.artifactSha256,
    );
    const { report, paths } = await runReadOnly();
    expect(report.status).toBe("READY");
    expect(mismatchCodes(report)).toEqual([]);
    expect(
      report.checks.find((item) => item.component === "release"),
    ).toMatchObject({ status: "READY", code: "RELEASE_READY" });
    expect(paths).toContain(
      "/v1/admin/compatibility/releases/" + transitionTarget.productVersion,
    );
    expect(
      paths.some((path) => path.includes("/v1/admin/ai/assignments?")),
    ).toBe(true);
  });

  it("keeps incomplete catalog authority UNKNOWN while exposing an independent conflict", async () => {
    const publication = createP3PolicyPublicationRepository(db);
    await publication.publishExtensionRelease(
      {
        version: transitionTarget.productVersion,
        releaseChannel: "stable",
        artifactSha256: "0".repeat(64),
        releasedAt: NOW,
        supportedContracts: ["control_plane_v2"],
        supportedBrowsers: [STORE1_BROWSER],
      },
      systemContext("incompatible-release"),
    );
    const { report } = await runReadOnly({ policyUnavailable: true });
    expect(report.status).toBe("UNKNOWN");
    expect(mismatchCodes(report)).toEqual(
      expect.arrayContaining(["RELEASE_CONFLICT", "POLICIES_HTTP_503"]),
    );
  });
});
