import type {
  BetaAdmissionRepository,
  BetaAdmissionState,
  BetaIdentityInvitation,
} from "@product/beta-access";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import {
  AdminMutationAuthorizationError,
  authorizeAdminMutationInTransaction,
} from "./admin-mutation-authorization.js";
import { safeAuditReason } from "./safe-audit.js";

const stateId = 1;
const invitationEmailPattern = /[^\s@]+@[^\s@]+\.[^\s@]+/gu;

function safeInvitationAuditReason(value: string) {
  return safeAuditReason(value).replace(
    invitationEmailPattern,
    "[REDACTED_EMAIL]",
  );
}
type InvitationRow = {
  id: string;
  normalized_identity_target: string;
  create_request_id_hash: string;
  create_payload_hash: string;
  created_at: Date | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  consumed_user_id: string | null;
  revoked_at: Date | string | null;
  revoke_request_id_hash: string | null;
  revoke_payload_hash: string | null;
};

function state(row: {
  mode: "CLOSED" | "OPEN" | "PAUSED";
  capacity: number | string;
  admitted: number | string;
  revision: number | string;
  updated_at: Date | string;
}): BetaAdmissionState {
  const capacity = Number(row.capacity);
  const admitted = Number(row.admitted);
  return {
    mode: row.mode,
    capacity,
    admitted,
    remaining: Math.max(0, capacity - admitted),
    revision: Number(row.revision),
    updatedAt: new Date(row.updated_at),
  };
}

function invitation(
  row: InvitationRow,
  at = new Date(),
): BetaIdentityInvitation {
  const expiresAt = new Date(row.expires_at);
  const consumedAt = row.consumed_at ? new Date(row.consumed_at) : null;
  const revokedAt = row.revoked_at ? new Date(row.revoked_at) : null;
  const status = consumedAt
    ? ("CONSUMED" as const)
    : revokedAt
      ? ("REVOKED" as const)
      : expiresAt <= at
        ? ("EXPIRED" as const)
        : ("PENDING" as const);
  return {
    id: row.id,
    status,
    createdAt: new Date(row.created_at),
    expiresAt,
    consumedAt,
    revokedAt,
  };
}

