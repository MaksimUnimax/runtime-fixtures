import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../../apps/api/src/app.js";
import {
  bindConfigSigningMaterial,
  createConfigSigningService,
  loadConfigSigningMaterial,
} from "../../../apps/api/src/bootstrap-signing.js";
import { BootstrapService } from "../../../packages/server/bootstrap/src/index.js";
import {
  createDatabaseRuntime,
  createExtensionAuthRepository,
  createP3BootstrapPolicyCatalogRepository,
  createP3PolicyPublicationRepository,
  createBootstrapAiResolutionRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import {
  ExtensionAuthService,
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
} from "../../../packages/server/extension-auth/src/index.js";
import {
  selectRolloutCandidateV1,
  resolveP3BootstrapPolicy,
  verifyBootstrapEnvelope,
  verifyBootstrapEnvelopeV2,
} from "../../../packages/server/remote-config/src/index.js";
import { LocalClientAuthorityMaterializer } from "../../../packages/server/bootstrap/src/local-client-authority.js";
import { BootstrapAiResolutionService } from "../../../packages/server/bootstrap/src/ai-resolution.js";
import type { AppConfig } from "../../../packages/shared/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for real PostgreSQL tests");
const config: AppConfig = {
  environment: "test",
  databaseUrl: url,
  logLevel: "silent",
  apiPort: 3000,
  workerReadyDelayMs: 0,
};
const context = {
  actorType: "SYSTEM" as const,
  correlationId: "p3-4-integration",
};
const signing = generateKeyPairSync("ed25519");
const material = loadConfigSigningMaterial({
  CONFIG_SIGNING_KEY_ID: "p34-key",
  CONFIG_SIGNING_PRIVATE_KEY_PEM_B64: Buffer.from(
    signing.privateKey.export({ format: "pem", type: "pkcs8" }),
  ).toString("base64"),
});
let db: DatabaseRuntime;
let access: ExtensionAuthService;
let app: ReturnType<typeof createApiApp>;
let principal: { accountId: string; deviceId: string; token: string };
const request = (deviceId = principal.deviceId) => ({
  contractVersion: "control_plane_v1",
  extensionVersion: "1.2.3",
  browser: { family: "chrome", version: "123" },
  deviceId,
  lastConfigVersion: null,
  detectedAi: { family: "chat", surface: "page" },
});

async function clean() {
  await db.query(
    "TRUNCATE audit_events,config_release_rollout_revisions,config_release_feature_rules,rollouts,feature_rule_revisions,feature_definitions,config_release_compatibility_policies,config_releases,signing_key_events,signing_keys,compatibility_policy_blocked_versions,compatibility_policy_revisions,extension_release_browsers,extension_release_contracts,extension_releases,refresh_tokens,sessions,devices,device_authorizations,portal_sessions,user_identities,account_memberships,accounts,users,auth_rate_limit_buckets RESTART IDENTITY CASCADE",
  );
}
async function authenticated() {
  const userId = randomUUID(),
    accountId = randomUUID(),
    deviceId = randomUUID(),
    sessionId = randomUUID();
  await db.query("INSERT INTO users(id) VALUES($1)", [userId]);
  await db.query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
  await db.query(
    "INSERT INTO devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$2,$3,'chrome','1.2.3')",
    [deviceId, accountId, userId],
  );
  await db.query(
    "INSERT INTO sessions(id,device_id,account_id,token_family_id) VALUES($1,$2,$3,$4)",
    [sessionId, deviceId, accountId, randomUUID()],
  );
  const issued = await access.issue(sessionId);
  if (!issued.ok) throw new Error(issued.code);
  return { accountId, deviceId, token: issued.value.accessToken };
}
async function graph(
  options: {
    minimumExtensionVersion?: string;
    minimumBrowserVersion?: string | null;
    keyId?: string;
  } = {},
) {
  const p = createP3PolicyPublicationRepository(db);
  const now = new Date("2026-09-04T00:00:00.000Z");
  const keyId = options.keyId ?? material.keyId;
  const keyMetadata =
    keyId === material.keyId
      ? {
          spki: material.publicKeySpkiDer,
          sha256: material.publicKeySha256,
        }
      : (() => {
          const spki = generateKeyPairSync("ed25519").publicKey.export({
            format: "der",
            type: "spki",
          });
          return {
            spki,
            sha256: createHash("sha256").update(spki).digest("hex"),
          };
        })();
  await db.query(
    "INSERT INTO signing_keys(key_id,algorithm,public_key_spki_der,public_key_sha256) VALUES($1,'Ed25519',$2,$3) ON CONFLICT (key_id) DO NOTHING",
    [keyId, keyMetadata.spki, keyMetadata.sha256],
  );
  if (keyId !== material.keyId)
    await db.query(
      "INSERT INTO signing_key_events(key_id,event_type,occurred_at) VALUES($1,'REGISTERED',$2),($1,'ACTIVATED',$3)",
      [keyId, now, new Date(now.getTime() + 1)],
    );
  const compatibility = await p.publishCompatibilityPolicyRevision(
    {
      policyKey: "p34-policy",
      contractVersion: "control_plane_v1",
      browserFamily: null,
      minimumExtensionVersion: options.minimumExtensionVersion ?? "1.0.0",
      recommendedExtensionVersion:
        options.minimumExtensionVersion === "2.0.0" ? "2.1.0" : "1.1.0",
      minimumBrowserVersion: options.minimumBrowserVersion ?? null,
      maintenanceMode: false,
      maintenanceCode: null,
      blockedVersions: [],
      publishedAt: now,
    },
    context,
  );
  await p.createFeatureDefinition({ featureKey: "feature-p34" }, context);
  const feature = await p.publishFeatureRuleRevision(
    {
      featureKey: "feature-p34",
      contractVersion: "control_plane_v1",
      enabled: true,
      browserFamily: null,
      minimumExtensionVersion: "1.0.0",
      publishedAt: now,
    },
    context,
  );
  return p.publishConfigRelease(
    {
      contractVersion: "control_plane_v1",
      snapshotVersion: "bootstrap_snapshot_v1",
      envelopeVersion: "bootstrap_envelope_v1",
      signingKeyId: keyId,
      compatibilityPolicyRevisionIds: [compatibility.id],
      featureRuleRevisionIds: [feature.id],
      featureRolloutRevisionIds: [],
      publishedAt: now,
    },
    context,
  );
}

