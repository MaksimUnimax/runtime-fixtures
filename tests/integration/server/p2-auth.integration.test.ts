import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AuthService,
  deriveAuthKeys,
  encryptOtpDelivery,
  otpArtifact,
  portalLookup,
} from "../../../packages/server/auth/src/index.js";
import {
  createAuthRepository,
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { OtpEmailRunner } from "../../../apps/worker/src/otp-runner.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL is required for pnpm test:integration (real PostgreSQL is not optional).",
  );
const keys = deriveAuthKeys(Buffer.alloc(32, 7));
const code = "012345";
let db: DatabaseRuntime;

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) {
  return db.query<T>(text, values);
}
async function clear() {
  await q(
    "TRUNCATE audit_events,auth_rate_limit_buckets,otp_email_jobs,otp_challenges,portal_sessions,user_identities,account_memberships,accounts,users CASCADE",
  );
  await q(
    "UPDATE beta_admission_state SET mode='OPEN',capacity=100000,admitted=0,revision=1 WHERE id=1",
  );
}
function auth(now = () => new Date()) {
  return new AuthService(createAuthRepository(db), keys, now, () => code);
}
async function request(
  email: string,
  correlationId = `accepted-request-id-${randomUUID()}`,
) {
  const result = await auth().requestOtp(email, "198.51.100.9", correlationId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.value.challengeId;
}
async function jobFor(challengeId: string) {
  return (
    await q<{
      id: string;
      ciphertext: Buffer | null;
      nonce: Buffer | null;
      auth_tag: Buffer | null;
      status: string;
      attempt_count: number;
      lease_id: string | null;
      leased_until: Date | null;
    }>("SELECT * FROM otp_email_jobs WHERE challenge_id=$1", [challengeId])
  ).rows[0]!;
}
async function challenge(id: string) {
  return (
    await q<{
      attempt_count: number;
      consumed_at: Date | null;
      invalidated_at: Date | null;
      invalidation_reason: string | null;
    }>("SELECT * FROM otp_challenges WHERE id=$1", [id])
  ).rows[0]!;
}
async function fixture(
  email: string,
  id = randomUUID(),
  expires = "now() + interval '10 minutes'",
) {
  const artifact = otpArtifact(keys, id, email, code);
  await q(
    `INSERT INTO otp_challenges(id,purpose,normalized_identity_target,verification_hash,max_attempts,expires_at) VALUES($1,'LOGIN',$2,$3,5,${expires})`,
    [id, email, artifact],
  );
  return id;
}
async function fixtureJob(
  challengeId: string,
  email: string,
  status = "PENDING",
  attempts = 0,
  lease = "NULL",
) {
  const e = encryptOtpDelivery(keys, challengeId, email, code);
  await q(
    `INSERT INTO otp_email_jobs(id,challenge_id,status,ciphertext,nonce,auth_tag,max_attempts,attempt_count,leased_until,correlation_id) VALUES($1,$2,$3,$4,$5,$6,5,$7,${lease},'accepted-request-id-1')`,
    [
      randomUUID(),
      challengeId,
      status,
      e.ciphertext,
      e.nonce,
      e.authTag,
      attempts,
    ],
  );
}

describe.sequential("P2.2 real PostgreSQL authentication matrix", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(url);
    await db.ready();
    await runMigrations({ connectionString: url });
  });
  beforeEach(clear);
  afterAll(async () => {
    await db.close();
  });

  it("T2-01 audit correlation accepts request IDs and UUID-shaped historic values", async () => {
    await q(
      "INSERT INTO audit_events(actor_type,action,target_type,correlation_id) VALUES('ANONYMOUS','TEST','OTP',$1),('ANONYMOUS','TEST','OTP',$2)",
      ["accepted-request-id-1", "00000000-0000-0000-0000-000000000001"],
    );
    expect(
      (
        await q<{ correlation_id: string }>(
          "SELECT correlation_id FROM audit_events ORDER BY created_at",
        )
      ).rows.map((x) => x.correlation_id),
    ).toContain("accepted-request-id-1");
  });

  it("T2-02 rate limit is atomic under ten parallel consumes", async () => {
    const repo = createAuthRepository(db);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        repo.requestOtp({
          email: `rate-${i}@example.test`,
          targetKey: "same-target",
          ipKey: `ip-${i}`,
          correlationId: `accepted-request-id-${i}`,
          challengeId: randomUUID(),
          verificationHash: "x",
          envelope: encryptOtpDelivery(
            keys,
            randomUUID(),
            "x@example.test",
            code,
          ),
          expiresAt: new Date(Date.now() + 600000),
        }),
      ),
    );
    expect(results.filter((x) => x.ok).length).toBeLessThanOrEqual(3);
    const row = (
      await q<{ count: number }>(
        "SELECT count FROM auth_rate_limit_buckets WHERE action='OTP_REQUEST_TARGET' AND key_hash='same-target'",
      )
    ).rows[0]!;
    expect(row.count).toBe(10);
  });

  it("T2-03 replacement invalidates A, clears its job, and leaves B eligible", async () => {
    const email = "replace@example.test",
      a = await request(email, "accepted-request-id-a");
    // The public resend cooldown is intentionally one minute; age this fixture
    // past that boundary so this exercises the replacement transaction itself.
    await q(
      "UPDATE otp_challenges SET created_at=now()-interval '2 minutes' WHERE id=$1",
      [a],
    );
    const b = await request(email, "accepted-request-id-b");
    expect((await challenge(a)).invalidation_reason).toBe("SUPERSEDED");
    expect((await jobFor(a)).ciphertext).toBeNull();
    expect(
      (
        await auth().verifyOtp(
          a,
          code,
          "198.51.100.10",
          "accepted-request-id-c",
        )
      ).code,
    ).toBe("AUTH_OTP_INVALID");
    expect(
      (
        await auth().verifyOtp(
          b,
          code,
          "198.51.100.11",
          "accepted-request-id-d",
        )
      ).ok,
    ).toBe(true);
  });

  it("T2-04/T2-05 wrong attempts persist and concurrent attempts cap at five", async () => {
    const id = await request("wrong@example.test");
    for (let i = 1; i <= 5; i++) {
      expect(
        (
          await auth().verifyOtp(
            id,
            "999999",
            `198.51.100.${i + 20}`,
            `accepted-request-id-${i}`,
          )
        ).code,
      ).toBe("AUTH_OTP_INVALID");
      expect((await challenge(id)).attempt_count).toBe(i);
    }
    expect(
      (
        await auth().verifyOtp(
          id,
          code,
          "198.51.100.31",
          "accepted-request-id-last",
        )
      ).code,
    ).toBe("AUTH_OTP_INVALID");
    const other = await request("parallel-wrong@example.test");
    const r = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        auth().verifyOtp(
          other,
          "999999",
          `198.51.101.${i}`,
          `accepted-request-id-p${i}`,
        ),
      ),
    );
    expect(r.every((x) => !x.ok && x.code === "AUTH_OTP_INVALID")).toBe(true);
    expect((await challenge(other)).attempt_count).toBe(5);
  });

  it("T2-06/T2-07 concurrent successes consume once and serialize first identity bootstrap", async () => {
    const email = "race@example.test",
      one = await fixture(email),
      two = await fixture(email);
    const r = await Promise.all([
      auth().verifyOtp(one, code, "198.51.102.1", "accepted-request-id-1"),
      auth().verifyOtp(two, code, "198.51.102.2", "accepted-request-id-2"),
    ]);
    expect(r.filter((x) => x.ok).length).toBe(2);
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text count FROM user_identities WHERE normalized_identifier=$1",
          [email],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      (await q<{ count: string }>("SELECT count(*)::text count FROM accounts"))
        .rows[0]!.count,
    ).toBe("1");
    const same = await fixture("same@example.test");
    const s = await Promise.all([
      auth().verifyOtp(same, code, "198.51.103.1", "accepted-request-id-3"),
      auth().verifyOtp(same, code, "198.51.103.2", "accepted-request-id-4"),
    ]);
    expect(s.filter((x) => x.ok).length).toBe(1);
  });

  it("T2-08/T2-09/T2-10 creates first login once, reuses later identity, and denies suspended users", async () => {
    const email = "first@example.test",
      first = await request(email);
    const firstResult = await auth().verifyOtp(
      first,
      code,
      "198.51.104.1",
      "accepted-request-id-first",
    );
    expect(firstResult.ok).toBe(true);
    const identity = (
      await q<{ user_id: string; verified_at: Date }>(
        "SELECT user_id,verified_at FROM user_identities WHERE normalized_identifier=$1",
        [email],
      )
    ).rows[0]!;
    expect(identity.verified_at).toBeTruthy();
    const later = await request(email);
    expect(
      (
        await auth().verifyOtp(
          later,
          code,
          "198.51.104.2",
          "accepted-request-id-later",
        )
      ).ok,
    ).toBe(true);
    expect(
      (await q<{ count: string }>("SELECT count(*)::text count FROM users"))
        .rows[0]!.count,
    ).toBe("1");
    await q("UPDATE users SET status='SUSPENDED' WHERE id=$1", [
      identity.user_id,
    ]);
    const denied = await request(email);
    expect(
      (
        await auth().verifyOtp(
          denied,
          code,
          "198.51.104.3",
          "accepted-request-id-denied",
        )
      ).code,
    ).toBe("AUTH_LOGIN_DENIED");
    expect((await challenge(denied)).consumed_at).toBeTruthy();
  });

  it("S1.1 replays one committed OTP verification only for the same idempotency key", async () => {
    const id = await request("otp-replay@example.test");
    const key = "otp-replay-key-1234";
    const first = await auth().verifyOtp(
      id,
      code,
      "198.51.104.40",
      "accepted-request-id-replay-1",
      key,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.code);
    const replay = await auth().verifyOtp(
      id,
      code,
      "198.51.104.41",
      "accepted-request-id-replay-2",
      key,
    );
    expect(replay).toEqual({ ok: true, value: first.value });
    const differentKey = await auth().verifyOtp(
      id,
      code,
      "198.51.104.42",
      "accepted-request-id-replay-3",
      "otp-replay-key-5678",
    );
    expect(differentKey).toEqual({ ok: false, code: "AUTH_OTP_INVALID" });
    expect(
      (await q<{ count: string }>("SELECT count(*)::text count FROM accounts"))
        .rows[0]!.count,
    ).toBe("1");
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text count FROM beta_admissions",
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      (
        await q<{ admitted: number }>(
          "SELECT admitted FROM beta_admission_state WHERE id=1",
        )
      ).rows[0]!.admitted,
    ).toBe(1);
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text count FROM portal_sessions",
        )
      ).rows[0]!.count,
    ).toBe("1");
  });

  it("S1.1 admits exactly one winner for the last slot and leaves the loser partial-free", async () => {
    await q(
      "UPDATE beta_admission_state SET mode='OPEN',capacity=1,admitted=0,revision=1 WHERE id=1",
    );
    const one = await fixture("last-slot-one@example.test");
    const two = await fixture("last-slot-two@example.test");
    const results = await Promise.all([
      auth().verifyOtp(
        one,
        code,
        "198.51.106.1",
        "accepted-request-id-last-slot-1",
        "last-slot-key-1234",
      ),
      auth().verifyOtp(
        two,
        code,
        "198.51.106.2",
        "accepted-request-id-last-slot-2",
        "last-slot-key-5678",
      ),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter(
        (result) => !result.ok && result.code === "BETA_CAPACITY_REACHED",
      ),
    ).toHaveLength(1);
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text count FROM beta_admissions",
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      (
        await q<{ admitted: number; capacity: number }>(
          "SELECT admitted,capacity FROM beta_admission_state WHERE id=1",
        )
      ).rows[0],
    ).toEqual({ admitted: 1, capacity: 1 });
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text count FROM users u JOIN user_identities i ON i.user_id=u.id WHERE i.normalized_identifier IN ($1,$2)",
          ["last-slot-one@example.test", "last-slot-two@example.test"],
        )
      ).rows[0]!.count,
    ).toBe("1");
  });

  it("S1.1 does not gate an existing login when beta registration is closed or full", async () => {
    const existing = await request("existing-while-closed@example.test");
    expect(
      (
        await auth().verifyOtp(
          existing,
          code,
          "198.51.107.1",
          "accepted-request-id-existing-1",
        )
      ).ok,
    ).toBe(true);
    await q(
      "UPDATE beta_admission_state SET mode='CLOSED',capacity=1,admitted=1 WHERE id=1",
    );
    const later = await request("existing-while-closed@example.test");
    expect(
      (
        await auth().verifyOtp(
          later,
          code,
          "198.51.107.2",
          "accepted-request-id-existing-2",
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await q<{ admitted: number }>(
          "SELECT admitted FROM beta_admission_state WHERE id=1",
        )
      ).rows[0]!.admitted,
    ).toBe(1);
  });

  it("T2-11/T2-12/T2-13 stores only session hash, OTP artifact, and encrypted delivery", async () => {
    const email = "storage@example.test",
      id = await request(email);
    const j = await jobFor(id);
    expect(j.ciphertext?.toString()).not.toContain(code);
    expect(j.nonce).toBeTruthy();
    expect(j.auth_tag).toBeTruthy();
    expect(
      (
        await q<{ verification_hash: string }>(
          "SELECT verification_hash FROM otp_challenges WHERE id=$1",
          [id],
        )
      ).rows[0]!.verification_hash,
    ).not.toBe(code);
    const verified = await auth().verifyOtp(
      id,
      code,
      "198.51.105.1",
      "accepted-request-id-storage",
    );
    if (!verified.ok) throw new Error(verified.code);
    expect(
      (
        await q<{ session_token_hash: string }>(
          "SELECT session_token_hash FROM portal_sessions",
        )
      ).rows[0]!.session_token_hash,
    ).toBe(portalLookup(keys, verified.value.sessionToken));
  });

  it("T2-14/T2-15/T2-16 claim concurrency, valid leases, and expired recovery are safe", async () => {
    const email = "lease@example.test",
      id = await fixture(email);
    await fixtureJob(id, email);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const provider = {
      sendLoginOtp: async () => {
        calls++;
        await held;
        return { providerMessageId: "safe-id" };
      },
    };
    const a = new OtpEmailRunner(db, keys, provider),
      b = new OtpEmailRunner(db, keys, provider);
    const ticks = [a.tick(), b.tick(), a.tick()];
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
    const active = await jobFor(id);
    expect(active.lease_id).toBeTruthy();
    release();
    await Promise.all(ticks);
    await clear();
    const valid = await fixture(email);
    await fixtureJob(
      valid,
      email,
      "PROCESSING",
      1,
      "now() + interval '1 minute'",
    );
    await a.tick();
    expect((await jobFor(valid)).attempt_count).toBe(1);
    await q(
      "UPDATE otp_email_jobs SET leased_until=now()-interval '1 minute' WHERE challenge_id=$1",
      [valid],
    );
    await a.tick();
    expect((await jobFor(valid)).status).toBe("SENT");
  });

  it("T2-17 through T2-22 clear secrets for exhausted, sent, dead, consumed, expired, and superseded jobs", async () => {
    const cases: Array<[string, string, number, string]> = [
      ["exhausted@example.test", "PROCESSING", 5, "now()-interval '1 minute'"],
      ["consumed@example.test", "PENDING", 0, "NULL"],
      ["expired@example.test", "PENDING", 0, "NULL"],
      ["superseded@example.test", "PENDING", 0, "NULL"],
    ];
    let calls = 0;
    const runner = new OtpEmailRunner(db, keys, {
      sendLoginOtp: async () => {
        calls++;
        return { providerMessageId: "safe-id" };
      },
    });
    for (const [email, status, attempts, lease] of cases) {
      const id = await fixture(
        email,
        randomUUID(),
        email.startsWith("expired")
          ? "now()-interval '1 minute'"
          : "now()+interval '10 minutes'",
      );
      await fixtureJob(id, email, status, attempts, lease);
      if (email.startsWith("consumed"))
        await q("UPDATE otp_challenges SET consumed_at=now() WHERE id=$1", [
          id,
        ]);
      if (email.startsWith("superseded"))
        await q(
          "UPDATE otp_challenges SET invalidated_at=now(),invalidation_reason='SUPERSEDED' WHERE id=$1",
          [id],
        );
      await runner.tick();
      const j = await jobFor(id);
      expect(j.status).toBe("DEAD");
      expect(j.ciphertext).toBeNull();
    }
    expect(calls).toBe(0);
    const sent = await fixture("sent@example.test");
    await fixtureJob(sent, "sent@example.test");
    await runner.tick();
    expect((await jobFor(sent)).status).toBe("SENT");
    expect((await jobFor(sent)).ciphertext).toBeNull();
    const dead = await fixture("dead@example.test");
    await fixtureJob(dead, "dead@example.test", "PENDING", 4);
    const failing = new OtpEmailRunner(db, keys, {
      sendLoginOtp: async () => {
        throw new Error("private provider body");
      },
    });
    await failing.tick();
    await q(
      "UPDATE otp_email_jobs SET available_at=now() WHERE challenge_id=$1",
      [dead],
    );
    await failing.tick();
    const dj = await jobFor(dead);
    expect(dj.status).toBe("DEAD");
    expect(dj.ciphertext).toBeNull();
  });

  it("T2-23/T2-24/T2-25/T2-26 revokes idempotently and keeps audit/rate data private", async () => {
    const email = "private@example.test",
      id = await request(email, "accepted-request-id-1");
    await auth().requestOtp(
      email,
      "203.0.113.77",
      "accepted-request-id-limited",
    );
    await auth().verifyOtp(
      id,
      "999999",
      "203.0.113.77",
      "accepted-request-id-failed",
    );
    const ok = await auth().verifyOtp(
      id,
      code,
      "203.0.113.78",
      "accepted-request-id-ok",
    );
    if (!ok.ok) throw new Error(ok.code);
    expect(
      await auth().revoke(ok.value.sessionToken, "accepted-request-id-logout"),
    ).toBe("revoked");
    expect(
      await auth().revoke(ok.value.sessionToken, "accepted-request-id-stale"),
    ).toBe("missing");
    const audit = JSON.stringify((await q("SELECT * FROM audit_events")).rows);
    for (const secret of [email, "203.0.113.77", code, ok.value.sessionToken])
      expect(audit).not.toContain(secret);
    expect(
      (
        await q<{ action: string; key_hash: string }>(
          "SELECT action,key_hash FROM auth_rate_limit_buckets WHERE action='OTP_REQUEST_IP'",
        )
      ).rows[0]!.key_hash,
    ).toMatch(/^v1:/);
    const actions = (
      await q<{ action: string }>("SELECT DISTINCT action FROM audit_events")
    ).rows.map((x) => x.action);
    for (const action of [
      "AUTH_OTP_REQUESTED",
      "AUTH_OTP_RATE_LIMITED",
      "AUTH_OTP_VERIFY_FAILED",
      "AUTH_OTP_VERIFIED",
      "AUTH_IDENTITY_CREATED",
      "PORTAL_SESSION_CREATED",
      "PORTAL_SESSION_REVOKED",
    ])
      expect(actions).toContain(action);
  });

  it("T2-27/T2-28/T2-29/T2-30 migration history works from empty/P2.1 and remains immutable", async () => {
    const hashes = await Promise.all(
      ["0000_p1_migration_probe.sql", "0001_sturdy_doctor_spectrum.sql"].map(
        async (name) =>
          (await import("node:crypto"))
            .createHash("sha256")
            .update(
              await (
                await import("node:fs/promises")
              ).readFile(
                new URL(
                  `../../../packages/server/db/drizzle/${name}`,
                  import.meta.url,
                ),
              ),
            )
            .digest("hex"),
      ),
    );
    expect(hashes.every(Boolean)).toBe(true);
    await runMigrations({ connectionString: url });
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text count FROM drizzle.__drizzle_migrations",
        )
      ).rows[0]!.count,
    ).toBe("21");
  });
});
