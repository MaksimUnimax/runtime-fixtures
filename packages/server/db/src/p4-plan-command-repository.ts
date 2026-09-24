import {
  ChangePlanStatusCommandSchema,
  CreateDraftPlanRevisionCommandSchema,
  CreateEntitlementDefinitionCommandSchema,
  CreatePlanCommandSchema,
  DeprecateEntitlementDefinitionCommandSchema,
  EntitlementDefinition,
  FailureCode,
  PlanEntitlementCommandRepository,
  PlanMutationContext,
  PlanMutationContextSchema,
  PlanRevisionDraft,
  PlanStatus,
  PublishPlanRevisionCommandSchema,
  RemoveDraftPlanEntitlementCommandSchema,
  SetDraftPlanEntitlementCommandSchema,
  TypedEntitlementValue,
  UpdateDraftPlanRevisionCommandSchema,
  UpdateEntitlementDefinitionDescriptionCommandSchema,
  computeP4PlanRevisionContentFingerprintV1,
  validateEntitlementValueType,
  validatePlanStatusTransition,
  type CommandResult,
  type EntitlementValueType,
  type PlanEntitlement,
  type PlanRevisionFingerprintInput,
  type PlanSummary,
  type PublishedPlanRevision,
} from "@product/plans";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { safeAuditReason } from "./safe-audit.js";

type Query = Pick<DatabaseQuery, "query">;
type PlanRow = {
  id: string;
  code: string;
  status: PlanStatus;
  createdAt: Date;
  updatedAt: Date;
};
type RevisionRow = {
  id: string;
  planId: string;
  revision: number;
  state: "DRAFT" | "PUBLISHED";
  displayName: string;
  description: string;
  publishedAt: Date | null;
};
type EntitlementRow = {
  entitlementKey: string;
  booleanValue: boolean | null;
  integerValue: number | string | null;
};
type DefinitionRow = {
  entitlementKey: string;
  valueType: EntitlementValueType;
  securityClassification: "CAPABILITY" | "LIMIT";
  description: string;
  deprecatedAt: Date | null;
  createdAt: Date;
};

const rejection = <T>(code: FailureCode): CommandResult<T> => ({
  kind: "REJECTED",
  code,
});

