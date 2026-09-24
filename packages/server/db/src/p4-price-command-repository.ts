import {
  ChangePriceStatusCommandSchema,
  CreateDraftPriceRevisionCommandSchema,
  CreatePriceCommandSchema,
  PriceMutationContextSchema,
  PriceResolutionResult,
  PriceCommandRepository,
  PriceCommandResult,
  PriceFailureCode,
  PriceRevisionDraft,
  PriceSaleAssignment,
  PriceStatus,
  PriceSummary,
  PublishPriceRevisionCommandSchema,
  ResolvePriceForNewSaleCommandSchema,
  SchedulePriceSaleAssignmentCommandSchema,
  UpdateDraftPriceRevisionCommandSchema,
  computeP4PriceRevisionContentFingerprintV1,
  validatePriceStatusTransition,
  type BillingIntervalUnit,
  type PriceMutationContext,
  type PublishedPriceRevision,
} from "@product/pricing";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { safeAuditReason } from "./safe-audit.js";

type Query = Pick<DatabaseQuery, "query">;

type PriceRow = {
  id: string;
  planId: string;
  code: string;
  marketKey: string;
  channelKey: string;
  status: PriceStatus;
  createdAt: Date;
  updatedAt: Date;
};

type PriceRevisionRow = {
  id: string;
  priceId: string;
  planRevisionId: string;
  revision: number;
  state: "DRAFT" | "PUBLISHED";
  amountMinor: number | string;
  currency: string;
  billingIntervalUnit: BillingIntervalUnit;
  billingIntervalCount: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
  publishedAt: Date | null;
};

type AssignmentRow = {
  id: string;
  priceId: string;
  assignmentRevision: number;
  selectedPriceRevisionId: string | null;
  effectiveFrom: Date;
  reason: string;
  createdAt: Date;
};

type PriceRevisionJoinRow = PriceRow & {
  revisionId: string;
  revisionPriceId: string;
  planRevisionId: string;
  revision: number;
  state: "DRAFT" | "PUBLISHED";
  amountMinor: number | string;
  currency: string;
  billingIntervalUnit: BillingIntervalUnit;
  billingIntervalCount: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  revisionCreatedAt: Date;
  publishedAt: Date | null;
};

type PriceRevisionWithPlan = PriceRevisionRow & {
  planId: string;
  priceStatus: PriceStatus;
  planStatus: PriceStatus | "DRAFT";
};

const rejection = <T>(code: PriceFailureCode): PriceCommandResult<T> => ({
  kind: "REJECTED",
  code,
});

function safeInteger(value: number | string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("P4_PRICE_AMOUNT_UNSAFE");
  return number;
}

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("P4_PRICE_TIMESTAMP_INVALID");
  return new Date(date.getTime());
}

function mapPrice(row: PriceRow): PriceSummary {
  return {
    id: row.id,
    planId: row.planId,
    code: row.code,
    marketKey: row.marketKey,
    channelKey: row.channelKey,
    status: row.status,
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  };
}

