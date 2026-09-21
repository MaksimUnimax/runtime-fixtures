import { randomUUID } from "node:crypto";
import type { EmailProvider } from "@product/auth";
import { decryptOtpDelivery, type AuthKeys } from "@product/auth";
import { EmailProviderError } from "@product/email";
import type { DatabaseRuntime } from "@product/db";
import type { JobRunner } from "./lifecycle.js";
export class OtpEmailRunner implements JobRunner {
  private timer: NodeJS.Timeout | undefined;
  public constructor(
    private readonly db: DatabaseRuntime,
    private readonly keys: AuthKeys,
    private readonly provider: EmailProvider,
  ) {}
  async start() {
    this.timer = setInterval(() => void this.tick(), 5000);
    await this.tick();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    const lease = randomUUID();
    // A recovered lease which has already reached its send budget must never
    // produce a sixth provider attempt.
    await this.db.query(
      `UPDATE otp_email_jobs SET status='DEAD',ciphertext=NULL,nonce=NULL,auth_tag=NULL,lease_id=NULL,leased_until=NULL,last_error_code='SEND_ATTEMPTS_EXHAUSTED',updated_at=now() WHERE status='PROCESSING' AND leased_until<now() AND attempt_count>=max_attempts`,
    );
    const job = await this.db.query<{
      id: string;
      challenge_id: string;
      ciphertext: Buffer;
      nonce: Buffer;
      auth_tag: Buffer;
      attempt_count: number;
      max_attempts: number;
      normalized_identity_target: string;
      expires_at: Date;
      consumed_at: Date | null;
      invalidated_at: Date | null;
    }>(
      `WITH candidate AS (SELECT j.id FROM otp_email_jobs j WHERE ((j.status='PENDING' AND j.available_at<=now()) OR (j.status='PROCESSING' AND j.leased_until<now())) AND j.attempt_count<j.max_attempts ORDER BY j.available_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE otp_email_jobs j SET status='PROCESSING',lease_id=$1,leased_until=now()+interval '60 seconds',attempt_count=j.attempt_count+1,updated_at=now() FROM candidate WHERE j.id=candidate.id RETURNING j.id,j.challenge_id,j.ciphertext,j.nonce,j.auth_tag,j.attempt_count,j.max_attempts`,
      [lease],
    );
    const row = job.rows[0];
    if (!row) return;
    const challenge = await this.db.query<{
      normalized_identity_target: string;
      expires_at: Date;
      consumed_at: Date | null;
      invalidated_at: Date | null;
    }>(
      `SELECT normalized_identity_target,expires_at,consumed_at,invalidated_at FROM otp_challenges WHERE id=$1`,
      [row.challenge_id],
    );
    const c = challenge.rows[0];
    const dead = async (code: string) =>
      this.db.query(
        `UPDATE otp_email_jobs SET status='DEAD',ciphertext=NULL,nonce=NULL,auth_tag=NULL,lease_id=NULL,leased_until=NULL,last_error_code=$2,updated_at=now() WHERE id=$1 AND lease_id=$3`,
        [row.id, code, lease],
      );
    if (
      !c ||
      c.consumed_at ||
      c.invalidated_at ||
      new Date(c.expires_at) <= new Date()
    )
      return void (await dead("CHALLENGE_TERMINAL"));
    const otp = decryptOtpDelivery(
      this.keys,
      row.challenge_id,
      c.normalized_identity_target,
      { ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.auth_tag },
    );
    if (!otp) return void (await dead("DELIVERY_ENVELOPE_INVALID"));
    try {
      const sent = await this.provider.sendLoginOtp({
        deliveryId: row.id,
        recipient: c.normalized_identity_target,
        otpCode: otp,
        expiresAt: new Date(c.expires_at),
      });
      await this.db.query(
        `UPDATE otp_email_jobs SET status='SENT',sent_at=now(),ciphertext=NULL,nonce=NULL,auth_tag=NULL,lease_id=NULL,leased_until=NULL,provider_message_id=$2,updated_at=now() WHERE id=$1 AND lease_id=$3`,
        [row.id, sent.providerMessageId ?? null, lease],
      );
    } catch (error) {
      const classified =
        error instanceof EmailProviderError
          ? error
          : new EmailProviderError("UNKNOWN_OUTCOME", false);
      const exhausted = row.attempt_count >= row.max_attempts;
      const errorCode =
        classified.kind === "UNKNOWN_OUTCOME"
          ? "EMAIL_PROVIDER_TIMEOUT_OR_UNKNOWN"
          : classified.kind === "PROTOCOL_FAILURE"
            ? "EMAIL_PROVIDER_PROTOCOL_FAILURE"
            : classified.providerStatus
              ? `EMAIL_PROVIDER_HTTP_${classified.providerStatus}`
              : "EMAIL_PROVIDER_REJECTED";
      await this.db.query(
        exhausted || !classified.retryable
          ? `UPDATE otp_email_jobs SET status='DEAD',ciphertext=NULL,nonce=NULL,auth_tag=NULL,lease_id=NULL,leased_until=NULL,last_error_code=$3,updated_at=now() WHERE id=$1 AND lease_id=$2`
          : `UPDATE otp_email_jobs SET status='PENDING',lease_id=NULL,leased_until=NULL,available_at=now()+interval '30 seconds',last_error_code=$3,updated_at=now() WHERE id=$1 AND lease_id=$2`,
        [row.id, lease, errorCode],
      );
    }
  }
}