async function lock(q: Query, key: string): Promise<void> {
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

async function audit(
  q: Query,
  context: PlanMutationContext,
  action: string,
  targetType: string,
  targetId: string | null,
  safeMetadata?: Record<string, unknown>,
): Promise<void> {
  await q.query(
    "INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
    [
      context.actorType,
      context.actorId ?? null,
      action,
      targetType,
      targetId,
      context.correlationId,
      safeAuditReason(context.reason),
      safeMetadata ? JSON.stringify(safeMetadata) : null,
    ],
  );
}

function mapPlan(row: PlanRow): PlanSummary {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDefinition(row: DefinitionRow): EntitlementDefinition {
  return {
    entitlementKey: row.entitlementKey,
    valueType: row.valueType,
    securityClassification: row.securityClassification,
    description: row.description,
    deprecatedAt: row.deprecatedAt,
    createdAt: row.createdAt,
  };
}

function mapValue(row: EntitlementRow): TypedEntitlementValue {
  if (row.booleanValue !== null)
    return { kind: "BOOLEAN", value: row.booleanValue };
  if (row.integerValue !== null) {
    const value = Number(row.integerValue);
    if (!Number.isSafeInteger(value))
      throw new Error("P4_INTEGER_VALUE_UNSAFE");
    return { kind: "INTEGER", value };
  }
  throw new Error("P4_PLAN_ENTITLEMENT_VALUE_MISSING");
}

function fingerprintInput(
  revision: RevisionRow,
  entitlements: readonly PlanEntitlement[],
): PlanRevisionFingerprintInput {
  return {
    planRevisionId: revision.id,
    planId: revision.planId,
    revision: revision.revision,
    displayName: revision.displayName,
    description: revision.description,
    entitlements,
  };
}

async function loadEntitlements(
  q: Query,
  planRevisionId: string,
): Promise<PlanEntitlement[]> {
  const result = await q.query<EntitlementRow>(
    'SELECT entitlement_key AS "entitlementKey",boolean_value AS "booleanValue",integer_value AS "integerValue" FROM plan_entitlements WHERE plan_revision_id=$1 ORDER BY entitlement_key',
    [planRevisionId],
  );
  return result.rows.map((row) => ({
    entitlementKey: row.entitlementKey,
    value: mapValue(row),
  }));
}

async function loadRevision(
  q: Query,
  planRevisionId: string,
  lockRow: boolean,
): Promise<
  | { plan: PlanRow; revision: RevisionRow; entitlements: PlanEntitlement[] }
  | undefined
> {
  const result = await q.query<PlanRow & RevisionRow>(
    `SELECT p.id AS "id",p.code,p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt",
            r.id AS "revisionId",r.plan_id AS "planId",r.revision,r.state,r.display_name AS "displayName",
            r.description,r.published_at AS "publishedAt"
       FROM plans p JOIN plan_revisions r ON r.plan_id=p.id WHERE r.id=$1${lockRow ? " FOR UPDATE" : ""}`,
    [planRevisionId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const revision: RevisionRow = {
    id: String((row as unknown as { revisionId: string }).revisionId),
    planId: row.planId,
    revision: row.revision,
    state: row.state,
    displayName: row.displayName,
    description: row.description,
    publishedAt: row.publishedAt,
  };
  return {
    plan: {
      id: row.id,
      code: row.code,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    revision,
    entitlements: await loadEntitlements(q, revision.id),
  };
}

function draftValue(
  revision: RevisionRow,
  entitlements: PlanEntitlement[],
): PlanRevisionDraft {
  return {
    id: revision.id,
    planId: revision.planId,
    revision: revision.revision,
    state: "DRAFT",
    displayName: revision.displayName,
    description: revision.description,
    entitlements: [...entitlements].sort((a, b) =>
      a.entitlementKey < b.entitlementKey
        ? -1
        : a.entitlementKey > b.entitlementKey
          ? 1
          : 0,
    ),
    contentFingerprintSha256: computeP4PlanRevisionContentFingerprintV1(
      fingerprintInput(revision, entitlements),
    ),
  };
}

function publishedValue(
  revision: RevisionRow,
  entitlements: PlanEntitlement[],
): {
  id: string;
  planId: string;
  revision: number;
  state: "PUBLISHED";
  publishedAt: Date;
  contentFingerprintSha256: string;
  entitlementCount: number;
} {
  if (!revision.publishedAt) throw new Error("P4_PUBLISHED_TIMESTAMP_MISSING");
  return {
    id: revision.id,
    planId: revision.planId,
    revision: revision.revision,
    state: "PUBLISHED",
    publishedAt: revision.publishedAt,
    contentFingerprintSha256: computeP4PlanRevisionContentFingerprintV1(
      fingerprintInput(revision, entitlements),
    ),
    entitlementCount: entitlements.length,
  };
}

async function lockDefinitions(
  q: Query,
  keys: readonly string[],
): Promise<DefinitionRow[]> {
  const sorted = [...new Set(keys)].sort();
  if (sorted.length === 0) return [];
  const result = await q.query<DefinitionRow>(
    'SELECT entitlement_key AS "entitlementKey",value_type AS "valueType",security_classification AS "securityClassification",description,deprecated_at AS "deprecatedAt",created_at AS "createdAt" FROM entitlement_definitions WHERE entitlement_key = ANY($1::varchar[]) ORDER BY entitlement_key FOR SHARE',
    [sorted],
  );
  return result.rows;
}

function definitionByKey(
  rows: DefinitionRow[],
  key: string,
): DefinitionRow | undefined {
  return rows.find((row) => row.entitlementKey === key);
}

function sameValue(
  left: TypedEntitlementValue | undefined,
  right: TypedEntitlementValue,
): boolean {
  return left?.kind === right.kind && left.value === right.value;
}

async function loadDefinition(
  q: Query,
  key: string,
  lockMode: "UPDATE" | "SHARE",
): Promise<DefinitionRow | undefined> {
  const result = await q.query<DefinitionRow>(
    `SELECT entitlement_key AS "entitlementKey",value_type AS "valueType",security_classification AS "securityClassification",description,deprecated_at AS "deprecatedAt",created_at AS "createdAt" FROM entitlement_definitions WHERE entitlement_key=$1 FOR ${lockMode}`,
    [key],
  );
  return result.rows[0];
}

export function createP4PlanCommandRepository(
  runtime: DatabaseRuntime,
  options: {
    clock?: () => Date;
    beforeMutation?: (tx: DatabaseQuery) => Promise<void>;
  } = {},
): PlanEntitlementCommandRepository {
  const clock = options.clock ?? (() => new Date());

  return {
    async createPlan(rawCommand, rawContext) {
      const command = CreatePlanCommandSchema.parse(rawCommand);
      const context = PlanMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        await lock(q, `p4-plan-code:${command.code}`);
        const existing = await q.query<PlanRow>(
          'SELECT id,code,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM plans WHERE code=$1',
          [command.code],
        );
        if (existing.rows[0])
          return rejection<PlanSummary>("PLAN_CODE_CONFLICT");
        const inserted = await q.query<PlanRow>(
          'INSERT INTO plans(code) VALUES($1) RETURNING id,code,status,created_at AS "createdAt",updated_at AS "updatedAt"',
          [command.code],
        );
        const value = mapPlan(inserted.rows[0]!);
        await audit(q, context, "PLAN_CREATED", "PLAN", value.id, {
          planCode: value.code,
          status: value.status,
        });
        return { kind: "OK", changed: true, value };
      });
    },

    async createDraftPlanRevision(rawCommand, rawContext) {
      const command = CreateDraftPlanRevisionCommandSchema.parse(rawCommand);
      const context = PlanMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        await lock(q, `p4-plan:${command.planId}`);
        const planResult = await q.query<PlanRow>(
          'SELECT id,code,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM plans WHERE id=$1 FOR UPDATE',
          [command.planId],
        );
        const plan = planResult.rows[0];
        if (!plan) return rejection<PlanRevisionDraft>("PLAN_NOT_FOUND");
        if (plan.status === "ARCHIVED")
          return rejection<PlanRevisionDraft>("PLAN_ARCHIVED");
        const next = await q.query<{ revision: number }>(
          "SELECT COALESCE(MAX(revision),0)+1 AS revision FROM plan_revisions WHERE plan_id=$1",
          [command.planId],
        );
        const inserted = await q.query<RevisionRow>(
          'INSERT INTO plan_revisions(plan_id,revision,display_name,description) VALUES($1,$2,$3,$4) RETURNING id,plan_id AS "planId",revision,state,display_name AS "displayName",description,published_at AS "publishedAt"',
          [
            command.planId,
            next.rows[0]!.revision,
            command.displayName,
            command.description,
          ],
        );
        const revision = inserted.rows[0]!;
        const value = draftValue(revision, []);
        await audit(
          q,
          context,
          "PLAN_REVISION_DRAFT_CREATED",
          "PLAN_REVISION",
          revision.id,
          {
            planId: plan.id,
            revision: revision.revision,
            contentFingerprintSha256: value.contentFingerprintSha256,
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async getPlanRevisionDraft(planRevisionId) {
      const loaded = await runtime.query<PlanRow & RevisionRow>(
        `SELECT p.id AS "id",p.code,p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt",
                r.id AS "revisionId",r.plan_id AS "planId",r.revision,r.state,r.display_name AS "displayName",
                r.description,r.published_at AS "publishedAt"
           FROM plans p JOIN plan_revisions r ON r.plan_id=p.id WHERE r.id=$1`,
        [planRevisionId],
      );
      const row = loaded.rows[0];
      if (!row) return undefined;
      const revision: RevisionRow = {
        id: String((row as unknown as { revisionId: string }).revisionId),
        planId: row.planId,
        revision: row.revision,
        state: row.state,
        displayName: row.displayName,
        description: row.description,
        publishedAt: row.publishedAt,
      };
      if (revision.state !== "DRAFT") return undefined;
      const entitlements = await runtime.query<EntitlementRow>(
        'SELECT entitlement_key AS "entitlementKey",boolean_value AS "booleanValue",integer_value AS "integerValue" FROM plan_entitlements WHERE plan_revision_id=$1 ORDER BY entitlement_key',
        [revision.id],
      );
      return draftValue(
        revision,
        entitlements.rows.map((item) => ({
          entitlementKey: item.entitlementKey,
          value: mapValue(item),
        })),
      );
    },

    async updateDraftPlanRevision(rawCommand, rawContext) {
      const command = UpdateDraftPlanRevisionCommandSchema.parse(rawCommand);
      const context = PlanMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const initial = await loadRevision(q, command.planRevisionId, false);
        if (!initial)
          return rejection<PlanRevisionDraft>("PLAN_REVISION_NOT_FOUND");
        await lock(q, `p4-plan:${initial.plan.id}`);
        const loaded = await loadRevision(q, command.planRevisionId, true);
        if (!loaded)
          return rejection<PlanRevisionDraft>("PLAN_REVISION_NOT_FOUND");
        if (loaded.plan.status === "ARCHIVED")
          return rejection<PlanRevisionDraft>("PLAN_ARCHIVED");
        if (loaded.revision.state !== "DRAFT")
          return rejection<PlanRevisionDraft>("PLAN_REVISION_NOT_DRAFT");
        const current = draftValue(loaded.revision, loaded.entitlements);
        if (
          current.contentFingerprintSha256 !==
          command.expectedContentFingerprint
        )
          return rejection<PlanRevisionDraft>("PLAN_DRAFT_STALE");
        const nextDisplayName = command.displayName ?? current.displayName;
        const nextDescription = command.description ?? current.description;
        const changedFields = [
          ...(nextDisplayName !== current.displayName ? ["displayName"] : []),
          ...(nextDescription !== current.description ? ["description"] : []),
        ];
        if (changedFields.length === 0)
          return { kind: "OK", changed: false, value: current };
        await q.query(
          "UPDATE plan_revisions SET display_name=$1,description=$2 WHERE id=$3",
          [nextDisplayName, nextDescription, current.id],
        );
        const updated = await loadRevision(q, current.id, false);
        if (!updated) throw new Error("P4_REVISION_DISAPPEARED");
        const value = draftValue(updated.revision, updated.entitlements);
        await audit(
          q,
          context,
          "PLAN_REVISION_DRAFT_UPDATED",
          "PLAN_REVISION",
          current.id,
          {
            planId: current.planId,
            revision: current.revision,
            changedFields,
            beforeFingerprint: current.contentFingerprintSha256,
            afterFingerprint: value.contentFingerprintSha256,
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async setDraftPlanEntitlement(rawCommand, rawContext) {
      const command = SetDraftPlanEntitlementCommandSchema.parse(rawCommand);
      const context = PlanMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const initial = await loadRevision(q, command.planRevisionId, false);
        if (!initial)
          return rejection<PlanRevisionDraft>("PLAN_REVISION_NOT_FOUND");
        await lock(q, `p4-plan:${initial.plan.id}`);
        const loaded = await loadRevision(q, command.planRevisionId, true);
        if (!loaded)
          return rejection<PlanRevisionDraft>("PLAN_REVISION_NOT_FOUND");
        if (loaded.plan.status === "ARCHIVED")
          return rejection<PlanRevisionDraft>("PLAN_ARCHIVED");
        if (loaded.revision.state !== "DRAFT")
          return rejection<PlanRevisionDraft>("PLAN_REVISION_NOT_DRAFT");
        const current = draftValue(loaded.revision, loaded.entitlements);
        if (
          current.contentFingerprintSha256 !==
          command.expectedContentFingerprint
        )
          return rejection<PlanRevisionDraft>("PLAN_DRAFT_STALE");
        const definition = await loadDefinition(
          q,
          command.entitlementKey,
          "SHARE",
        );
        if (!definition)
          return rejection<PlanRevisionDraft>(
            "ENTITLEMENT_DEFINITION_NOT_FOUND",
          );
        if (definition.deprecatedAt)
          return rejection<PlanRevisionDraft>("ENTITLEMENT_DEPRECATED");
        if (!validateEntitlementValueType(definition.valueType, command.value))
          return rejection<PlanRevisionDraft>("ENTITLEMENT_TYPE_MISMATCH");
        const prior = loaded.entitlements.find(
          (item) => item.entitlementKey === command.entitlementKey,
        );
        if (sameValue(prior?.value, command.value))
          return { kind: "OK", changed: false, value: current };
        await q.query(
          "INSERT INTO plan_entitlements(plan_revision_id,entitlement_key,boolean_value,integer_value) VALUES($1,$2,$3,$4) ON CONFLICT(plan_revision_id,entitlement_key) DO UPDATE SET boolean_value=EXCLUDED.boolean_value,integer_value=EXCLUDED.integer_value",
          [
            current.id,
            command.entitlementKey,
            command.value.kind === "BOOLEAN" ? command.value.value : null,
            command.value.kind === "INTEGER" ? command.value.value : null,
          ],
        );
        const updated = await loadRevision(q, current.id, false);
        if (!updated) throw new Error("P4_REVISION_DISAPPEARED");
        const value = draftValue(updated.revision, updated.entitlements);
        await audit(
          q,
          context,
          "PLAN_ENTITLEMENT_SET",
          "PLAN_REVISION",
          current.id,
          {
            entitlementKey: command.entitlementKey,
            valueType: command.value.kind,
            beforeFingerprint: current.contentFingerprintSha256,
            afterFingerprint: value.contentFingerprintSha256,
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async removeDraftPlanEntitlement(rawCommand, rawContext) {
      const command = RemoveDraftPlanEntitlementCommandSchema.parse(rawCommand);
      const context = PlanMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const initial = await loadRevision(q, command.planRevisionId, false);
        if (!initial)
          return rejection<PlanRevisionDraft>("PLAN_REVISION_NOT_FOUND");
        await lock(q, `p4-plan:${initial.plan.id}`);
        const loaded = await loadRevision(q, command.planRevisionId, true);
        if (!loaded)
          return rejection<PlanRevisionDraft>("PLAN_REVISION_NOT_FOUND");
        if (loaded.plan.status === "ARCHIVED")
          return rejection<PlanRevisionDraft>("PLAN_ARCHIVED");
        if (loaded.revision.state !== "DRAFT")
          return rejection<PlanRevisionDraft>("PLAN_REVISION_NOT_DRAFT");
        const current = draftValue(loaded.revision, loaded.entitlements);
        if (
          current.contentFingerprintSha256 !==
          command.expectedContentFingerprint
        )
          return rejection<PlanRevisionDraft>("PLAN_DRAFT_STALE");
        const prior = loaded.entitlements.find(
          (item) => item.entitlementKey === command.entitlementKey,
        );
        if (!prior) return { kind: "OK", changed: false, value: current };
        await q.query(
          "DELETE FROM plan_entitlements WHERE plan_revision_id=$1 AND entitlement_key=$2",
          [current.id, command.entitlementKey],
        );
        const updated = await loadRevision(q, current.id, false);
        if (!updated) throw new Error("P4_REVISION_DISAPPEARED");
        const value = draftValue(updated.revision, updated.entitlements);
        await audit(
          q,
          context,
          "PLAN_ENTITLEMENT_REMOVED",
          "PLAN_REVISION",
          current.id,
          {
            entitlementKey: command.entitlementKey,
            beforeFingerprint: current.contentFingerprintSha256,
            afterFingerprint: value.contentFingerprintSha256,
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async publishPlanRevision(rawCommand, rawContext) {
      const command = PublishPlanRevisionCommandSchema.parse(rawCommand);
      const context = PlanMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const initial = await loadRevision(q, command.planRevisionId, false);
        if (!initial)
          return rejection<PublishedPlanRevision>("PLAN_REVISION_NOT_FOUND");
        await lock(q, `p4-plan:${initial.plan.id}`);
        const loaded = await loadRevision(q, command.planRevisionId, true);
        if (!loaded)
          return rejection<PublishedPlanRevision>("PLAN_REVISION_NOT_FOUND");
        if (loaded.revision.state === "PUBLISHED")
          return {
            kind: "OK",
            changed: false,
            value: publishedValue(loaded.revision, loaded.entitlements),
          };
        if (loaded.plan.status === "ARCHIVED")
          return rejection<PublishedPlanRevision>("PLAN_ARCHIVED");
        const current = draftValue(loaded.revision, loaded.entitlements);
        if (
          current.contentFingerprintSha256 !==
          command.expectedContentFingerprint
        )
          return rejection<PublishedPlanRevision>("PLAN_DRAFT_STALE");
        const definitions = await lockDefinitions(
          q,
          loaded.entitlements.map((item) => item.entitlementKey),
        );
        if (definitions.length !== loaded.entitlements.length)
          return rejection<PublishedPlanRevision>(
            "ENTITLEMENT_DEFINITION_NOT_FOUND",
          );
        for (const item of loaded.entitlements) {
          const definition = definitionByKey(definitions, item.entitlementKey)!;
          if (definition.deprecatedAt)
            return rejection<PublishedPlanRevision>("ENTITLEMENT_DEPRECATED");
          if (!validateEntitlementValueType(definition.valueType, item.value))
            return rejection<PublishedPlanRevision>(
              "ENTITLEMENT_TYPE_MISMATCH",
            );
        }
        const publishedAt = clock();
        await q.query(
          "UPDATE plan_revisions SET state='PUBLISHED',published_at=$1 WHERE id=$2",
          [publishedAt, current.id],
        );
        const published: RevisionRow = {
          ...loaded.revision,
          state: "PUBLISHED",
          publishedAt,
        };
        const value = publishedValue(published, loaded.entitlements);
        await audit(
          q,
          context,
          "PLAN_REVISION_PUBLISHED",
          "PLAN_REVISION",
          current.id,
          {
            planId: value.planId,
            revision: value.revision,
            contentFingerprintSha256: value.contentFingerprintSha256,
            entitlementCount: value.entitlementCount,
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async changePlanStatus(rawCommand, rawContext) {
      const command = ChangePlanStatusCommandSchema.parse(rawCommand);
      const context = PlanMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        await lock(q, `p4-plan:${command.planId}`);
        const result = await q.query<PlanRow>(
          'SELECT id,code,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM plans WHERE id=$1 FOR UPDATE',
          [command.planId],
        );
        const plan = result.rows[0];
        if (!plan) return rejection<PlanSummary>("PLAN_NOT_FOUND");
        if (plan.status === command.targetStatus)
          return { kind: "OK", changed: false, value: mapPlan(plan) };
        if (plan.status !== command.expectedStatus)
          return rejection<PlanSummary>("PLAN_STATUS_STALE");
        const published = await q.query<{ exists: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM plan_revisions WHERE plan_id=$1 AND state='PUBLISHED') AS exists",
          [plan.id],
        );
        const transition = validatePlanStatusTransition(
          plan.status,
          command.targetStatus,
          published.rows[0]?.exists ?? false,
        );
        if (transition) return rejection<PlanSummary>(transition);
        const updatedAt = clock();
        const updated = await q.query<PlanRow>(
          'UPDATE plans SET status=$1,updated_at=$2 WHERE id=$3 RETURNING id,code,status,created_at AS "createdAt",updated_at AS "updatedAt"',
          [command.targetStatus, updatedAt, plan.id],
        );
        const value = mapPlan(updated.rows[0]!);
        await audit(q, context, "PLAN_STATUS_CHANGED", "PLAN", plan.id, {
          planCode: plan.code,
          fromStatus: plan.status,
          toStatus: value.status,
        });
        return { kind: "OK", changed: true, value };
      });
    },

    async createEntitlementDefinition(rawCommand, rawContext) {
      const command =
        CreateEntitlementDefinitionCommandSchema.parse(rawCommand);
      const context = PlanMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        await lock(q, `p4-entitlement-definition:${command.entitlementKey}`);
        const existing = await loadDefinition(
          q,
          command.entitlementKey,
          "SHARE",
        );
        if (existing)
          return rejection<EntitlementDefinition>(
            "ENTITLEMENT_DEFINITION_CONFLICT",
          );
        const inserted = await q.query<DefinitionRow>(
          'INSERT INTO entitlement_definitions(entitlement_key,value_type,security_classification,description) VALUES($1,$2,$3,$4) RETURNING entitlement_key AS "entitlementKey",value_type AS "valueType",security_classification AS "securityClassification",description,deprecated_at AS "deprecatedAt",created_at AS "createdAt"',
          [
            command.entitlementKey,
            command.valueType,
            command.securityClassification,
            command.description,
          ],
        );
        const value = mapDefinition(inserted.rows[0]!);
        await audit(
          q,
          context,
          "ENTITLEMENT_DEFINITION_CREATED",
          "ENTITLEMENT_DEFINITION",
          null,
          {
            entitlementKey: value.entitlementKey,
            valueType: value.valueType,
            securityClassification: value.securityClassification,
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async updateEntitlementDefinitionDescription(rawCommand, rawContext) {
      const command =
        UpdateEntitlementDefinitionDescriptionCommandSchema.parse(rawCommand);
      const context = PlanMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const definition = await loadDefinition(
          q,
          command.entitlementKey,
          "UPDATE",
        );
        if (!definition)
          return rejection<EntitlementDefinition>(
            "ENTITLEMENT_DEFINITION_NOT_FOUND",
          );
        if (definition.description === command.newDescription)
          return {
            kind: "OK",
            changed: false,
            value: mapDefinition(definition),
          };
        if (definition.description !== command.expectedDescription)
          return rejection<EntitlementDefinition>(
            "ENTITLEMENT_DEFINITION_STALE",
          );
        const updated = await q.query<DefinitionRow>(
          'UPDATE entitlement_definitions SET description=$1 WHERE entitlement_key=$2 RETURNING entitlement_key AS "entitlementKey",value_type AS "valueType",security_classification AS "securityClassification",description,deprecated_at AS "deprecatedAt",created_at AS "createdAt"',
          [command.newDescription, command.entitlementKey],
        );
        const value = mapDefinition(updated.rows[0]!);
        await audit(
          q,
          context,
          "ENTITLEMENT_DEFINITION_DESCRIPTION_UPDATED",
          "ENTITLEMENT_DEFINITION",
          null,
          {
            entitlementKey: value.entitlementKey,
            changedFields: ["description"],
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async deprecateEntitlementDefinition(rawCommand, rawContext) {
      const command =
        DeprecateEntitlementDefinitionCommandSchema.parse(rawCommand);
      const context = PlanMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const definition = await loadDefinition(
          q,
          command.entitlementKey,
          "UPDATE",
        );
        if (!definition)
          return rejection<EntitlementDefinition>(
            "ENTITLEMENT_DEFINITION_NOT_FOUND",
          );
        if (definition.deprecatedAt)
          return {
            kind: "OK",
            changed: false,
            value: mapDefinition(definition),
          };
        const deprecatedAt = clock();
        const updated = await q.query<DefinitionRow>(
          'UPDATE entitlement_definitions SET deprecated_at=$1 WHERE entitlement_key=$2 RETURNING entitlement_key AS "entitlementKey",value_type AS "valueType",security_classification AS "securityClassification",description,deprecated_at AS "deprecatedAt",created_at AS "createdAt"',
          [deprecatedAt, command.entitlementKey],
        );
        const value = mapDefinition(updated.rows[0]!);
        await audit(
          q,
          context,
          "ENTITLEMENT_DEFINITION_DEPRECATED",
          "ENTITLEMENT_DEFINITION",
          null,
          {
            entitlementKey: value.entitlementKey,
            deprecatedAt: value.deprecatedAt?.toISOString(),
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },
  };
}
