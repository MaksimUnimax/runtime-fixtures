import {
  ExtendSubscriptionCommandSchema,
  GrantSubscriptionCommandSchema,
  RestoreSubscriptionCommandSchema,
  SubscriptionMutationContextSchema,
  SubscriptionAccessResolver,
  SuspendSubscriptionCommandSchema,
  validateSubscriptionStateTransition,
  type CurrentSubscriptionReader,
  type SubscriptionAccessObservationReader,
  type SubscriptionCommandRepository,
  type SubscriptionCommandResult,
  type SubscriptionFailureCode,
  type SubscriptionMutationContext,
  type SubscriptionSnapshot,
  type SubscriptionState,
} from "@product/subscriptions";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { safeAuditReason } from "./safe-audit.js";

type Query = Pick<DatabaseQuery, "query">;
type Row = {
  id: string;
  accountId: string;
  state: SubscriptionState;
  stateRevision: number | string;
  currentPlanRevisionId: string;
  boundPriceRevisionId: string | null;
  startedAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  graceUntil: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
type TransitionRow = {
  transitionRevision: number | string;
  fromState: SubscriptionState | null;
  toState: SubscriptionState;
};

const rejection = (
  code: SubscriptionFailureCode,
): SubscriptionCommandResult => ({ kind: "REJECTED", code });

function revision(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error("SUBSCRIPTION_CORRUPTED");
  return parsed;
}

function snapshot(row: Row): SubscriptionSnapshot {
  return {
    id: row.id,
    accountId: row.accountId,
    state: row.state,
    stateRevision: revision(row.stateRevision),
    currentPlanRevisionId: row.currentPlanRevisionId,
    boundPriceRevisionId: row.boundPriceRevisionId,
    startedAt: row.startedAt,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    graceUntil: row.graceUntil,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canceledAt: row.canceledAt,
    suspendedAt: row.suspendedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function advisoryLock(q: Query, key: string): Promise<void> {
  await q.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

async function audit(
  q: Query,
  context: SubscriptionMutationContext,
  action: string,
  subscriptionId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await q.query(
    "INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES($1,$2,$3,'SUBSCRIPTION',$4,$5,$6,$7::jsonb)",
    [
      context.actorType,
      context.actorId ?? null,
      action,
      subscriptionId,
      context.correlationId,
      safeAuditReason(context.reason),
      JSON.stringify(metadata),
    ],
  );
}

async function loadSubscription(
  q: Query,
  subscriptionId: string,
  lockRow: boolean,
): Promise<Row | undefined> {
  const result = await q.query<Row>(
    `SELECT id,account_id AS "accountId",state,state_revision AS "stateRevision",
            current_plan_revision_id AS "currentPlanRevisionId",
            bound_price_revision_id AS "boundPriceRevisionId",started_at AS "startedAt",
            current_period_start AS "currentPeriodStart",current_period_end AS "currentPeriodEnd",
            grace_until AS "graceUntil",cancel_at_period_end AS "cancelAtPeriodEnd",
            canceled_at AS "canceledAt",suspended_at AS "suspendedAt",created_at AS "createdAt",
            updated_at AS "updatedAt"
       FROM subscriptions WHERE id=$1${lockRow ? " FOR UPDATE" : ""}`,
    [subscriptionId],
  );
  return result.rows[0];
}

async function nextTransitionRevision(
  q: Query,
  subscriptionId: string,
): Promise<number> {
  const result = await q.query<{ nextRevision: number | string }>(
    `SELECT COALESCE(MAX(transition_revision), 0) + 1 AS "nextRevision"
       FROM subscription_transitions WHERE subscription_id=$1`,
    [subscriptionId],
  );
  return revision(result.rows[0]?.nextRevision ?? 0);
}

async function insertTransition(
  q: Query,
  subscriptionId: string,
  fromState: SubscriptionState | null,
  toState: SubscriptionState,
  context: SubscriptionMutationContext,
  occurredAt: Date,
): Promise<number> {
  const transitionRevision = await nextTransitionRevision(q, subscriptionId);
  await q.query(
    `INSERT INTO subscription_transitions
       (subscription_id,transition_revision,from_state,to_state,source,source_event_id,actor_type,actor_id,reason,occurred_at)
     VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9)`,
    [
      subscriptionId,
      transitionRevision,
      fromState,
      toState,
      context.actorType,
      context.actorType,
      context.actorId ?? null,
      context.reason,
      occurredAt,
    ],
  );
  return transitionRevision;
}

async function accountLock(q: Query, accountId: string): Promise<boolean> {
  await advisoryLock(q, `p5-subscription-account:${accountId}`);
  const result = await q.query<{ id: string }>(
    "SELECT id FROM accounts WHERE id=$1 FOR UPDATE",
    [accountId],
  );
  return Boolean(result.rows[0]);
}

async function subscriptionAccountId(
  runtime: DatabaseRuntime,
  subscriptionId: string,
): Promise<string | undefined> {
  const result = await runtime.query<{ accountId: string }>(
    'SELECT account_id AS "accountId" FROM subscriptions WHERE id=$1',
    [subscriptionId],
  );
  return result.rows[0]?.accountId;
}

export type P5SubscriptionRepository = SubscriptionCommandRepository &
  CurrentSubscriptionReader &
  SubscriptionAccessObservationReader;

export type P5SubscriptionMutationOperation =
  | "GRANT"
  | "EXTEND"
  | "SUSPEND"
  | "RESTORE";

export type P5SubscriptionMutationHook = (input: {
  tx: DatabaseQuery;
  operation: P5SubscriptionMutationOperation;
  accountId: string;
  subscriptionId?: string;
  context: SubscriptionMutationContext;
}) => Promise<void>;

export type P5SubscriptionRepositoryOptions = {
  now?: () => Date;
  beforeMutation?: P5SubscriptionMutationHook;
};

export function createP5SubscriptionRepository(
  runtime: DatabaseRuntime,
  options: P5SubscriptionRepositoryOptions = {},
): P5SubscriptionRepository {
  const now = options.now ?? (() => new Date());
  const beforeMutation = options.beforeMutation;

  async function grantSubscription(
    rawCommand: unknown,
    rawContext: unknown,
  ): Promise<SubscriptionCommandResult> {
    const command = GrantSubscriptionCommandSchema.parse(rawCommand);
    const context = SubscriptionMutationContextSchema.parse(rawContext);
    const capturedNow = now();
    if (!(command.currentPeriodEnd > capturedNow))
      return rejection("SUBSCRIPTION_PERIOD_INVALID");
    return runtime.transaction(async (q) => {
      await beforeMutation?.({
        tx: q,
        operation: "GRANT",
        accountId: command.accountId,
        context,
      });
      if (!(await accountLock(q, command.accountId)))
        return rejection("ACCOUNT_NOT_FOUND");
      const existing = await q.query<{ id: string }>(
        "SELECT id FROM subscriptions WHERE account_id=$1 AND state <> 'EXPIRED' LIMIT 1",
        [command.accountId],
      );
      if (existing.rows[0]) return rejection("SUBSCRIPTION_ALREADY_EXISTS");
      const plan = await q.query<{ id: string }>(
        "SELECT id FROM plan_revisions WHERE id=$1 AND state='PUBLISHED'",
        [command.planRevisionId],
      );
      if (!plan.rows[0]) {
        const anyPlan = await q.query<{ id: string }>(
          "SELECT id FROM plan_revisions WHERE id=$1",
          [command.planRevisionId],
        );
        return anyPlan.rows[0]
          ? rejection("PLAN_REVISION_NOT_PUBLISHED")
          : rejection("PLAN_REVISION_NOT_FOUND");
      }
      const inserted = await q.query<Row>(
        `INSERT INTO subscriptions
           (account_id,state,state_revision,current_plan_revision_id,bound_price_revision_id,started_at,current_period_start,current_period_end,grace_until,cancel_at_period_end,canceled_at,suspended_at,state_reason,created_at,updated_at)
         VALUES($1,'ACTIVE',1,$2,NULL,$3,$3,$4,NULL,false,NULL,NULL,$5,$3,$3)
         RETURNING id,account_id AS "accountId",state,state_revision AS "stateRevision",
                   current_plan_revision_id AS "currentPlanRevisionId",bound_price_revision_id AS "boundPriceRevisionId",
                   started_at AS "startedAt",current_period_start AS "currentPeriodStart",current_period_end AS "currentPeriodEnd",
                   grace_until AS "graceUntil",cancel_at_period_end AS "cancelAtPeriodEnd",canceled_at AS "canceledAt",
                   suspended_at AS "suspendedAt",created_at AS "createdAt",updated_at AS "updatedAt"`,
        [
          command.accountId,
          command.planRevisionId,
          capturedNow,
          command.currentPeriodEnd,
          context.reason,
        ],
      );
      const value = snapshot(inserted.rows[0]!);
      await insertTransition(q, value.id, null, "ACTIVE", context, capturedNow);
      await audit(q, context, "SUBSCRIPTION_GRANTED", value.id, {
        accountId: value.accountId,
        planRevisionId: value.currentPlanRevisionId,
        boundPriceRevisionId: null,
        fromState: null,
        toState: "ACTIVE",
        stateRevision: value.stateRevision,
        transitionRevision: 1,
      });
      return { kind: "OK", changed: true, value };
    });
  }

  async function mutate(
    subscriptionId: string,
    rawContext: unknown,
    operation: "EXTEND" | "SUSPEND" | "RESTORE",
    command: { expectedStateRevision: number; newCurrentPeriodEnd?: Date },
  ): Promise<SubscriptionCommandResult> {
    const context = SubscriptionMutationContextSchema.parse(rawContext);
    const accountId = await subscriptionAccountId(runtime, subscriptionId);
    if (!accountId) return rejection("SUBSCRIPTION_NOT_FOUND");
    const capturedNow = now();
    return runtime.transaction(async (q) => {
      await beforeMutation?.({
        tx: q,
        operation,
        accountId,
        subscriptionId,
        context,
      });
      await advisoryLock(q, `p5-subscription-account:${accountId}`);
      await advisoryLock(q, `p5-subscription:${subscriptionId}`);
      const current = await loadSubscription(q, subscriptionId, true);
      if (!current) return rejection("SUBSCRIPTION_NOT_FOUND");
      const value = snapshot(current);
      if (value.stateRevision !== command.expectedStateRevision)
        return rejection("SUBSCRIPTION_STATE_STALE");

      if (operation === "EXTEND") {
        if (value.state === "EXPIRED")
          return rejection("SUBSCRIPTION_PERIOD_ENDED");
        const newEnd = command.newCurrentPeriodEnd!;
        if (!(newEnd > value.currentPeriodEnd))
          return rejection("SUBSCRIPTION_PERIOD_NOT_EXTENDED");
        if (value.graceUntil && value.graceUntil <= newEnd)
          return rejection("SUBSCRIPTION_GRACE_WINDOW_CONFLICT");
        const updated = await q.query<Row>(
          `UPDATE subscriptions SET current_period_end=$1,state_revision=state_revision+1,updated_at=$2
             WHERE id=$3 RETURNING id,account_id AS "accountId",state,state_revision AS "stateRevision",
             current_plan_revision_id AS "currentPlanRevisionId",bound_price_revision_id AS "boundPriceRevisionId",
             started_at AS "startedAt",current_period_start AS "currentPeriodStart",current_period_end AS "currentPeriodEnd",
             grace_until AS "graceUntil",cancel_at_period_end AS "cancelAtPeriodEnd",canceled_at AS "canceledAt",
             suspended_at AS "suspendedAt",created_at AS "createdAt",updated_at AS "updatedAt"`,
          [newEnd, capturedNow, subscriptionId],
        );
        const next = snapshot(updated.rows[0]!);
        await audit(q, context, "SUBSCRIPTION_EXTENDED", next.id, {
          accountId: next.accountId,
          oldStateRevision: value.stateRevision,
          newStateRevision: next.stateRevision,
          oldPeriodEnd: value.currentPeriodEnd.toISOString(),
          newPeriodEnd: next.currentPeriodEnd.toISOString(),
        });
        return { kind: "OK", changed: true, value: next };
      }

      if (operation === "SUSPEND") {
        if (value.state === "SUSPENDED")
          return { kind: "OK", changed: false, value };
        if (
          value.state === "EXPIRED" ||
          validateSubscriptionStateTransition(value.state, "SUSPENDED")
        )
          return rejection("SUBSCRIPTION_STATE_TRANSITION_INVALID");
        const updated = await q.query<Row>(
          `UPDATE subscriptions SET state='SUSPENDED',state_revision=state_revision+1,suspended_at=$1,state_reason=$2,updated_at=$1
             WHERE id=$3 RETURNING id,account_id AS "accountId",state,state_revision AS "stateRevision",
             current_plan_revision_id AS "currentPlanRevisionId",bound_price_revision_id AS "boundPriceRevisionId",
             started_at AS "startedAt",current_period_start AS "currentPeriodStart",current_period_end AS "currentPeriodEnd",
             grace_until AS "graceUntil",cancel_at_period_end AS "cancelAtPeriodEnd",canceled_at AS "canceledAt",
             suspended_at AS "suspendedAt",created_at AS "createdAt",updated_at AS "updatedAt"`,
          [capturedNow, context.reason, subscriptionId],
        );
        const next = snapshot(updated.rows[0]!);
        const transitionRevision = await insertTransition(
          q,
          next.id,
          value.state,
          "SUSPENDED",
          context,
          capturedNow,
        );
        await audit(q, context, "SUBSCRIPTION_SUSPENDED", next.id, {
          accountId: next.accountId,
          fromState: value.state,
          toState: "SUSPENDED",
          oldStateRevision: value.stateRevision,
          newStateRevision: next.stateRevision,
          transitionRevision,
        });
        return { kind: "OK", changed: true, value: next };
      }

      if (value.state !== "SUSPENDED")
        return rejection("SUBSCRIPTION_NOT_SUSPENDED");
      const transition = await q.query<TransitionRow>(
        `SELECT transition_revision AS "transitionRevision",from_state AS "fromState",to_state AS "toState"
           FROM subscription_transitions WHERE subscription_id=$1 ORDER BY transition_revision DESC LIMIT 1`,
        [subscriptionId],
      );
      const origin = transition.rows[0];
      if (!origin || origin.toState !== "SUSPENDED" || !origin.fromState)
        return rejection("SUBSCRIPTION_RESTORE_ORIGIN_NOT_FOUND");
      if (origin.fromState === "EXPIRED")
        return rejection("SUBSCRIPTION_RESTORE_ORIGIN_NOT_FOUND");
      if (
        origin.fromState === "TRIAL" ||
        origin.fromState === "ACTIVE" ||
        origin.fromState === "CANCELED"
      ) {
        if (!(capturedNow < value.currentPeriodEnd))
          return rejection("SUBSCRIPTION_PERIOD_ENDED");
      } else if (origin.fromState === "GRACE") {
        if (!value.graceUntil) return rejection("SUBSCRIPTION_CORRUPTED");
        if (!(capturedNow < value.graceUntil))
          return rejection("SUBSCRIPTION_GRACE_ENDED");
      }
      const updated = await q.query<Row>(
        `UPDATE subscriptions SET state=$1,state_revision=state_revision+1,suspended_at=NULL,state_reason=$2,updated_at=$3
           WHERE id=$4 RETURNING id,account_id AS "accountId",state,state_revision AS "stateRevision",
           current_plan_revision_id AS "currentPlanRevisionId",bound_price_revision_id AS "boundPriceRevisionId",
           started_at AS "startedAt",current_period_start AS "currentPeriodStart",current_period_end AS "currentPeriodEnd",
           grace_until AS "graceUntil",cancel_at_period_end AS "cancelAtPeriodEnd",canceled_at AS "canceledAt",
           suspended_at AS "suspendedAt",created_at AS "createdAt",updated_at AS "updatedAt"`,
        [origin.fromState, context.reason, capturedNow, subscriptionId],
      );
      const next = snapshot(updated.rows[0]!);
      const transitionRevision = await insertTransition(
        q,
        next.id,
        "SUSPENDED",
        origin.fromState,
        context,
        capturedNow,
      );
      await audit(q, context, "SUBSCRIPTION_RESTORED", next.id, {
        accountId: next.accountId,
        fromState: "SUSPENDED",
        toState: origin.fromState,
        oldStateRevision: value.stateRevision,
        newStateRevision: next.stateRevision,
        transitionRevision,
      });
      return { kind: "OK", changed: true, value: next };
    });
  }

  return {
    grantSubscription,
    extendSubscription: (rawCommand, context) => {
      const command = ExtendSubscriptionCommandSchema.parse(rawCommand);
      return mutate(command.subscriptionId, context, "EXTEND", command);
    },
    suspendSubscription: (rawCommand, context) => {
      const command = SuspendSubscriptionCommandSchema.parse(rawCommand);
      return mutate(command.subscriptionId, context, "SUSPEND", command);
    },
    restoreSubscription: (rawCommand, context) => {
      const command = RestoreSubscriptionCommandSchema.parse(rawCommand);
      return mutate(command.subscriptionId, context, "RESTORE", command);
    },
    async getCurrentSubscription(accountId: string) {
      const result = await runtime.query<Row>(
        `SELECT id,account_id AS "accountId",state,state_revision AS "stateRevision",
                current_plan_revision_id AS "currentPlanRevisionId",bound_price_revision_id AS "boundPriceRevisionId",
                started_at AS "startedAt",current_period_start AS "currentPeriodStart",current_period_end AS "currentPeriodEnd",
                grace_until AS "graceUntil",cancel_at_period_end AS "cancelAtPeriodEnd",canceled_at AS "canceledAt",
                suspended_at AS "suspendedAt",created_at AS "createdAt",updated_at AS "updatedAt"
           FROM subscriptions WHERE account_id=$1 AND state <> 'EXPIRED' LIMIT 1`,
        [accountId],
      );
      return result.rows[0] ? snapshot(result.rows[0]) : null;
    },
    async readSubscriptionAccessObservation(accountId: string, _at: Date) {
      const result = await runtime.query<
        Row & { accountStatus: "ACTIVE" | "SUSPENDED" }
      >(
        `SELECT a.status AS "accountStatus",s.id,s.account_id AS "accountId",s.state,s.state_revision AS "stateRevision",
                s.current_plan_revision_id AS "currentPlanRevisionId",s.bound_price_revision_id AS "boundPriceRevisionId",
                s.started_at AS "startedAt",s.current_period_start AS "currentPeriodStart",s.current_period_end AS "currentPeriodEnd",
                s.grace_until AS "graceUntil",s.cancel_at_period_end AS "cancelAtPeriodEnd",s.canceled_at AS "canceledAt",
                s.suspended_at AS "suspendedAt",s.created_at AS "createdAt",s.updated_at AS "updatedAt"
           FROM accounts a LEFT JOIN LATERAL (
             SELECT * FROM subscriptions WHERE account_id=a.id
             ORDER BY (state <> 'EXPIRED') DESC,updated_at DESC LIMIT 1
           ) s ON true WHERE a.id=$1`,
        [accountId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        accountStatus: row.accountStatus,
        subscription: row.id ? snapshot(row) : null,
      };
    },
  };
}

export function createP5SubscriptionAccessResolver(
  repository: SubscriptionAccessObservationReader,
): SubscriptionAccessResolver {
  return new SubscriptionAccessResolver(repository);
}