async function localAuthorityGraph() {
  const p = createP3PolicyPublicationRepository(db);
  const now = new Date("2026-09-05T00:00:00.000Z");
  const policy = await p.publishCompatibilityPolicyRevision(
    {
      policyKey: "local-v2-policy",
      contractVersion: "control_plane_v2",
      browserFamily: "firefox",
      minimumExtensionVersion: "1.2.0",
      recommendedExtensionVersion: "1.3.0",
      minimumBrowserVersion: "120",
      maintenanceMode: false,
      maintenanceCode: null,
      blockedVersions: ["1.0.0"],
      publishedAt: now,
    },
    context,
  );
  await p.publishExtensionRelease(
    {
      version: "1.0.0",
      releaseChannel: "stable",
      releasedAt: now,
      supportedContracts: ["control_plane_v2"],
      supportedBrowsers: ["firefox"],
    },
    context,
  );
  await p.publishExtensionRelease(
    {
      version: "2.0.0",
      releaseChannel: "stable",
      releasedAt: new Date(now.getTime() + 1),
      supportedContracts: ["control_plane_v1", "control_plane_v2"],
      supportedBrowsers: ["chrome", "firefox"],
    },
    context,
  );
  await p.createFeatureDefinition({ featureKey: "local-feature" }, context);
  const baseline = await p.publishFeatureRuleRevision(
    {
      featureKey: "local-feature",
      contractVersion: "control_plane_v2",
      enabled: false,
      browserFamily: null,
      minimumExtensionVersion: null,
      publishedAt: now,
    },
    context,
  );
  const candidate = await p.publishFeatureRuleRevision(
    {
      featureKey: "local-feature",
      contractVersion: "control_plane_v2",
      enabled: true,
      browserFamily: "firefox",
      minimumExtensionVersion: "2.0.0",
      publishedAt: new Date(now.getTime() + 1),
    },
    context,
  );
  await p.createRollout(
    {
      rolloutKey: "local-feature.rollout",
      targetKind: "FEATURE_RULE",
      subjectKind: "ACCOUNT",
    },
    context,
    Buffer.alloc(32, 7),
  );
  const rollout = await p.publishRolloutRevision(
    {
      rolloutKey: "local-feature.rollout",
      state: "ACTIVE",
      percentageBps: 5000,
      baselineFeatureRuleRevisionId: baseline.id,
      candidateFeatureRuleRevisionId: candidate.id,
      publishedAt: new Date(now.getTime() + 2),
    },
    context,
  );
  await p.createFeatureDefinition({ featureKey: "device-feature" }, context);
  const deviceBaseline = await p.publishFeatureRuleRevision(
    {
      featureKey: "device-feature",
      contractVersion: "control_plane_v2",
      enabled: false,
      browserFamily: null,
      minimumExtensionVersion: null,
      publishedAt: now,
    },
    context,
  );
  const deviceCandidate = await p.publishFeatureRuleRevision(
    {
      featureKey: "device-feature",
      contractVersion: "control_plane_v2",
      enabled: true,
      browserFamily: "chrome",
      minimumExtensionVersion: "3.0.0",
      publishedAt: new Date(now.getTime() + 1),
    },
    context,
  );
  await p.createRollout(
    {
      rolloutKey: "device-feature.rollout",
      targetKind: "FEATURE_RULE",
      subjectKind: "DEVICE",
    },
    context,
    Buffer.alloc(32, 9),
  );
  const deviceRollout = await p.publishRolloutRevision(
    {
      rolloutKey: "device-feature.rollout",
      state: "ACTIVE",
      percentageBps: 5000,
      baselineFeatureRuleRevisionId: deviceBaseline.id,
      candidateFeatureRuleRevisionId: deviceCandidate.id,
      publishedAt: new Date(now.getTime() + 2),
    },
    context,
  );
  return p.publishConfigRelease(
    {
      contractVersion: "control_plane_v2",
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
      signingKeyId: material.keyId,
      compatibilityPolicyRevisionIds: [policy.id],
      featureRuleRevisionIds: [baseline.id, deviceBaseline.id],
      featureRolloutRevisionIds: [rollout.id, deviceRollout.id],
      publishedAt: new Date(now.getTime() + 3),
    },
    context,
  );
}
async function post(body: unknown, token = principal.token) {
  return app.inject({
    method: "POST",
    url: "/v1/bootstrap",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: body,
  });
}

