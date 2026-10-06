import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { createP3PolicyPublicationRepository } from "../../../packages/server/db/src/index.js";
import {
  addKey,
  clean,
  connectionString,
  context,
  count,
  dbFor,
  now,
  policy,
  publicationFor,
  rule,
} from "./p3-3-support.js";

let db: Awaited<ReturnType<typeof dbFor>>;
describe.sequential(
  "P3.3 real PostgreSQL publication and revision concurrency",
  () => {
    beforeAll(async () => {
      db = await dbFor();
      await runMigrations({ connectionString: connectionString! });
    });
    beforeEach(() => clean(db));
    afterAll(() => db.close());
    it("publishes every P3.3 source through production write paths and audits each mutation", async () => {
      const p = publicationFor(db);
      await p.publishExtensionRelease(
        {
          version: "1.2.3",
          releaseChannel: "stable",
          releasedAt: now(),
          supportedContracts: ["control_plane_v1"],
          supportedBrowsers: ["chrome"],
        },
        context,
      );
      const po = await policy(db);
      await p.createFeatureDefinition({ featureKey: "feature-one" }, context);
      const a = await rule(db, "feature-one", false),
        b = await rule(db, "feature-one", true);
      await p.createRollout(
        {
          rolloutKey: "feature-one.rollout",
          targetKind: "FEATURE_RULE",
          subjectKind: "ACCOUNT",
        },
        context,
        Buffer.alloc(32, 1),
      );
      const ro = await p.publishRolloutRevision(
        {
          rolloutKey: "feature-one.rollout",
          state: "ACTIVE",
          percentageBps: 10000,
          baselineFeatureRuleRevisionId: a.id,
          candidateFeatureRuleRevisionId: b.id,
          publishedAt: now(),
        },
        context,
      );
      const key = await addKey(db);
      const config = await p.publishConfigRelease(
        {
          contractVersion: "control_plane_v1",
          snapshotVersion: "bootstrap_snapshot_v1",
          envelopeVersion: "bootstrap_envelope_v1",
          signingKeyId: key,
          compatibilityPolicyRevisionIds: [po.id],
          featureRuleRevisionIds: [a.id],
          featureRolloutRevisionIds: [ro.id],
          publishedAt: now(),
        },
        context,
      );
      expect(config.configVersion).toBe(1);
      expect(await count(db, "config_release_compatibility_policies")).toBe(1);
      expect(await count(db, "config_release_feature_rules")).toBe(1);
      expect(await count(db, "config_release_rollout_revisions")).toBe(1);
      expect(await count(db, "audit_events")).toBe(8);
    });
    it("persists legacy, exact, SYSTEM-unbound, and old-writer release integrity modes", async () => {
      const migration = readFileSync(
        "packages/server/db/drizzle/0058_extension_release_browser_artifacts.sql",
        "utf8",
      );
      expect(migration).not.toMatch(/\bUPDATE\b|DROP\s+TRIGGER/i);
      const p = publicationFor(db);
      const legacyDigest = "a".repeat(64);
      await p.publishExtensionRelease(
        {
          version: "2.0.0",
          releaseChannel: "stable",
          artifactSha256: legacyDigest,
          releasedAt: now(),
          supportedContracts: ["control_plane_v2"],
          supportedBrowsers: ["chrome", "firefox"],
        },
        context,
      );
      await p.publishExtensionRelease(
        {
          version: "2.0.1",
          releaseChannel: "stable",
          releasedAt: now(),
          supportedContracts: ["control_plane_v2"],
          supportedBrowsers: ["chrome"],
        },
        context,
      );

      const adminContext = {
        actorType: "ADMIN" as const,
        actorId: randomUUID(),
        correlationId: "p3-3-admin-integrity",
        reason: "release artifact integrity integration test",
      };
      const admin = createP3PolicyPublicationRepository(db, {
        beforeExtensionReleasePublication: async () => undefined,
      });
      await expect(
        admin.publishExtensionRelease(
          {
            version: "2.0.2",
            releaseChannel: "stable",
            releasedAt: now(),
            supportedContracts: ["control_plane_v2"],
            supportedBrowsers: ["chrome"],
          },
          adminContext,
        ),
      ).rejects.toThrow("ADMIN_EXTENSION_RELEASE_INTEGRITY_MODE_REQUIRED");
      await admin.publishExtensionRelease(
        {
          version: "2.0.3",
          releaseChannel: "stable",
          browserArtifacts: [
            { browserFamily: "chrome", artifactSha256: "b".repeat(64) },
            { browserFamily: "firefox", artifactSha256: "c".repeat(64) },
          ],
          releasedAt: now(),
          supportedContracts: ["control_plane_v2"],
          supportedBrowsers: ["chrome", "firefox"],
        },
        adminContext,
      );

      const rows = await db.query<{
        version: string;
        artifact_sha256: string | null;
        browser_family: string;
        browser_artifact_sha256: string | null;
      }>(
        "SELECT r.version,r.artifact_sha256,b.browser_family,b.artifact_sha256 AS browser_artifact_sha256 FROM extension_releases r JOIN extension_release_browsers b ON b.release_id=r.id ORDER BY r.version,b.browser_family",
      );
      expect(rows.rows.filter((row) => row.version === "2.0.0")).toEqual([
        expect.objectContaining({
          artifact_sha256: legacyDigest,
          browser_artifact_sha256: null,
        }),
        expect.objectContaining({
          artifact_sha256: legacyDigest,
          browser_artifact_sha256: null,
        }),
      ]);
      expect(rows.rows.find((row) => row.version === "2.0.1")).toMatchObject({
        artifact_sha256: null,
        browser_artifact_sha256: null,
      });
      expect(rows.rows.filter((row) => row.version === "2.0.3")).toEqual([
        expect.objectContaining({
          artifact_sha256: null,
          browser_family: "chrome",
          browser_artifact_sha256: "b".repeat(64),
        }),
        expect.objectContaining({
          artifact_sha256: null,
          browser_family: "firefox",
          browser_artifact_sha256: "c".repeat(64),
        }),
      ]);

      const oldWriter = await db.query<{ id: string }>(
        "INSERT INTO extension_releases(version,release_channel,artifact_sha256,released_at) VALUES('2.0.4','stable',$1,$2) RETURNING id",
        [legacyDigest, now()],
      );
      await db.query(
        "INSERT INTO extension_release_browsers(release_id,browser_family) VALUES($1,'chrome')",
        [oldWriter.rows[0]!.id],
      );
      const oldWriterRows = await db.query<{ artifact_sha256: string | null }>(
        "SELECT artifact_sha256 FROM extension_release_browsers WHERE release_id=$1",
        [oldWriter.rows[0]!.id],
      );
      expect(oldWriterRows.rows[0]?.artifact_sha256).toBeNull();
      await expect(
        db.query(
          "UPDATE extension_release_browsers SET artifact_sha256=$2 WHERE release_id=$1",
          [oldWriter.rows[0]!.id, "d".repeat(64)],
        ),
      ).rejects.toThrow();
    });
    it("serializes concurrent policy revisions with distinct server revisions and audits", async () => {
      const [a, b] = await Promise.all([
        policy(db, "policy-same"),
        policy(db, "policy-same"),
      ]);
      expect([a.revision, b.revision].sort()).toEqual([1, 2]);
      expect(await count(db, "audit_events")).toBe(2);
    });
    it("serializes concurrent feature revisions with distinct ordered revisions and audits", async () => {
      const p = publicationFor(db);
      await p.createFeatureDefinition({ featureKey: "feature-same" }, context);
      const [a, b] = await Promise.all([
        p.publishFeatureRuleRevision(
          {
            featureKey: "feature-same",
            contractVersion: "control_plane_v1",
            enabled: false,
            browserFamily: null,
            minimumExtensionVersion: null,
            publishedAt: now(),
          },
          context,
        ),
        p.publishFeatureRuleRevision(
          {
            featureKey: "feature-same",
            contractVersion: "control_plane_v1",
            enabled: true,
            browserFamily: null,
            minimumExtensionVersion: null,
            publishedAt: now(),
          },
          context,
        ),
      ]);
      expect([a.revision, b.revision].sort()).toEqual([1, 2]);
      expect(await count(db, "audit_events")).toBe(3);
    });
    it("serializes concurrent rollout revisions with distinct ordered revisions and audits", async () => {
      const a = await rule(db),
        b = await rule(db, "feature-one", true);
      const p = publicationFor(db);
      await p.createRollout(
        {
          rolloutKey: "feature-same.rollout",
          targetKind: "FEATURE_RULE",
          subjectKind: "ACCOUNT",
        },
        context,
        Buffer.alloc(32, 2),
      );
      const cmd = {
        rolloutKey: "feature-same.rollout",
        state: "ACTIVE" as const,
        percentageBps: 0,
        baselineFeatureRuleRevisionId: a.id,
        candidateFeatureRuleRevisionId: b.id,
        publishedAt: now(),
      };
      const [x, y] = await Promise.all([
        p.publishRolloutRevision(cmd, context),
        p.publishRolloutRevision(cmd, context),
      ]);
      expect([x.revision, y.revision].sort()).toEqual([1, 2]);
      expect(await count(db, "audit_events")).toBe(6);
    });
  },
);
