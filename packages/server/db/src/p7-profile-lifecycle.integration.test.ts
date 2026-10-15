import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createProfileLifecycleRepository,
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "./index.js";
import { runMigrations } from "./migrations.js";
import { profileRevisionFingerprint } from "@product/adapter-registry";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for integration tests");
const A = "10000000-0000-4000-8000-000000000001";
const S = "10000000-0000-4000-8000-000000000002";
const P = "10000000-0000-4000-8000-000000000003";
const V = "10000000-0000-4000-8000-000000000004";
const context = {
  actorType: "SYSTEM" as const,
  correlationId: "p7.2-test",
  reason: "p7.2 integration",
};
const content = {
  schemaVersion: "adapter_profile_v1" as const,
  page: {
    identityStrategy: "page_identity" as const,
    conversationStrategy: "conversation_root" as const,
    composerStrategy: "composer_root" as const,
  },
  selectors: Object.fromEntries(
    ["conversation", "composer", "send", "assistantResponse"].map((key) => [
      key,
      {
        strategy:
          key === "assistantResponse"
            ? "assistant_response"
            : key === "send"
              ? "send_control"
              : key === "composer"
                ? "composer_root"
                : "conversation_root",
        primary: {
          kind: "packaged_selector_reference",
          reference:
            key === "assistantResponse"
              ? "assistant-response"
              : key === "send"
                ? "send-control"
                : key === "composer"
                  ? "composer-root"
                  : "conversation-root",
        },
        fallbacks: [],
        timeoutMs: 1000,
        observationMode: "polling",
      },
    ]),
  ) as never,
  observation: { mode: "polling" as const, intervalMs: 100 },
  contours: [
    "page_identity",
    "conversation_root",
    "composer_root",
    "send_control",
  ].map((key) => ({
    key,
    required: true,
    expectedState:
      key === "page_identity" || key === "conversation_root"
        ? "PRESENT"
        : "INTERACTIVE",
    strategy: key,
  })) as never,
};
const compatibility = {
  schemaVersion: "profile_compatibility_v1" as const,
  contractVersion: "control_plane_v1" as const,
  browserFamilies: ["chrome" as const],
  minimumBrowserVersions: [],
  minimumExtensionVersion: null,
};