describe.sequential("P3.4 real PostgreSQL authenticated bootstrap", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(url!);
    await db.ready();
    await runMigrations({ connectionString: url! });
    access = new ExtensionAuthService(
      createExtensionAuthRepository(db),
      deriveExtensionAuthKeys(Buffer.alloc(32, 34)),
      undefined,
      createEphemeralAccessTokenSigningKey("p34-access"),
    );
  });
  beforeEach(async () => {
    await clean();
    principal = await authenticated();
    const catalog = createP3BootstrapPolicyCatalogRepository(db);
    await db.query(
      "INSERT INTO signing_keys(key_id,algorithm,public_key_spki_der,public_key_sha256) VALUES($1,'Ed25519',$2,$3)",
      [material.keyId, material.publicKeySpkiDer, material.publicKeySha256],
    );
    await db.query(
      "INSERT INTO signing_key_events(key_id,event_type,occurred_at) VALUES($1,'REGISTERED',$2),($1,'ACTIVATED',$3)",
      [
        material.keyId,
        new Date("2026-09-04T00:00:00.000Z"),
        new Date("2026-09-04T00:00:00.001Z"),
      ],
    );
    bindConfigSigningMaterial(
      material,
      await catalog.findSigningKey(material.keyId),
    );
    const localClientAuthority = new LocalClientAuthorityMaterializer(
      catalog,
      new BootstrapAiResolutionService(
        createBootstrapAiResolutionRepository(db),
      ),
    );
    app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      extensionAuthService: access,
      bootstrapService: new BootstrapService(
        { resolve: (input) => resolveP3BootstrapPolicy(input, catalog) },
        createConfigSigningService(material, catalog),
        { now: () => new Date("2026-09-04T00:00:00.000Z") },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        localClientAuthority,
      ),
    });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  it("returns a verified complete signed snapshot", async () => {
    const release = await graph();
    const response = await post(request());
    expect(response.statusCode).toBe(200);
    const verified = verifyBootstrapEnvelope(
      response.json(),
      new Map([[material.keyId, material.publicKey]]),
    );
    expect(verified).toMatchObject({ ok: true });
    if (verified.ok)
      expect(verified.payload).toMatchObject({
        configVersion: release.configVersion,
        devicePolicy: { status: "ACTIVE" },
        features: { "feature-p34": true },
        entitlements: {},
      });
  });
  it("returns existing 401 without a bearer", async () =>
    expect((await post(request(), "")).statusCode).toBe(401));
  it("returns INVALID_REQUEST for malformed input", async () =>
    expect(
      (await post({ ...request(), browser: { family: "bad", version: "1" } }))
        .statusCode,
    ).toBe(400));
  it("rejects mismatched device before resolution", async () =>
    expect((await post(request(randomUUID()))).statusCode).toBe(403));
  it("fails closed when no release exists", async () =>
    expect((await post(request())).statusCode).toBe(503));
  it("fails closed when config key differs from signer", async () => {
    await graph({ keyId: "other-key" });
    expect((await post(request())).statusCode).toBe(503);
  });
  it("rejects mismatched public signing metadata", () => {
    const other = generateKeyPairSync("ed25519").publicKey.export({
      format: "der",
      type: "spki",
    });
    expect(() =>
      bindConfigSigningMaterial(material, {
        keyId: material.keyId,
        algorithm: "Ed25519",
        publicKeySpkiDer: other,
        publicKeySha256: createHash("sha256").update(other).digest("hex"),
        createdAt: new Date(),
      }),
    ).toThrow();
  });
  it("signs UPDATE_REQUIRED instead of turning it into HTTP failure", async () => {
    await graph({ minimumExtensionVersion: "2.0.0" });
    const response = await post(request());
    const verified = verifyBootstrapEnvelope(
      response.json(),
      new Map([[material.keyId, material.publicKey]]),
    );
    expect(response.statusCode).toBe(200);
    expect(verified.ok && verified.payload.compatibility.extension.status).toBe(
      "UPDATE_REQUIRED",
    );
  });
  it("always returns a full snapshot when lastConfigVersion is current", async () => {
    const release = await graph();
    const response = await post({
      ...request(),
      lastConfigVersion: release.configVersion,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().payload).toBeDefined();
  });

  it("serves a verified privacy-neutral v2 snapshot without client software metadata", async () => {
    const release = await localAuthorityGraph();
    const response = await post({
      contractVersion: "control_plane_v2",
      deviceId: principal.deviceId,
      lastConfigVersion: null,
    });
    expect(response.statusCode).toBe(200);
    const verified = verifyBootstrapEnvelopeV2(
      response.json(),
      new Map([[material.keyId, material.publicKey]]),
    );
    expect(verified).toMatchObject({
      ok: true,
      payload: {
        contractVersion: "control_plane_v2",
        snapshotVersion: "bootstrap_snapshot_v2",
        configVersion: release.configVersion,
        account: { id: principal.accountId, status: "ACTIVE" },
        localClientAuthority: {
          schemaVersion: "local_client_authority_v1",
          contractVersion: "control_plane_v2",
          compatibility: {
            releases: expect.arrayContaining([
              expect.objectContaining({ extensionVersion: "2.0.0" }),
            ]),
          },
        },
      },
    });
    if (verified.ok) {
      expect(verified.payload).not.toHaveProperty("compatibility");
      expect(verified.payload).not.toHaveProperty("features");
      expect(verified.payload).not.toHaveProperty("ai");
    }
  });

  it("materializes bounded v2 compatibility and account-selected feature authority without software inputs", async () => {
    const release = await localAuthorityGraph();
    const catalog = createP3BootstrapPolicyCatalogRepository(db);
    const materializer = new LocalClientAuthorityMaterializer(
      catalog,
      new BootstrapAiResolutionService(
        createBootstrapAiResolutionRepository(db),
      ),
    );
    const result = await materializer.materialize({
      contractVersion: "control_plane_v2",
      accountId: principal.accountId,
      deviceId: principal.deviceId,
    });
    const accountCandidate = selectRolloutCandidateV1({
      state: "ACTIVE",
      percentageBps: 5000,
      rolloutKey: "local-feature.rollout",
      cohortSeed: Buffer.alloc(32, 7),
      subjectKind: "ACCOUNT",
      subjectId: principal.accountId,
    });
    const deviceCandidate = selectRolloutCandidateV1({
      state: "ACTIVE",
      percentageBps: 5000,
      rolloutKey: "device-feature.rollout",
      cohortSeed: Buffer.alloc(32, 9),
      subjectKind: "DEVICE",
      subjectId: principal.deviceId,
    });
    expect(result).toMatchObject({
      configVersion: release.configVersion,
      signingKeyId: material.keyId,
      localClientAuthority: {
        schemaVersion: "local_client_authority_v1",
        contractVersion: "control_plane_v2",
        compatibility: {
          releases: [
            {
              extensionVersion: "2.0.0",
              contractVersions: ["control_plane_v1", "control_plane_v2"],
              browserFamilies: ["chrome", "firefox"],
            },
            {
              extensionVersion: "1.0.0",
              contractVersions: ["control_plane_v2"],
              browserFamilies: ["firefox"],
            },
          ],
          policies: [
            { policyKey: "local-v2-policy", blockedVersions: ["1.0.0"] },
          ],
        },
        featureRules: expect.arrayContaining([
          expect.objectContaining(
            deviceCandidate
              ? {
                  featureKey: "device-feature",
                  enabled: true,
                  browserFamily: "chrome",
                  minimumExtensionVersion: "3.0.0",
                }
              : {
                  featureKey: "device-feature",
                  enabled: false,
                  browserFamily: null,
                  minimumExtensionVersion: null,
                },
          ),
          expect.objectContaining(
            accountCandidate
              ? {
                  featureKey: "local-feature",
                  enabled: true,
                  browserFamily: "firefox",
                  minimumExtensionVersion: "2.0.0",
                }
              : {
                  featureKey: "local-feature",
                  enabled: false,
                  browserFamily: null,
                  minimumExtensionVersion: null,
                },
          ),
        ]),
        ai: { status: "UNCONFIGURED" },
      },
    });
    expect(
      await materializer.materialize({
        contractVersion: "control_plane_v2",
        accountId: principal.accountId,
        deviceId: principal.deviceId,
        extensionVersion: "99.0.0",
        browser: { family: "chrome", version: "999" },
      } as never),
    ).toEqual({ failure: "INVALID_INPUT" });
  });

  it("fails closed rather than truncating more than 32 linked policies", async () => {
    const p = createP3PolicyPublicationRepository(db);
    const release = await p.publishConfigRelease(
      {
        contractVersion: "control_plane_v2",
        snapshotVersion: "bootstrap_snapshot_v2",
        envelopeVersion: "bootstrap_envelope_v2",
        signingKeyId: material.keyId,
        compatibilityPolicyRevisionIds: [],
        featureRuleRevisionIds: [],
        featureRolloutRevisionIds: [],
        publishedAt: new Date("2026-09-21T00:00:00.000Z"),
      },
      context,
    );
    await db.query(
      `WITH inserted AS (
         INSERT INTO compatibility_policy_revisions(
           policy_key,revision,contract_version,browser_family,
           minimum_extension_version,recommended_extension_version,
           minimum_browser_version,maintenance_mode,maintenance_code,published_at
         )
         SELECT 'limit-policy-' || g,1,'control_plane_v2',NULL,NULL,NULL,NULL,false,NULL,
                TIMESTAMPTZ '2026-09-21T00:00:00.000Z'
           FROM generate_series(0,32) g
         RETURNING id
       )
       INSERT INTO config_release_compatibility_policies(config_version,policy_revision_id)
       SELECT $1,id FROM inserted`,
      [release.configVersion],
    );
    const result = await new LocalClientAuthorityMaterializer(
      createP3BootstrapPolicyCatalogRepository(db),
      new BootstrapAiResolutionService(
        createBootstrapAiResolutionRepository(db),
      ),
    ).materialize({
      contractVersion: "control_plane_v2",
      accountId: principal.accountId,
      deviceId: principal.deviceId,
    });
    expect(result).toEqual({ failure: "LOCAL_AUTHORITY_SOURCE_INVALID" });
  });

  it("fails closed when a linked config contains more than 128 feature keys", async () => {
    const p = createP3PolicyPublicationRepository(db);
    const rules: string[] = [];
    for (let i = 0; i < 129; i++) {
      const featureKey = `bound-feature-${i}`;
      await p.createFeatureDefinition({ featureKey }, context);
      const rule = await p.publishFeatureRuleRevision(
        {
          featureKey,
          contractVersion: "control_plane_v2",
          enabled: true,
          browserFamily: null,
          minimumExtensionVersion: null,
          publishedAt: new Date("2026-09-05T00:00:00.000Z"),
        },
        context,
      );
      rules.push(rule.id);
    }
    await p.publishConfigRelease(
      {
        contractVersion: "control_plane_v2",
        snapshotVersion: "bootstrap_snapshot_v2",
        envelopeVersion: "bootstrap_envelope_v2",
        signingKeyId: material.keyId,
        compatibilityPolicyRevisionIds: [],
        featureRuleRevisionIds: rules,
        featureRolloutRevisionIds: [],
        publishedAt: new Date("2026-09-06T00:00:00.000Z"),
      },
      context,
    );
    const result = await new LocalClientAuthorityMaterializer(
      createP3BootstrapPolicyCatalogRepository(db),
      new BootstrapAiResolutionService(
        createBootstrapAiResolutionRepository(db),
      ),
    ).materialize({
      contractVersion: "control_plane_v2",
      accountId: principal.accountId,
      deviceId: principal.deviceId,
    });
    expect(result).toEqual({ failure: "LOCAL_AUTHORITY_SOURCE_INVALID" });
  });

  it("uses a deterministic newest 64 release window and fails closed above 128 blocked versions", async () => {
    await localAuthorityGraph();
    const p = createP3PolicyPublicationRepository(db);
    for (let i = 0; i < 65; i++) {
      await p.publishExtensionRelease(
        {
          version: `3.${i}.0`,
          releaseChannel: "stable",
          releasedAt: new Date(Date.UTC(2026, 8, 6, 0, 0, i)),
          supportedContracts: ["control_plane_v2"],
          supportedBrowsers: ["chrome"],
        },
        context,
      );
    }
    const materializer = new LocalClientAuthorityMaterializer(
      createP3BootstrapPolicyCatalogRepository(db),
      new BootstrapAiResolutionService(
        createBootstrapAiResolutionRepository(db),
      ),
    );
    const result = await materializer.materialize({
      contractVersion: "control_plane_v2",
      accountId: principal.accountId,
      deviceId: principal.deviceId,
    });
    expect("failure" in result).toBe(false);
    if (!("failure" in result)) {
      const releases = result.localClientAuthority.compatibility.releases;
      expect(releases).toHaveLength(64);
      expect(releases[0]?.extensionVersion).toBe("3.64.0");
      expect(releases.at(-1)?.extensionVersion).toBe("3.1.0");
    }
    const policy = await db.query<{ id: string }>(
      "SELECT id FROM compatibility_policy_revisions WHERE policy_key='local-v2-policy'",
    );
    for (let i = 0; i < 129; i++) {
      await db.query(
        "INSERT INTO compatibility_policy_blocked_versions(policy_revision_id,extension_version) VALUES($1,$2)",
        [policy.rows[0]!.id, `4.${i}.0`],
      );
    }
    expect(
      await materializer.materialize({
        contractVersion: "control_plane_v2",
        accountId: principal.accountId,
        deviceId: principal.deviceId,
      }),
    ).toEqual({ failure: "LOCAL_AUTHORITY_SOURCE_INVALID" });
  });

  it("fails closed on a malformed linked compatibility policy source", async () => {
    const p = createP3PolicyPublicationRepository(db);
    const release = await p.publishConfigRelease(
      {
        contractVersion: "control_plane_v2",
        snapshotVersion: "bootstrap_snapshot_v2",
        envelopeVersion: "bootstrap_envelope_v2",
        signingKeyId: material.keyId,
        compatibilityPolicyRevisionIds: [],
        featureRuleRevisionIds: [],
        featureRolloutRevisionIds: [],
        publishedAt: new Date("2026-09-22T00:00:00.000Z"),
      },
      context,
    );
    await db.query(
      `WITH inserted AS (
         INSERT INTO compatibility_policy_revisions(
           policy_key,revision,contract_version,browser_family,
           minimum_extension_version,recommended_extension_version,
           minimum_browser_version,maintenance_mode,maintenance_code,published_at
         )
         VALUES('corrupt-local-policy',1,'control_plane_v2',NULL,NULL,NULL,NULL,false,
                'corrupt-code',TIMESTAMPTZ '2026-09-22T00:00:00.000Z')
         RETURNING id
       )
       INSERT INTO config_release_compatibility_policies(config_version,policy_revision_id)
       SELECT $1,id FROM inserted`,
      [release.configVersion],
    );
    expect(
      await new LocalClientAuthorityMaterializer(
        createP3BootstrapPolicyCatalogRepository(db),
        new BootstrapAiResolutionService(
          createBootstrapAiResolutionRepository(db),
        ),
      ).materialize({
        contractVersion: "control_plane_v2",
        accountId: principal.accountId,
        deviceId: principal.deviceId,
      }),
    ).toEqual({ failure: "LOCAL_AUTHORITY_SOURCE_INVALID" });
  });
});
