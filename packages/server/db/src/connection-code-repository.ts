import { randomUUID } from "node:crypto";
import type {
  ConnectionCodeRepository,
  ConnectionCredentialSummary,
} from "@product/device-management";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { enrollDeviceInTransaction } from "./device-enrollment.js";
import { revokeDeviceInTransaction } from "./device-revocation.js";

type CredentialRow = {
  id: string;
  account_id: string;
  issued_by_user_id: string;
  generation: number;
  created_at: Date;
  revoked_at: Date | null;
  issue_operation_hash: string;
  issue_request_fingerprint: string;
};
function summary(row: CredentialRow): ConnectionCredentialSummary {
  return {
    credentialId: row.id,
    generation: row.generation,
    createdAt: new Date(row.created_at),
    active: row.revoked_at === null,
  };
}
async function lockAccount(tx: DatabaseQuery, accountId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    "p5-subscription-account:" + accountId,
  ]);
}
async function portalOwner(
  tx: DatabaseQuery,
  input: {
    accountId: string;
    portalUserId: string;
    portalSessionId: string;
    now: Date;
  },
  lock: boolean,
) {
  const q = await tx.query<{ authenticated_at: Date }>(
    "SELECT p.created_at authenticated_at FROM accounts a " +
      "JOIN account_memberships m ON m.account_id=a.id AND m.role='OWNER' " +
      "JOIN users u ON u.id=m.user_id " +
      "JOIN portal_sessions p ON p.user_id=u.id " +
      "WHERE a.id=$1 AND u.id=$2 AND p.id=$3 AND a.status='ACTIVE' AND u.status='ACTIVE' " +
      "AND p.revoked_at IS NULL AND p.expires_at>$4 " +
      (lock ? "FOR UPDATE OF a FOR SHARE OF p,u,m" : ""),
    [input.accountId, input.portalUserId, input.portalSessionId, input.now],
  );
  return q.rows[0];
}