async function readState(query: DatabaseQuery, forUpdate = false) {
  const result = await query.query<{
    mode: "CLOSED" | "OPEN" | "PAUSED";
    capacity: number | string;
    admitted: number | string;
    revision: number | string;
    updated_at: Date | string;
  }>(
    `SELECT mode,capacity,admitted,revision,updated_at FROM beta_admission_state WHERE id=1${forUpdate ? " FOR UPDATE" : ""}`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("beta admission state is not initialized");
  return state(row);
}

async function activeInvitationCount(query: DatabaseQuery, at: Date) {
  const result = await query.query<{ count: number | string }>(
    `SELECT count(*)::bigint AS count
       FROM beta_identity_invitations
      WHERE consumed_at IS NULL
        AND revoked_at IS NULL
        AND expires_at>$1`,
    [at],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export function createBetaAdmissionRepository(
  runtime: DatabaseRuntime,
): BetaAdmissionRepository {
  return {
    async resolve(accountId) {
      const result = await runtime.query(
        `SELECT 1 FROM beta_admissions b JOIN accounts a ON a.id=b.account_id WHERE b.account_id=$1 AND a.status='ACTIVE'`,
        [accountId],
      );
      return result.rows[0]
        ? { kind: "BETA" as const }
        : { kind: "NONE" as const };
    },

    read: () => readState(runtime),

    async readIdentityInvitation(invitationId) {
      const result = await runtime.query<InvitationRow>(
        `SELECT id,normalized_identity_target,create_request_id_hash,create_payload_hash,
                created_at,expires_at,consumed_at,consumed_user_id,revoked_at,
                revoke_request_id_hash,revoke_payload_hash
           FROM beta_identity_invitations
          WHERE id=$1`,
        [invitationId],
      );
      return result.rows[0] ? invitation(result.rows[0]) : null;
    },

    async inviteIdentity(input) {
      return runtime.transaction(async (tx) => {
        try {
          await authorizeAdminMutationInTransaction(
            tx,
            input.actorPrincipalId,
            "beta.admission.manage",
          );
        } catch (error) {
          if (error instanceof AdminMutationAuthorizationError)
            return { kind: "FORBIDDEN" as const };
          throw error;
        }

        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.normalizedIdentityTarget],
        );

        const current = await readState(tx, true);

        const prior = await tx.query<InvitationRow>(
          `SELECT id,normalized_identity_target,create_request_id_hash,create_payload_hash,
                  created_at,expires_at,consumed_at,consumed_user_id,revoked_at,
                  revoke_request_id_hash,revoke_payload_hash
             FROM beta_identity_invitations
            WHERE create_request_id_hash=$1
            FOR UPDATE`,
          [input.requestIdHash],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].create_payload_hash !== input.payloadHash)
            return { kind: "CONFLICT" as const };
          return {
            kind: "APPLIED" as const,
            replay: true,
            invitation: invitation(prior.rows[0]),
          };
        }

        const identity = await tx.query(
          `SELECT 1
             FROM user_identities
            WHERE provider='EMAIL' AND normalized_identifier=$1`,
          [input.normalizedIdentityTarget],
        );
        if (identity.rows[0]) return { kind: "CONFLICT" as const };

        if (current.revision !== input.expectedRevision)
          return { kind: "STALE" as const };
        if (current.mode !== "CLOSED") return { kind: "CONFLICT" as const };

        const now = new Date();
        const existing = await tx.query(
          `SELECT 1
             FROM beta_identity_invitations
            WHERE normalized_identity_target=$1
              AND consumed_at IS NULL
              AND revoked_at IS NULL
              AND expires_at>$2
            LIMIT 1`,
          [input.normalizedIdentityTarget, now],
        );
        if (existing.rows[0]) return { kind: "CONFLICT" as const };

        const pending = await activeInvitationCount(tx, now);
        if (current.admitted + pending >= current.capacity)
          return { kind: "CAPACITY_REACHED" as const };

        const created = await tx.query<InvitationRow>(
          `INSERT INTO beta_identity_invitations(
              normalized_identity_target,create_request_id_hash,create_payload_hash,
              created_by_admin_principal_id,expires_at
            ) VALUES($1,$2,$3,$4,$5)
            RETURNING id,normalized_identity_target,create_request_id_hash,create_payload_hash,
                      created_at,expires_at,consumed_at,consumed_user_id,revoked_at,
                      revoke_request_id_hash,revoke_payload_hash`,
          [
            input.normalizedIdentityTarget,
            input.requestIdHash,
            input.payloadHash,
            input.actorPrincipalId,
            input.expiresAt,
          ],
        );
        const row = created.rows[0]!;
        await tx.query(
          `INSERT INTO audit_events(
              actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata
            ) VALUES('ADMIN',$1,'BETA_IDENTITY_INVITED','BETA_IDENTITY_INVITATION',$2,$3,$4,$5::jsonb)`,
          [
            input.actorPrincipalId,
            row.id,
            input.correlationId,
            safeInvitationAuditReason(input.reason),
            JSON.stringify({
              identityHash: input.identityHash,
              requestIdHash: input.requestIdHash,
              expiresAt: input.expiresAt.toISOString(),
            }),
          ],
        );
        return {
          kind: "APPLIED" as const,
          replay: false,
          invitation: invitation(row, now),
        };
      });
    },

    async revokeIdentityInvitation(input) {
      return runtime.transaction(async (tx) => {
        try {
          await authorizeAdminMutationInTransaction(
            tx,
            input.actorPrincipalId,
            "beta.admission.manage",
          );
        } catch (error) {
          if (error instanceof AdminMutationAuthorizationError)
            return { kind: "FORBIDDEN" as const };
          throw error;
        }

        const target = await tx.query<{ normalized_identity_target: string }>(
          `SELECT normalized_identity_target
             FROM beta_identity_invitations
            WHERE id=$1`,
          [input.invitationId],
        );
        if (!target.rows[0]) return { kind: "NOT_FOUND" as const };

        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [target.rows[0].normalized_identity_target],
        );
        await readState(tx, true);

        const priorRevoke = await tx.query<InvitationRow>(
          `SELECT id,normalized_identity_target,create_request_id_hash,create_payload_hash,
                  created_at,expires_at,consumed_at,consumed_user_id,revoked_at,
                  revoke_request_id_hash,revoke_payload_hash
             FROM beta_identity_invitations
            WHERE revoke_request_id_hash=$1
            FOR UPDATE`,
          [input.requestIdHash],
        );
        if (priorRevoke.rows[0]) {
          if (
            priorRevoke.rows[0].id !== input.invitationId ||
            priorRevoke.rows[0].revoke_payload_hash !== input.payloadHash
          )
            return { kind: "CONFLICT" as const };
          return {
            kind: "APPLIED" as const,
            replay: true,
            invitation: invitation(priorRevoke.rows[0]),
          };
        }

        const locked = await tx.query<InvitationRow>(
          `SELECT id,normalized_identity_target,create_request_id_hash,create_payload_hash,
                  created_at,expires_at,consumed_at,consumed_user_id,revoked_at,
                  revoke_request_id_hash,revoke_payload_hash
             FROM beta_identity_invitations
            WHERE id=$1
            FOR UPDATE`,
          [input.invitationId],
        );
        const row = locked.rows[0];
        if (!row) return { kind: "NOT_FOUND" as const };

        if (
          row.consumed_at ||
          row.revoked_at ||
          new Date(row.expires_at) <= new Date()
        )
          return { kind: "CONFLICT" as const };

        const now = new Date();
        const updated = await tx.query<InvitationRow>(
          `UPDATE beta_identity_invitations
              SET revoked_at=$2,
                  revoked_by_admin_principal_id=$3,
                  revoke_request_id_hash=$4,
                  revoke_payload_hash=$5
            WHERE id=$1
            RETURNING id,normalized_identity_target,create_request_id_hash,create_payload_hash,
                      created_at,expires_at,consumed_at,consumed_user_id,revoked_at,
                      revoke_request_id_hash,revoke_payload_hash`,
          [
            input.invitationId,
            now,
            input.actorPrincipalId,
            input.requestIdHash,
            input.payloadHash,
          ],
        );
        await tx.query(
          `INSERT INTO audit_events(
              actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata
            ) VALUES('ADMIN',$1,'BETA_IDENTITY_INVITATION_REVOKED','BETA_IDENTITY_INVITATION',$2,$3,$4,$5::jsonb)`,
          [
            input.actorPrincipalId,
            input.invitationId,
            input.correlationId,
            safeInvitationAuditReason(input.reason),
            JSON.stringify({ requestIdHash: input.requestIdHash }),
          ],
        );
        return {
          kind: "APPLIED" as const,
          replay: false,
          invitation: invitation(updated.rows[0]!, now),
        };
      });
    },

    async mutate(input) {
      return runtime.transaction(async (tx) => {
        try {
          await authorizeAdminMutationInTransaction(
            tx,
            input.actorPrincipalId,
            "beta.admission.manage",
          );
        } catch (error) {
          if (error instanceof AdminMutationAuthorizationError)
            return { kind: "FORBIDDEN" as const };
          throw error;
        }

        const current = await readState(tx, true);
        const prior = await tx.query<{
          payload_hash: string;
          new_mode: "CLOSED" | "OPEN" | "PAUSED";
          new_capacity: number | string;
          new_admitted: number | string;
          new_revision: number | string;
          new_updated_at: Date | string;
        }>(
          `SELECT payload_hash,new_mode,new_capacity,new_admitted,new_revision,new_updated_at
             FROM beta_admission_mutations
            WHERE request_id_hash=$1`,
          [input.requestIdHash],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].payload_hash !== input.payloadHash)
            return { kind: "CONFLICT" as const };
          return {
            kind: "APPLIED" as const,
            replay: true,
            state: {
              mode: prior.rows[0].new_mode,
              capacity: Number(prior.rows[0].new_capacity),
              admitted: Number(prior.rows[0].new_admitted),
              remaining: Math.max(
                0,
                Number(prior.rows[0].new_capacity) -
                  Number(prior.rows[0].new_admitted),
              ),
              revision: Number(prior.rows[0].new_revision),
              updatedAt: new Date(prior.rows[0].new_updated_at),
            },
          };
        }
        if (current.revision !== input.expectedRevision)
          return { kind: "STALE" as const };

        let newMode = current.mode;
        let newCapacity = current.capacity;
        if (input.action === "OPEN") newMode = "OPEN";
        if (input.action === "PAUSE") newMode = "PAUSED";
        if (input.action === "CLOSE") newMode = "CLOSED";
        if (input.action === "ADD_CAPACITY")
          newCapacity = current.capacity + (input.amount ?? 0);
        if (input.action === "SET_CAPACITY")
          newCapacity = input.capacity ?? current.capacity;

        const now = new Date();
        const pending = await activeInvitationCount(tx, now);
        if (
          !Number.isSafeInteger(newCapacity) ||
          newCapacity < current.admitted + pending ||
          newCapacity > 2_147_483_647
        )
          return { kind: "CONFLICT" as const };

        const nextRevision = current.revision + 1;
        const updated = await tx.query<{
          mode: "CLOSED" | "OPEN" | "PAUSED";
          capacity: number | string;
          admitted: number | string;
          revision: number | string;
          updated_at: Date | string;
        }>(
          `UPDATE beta_admission_state
              SET mode=$2,capacity=$3,revision=$4,updated_at=$5
            WHERE id=$1
            RETURNING mode,capacity,admitted,revision,updated_at`,
          [stateId, newMode, newCapacity, nextRevision, now],
        );
        const next = state(updated.rows[0]!);
        await tx.query(
          `INSERT INTO beta_admission_mutations(
              request_id_hash,payload_hash,actor_principal_id,action,
              old_mode,old_capacity,old_admitted,old_revision,
              new_mode,new_capacity,new_admitted,new_revision,new_updated_at
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            input.requestIdHash,
            input.payloadHash,
            input.actorPrincipalId,
            input.action,
            current.mode,
            current.capacity,
            current.admitted,
            current.revision,
            next.mode,
            next.capacity,
            next.admitted,
            next.revision,
            next.updatedAt,
          ],
        );
        await tx.query(
          `INSERT INTO audit_events(
              actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata
            ) VALUES('ADMIN',$1,'BETA_ADMISSION_CHANGED','BETA_ADMISSION_STATE',NULL,$2,$3,$4::jsonb)`,
          [
            input.actorPrincipalId,
            input.correlationId,
            safeAuditReason(input.reason),
            JSON.stringify({
              action: input.action,
              requestIdHash: input.requestIdHash,
              old: {
                mode: current.mode,
                capacity: current.capacity,
                admitted: current.admitted,
                revision: current.revision,
              },
              new: {
                mode: next.mode,
                capacity: next.capacity,
                admitted: next.admitted,
                revision: next.revision,
              },
            }),
          ],
        );
        return { kind: "APPLIED" as const, replay: false, state: next };
      });
    },
  };
}
