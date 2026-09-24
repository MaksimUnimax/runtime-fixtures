import { randomBytes, randomUUID } from "node:crypto";
import {
  AssignmentExpectedRevisionSchema,
  AssignmentScopeCommandSchema,
  ChangeRolloutPercentageCommandSchema,
  DirectAssignmentCommandSchema,
  ProfileMutationContextSchema,
  PersistedProfileRevisionSchema,
  RollbackAssignmentCommandSchema,
  RolloutCommandSchema,
  assertProfileRevisionTransition,
  profileRevisionFingerprint,
  validateProfileContent,
  type AssignmentMode,
  type ProfileLifecycleRepository,
  type ProfileMutationContext,
} from "@product/adapter-registry";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { safeAuditReason } from "./safe-audit.js";

export type P7MutationAuthorizationHook = (
  tx: DatabaseQuery,
  actorPrincipalId: string,
  permission: "ai.profile.manage" | "ai.assignment.manage",
) => Promise<void>;

type RevisionRow = {
  id: string;
  profileId: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  revision: number;
  schemaVersion: string;
  state: "DRAFT" | "CANDIDATE" | "PUBLISHED" | "RETIRED";
  content: unknown;
  compatibility: unknown;
  contentSha256: string;
  createdAt: Date;
  publishedAt: Date | null;
  createdByAdminPrincipalId: string | null;
  publishedByAdminPrincipalId: string | null;
};
type AssignmentRevision = {
  id: string;
  assignmentId: string;
  revision: number;
  mode: AssignmentMode;
  baselineProfileRevisionId: string;
  candidateProfileRevisionId: string | null;
  percentageBps: number;
  createdAt: Date;
  createdByAdminPrincipalId: string | null;
  reason: string | null;
};
const revisionProjection = `SELECT id,profile_id AS "profileId",adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",revision,schema_version AS "schemaVersion",state,content,compatibility_constraints AS compatibility,content_sha256 AS "contentSha256",created_at AS "createdAt",published_at AS "publishedAt",created_by_admin_principal_id AS "createdByAdminPrincipalId",published_by_admin_principal_id AS "publishedByAdminPrincipalId" FROM adapter_profile_revisions`;

