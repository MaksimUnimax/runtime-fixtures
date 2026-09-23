import { randomUUID } from "node:crypto";
import {
  compareNotificationSeverity,
  DEFAULT_LLM_HEALTH_NOTIFICATION_POLICY,
  deriveLlmHealthNotificationEvent,
  isRepeatedFailureWithinCooldown,
  type LlmHealthNotificationEvent,
  type LlmHealthNotificationInput,
  type LlmHealthNotificationPolicy,
  type LlmHealthNotificationSeverity,
} from "@product/health";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

export const MAX_NOTIFICATION_ATTEMPTS = 5;
export const NOTIFICATION_LEASE_MS = 60_000;

export type NotificationDeliveryFailureCode =
  | "TRANSIENT_PROVIDER_FAILURE"
  | "RATE_LIMIT"
  | "CONFIGURATION_ERROR"
  | "PERMANENT_PROVIDER_REJECTION"
  | "DISABLED_ROUTE";

export type HealthNotificationIntent = Readonly<{
  id: string;
  dedupKey: string;
  sourceDomain: "LLM_HEALTH";
  incidentId: string;
  healthRunId: string;
  eventKind: LlmHealthNotificationEvent["eventKind"];
  severity: LlmHealthNotificationSeverity;
  routeKey: string;
  state:
    | "PENDING"
    | "CLAIMED"
    | "DELIVERED"
    | "FAILED_RETRYABLE"
    | "FAILED_TERMINAL"
    | "SUPPRESSED";
  groupCount: number;
  firstObservedAt: Date;
  latestObservedAt: Date;
  cooldownUntil: Date;
  nextAttemptAt: Date;
  attemptCount: number;
  claimOwner: string | null;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  lastErrorCode: string | null;
  suppressionReason: string | null;
  payload: Record<string, unknown>;
  retentionClass: string;
  expiresAt: Date | null;
  providerAdapterKey: string | null;
  providerDeliveryId: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

type IntentRow = HealthNotificationIntent;

const INTENT_COLUMNS = `id,dedup_key AS "dedupKey",source_domain AS "sourceDomain",
    incident_id AS "incidentId",health_run_id AS "healthRunId",
    event_kind AS "eventKind",severity,route_key AS "routeKey",state,
    group_count AS "groupCount",first_observed_at AS "firstObservedAt",
    latest_observed_at AS "latestObservedAt",cooldown_until AS "cooldownUntil",
    next_attempt_at AS "nextAttemptAt",attempt_count AS "attemptCount",
    claim_owner AS "claimOwner",claim_token AS "claimToken",
    claim_expires_at AS "claimExpiresAt",last_error_code AS "lastErrorCode",
    suppression_reason AS "suppressionReason",payload,
    retention_class AS "retentionClass",expires_at AS "expiresAt",
    provider_adapter_key AS "providerAdapterKey",
    provider_delivery_id AS "providerDeliveryId",delivered_at AS "deliveredAt",
    created_at AS "createdAt",updated_at AS "updatedAt"`;
const INTENT_PROJECTION = `SELECT ${INTENT_COLUMNS} FROM health_notification_intents`;

function mapIntent(row: IntentRow): HealthNotificationIntent {
  return { ...row, payload: { ...row.payload } };
}

export async function recordLlmHealthNotificationInTransaction(
  q: DatabaseQuery,
  event: LlmHealthNotificationEvent,
): Promise<HealthNotificationIntent | undefined> {
  const result = await q.query<IntentRow>(
    `INSERT INTO health_notification_intents(
      dedup_key,source_domain,incident_id,health_run_id,event_kind,severity,
      route_key,state,group_count,first_observed_at,latest_observed_at,
      cooldown_until,next_attempt_at,payload
    ) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING',1,$8,$8,$9,$8,$10::jsonb)
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING ${INTENT_COLUMNS}`,
    [
      event.dedupKey,
      event.sourceDomain,
      event.incidentId,
      event.healthRunId,
      event.eventKind,
      event.severity,
      event.routeKey,
      event.observedAt,
      event.cooldownUntil,
      JSON.stringify(event.payload),
    ],
  );
  return result.rows[0] ? mapIntent(result.rows[0]) : undefined;
}

/**
 * Called only for a durably accepted incident observation. It updates one
 * episode aggregate and creates at most one event for a stronger severity.
 */
export async function observeLlmHealthFailureInTransaction(
  q: DatabaseQuery,
  input: LlmHealthNotificationInput,
  policy: LlmHealthNotificationPolicy = DEFAULT_LLM_HEALTH_NOTIFICATION_POLICY,
): Promise<{ opened: boolean; escalated: boolean }> {
  const openedEvent = deriveLlmHealthNotificationEvent(
    {
      ...input,
      eventKind: "INCIDENT_OPENED",
    },
    policy,
  );
  if (!openedEvent) return { opened: false, escalated: false };

  const existing = await q.query<{
    id: string;
    severity: LlmHealthNotificationSeverity;
    latestObservedAt: Date;
    cooldownUntil: Date;
  }>(
    `SELECT id,severity,latest_observed_at AS "latestObservedAt",cooldown_until AS "cooldownUntil"
     FROM health_notification_intents
     WHERE incident_id=$1 AND event_kind IN ('INCIDENT_OPENED','INCIDENT_ESCALATED')
     ORDER BY CASE severity WHEN 'CRITICAL' THEN 2 WHEN 'WARNING' THEN 1 ELSE 0 END DESC,
       latest_observed_at DESC,id DESC
     LIMIT 1 FOR UPDATE`,
    [input.incidentId],
  );
  const current = existing.rows[0];
  if (!current) {
    await recordLlmHealthNotificationInTransaction(q, openedEvent);
    return { opened: true, escalated: false };
  }

  const newer = input.observedAt.getTime() > current.latestObservedAt.getTime();
  const withinCooldown = isRepeatedFailureWithinCooldown({
    lastObservedAt: current.latestObservedAt,
    observedAt: input.observedAt,
    lastSeverity: current.severity,
    severity: openedEvent.severity,
    cooldownMs: policy.cooldownMs,
  });
  await q.query(
    `UPDATE health_notification_intents
     SET group_count=group_count+1,
         latest_observed_at=CASE WHEN $2::timestamptz > latest_observed_at THEN $2 ELSE latest_observed_at END,
         cooldown_until=CASE WHEN $2::timestamptz > latest_observed_at THEN $3 ELSE cooldown_until END,
         health_run_id=CASE WHEN $2::timestamptz > latest_observed_at THEN $4 ELSE health_run_id END,
         payload=CASE WHEN $2::timestamptz > latest_observed_at THEN $5::jsonb ELSE payload END,
         suppression_reason=CASE WHEN $6 THEN 'COOLDOWN' ELSE NULL END,
         updated_at=GREATEST(updated_at,CURRENT_TIMESTAMP)
     WHERE id=$1`,
    [
      current.id,
      input.observedAt,
      openedEvent.cooldownUntil,
      input.healthRunId,
      JSON.stringify(openedEvent.payload),
      withinCooldown,
    ],
  );

  if (
    !newer ||
    compareNotificationSeverity(openedEvent.severity, current.severity) <= 0
  ) {
    return { opened: false, escalated: false };
  }
  const escalation = deriveLlmHealthNotificationEvent(
    {
      ...input,
      eventKind: "INCIDENT_ESCALATED",
    },
    policy,
  );
  if (!escalation) return { opened: false, escalated: false };
  const inserted = await recordLlmHealthNotificationInTransaction(
    q,
    escalation,
  );
  return { opened: false, escalated: inserted !== undefined };
}

export async function suppressLlmHealthProductNotificationsInTransaction(
  q: DatabaseQuery,
  incidentId: string,
): Promise<void> {
  await q.query(
    `UPDATE health_notification_intents
     SET state='SUPPRESSED',suppression_reason='MAINTENANCE_ENTERED',
         claim_owner=NULL,claim_token=NULL,claim_expires_at=NULL,
         updated_at=CURRENT_TIMESTAMP
     WHERE incident_id=$1 AND event_kind IN ('INCIDENT_OPENED','INCIDENT_ESCALATED')
       AND state IN ('PENDING','FAILED_RETRYABLE')`,
    [incidentId],
  );
}

export async function resumeLlmHealthProductNotificationInTransaction(
  q: DatabaseQuery,
  incidentId: string,
  observedAt: Date,
): Promise<void> {
  await q.query(
    `UPDATE health_notification_intents
     SET state='PENDING',suppression_reason=NULL,next_attempt_at=$2,
         updated_at=CURRENT_TIMESTAMP
     WHERE id=(
       SELECT id FROM health_notification_intents
       WHERE incident_id=$1 AND event_kind='INCIDENT_OPENED'
         AND state='SUPPRESSED' AND suppression_reason='MAINTENANCE_ENTERED'
       ORDER BY created_at,id LIMIT 1
     )`,
    [incidentId, observedAt],
  );
}

function retryDelayMs(attemptCount: number, retryAfterMs?: number): number {
  const exponential = Math.min(15 * 60_000, 30_000 * 2 ** (attemptCount - 1));
  return Math.min(60 * 60_000, Math.max(exponential, retryAfterMs ?? 0));
}

export function createHealthNotificationRepository(runtime: DatabaseRuntime) {
  return {
    async getIntent(id: string): Promise<HealthNotificationIntent | undefined> {
      const result = await runtime.query<IntentRow>(
        `${INTENT_PROJECTION} WHERE id=$1`,
        [id],
      );
      return result.rows[0] ? mapIntent(result.rows[0]) : undefined;
    },

    async listIntents(): Promise<HealthNotificationIntent[]> {
      const result = await runtime.query<IntentRow>(
        `${INTENT_PROJECTION} ORDER BY created_at,id`,
      );
      return result.rows.map(mapIntent);
    },

    async claimDue(input: {
      ownerId: string;
      now?: Date;
      leaseMs?: number;
    }): Promise<HealthNotificationIntent | undefined> {
      const now = input.now ?? new Date();
      const leaseMs = input.leaseMs ?? NOTIFICATION_LEASE_MS;
      const claimToken = randomUUID();
      const claimExpiresAt = new Date(now.getTime() + leaseMs);
      const result = await runtime.query<IntentRow>(
        `WITH candidate AS (
          SELECT i.id FROM health_notification_intents AS i
          WHERE (state IN ('PENDING','FAILED_RETRYABLE') AND next_attempt_at <= $1)
             OR (state='CLAIMED' AND claim_expires_at <= $1)
          ORDER BY next_attempt_at,id
          FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE health_notification_intents AS i
        SET state='CLAIMED',claim_owner=$2,claim_token=$3,
            claim_expires_at=$4,attempt_count=i.attempt_count+1,
            updated_at=CURRENT_TIMESTAMP
        FROM candidate WHERE i.id=candidate.id
        RETURNING i.id`,
        [now, input.ownerId, claimToken, claimExpiresAt],
      );
      const claimed = result.rows[0]
        ? await runtime.query<IntentRow>(`${INTENT_PROJECTION} WHERE id=$1`, [
            result.rows[0].id,
          ])
        : undefined;
      return claimed?.rows[0] ? mapIntent(claimed.rows[0]) : undefined;
    },

    async markDelivered(input: {
      id: string;
      claimToken: string;
      providerAdapterKey: string;
      providerDeliveryId: string;
      deliveredAt?: Date;
    }): Promise<void> {
      const result = await runtime.query<{ id: string }>(
        `UPDATE health_notification_intents
         SET state='DELIVERED',delivered_at=$3,provider_adapter_key=$4,
             provider_delivery_id=$5,claim_owner=NULL,claim_token=NULL,
             claim_expires_at=NULL,last_error_code=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND state='CLAIMED' AND claim_token=$2
         RETURNING id`,
        [
          input.id,
          input.claimToken,
          input.deliveredAt ?? new Date(),
          input.providerAdapterKey,
          input.providerDeliveryId,
        ],
      );
      if (result.rows.length === 0) throw new Error("NOTIFICATION_CLAIM_STALE");
    },

    async failClaim(input: {
      id: string;
      claimToken: string;
      code: NotificationDeliveryFailureCode;
      now?: Date;
      retryAfterMs?: number;
    }): Promise<HealthNotificationIntent> {
      const now = input.now ?? new Date();
      return runtime.transaction(async (q) => {
        const selected = await q.query<{
          attemptCount: number;
          state: HealthNotificationIntent["state"];
        }>(
          `SELECT attempt_count AS "attemptCount",state FROM health_notification_intents
           WHERE id=$1 AND state='CLAIMED' AND claim_token=$2 FOR UPDATE`,
          [input.id, input.claimToken],
        );
        const row = selected.rows[0];
        if (!row) throw new Error("NOTIFICATION_CLAIM_STALE");
        const disabled = input.code === "DISABLED_ROUTE";
        const permanent =
          input.code === "CONFIGURATION_ERROR" ||
          input.code === "PERMANENT_PROVIDER_REJECTION";
        const terminal =
          disabled ||
          permanent ||
          row.attemptCount >= MAX_NOTIFICATION_ATTEMPTS;
        const state = disabled
          ? "SUPPRESSED"
          : terminal
            ? "FAILED_TERMINAL"
            : "FAILED_RETRYABLE";
        const nextAttemptAt = new Date(
          now.getTime() + retryDelayMs(row.attemptCount, input.retryAfterMs),
        );
        const updated = await q.query<IntentRow>(
          `UPDATE health_notification_intents
           SET state=$3::health_notification_state,last_error_code=$4::varchar,
               suppression_reason=CASE WHEN $3::health_notification_state='SUPPRESSED' THEN $4::varchar ELSE NULL END,
               next_attempt_at=$5,claim_owner=NULL,claim_token=NULL,
               claim_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
           WHERE id=$1 AND claim_token=$2
           RETURNING ${INTENT_COLUMNS}`,
          [input.id, input.claimToken, state, input.code, nextAttemptAt],
        );
        const intent = updated.rows[0];
        if (!intent) throw new Error("NOTIFICATION_CLAIM_STALE");
        return mapIntent(intent);
      });
    },
  };
}

export type HealthNotificationRepository = ReturnType<
  typeof createHealthNotificationRepository
>;
