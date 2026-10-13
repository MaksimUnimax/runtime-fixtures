import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeAdminMutationInTransaction,
  createAdminAuthRepository,
  createDatabaseRuntime,
  createP7AdminAiCommandRepository,
  createP7AdminAiReadRepository,
  createProfileLifecycleRepository,
  createBootstrapAiResolutionRepository,
  type DatabaseRuntime,
} from "./index.js";
import { runMigrations } from "./migrations.js";
import {
  AdminAuthService,
  type AdminAuthRepository,
  deriveAdminAuthKeys,
} from "@product/admin-auth";
import { AdminAiService } from "@product/admin-ai";
import { validateProfileContent } from "@product/adapter-registry";
import { BootstrapAiResolutionService } from "../../bootstrap/src/ai-resolution.js";
import { createApiApp } from "../../../../apps/api/src/app.js";
import type { AppConfig } from "@product/shared";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for P7.4 integration tests");
const USER = "20000000-0000-4000-8000-000000000001";
const ACTOR = "20000000-0000-4000-8000-000000000002";
const context = (reason: string) => ({
  actorType: "ADMIN" as const,
  actorId: ACTOR,
  correlationId: `p74-${reason}`,
  reason,
});
const selector = (
  strategy:
    | "conversation_root"
    | "composer_root"
    | "send_control"
    | "assistant_response",
  reference:
    | "conversation-root"
    | "composer-root"
    | "send-control"
    | "assistant-response",
) => ({
  strategy,
  primary: { kind: "packaged_selector_reference" as const, reference },
  fallbacks: [],
  timeoutMs: 1000,
  observationMode: "polling" as const,
});
const content = {
  schemaVersion: "adapter_profile_v1" as const,
  page: {
    identityStrategy: "page_identity" as const,
    conversationStrategy: "conversation_root" as const,
    composerStrategy: "composer_root" as const,
  },
  selectors: {
    conversation: selector("conversation_root", "conversation-root"),
    composer: selector("composer_root", "composer-root"),
    send: selector("send_control", "send-control"),
    assistantResponse: selector("assistant_response", "assistant-response"),
  },
  observation: { mode: "polling" as const, intervalMs: 100 },
  contours: [
    {
      key: "page_identity" as const,
      required: true,
      expectedState: "PRESENT" as const,
      strategy: "page_identity" as const,
    },
    {
      key: "conversation_root" as const,
      required: true,
      expectedState: "PRESENT" as const,
      strategy: "conversation_root" as const,
    },
    {
      key: "composer_root" as const,
      required: true,
      expectedState: "INTERACTIVE" as const,
      strategy: "composer_root" as const,
    },
    {
      key: "send_control" as const,
      required: true,
      expectedState: "INTERACTIVE" as const,
      strategy: "send_control" as const,
    },
  ],
};
const compatibility = {
  schemaVersion: "profile_compatibility_v1" as const,
  contractVersion: "control_plane_v1" as const,
  browserFamilies: ["chrome" as const],
  minimumBrowserVersions: [],
  minimumExtensionVersion: null,
};

let runtime: DatabaseRuntime;
let adapterId: string;
let surfaceId: string;
let variantId: string;
let profileId: string;
let secondProfileId: string;
let assignmentId: string;
let firstRevision: { id: string; contentSha256: string };