function context(input: ProfileMutationContext): ProfileMutationContext {
  return ProfileMutationContextSchema.parse(input);
}
function mapRevision(row: RevisionRow) {
  return PersistedProfileRevisionSchema.parse(row);
}
async function audit(
  q: DatabaseQuery,
  c: ProfileMutationContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await q.query(
    "INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
    [
      c.actorType,
      c.actorId ?? null,
      action,
      targetType,
      targetId,
      c.correlationId,
      safeAuditReason(c.reason),
      JSON.stringify(metadata),
    ],
  );
}
async function loadRevision(
  q: DatabaseQuery,
  profileId: string,
  revision: number,
  lock: boolean,
): Promise<RevisionRow> {
  const result = await q.query<RevisionRow>(
    `${revisionProjection} WHERE profile_id=$1 AND revision=$2${lock ? " FOR UPDATE" : ""}`,
    [profileId, revision],
  );
  const row = result.rows[0];
  if (!row) throw new Error("P7_PROFILE_REVISION_NOT_FOUND");
  return row;
}
async function loadAssignment(
  q: DatabaseQuery,
  assignmentId: string,
): Promise<{
  id: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  browserFamily: string;
  subjectKind: "ACCOUNT" | "DEVICE";
  cohortSeed: Buffer;
}> {
  const result = await q.query<{
    id: string;
    adapterId: string;
    surfaceId: string;
    variantId: string | null;
    browserFamily: string;
    subjectKind: "ACCOUNT" | "DEVICE";
    cohortSeed: Buffer;
  }>(
    `SELECT id,adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",browser_family AS "browserFamily",subject_kind AS "subjectKind",cohort_seed AS "cohortSeed" FROM adapter_profile_assignments WHERE id=$1 FOR UPDATE`,
    [assignmentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("P7_ASSIGNMENT_NOT_FOUND");
  return row;
}
async function latestAssignmentRevision(
  q: DatabaseQuery,
  assignmentId: string,
): Promise<AssignmentRevision | undefined> {
  const result = await q.query<AssignmentRevision>(
    `SELECT id,assignment_id AS "assignmentId",revision,mode,baseline_profile_revision_id AS "baselineProfileRevisionId",candidate_profile_revision_id AS "candidateProfileRevisionId",percentage_bps AS "percentageBps",created_at AS "createdAt",created_by_admin_principal_id AS "createdByAdminPrincipalId",reason FROM adapter_profile_assignment_revisions WHERE assignment_id=$1 ORDER BY revision DESC LIMIT 1`,
    [assignmentId],
  );
  return result.rows[0];
}
function checkExpected(
  actual: AssignmentRevision | undefined,
  expected: number | null,
): void {
  if ((actual?.revision ?? null) !== expected)
    throw new Error("P7_ASSIGNMENT_STALE_REVISION");
}
async function assertTargets(
  q: DatabaseQuery,
  assignmentId: string,
  ids: string[],
): Promise<void> {
  const expected = [...new Set(ids)];
  const result = await q.query<{ id: string }>(
    `SELECT r.id FROM adapter_profile_assignments a JOIN adapter_profile_revisions r ON r.id=ANY($2::uuid[]) JOIN adapter_profiles p ON p.id=r.profile_id JOIN ai_adapters ad ON ad.id=p.adapter_id JOIN ai_surfaces s ON s.id=p.surface_id AND s.adapter_id=p.adapter_id LEFT JOIN ai_variants v ON v.id=p.variant_id AND v.surface_id=p.surface_id WHERE a.id=$1 AND r.state='PUBLISHED' AND p.adapter_id=a.adapter_id AND p.surface_id=a.surface_id AND p.variant_id IS NOT DISTINCT FROM a.variant_id AND r.compatibility_constraints->'browserFamilies' ? a.browser_family AND ad.status='ACTIVE' AND s.status='ACTIVE' AND p.status='ACTIVE' AND (a.variant_id IS NULL OR v.status='ACTIVE')`,
    [assignmentId, expected],
  );
  if (result.rows.length !== expected.length)
    throw new Error("P7_ASSIGNMENT_TARGET_INELIGIBLE");
}
async function insertAssignmentRevision(
  q: DatabaseQuery,
  assignmentId: string,
  mode: AssignmentMode,
  baseline: string,
  candidate: string | null,
  percentageBps: number,
  c: ProfileMutationContext,
  reason: string,
): Promise<AssignmentRevision> {
  const latest = await latestAssignmentRevision(q, assignmentId);
  const revision = (latest?.revision ?? 0) + 1;
  const result = await q.query<AssignmentRevision>(
    `INSERT INTO adapter_profile_assignment_revisions(id,assignment_id,revision,mode,baseline_profile_revision_id,candidate_profile_revision_id,percentage_bps,created_by_admin_principal_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,assignment_id AS "assignmentId",revision,mode,baseline_profile_revision_id AS "baselineProfileRevisionId",candidate_profile_revision_id AS "candidateProfileRevisionId",percentage_bps AS "percentageBps",created_at AS "createdAt",created_by_admin_principal_id AS "createdByAdminPrincipalId",reason`,
    [
      randomUUID(),
      assignmentId,
      revision,
      mode,
      baseline,
      candidate,
      percentageBps,
      c.actorId ?? null,
      reason,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("P7_ASSIGNMENT_REVISION_INSERT_FAILED");
  return row;
}
async function mutateAssignment<T>(
  runtime: DatabaseRuntime,
  assignmentId: string,
  expected: number | null,
  action: (
    q: DatabaseQuery,
    assignment: Awaited<ReturnType<typeof loadAssignment>>,
    latest: AssignmentRevision | undefined,
    c: ProfileMutationContext,
  ) => Promise<T>,
  c: ProfileMutationContext,
  beforeMutation?: P7MutationAuthorizationHook,
): Promise<T> {
  return runtime.transaction(async (q) => {
    if (c.actorType === "ADMIN" && c.actorId)
      await beforeMutation?.(q, c.actorId, "ai.assignment.manage");
    const assignment = await loadAssignment(q, assignmentId);
    const latest = await latestAssignmentRevision(q, assignmentId);
    checkExpected(latest, expected);
    return action(q, assignment, latest, c);
  });
}

export function createProfileLifecycleRepository(
  runtime: DatabaseRuntime,
  options: { beforeMutation?: P7MutationAuthorizationHook } = {},
): ProfileLifecycleRepository {
  const beforeMutation = options.beforeMutation;
  return {
    async createDraftProfileRevision(input) {
      const c = context(input.context);
      const validated = validateProfileContent({
        content: input.content,
        compatibility: input.compatibility,
      });
      return runtime.transaction(async (q) => {
        if (c.actorType === "ADMIN" && c.actorId)
          await beforeMutation?.(q, c.actorId, "ai.profile.manage");
        const profile = await q.query<{
          id: string;
          adapterId: string;
          surfaceId: string;
          variantId: string | null;
        }>(
          `SELECT id,adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId" FROM adapter_profiles WHERE id=$1 FOR UPDATE`,
          [input.profileId],
        );
        const p = profile.rows[0];
        if (!p) throw new Error("P7_PROFILE_NOT_FOUND");
        const max = await q.query<{ revision: string }>(
          "SELECT COALESCE(max(revision),0)::text AS revision FROM adapter_profile_revisions WHERE profile_id=$1",
          [input.profileId],
        );
        const revision = Number(max.rows[0]?.revision ?? 0) + 1;
        const result = await q.query<RevisionRow>(
          `INSERT INTO adapter_profile_revisions(id,profile_id,adapter_id,surface_id,variant_id,revision,schema_version,state,content,compatibility_constraints,content_sha256,created_by_admin_principal_id) VALUES($1,$2,$3,$4,$5,$6,'adapter_profile_v1','DRAFT',$7::jsonb,$8::jsonb,$9,$10) RETURNING id,profile_id AS "profileId",adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",revision,schema_version AS "schemaVersion",state,content,compatibility_constraints AS compatibility,content_sha256 AS "contentSha256",created_at AS "createdAt",published_at AS "publishedAt",created_by_admin_principal_id AS "createdByAdminPrincipalId",published_by_admin_principal_id AS "publishedByAdminPrincipalId"`,
          [
            randomUUID(),
            p.id,
            p.adapterId,
            p.surfaceId,
            p.variantId,
            revision,
            JSON.stringify(validated.content),
            JSON.stringify(validated.compatibility),
            validated.contentSha256,
            c.actorId ?? null,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error("P7_PROFILE_REVISION_INSERT_FAILED");
        await audit(
          q,
          c,
          "P7_PROFILE_DRAFT_CREATED",
          "ADAPTER_PROFILE_REVISION",
          row.id,
          { profileId: p.id, revision, contentSha256: validated.contentSha256 },
        );
        return mapRevision(row);
      });
    },
    async updateDraftProfileRevision(input) {
      const c = context(input.context);
      const validated = validateProfileContent({
        content: input.content,
        compatibility: input.compatibility,
      });
      if (!/^[0-9a-f]{64}$/.test(input.expectedContentSha256))
        throw new Error("P7_INVALID_EXPECTED_FINGERPRINT");
      return runtime.transaction(async (q) => {
        if (c.actorType === "ADMIN" && c.actorId)
          await beforeMutation?.(q, c.actorId, "ai.profile.manage");
        const row = await loadRevision(
          q,
          input.profileId,
          input.revision,
          true,
        );
        if (row.state !== "DRAFT")
          throw new Error("P7_PROFILE_REVISION_NOT_DRAFT");
        if (row.contentSha256 !== input.expectedContentSha256)
          throw new Error("P7_STALE_DRAFT_UPDATE");
        const result = await q.query<RevisionRow>(
          `UPDATE adapter_profile_revisions SET content=$1::jsonb,compatibility_constraints=$2::jsonb,content_sha256=$3 WHERE id=$4 RETURNING id,profile_id AS "profileId",adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",revision,schema_version AS "schemaVersion",state,content,compatibility_constraints AS compatibility,content_sha256 AS "contentSha256",created_at AS "createdAt",published_at AS "publishedAt",created_by_admin_principal_id AS "createdByAdminPrincipalId",published_by_admin_principal_id AS "publishedByAdminPrincipalId"`,
          [
            JSON.stringify(validated.content),
            JSON.stringify(validated.compatibility),
            validated.contentSha256,
            row.id,
          ],
        );
        const updated = result.rows[0];
        if (!updated) throw new Error("P7_PROFILE_REVISION_UPDATE_FAILED");
        await audit(
          q,
          c,
          "P7_PROFILE_DRAFT_REPLACED",
          "ADAPTER_PROFILE_REVISION",
          row.id,
          {
            profileId: row.profileId,
            revision: row.revision,
            contentSha256: validated.contentSha256,
          },
        );
        return mapRevision(updated);
      });
    },
    async markProfileRevisionCandidate(input) {
      return transition(
        runtime,
        input.profileId,
        input.revision,
        "CANDIDATE",
        c(input.context),
        "P7_PROFILE_CANDIDATE_FROZEN",
        beforeMutation,
      );
    },
    async publishProfileRevision(input) {
      return transition(
        runtime,
        input.profileId,
        input.revision,
        "PUBLISHED",
        c(input.context),
        "P7_PROFILE_PUBLISHED",
        beforeMutation,
      );
    },
    async retireProfileRevision(input) {
      return transition(
        runtime,
        input.profileId,
        input.revision,
        "RETIRED",
        c(input.context),
        "P7_PROFILE_RETIRED",
        beforeMutation,
      );
    },
    async createAssignmentScope(input) {
      const c = context(input.context);
      const scope = AssignmentScopeCommandSchema.parse(input.scope);
      const seed = randomBytes(32);
      return runtime.transaction(async (q) => {
        if (c.actorType === "ADMIN" && c.actorId)
          await beforeMutation?.(q, c.actorId, "ai.assignment.manage");
        const result = await q.query<{ id: string; cohortSeed: Buffer }>(
          `INSERT INTO adapter_profile_assignments(id,adapter_id,surface_id,variant_id,browser_family,subject_kind,cohort_seed,created_by_admin_principal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,cohort_seed AS "cohortSeed"`,
          [
            randomUUID(),
            scope.adapterId,
            scope.surfaceId,
            scope.variantId,
            scope.browserFamily,
            scope.subjectKind,
            seed,
            c.actorId ?? null,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error("P7_ASSIGNMENT_INSERT_FAILED");
        await audit(
          q,
          c,
          "P7_ASSIGNMENT_SCOPE_CREATED",
          "ADAPTER_PROFILE_ASSIGNMENT",
          row.id,
          {
            adapterId: scope.adapterId,
            surfaceId: scope.surfaceId,
            variantId: scope.variantId,
            browserFamily: scope.browserFamily,
            subjectKind: scope.subjectKind,
          },
        );
        return row;
      });
    },
    async assignDirect(input) {
      const { context: rawContext, ...commandInput } = input;
      const cmd = DirectAssignmentCommandSchema.parse(commandInput);
      const c = context(rawContext);
      return mutateAssignment(
        runtime,
        cmd.assignmentId,
        cmd.expectedLatestAssignmentRevision,
        async (q, a) => {
          await assertTargets(q, a.id, [cmd.baselineProfileRevisionId]);
          const row = await insertAssignmentRevision(
            q,
            a.id,
            "DIRECT",
            cmd.baselineProfileRevisionId,
            null,
            0,
            c,
            c.reason,
          );
          await audit(
            q,
            c,
            "P7_ASSIGNMENT_DIRECT",
            "ADAPTER_PROFILE_ASSIGNMENT",
            a.id,
            {
              assignmentRevision: row.revision,
              baselineProfileRevisionId: row.baselineProfileRevisionId,
            },
          );
          return row;
        },
        c,
        beforeMutation,
      );
    },
    async startRollout(input) {
      const { context: rawContext, ...commandInput } = input;
      const cmd = RolloutCommandSchema.parse(commandInput);
      const c = context(rawContext);
      if (cmd.baselineProfileRevisionId === cmd.candidateProfileRevisionId)
        throw new Error("P7_ROLLOUT_TARGETS_MUST_DIFFER");
      return mutateAssignment(
        runtime,
        cmd.assignmentId,
        cmd.expectedLatestAssignmentRevision,
        async (q, a) => {
          await assertTargets(q, a.id, [
            cmd.baselineProfileRevisionId,
            cmd.candidateProfileRevisionId,
          ]);
          const row = await insertAssignmentRevision(
            q,
            a.id,
            "ROLLOUT",
            cmd.baselineProfileRevisionId,
            cmd.candidateProfileRevisionId,
            cmd.percentageBps,
            c,
            c.reason,
          );
          await audit(
            q,
            c,
            "P7_ASSIGNMENT_ROLLOUT_STARTED",
            "ADAPTER_PROFILE_ASSIGNMENT",
            a.id,
            {
              assignmentRevision: row.revision,
              percentageBps: row.percentageBps,
            },
          );
          return row;
        },
        c,
        beforeMutation,
      );
    },
    async changeRolloutPercentage(input) {
      const { context: rawContext, ...commandInput } = input;
      const cmd = ChangeRolloutPercentageCommandSchema.parse(commandInput);
      const c = context(rawContext);
      return mutateAssignment(
        runtime,
        cmd.assignmentId,
        cmd.expectedLatestAssignmentRevision,
        async (q, a, latest) => {
          if (!latest || latest.mode !== "ROLLOUT")
            throw new Error("P7_ROLLOUT_NOT_ACTIVE");
          const row = await insertAssignmentRevision(
            q,
            a.id,
            "ROLLOUT",
            latest.baselineProfileRevisionId,
            latest.candidateProfileRevisionId,
            cmd.percentageBps,
            c,
            c.reason,
          );
          await audit(
            q,
            c,
            "P7_ASSIGNMENT_ROLLOUT_PERCENTAGE_CHANGED",
            "ADAPTER_PROFILE_ASSIGNMENT",
            a.id,
            {
              previousAssignmentRevision: latest.revision,
              assignmentRevision: row.revision,
              percentageBps: row.percentageBps,
            },
          );
          return row;
        },
        c,
        beforeMutation,
      );
    },
    async pauseProfileRollout(input) {
      const c = context(input.context);
      const expected = AssignmentExpectedRevisionSchema.parse(
        input.expectedLatestAssignmentRevision,
      );
      if (expected === null)
        throw new Error("P7_ASSIGNMENT_EXPECTED_REVISION_REQUIRED");
      return mutateAssignment(
        runtime,
        input.assignmentId,
        expected,
        async (q, a, latest) => {
          if (!latest || latest.mode !== "ROLLOUT")
            throw new Error("P7_ROLLOUT_NOT_ACTIVE");
          const row = await insertAssignmentRevision(
            q,
            a.id,
            "PAUSED",
            latest.baselineProfileRevisionId,
            latest.candidateProfileRevisionId,
            latest.percentageBps,
            c,
            c.reason,
          );
          await audit(
            q,
            c,
            "P7_ASSIGNMENT_ROLLOUT_PAUSED",
            "ADAPTER_PROFILE_ASSIGNMENT",
            a.id,
            {
              previousAssignmentRevision: latest.revision,
              assignmentRevision: row.revision,
            },
          );
          return row;
        },
        c,
        beforeMutation,
      );
    },
    async resumeProfileRollout(input) {
      const c = context(input.context);
      const expected = AssignmentExpectedRevisionSchema.parse(
        input.expectedLatestAssignmentRevision,
      );
      if (expected === null)
        throw new Error("P7_ASSIGNMENT_EXPECTED_REVISION_REQUIRED");
      return mutateAssignment(
        runtime,
        input.assignmentId,
        expected,
        async (q, a, latest) => {
          if (
            !latest ||
            latest.mode !== "PAUSED" ||
            !latest.candidateProfileRevisionId
          )
            throw new Error("P7_ROLLOUT_NOT_PAUSED");
          const percentage = input.percentageBps ?? latest.percentageBps;
          if (
            !Number.isInteger(percentage) ||
            percentage < 0 ||
            percentage > 10000
          )
            throw new Error("P7_INVALID_ROLLOUT_PERCENTAGE");
          const row = await insertAssignmentRevision(
            q,
            a.id,
            "ROLLOUT",
            latest.baselineProfileRevisionId,
            latest.candidateProfileRevisionId,
            percentage,
            c,
            c.reason,
          );
          await audit(
            q,
            c,
            "P7_ASSIGNMENT_ROLLOUT_RESUMED",
            "ADAPTER_PROFILE_ASSIGNMENT",
            a.id,
            {
              previousAssignmentRevision: latest.revision,
              assignmentRevision: row.revision,
              percentageBps: percentage,
            },
          );
          return row;
        },
        c,
        beforeMutation,
      );
    },
    async completeRollout(input) {
      const c = context(input.context);
      const expected = AssignmentExpectedRevisionSchema.parse(
        input.expectedLatestAssignmentRevision,
      );
      if (expected === null)
        throw new Error("P7_ASSIGNMENT_EXPECTED_REVISION_REQUIRED");
      return mutateAssignment(
        runtime,
        input.assignmentId,
        expected,
        async (q, a, latest) => {
          if (
            !latest ||
            latest.mode !== "ROLLOUT" ||
            !latest.candidateProfileRevisionId
          )
            throw new Error("P7_ROLLOUT_NOT_ACTIVE");
          const row = await insertAssignmentRevision(
            q,
            a.id,
            "DIRECT",
            latest.candidateProfileRevisionId,
            null,
            0,
            c,
            c.reason,
          );
          await audit(
            q,
            c,
            "P7_ASSIGNMENT_ROLLOUT_COMPLETED",
            "ADAPTER_PROFILE_ASSIGNMENT",
            a.id,
            {
              previousAssignmentRevision: latest.revision,
              assignmentRevision: row.revision,
            },
          );
          return row;
        },
        c,
        beforeMutation,
      );
    },
    async rollbackProfileAssignment(input) {
      const { context: rawContext, ...commandInput } = input;
      const cmd = RollbackAssignmentCommandSchema.parse(commandInput);
      const c = context(rawContext);
      return mutateAssignment(
        runtime,
        cmd.assignmentId,
        cmd.expectedLatestAssignmentRevision,
        async (q, a, latest) => {
          await assertTargets(q, a.id, [cmd.profileRevisionId]);
          const row = await insertAssignmentRevision(
            q,
            a.id,
            "DIRECT",
            cmd.profileRevisionId,
            null,
            0,
            c,
            c.reason,
          );
          await audit(
            q,
            c,
            "P7_ASSIGNMENT_ROLLED_BACK",
            "ADAPTER_PROFILE_ASSIGNMENT",
            a.id,
            {
              previousAssignmentRevision: latest?.revision ?? null,
              assignmentRevision: row.revision,
              rollbackTargetProfileRevisionId: cmd.profileRevisionId,
            },
          );
          return row;
        },
        c,
        beforeMutation,
      );
    },
  };
}

function c(input: ProfileMutationContext): ProfileMutationContext {
  return context(input);
}
async function transition(
  runtime: DatabaseRuntime,
  profileId: string,
  revision: number,
  to: "CANDIDATE" | "PUBLISHED" | "RETIRED",
  ctx: ProfileMutationContext,
  action: string,
  beforeMutation?: P7MutationAuthorizationHook,
) {
  return runtime.transaction(async (q) => {
    if (ctx.actorType === "ADMIN" && ctx.actorId)
      await beforeMutation?.(q, ctx.actorId, "ai.profile.manage");
    if (to === "RETIRED") {
      const target = await q.query<{ id: string }>(
        "SELECT id FROM adapter_profile_revisions WHERE profile_id=$1 AND revision=$2",
        [profileId, revision],
      );
      const targetId = target.rows[0]?.id;
      if (!targetId) throw new Error("P7_PROFILE_REVISION_NOT_FOUND");
      await q.query("SELECT p7_2_lock_profile_revision_target($1)", [targetId]);
    }
    const row = await loadRevision(q, profileId, revision, true);
    assertProfileRevisionTransition(row.state, to);
    if (to === "CANDIDATE") {
      validateProfileContent({
        content: row.content,
        compatibility: row.compatibility,
      });
      const fingerprint = profileRevisionFingerprint({
        content: row.content,
        compatibility: row.compatibility,
      });
      if (fingerprint !== row.contentSha256)
        throw new Error("P7_PROFILE_REVISION_FINGERPRINT_MISMATCH");
    }
    const result =
      to === "PUBLISHED"
        ? await q.query<RevisionRow>(
            `UPDATE adapter_profile_revisions SET state='PUBLISHED',published_at=now(),published_by_admin_principal_id=$1 WHERE id=$2 RETURNING id,profile_id AS "profileId",adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",revision,schema_version AS "schemaVersion",state,content,compatibility_constraints AS compatibility,content_sha256 AS "contentSha256",created_at AS "createdAt",published_at AS "publishedAt",created_by_admin_principal_id AS "createdByAdminPrincipalId",published_by_admin_principal_id AS "publishedByAdminPrincipalId"`,
            [ctx.actorId ?? null, row.id],
          )
        : await q.query<RevisionRow>(
            `UPDATE adapter_profile_revisions SET state=$1 WHERE id=$2 RETURNING id,profile_id AS "profileId",adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",revision,schema_version AS "schemaVersion",state,content,compatibility_constraints AS compatibility,content_sha256 AS "contentSha256",created_at AS "createdAt",published_at AS "publishedAt",created_by_admin_principal_id AS "createdByAdminPrincipalId",published_by_admin_principal_id AS "publishedByAdminPrincipalId"`,
            [to, row.id],
          );
    const updated = result.rows[0];
    if (!updated) throw new Error("P7_PROFILE_REVISION_TRANSITION_FAILED");
    await audit(q, ctx, action, "ADAPTER_PROFILE_REVISION", row.id, {
      profileId,
      revision,
      contentSha256: row.contentSha256,
    });
    return mapRevision(updated);
  });
}