export function createConnectionCodeRepository(
  runtime: DatabaseRuntime,
): ConnectionCodeRepository {
  return {
    async listTransferDevices(input) {
      if (!(await portalOwner(runtime, input, false)))
        return { kind: "forbidden" };
      const rows = await runtime.query<{
        id: string;
        label: string | null;
        created_at: Date;
        credential_transfer_approved_at: Date | null;
      }>(
        "SELECT id,label,created_at,credential_transfer_approved_at FROM devices " +
          "WHERE account_id=$1 AND status='ACTIVE' AND connection_credential_id IS NOT NULL ORDER BY created_at DESC,id",
        [input.accountId],
      );
      return {
        kind: "ok",
        devices: rows.rows.map((row) => ({
          deviceId: row.id,
          label: row.label,
          createdAt: new Date(row.created_at),
          approvedAt: row.credential_transfer_approved_at
            ? new Date(row.credential_transfer_approved_at)
            : null,
        })),
      };
    },
    async approveTransfer(input) {
      return runtime.transaction(async (tx) => {
        await lockAccount(tx, input.accountId);
        const owner = await portalOwner(tx, input, true);
        if (!owner) return { kind: "forbidden" as const };
        const authenticatedAt = new Date(owner.authenticated_at);
        if (authenticatedAt < input.freshAfter || authenticatedAt > input.now)
          return { kind: "reauth-required" as const };
        const device = await tx.query<{
          id: string;
          credential_transfer_approved_at: Date | null;
        }>(
          "SELECT id,credential_transfer_approved_at FROM devices WHERE id=$1 AND account_id=$2 " +
            "AND status='ACTIVE' AND revoked_at IS NULL AND connection_credential_id IS NOT NULL FOR UPDATE",
          [input.deviceId, input.accountId],
        );
        if (!device.rows[0]) return { kind: "not-found" as const };
        const prior = device.rows[0].credential_transfer_approved_at;
        if (prior)
          return {
            kind: "approved" as const,
            deviceId: input.deviceId,
            approvedAt: new Date(prior),
          };
        await tx.query(
          "UPDATE devices SET credential_transfer_approved_at=$2,credential_transfer_approved_by_user_id=$3 WHERE id=$1",
          [input.deviceId, input.now, input.portalUserId],
        );
        await tx.query(
          "INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id) " +
            "VALUES('USER',$1,'CONNECTION_DEVICE_TRANSFER_APPROVED','DEVICE',$2,$3)",
          [input.portalUserId, input.deviceId, input.correlationId],
        );
        return {
          kind: "approved" as const,
          deviceId: input.deviceId,
          approvedAt: input.now,
        };
      });
    },

    async consumeRate(input) {
      const start = new Date(
        Math.floor(input.now.getTime() / input.windowMs) * input.windowMs,
      );
      const q = await runtime.query<{ count: number }>(
        "INSERT INTO auth_rate_limit_buckets(action,key_hash,window_started_at,count,updated_at) " +
          "VALUES($1,$2,$3,1,$4) ON CONFLICT(action,key_hash) DO UPDATE SET " +
          "count=CASE WHEN auth_rate_limit_buckets.window_started_at=EXCLUDED.window_started_at " +
          "THEN auth_rate_limit_buckets.count+1 ELSE 1 END," +
          "window_started_at=EXCLUDED.window_started_at,updated_at=EXCLUDED.updated_at RETURNING count",
        [input.action, input.keyHash, start, input.now],
      );
      if (!q.rows[0]) throw new Error("CONNECTION_RATE_OUTCOME_UNKNOWN");
      return Number(q.rows[0].count) <= input.limit
        ? { allowed: true }
        : {
            allowed: false,
            retryAfterSeconds: Math.max(
              1,
              Math.ceil(
                (start.getTime() + input.windowMs - input.now.getTime()) / 1000,
              ),
            ),
          };
    },
    async status(input) {
      if (!(await portalOwner(runtime, input, false)))
        return { kind: "forbidden" };
      const q = await runtime.query<CredentialRow>(
        "SELECT * FROM account_connection_credentials WHERE account_id=$1 ORDER BY generation DESC LIMIT 1",
        [input.accountId],
      );
      return { kind: "ok", credential: q.rows[0] ? summary(q.rows[0]) : null };
    },
    async issue(input) {
      return runtime.transaction(async (tx) => {
        await lockAccount(tx, input.accountId);
        const owner = await portalOwner(tx, input, true);
        if (!owner) return { kind: "forbidden" as const };
        const authenticatedAt = new Date(owner.authenticated_at);
        if (authenticatedAt < input.freshAfter || authenticatedAt > input.now)
          return { kind: "reauth-required" as const };
        const prior = await tx.query<CredentialRow>(
          "SELECT * FROM account_connection_credentials WHERE account_id=$1 AND issue_operation_hash=$2",
          [input.accountId, input.operationHash],
        );
        if (prior.rows[0]) {
          if (
            prior.rows[0].issue_request_fingerprint !== input.requestFingerprint
          )
            return { kind: "conflict" as const };
          return {
            kind: "already-issued" as const,
            credential: summary(prior.rows[0]),
          };
        }
        const latest = await tx.query<CredentialRow>(
          "SELECT * FROM account_connection_credentials WHERE account_id=$1 ORDER BY generation DESC LIMIT 1 FOR UPDATE",
          [input.accountId],
        );
        const generation = latest.rows[0]?.generation ?? 0;
        if (
          generation !== input.expectedGeneration ||
          (input.mode === "CREATE") !== (generation === 0) ||
          generation >= 2_147_483_647
        )
          return { kind: "conflict" as const };
        await tx.query(
          "UPDATE account_connection_credentials SET revoked_at=$2,revocation_reason='REPLACED' " +
            "WHERE account_id=$1 AND revoked_at IS NULL",
          [input.accountId, input.now],
        );
        let revokedDevices = 0;
        if (input.mode === "REPLACE_REVOKE_DEVICES") {
          const devices = await tx.query<{ id: string }>(
            "SELECT id FROM devices WHERE account_id=$1 AND status='ACTIVE' ORDER BY id FOR UPDATE",
            [input.accountId],
          );
          for (const device of devices.rows) {
            const result = await revokeDeviceInTransaction(tx, {
              deviceId: device.id,
              expectedAccountId: input.accountId,
              actorType: "USER",
              actorId: input.portalUserId,
              deviceRevokeReason: "USER_REVOKED",
              deviceAuditAction: "DEVICE_REVOKED",
              correlationId: input.correlationId,
              now: input.now,
            });
            if (result === "revoked") revokedDevices += 1;
          }
        }
        const inserted = await tx.query<CredentialRow>(
          "INSERT INTO account_connection_credentials(id,account_id,issued_by_user_id,verifier_hash," +
            "generation,issue_operation_hash,issue_request_fingerprint,created_at) " +
            "VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            randomUUID(),
            input.accountId,
            input.portalUserId,
            input.verifierHash,
            generation + 1,
            input.operationHash,
            input.requestFingerprint,
            input.now,
          ],
        );
        if (!inserted.rows[0])
          throw new Error("CONNECTION_ISSUE_OUTCOME_UNKNOWN");
        await tx.query(
          "INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,safe_metadata) " +
            "VALUES('USER',$1,'CONNECTION_CODE_ISSUED','CONNECTION_CREDENTIAL',$2,$3,$4::jsonb)",
          [
            input.portalUserId,
            inserted.rows[0].id,
            input.correlationId,
            JSON.stringify({
              accountId: input.accountId,
              generation: generation + 1,
              mode: input.mode,
              revokedDevices,
            }),
          ],
        );
        return {
          kind: "created" as const,
          credential: summary(inserted.rows[0]),
          revokedDevices,
        };
      });
    },
    async exchange(input) {
      return runtime.transaction(async (tx) => {
        // Lookup only finds the account lock; recheck the credential after acquiring it.
        const lookup = await tx.query<{ account_id: string }>(
          "SELECT account_id FROM account_connection_credentials WHERE verifier_hash=$1",
          [input.verifierHash],
        );
        if (!lookup.rows[0]) return { kind: "closed" as const };
        await lockAccount(tx, lookup.rows[0].account_id);
        const found = await tx.query<CredentialRow>(
          "SELECT * FROM account_connection_credentials WHERE verifier_hash=$1 FOR UPDATE",
          [input.verifierHash],
        );
        const credential = found.rows[0];
        if (!credential || credential.revoked_at !== null)
          return { kind: "closed" as const };
        const eligible = await tx.query<{ id: string }>(
          "SELECT a.id FROM accounts a JOIN users u ON u.id=$2 " +
            "JOIN account_memberships m ON m.account_id=a.id AND m.user_id=u.id AND m.role='OWNER' " +
            "WHERE a.id=$1 AND a.status='ACTIVE' AND u.status='ACTIVE' FOR UPDATE OF a FOR SHARE OF u,m",
          [credential.account_id, credential.issued_by_user_id],
        );
        if (!eligible.rows[0]) return { kind: "closed" as const };
        const prior = await tx.query<{
          request_fingerprint: string;
          device_id: string;
          session_id: string;
          replay_until: Date;
        }>(
          "SELECT request_fingerprint,device_id,session_id,replay_until " +
            "FROM connection_exchange_receipts WHERE credential_id=$1 AND operation_hash=$2",
          [credential.id, input.operationHash],
        );
        const receipt = prior.rows[0];
        if (receipt) {
          if (receipt.request_fingerprint !== input.requestFingerprint)
            return { kind: "conflict" as const };
          if (new Date(receipt.replay_until) <= input.now)
            return { kind: "closed" as const };
          const replay = await tx.query<{ expires_at: Date }>(
            "SELECT r.expires_at FROM devices d " +
              "JOIN sessions s ON s.id=$2 AND s.device_id=d.id AND s.account_id=d.account_id " +
              "JOIN refresh_tokens r ON r.session_id=s.id AND r.generation=0 " +
              "WHERE d.id=$1 AND d.account_id=$3 AND d.connection_credential_id=$4 " +
              "AND d.status='ACTIVE' AND d.revoked_at IS NULL AND s.status='ACTIVE' AND s.revoked_at IS NULL " +
              "AND (s.expires_at IS NULL OR s.expires_at>$6) " +
              "AND r.token_hash=$5 AND r.consumed_at IS NULL AND r.replaced_by_token_id IS NULL " +
              "AND r.reuse_detected_at IS NULL AND r.expires_at>$6 FOR SHARE OF d,s,r",
            [
              receipt.device_id,
              receipt.session_id,
              credential.account_id,
              credential.id,
              input.refreshTokenHash,
              input.now,
            ],
          );
          if (!replay.rows[0]) return { kind: "closed" as const };
          return {
            kind: "replay" as const,
            accountId: credential.account_id,
            deviceId: receipt.device_id,
            sessionId: receipt.session_id,
            refreshTokenExpiresAt: new Date(replay.rows[0].expires_at),
          };
        }
        const enrolled = await enrollDeviceInTransaction(tx, {
          accountId: credential.account_id,
          ownerUserId: credential.issued_by_user_id,
          clientMetadata: { state: "WITHHELD" },
          deviceLabel: input.deviceLabel,
          refreshTokenHash: input.refreshTokenHash,
          refreshTokenExpiresAt: input.refreshTokenExpiresAt,
          now: input.now,
          correlationId: input.correlationId,
          source: { kind: "CONNECTION_CREDENTIAL", id: credential.id },
          resolveLimit: input.resolveLimit,
        });
        if (enrolled.kind !== "activated") return enrolled;
        await tx.query(
          "INSERT INTO connection_exchange_receipts(credential_id,operation_hash,request_fingerprint," +
            "device_id,session_id,created_at,replay_until) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            credential.id,
            input.operationHash,
            input.requestFingerprint,
            enrolled.deviceId,
            enrolled.sessionId,
            input.now,
            input.replayUntil,
          ],
        );
        return enrolled;
      });
    },
  };
}
