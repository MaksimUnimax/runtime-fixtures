import type { SyncRepository, SyncRepositoryResult } from "@product/sync";
import type { SellerAgentsSyncEntryV1 } from "@product/contracts";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { applyReconciliationEntry, SyncRequestError } from "@product/sync";

type Row = {
  fingerprint: string;
  mutation_id: string;
  entity_id: string;
  outcome: "ACK" | "CONFLICT" | "RETRY";
  server_revision: number;
  server_state: SellerAgentsSyncEntryV1["payload"] | null;
  code: string | null;
};
const result = (row: Row): SyncRepositoryResult => ({
  outcome: row.outcome,
  serverRevision: Number(row.server_revision),
  serverState: row.server_state,
  code: row.code,
});

const isBindingEntry = (entry: SellerAgentsSyncEntryV1): boolean =>
  entry.kind === "BINDING_UPSERT" ||
  entry.kind === "FINISH" ||
  entry.kind === "DELIVERY_MARKER";

export function createSyncRepository(runtime: DatabaseRuntime): SyncRepository {
  return {
    async apply({ principal, entry, fingerprint }) {
      return runtime.transaction(async (tx: DatabaseQuery) => {
        // Re-check and lock durable authority inside the same transaction as
        // the sync write. This closes the preHandler -> repository revocation
        // race: either sync holds a shared authority lock and commits first,
        // or revocation commits first and this request fails closed.
        const authority = await tx.query<{ id: string }>(
          `SELECT s.id FROM sessions s
           JOIN devices d ON d.id=s.device_id AND d.account_id=s.account_id
           JOIN accounts a ON a.id=s.account_id
           JOIN users u ON u.id=d.created_by_user_id
           WHERE s.id=$1 AND d.id=$2 AND a.id=$3
             AND s.status='ACTIVE' AND s.revoked_at IS NULL
             AND d.status='ACTIVE' AND d.revoked_at IS NULL
             AND a.status='ACTIVE' AND u.status='ACTIVE'
           FOR SHARE OF s,d,a,u`,
          [principal.sessionId, principal.deviceId, principal.accountId],
        );
        if (!authority.rows[0]) throw new Error("EXTENSION_AUTH_UNAUTHORIZED");

        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [
            `sync:request:${principal.accountId}:${principal.deviceId}:${entry.requestId}`,
          ],
        );
        const receipts = await tx.query<Row>(
          `SELECT fingerprint,mutation_id,entity_id,outcome,server_revision,server_state,code FROM sync_request_receipts WHERE account_id=$1 AND installation_id=$2 AND request_id=$3 FOR UPDATE`,
          [principal.accountId, principal.deviceId, entry.requestId],
        );
        const prior = receipts.rows[0];
        if (prior) {
          if (
            prior.fingerprint !== fingerprint ||
            prior.mutation_id !== entry.mutationId ||
            prior.entity_id !== entry.entityId
          )
            throw new Error("SYNC_REQUEST_ID_CONFLICT");
          return result(prior);
        }
        const isBinding = isBindingEntry(entry);
        const canonicalEntityId = isBinding
          ? `conversation:${entry.payload.conversationKeyDigest}`
          : entry.entityId;
        if (
          isBinding &&
          entry.entityId.startsWith("conversation:") &&
          entry.entityId !== canonicalEntityId
        )
          throw new SyncRequestError("SYNC_CANONICAL_ENTITY_MISMATCH");
        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`sync:entity:${principal.accountId}:${canonicalEntityId}`],
        );
        if (isBinding && entry.entityId !== canonicalEntityId)
          await tx.query(
            `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [`sync:entity:${principal.accountId}:${entry.entityId}`],
          );
        const entities = await tx.query<{
          entity_id: string;
          server_revision: number;
          state: SellerAgentsSyncEntryV1["payload"];
        }>(
          isBinding
            ? `SELECT entity_id,server_revision,state FROM sync_entities WHERE account_id=$1 AND (entity_id=$2 OR (state->>'conversationKeyDigest'=$3 AND state->>'kind' IN ('BINDING_UPSERT','FINISH','DELIVERY_MARKER'))) FOR UPDATE`
            : `SELECT entity_id,server_revision,state FROM sync_entities WHERE account_id=$1 AND entity_id=$2 FOR UPDATE`,
          isBinding
            ? [
                principal.accountId,
                canonicalEntityId,
                entry.payload.conversationKeyDigest,
              ]
            : [principal.accountId, entry.entityId],
        );
        if (isBinding && entities.rows.length > 1)
          throw new SyncRequestError("SYNC_CANONICAL_ENTITY_COLLISION");
        const physical = entities.rows[0];
        if (
          isBinding &&
          physical &&
          (physical.state?.conversationKeyDigest !==
            entry.payload.conversationKeyDigest ||
            !["BINDING_UPSERT", "FINISH", "DELIVERY_MARKER"].includes(
              physical.state?.kind,
            ))
        )
          throw new SyncRequestError("SYNC_CANONICAL_ENTITY_COLLISION");
        const current = physical || { server_revision: 0, state: null };
        const serverRevision = Number(current.server_revision || 0);
        const preferredInstallationId =
          current.state?.reconciliation?.preferred?.installationId || null;
        const revokedInstallationIds: string[] = [];
        if (preferredInstallationId) {
          const device = await tx.query<{ status: string }>(
            `SELECT status FROM devices WHERE account_id=$1 AND id=$2`,
            [principal.accountId, preferredInstallationId],
          );
          if (device.rows[0] && device.rows[0].status !== "ACTIVE")
            revokedInstallationIds.push(preferredInstallationId);
        }
        const reconciliation = applyReconciliationEntry({
          current: current.state,
          serverRevision,
          entry: isBinding ? { ...entry, entityId: canonicalEntityId } : entry,
          principal,
          receiveAtMs: Date.now(),
          revokedInstallationIds,
        });
        if (reconciliation.outcome === "ACK" && reconciliation.serverState) {
          if (physical) {
            await tx.query(
              `UPDATE sync_entities SET entity_id=$3,server_revision=$4,state=$5,installation_id=$6,updated_at=now() WHERE account_id=$1 AND entity_id=$2`,
              [
                principal.accountId,
                physical.entity_id,
                canonicalEntityId,
                reconciliation.serverRevision,
                JSON.stringify(reconciliation.serverState),
                principal.deviceId,
              ],
            );
          } else {
            await tx.query(
              `INSERT INTO sync_entities(account_id,entity_id,server_revision,state,installation_id,updated_at) VALUES($1,$2,$3,$4,$5,now())`,
              [
                principal.accountId,
                canonicalEntityId,
                reconciliation.serverRevision,
                JSON.stringify(reconciliation.serverState),
                principal.deviceId,
              ],
            );
          }
        }
        await tx.query(
          `INSERT INTO sync_request_receipts(account_id,installation_id,request_id,entity_id,mutation_id,fingerprint,outcome,server_revision,server_state,code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            principal.accountId,
            principal.deviceId,
            entry.requestId,
            entry.entityId,
            entry.mutationId,
            fingerprint,
            reconciliation.outcome,
            reconciliation.serverRevision,
            reconciliation.serverState
              ? JSON.stringify(reconciliation.serverState)
              : null,
            reconciliation.code,
          ],
        );
        return reconciliation;
      });
    },
  };
}