function normalizedRevision(row: PriceRevisionRow): PriceRevisionRow {
  return {
    ...row,
    amountMinor: safeInteger(row.amountMinor),
    effectiveFrom: asDate(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? asDate(row.effectiveTo) : null,
    createdAt: asDate(row.createdAt),
    publishedAt: row.publishedAt ? asDate(row.publishedAt) : null,
  };
}

function draftValue(row: PriceRevisionRow): PriceRevisionDraft {
  const normalized = normalizedRevision(row);
  return {
    id: normalized.id,
    priceId: normalized.priceId,
    planRevisionId: normalized.planRevisionId,
    revision: normalized.revision,
    state: "DRAFT",
    amountMinor: Number(normalized.amountMinor),
    currency: normalized.currency,
    billingIntervalUnit: normalized.billingIntervalUnit,
    billingIntervalCount: normalized.billingIntervalCount,
    effectiveFrom: normalized.effectiveFrom,
    effectiveTo: normalized.effectiveTo,
    createdAt: normalized.createdAt,
    contentFingerprintSha256: computeP4PriceRevisionContentFingerprintV1({
      id: normalized.id,
      priceId: normalized.priceId,
      planRevisionId: normalized.planRevisionId,
      revision: normalized.revision,
      amountMinor: Number(normalized.amountMinor),
      currency: normalized.currency,
      billingIntervalUnit: normalized.billingIntervalUnit,
      billingIntervalCount: normalized.billingIntervalCount,
      effectiveFrom: normalized.effectiveFrom,
      effectiveTo: normalized.effectiveTo,
    }),
  };
}

function publishedValue(row: PriceRevisionRow): PublishedPriceRevision {
  const normalized = normalizedRevision(row);
  if (!normalized.publishedAt)
    throw new Error("P4_PUBLISHED_PRICE_TIMESTAMP_MISSING");
  return {
    ...draftValue(normalized),
    state: "PUBLISHED",
    publishedAt: normalized.publishedAt,
  };
}

function mapAssignment(row: AssignmentRow): PriceSaleAssignment {
  return {
    id: row.id,
    priceId: row.priceId,
    assignmentRevision: row.assignmentRevision,
    selectedPriceRevisionId: row.selectedPriceRevisionId,
    effectiveFrom: asDate(row.effectiveFrom),
    reason: row.reason,
    createdAt: asDate(row.createdAt),
  };
}

async function lock(q: Query, key: string): Promise<void> {
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

async function audit(
  q: Query,
  context: PriceMutationContext,
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

async function findPricePlanId(
  q: Query,
  priceId: string,
): Promise<string | undefined> {
  const result = await q.query<{ planId: string }>(
    'SELECT plan_id AS "planId" FROM prices WHERE id=$1',
    [priceId],
  );
  return result.rows[0]?.planId;
}

async function lockPriceAggregate(
  q: Query,
  priceId: string,
): Promise<string | undefined> {
  const planId = await findPricePlanId(q, priceId);
  if (!planId) return undefined;
  await lock(q, `p4-plan:${planId}`);
  await lock(q, `p4-price:${priceId}`);
  return planId;
}

async function loadPrice(
  q: Query,
  priceId: string,
  lockRow: boolean,
): Promise<PriceRow | undefined> {
  const result = await q.query<PriceRow>(
    `SELECT id,plan_id AS "planId",code,market_key AS "marketKey",channel_key AS "channelKey",status,created_at AS "createdAt",updated_at AS "updatedAt"
       FROM prices WHERE id=$1${lockRow ? " FOR UPDATE" : ""}`,
    [priceId],
  );
  const row = result.rows[0];
  return row
    ? {
        ...row,
        createdAt: asDate(row.createdAt),
        updatedAt: asDate(row.updatedAt),
      }
    : undefined;
}

async function loadRevision(
  q: Query,
  priceRevisionId: string,
  lockRow: boolean,
): Promise<{ price: PriceRow; revision: PriceRevisionRow } | undefined> {
  const result = await q.query<PriceRevisionJoinRow>(
    `SELECT p.id AS "id",p.plan_id AS "planId",p.code,p.market_key AS "marketKey",p.channel_key AS "channelKey",p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt",
            r.id AS "revisionId",r.price_id AS "revisionPriceId",r.plan_revision_id AS "planRevisionId",r.revision,r.state,r.amount_minor AS "amountMinor",r.currency,
            r.billing_interval_unit AS "billingIntervalUnit",r.billing_interval_count AS "billingIntervalCount",r.effective_from AS "effectiveFrom",r.effective_to AS "effectiveTo",
            r.created_at AS "revisionCreatedAt",r.published_at AS "publishedAt"
       FROM prices p JOIN price_revisions r ON r.price_id=p.id WHERE r.id=$1${lockRow ? " FOR UPDATE OF r" : ""}`,
    [priceRevisionId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    price: {
      id: row.id,
      planId: row.planId,
      code: row.code,
      marketKey: row.marketKey,
      channelKey: row.channelKey,
      status: row.status,
      createdAt: asDate(row.createdAt),
      updatedAt: asDate(row.updatedAt),
    },
    revision: normalizedRevision({
      id: row.revisionId,
      priceId: row.revisionPriceId,
      planRevisionId: row.planRevisionId,
      revision: row.revision,
      state: row.state,
      amountMinor: row.amountMinor,
      currency: row.currency,
      billingIntervalUnit: row.billingIntervalUnit,
      billingIntervalCount: row.billingIntervalCount,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      createdAt: row.revisionCreatedAt,
      publishedAt: row.publishedAt,
    }),
  };
}

async function loadRevisionForPlan(
  q: Query,
  priceRevisionId: string,
  lockRow: boolean,
): Promise<PriceRevisionWithPlan | undefined> {
  const result = await q.query<PriceRevisionWithPlan>(
    `SELECT r.id,r.price_id AS "priceId",r.plan_revision_id AS "planRevisionId",r.revision,r.state,r.amount_minor AS "amountMinor",r.currency,
            r.billing_interval_unit AS "billingIntervalUnit",r.billing_interval_count AS "billingIntervalCount",r.effective_from AS "effectiveFrom",r.effective_to AS "effectiveTo",
            r.created_at AS "createdAt",r.published_at AS "publishedAt",p.plan_id AS "planId",p.status AS "priceStatus",pl.status AS "planStatus"
       FROM price_revisions r JOIN prices p ON p.id=r.price_id JOIN plans pl ON pl.id=p.plan_id WHERE r.id=$1${lockRow ? " FOR UPDATE OF r" : ""}`,
    [priceRevisionId],
  );
  const row = result.rows[0];
  return row
    ? ({
        ...normalizedRevision(row),
        planId: row.planId,
        priceStatus: row.priceStatus,
        planStatus: row.planStatus,
      } as PriceRevisionWithPlan)
    : undefined;
}

async function planRevisionBelongsToPlan(
  q: Query,
  planRevisionId: string,
  planId: string,
  lockRow: boolean,
): Promise<{ state: "DRAFT" | "PUBLISHED" } | "MISMATCH" | undefined> {
  const result = await q.query<{
    planId: string;
    state: "DRAFT" | "PUBLISHED";
  }>(
    `SELECT plan_id AS "planId",state FROM plan_revisions WHERE id=$1${lockRow ? " FOR SHARE" : ""}`,
    [planRevisionId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  if (row.planId !== planId) return "MISMATCH";
  return { state: row.state };
}

export function createP4PriceCommandRepository(
  runtime: DatabaseRuntime,
  options: {
    clock?: () => Date;
    beforeMutation?: (tx: DatabaseQuery) => Promise<void>;
  } = {},
): PriceCommandRepository {
  const clock = options.clock ?? (() => new Date());

  return {
    async createPrice(rawCommand, rawContext) {
      const command = CreatePriceCommandSchema.parse(rawCommand);
      const context = PriceMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        await lock(q, `p4-plan:${command.planId}`);
        const plan = await q.query<{
          id: string;
          status: "DRAFT" | "ACTIVE" | "HIDDEN" | "ARCHIVED";
        }>("SELECT id,status FROM plans WHERE id=$1 FOR UPDATE", [
          command.planId,
        ]);
        if (!plan.rows[0])
          return rejection<PriceSummary>("PRICE_PLAN_NOT_FOUND");
        if (plan.rows[0].status === "ARCHIVED")
          return rejection<PriceSummary>("PRICE_PLAN_ARCHIVED");
        await lock(q, `p4-price-code:${command.code}`);
        const existing = await q.query<{ id: string }>(
          "SELECT id FROM prices WHERE code=$1",
          [command.code],
        );
        if (existing.rows[0])
          return rejection<PriceSummary>("PRICE_CODE_CONFLICT");
        const inserted = await q.query<PriceRow>(
          'INSERT INTO prices(plan_id,code,market_key,channel_key) VALUES($1,$2,$3,$4) RETURNING id,plan_id AS "planId",code,market_key AS "marketKey",channel_key AS "channelKey",status,created_at AS "createdAt",updated_at AS "updatedAt"',
          [command.planId, command.code, command.marketKey, command.channelKey],
        );
        const value = mapPrice(inserted.rows[0]!);
        await audit(q, context, "PRICE_CREATED", "PRICE", value.id, {
          planId: value.planId,
          priceCode: value.code,
          marketKey: value.marketKey,
          channelKey: value.channelKey,
        });
        return { kind: "OK", changed: true, value };
      });
    },

    async createDraftPriceRevision(rawCommand, rawContext) {
      const command = CreateDraftPriceRevisionCommandSchema.parse(rawCommand);
      const context = PriceMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const planId = await lockPriceAggregate(q, command.priceId);
        if (!planId) return rejection<PriceRevisionDraft>("PRICE_NOT_FOUND");
        const price = await loadPrice(q, command.priceId, true);
        if (!price) return rejection<PriceRevisionDraft>("PRICE_NOT_FOUND");
        if (price.status === "ARCHIVED")
          return rejection<PriceRevisionDraft>("PRICE_ARCHIVED");
        const plan = await q.query<{ status: PriceStatus }>(
          "SELECT status FROM plans WHERE id=$1",
          [planId],
        );
        if (plan.rows[0]?.status === "ARCHIVED")
          return rejection<PriceRevisionDraft>("PRICE_PLAN_ARCHIVED");
        const relation = await planRevisionBelongsToPlan(
          q,
          command.planRevisionId,
          planId,
          true,
        );
        if (!relation)
          return rejection<PriceRevisionDraft>("PRICE_PLAN_REVISION_NOT_FOUND");
        if (relation === "MISMATCH")
          return rejection<PriceRevisionDraft>(
            "PRICE_PLAN_REVISION_PLAN_MISMATCH",
          );
        const next = await q.query<{ revision: number }>(
          "SELECT COALESCE(MAX(revision),0)+1 AS revision FROM price_revisions WHERE price_id=$1",
          [command.priceId],
        );
        const inserted = await q.query<PriceRevisionRow>(
          'INSERT INTO price_revisions(price_id,plan_revision_id,revision,amount_minor,currency,billing_interval_unit,billing_interval_count,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,price_id AS "priceId",plan_revision_id AS "planRevisionId",revision,state,amount_minor AS "amountMinor",currency,billing_interval_unit AS "billingIntervalUnit",billing_interval_count AS "billingIntervalCount",effective_from AS "effectiveFrom",effective_to AS "effectiveTo",created_at AS "createdAt",published_at AS "publishedAt"',
          [
            command.priceId,
            command.planRevisionId,
            next.rows[0]!.revision,
            command.amountMinor,
            command.currency,
            command.billingIntervalUnit,
            command.billingIntervalCount,
            command.effectiveFrom,
            command.effectiveTo,
          ],
        );
        const value = draftValue(inserted.rows[0]!);
        await audit(
          q,
          context,
          "PRICE_REVISION_DRAFT_CREATED",
          "PRICE_REVISION",
          value.id,
          {
            priceId: value.priceId,
            planRevisionId: value.planRevisionId,
            revision: value.revision,
            contentFingerprintSha256: value.contentFingerprintSha256,
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async getPriceRevisionDraft(priceRevisionId) {
      const loaded = await loadRevision(runtime, priceRevisionId, false);
      if (!loaded || loaded.revision.state !== "DRAFT") return undefined;
      return draftValue(loaded.revision);
    },

    async getPublishedPriceRevision(priceRevisionId) {
      const loaded = await loadRevision(runtime, priceRevisionId, false);
      if (!loaded || loaded.revision.state !== "PUBLISHED") return undefined;
      return publishedValue(loaded.revision);
    },

    async updateDraftPriceRevision(rawCommand, rawContext) {
      const command = UpdateDraftPriceRevisionCommandSchema.parse(rawCommand);
      const context = PriceMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const initial = await loadRevisionForPlan(
          q,
          command.priceRevisionId,
          false,
        );
        if (!initial)
          return rejection<PriceRevisionDraft>("PRICE_REVISION_NOT_FOUND");
        const planId = await lockPriceAggregate(q, initial.priceId);
        if (!planId) return rejection<PriceRevisionDraft>("PRICE_NOT_FOUND");
        const loaded = await loadRevisionForPlan(
          q,
          command.priceRevisionId,
          true,
        );
        if (!loaded)
          return rejection<PriceRevisionDraft>("PRICE_REVISION_NOT_FOUND");
        if (loaded.state !== "DRAFT")
          return rejection<PriceRevisionDraft>("PRICE_REVISION_NOT_DRAFT");
        if (loaded.priceStatus === "ARCHIVED")
          return rejection<PriceRevisionDraft>("PRICE_ARCHIVED");
        if (loaded.planStatus === "ARCHIVED")
          return rejection<PriceRevisionDraft>("PRICE_PLAN_ARCHIVED");
        const current = draftValue(loaded);
        if (
          current.contentFingerprintSha256 !==
          command.expectedContentFingerprint
        )
          return rejection<PriceRevisionDraft>("PRICE_DRAFT_STALE");

        const nextPlanRevisionId =
          command.planRevisionId ?? current.planRevisionId;
        const nextAmountMinor = command.amountMinor ?? current.amountMinor;
        const nextCurrency = command.currency ?? current.currency;
        const nextBillingIntervalUnit =
          command.billingIntervalUnit ?? current.billingIntervalUnit;
        const nextBillingIntervalCount =
          command.billingIntervalCount ?? current.billingIntervalCount;
        const nextEffectiveFrom =
          command.effectiveFrom ?? current.effectiveFrom;
        const nextEffectiveTo =
          command.effectiveTo === undefined
            ? current.effectiveTo
            : command.effectiveTo;
        if (nextEffectiveTo !== null && nextEffectiveTo <= nextEffectiveFrom)
          throw new Error("P4_PRICE_EFFECTIVE_WINDOW_INVALID");
        const relation = await planRevisionBelongsToPlan(
          q,
          nextPlanRevisionId,
          planId,
          true,
        );
        if (!relation)
          return rejection<PriceRevisionDraft>("PRICE_PLAN_REVISION_NOT_FOUND");
        if (relation === "MISMATCH")
          return rejection<PriceRevisionDraft>(
            "PRICE_PLAN_REVISION_PLAN_MISMATCH",
          );
        const changedFields = [
          ...(nextPlanRevisionId !== current.planRevisionId
            ? ["planRevisionId"]
            : []),
          ...(nextAmountMinor !== current.amountMinor ? ["amountMinor"] : []),
          ...(nextCurrency !== current.currency ? ["currency"] : []),
          ...(nextBillingIntervalUnit !== current.billingIntervalUnit
            ? ["billingIntervalUnit"]
            : []),
          ...(nextBillingIntervalCount !== current.billingIntervalCount
            ? ["billingIntervalCount"]
            : []),
          ...(nextEffectiveFrom.getTime() !== current.effectiveFrom.getTime()
            ? ["effectiveFrom"]
            : []),
          ...((nextEffectiveTo?.getTime() ?? null) !==
          (current.effectiveTo?.getTime() ?? null)
            ? ["effectiveTo"]
            : []),
        ];
        if (changedFields.length === 0)
          return { kind: "OK", changed: false, value: current };
        const updated = await q.query<PriceRevisionRow>(
          'UPDATE price_revisions SET plan_revision_id=$1,amount_minor=$2,currency=$3,billing_interval_unit=$4,billing_interval_count=$5,effective_from=$6,effective_to=$7 WHERE id=$8 RETURNING id,price_id AS "priceId",plan_revision_id AS "planRevisionId",revision,state,amount_minor AS "amountMinor",currency,billing_interval_unit AS "billingIntervalUnit",billing_interval_count AS "billingIntervalCount",effective_from AS "effectiveFrom",effective_to AS "effectiveTo",created_at AS "createdAt",published_at AS "publishedAt"',
          [
            nextPlanRevisionId,
            nextAmountMinor,
            nextCurrency,
            nextBillingIntervalUnit,
            nextBillingIntervalCount,
            nextEffectiveFrom,
            nextEffectiveTo,
            current.id,
          ],
        );
        const value = draftValue(updated.rows[0]!);
        await audit(
          q,
          context,
          "PRICE_REVISION_DRAFT_UPDATED",
          "PRICE_REVISION",
          current.id,
          {
            priceId: current.priceId,
            revision: current.revision,
            changedFields,
            beforeFingerprint: current.contentFingerprintSha256,
            afterFingerprint: value.contentFingerprintSha256,
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async publishPriceRevision(rawCommand, rawContext) {
      const command = PublishPriceRevisionCommandSchema.parse(rawCommand);
      const context = PriceMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const initial = await loadRevisionForPlan(
          q,
          command.priceRevisionId,
          false,
        );
        if (!initial)
          return rejection<PublishedPriceRevision>("PRICE_REVISION_NOT_FOUND");
        const planId = await lockPriceAggregate(q, initial.priceId);
        if (!planId)
          return rejection<PublishedPriceRevision>("PRICE_NOT_FOUND");
        const loaded = await loadRevisionForPlan(
          q,
          command.priceRevisionId,
          true,
        );
        if (!loaded)
          return rejection<PublishedPriceRevision>("PRICE_REVISION_NOT_FOUND");
        if (loaded.state === "PUBLISHED")
          return { kind: "OK", changed: false, value: publishedValue(loaded) };
        if (loaded.priceStatus === "ARCHIVED")
          return rejection<PublishedPriceRevision>("PRICE_ARCHIVED");
        if (loaded.planStatus === "ARCHIVED")
          return rejection<PublishedPriceRevision>("PRICE_PLAN_ARCHIVED");
        const current = draftValue(loaded);
        if (
          current.contentFingerprintSha256 !==
          command.expectedContentFingerprint
        )
          return rejection<PublishedPriceRevision>("PRICE_DRAFT_STALE");
        const relation = await planRevisionBelongsToPlan(
          q,
          current.planRevisionId,
          planId,
          true,
        );
        if (!relation)
          return rejection<PublishedPriceRevision>(
            "PRICE_PLAN_REVISION_NOT_FOUND",
          );
        if (relation === "MISMATCH")
          return rejection<PublishedPriceRevision>(
            "PRICE_PLAN_REVISION_PLAN_MISMATCH",
          );
        if (relation.state !== "PUBLISHED")
          return rejection<PublishedPriceRevision>(
            "PRICE_PLAN_REVISION_NOT_PUBLISHED",
          );
        const publishedAt = asDate(clock());
        const updated = await q.query<PriceRevisionRow>(
          'UPDATE price_revisions SET state=\'PUBLISHED\',published_at=$1 WHERE id=$2 RETURNING id,price_id AS "priceId",plan_revision_id AS "planRevisionId",revision,state,amount_minor AS "amountMinor",currency,billing_interval_unit AS "billingIntervalUnit",billing_interval_count AS "billingIntervalCount",effective_from AS "effectiveFrom",effective_to AS "effectiveTo",created_at AS "createdAt",published_at AS "publishedAt"',
          [publishedAt, current.id],
        );
        const value = publishedValue(updated.rows[0]!);
        await audit(
          q,
          context,
          "PRICE_REVISION_PUBLISHED",
          "PRICE_REVISION",
          current.id,
          {
            priceId: value.priceId,
            planRevisionId: value.planRevisionId,
            revision: value.revision,
            contentFingerprintSha256: value.contentFingerprintSha256,
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async changePriceStatus(rawCommand, rawContext) {
      const command = ChangePriceStatusCommandSchema.parse(rawCommand);
      const context = PriceMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const planId = await lockPriceAggregate(q, command.priceId);
        if (!planId) return rejection<PriceSummary>("PRICE_NOT_FOUND");
        const price = await loadPrice(q, command.priceId, true);
        if (!price) return rejection<PriceSummary>("PRICE_NOT_FOUND");
        const plan = await q.query<{ status: PriceStatus }>(
          "SELECT status FROM plans WHERE id=$1",
          [planId],
        );
        if (
          plan.rows[0]?.status === "ARCHIVED" &&
          (command.targetStatus === "ACTIVE" ||
            command.targetStatus === "HIDDEN")
        )
          return rejection<PriceSummary>("PRICE_PLAN_ARCHIVED");
        if (price.status === command.targetStatus)
          return { kind: "OK", changed: false, value: mapPrice(price) };
        if (price.status !== command.expectedStatus)
          return rejection<PriceSummary>("PRICE_STATUS_STALE");
        const published = await q.query<{ exists: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM price_revisions WHERE price_id=$1 AND state='PUBLISHED') AS exists",
          [price.id],
        );
        const transition = validatePriceStatusTransition(
          price.status,
          command.targetStatus,
          published.rows[0]?.exists ?? false,
        );
        if (transition) return rejection<PriceSummary>(transition);
        const updatedAt = asDate(clock());
        const updated = await q.query<PriceRow>(
          'UPDATE prices SET status=$1,updated_at=$2 WHERE id=$3 RETURNING id,plan_id AS "planId",code,market_key AS "marketKey",channel_key AS "channelKey",status,created_at AS "createdAt",updated_at AS "updatedAt"',
          [command.targetStatus, updatedAt, price.id],
        );
        const value = mapPrice(updated.rows[0]!);
        await audit(q, context, "PRICE_STATUS_CHANGED", "PRICE", price.id, {
          planId: value.planId,
          priceCode: value.code,
          fromStatus: price.status,
          toStatus: value.status,
        });
        return { kind: "OK", changed: true, value };
      });
    },

    async schedulePriceSaleAssignment(rawCommand, rawContext) {
      const command =
        SchedulePriceSaleAssignmentCommandSchema.parse(rawCommand);
      const context = PriceMutationContextSchema.parse(rawContext);
      return runtime.transaction(async (q) => {
        await options.beforeMutation?.(q);
        const planId = await lockPriceAggregate(q, command.priceId);
        if (!planId) return rejection<PriceSaleAssignment>("PRICE_NOT_FOUND");
        const price = await loadPrice(q, command.priceId, true);
        if (!price) return rejection<PriceSaleAssignment>("PRICE_NOT_FOUND");
        if (price.status === "ARCHIVED")
          return rejection<PriceSaleAssignment>("PRICE_ARCHIVED");
        const plan = await q.query<{ status: PriceStatus }>(
          "SELECT status FROM plans WHERE id=$1",
          [planId],
        );
        if (plan.rows[0]?.status === "ARCHIVED")
          return rejection<PriceSaleAssignment>("PRICE_PLAN_ARCHIVED");
        const latest = await q.query<{ revision: number | null }>(
          "SELECT MAX(assignment_revision) AS revision FROM price_sale_assignments WHERE price_id=$1",
          [price.id],
        );
        const actual = latest.rows[0]?.revision ?? null;
        const expected =
          command.expectedLatestAssignmentRevision === 0
            ? null
            : command.expectedLatestAssignmentRevision;
        if (actual !== expected)
          return rejection<PriceSaleAssignment>("PRICE_ASSIGNMENT_STALE");
        const latestAssignment = await q.query<AssignmentRow>(
          'SELECT id,price_id AS "priceId",assignment_revision AS "assignmentRevision",selected_price_revision_id AS "selectedPriceRevisionId",effective_from AS "effectiveFrom",reason,created_at AS "createdAt" FROM price_sale_assignments WHERE price_id=$1 AND assignment_revision=$2',
          [price.id, actual],
        );
        const latestRow = latestAssignment.rows[0];
        if (
          latestRow &&
          latestRow.selectedPriceRevisionId ===
            command.selectedPriceRevisionId &&
          asDate(latestRow.effectiveFrom).getTime() ===
            command.effectiveFrom.getTime() &&
          latestRow.reason === command.reason
        )
          return {
            kind: "OK",
            changed: false,
            value: mapAssignment(latestRow),
          };
        if (command.selectedPriceRevisionId) {
          const selectedResult = await q.query<PriceRevisionRow>(
            'SELECT id,price_id AS "priceId",plan_revision_id AS "planRevisionId",revision,state,amount_minor AS "amountMinor",currency,billing_interval_unit AS "billingIntervalUnit",billing_interval_count AS "billingIntervalCount",effective_from AS "effectiveFrom",effective_to AS "effectiveTo",created_at AS "createdAt",published_at AS "publishedAt" FROM price_revisions WHERE id=$1 AND price_id=$2 FOR SHARE',
            [command.selectedPriceRevisionId, price.id],
          );
          const selectedRow = selectedResult.rows[0];
          if (!selectedRow)
            return rejection<PriceSaleAssignment>("PRICE_REVISION_NOT_FOUND");
          if (selectedRow.state !== "PUBLISHED")
            return rejection<PriceSaleAssignment>(
              "PRICE_ASSIGNMENT_REVISION_NOT_PUBLISHED",
            );
          const selectedRevision = normalizedRevision(selectedRow);
          if (
            command.effectiveFrom < selectedRevision.effectiveFrom ||
            (selectedRevision.effectiveTo !== null &&
              command.effectiveFrom >= selectedRevision.effectiveTo)
          )
            return rejection<PriceSaleAssignment>(
              "PRICE_ASSIGNMENT_OUTSIDE_REVISION_WINDOW",
            );
        }
        const inserted = await q.query<AssignmentRow>(
          'INSERT INTO price_sale_assignments(price_id,assignment_revision,selected_price_revision_id,effective_from,reason) VALUES($1,$2,$3,$4,$5) RETURNING id,price_id AS "priceId",assignment_revision AS "assignmentRevision",selected_price_revision_id AS "selectedPriceRevisionId",effective_from AS "effectiveFrom",reason,created_at AS "createdAt"',
          [
            price.id,
            (actual ?? 0) + 1,
            command.selectedPriceRevisionId,
            command.effectiveFrom,
            command.reason,
          ],
        );
        const value = mapAssignment(inserted.rows[0]!);
        await audit(
          q,
          context,
          "PRICE_SALE_ASSIGNMENT_SCHEDULED",
          "PRICE",
          price.id,
          {
            planId,
            assignmentRevision: value.assignmentRevision,
            selectedPriceRevisionId: value.selectedPriceRevisionId,
          },
        );
        return { kind: "OK", changed: true, value };
      });
    },

    async resolvePriceForNewSale(rawCommand): Promise<PriceResolutionResult> {
      const command = ResolvePriceForNewSaleCommandSchema.parse(rawCommand);
      return runtime.transaction(async (q) => {
        const priceResult = await q.query<
          PriceRow & { planStatus: "DRAFT" | "ACTIVE" | "HIDDEN" | "ARCHIVED" }
        >(
          'SELECT p.id,p.plan_id AS "planId",p.code,p.market_key AS "marketKey",p.channel_key AS "channelKey",p.status,p.created_at AS "createdAt",p.updated_at AS "updatedAt",pl.status AS "planStatus" FROM prices p JOIN plans pl ON pl.id=p.plan_id WHERE p.id=$1',
          [command.priceId],
        );
        const priceRow = priceResult.rows[0];
        if (!priceRow) return { kind: "REJECTED", code: "PRICE_NOT_FOUND" };
        if (priceRow.planStatus !== "ACTIVE")
          return { kind: "REJECTED", code: "PLAN_NOT_ACTIVE" };
        if (priceRow.status !== "ACTIVE")
          return { kind: "REJECTED", code: "PRICE_NOT_ACTIVE" };
        const at =
          command.at ??
          command.effectiveAt ??
          command.evaluatedAt ??
          asDate(clock());
        const assignmentResult = await q.query<AssignmentRow>(
          'SELECT id,price_id AS "priceId",assignment_revision AS "assignmentRevision",selected_price_revision_id AS "selectedPriceRevisionId",effective_from AS "effectiveFrom",reason,created_at AS "createdAt" FROM price_sale_assignments WHERE price_id=$1 AND effective_from <= $2 ORDER BY assignment_revision DESC LIMIT 1',
          [priceRow.id, at],
        );
        const assignmentRow = assignmentResult.rows[0];
        if (!assignmentRow)
          return { kind: "REJECTED", code: "PRICE_SALE_ASSIGNMENT_NOT_FOUND" };
        const assignment = mapAssignment(assignmentRow);
        if (assignment.selectedPriceRevisionId === null)
          return { kind: "REJECTED", code: "PRICE_SALE_CLOSED" };
        const revisionResult = await q.query<PriceRevisionRow>(
          'SELECT id,price_id AS "priceId",plan_revision_id AS "planRevisionId",revision,state,amount_minor AS "amountMinor",currency,billing_interval_unit AS "billingIntervalUnit",billing_interval_count AS "billingIntervalCount",effective_from AS "effectiveFrom",effective_to AS "effectiveTo",created_at AS "createdAt",published_at AS "publishedAt" FROM price_revisions WHERE id=$1 AND price_id=$2',
          [assignment.selectedPriceRevisionId, priceRow.id],
        );
        const revisionRow = revisionResult.rows[0];
        if (!revisionRow || revisionRow.state !== "PUBLISHED")
          return { kind: "REJECTED", code: "PRICE_REVISION_NOT_FOUND" };
        const revision = normalizedRevision(revisionRow);
        if (
          revision.effectiveFrom > at ||
          (revision.effectiveTo !== null && at >= revision.effectiveTo)
        )
          return { kind: "REJECTED", code: "PRICE_REVISION_EXPIRED" };
        const planRevision = await q.query<{ state: "DRAFT" | "PUBLISHED" }>(
          "SELECT state FROM plan_revisions WHERE id=$1",
          [revision.planRevisionId],
        );
        if (planRevision.rows[0]?.state !== "PUBLISHED")
          return {
            kind: "REJECTED",
            code: "PRICE_PLAN_REVISION_NOT_PUBLISHED",
          };
        return {
          kind: "RESOLVED",
          value: {
            price: mapPrice(priceRow),
            priceRevision: publishedValue(revision),
            assignment,
          },
        };
      });
    },
  };
}
