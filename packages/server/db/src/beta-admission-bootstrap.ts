import type { DatabaseRuntime } from "./index.js";

const INITIAL_BOOTSTRAP_LOCK_KEY =
  "product-control-plane/beta-admission/initial-bootstrap/v1";

export type InitialBetaAdmissionBootstrapResult =
  | {
      kind: "APPLIED";
      state: {
        mode: "OPEN";
        capacity: 1;
        admitted: 0;
        remaining: 1;
        revision: 2;
        updatedAt: Date;
      };
    }
  | { kind: "BOOTSTRAP_CLOSED" | "SERVICE_UNAVAILABLE" };

export async function bootstrapInitialBetaAdmission(
  runtime: DatabaseRuntime,
  input: { correlationId: string; reason: string },
): Promise<InitialBetaAdmissionBootstrapResult> {
  try {
    return await runtime.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        INITIAL_BOOTSTRAP_LOCK_KEY,
      ]);

      const activeGrant = await tx.query(
        "SELECT 1 FROM admin_role_grants WHERE revoked_at IS NULL LIMIT 1",
      );
      if (activeGrant.rows[0]) return { kind: "BOOTSTRAP_CLOSED" as const };

      const current = await tx.query<{
        mode: "CLOSED" | "OPEN" | "PAUSED";
        capacity: number | string;
        admitted: number | string;
        revision: number | string;
      }>(
        "SELECT mode,capacity,admitted,revision FROM beta_admission_state WHERE id=1 FOR UPDATE",
      );
      const row = current.rows[0];
      if (
        !row ||
        row.mode !== "CLOSED" ||
        Number(row.capacity) !== 0 ||
        Number(row.admitted) !== 0 ||
        Number(row.revision) !== 1
      )
        return { kind: "BOOTSTRAP_CLOSED" as const };

      const updated = await tx.query<{ updated_at: Date | string }>(
        `UPDATE beta_admission_state
            SET mode='OPEN',capacity=1,admitted=0,revision=2,updated_at=now()
          WHERE id=1
          RETURNING updated_at`,
      );
      const updatedAt = new Date(updated.rows[0]!.updated_at);
      await tx.query(
        `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
         VALUES('SYSTEM',NULL,'BETA_ADMISSION_INITIAL_BOOTSTRAPPED','BETA_ADMISSION_STATE',NULL,$1,$2,$3::jsonb)`,
        [
          input.correlationId,
          input.reason,
          JSON.stringify({
            old: { mode: "CLOSED", capacity: 0, admitted: 0, revision: 1 },
            new: { mode: "OPEN", capacity: 1, admitted: 0, revision: 2 },
          }),
        ],
      );
      return {
        kind: "APPLIED" as const,
        state: {
          mode: "OPEN" as const,
          capacity: 1 as const,
          admitted: 0 as const,
          remaining: 1 as const,
          revision: 2 as const,
          updatedAt,
        },
      };
    });
  } catch {
    return { kind: "SERVICE_UNAVAILABLE" };
  }
}
