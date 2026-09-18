import type { SyncRepository, SyncRepositoryResult } from "@product/sync";
import type { ExtensionPrincipal } from "@product/extension-auth";
import type { SellerAgentsSyncEntryV1 } from "@product/contracts";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

type Row = { fingerprint: string; mutation_id: string; entity_id: string; outcome: "ACK" | "CONFLICT" | "RETRY"; server_revision: number; server_state: SellerAgentsSyncEntryV1["payload"] | null; code: string | null };
const result = (row: Row): SyncRepositoryResult => ({ outcome: row.outcome, serverRevision: Number(row.server_revision), serverState: row.server_state, code: row.code });

export function createSyncRepository(runtime: DatabaseRuntime): SyncRepository {
  return {
    async apply({ principal, entry, fingerprint }) {
      return runtime.transaction(async (tx: DatabaseQuery) => {
        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`sync:request:${principal.accountId}:${principal.deviceId}:${entry.requestId}`],
        );
        const receipts = await tx.query<Row>(
          `SELECT fingerprint,mutation_id,entity_id,outcome,server_revision,server_state,code FROM sync_request_receipts WHERE account_id=$1 AND installation_id=$2 AND request_id=$3 FOR UPDATE`,
          [principal.accountId, principal.deviceId, entry.requestId],
        );
        const prior = receipts.rows[0];
        if (prior) {
          if (prior.fingerprint !== fingerprint || prior.mutation_id !== entry.mutationId || prior.entity_id !== entry.entityId) throw new Error("SYNC_REQUEST_ID_CONFLICT");
          return result(prior);
        }
        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`sync:entity:${principal.accountId}:${entry.entityId}`],
        );
        const entities = await tx.query<{ server_revision: number; state: SellerAgentsSyncEntryV1["payload"] }>(
          `SELECT server_revision,state FROM sync_entities WHERE account_id=$1 AND entity_id=$2 FOR UPDATE`,
          [principal.accountId, entry.entityId],
        );
        const current = entities.rows[0] || { server_revision: 0, state: null };
        let outcome: "ACK" | "CONFLICT" = "ACK";
        let serverRevision = Number(current.server_revision || 0);
        let serverState = current.state;
        let code: string | null = null;
        if (entry.baseRevision !== serverRevision) {
          outcome = "CONFLICT"; code = "SYNC_CONFLICT";
        } else {
          serverRevision += 1;
          serverState = entry.payload;
          await tx.query(
            `INSERT INTO sync_entities(account_id,entity_id,server_revision,state,installation_id,updated_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(account_id,entity_id) DO UPDATE SET server_revision=EXCLUDED.server_revision,state=EXCLUDED.state,installation_id=EXCLUDED.installation_id,updated_at=EXCLUDED.updated_at`,
            [principal.accountId, entry.entityId, serverRevision, JSON.stringify(serverState), principal.deviceId],
          );
        }
        await tx.query(
          `INSERT INTO sync_request_receipts(account_id,installation_id,request_id,entity_id,mutation_id,fingerprint,outcome,server_revision,server_state,code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [principal.accountId, principal.deviceId, entry.requestId, entry.entityId, entry.mutationId, fingerprint, outcome, serverRevision, serverState ? JSON.stringify(serverState) : null, code],
        );
        return { outcome, serverRevision, serverState, code };
      });
    },
  };
}
