import {
  ClearAccountEntitlementOverrideCommandSchema,
  ResolveCommercialEntitlementInputSchema,
  ResolveCommercialEntitlementsInputSchema,
  SetAccountEntitlementOverrideCommandSchema,
  type AccountEntitlementOverride,
  type AccountEntitlementOverrideCommandResult,
  type AccountEntitlementOverrideFailureCode,
  type ClearAccountEntitlementOverrideCommand,
  type CommercialEntitlementResolution,
  type CommercialEntitlementResolver,
  type AccountEntitlementOverrideMutationPort,
  type SetAccountEntitlementOverrideCommand,
} from "@product/entitlements";
import {
  PlanMutationContextSchema,
  TypedEntitlementValueSchema,
  type EntitlementValueType,
  type PlanMutationContext,
  type TypedEntitlementValue,
} from "@product/plans";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { safeAuditReason } from "./safe-audit.js";

type Query = Pick<DatabaseQuery, "query">;
type OverrideRow = {
  id: string;
  accountId: string;
  entitlementKey: string;
  revision: number | string;
  operation: "SET" | "CLEAR";
  booleanValue: boolean | null;
  integerValue: number | string | null;
  effectiveFrom: Date;
  expiresAt: Date | null;
  reason: string;
  createdAt: Date;
};
type DefinitionRow = {
  entitlementKey: string;
  valueType: EntitlementValueType;
  securityClassification: "CAPABILITY" | "LIMIT";
  deprecatedAt: Date | null;
};
type ResolutionRow = DefinitionRow & {
  basePlanRevisionId: string | null;
  baseBooleanValue: boolean | null;
  baseIntegerValue: number | string | null;
  overrideId: string | null;
  overrideRevision: number | string | null;
  overrideOperation: "SET" | "CLEAR" | null;
  overrideBooleanValue: boolean | null;
  overrideIntegerValue: number | string | null;
  overrideEffectiveFrom: Date | null;
  overrideExpiresAt: Date | null;
};
type PlanRow = {
  planId: string;
  planCode: string;
  planRevisionId: string;
  planRevisionNumber: number | string;
  state: "DRAFT" | "PUBLISHED";
};

const rejection = <T>(code: AccountEntitlementOverrideFailureCode) =>
  ({ kind: "REJECTED", code }) as T;

async function advisoryLock(q: Query, key: string): Promise<void> {
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

async function audit(
  q: Query,
  context: PlanMutationContext,
  action: string,
  accountId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await q.query(
    "INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES($1,$2,$3,'ACCOUNT',$4,$5,$6,$7::jsonb)",
    [
      context.actorType,
      context.actorId ?? null,
      action,
      accountId,
      context.correlationId,
      safeAuditReason(context.reason),
      JSON.stringify(metadata),
    ],
  );
}

function safeInteger(value: number | string, message: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) throw new Error(message);
  return numeric;
}

function overrideValue(row: {
  operation: "SET" | "CLEAR";
  booleanValue: boolean | null;
  integerValue: number | string | null;
}): TypedEntitlementValue | null {
  if (row.operation === "CLEAR") {
    if (row.booleanValue !== null || row.integerValue !== null)
      throw new Error("P4_OVERRIDE_CLEAR_VALUE_CORRUPTION");
    return null;
  }
  if (row.booleanValue !== null && row.integerValue === null)
    return { kind: "BOOLEAN", value: row.booleanValue };
  if (row.booleanValue === null && row.integerValue !== null)
    return {
      kind: "INTEGER",
      value: safeInteger(row.integerValue, "P4_OVERRIDE_INTEGER_UNSAFE"),
    };
  throw new Error("P4_OVERRIDE_VALUE_CORRUPTION");
}

function typedValue(
  valueType: EntitlementValueType,
  booleanValue: boolean | null,
  integerValue: number | string | null,
  source: string,
): TypedEntitlementValue | null {
  if (valueType === "BOOLEAN") {
    if (booleanValue === null || integerValue !== null)
      throw new Error(`${source}_BOOLEAN_VALUE_CORRUPTION`);
    return TypedEntitlementValueSchema.parse({
      kind: "BOOLEAN",
      value: booleanValue,
    });
  }
  if (booleanValue !== null || integerValue === null)
    throw new Error(`${source}_INTEGER_VALUE_CORRUPTION`);
  return TypedEntitlementValueSchema.parse({
    kind: "INTEGER",
    value: safeInteger(integerValue, `${source}_INTEGER_UNSAFE`),
  });
}

