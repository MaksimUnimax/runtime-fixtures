import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createP3PolicyPublicationRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import {
  addKey,
  clean,
  connectionString,
  context,
  dbFor,
  now,
  publicationFor,
} from "./p3-3-support.js";

let db: DatabaseRuntime;

const adminContext = () => ({
  actorType: "ADMIN" as const,
  actorId: randomUUID(),
  correlationId: randomUUID(),
  reason: "replace compatibility policy scope",
});
async function policy(
  key: string,
  browserFamily: "chrome" | "opera" | "firefox",
  contractVersion: "control_plane_v1" | "control_plane_v2" = "control_plane_v2",
  version = "0.2.6",
) {
  return publicationFor(db).publishCompatibilityPolicyRevision(
    {
      policyKey: key,
      contractVersion,
      browserFamily,
      minimumExtensionVersion: version,
      recommendedExtensionVersion: version,
      minimumBrowserVersion: "136",
      maintenanceMode: false,
      maintenanceCode: null,
      blockedVersions: [],
      publishedAt: now(),
    },
    context,
  );
}

async function seedV2Base(policyIds: string[]) {
  const p = publicationFor(db);
  const signingKeyId = await addKey(db, "scope-replace-key");
  await p.createFeatureDefinition({ featureKey: "scope-feature" }, context);
  const baseline = await p.publishFeatureRuleRevision(
    {
      featureKey: "scope-feature",
      contractVersion: "control_plane_v2",
      enabled: false,
      browserFamily: null,
      minimumExtensionVersion: "0.2.6",
      publishedAt: now(),
    },
    context,
  );
  const candidate = await p.publishFeatureRuleRevision(
    {
      featureKey: "scope-feature",
      contractVersion: "control_plane_v2",
      enabled: true,
      browserFamily: null,
      minimumExtensionVersion: "0.2.7",
      publishedAt: now(),
    },
    context,
  );
  await p.createRollout(
    {
      rolloutKey: "scope-feature.rollout",
      targetKind: "FEATURE_RULE",
      subjectKind: "ACCOUNT",
    },
    context,
    Buffer.alloc(32, 9),
  );
  const rollout = await p.publishRolloutRevision(
    {
      rolloutKey: "scope-feature.rollout",
      state: "ACTIVE",
      percentageBps: 5000,
      baselineFeatureRuleRevisionId: baseline.id,
      candidateFeatureRuleRevisionId: candidate.id,
      publishedAt: now(),
    },
    context,
  );
  const config = await p.publishConfigRelease(
    {
      contractVersion: "control_plane_v2",
      snapshotVersion: "bootstrap_snapshot_v2",
      envelopeVersion: "bootstrap_envelope_v2",
      signingKeyId,
      compatibilityPolicyRevisionIds: policyIds,
      featureRuleRevisionIds: [baseline.id],
      featureRolloutRevisionIds: [rollout.id],
      publishedAt: now(),
    },
    context,
  );
  return { config, signingKeyId, baseline, rollout };
}

async function links(
  table:
    | "config_release_compatibility_policies"
    | "config_release_feature_rules"
    | "config_release_rollout_revisions",
  column: string,
  configVersion: number,
) {
  const result = await db.query<{ id: string }>(
    `SELECT ${column} AS id FROM ${table} WHERE config_version=$1 ORDER BY ${column}`,
    [configVersion],
  );
  return result.rows.map((row) => row.id);
}