let runtime: DatabaseRuntime;
let publishedRevisionId: string;
let candidateRevisionId: string;
describe.sequential(
  "P7.2 profile lifecycle and assignment PostgreSQL boundary",
  () => {
    beforeAll(async () => {
      runtime = createDatabaseRuntime(connectionString!);
      await runtime.ready();
      await runtime.db.execute(
        sql`DROP SCHEMA IF EXISTS octoport_transfer_fence CASCADE; DROP SCHEMA public CASCADE`,
      );
      await runtime.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
      await runtime.db.execute(sql`CREATE SCHEMA public`);
      await runMigrations({ connectionString: connectionString! });
      await runMigrations({ connectionString: connectionString! });
      await runtime.db.execute(
        sql`INSERT INTO ai_adapters(id,machine_key,display_name) VALUES (${A},'p72-adapter','P72')`,
      );
      await runtime.db.execute(
        sql`INSERT INTO ai_surfaces(id,adapter_id,machine_key,display_name) VALUES (${S},${A},'surface','Surface')`,
      );
      await runtime.db.execute(
        sql`INSERT INTO ai_variants(id,surface_id,machine_key,display_name) VALUES (${V},${S},'variant','Variant')`,
      );
      await runtime.db.execute(
        sql`INSERT INTO adapter_profiles(id,adapter_id,surface_id,machine_key,display_name) VALUES (${P},${A},${S},'profile','Profile')`,
      );
    });
    afterAll(async () => runtime.close());

    it("creates, updates, freezes, publishes, and protects a candidate", async () => {
      const repo = createProfileLifecycleRepository(runtime);
      const draft = await repo.createDraftProfileRevision({
        profileId: P,
        content,
        compatibility,
        context,
      });
      expect(draft.state).toBe("DRAFT");
      expect(draft.contentSha256).toBe(
        profileRevisionFingerprint({ content, compatibility }),
      );
      await expect(
        repo.updateDraftProfileRevision({
          profileId: P,
          revision: 1,
          content: {
            ...content,
            observation: { mode: "polling", intervalMs: 200 },
          },
          compatibility,
          expectedContentSha256: "0".repeat(64),
          context,
        }),
      ).rejects.toThrow("P7_STALE_DRAFT_UPDATE");
      const updated = await repo.updateDraftProfileRevision({
        profileId: P,
        revision: 1,
        content,
        compatibility,
        expectedContentSha256: draft.contentSha256,
        context,
      });
      await repo.markProfileRevisionCandidate({
        profileId: P,
        revision: 1,
        context,
      });
      await expect(
        runtime.db.execute(
          sql`UPDATE adapter_profile_revisions SET content='{}'::jsonb WHERE id=${updated.id}`,
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        runtime.db.execute(
          sql`UPDATE adapter_profile_revisions SET compatibility_constraints='{}'::jsonb WHERE id=${updated.id}`,
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        runtime.db.execute(
          sql`UPDATE adapter_profile_revisions SET content_sha256=${"b".repeat(64)} WHERE id=${updated.id}`,
        ),
      ).rejects.toBeInstanceOf(Error);
      const published = await repo.publishProfileRevision({
        profileId: P,
        revision: 1,
        context,
      });
      publishedRevisionId = published.id;
      expect(published.state).toBe("PUBLISHED");
      expect(published.contentSha256).toBe(updated.contentSha256);
      await expect(
        repo.publishProfileRevision({ profileId: P, revision: 1, context }),
      ).rejects.toThrow();
      await expect(
        runtime.db.execute(
          sql`UPDATE adapter_profile_revisions SET content='{}'::jsonb WHERE id=${published.id}`,
        ),
      ).rejects.toBeInstanceOf(Error);
      const concurrent = await Promise.all([
        repo.createDraftProfileRevision({
          profileId: P,
          content,
          compatibility,
          context,
        }),
        repo.createDraftProfileRevision({
          profileId: P,
          content,
          compatibility,
          context,
        }),
      ]);
      expect(new Set(concurrent.map((revision) => revision.revision))).toEqual(
        new Set([2, 3]),
      );
      const candidate = await repo.markProfileRevisionCandidate({
        profileId: P,
        revision: 2,
        context,
      });
      candidateRevisionId = (
        await repo.publishProfileRevision({
          profileId: P,
          revision: 2,
          context,
        })
      ).id;
      expect(candidate.state).toBe("CANDIDATE");
    });

    it("keeps assignment history append-only and mutations optimistic", async () => {
      const repo = createProfileLifecycleRepository(runtime);
      const scope = await repo.createAssignmentScope({
        scope: {
          adapterId: A,
          surfaceId: S,
          variantId: null,
          browserFamily: "chrome",
          subjectKind: "ACCOUNT",
        },
        context,
      });
      await expect(
        repo.createAssignmentScope({
          scope: {
            adapterId: A,
            surfaceId: S,
            variantId: null,
            browserFamily: "chrome",
            subjectKind: "ACCOUNT",
          },
          context,
        }),
      ).rejects.toBeInstanceOf(Error);
      const direct = await repo.assignDirect({
        assignmentId: scope.id,
        baselineProfileRevisionId: publishedRevisionId,
        expectedLatestAssignmentRevision: null,
        context,
      });
      expect((direct as { revision: number }).revision).toBe(1);
      const rollout = await repo.startRollout({
        assignmentId: scope.id,
        baselineProfileRevisionId: publishedRevisionId,
        candidateProfileRevisionId: candidateRevisionId,
        percentageBps: 5000,
        expectedLatestAssignmentRevision: 1,
        context,
      });
      expect((rollout as { mode: string }).mode).toBe("ROLLOUT");
      await expect(
        Promise.all([
          repo.changeRolloutPercentage({
            assignmentId: scope.id,
            percentageBps: 2500,
            expectedLatestAssignmentRevision: 2,
            context,
          }),
          repo.changeRolloutPercentage({
            assignmentId: scope.id,
            percentageBps: 7500,
            expectedLatestAssignmentRevision: 2,
            context,
          }),
        ]),
      ).rejects.toThrow("P7_ASSIGNMENT_STALE_REVISION");
      const paused = await repo.pauseProfileRollout({
        assignmentId: scope.id,
        expectedLatestAssignmentRevision: 3,
        context,
      });
      expect((paused as { mode: string }).mode).toBe("PAUSED");
      const resumed = await repo.resumeProfileRollout({
        assignmentId: scope.id,
        expectedLatestAssignmentRevision: 4,
        context,
      });
      expect((resumed as { mode: string }).mode).toBe("ROLLOUT");
      const completed = await repo.completeRollout({
        assignmentId: scope.id,
        expectedLatestAssignmentRevision: 5,
        context,
      });
      expect((completed as { mode: string }).mode).toBe("DIRECT");
      const rolledBack = await repo.rollbackProfileAssignment({
        assignmentId: scope.id,
        profileRevisionId: publishedRevisionId,
        expectedLatestAssignmentRevision: 6,
        context,
      });
      expect((rolledBack as { mode: string }).mode).toBe("DIRECT");
      expect(
        await runtime.db.execute(
          sql`SELECT count(*)::text AS count FROM adapter_profile_assignment_revisions WHERE assignment_id=${scope.id}`,
        ),
      ).toMatchObject({ rows: [{ count: "7" }] });
      await expect(
        repo.changeRolloutPercentage({
          assignmentId: scope.id,
          percentageBps: 50,
          expectedLatestAssignmentRevision: 1,
          context,
        }),
      ).rejects.toThrow();
      await expect(
        runtime.db.execute(
          sql`UPDATE adapter_profile_assignment_revisions SET percentage_bps=1 WHERE assignment_id=${scope.id}`,
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        runtime.db.execute(
          sql`DELETE FROM adapter_profile_assignment_revisions WHERE assignment_id=${scope.id}`,
        ),
      ).rejects.toBeInstanceOf(Error);
      await expect(
        repo.assignDirect({
          assignmentId: scope.id,
          baselineProfileRevisionId: publishedRevisionId,
          expectedLatestAssignmentRevision: 99,
          context,
        }),
      ).rejects.toThrow("P7_ASSIGNMENT_STALE_REVISION");
      const audits = await runtime.db.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM audit_events WHERE target_id=${scope.id}`,
      );
      expect(Number(audits.rows[0]?.count)).toBeGreaterThanOrEqual(2);
    });
  },
);