function mapOverride(row: OverrideRow): AccountEntitlementOverride {
  const revision = safeInteger(row.revision, "P4_OVERRIDE_REVISION_UNSAFE");
  if (revision < 1) throw new Error("P4_OVERRIDE_REVISION_INVALID");
  return {
    id: row.id,
    accountId: row.accountId,
    entitlementKey: row.entitlementKey,
    revision,
    operation: row.operation,
    value: overrideValue(row),
    effectiveFrom: row.effectiveFrom,
    expiresAt: row.expiresAt,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

async function latestOverride(
  q: Query,
  accountId: string,
  entitlementKey: string,
  lockRow: boolean,
): Promise<OverrideRow | undefined> {
  const result = await q.query<OverrideRow>(
    `SELECT id,account_id AS "accountId",entitlement_key AS "entitlementKey",revision,operation,
            boolean_value AS "booleanValue",integer_value AS "integerValue",
            effective_from AS "effectiveFrom",expires_at AS "expiresAt",reason,created_at AS "createdAt"
       FROM account_entitlement_overrides
      WHERE account_id=$1 AND entitlement_key=$2
      ORDER BY revision DESC LIMIT 1${lockRow ? " FOR UPDATE" : ""}`,
    [accountId, entitlementKey],
  );
  return result.rows[0];
}

async function loadDefinition(
  q: Query,
  entitlementKey: string,
): Promise<DefinitionRow | undefined> {
  const result = await q.query<DefinitionRow>(
    'SELECT entitlement_key AS "entitlementKey",value_type AS "valueType",security_classification AS "securityClassification",deprecated_at AS "deprecatedAt" FROM entitlement_definitions WHERE entitlement_key=$1 FOR SHARE',
    [entitlementKey],
  );
  return result.rows[0];
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function sameSemanticOverride(
  current: AccountEntitlementOverride,
  operation: "SET" | "CLEAR",
  value: TypedEntitlementValue | null,
  effectiveFrom: Date,
  expiresAt: Date | null,
): boolean {
  return (
    current.operation === operation &&
    current.value?.kind === value?.kind &&
    current.value?.value === value?.value &&
    sameDate(current.effectiveFrom, effectiveFrom) &&
    sameDate(current.expiresAt, expiresAt)
  );
}

function resolveRow(
  row: ResolutionRow,
  plan: PlanRow,
  at: Date,
): CommercialEntitlementResolution {
  const baseValue =
    row.basePlanRevisionId === null
      ? null
      : typedValue(
          row.valueType,
          row.baseBooleanValue,
          row.baseIntegerValue,
          "P4_PLAN",
        );
  const hasOverride = row.overrideId !== null;
  let selectedOverride: CommercialEntitlementResolution["selectedOverride"] =
    null;
  let effectiveValue = baseValue;
  let source: CommercialEntitlementResolution["source"] = baseValue
    ? "PLAN_REVISION"
    : "NONE";
  let reason: CommercialEntitlementResolution["reason"] = baseValue
    ? "PLAN_VALUE"
    : "UNSET";

  if (hasOverride) {
    if (
      row.overrideRevision === null ||
      row.overrideOperation === null ||
      row.overrideEffectiveFrom === null
    )
      throw new Error("P4_OVERRIDE_METADATA_CORRUPTION");
    const revision = safeInteger(
      row.overrideRevision,
      "P4_OVERRIDE_REVISION_UNSAFE",
    );
    const expired =
      row.overrideExpiresAt !== null && at >= row.overrideExpiresAt;
    const state = expired
      ? "EXPIRED"
      : row.overrideOperation === "SET"
        ? "ACTIVE_SET"
        : "ACTIVE_CLEAR";
    selectedOverride = {
      overrideId: row.overrideId!,
      overrideRevision: revision,
      operation: row.overrideOperation,
      effectiveFrom: row.overrideEffectiveFrom,
      expiresAt: row.overrideExpiresAt,
      state,
    };
    if (expired) {
      source = baseValue ? "PLAN_REVISION" : "NONE";
      reason = "ACCOUNT_OVERRIDE_EXPIRED_TO_PLAN";
    } else if (row.overrideOperation === "CLEAR") {
      source = baseValue ? "PLAN_REVISION" : "NONE";
      reason = "ACCOUNT_OVERRIDE_CLEAR_TO_PLAN";
    } else {
      effectiveValue = typedValue(
        row.valueType,
        row.overrideBooleanValue,
        row.overrideIntegerValue,
        "P4_OVERRIDE",
      );
      source = "ACCOUNT_OVERRIDE";
      reason = "ACCOUNT_OVERRIDE_SET";
    }
  }
  return {
    entitlementKey: row.entitlementKey,
    definition: {
      valueType: row.valueType,
      securityClassification: row.securityClassification,
      deprecatedAt: row.deprecatedAt,
    },
    plan: {
      planId: plan.planId,
      planCode: plan.planCode,
      planRevisionId: plan.planRevisionId,
      planRevisionNumber: safeInteger(
        plan.planRevisionNumber,
        "P4_PLAN_REVISION_UNSAFE",
      ),
      baseValue,
    },
    selectedOverride,
    effectiveValue,
    source,
    reason,
  };
}

async function beginCoherentSnapshot(q: Query): Promise<void> {
  await q.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
}

async function loadPlanRevision(
  q: Query,
  accountId: string,
  planRevisionId: string,
): Promise<PlanRow | AccountEntitlementOverrideFailureCode> {
  const account = await q.query<{ id: string }>(
    "SELECT id FROM accounts WHERE id=$1",
    [accountId],
  );
  if (!account.rows[0]) return "ACCOUNT_NOT_FOUND";
  const result = await q.query<PlanRow>(
    `SELECT p.id AS "planId",p.code,r.id AS "planRevisionId",r.revision AS "planRevisionNumber",r.state
       FROM plan_revisions r JOIN plans p ON p.id=r.plan_id WHERE r.id=$1`,
    [planRevisionId],
  );
  const row = result.rows[0];
  if (!row) return "PLAN_REVISION_NOT_FOUND";
  if (row.state !== "PUBLISHED") return "PLAN_REVISION_NOT_PUBLISHED";
  return row;
}

async function resolutionRows(
  q: Query,
  accountId: string,
  planRevisionId: string,
  at: Date,
  key?: string,
): Promise<ResolutionRow[]> {
  const result = await q.query<ResolutionRow>(
    `SELECT ed.entitlement_key AS "entitlementKey",ed.value_type AS "valueType",
            ed.security_classification AS "securityClassification",ed.deprecated_at AS "deprecatedAt",
            pe.plan_revision_id AS "basePlanRevisionId",pe.boolean_value AS "baseBooleanValue",pe.integer_value AS "baseIntegerValue",
            ao.id AS "overrideId",ao.revision AS "overrideRevision",ao.operation AS "overrideOperation",
            ao.boolean_value AS "overrideBooleanValue",ao.integer_value AS "overrideIntegerValue",
            ao.effective_from AS "overrideEffectiveFrom",ao.expires_at AS "overrideExpiresAt"
       FROM entitlement_definitions ed
       LEFT JOIN plan_entitlements pe
         ON pe.plan_revision_id=$2 AND pe.entitlement_key=ed.entitlement_key
       LEFT JOIN LATERAL (
         SELECT id,revision,operation,boolean_value,integer_value,effective_from,expires_at
           FROM account_entitlement_overrides
          WHERE account_id=$1 AND entitlement_key=ed.entitlement_key AND effective_from <= $3
          ORDER BY revision DESC LIMIT 1
       ) ao ON true
      ${key ? "WHERE ed.entitlement_key=$4" : ""}
      ORDER BY ed.entitlement_key`,
    key
      ? [accountId, planRevisionId, at, key]
      : [accountId, planRevisionId, at],
  );
  return result.rows;
}

export function createP4EntitlementRepository(
  runtime: DatabaseRuntime,
  options: { beforeMutation?: (tx: DatabaseQuery) => Promise<void> } = {},
): AccountEntitlementOverrideMutationPort & CommercialEntitlementResolver {
  const mutate = async (
    rawCommand: unknown,
    rawContext: unknown,
    operation: "SET" | "CLEAR",
  ): Promise<AccountEntitlementOverrideCommandResult> => {
    const command:
      | SetAccountEntitlementOverrideCommand
      | ClearAccountEntitlementOverrideCommand =
      operation === "SET"
        ? SetAccountEntitlementOverrideCommandSchema.parse(rawCommand)
        : ClearAccountEntitlementOverrideCommandSchema.parse(rawCommand);
    const context = PlanMutationContextSchema.parse(rawContext);
    return runtime.transaction(async (q) => {
      await options.beforeMutation?.(q);
      const accountId = command.accountId;
      await advisoryLock(
        q,
        `p4-account-entitlement:${accountId}:${command.entitlementKey}`,
      );
      const account = await q.query<{ id: string }>(
        "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
        [accountId],
      );
      if (!account.rows[0])
        return rejection<AccountEntitlementOverrideCommandResult>(
          "ACCOUNT_NOT_FOUND",
        );
      const currentRow = await latestOverride(
        q,
        accountId,
        command.entitlementKey,
        true,
      );
      const actualRevision = currentRow
        ? safeInteger(currentRow.revision, "P4_OVERRIDE_REVISION_UNSAFE")
        : null;
      if (actualRevision !== command.expectedLatestRevision)
        return rejection<AccountEntitlementOverrideCommandResult>(
          "ACCOUNT_ENTITLEMENT_OVERRIDE_STALE",
        );
      const definition = await loadDefinition(q, command.entitlementKey);
      if (!definition)
        return rejection<AccountEntitlementOverrideCommandResult>(
          "ENTITLEMENT_DEFINITION_NOT_FOUND",
        );
      if (operation === "SET" && definition.deprecatedAt)
        return rejection<AccountEntitlementOverrideCommandResult>(
          "ENTITLEMENT_DEPRECATED",
        );
      const setValue =
        operation === "SET"
          ? (command as SetAccountEntitlementOverrideCommand).value
          : null;
      if (operation === "SET" && definition.valueType !== setValue?.kind)
        return rejection<AccountEntitlementOverrideCommandResult>(
          "ENTITLEMENT_TYPE_MISMATCH",
        );
      const value = setValue;
      if (
        currentRow &&
        sameSemanticOverride(
          mapOverride(currentRow),
          operation,
          value,
          command.effectiveFrom,
          command.expiresAt,
        )
      )
        return {
          kind: "OK",
          changed: false,
          value: mapOverride(currentRow),
        };
      const revision = (actualRevision ?? 0) + 1;
      const inserted = await q.query<OverrideRow>(
        `INSERT INTO account_entitlement_overrides
           (account_id,entitlement_key,revision,operation,boolean_value,integer_value,effective_from,expires_at,reason)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id,account_id AS "accountId",entitlement_key AS "entitlementKey",revision,operation,
                   boolean_value AS "booleanValue",integer_value AS "integerValue",effective_from AS "effectiveFrom",
                   expires_at AS "expiresAt",reason,created_at AS "createdAt"`,
        [
          accountId,
          command.entitlementKey,
          revision,
          operation,
          setValue?.kind === "BOOLEAN" ? setValue.value : null,
          setValue?.kind === "INTEGER" ? setValue.value : null,
          command.effectiveFrom,
          command.expiresAt,
          context.reason,
        ],
      );
      const valueResult = mapOverride(inserted.rows[0]!);
      await audit(
        q,
        context,
        operation === "SET"
          ? "ACCOUNT_ENTITLEMENT_OVERRIDE_SET"
          : "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED",
        accountId,
        {
          entitlementKey: command.entitlementKey,
          overrideRevision: revision,
          operation,
          valueType: setValue?.kind ?? definition.valueType,
          effectiveFrom: command.effectiveFrom.toISOString(),
          expiresAt: command.expiresAt?.toISOString() ?? null,
        },
      );
      return { kind: "OK", changed: true, value: valueResult };
    });
  };

  return {
    setAccountEntitlementOverride: (command, context) =>
      mutate(command, context, "SET"),
    clearAccountEntitlementOverride: (command, context) =>
      mutate(command, context, "CLEAR"),
    async resolveCommercialEntitlement(rawInput) {
      const input = ResolveCommercialEntitlementInputSchema.parse(rawInput);
      return runtime.transaction(async (q) => {
        await beginCoherentSnapshot(q);
        const plan = await loadPlanRevision(
          q,
          input.accountId,
          input.planRevisionId,
        );
        if (typeof plan === "string")
          return { kind: "REJECTED" as const, code: plan };
        const rows = await resolutionRows(
          q,
          input.accountId,
          input.planRevisionId,
          input.at,
          input.entitlementKey,
        );
        if (rows.length === 0)
          return { kind: "REJECTED", code: "ENTITLEMENT_DEFINITION_NOT_FOUND" };
        return { kind: "OK", value: resolveRow(rows[0]!, plan, input.at) };
      });
    },
    async resolveCommercialEntitlements(rawInput) {
      const input = ResolveCommercialEntitlementsInputSchema.parse(rawInput);
      return runtime.transaction(async (q) => {
        await beginCoherentSnapshot(q);
        const plan = await loadPlanRevision(
          q,
          input.accountId,
          input.planRevisionId,
        );
        if (typeof plan === "string")
          return { kind: "REJECTED" as const, code: plan };
        const rows = await resolutionRows(
          q,
          input.accountId,
          input.planRevisionId,
          input.at,
        );
        return {
          kind: "OK",
          value: rows.map((row) => resolveRow(row, plan, input.at)),
        };
      });
    },
  };
}
