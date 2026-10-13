import { TransferError } from "@product/credential-transfer";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

/**
 * C06 SOURCE WIP ONLY. The matching mandatory database trigger and migration
 * must be independently accepted before this may be wired to the live API.
 * Every transfer mutation, including read-side expiry and expireDue, must
 * execute inside fencedTransaction; direct runtime.query is not permitted.
 */
export interface CredentialTransferWriterEpoch {
  readonly epoch: string;
  readonly instanceId: string;
}

export interface CredentialTransferEpochFence {
  claim(): Promise<CredentialTransferWriterEpoch>;
  fencedTransaction<T>(
    action: (transaction: DatabaseQuery) => Promise<T>,
  ): Promise<T>;
  deactivate(): void;
  isActive(): boolean;
}

const MAX_PG_BIGINT = 9223372036854775807n;

/**
 * A PostgreSQL row-locked ownership generation. The database functions take
 * FOR UPDATE for election and FOR SHARE before any business read/write.
 * The API needs EXECUTE, not direct UPDATE on the epoch table.
 *
 * This does not certify runtime-role isolation, the mandatory trigger,
 * old-binary rollout, late network replies or restore/rollback monotonicity.
 */
export function createCredentialTransferEpochFence(
  runtime: DatabaseRuntime,
  instanceId: string,
): CredentialTransferEpochFence {
  let claimed: CredentialTransferWriterEpoch | null = null;
  let claimAttempted = false;
  let inactive = false;

  const assertActive = (): void => {
    if (inactive) throw new TransferError("TRANSFER_CONFLICT");
  };
  const assertPinned = (identity: CredentialTransferWriterEpoch): void => {
    assertActive();
    if (claimed !== identity) throw new TransferError("TRANSFER_CONFLICT");
  };

  return {
    async claim(): Promise<CredentialTransferWriterEpoch> {
      assertActive();
      if (claimAttempted)
        throw new Error("TRANSFER_EPOCH_CLAIM_RETRY_FORBIDDEN");
      // An ambiguous COMMIT must never cause a blind second election.
      claimAttempted = true;
      const state = await runtime.transaction(async (tx) => {
        assertActive();
        const reply = await tx.query<{
          epoch: string;
          owner_instance_id: string;
        }>(
          `SELECT epoch::text, owner_instance_id::text
           FROM octoport_transfer_fence.claim_writer($1::uuid)`,
          [instanceId],
        );
        assertActive();
        const row = reply.rows[0];
        if (
          reply.rows.length !== 1 ||
          typeof row?.epoch !== "string" ||
          !/^[1-9][0-9]*$/.test(row.epoch) ||
          BigInt(row.epoch) > MAX_PG_BIGINT ||
          row.owner_instance_id !== instanceId
        )
          throw new Error("TRANSFER_EPOCH_ELECTION_UNVERIFIED");
        return Object.freeze({ epoch: row.epoch, instanceId });
      });
      // Even a confirmed election must not reactivate a locally stopped API.
      assertActive();
      claimed = state;
      return state;
    },

    async fencedTransaction<T>(
      action: (transaction: DatabaseQuery) => Promise<T>,
    ): Promise<T> {
      const identity = claimed;
      if (!identity) throw new TransferError("TRANSFER_CONFLICT");
      assertPinned(identity);
      return runtime.transaction(async (tx) => {
        assertPinned(identity);
        // Authorization protects public tables, so every business query must
        // resolve the same tables even when a pooled connection has a custom
        // path or temporary names. SET LOCAL cannot change a later transaction.
        await tx.query("SET LOCAL search_path=pg_catalog,public,pg_temp");
        assertPinned(identity);
        let reply: { rows: { epoch: string; owner_instance_id: string }[] };
        try {
          // The function locks and establishes transaction-local context.
          // This transaction, not the function, owns the eventual COMMIT.
          reply = await tx.query<{
            epoch: string;
            owner_instance_id: string;
          }>(
            `SELECT epoch::text, owner_instance_id::text
             FROM octoport_transfer_fence.authorize_writer($1::bigint,$2::uuid)`,
            [identity.epoch, identity.instanceId],
          );
        } catch (error) {
          const code =
            error !== null && typeof error === "object" && "code" in error
              ? error.code
              : undefined;
          if (code === "PTF01" || code === "PTF02") {
            inactive = true;
            claimed = null;
            throw new TransferError("TRANSFER_CONFLICT");
          }
          // Permission, transport and ambiguous outcomes retain their error.
          // No hidden business retry or fabricated ACK is introduced.
          throw error;
        }
        assertPinned(identity);
        if (
          reply.rows.length !== 1 ||
          reply.rows[0]?.epoch !== identity.epoch ||
          reply.rows[0]?.owner_instance_id !== identity.instanceId
        ) {
          inactive = true;
          claimed = null;
          throw new TransferError("TRANSFER_CONFLICT");
        }
        assertPinned(identity);
        return action(tx);
      });
    },

    isActive() {
      return !inactive && claimed !== null;
    },

    deactivate() {
      inactive = true;
      claimed = null;
    },
  };
}
