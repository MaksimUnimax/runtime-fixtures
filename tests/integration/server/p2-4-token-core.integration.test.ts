import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ExtensionAuthService,
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
  issueAccessToken,
} from "../../../packages/server/extension-auth/src/index.js";
import {
  createDatabaseRuntime,
  createExtensionAuthRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for real PostgreSQL tests");
const keys = deriveExtensionAuthKeys(Buffer.alloc(32, 55));
const signingKey = createEphemeralAccessTokenSigningKey("integration-key");
let db: DatabaseRuntime;
const query = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const service = () =>
  new ExtensionAuthService(
    createExtensionAuthRepository(db),
    keys,
    undefined,
    signingKey,
  );
async function truncate() {
  await query(
    "TRUNCATE audit_events,auth_rate_limit_buckets,refresh_tokens,sessions,devices,device_authorizations,portal_sessions,user_identities,account_memberships,accounts,users CASCADE",
  );
}
async function activeSession() {
  const userId = randomUUID(),
    accountId = randomUUID(),
    deviceId = randomUUID(),
    sessionId = randomUUID();
  await query("INSERT INTO users(id) VALUES($1)", [userId]);
  await query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
  await query(
    "INSERT INTO devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$2,$3,'chrome','1.0.0')",
    [deviceId, accountId, userId],
  );
  await query(
    "INSERT INTO sessions(id,device_id,account_id,token_family_id) VALUES($1,$2,$3,$4)",
    [sessionId, deviceId, accountId, randomUUID()],
  );
  return { userId, accountId, deviceId, sessionId };
}
function value<T>(
  result: { ok: true; value: T } | { ok: false; code: string },
): T {
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

describe.sequential("P2.4 real PostgreSQL token-core matrix", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString!);
    await db.ready();
    await runMigrations({ connectionString: connectionString! });
  });
  beforeEach(truncate);
  afterAll(async () => db.close());

  it("T2-A/B creates opaque hashed refresh state and authorizes active session/device/account only", async () => {
    const state = await activeSession();
    const issued = value(await service().issue(state.sessionId));
    expect(issued.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await query<{ token_hash: string; expires_at: Date }>(
      "SELECT token_hash,expires_at FROM refresh_tokens",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.token_hash).not.toContain(issued.refreshToken);
    expect(new Date(rows.rows[0]!.expires_at).getTime()).toBeGreaterThan(
      Date.now() + 29 * 24 * 60 * 60_000,
    );
    await query(
      "UPDATE devices SET status='REVOKED',revoked_at=now() WHERE id=$1",
      [state.deviceId],
    );
    expect(await service().issue(state.sessionId)).toEqual({
      ok: false,
      code: "EXTENSION_AUTH_UNAUTHORIZED",
    });
  });

  it("T2-B fails closed when durable session, device, and account bindings disagree", async () => {
    const state = await activeSession();
    const otherAccountId = randomUUID();
    await query("INSERT INTO accounts(id) VALUES($1)", [otherAccountId]);
    await query("UPDATE sessions SET account_id=$2 WHERE id=$1", [
      state.sessionId,
      otherAccountId,
    ]);

    expect(await service().issue(state.sessionId)).toEqual({
      ok: false,
      code: "EXTENSION_AUTH_UNAUTHORIZED",
    });
  });

  it("T2-B rejects signed claim mismatches and unknown sessions against live PostgreSQL authority", async () => {
    const state = await activeSession();
    const tokens = [
      await issueAccessToken(
        signingKey,
        {
          sessionId: state.sessionId,
          deviceId: state.deviceId,
          accountId: randomUUID(),
        },
        new Date(),
      ),
      await issueAccessToken(
        signingKey,
        {
          sessionId: state.sessionId,
          deviceId: randomUUID(),
          accountId: state.accountId,
        },
        new Date(),
      ),
      await issueAccessToken(
        signingKey,
        {
          sessionId: randomUUID(),
          deviceId: state.deviceId,
          accountId: state.accountId,
        },
        new Date(),
      ),
    ];
    for (const token of tokens)
      expect(await service().authenticateAccess(token)).toEqual({
        ok: false,
        code: "EXTENSION_AUTH_UNAUTHORIZED",
      });
  });

  it("T2-A fails closed for forbidden account, user, and session state", async () => {
    const accountState = await activeSession();
    const accountToken = value(await service().issue(accountState.sessionId));
    await query("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
      accountState.accountId,
    ]);
    expect(
      await service().authenticateAccess(accountToken.accessToken),
    ).toMatchObject({
      ok: false,
      code: "EXTENSION_AUTH_UNAUTHORIZED",
    });
    expect(
      await service().refresh(
        accountToken.refreshToken,
        "A".repeat(16),
        "account-forbidden",
      ),
    ).toEqual({ ok: false, code: "EXTENSION_AUTH_INVALID" });

    const userState = await activeSession();
    const userToken = value(await service().issue(userState.sessionId));
    await query("UPDATE users SET status='SUSPENDED' WHERE id=$1", [
      userState.userId,
    ]);
    expect(
      await service().authenticateAccess(userToken.accessToken),
    ).toMatchObject({
      ok: false,
      code: "EXTENSION_AUTH_UNAUTHORIZED",
    });
    expect(
      await service().refresh(
        userToken.refreshToken,
        "B".repeat(16),
        "user-forbidden",
      ),
    ).toEqual({ ok: false, code: "EXTENSION_AUTH_INVALID" });

    const sessionState = await activeSession();
    const sessionToken = value(await service().issue(sessionState.sessionId));
    await query(
      "UPDATE sessions SET status='REVOKED',revoked_at=now() WHERE id=$1",
      [sessionState.sessionId],
    );
    expect(
      await service().authenticateAccess(sessionToken.accessToken),
    ).toMatchObject({
      ok: false,
      code: "EXTENSION_AUTH_UNAUTHORIZED",
    });
    expect(
      await service().refresh(
        sessionToken.refreshToken,
        "C".repeat(16),
        "session-forbidden",
      ),
    ).toEqual({ ok: false, code: "EXTENSION_AUTH_INVALID" });
  });

  it("T2-C/D atomically rotates once under real concurrent same-request retries and returns the deterministic replacement", async () => {
    const state = await activeSession();
    const original = value(await service().issue(state.sessionId));
    const idem = "I".repeat(16);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        service().refresh(original.refreshToken, idem, randomUUID()),
      ),
    );
    const values = results.map(value);
    expect(new Set(values.map((x) => x.refreshToken)).size).toBe(1);
    expect(values.filter((x) => !x.replay)).toHaveLength(1);
    expect(values.filter((x) => x.replay)).toHaveLength(11);
    const rows = await query<{
      generation: number;
      consumed_at: Date | null;
      rotation_idempotency_hash: string | null;
    }>(
      "SELECT generation,consumed_at,rotation_idempotency_hash FROM refresh_tokens ORDER BY generation",
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({
      generation: 0,
      consumed_at: expect.any(Date),
    });
    expect(rows.rows[1]).toMatchObject({
      generation: 1,
      rotation_idempotency_hash: expect.any(String),
    });
  });

  it("B04 serializes concurrent different-idempotency refreshes and compromises the reused family", async () => {
    const state = await activeSession();
    const original = value(await service().issue(state.sessionId));
    const results = await Promise.all([
      service().refresh(original.refreshToken, "A".repeat(16), "race-a"),
      service().refresh(original.refreshToken, "B".repeat(16), "race-b"),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter(
        (result) => !result.ok && result.code === "EXTENSION_AUTH_REUSE",
      ),
    ).toHaveLength(1);
    const session = await query<{
      status: string;
      revoked_at: Date | null;
      revoke_reason: string | null;
    }>("SELECT status,revoked_at,revoke_reason FROM sessions WHERE id=$1", [
      state.sessionId,
    ]);
    expect(session.rows[0]).toMatchObject({
      status: "COMPROMISED",
      revoked_at: expect.any(Date),
      revoke_reason: "REFRESH_REUSE",
    });
    expect(
      (
        await query<{ count: string }>(
          "SELECT count(*)::text AS count FROM refresh_tokens WHERE session_id=$1",
          [state.sessionId],
        )
      ).rows[0]?.count,
    ).toBe("2");
  });

  it("T2-E/F treats changed idempotency or an expired replay window as reuse and compromises the whole family", async () => {
    const state = await activeSession();
    const original = value(await service().issue(state.sessionId));
    value(
      await service().refresh(original.refreshToken, "A".repeat(16), "first"),
    );
    expect(
      await service().refresh(
        original.refreshToken,
        "B".repeat(16),
        "attacker",
      ),
    ).toEqual({ ok: false, code: "EXTENSION_AUTH_REUSE" });
    const session = await query<{
      status: string;
      revoked_at: Date | null;
      revoke_reason: string | null;
    }>("SELECT status,revoked_at,revoke_reason FROM sessions WHERE id=$1", [
      state.sessionId,
    ]);
    expect(session.rows[0]).toMatchObject({
      status: "COMPROMISED",
      revoked_at: expect.any(Date),
      revoke_reason: "REFRESH_REUSE",
    });
    expect(
      await service().refresh(original.refreshToken, "A".repeat(16), "late"),
    ).toEqual({ ok: false, code: "EXTENSION_AUTH_INVALID" });
    const audit = await query<{ action: string; reason: string | null }>(
      "SELECT action,reason FROM audit_events WHERE target_id=$1",
      [state.sessionId],
    );
    expect(audit.rows).toContainEqual({
      action: "REFRESH_REUSE",
      reason: "REFRESH_REUSE",
    });
  });

  it("T2-G/H expires the same-idempotency replay window and never persists raw refresh secrets", async () => {
    const state = await activeSession();
    const original = value(await service().issue(state.sessionId));
    value(
      await service().refresh(original.refreshToken, "A".repeat(16), "first"),
    );
    await query(
      "UPDATE refresh_tokens SET replay_expires_at=now()-interval '1 second' WHERE generation=1",
    );
    expect(
      await service().refresh(
        original.refreshToken,
        "A".repeat(16),
        "expired-window",
      ),
    ).toEqual({ ok: false, code: "EXTENSION_AUTH_REUSE" });
    const columns = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('refresh_token','access_token')",
    );
    expect(columns.rows).toEqual([]);
  });

  it("T2-H refuses to rotate when durable device authority is revoked", async () => {
    const state = await activeSession();
    const original = value(await service().issue(state.sessionId));
    await query(
      "UPDATE devices SET status='REVOKED',revoked_at=now() WHERE id=$1",
      [state.deviceId],
    );

    expect(
      await service().refresh(
        original.refreshToken,
        "V".repeat(16),
        "revoked-device",
      ),
    ).toEqual({ ok: false, code: "EXTENSION_AUTH_INVALID" });
    const rows = await query<{ count: string }>(
      "SELECT count(*)::text AS count FROM refresh_tokens WHERE session_id=$1",
      [state.sessionId],
    );
    expect(rows.rows[0]?.count).toBe("1");
  });

  it("T2-I consumes invalid schema-valid refresh attempts in a committed pseudonymous IP bucket", async () => {
    const peerIp = "203.0.113.19";
    const invalid = await service().refresh(
      "X".repeat(43),
      "R".repeat(16),
      "invalid-refresh",
      peerIp,
    );
    expect(invalid).toEqual({ ok: false, code: "EXTENSION_AUTH_INVALID" });
    const rows = await query<{ key_hash: string; count: number }>(
      "SELECT key_hash,count FROM auth_rate_limit_buckets WHERE action='EXTENSION_REFRESH_IP'",
    );
    expect(rows.rows).toEqual([
      { key_hash: expect.not.stringContaining(peerIp), count: 1 },
    ]);
  });

  it("T2-J never allows more than 60 concurrent refresh requests for one peer", async () => {
    const peerIp = "203.0.113.20";
    const fixedNow = new Date("2026-09-03T12:00:00.000Z");
    const rateService = new ExtensionAuthService(
      createExtensionAuthRepository(db),
      keys,
      () => fixedNow,
      signingKey,
    );
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        rateService.refresh(
          "Y".repeat(43),
          "Q".repeat(16),
          `rate-${index}`,
          peerIp,
        ),
      ),
    );
    expect(
      results.filter(
        (result) =>
          result.ok === false && result.code === "EXTENSION_AUTH_RATE_LIMITED",
      ),
    ).toHaveLength(40);
    const rows = await query<{ count: number; key_hash: string }>(
      "SELECT count,key_hash FROM auth_rate_limit_buckets WHERE action='EXTENSION_REFRESH_IP'",
    );
    expect(rows.rows[0]?.count).toBe(100);
    expect(rows.rows[0]?.key_hash).not.toContain(peerIp);
  });

  it("T2-K charges a same-idempotency replay independently while preserving one replacement", async () => {
    const state = await activeSession();
    const original = value(await service().issue(state.sessionId));
    const peerIp = "203.0.113.21";
    const first = value(
      await service().refresh(
        original.refreshToken,
        "Z".repeat(16),
        "first",
        peerIp,
      ),
    );
    const replay = value(
      await service().refresh(
        original.refreshToken,
        "Z".repeat(16),
        "replay",
        peerIp,
      ),
    );
    expect(replay.refreshToken).toBe(first.refreshToken);
    const row = await query<{ count: number }>(
      "SELECT count FROM auth_rate_limit_buckets WHERE action='EXTENSION_REFRESH_IP'",
    );
    expect(row.rows[0]?.count).toBe(2);
  });
});
