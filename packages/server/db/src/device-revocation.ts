import type { DatabaseQuery } from "./index.js";
import { safeAuditReason } from "./safe-audit.js";

export type DeviceRevocationInput = {
  deviceId: string;
  expectedAccountId?: string;
  actorType: "USER" | "ADMIN";
  actorId: string;
  deviceRevokeReason: "USER_REVOKED" | "ADMIN_REVOKED";
  deviceAuditAction: "DEVICE_REVOKED" | "ADMIN_DEVICE_REVOKED";
  correlationId: string;
  reason?: string;
  now?: Date;
};

export async function revokeDeviceInTransaction(
  tx: DatabaseQuery,
  input: DeviceRevocationInput,
): Promise<"revoked" | "already-revoked" | "not-found"> {
  const device = await tx.query<{
    id: string;
    account_id: string;
    status: string;
  }>(
    `SELECT id,account_id,status FROM devices WHERE id=$1 AND ($2::uuid IS NULL OR account_id=$2) FOR UPDATE`,
    [input.deviceId, input.expectedAccountId ?? null],
  );
  const row = device.rows[0];
  if (!row) return "not-found";
  if (row.status !== "ACTIVE") return "already-revoked";
  const now = input.now ?? new Date();
  await tx.query(
    `UPDATE devices SET status='REVOKED',revoked_at=$2,revoke_reason=$3 WHERE id=$1`,
    [row.id, now, input.deviceRevokeReason],
  );
  await tx.query(
    `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
     VALUES($1,$2,$3,'DEVICE',$4,$5,$6,$7::jsonb)`,
    [
      input.actorType,
      input.actorId,
      input.deviceAuditAction,
      row.id,
      input.correlationId,
      input.reason ? safeAuditReason(input.reason) : null,
      input.actorType === "ADMIN"
        ? JSON.stringify({
            accountId: row.account_id,
            reasonCode: "ADMIN_REVOKED",
          })
        : null,
    ],
  );
  const sessions = await tx.query<{ id: string }>(
    `UPDATE sessions SET status='REVOKED',revoked_at=$2,revoke_reason='DEVICE_REVOKED'
     WHERE device_id=$1 AND status='ACTIVE' RETURNING id`,
    [row.id, now],
  );
  for (const session of sessions.rows)
    await tx.query(
      `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id)
       VALUES($1,$2,'EXTENSION_SESSION_REVOKED','SESSION',$3,$4)`,
      [input.actorType, input.actorId, session.id, input.correlationId],
    );
  return "revoked";
}
