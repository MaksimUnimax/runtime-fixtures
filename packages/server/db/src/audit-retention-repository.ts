import type { DatabaseRuntime } from "./index.js";

export const ADMIN_AUDIT_RETENTION_CATEGORY = "ADMIN_AI_REGISTRY" as const;
// These exact events record editable AI catalog maintenance; authority, identity,
// billing, support, policy publication, and all unknown actions remain append-only.
const adapterActions = Object.freeze([
  "P7_ADMIN_ADAPTER_CREATED",
  "P7_ADMIN_ADAPTER_UPDATED",
] as const);
const surfaceActions = Object.freeze([
  "P7_ADMIN_SURFACE_CREATED",
  "P7_ADMIN_SURFACE_UPDATED",
] as const);
const variantActions = Object.freeze([
  "P7_ADMIN_VARIANT_CREATED",
  "P7_ADMIN_VARIANT_UPDATED",
] as const);
const profileActions = Object.freeze([
  "P7_ADMIN_PROFILE_CREATED",
  "P7_ADMIN_PROFILE_UPDATED",
] as const);
export const ADMIN_AUDIT_RETENTION_ACTIONS = Object.freeze([
  ...adapterActions,
  ...surfaceActions,
  ...variantActions,
  ...profileActions,
] as const);

export interface AuditRetentionRepository {
  purgeExpired(input: {
    category: typeof ADMIN_AUDIT_RETENTION_CATEGORY;
    cutoff: Date;
    retentionDays: number;
    batchSize: number;
    statementTimeoutMs: number;
  }): Promise<number>;
}

const MAX_BATCH_SIZE = 1_000;
const MAX_STATEMENT_TIMEOUT_MS = 30_000;

function validateInput(input: {
  category: string;
  cutoff: Date;
  retentionDays: number;
  batchSize: number;
  statementTimeoutMs: number;
}): void {
  if (input.category !== ADMIN_AUDIT_RETENTION_CATEGORY)
    throw new Error("audit retention category is not allowlisted");
  if (
    !(input.cutoff instanceof Date) ||
    !Number.isFinite(input.cutoff.getTime())
  )
    throw new Error("audit retention cutoff must be a valid date");
  if (input.retentionDays !== 90)
    throw new Error("administrative audit retention is fixed at 90 days");
  const earliestAllowedCutoff =
    Date.now() - input.retentionDays * 24 * 60 * 60_000;
  if (input.cutoff.getTime() > earliestAllowedCutoff)
    throw new Error("audit retention cannot purge events before 90 days");
  if (
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > MAX_BATCH_SIZE
  )
    throw new Error(`audit retention batchSize must be 1..${MAX_BATCH_SIZE}`);
  if (
    !Number.isInteger(input.statementTimeoutMs) ||
    input.statementTimeoutMs < 1 ||
    input.statementTimeoutMs > MAX_STATEMENT_TIMEOUT_MS
  )
    throw new Error(
      `audit retention statementTimeoutMs must be 1..${MAX_STATEMENT_TIMEOUT_MS}`,
    );
}

export function createAuditRetentionRepository(
  runtime: DatabaseRuntime,
): AuditRetentionRepository {
  return {
    async purgeExpired(input) {
      validateInput(input);
      return runtime.transaction(async (tx) => {
        await tx.query("SELECT set_config('statement_timeout',$1,true)", [
          `${input.statementTimeoutMs}ms`,
        ]);
        const cutoffResult = await tx.query<{ cutoff: Date }>(
          "SELECT LEAST($1::timestamptz, transaction_timestamp() - INTERVAL '2160 hours') AS cutoff",
          [input.cutoff],
        );
        const cutoff = cutoffResult.rows[0]?.cutoff;
        if (!(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime()))
          throw new Error("audit retention database cutoff is invalid");
        const result = await tx.query<{ deleted_count: string | number }>(
          `WITH expired AS (
             SELECT id FROM audit_events
             WHERE actor_type='ADMIN' AND created_at < $1 AND (
               (target_type='AI_ADAPTER' AND action=ANY($3::varchar[])) OR
               (target_type='AI_SURFACE' AND action=ANY($4::varchar[])) OR
               (target_type='AI_VARIANT' AND action=ANY($5::varchar[])) OR
               (target_type='ADAPTER_PROFILE' AND action=ANY($6::varchar[]))
             )
             ORDER BY created_at ASC, id ASC
             LIMIT $2
             FOR UPDATE SKIP LOCKED
           ), deleted AS (
             DELETE FROM audit_events AS event USING expired
             WHERE event.id=expired.id
             RETURNING 1
           )
           SELECT count(*)::text AS deleted_count FROM deleted`,
          [
            cutoff,
            input.batchSize,
            adapterActions,
            surfaceActions,
            variantActions,
            profileActions,
          ],
        );
        const deletedCount = Number(result.rows[0]?.deleted_count ?? 0);
        if (!Number.isSafeInteger(deletedCount) || deletedCount < 0)
          throw new Error("audit retention returned an invalid count");
        if (deletedCount > 0) {
          await tx.query(
            `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
             VALUES('SYSTEM',NULL,'ADMIN_AUDIT_RETENTION_PURGED','AUDIT_RETENTION',NULL,$1,'ADMIN_AUDIT_RETENTION',$2::jsonb)`,
            [
              `audit-retention:${cutoff.toISOString()}`,
              JSON.stringify({
                category: input.category,
                retentionDays: input.retentionDays,
                cutoff: cutoff.toISOString(),
                deletedCount,
                batchSize: input.batchSize,
              }),
            ],
          );
        }
        return deletedCount;
      });
    },
  };
}
