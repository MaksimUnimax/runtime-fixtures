import type {
  BetaAdmissionRepository,
  BetaAdmissionState,
} from "@product/beta-access";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import {
  AdminMutationAuthorizationError,
  authorizeAdminMutationInTransaction,
} from "./admin-mutation-authorization.js";
import { safeAuditReason } from "./safe-audit.js";

const stateId = 1;

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
          `SELECT payload_hash,new_mode,new_capacity,new_admitted,new_revision,new_updated_at FROM beta_admission_mutations WHERE request_id_hash=$1`,
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
        if (
          !Number.isSafeInteger(newCapacity) ||
          newCapacity < current.admitted ||
          newCapacity > 2_147_483_647
        )
          return { kind: "CONFLICT" as const };

        const now = new Date();
        const nextRevision = current.revision + 1;
        const updated = await tx.query<{
          mode: "CLOSED" | "OPEN" | "PAUSED";
          capacity: number | string;
          admitted: number | string;
          revision: number | string;
          updated_at: Date | string;
        }>(
          `UPDATE beta_admission_state SET mode=$2,capacity=$3,revision=$4,updated_at=$5 WHERE id=$1 RETURNING mode,capacity,admitted,revision,updated_at`,
          [stateId, newMode, newCapacity, nextRevision, now],
        );
        const next = state(updated.rows[0]!);
        await tx.query(
          `INSERT INTO beta_admission_mutations(request_id_hash,payload_hash,actor_principal_id,action,old_mode,old_capacity,old_admitted,old_revision,new_mode,new_capacity,new_admitted,new_revision,new_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
          `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES('ADMIN',$1,'BETA_ADMISSION_CHANGED','BETA_ADMISSION_STATE',NULL,$2,$3,$4::jsonb)`,
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