describe.sequential("P3 admin config policy scope replacement", () => {
  beforeAll(async () => {
    db = await dbFor();
    await runMigrations({ connectionString: connectionString! });
  });
  beforeEach(() => clean(db));
  afterAll(() => db.close());

  it("replaces one compatibility scope and preserves unrelated config identity links", async () => {
    const operaV1 = await policy(
      "store1.opera.v2",
      "opera",
      "control_plane_v2",
      "0.2.6",
    );
    const chrome = await policy("store1.chrome.v2", "chrome");
    const base = await seedV2Base([operaV1.id, chrome.id]);
    const operaV2 = await policy(
      "store1.opera.v2",
      "opera",
      "control_plane_v2",
      "0.2.7",
    );
    expect(operaV1.revision).toBe(1);
    expect(operaV2.revision).toBe(2);

    let authorizationCalls = 0;
    const repo = createP3PolicyPublicationRepository(db, {
      beforeConfigReleasePublication: async () => {
        authorizationCalls += 1;
      },
    });
    const admin = adminContext();
    const published = await repo.publishAdminConfigRelease(
      {
        contractVersion: "control_plane_v2",
        expectedLatestConfigVersion: base.config.configVersion,
        compatibilityPolicyRevisionIds: [operaV2.id],
      },
      admin,
    );

    expect(authorizationCalls).toBe(1);
    expect(published).toMatchObject({
      contractVersion: base.config.contractVersion,
      snapshotVersion: base.config.snapshotVersion,
      envelopeVersion: base.config.envelopeVersion,
      signingKeyId: base.signingKeyId,
    });
    expect(
      await links(
        "config_release_compatibility_policies",
        "policy_revision_id",
        published.configVersion,
      ),
    ).toEqual([chrome.id, operaV2.id].sort());
    expect(
      await links(
        "config_release_feature_rules",
        "feature_rule_revision_id",
        published.configVersion,
      ),
    ).toEqual([base.baseline.id]);
    expect(
      await links(
        "config_release_rollout_revisions",
        "rollout_revision_id",
        published.configVersion,
      ),
    ).toEqual([base.rollout.id]);

    const audit = await db.query<{
      actorType: string;
      actorId: string;
      correlationId: string;
    }>(
      'SELECT actor_type AS "actorType",actor_id AS "actorId",correlation_id AS "correlationId" FROM audit_events WHERE action=\'CONFIG_RELEASE_PUBLISHED\' AND correlation_id=$1',
      [admin.correlationId],
    );
    expect(audit.rows).toEqual([
      {
        actorType: "ADMIN",
        actorId: admin.actorId,
        correlationId: admin.correlationId,
      },
    ]);

    await expect(
      repo.publishAdminConfigRelease(
        {
          contractVersion: "control_plane_v2",
          expectedLatestConfigVersion: published.configVersion,
          compatibilityPolicyRevisionIds: [operaV2.id],
        },
        adminContext(),
      ),
    ).rejects.toThrow("P3_CONFIG_LINK_NO_CHANGE");
    await expect(
      repo.publishAdminConfigRelease(
        {
          contractVersion: "control_plane_v2",
          expectedLatestConfigVersion: base.config.configVersion,
          compatibilityPolicyRevisionIds: [operaV2.id],
        },
        adminContext(),
      ),
    ).rejects.toThrow("P3_CONFIG_BASE_STALE");

    expect(
      Number(
        (
          await db.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM config_releases",
          )
        ).rows[0]!.count,
      ),
    ).toBe(2);
  });

  it("rejects duplicate incoming scopes and mismatched contracts transactionally", async () => {
    const chrome = await policy("base.chrome.v2", "chrome");
    const base = await seedV2Base([chrome.id]);
    const operaA = await policy("incoming.opera.a", "opera");
    const operaB = await policy("incoming.opera.b", "opera");
    const wrongContract = await policy(
      "incoming.firefox.v1",
      "firefox",
      "control_plane_v1",
      "0.2.7",
    );
    let authorizationCalls = 0;
    const repo = createP3PolicyPublicationRepository(db, {
      beforeConfigReleasePublication: async () => {
        authorizationCalls += 1;
      },
    });
    for (const policyIds of [[operaA.id, operaB.id], [wrongContract.id]]) {
      await expect(
        repo.publishAdminConfigRelease(
          {
            contractVersion: "control_plane_v2",
            expectedLatestConfigVersion: base.config.configVersion,
            compatibilityPolicyRevisionIds: policyIds,
          },
          adminContext(),
        ),
      ).rejects.toThrow("P3_POLICY_SOURCE_INVALID");
    }

    expect(authorizationCalls).toBe(2);
    expect(
      Number(
        (
          await db.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM config_releases",
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
    expect(
      Number(
        (
          await db.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM audit_events WHERE action='CONFIG_RELEASE_PUBLISHED' AND actor_type='ADMIN'",
          )
        ).rows[0]!.count,
      ),
    ).toBe(0);
  });
});