describe.sequential("P7.4 admin AI real PostgreSQL authority", () => {
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
    await runtime.query("INSERT INTO users(id,status) VALUES($1,'ACTIVE')", [
      USER,
    ]);
    await runtime.query(
      "INSERT INTO admin_principals(id,user_id,status) VALUES($1,$2,'ACTIVE')",
      [ACTOR, USER],
    );
    await runtime.query(
      "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,'ADMIN_OPS')",
      [ACTOR],
    );
  });
  afterAll(async () => runtime.close());

  it("creates the registry hierarchy and rejects cross-hierarchy profile binding", async () => {
    const commands = createP7AdminAiCommandRepository(runtime);
    const adapter = await commands.createAdapter({
      machineKey: "chatgpt",
      displayName: "ChatGPT",
      description: "preserve-me",
      actorId: ACTOR,
      correlationId: "create-adapter",
      reason: "onboard",
    });
    const surface = await commands.createSurface({
      adapterId: adapter.id,
      machineKey: "standard",
      displayName: "Standard",
      actorId: ACTOR,
      correlationId: "create-surface",
      reason: "onboard",
    });
    adapterId = adapter.id;
    surfaceId = surface.id;
    const variant = await commands.createVariant({
      surfaceId,
      machineKey: "composer-v1",
      displayName: "Composer V1",
      actorId: ACTOR,
      correlationId: "create-variant",
      reason: "onboard",
    });
    variantId = variant.id;
    const profile = await commands.createProfile({
      adapterId,
      surfaceId,
      variantId: variant.id,
      machineKey: "standard-profile",
      displayName: "Standard profile",
      actorId: ACTOR,
      correlationId: "create-profile",
      reason: "onboard",
    });
    profileId = profile.id;
    const other = await commands.createAdapter({
      machineKey: "other-ai",
      displayName: "Other",
      description: "",
      actorId: ACTOR,
      correlationId: "create-other",
      reason: "onboard",
    });
    const otherSurface = await commands.createSurface({
      adapterId: other.id,
      machineKey: "page",
      displayName: "Page",
      actorId: ACTOR,
      correlationId: "create-other-surface",
      reason: "onboard",
    });
    await expect(
      commands.createProfile({
        adapterId,
        surfaceId: otherSurface.id,
        variantId: null,
        machineKey: "bad-profile",
        displayName: "Bad",
        actorId: ACTOR,
        correlationId: "bad-binding",
        reason: "reject",
      }),
    ).rejects.toThrow();
  });

  it("runs lifecycle through P7.2 and preserves strict fingerprints", async () => {
    const commands = createP7AdminAiCommandRepository(runtime);
    const lifecycle = createProfileLifecycleRepository(runtime, {
      beforeMutation: authorizeAdminMutationInTransaction,
    });
    firstRevision = await lifecycle.createDraftProfileRevision({
      profileId,
      content,
      compatibility,
      context: context("draft"),
    });
    expect(firstRevision.contentSha256).toBe(
      validateProfileContent({ content, compatibility }).contentSha256,
    );
    await expect(
      lifecycle.updateDraftProfileRevision({
        profileId,
        revision: 1,
        content,
        compatibility,
        expectedContentSha256: "0".repeat(64),
        context: context("stale"),
      }),
    ).rejects.toThrow("P7_STALE_DRAFT_UPDATE");
    await lifecycle.markProfileRevisionCandidate({
      profileId,
      revision: 1,
      context: context("candidate"),
    });
    const published = await lifecycle.publishProfileRevision({
      profileId,
      revision: 1,
      context: context("publish"),
    });
    expect(published.state).toBe("PUBLISHED");
    const second = await commands.createProfile({
      adapterId,
      surfaceId,
      variantId,
      machineKey: "default-profile",
      displayName: "Default profile",
      actorId: ACTOR,
      correlationId: "create-default",
      reason: "onboard",
    });
    secondProfileId = second.id;
    const secondDraft = await lifecycle.createDraftProfileRevision({
      profileId: secondProfileId,
      content,
      compatibility,
      context: context("draft-two"),
    });
    await lifecycle.markProfileRevisionCandidate({
      profileId: secondProfileId,
      revision: 1,
      context: context("candidate-two"),
    });
    await lifecycle.publishProfileRevision({
      profileId: secondProfileId,
      revision: 1,
      context: context("publish-two"),
    });
    await expect(
      lifecycle.publishProfileRevision({
        profileId,
        revision: 1,
        context: context("publish-again"),
      }),
    ).rejects.toThrow();
    void secondDraft;
  });

  it("creates immutable assignment scope and delegates rollout state machine", async () => {
    const lifecycle = createProfileLifecycleRepository(runtime, {
      beforeMutation: authorizeAdminMutationInTransaction,
    });
    const scope = await lifecycle.createAssignmentScope({
      scope: {
        adapterId,
        surfaceId,
        variantId,
        browserFamily: "chrome",
        subjectKind: "ACCOUNT",
      },
      context: context("scope"),
    });
    assignmentId = scope.id;
    expect(scope.cohortSeed).toHaveLength(32);
    const direct = await lifecycle.assignDirect({
      assignmentId,
      baselineProfileRevisionId: firstRevision.id,
      expectedLatestAssignmentRevision: null,
      context: context("direct"),
    });
    expect((direct as { revision: number }).revision).toBe(1);
    await expect(
      lifecycle.retireProfileRevision({
        profileId,
        revision: 1,
        context: context("retire-referenced"),
      }),
    ).rejects.toThrow();
    await expect(
      lifecycle.startRollout({
        assignmentId,
        baselineProfileRevisionId: firstRevision.id,
        candidateProfileRevisionId: firstRevision.id,
        percentageBps: 5000,
        expectedLatestAssignmentRevision: 1,
        context: context("bad-rollout"),
      }),
    ).rejects.toThrow();
    const candidate = await runtime.query<{ id: string }>(
      "SELECT id FROM adapter_profile_revisions WHERE profile_id=$1 AND state='PUBLISHED'",
      [secondProfileId],
    );
    const rollout = await lifecycle.startRollout({
      assignmentId,
      baselineProfileRevisionId: firstRevision.id,
      candidateProfileRevisionId: candidate.rows[0]!.id,
      percentageBps: 2500,
      expectedLatestAssignmentRevision: 1,
      context: context("rollout"),
    });
    expect((rollout as { mode: string }).mode).toBe("ROLLOUT");
    const percentage = await lifecycle.changeRolloutPercentage({
      assignmentId,
      percentageBps: 5000,
      expectedLatestAssignmentRevision: 2,
      context: context("percentage"),
    });
    expect((percentage as { revision: number }).revision).toBe(3);
    const paused = await lifecycle.pauseProfileRollout({
      assignmentId,
      expectedLatestAssignmentRevision: 3,
      context: context("pause"),
    });
    expect((paused as { mode: string }).mode).toBe("PAUSED");
    const resumed = await lifecycle.resumeProfileRollout({
      assignmentId,
      expectedLatestAssignmentRevision: 4,
      context: context("resume"),
    });
    expect((resumed as { mode: string }).mode).toBe("ROLLOUT");
    const completed = await lifecycle.completeRollout({
      assignmentId,
      expectedLatestAssignmentRevision: 5,
      context: context("complete"),
    });
    expect((completed as { mode: string }).mode).toBe("DIRECT");
    await expect(
      lifecycle.rollbackProfileAssignment({
        assignmentId,
        profileRevisionId: firstRevision.id,
        expectedLatestAssignmentRevision: 1,
        context: context("stale-rollback"),
      }),
    ).rejects.toThrow("P7_ASSIGNMENT_STALE_REVISION");
    const rollback = await lifecycle.rollbackProfileAssignment({
      assignmentId,
      profileRevisionId: firstRevision.id,
      expectedLatestAssignmentRevision: 6,
      context: context("rollback"),
    });
    expect((rollback as { revision: number }).revision).toBe(7);
  });

  it("returns bounded safe deterministic reads without seed or operator reason", async () => {
    const reads = createP7AdminAiReadRepository(runtime);
    const assignments = await reads.listAssignments({ limit: 50 });
    expect(assignments.items).toHaveLength(1);
    expect(assignments.items[0]).not.toHaveProperty("cohortSeed");
    const revisions = await reads.listAssignmentRevisions({
      assignmentId,
      limit: 50,
    });
    expect(revisions.items.length).toBe(7);
    expect(revisions.items[0]).not.toHaveProperty("reason");
    expect(revisions.items[0]).not.toHaveProperty("createdByAdminPrincipalId");
    const profiles = await reads.listProfileRevisions({ profileId, limit: 50 });
    expect(profiles.items[0]).not.toHaveProperty("createdByAdminPrincipalId");
    expect(profiles.items[0]!.contentSha256).toHaveLength(64);
  });

  it("enforces availability concurrency and accepted P7.3 AI_DISABLED semantics", async () => {
    const commands = createP7AdminAiCommandRepository(runtime);
    const current = (
      await createP7AdminAiReadRepository(runtime).listAdapters({ limit: 50 })
    ).items.find((value) => value.id === adapterId)!;
    await expect(
      commands.updateAdapter({
        id: adapterId,
        expectedUpdatedAt: new Date(current.updatedAt.getTime() - 1),
        targetStatus: "DISABLED",
        actorId: ACTOR,
        correlationId: "stale-status",
        reason: "stale",
      }),
    ).rejects.toThrow();
    const renamed = await commands.updateAdapter({
      id: adapterId,
      displayName: "ChatGPT renamed",
      expectedUpdatedAt: current.updatedAt,
      actorId: ACTOR,
      correlationId: "display-name-only",
      reason: "rename",
    });
    expect(renamed.displayName).toBe("ChatGPT renamed");
    expect(renamed.description).toBe("preserve-me");
    const disabled = await commands.updateAdapter({
      id: adapterId,
      expectedUpdatedAt: renamed.updatedAt,
      targetStatus: "DISABLED",
      actorId: ACTOR,
      correlationId: "disable",
      reason: "maintenance",
    });
    expect(disabled.status).toBe("DISABLED");
    expect(disabled.description).toBe("preserve-me");
    const resolver = new BootstrapAiResolutionService(
      createBootstrapAiResolutionRepository(runtime),
    );
    const result = await resolver.resolve({
      detected: { family: "chatgpt", surface: "standard", variant: null },
      contractVersion: "control_plane_v1",
      extensionVersion: "1.0.0",
      browser: { family: "chrome", version: "120" },
      accountId: USER,
      deviceId: USER,
    });
    expect(result).toEqual({
      status: "UNAVAILABLE",
      detected: { family: "chatgpt", surface: "standard", variant: null },
      reason: "AI_DISABLED",
    });
    const enabled = await commands.updateAdapter({
      id: adapterId,
      expectedUpdatedAt: disabled.updatedAt,
      targetStatus: "ACTIVE",
      actorId: ACTOR,
      correlationId: "enable",
      reason: "ready",
    });
    expect(enabled.status).toBe("ACTIVE");
    expect(enabled.description).toBe("preserve-me");
    const replaced = await commands.updateAdapter({
      id: adapterId,
      description: "intentional replacement",
      expectedUpdatedAt: enabled.updatedAt,
      actorId: ACTOR,
      correlationId: "description-replacement",
      reason: "copy update",
    });
    expect(replaced.description).toBe("intentional replacement");
    const replacementAudit = await runtime.query<{
      safe_metadata: { fields?: { description?: string } };
    }>("SELECT safe_metadata FROM audit_events WHERE correlation_id=$1", [
      "description-replacement",
    ]);
    expect(replacementAudit.rows).toHaveLength(1);
    expect(replacementAudit.rows[0]!.safe_metadata.fields?.description).toBe(
      "intentional replacement",
    );
  });

  it("rechecks current RBAC in the mutation transaction and commits no denied state or audit", async () => {
    const commands = createP7AdminAiCommandRepository(runtime);
    const auditStateBefore = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events",
    );
    await runtime.query(
      "UPDATE admin_role_grants SET revoked_at=now(),revoked_by_admin_principal_id=$2 WHERE admin_principal_id=$1 AND role='ADMIN_OPS'",
      [ACTOR, ACTOR],
    );
    await expect(
      commands.createAdapter({
        machineKey: "revoked-ai",
        displayName: "Revoked",
        description: "",
        actorId: ACTOR,
        correlationId: "revoked",
        reason: "must fail",
      }),
    ).rejects.toThrow("ADMIN_FORBIDDEN");
    const auditStateAfter = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events",
    );
    expect(auditStateAfter.rows[0]!.count).toBe(
      auditStateBefore.rows[0]!.count,
    );
    expect(
      (
        await runtime.query(
          "SELECT id FROM ai_adapters WHERE machine_key='revoked-ai'",
        )
      ).rows,
    ).toHaveLength(0);
    await runtime.query(
      "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,'ADMIN_OPS')",
      [ACTOR],
    );
    const portalSessionId = "20000000-0000-4000-8000-000000000003";
    const adminSessionToken = "p74-real-admin-session-token";
    const authNow = new Date("2026-09-11T12:00:00.000Z");
    await runtime.query(
      "INSERT INTO portal_sessions(id,user_id,session_token_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",
      [
        portalSessionId,
        USER,
        "p74-portal-session-hash",
        authNow,
        new Date("2030-01-01T00:00:00.000Z"),
      ],
    );
    const authKeys = deriveAdminAuthKeys(Buffer.alloc(32, 7));
    const authRepository = createAdminAuthRepository(runtime);
    const sessionAuth = new AdminAuthService(
      authRepository,
      authKeys,
      () => authNow,
      () => adminSessionToken,
    );
    const createdSession = await sessionAuth.createAdminSession(
      {
        sessionId: portalSessionId,
        userId: USER,
        createdAt: authNow,
      },
      "p74-suspension-session",
    );
    expect(createdSession.ok).toBe(true);
    if (!createdSession.ok) throw new Error("P7_ADMIN_TEST_SESSION_FAILED");

    const suspensionCorrelation = "p74-suspended-update";
    const before = await runtime.query<{
      id: string;
      machine_key: string;
      display_name: string;
      description: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      "SELECT id,machine_key,display_name,description,status,created_at,updated_at FROM ai_adapters WHERE id=$1",
      [adapterId],
    );
    const auditBefore = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE correlation_id=$1",
      [suspensionCorrelation],
    );

    let suspendAfterAuthentication = true;
    const suspendingAuthRepository: AdminAuthRepository = {
      ...authRepository,
      async authenticateAdminSession(sessionTokenHash, now) {
        const result = await authRepository.authenticateAdminSession(
          sessionTokenHash,
          now,
        );
        if (suspendAfterAuthentication && result.kind === "authenticated") {
          await runtime.query(
            "UPDATE admin_principals SET status='SUSPENDED' WHERE id=$1",
            [ACTOR],
          );
          suspendAfterAuthentication = false;
        }
        return result;
      },
    };
    const routeAuth = new AdminAuthService(
      suspendingAuthRepository,
      authKeys,
      () => authNow,
      () => adminSessionToken,
    );
    const appConfig: AppConfig = {
      environment: "test",
      databaseUrl: connectionString!,
      logLevel: "error",
      apiPort: 0,
      workerReadyDelayMs: 0,
    };
    const app = createApiApp({
      config: appConfig,
      isInfrastructureReady: async () => true,
      adminAuthService: routeAuth,
      adminAiService: new AdminAiService(
        createP7AdminAiReadRepository(runtime),
        commands,
        createProfileLifecycleRepository(runtime, {
          beforeMutation: authorizeAdminMutationInTransaction,
        }),
      ),
    });
    const csrf = sessionAuth.csrf(adminSessionToken);
    const denied = await app.inject({
      method: "POST",
      url: `/v1/admin/ai/registry/adapters/${adapterId}/status`,
      headers: {
        cookie: `pcp_admin_session=${adminSessionToken}; pcp_admin_csrf=${csrf}`,
        "x-csrf-token": csrf,
        "x-request-id": suspensionCorrelation,
      },
      payload: {
        expectedUpdatedAt: before.rows[0]!.updated_at.toISOString(),
        targetStatus: "DISABLED",
        reason: "must fail while suspended",
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("ADMIN_FORBIDDEN");
    const after = await runtime.query<{
      id: string;
      machine_key: string;
      display_name: string;
      description: string;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>(
      "SELECT id,machine_key,display_name,description,status,created_at,updated_at FROM ai_adapters WHERE id=$1",
      [adapterId],
    );
    expect(after.rows).toEqual(before.rows);
    const auditAfter = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE correlation_id=$1",
      [suspensionCorrelation],
    );
    expect(auditAfter.rows[0]!.count).toBe(auditBefore.rows[0]!.count);
    expect(
      Number(auditAfter.rows[0]!.count) - Number(auditBefore.rows[0]!.count),
    ).toBe(0);
    await app.close();
    await runtime.query(
      "UPDATE admin_principals SET status='ACTIVE' WHERE id=$1",
      [ACTOR],
    );
  });
});
