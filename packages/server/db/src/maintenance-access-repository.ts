import type {
  AdminSubject,
  MaintenanceGrant,
  MaintenanceRepository,
} from "@product/admin-auth";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

type Row = {
  id: string;
  label: string;
  admin_principal_id: string;
  user_id: string;
  source_admin_session_id: string;
  permissions: MaintenanceGrant["permissions"];
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  token_hash: string;
  previous_token_hash: string | null;
  rotation_nonce_hash: string | null;
  rotation_replay_until: Date | null;
};
function publicGrant(row: Row): MaintenanceGrant {
  return {
    id: row.id,
    label: row.label,
    adminPrincipalId: row.admin_principal_id,
    userId: row.user_id,
    sourceAdminSessionId: row.source_admin_session_id,
    permissions: row.permissions,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  };
}
async function humanOwner(q: DatabaseQuery, issuer: AdminSubject, now: Date) {
  if (issuer.maintenanceGrantId) return null;
  const result = await q.query<{ revision: number }>(
    `SELECT ap.revision FROM admin_sessions s
     JOIN admin_principals ap ON ap.id=s.admin_principal_id
     JOIN users u ON u.id=ap.user_id
     JOIN portal_sessions ps ON ps.id=s.source_portal_session_id
     WHERE s.id=$1 AND ap.id=$2 AND ap.user_id=$3 AND ps.user_id=ap.user_id
       AND s.revoked_at IS NULL AND s.expires_at>$4
       AND ps.revoked_at IS NULL AND ps.expires_at>$4
       AND ap.status='ACTIVE' AND u.status='ACTIVE'
       AND EXISTS(SELECT 1 FROM admin_role_grants r WHERE r.admin_principal_id=ap.id
                  AND r.role='ADMIN_OWNER' AND r.revoked_at IS NULL)
     FOR UPDATE OF s,ap,ps,u`,
    [issuer.adminSessionId, issuer.adminPrincipalId, issuer.userId, now],
  );
  return result.rows[0] ?? null;
}
const activeGrant = `SELECT g.*,ap.user_id FROM admin_maintenance_grants g
 JOIN admin_principals ap ON ap.id=g.admin_principal_id
 JOIN users u ON u.id=ap.user_id
 WHERE g.id=$1 AND g.revoked_at IS NULL AND g.expires_at>$2
   AND ap.status='ACTIVE' AND u.status='ACTIVE' AND ap.revision=g.issuer_revision
   AND EXISTS(SELECT 1 FROM admin_role_grants r WHERE r.admin_principal_id=ap.id
              AND r.role='ADMIN_OWNER' AND r.revoked_at IS NULL)`;
async function audit(
  q: DatabaseQuery,
  principal: string,
  action: string,
  id: string,
  correlation: string,
) {
  await q.query(
    `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id)
     VALUES('ADMIN',$1,$2,'ADMIN_MAINTENANCE_GRANT',$3,$4)`,
    [principal, action, id, correlation],
  );
}
export function createMaintenanceRepository(
  runtime: DatabaseRuntime,
): MaintenanceRepository {
  return {
    async issue(input) {
      return runtime.transaction(async (tx) => {
        const owner = await humanOwner(tx, input.issuer, input.now);
        if (!owner) return null;
        const count = await tx.query<{ count: string }>(
          `SELECT count(*) FROM admin_maintenance_grants
           WHERE admin_principal_id=$1 AND issuer_revision=$3
             AND revoked_at IS NULL AND expires_at>$2`,
          [input.issuer.adminPrincipalId, input.now, owner.revision],
        );
        if (Number(count.rows[0]?.count ?? "10") >= 10) return null;
        await tx.query(
          `INSERT INTO admin_maintenance_grants
           (id,label,admin_principal_id,issuer_revision,source_admin_session_id,
            permissions,token_hash,created_at,expires_at)
           VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
          [
            input.id,
            input.label,
            input.issuer.adminPrincipalId,
            owner.revision,
            input.issuer.adminSessionId,
            JSON.stringify(input.permissions),
            input.tokenHash,
            input.now,
            input.expiresAt,
          ],
        );
        await audit(
          tx,
          input.issuer.adminPrincipalId,
          "MAINTENANCE_GRANT_ISSUED",
          input.id,
          input.correlationId,
        );
        return {
          id: input.id,
          label: input.label,
          adminPrincipalId: input.issuer.adminPrincipalId,
          userId: input.issuer.userId,
          sourceAdminSessionId: input.issuer.adminSessionId,
          permissions: input.permissions,
          createdAt: input.now,
          expiresAt: input.expiresAt,
          revokedAt: null,
        };
      });
    },
    async authenticate(id, tokenHash, now) {
      const result = await runtime.query<Row>(
        activeGrant + " AND g.token_hash=$3",
        [id, now, tokenHash],
      );
      return result.rows[0] ? publicGrant(result.rows[0]) : null;
    },
    async rotate(input) {
      return runtime.transaction(async (tx) => {
        const result = await tx.query<Row>(
          activeGrant + " FOR UPDATE OF g,ap,u",
          [input.id, input.now],
        );
        const row = result.rows[0];
        if (!row) return null;
        if (
          row.previous_token_hash === input.tokenHash &&
          row.rotation_nonce_hash === input.nonceHash &&
          row.token_hash === input.replacementHash &&
          row.rotation_replay_until &&
          new Date(row.rotation_replay_until) > input.now
        ) {
          return { expiresAt: new Date(row.expires_at) };
        }
        if (row.token_hash !== input.tokenHash) return null;
        await tx.query(
          `UPDATE admin_maintenance_grants SET previous_token_hash=token_hash,
           token_hash=$2,rotation_nonce_hash=$3,rotation_replay_until=$4,expires_at=$5 WHERE id=$1`,
          [
            input.id,
            input.replacementHash,
            input.nonceHash,
            input.replayUntil,
            input.expiresAt,
          ],
        );
        await audit(
          tx,
          row.admin_principal_id,
          "MAINTENANCE_CREDENTIAL_ROTATED",
          input.id,
          input.correlationId,
        );
        return { expiresAt: input.expiresAt };
      });
    },
    async list(issuer, now) {
      return runtime.transaction(async (tx) => {
        const owner = await humanOwner(tx, issuer, now);
        if (!owner) return [];
        const result = await tx.query<Row>(
          `SELECT g.*,ap.user_id FROM admin_maintenance_grants g
           JOIN admin_principals ap ON ap.id=g.admin_principal_id
           WHERE g.admin_principal_id=$1 AND g.issuer_revision=$2
           ORDER BY (g.revoked_at IS NULL AND g.expires_at>$3) DESC,
                    g.created_at DESC LIMIT 100`,
          [issuer.adminPrincipalId, owner.revision, now],
        );
        return result.rows.map(publicGrant);
      });
    },
    async revoke(issuer, id, now, correlationId) {
      return runtime.transaction(async (tx) => {
        if (!(await humanOwner(tx, issuer, now))) return false;
        const result = await tx.query<{ id: string }>(
          `UPDATE admin_maintenance_grants SET revoked_at=COALESCE(revoked_at,$3)
           WHERE id=$1 AND admin_principal_id=$2 RETURNING id`,
          [id, issuer.adminPrincipalId, now],
        );
        if (!result.rows[0]) return false;
        await audit(
          tx,
          issuer.adminPrincipalId,
          "MAINTENANCE_GRANT_REVOKED",
          id,
          correlationId,
        );
        return true;
      });
    },
  };
}
