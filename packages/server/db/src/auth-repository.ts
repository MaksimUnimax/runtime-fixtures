import { randomUUID } from "node:crypto";
import type { AuthRepository, AuthResult } from "@product/auth";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

const windowMs = 15 * 60_000;
async function consume(
  runtime: DatabaseQuery,
  action: string,
  key: string,
  limit: number,
): Promise<boolean> {
  const now = new Date();
  const windowStartedAt = new Date(
    Math.floor(now.getTime() / windowMs) * windowMs,
  );
  const result = await runtime.query<{ count: number }>(
    `INSERT INTO auth_rate_limit_buckets(action,key_hash,window_started_at,count,updated_at) VALUES($1,$2,$3,1,$4) ON CONFLICT(action,key_hash) DO UPDATE SET count=CASE WHEN auth_rate_limit_buckets.window_started_at=EXCLUDED.window_started_at THEN LEAST(auth_rate_limit_buckets.count+1,1000000) ELSE 1 END,window_started_at=EXCLUDED.window_started_at,updated_at=EXCLUDED.updated_at RETURNING count`,
    [action, key, windowStartedAt, now],
  );
  return Number(result.rows[0]?.count) <= limit;
}
export function createAuthRepository(runtime: DatabaseRuntime): AuthRepository {
  return {
    async listOwnedAccounts(userId) {
      const result = await runtime.query<{
        id: string;
        display_name: string | null;
        status: "ACTIVE" | "SUSPENDED";
      }>(
        `SELECT a.id,a.display_name,a.status FROM accounts a JOIN account_memberships m ON m.account_id=a.id WHERE m.user_id=$1 AND m.role='OWNER' AND a.status IN ('ACTIVE','SUSPENDED') ORDER BY a.created_at ASC,a.id ASC`,
        [userId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        status: row.status,
      }));
    },
    async requestOtp(input) {
      return runtime.transaction(async (tx) => {
        const now = new Date();
        // Serialize one identity's replacement/cooldown sequence. This lock is
        // transaction-scoped and the normalized email never leaves the database.
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.email],
        );
        const [target, ip] = await Promise.all([
          consume(tx, "OTP_REQUEST_TARGET", input.targetKey, 3),
          consume(tx, "OTP_REQUEST_IP", input.ipKey, 20),
        ]);
        const cooldown = await tx.query<{ id: string }>(
          `SELECT id FROM otp_challenges WHERE purpose='LOGIN' AND normalized_identity_target=$1 AND created_at>$2 AND consumed_at IS NULL AND invalidated_at IS NULL`,
          [input.email, new Date(now.getTime() - 60_000)],
        );
        if (!target || !ip || cooldown.rows.length) {
          await tx.query(
            `INSERT INTO audit_events(actor_type,action,target_type,correlation_id,reason) VALUES('ANONYMOUS','AUTH_OTP_RATE_LIMITED','OTP',$1,'AUTH_RATE_LIMITED')`,
            [input.correlationId],
          );
          return { ok: false, code: "AUTH_RATE_LIMITED" } as AuthResult<never>;
        }
        await tx.query(
          `UPDATE otp_email_jobs SET status='DEAD',ciphertext=NULL,nonce=NULL,auth_tag=NULL,lease_id=NULL,leased_until=NULL WHERE challenge_id IN (SELECT id FROM otp_challenges WHERE purpose='LOGIN' AND normalized_identity_target=$1 AND consumed_at IS NULL AND invalidated_at IS NULL)`,
          [input.email],
        );
        await tx.query(
          `UPDATE otp_challenges SET invalidated_at=$2,invalidation_reason='SUPERSEDED' WHERE purpose='LOGIN' AND normalized_identity_target=$1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
          [input.email, now],
        );
        await tx.query(
          `INSERT INTO otp_challenges(id,purpose,normalized_identity_target,verification_hash,max_attempts,expires_at) VALUES($1,'LOGIN',$2,$3,5,$4)`,
          [
            input.challengeId,
            input.email,
            input.verificationHash,
            input.expiresAt,
          ],
        );
        const jobId = randomUUID();
        await tx.query(
          `INSERT INTO otp_email_jobs(id,challenge_id,ciphertext,nonce,auth_tag,max_attempts,correlation_id) VALUES($1,$2,$3,$4,$5,5,$6)`,
          [
            jobId,
            input.challengeId,
            input.envelope.ciphertext,
            input.envelope.nonce,
            input.envelope.authTag,
            input.correlationId,
          ],
        );
        await tx.query(
          `INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id,safe_metadata) VALUES('ANONYMOUS','AUTH_OTP_REQUESTED','OTP',$1,$2,jsonb_build_object('purpose','LOGIN','jobId',$3::text))`,
          [input.challengeId, input.correlationId, jobId],
        );
        return {
          ok: true,
          value: { challengeId: input.challengeId, expiresAt: input.expiresAt },
        };
      });
    },
    async verifyOtp(input) {
      return runtime.transaction(async (tx) => {
        if (!(await consume(tx, "OTP_VERIFY_IP", input.ipKey, 30)))
          return { ok: false, code: "AUTH_RATE_LIMITED" } as AuthResult<never>;
        const challenge = await tx.query<{
          id: string;
          normalized_identity_target: string;
          verification_hash: string;
          attempt_count: number;
          max_attempts: number;
          expires_at: Date;
          consumed_at: Date | null;
          invalidated_at: Date | null;
        }>(`SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE`, [
          input.challengeId,
        ]);
        const c = challenge.rows[0];
        const now = new Date();
        if (!c)
          return { ok: false, code: "AUTH_OTP_INVALID" } as AuthResult<never>;
        if (c.consumed_at) {
          const replay = await tx.query<{ user_id: string; expires_at: Date }>(
            `SELECT r.user_id,s.expires_at FROM otp_verify_replays r JOIN portal_sessions s ON s.id=r.portal_session_id JOIN users u ON u.id=r.user_id WHERE r.challenge_id=$1 AND r.idempotency_hash=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='ACTIVE'`,
            [c.id, input.idempotencyHash],
          );
          if (replay.rows[0])
            return {
              ok: true,
              value: {
                sessionToken: "",
                expiresAt: new Date(replay.rows[0].expires_at),
              },
            } as AuthResult<{ sessionToken: string; expiresAt: Date }>;
          return { ok: false, code: "AUTH_OTP_INVALID" } as AuthResult<never>;
        }
        if (
          c.invalidated_at ||
          new Date(c.expires_at) <= now ||
          c.attempt_count >= c.max_attempts
        )
          return { ok: false, code: "AUTH_OTP_INVALID" } as AuthResult<never>;
        if (!input.verify(c.normalized_identity_target, c.verification_hash)) {
          await tx.query(
            `UPDATE otp_challenges SET attempt_count=LEAST(attempt_count+1,max_attempts) WHERE id=$1`,
            [c.id],
          );
          await tx.query(
            `INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id,reason) VALUES('ANONYMOUS','AUTH_OTP_VERIFY_FAILED','OTP',$1,$2,'AUTH_OTP_INVALID')`,
            [c.id, input.correlationId],
          );
          return { ok: false, code: "AUTH_OTP_INVALID" } as AuthResult<never>;
        }
        const claimed = await tx.query<{ id: string }>(
          `UPDATE otp_challenges SET consumed_at=$2 WHERE id=$1 AND consumed_at IS NULL RETURNING id`,
          [c.id, now],
        );
        if (!claimed.rows[0])
          return { ok: false, code: "AUTH_OTP_INVALID" } as AuthResult<never>;
        // This lock prevents two independent valid challenges from bootstrapping
        // separate users/accounts for the same first-time identity.
        await tx.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [c.normalized_identity_target],
        );
        const identity = await tx.query<{ user_id: string; status: string }>(
          `SELECT i.user_id,u.status FROM user_identities i JOIN users u ON u.id=i.user_id WHERE i.provider='EMAIL' AND i.normalized_identifier=$1`,
          [c.normalized_identity_target],
        );
        let userId: string;
        if (!identity.rows[0]) {
          const beta = await tx.query<{
            mode: "CLOSED" | "OPEN" | "PAUSED";
            capacity: number | string;
            admitted: number | string;
          }>(
            "SELECT mode,capacity,admitted FROM beta_admission_state WHERE id=1 FOR UPDATE",
          );
          const betaState = beta.rows[0];
          if (!betaState)
            throw new Error("beta admission state is not initialized");

          const invitations = await tx.query<{ id: string }>(
            `SELECT id
               FROM beta_identity_invitations
              WHERE normalized_identity_target=$1
                AND consumed_at IS NULL
                AND revoked_at IS NULL
                AND expires_at>clock_timestamp()
              ORDER BY created_at ASC,id ASC
              FOR UPDATE`,
            [c.normalized_identity_target],
          );
          if (invitations.rows.length > 1)
            throw new Error("multiple active beta identity invitations");
          const invited = invitations.rows[0];

          if (
            betaState.mode === "PAUSED" ||
            (betaState.mode === "CLOSED" && !invited)
          )
            return { ok: false, code: "BETA_CLOSED" } as AuthResult<never>;

          const capacity = Number(betaState.capacity);
          const admitted = Number(betaState.admitted);
          if (invited) {
            if (admitted >= capacity)
              return {
                ok: false,
                code: "BETA_CAPACITY_REACHED",
              } as AuthResult<never>;
          } else {
            const reservations = await tx.query<{ count: number | string }>(
              `SELECT count(*)::bigint AS count
                 FROM beta_identity_invitations
                WHERE consumed_at IS NULL
                  AND revoked_at IS NULL
                  AND expires_at>clock_timestamp()`,
            );
            if (admitted + Number(reservations.rows[0]?.count ?? 0) >= capacity)
              return {
                ok: false,
                code: "BETA_CAPACITY_REACHED",
              } as AuthResult<never>;
          }

          const admissionNow = new Date();
          userId = randomUUID();
          const accountId = randomUUID();
          await tx.query(`INSERT INTO users(id) VALUES($1)`, [userId]);
          await tx.query(`INSERT INTO accounts(id) VALUES($1)`, [accountId]);
          await tx.query(
            `INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$2,'OWNER')`,
            [accountId, userId],
          );
          await tx.query(
            `INSERT INTO user_identities(user_id,provider,normalized_identifier,verified_at) VALUES($1,'EMAIL',$2,$3)`,
            [userId, c.normalized_identity_target, admissionNow],
          );
          await tx.query(
            `INSERT INTO beta_admissions(account_id,user_id,admitted_at) VALUES($1,$2,$3)`,
            [accountId, userId, admissionNow],
          );
          const admittedRow = await tx.query<{ admitted: number | string }>(
            `UPDATE beta_admission_state
                SET admitted=admitted+1,updated_at=$1
              WHERE id=1 AND admitted<capacity
              RETURNING admitted`,
            [admissionNow],
          );
          if (!admittedRow.rows[0])
            throw new Error("beta admission state changed unexpectedly");

          if (invited) {
            const consumed = await tx.query(
              `UPDATE beta_identity_invitations
                  SET consumed_at=clock_timestamp(),consumed_user_id=$2
                WHERE id=$1
                  AND consumed_at IS NULL
                  AND revoked_at IS NULL
                  AND expires_at>clock_timestamp()
                RETURNING id`,
              [invited.id, userId],
            );
            if (!consumed.rows[0])
              throw new Error("beta identity invitation changed unexpectedly");
            await tx.query(
              `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,safe_metadata)
               VALUES('USER',$1,'BETA_IDENTITY_INVITATION_CONSUMED','BETA_IDENTITY_INVITATION',$2,$3,jsonb_build_object('accessBasis','TARGETED_INVITATION'))`,
              [userId, invited.id, input.correlationId],
            );
          }

          await tx.query(
            `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id) VALUES('SYSTEM',$1,'AUTH_IDENTITY_CREATED','USER',$1,$2)`,
            [userId, input.correlationId],
          );
          await tx.query(
            `INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id,safe_metadata) VALUES('SYSTEM','BETA_ACCOUNT_ADMITTED','ACCOUNT',$1,$2,jsonb_build_object('accessBasis',$3::text))`,
            [
              accountId,
              input.correlationId,
              invited ? "TARGETED_INVITATION" : "BETA",
            ],
          );
        } else {
          userId = identity.rows[0].user_id;
          if (identity.rows[0].status === "SUSPENDED") {
            await tx.query(
              `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason) VALUES('SYSTEM',$1,'AUTH_LOGIN_DENIED','USER',$1,$2,'AUTH_LOGIN_DENIED')`,
              [userId, input.correlationId],
            );
            return {
              ok: false,
              code: "AUTH_LOGIN_DENIED",
            } as AuthResult<never>;
          }
        }
        const sessionId = randomUUID();
        await tx.query(
          `INSERT INTO portal_sessions(id,user_id,session_token_hash,expires_at) VALUES($1,$2,$3,$4)`,
          [sessionId, userId, input.sessionHash, input.expiresAt],
        );
        await tx.query(
          `INSERT INTO otp_verify_replays(challenge_id,idempotency_hash,user_id,portal_session_id,expires_at) VALUES($1,$2,$3,$4,$5)`,
          [c.id, input.idempotencyHash, userId, sessionId, input.expiresAt],
        );
        await tx.query(
          `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id) VALUES('USER',$1,'AUTH_OTP_VERIFIED','OTP',$2,$3),('USER',$1,'PORTAL_SESSION_CREATED','PORTAL_SESSION',$4,$3)`,
          [userId, c.id, input.correlationId, sessionId],
        );
        return {
          ok: true,
          value: { sessionToken: "", expiresAt: input.expiresAt },
        };
      });
    },
    async authenticate(hash) {
      const r = await runtime.query<{
        id: string;
        user_id: string;
        created_at: Date;
      }>(
        `SELECT s.id,s.user_id,s.created_at FROM portal_sessions s JOIN users u ON u.id=s.user_id WHERE s.session_token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='ACTIVE'`,
        [hash],
      );
      return r.rows[0]
        ? {
            sessionId: r.rows[0].id,
            userId: r.rows[0].user_id,
            createdAt: new Date(r.rows[0].created_at),
          }
        : undefined;
    },
    async revoke(hash, correlationId) {
      return runtime.transaction(async (tx) => {
        const r = await tx.query<{ id: string; user_id: string }>(
          `UPDATE portal_sessions SET revoked_at=now(),revoke_reason='LOGOUT' WHERE session_token_hash=$1 AND revoked_at IS NULL AND expires_at>now() RETURNING id,user_id`,
          [hash],
        );
        if (!r.rows[0]) return "missing";
        await tx.query(
          `INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id) VALUES('USER',$1,'PORTAL_SESSION_REVOKED','PORTAL_SESSION',$2,$3)`,
          [r.rows[0].user_id, r.rows[0].id, correlationId],
        );
        return "revoked";
      });
    },
  };
}
