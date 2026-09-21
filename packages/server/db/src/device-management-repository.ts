import { randomUUID } from "node:crypto";
import type { DeviceManagementRepository } from "@product/device-management";
import { decideSellerAgentsDeviceAdmission } from "@product/entitlements";
import type { DatabaseRuntime } from "./index.js";
import { revokeDeviceInTransaction } from "./device-revocation.js";

export function createDeviceManagementRepository(
  runtime: DatabaseRuntime,
): DeviceManagementRepository {
  return {
    async consumeExchangeRate(input) {
      const started = new Date(
        Math.floor(input.now.getTime() / input.windowMs) * input.windowMs,
      );
      const q = await runtime.query<{ count: number; window_started_at: Date }>(
        `INSERT INTO auth_rate_limit_buckets(action,key_hash,window_started_at,count,updated_at) VALUES('DEVICE_AUTH_EXCHANGE_IP',$1,$2,1,$3) ON CONFLICT(action,key_hash) DO UPDATE SET count=CASE WHEN auth_rate_limit_buckets.window_started_at=EXCLUDED.window_started_at THEN auth_rate_limit_buckets.count+1 ELSE 1 END,window_started_at=EXCLUDED.window_started_at,updated_at=EXCLUDED.updated_at RETURNING count,window_started_at`,
        [input.keyHash, started, input.now],
      );
      const row = q.rows[0];
      if (!row || Number(row.count) <= input.limit) return { allowed: true };
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (new Date(row.window_started_at).getTime() +
              input.windowMs -
              input.now.getTime()) /
              1000,
          ),
        ),
      };
    },
    async exchange(input) {
      return runtime.transaction(async (tx) => {
        const found = await tx.query<Record<string, unknown>>(
          `SELECT * FROM device_authorizations WHERE device_code_hash=$1 FOR UPDATE`,
          [input.deviceCodeHash],
        );
        const a = found.rows[0];
        if (!a) return { kind: "closed" as const };
        const status = String(a.status),
          now = input.now;
        if (status === "PENDING") return { kind: "pending" as const };
        if (status === "DENIED" || status === "EXPIRED")
          return { kind: "closed" as const };
        if (status === "EXCHANGED") {
          if (
            a.exchange_idempotency_key_hash !== input.idempotencyHash ||
            !a.exchange_replay_until ||
            new Date(String(a.exchange_replay_until)) < now
          )
            return { kind: "closed" as const };
          const replay = await tx.query<{
            device_id: string;
            session_id: string;
            account_id: string;
          }>(
            `SELECT d.id device_id,s.id session_id,s.account_id FROM devices d
           JOIN sessions s ON s.id=$2 AND s.device_id=d.id AND s.account_id=d.account_id
           JOIN refresh_tokens r ON r.session_id=s.id AND r.generation=0 AND r.token_hash=$3
           JOIN accounts ac ON ac.id=s.account_id
           JOIN users u ON u.id=d.created_by_user_id
           WHERE d.id=$1 AND d.status='ACTIVE' AND s.status='ACTIVE'
             AND ac.status='ACTIVE' AND u.status='ACTIVE'`,
            [
              a.exchanged_device_id,
              a.exchanged_session_id,
              input.refreshTokenHash,
            ],
          );
          return replay.rows[0]
            ? {
                kind: "replay" as const,
                deviceId: replay.rows[0].device_id,
                sessionId: replay.rows[0].session_id,
                accountId: replay.rows[0].account_id,
              }
            : { kind: "closed" as const };
        }
        if (
          status !== "APPROVED" ||
          !a.approved_account_id ||
          !a.approved_user_id
        )
          return { kind: "closed" as const };
        if (new Date(String(a.expires_at)) <= now) {
          await tx.query(
            `UPDATE device_authorizations SET status='EXPIRED',expired_at=$2,start_secret_ciphertext=NULL,start_secret_nonce=NULL,start_secret_auth_tag=NULL WHERE id=$1`,
            [a.id, now],
          );
          await tx.query(
            `INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id)
             VALUES('SYSTEM','DEVICE_AUTHORIZATION_EXPIRED','DEVICE_AUTHORIZATION',$1,$2)`,
            [a.id, input.correlationId],
          );
          return { kind: "closed" as const };
        }
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`p5-subscription-account:${a.approved_account_id}`],
        );
        const eligible = await tx.query<{ id: string }>(
          `SELECT a.id FROM accounts a
             JOIN users u ON u.id=$2
             JOIN account_memberships m ON m.account_id=a.id AND m.user_id=u.id AND m.role='OWNER'
            WHERE a.id=$1 AND a.status='ACTIVE' AND u.status='ACTIVE'
            FOR UPDATE OF a`,
          [a.approved_account_id, a.approved_user_id],
        );
        if (!eligible.rows[0]) return { kind: "closed" as const };
        let limit;
        try {
          limit = await input.resolveLimit(String(a.approved_account_id), now);
        } catch {
          return { kind: "invalid-limit" as const };
        }
        if ("kind" in limit) {
          if (limit.kind === "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT") {
            // Beta installations remain persisted and revocable, but are not
            // subject to the commercial max_active entitlement.
          } else {
            if (limit.kind === "INELIGIBLE")
              return { kind: "subscription-required" as const };
            if (limit.kind === "ACCOUNT_NOT_FOUND")
              return { kind: "closed" as const };
            return { kind: "invalid-limit" as const };
          }
        }
        if (!("kind" in limit)) {
          const count = await tx.query<{ count: string }>(
            `SELECT count(*) count FROM devices WHERE account_id=$1 AND status='ACTIVE'`,
            [a.approved_account_id],
          );
          const activeDeviceCount = Number(count.rows[0]?.count);
          // Zero is retained as the historical deny-all compatibility value.
          // New commercial plans use the explicit UNLIMITED | positive FINITE
          // provider-neutral model.
          const decision =
            limit.maxActive === 0
              ? {
                  kind: "DENY" as const,
                  reason: "DEVICE_LIMIT_REACHED" as const,
                }
              : decideSellerAgentsDeviceAdmission({
                  limit: { kind: "FINITE", value: limit.maxActive },
                  activeDeviceCount,
                  alreadyAdmitted: false,
                });
          if (decision.kind === "DENY") {
            await tx.query(
              `INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id) VALUES('SYSTEM','DEVICE_ACTIVATION_LIMIT_REACHED','DEVICE_AUTHORIZATION',$1,$2)`,
              [a.id, input.correlationId],
            );
            return { kind: "limit" as const };
          }
        }
        const deviceId = randomUUID(),
          sessionId = randomUUID();
        await tx.query(
          `INSERT INTO devices(id,account_id,created_by_user_id,status,label,browser_family,browser_version_last_seen,extension_version_last_seen,created_at,activated_at,last_seen_at) VALUES($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8,$8,$8)`,
          [
            deviceId,
            a.approved_account_id,
            a.approved_user_id,
            a.device_label,
            a.browser_family,
            a.browser_version,
            a.extension_version,
            now,
          ],
        );
        await tx.query(
          `INSERT INTO sessions(id,device_id,account_id,status,token_family_id,created_at) VALUES($1,$2,$3,'ACTIVE',$4,$5)`,
          [sessionId, deviceId, a.approved_account_id, randomUUID(), now],
        );
        await tx.query(
          `INSERT INTO refresh_tokens(id,session_id,token_hash,generation,issued_at,expires_at) VALUES($1,$2,$3,0,$4,$5)`,
          [
            randomUUID(),
            sessionId,
            input.refreshTokenHash,
            now,
            new Date(now.getTime() + 30 * 24 * 60 * 60_000),
          ],
        );
        await tx.query(
          `UPDATE device_authorizations SET status='EXCHANGED',exchanged_at=$2,exchange_idempotency_key_hash=$3,exchange_replay_until=$4,exchanged_device_id=$5,exchanged_session_id=$6,start_secret_ciphertext=NULL,start_secret_nonce=NULL,start_secret_auth_tag=NULL WHERE id=$1`,
          [
            a.id,
            now,
            input.idempotencyHash,
            input.replayUntil,
            deviceId,
            sessionId,
          ],
        );
        for (const action of [
          "DEVICE_ACTIVATED",
          "EXTENSION_SESSION_CREATED",
          "EXTENSION_REFRESH_ISSUED",
        ])
          await tx.query(
            `INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id) VALUES('SYSTEM',$1,$2,$3,$4)`,
            [
              action,
              action === "DEVICE_ACTIVATED"
                ? "DEVICE"
                : action === "EXTENSION_SESSION_CREATED"
                  ? "SESSION"
                  : "REFRESH_TOKEN",
              action === "DEVICE_ACTIVATED" ? deviceId : sessionId,
              input.correlationId,
            ],
          );
        return {
          kind: "activated" as const,
          deviceId,
          sessionId,
          accountId: String(a.approved_account_id),
        };
      });
    },
    async list(input) {
      const authorized = await runtime.query<{ id: string }>(
        `SELECT a.id FROM accounts a JOIN account_memberships m ON m.account_id=a.id WHERE a.id=$1 AND m.user_id=$2 AND m.role='OWNER'`,
        [input.accountId, input.portalUserId],
      );
      if (!authorized.rows[0]) return { kind: "forbidden" as const };
      let cursor: { created_at: Date; id: string } | undefined;
      if (input.cursor) {
        const q = await runtime.query<{ created_at: Date; id: string }>(
          `SELECT created_at,id FROM devices WHERE id=$1 AND account_id=$2`,
          [input.cursor, input.accountId],
        );
        cursor = q.rows[0];
        if (!cursor) return { kind: "invalid-cursor" as const };
      }
      const q = await runtime.query<Record<string, unknown>>(
        `SELECT id,status,label,browser_family,browser_version_last_seen,extension_version_last_seen,created_at,activated_at,last_seen_at,revoked_at FROM devices WHERE account_id=$1 ${cursor ? `AND (created_at,id)<($2,$3)` : ""} ORDER BY created_at DESC,id DESC LIMIT $${cursor ? 4 : 2}`,
        [
          input.accountId,
          ...(cursor ? [cursor.created_at, cursor.id] : []),
          input.limit + 1,
        ],
      );
      const rows = q.rows.slice(0, input.limit).map((r) => ({
        id: String(r.id),
        status: String(r.status) as "ACTIVE" | "REVOKED",
        label: r.label as string | null,
        browserFamily: String(r.browser_family),
        browserVersionLastSeen: r.browser_version_last_seen as string | null,
        extensionVersionLastSeen: r.extension_version_last_seen as
          | string
          | null,
        createdAt: new Date(String(r.created_at)),
        activatedAt: r.activated_at ? new Date(String(r.activated_at)) : null,
        lastSeenAt: r.last_seen_at ? new Date(String(r.last_seen_at)) : null,
        revokedAt: r.revoked_at ? new Date(String(r.revoked_at)) : null,
      }));
      return {
        kind: "ok" as const,
        devices: rows,
        ...(q.rows.length > input.limit && rows.length
          ? { nextCursor: rows.at(-1)!.id }
          : {}),
      };
    },
    async revoke(input) {
      return runtime.transaction(async (tx) => {
        const q = await tx.query<{ account_id: string }>(
          `SELECT d.account_id FROM devices d JOIN account_memberships m ON m.account_id=d.account_id AND m.user_id=$2 AND m.role='OWNER' WHERE d.id=$1`,
          [input.deviceId, input.portalUserId],
        );
        if (!q.rows[0]) return "not-found" as const;
        return revokeDeviceInTransaction(tx, {
          deviceId: input.deviceId,
          expectedAccountId: q.rows[0].account_id,
          actorType: "USER",
          actorId: input.portalUserId,
          deviceRevokeReason: "USER_REVOKED",
          deviceAuditAction: "DEVICE_REVOKED",
          correlationId: input.correlationId,
        });
      });
    },
  };
}
