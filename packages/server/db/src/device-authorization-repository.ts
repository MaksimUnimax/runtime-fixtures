import type { BrowserFamily } from "@product/shared";
import {
  equalArtifact,
  type DeviceAuthorizationRecord,
  type DeviceAuthorizationRepository,
  type DeviceAuthResult,
} from "@product/device-auth";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

const windowMs = 15 * 60_000;
async function consume(
  tx: DatabaseQuery,
  action: string,
  key: string,
  limit: number,
): Promise<boolean> {
  const now = new Date(),
    start = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const result = await tx.query<{ count: number }>(
    `INSERT INTO auth_rate_limit_buckets(action,key_hash,window_started_at,count,updated_at) VALUES($1,$2,$3,1,$4) ON CONFLICT(action,key_hash) DO UPDATE SET count=CASE WHEN auth_rate_limit_buckets.window_started_at=EXCLUDED.window_started_at THEN LEAST(auth_rate_limit_buckets.count+1,1000000) ELSE 1 END,window_started_at=EXCLUDED.window_started_at,updated_at=EXCLUDED.updated_at RETURNING count`,
    [action, key, start, now],
  );
  return Number(result.rows[0]?.count) <= limit;
}
type Row = Record<string, unknown>;
function date(value: unknown): Date {
  // node-postgres returns timestamptz as Date.  String(Date) rounds away
  // milliseconds, which are part of the AES-GCM replay AAD.
  return value instanceof Date
    ? new Date(value.getTime())
    : new Date(String(value));
}
function record(row: Row): DeviceAuthorizationRecord {
  return {
    id: String(row.id),
    status: String(row.status) as DeviceAuthorizationRecord["status"],
    idempotencyKeyHash: String(row.idempotency_key_hash),
    requestFingerprint: String(row.request_fingerprint),
    deviceCodeHash: String(row.device_code_hash),
    userCodeHash: String(row.user_code_hash),
    expiresAt: date(row.expires_at),
    approvedAccountId: row.approved_account_id as string | null,
    approvedUserId: row.approved_user_id as string | null,
    approvedAt: row.approved_at ? date(row.approved_at) : null,
    deniedAt: row.denied_at ? date(row.denied_at) : null,
    expiredAt: row.expired_at ? date(row.expired_at) : null,
    envelope: row.start_secret_ciphertext
      ? {
          ciphertext: row.start_secret_ciphertext as Buffer,
          nonce: row.start_secret_nonce as Buffer,
          authTag: row.start_secret_auth_tag as Buffer,
        }
      : null,
  };
}
const closed = { ok: false, code: "DEVICE_AUTH_CLOSED" } as const;
const invalid = { ok: false, code: "DEVICE_AUTH_INVALID" } as const;
/** A collision is an expected (though vanishingly rare) generation outcome, never an API error leak. */
const collision = { ok: false, code: "DEVICE_AUTH_COLLISION" } as const;
const codeCollisionConstraints = new Set([
  "device_authorizations_device_code_hash_unique",
  "device_authorizations_user_code_hash_unique",
]);
function isCodeCollision(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505" &&
    codeCollisionConstraints.has(
      String((error as { constraint?: unknown }).constraint),
    )
  );
}
class CodeCollisionRollback extends Error {}
async function expire(
  tx: DatabaseQuery,
  row: DeviceAuthorizationRecord,
  correlationId: string,
): Promise<void> {
  await tx.query(
    `UPDATE device_authorizations SET status='EXPIRED',expired_at=now(),start_secret_ciphertext=NULL,start_secret_nonce=NULL,start_secret_auth_tag=NULL WHERE id=$1 AND status IN ('PENDING','APPROVED')`,
    [row.id],
  );
  await tx.query(
    `INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id) VALUES('SYSTEM','DEVICE_AUTH_EXPIRED','DEVICE_AUTHORIZATION',$1,$2)`,
    [row.id, correlationId],
  );
}
export function createDeviceAuthorizationRepository(
  runtime: DatabaseRuntime,
): DeviceAuthorizationRepository {
  return {
    async previewPendingAuthorization(id, now) {
      const result = await runtime.query<{
        id: string;
        browser_family: BrowserFamily;
        browser_version: string | null;
        extension_version: string;
        device_label: string | null;
        expires_at: Date;
      }>(
        `SELECT id,browser_family,browser_version,extension_version,device_label,expires_at FROM device_authorizations WHERE id=$1 AND status='PENDING' AND expires_at>$2`,
        [id, now],
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            browserFamily: row.browser_family,
            browserVersion: row.browser_version,
            extensionVersion: row.extension_version,
            deviceLabel: row.device_label,
            expiresAt: date(row.expires_at),
          }
        : undefined;
    },
    async start(input) {
      try {
        return await runtime.transaction(async (tx) => {
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.record.idempotencyKeyHash],
          );
          const existing = await tx.query<Row>(
            `SELECT * FROM device_authorizations WHERE idempotency_key_hash=$1`,
            [input.record.idempotencyKeyHash],
          );
          if (existing.rows[0]) {
            const found = record(existing.rows[0]);
            if (found.requestFingerprint !== input.record.requestFingerprint) {
              await tx.query(
                `INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id) VALUES('EXTENSION_CLIENT','DEVICE_AUTH_IDEMPOTENCY_CONFLICT','DEVICE_AUTHORIZATION',$1,$2)`,
                [found.id, input.correlationId],
              );
              return {
                ok: false,
                code: "DEVICE_AUTH_IDEMPOTENCY_CONFLICT",
              } as DeviceAuthResult<never>;
            }
            if (
              (found.status === "PENDING" || found.status === "APPROVED") &&
              found.expiresAt <= new Date()
            ) {
              await expire(tx, found, input.correlationId);
              return closed;
            }
            if (found.status === "PENDING" || found.status === "APPROVED")
              return { ok: true, value: { record: found, replay: true } };
            return closed;
          }
          if (!(await consume(tx, "DEVICE_AUTH_START_IP", input.ipKey, 20))) {
            await tx.query(
              `INSERT INTO audit_events(actor_type,action,target_type,correlation_id,reason) VALUES('EXTENSION_CLIENT','DEVICE_AUTH_RATE_LIMITED','DEVICE_AUTHORIZATION',$1,'DEVICE_AUTH_RATE_LIMITED')`,
              [input.correlationId],
            );
            return {
              ok: false,
              code: "DEVICE_AUTH_RATE_LIMITED",
            } as DeviceAuthResult<never>;
          }
          const r = input.record;
          try {
            await tx.query(
              `INSERT INTO device_authorizations(id,device_code_hash,user_code_hash,status,requested_client_type,browser_family,browser_version,extension_version,device_label,idempotency_key_hash,request_fingerprint,start_secret_ciphertext,start_secret_nonce,start_secret_auth_tag,expires_at) VALUES($1,$2,$3,'PENDING','browser_extension',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                r.id,
                r.deviceCodeHash,
                r.userCodeHash,
                r.browserFamily,
                r.browserVersion ?? null,
                r.extensionVersion ?? null,
                r.deviceLabel ?? null,
                r.idempotencyKeyHash,
                r.requestFingerprint,
                r.envelope?.ciphertext,
                r.envelope?.nonce,
                r.envelope?.authTag,
                r.expiresAt,
              ],
            );
          } catch (error: unknown) {
            // Unique device/user-code hashes are collision guards.  The service retries
            // a finite number of freshly generated code pairs; no PostgreSQL detail
            // crosses this package boundary.
            if (isCodeCollision(error)) throw new CodeCollisionRollback();
            throw error;
          }
          // browser metadata is deliberately omitted from audit; browser family is safe operational metadata.
          await tx.query(
            `INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id) VALUES('EXTENSION_CLIENT','DEVICE_AUTH_STARTED','DEVICE_AUTHORIZATION',$1,$2)`,
            [r.id, input.correlationId],
          );
          return { ok: true, value: { record: r, replay: false } };
        });
      } catch (error) {
        if (error instanceof CodeCollisionRollback) return collision;
        throw error;
      }
    },
    async approve(input) {
      return runtime.transaction(async (tx) => {
        const [userBudget, ipBudget] = await Promise.all([
          consume(tx, "DEVICE_AUTH_PORTAL_USER", input.userRateKey, 10),
          consume(tx, "DEVICE_AUTH_PORTAL_IP", input.ipRateKey, 30),
        ]);
        if (!userBudget || !ipBudget)
          return {
            ok: false,
            code: "DEVICE_AUTH_RATE_LIMITED",
          } as DeviceAuthResult<never>;
        const result = await tx.query<Row>(
          `SELECT * FROM device_authorizations WHERE id=$1 FOR UPDATE`,
          [input.id],
        );
        if (!result.rows[0]) return invalid;
        const r = record(result.rows[0]);
        if (
          (r.status === "PENDING" || r.status === "APPROVED") &&
          r.expiresAt <= new Date()
        ) {
          await expire(tx, r, input.correlationId);
          return invalid;
        }
        if (
          r.status === "DENIED" ||
          r.status === "EXPIRED" ||
          r.status === "EXCHANGED"
        )
          return closed;
        if (!equalArtifact(r.userCodeHash, input.userCodeHash)) {
          await tx.query(
            `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason) VALUES('USER',$1,'DEVICE_AUTH_USER_CODE_FAILED','DEVICE_AUTHORIZATION',$2,$3,'DEVICE_AUTH_INVALID')`,
            [input.userId, r.id, input.correlationId],
          );
          return invalid;
        }
        if (r.status === "APPROVED")
          return r.approvedUserId === input.userId &&
            r.approvedAccountId === input.accountId
            ? { ok: true, value: { record: r } }
            : { ok: false, code: "DEVICE_AUTH_STATE_CONFLICT" };
        const authorized = await tx.query<{ id: string }>(
          `SELECT a.id FROM accounts a JOIN account_memberships m ON m.account_id=a.id WHERE a.id=$1 AND a.status='ACTIVE' AND m.user_id=$2 AND m.role='OWNER'`,
          [input.accountId, input.userId],
        );
        if (!authorized.rows[0])
          return { ok: false, code: "DEVICE_AUTH_FORBIDDEN" };
        await tx.query(
          `UPDATE device_authorizations SET status='APPROVED',approved_account_id=$2,approved_user_id=$3,approved_at=now() WHERE id=$1`,
          [r.id, input.accountId, input.userId],
        );
        await tx.query(
          `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id) VALUES('USER',$1,'DEVICE_AUTH_APPROVED','DEVICE_AUTHORIZATION',$2,$3)`,
          [input.userId, r.id, input.correlationId],
        );
        return {
          ok: true,
          value: {
            record: {
              ...r,
              status: "APPROVED",
              approvedAccountId: input.accountId,
              approvedUserId: input.userId,
            },
          },
        };
      });
    },
    async deny(input) {
      return runtime.transaction(async (tx) => {
        const [userBudget, ipBudget] = await Promise.all([
          consume(tx, "DEVICE_AUTH_PORTAL_USER", input.userRateKey, 10),
          consume(tx, "DEVICE_AUTH_PORTAL_IP", input.ipRateKey, 30),
        ]);
        if (!userBudget || !ipBudget)
          return {
            ok: false,
            code: "DEVICE_AUTH_RATE_LIMITED",
          } as DeviceAuthResult<never>;
        const result = await tx.query<Row>(
          `SELECT * FROM device_authorizations WHERE id=$1 FOR UPDATE`,
          [input.id],
        );
        if (!result.rows[0]) return invalid;
        const r = record(result.rows[0]);
        if (
          (r.status === "PENDING" || r.status === "APPROVED") &&
          r.expiresAt <= new Date()
        ) {
          await expire(tx, r, input.correlationId);
          return invalid;
        }
        if (
          r.status === "DENIED" ||
          r.status === "EXPIRED" ||
          r.status === "EXCHANGED"
        )
          return closed;
        if (r.status === "APPROVED")
          return { ok: false, code: "DEVICE_AUTH_STATE_CONFLICT" };
        if (!equalArtifact(r.userCodeHash, input.userCodeHash)) {
          await tx.query(
            `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason) VALUES('USER',$1,'DEVICE_AUTH_USER_CODE_FAILED','DEVICE_AUTHORIZATION',$2,$3,'DEVICE_AUTH_INVALID')`,
            [input.userId, r.id, input.correlationId],
          );
          return invalid;
        }
        await tx.query(
          `UPDATE device_authorizations SET status='DENIED',denied_at=now(),start_secret_ciphertext=NULL,start_secret_nonce=NULL,start_secret_auth_tag=NULL WHERE id=$1`,
          [r.id],
        );
        await tx.query(
          `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id) VALUES('USER',$1,'DEVICE_AUTH_DENIED','DEVICE_AUTHORIZATION',$2,$3)`,
          [input.userId, r.id, input.correlationId],
        );
        return {
          ok: true,
          value: { record: { ...r, status: "DENIED", envelope: null } },
        };
      });
    },
    async expireDue(batchSize, correlationId) {
      return runtime.transaction(async (tx) => {
        const rows = await tx.query<Row>(
          `SELECT * FROM device_authorizations WHERE status IN ('PENDING','APPROVED') AND expires_at<=now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT $1`,
          [batchSize],
        );
        for (const row of rows.rows)
          await expire(tx, record(row), correlationId);
        return rows.rows.length;
      });
    },
  };
}
