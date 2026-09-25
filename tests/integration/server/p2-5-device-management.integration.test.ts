import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateDeviceCode } from "../../../packages/server/device-auth/src/index.js";
import {
  DeviceManagementService,
  type DeviceLimitResolver,
} from "../../../packages/server/device-management/src/index.js";
import {
  ExtensionAuthService,
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
} from "../../../packages/server/extension-auth/src/index.js";
import {
  createDatabaseRuntime,
  createDeviceManagementRepository,
  createExtensionAuthRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for real PostgreSQL tests");
const root = Buffer.alloc(32, 87);
const signingKey = createEphemeralAccessTokenSigningKey("p25-integration");
const fixedNow = new Date("2026-09-03T12:00:00.000Z");
let db: DatabaseRuntime;
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const resolver = (maxActive = 1): DeviceLimitResolver => ({
  resolve: async () => ({ maxActive, source: "TEST" }),
});
const service = (maxActive = 1, now = () => fixedNow) =>
  new DeviceManagementService(
    createDeviceManagementRepository(db),
    root,
    signingKey,
    resolver(maxActive),
    now,
  );
const extension = () =>
  new ExtensionAuthService(
    createExtensionAuthRepository(db),
    deriveExtensionAuthKeys(root),
    () => fixedNow,
    signingKey,
  );

async function truncate() {
  await q(
    "TRUNCATE audit_events,auth_rate_limit_buckets,refresh_tokens,sessions,devices,device_authorizations,portal_sessions,user_identities,account_memberships,accounts,users CASCADE",
  );
}
async function owner(status = "ACTIVE") {
  const userId = randomUUID(),
    accountId = randomUUID();
  await q("INSERT INTO users(id,status) VALUES($1,$2)", [userId, status]);
  await q("INSERT INTO accounts(id) VALUES($1)", [accountId]);
  await q(
    "INSERT INTO account_memberships(id,account_id,user_id,role) VALUES($1,$2,$3,'OWNER')",
    [randomUUID(), accountId, userId],
  );
  return { userId, accountId };
}
async function approved(
  state: { userId: string; accountId: string },
  changes: Record<string, unknown> = {},
) {
  const id = randomUUID(),
    deviceCode = generateDeviceCode(
      Buffer.from(id.replace(/-/g, "").slice(0, 32)),
    );
  const expiresAt =
    (changes.expiresAt as Date | undefined) ??
    new Date(fixedNow.getTime() + 60_000);
  const withheld = changes.withheld === true;
  await q(
    `INSERT INTO device_authorizations(id,device_code_hash,user_code_hash,status,requested_client_type,browser_family,browser_version,extension_version,device_label,approved_account_id,approved_user_id,expires_at,start_secret_ciphertext,start_secret_nonce,start_secret_auth_tag)
     VALUES($1,$2,$3,$4,'browser_extension',$5,$6,$7,'My device',$8,$9,$10,$11,$12,$13)`,
    [
      id,
      "code:" + deviceCode,
      "user:" + id,
      changes.status ?? "APPROVED",
      withheld ? null : "chrome",
      withheld ? null : "123",
      withheld ? null : "2.5",
      state.accountId,
      state.userId,
      expiresAt,
      Buffer.from("envelope"),
      Buffer.alloc(12, 1),
      Buffer.alloc(16, 2),
    ],
  );
  // The production service uses the P2.3 HMAC.  This fixture replaces its value
  // with the exact artifact derived by the same service root.
  const { deriveDeviceAuthKeys, deviceCodeArtifact } = await import(
    "../../../packages/server/device-auth/src/index.js"
  );
  await q("UPDATE device_authorizations SET device_code_hash=$2 WHERE id=$1", [
    id,
    deviceCodeArtifact(deriveDeviceAuthKeys(root), deviceCode),
  ]);
  return { id, deviceCode };
}
async function activate(
  state: { userId: string; accountId: string },
  maxActive = 1,
) {
  const auth = await approved(state);
  const result = await service(maxActive).exchange(
    auth.deviceCode,
    "A".repeat(16),
    "203.0.113.30",
    randomUUID(),
  );
  if (result.kind !== "ACTIVATED")
    throw new Error("activation fixture failed: " + result.kind);
  return { auth, result };
}

describe.sequential("P2.5 real PostgreSQL device-management A-J", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString!);
    await db.ready();
    await runMigrations({ connectionString: connectionString! });
    await runMigrations({ connectionString: connectionString! });
  });
  beforeEach(truncate);
  afterAll(async () => db.close());

  it("A migrates history and exposes the P2.5 exchange invariant", async () => {
    const columns = await q<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='device_authorizations' AND column_name IN ('exchange_idempotency_key_hash','exchange_replay_until','exchanged_device_id','exchanged_session_id')",
    );
    expect(columns.rows.map((x) => x.column_name).sort()).toEqual([
      "exchange_idempotency_key_hash",
      "exchange_replay_until",
      "exchanged_device_id",
      "exchanged_session_id",
    ]);
    const check = await q<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conname='device_authorizations_p2_5_exchanged'",
    );
    expect(check.rows).toHaveLength(1);
  });

  it("B/C activates once, replays safely, and closes changed or expired exchange requests", async () => {
    const state = await owner();
    const { auth, result } = await activate(state);
    const a = await q<Record<string, unknown>>(
      "SELECT status,exchanged_at,exchange_idempotency_key_hash,exchange_replay_until,exchanged_device_id,exchanged_session_id,start_secret_ciphertext FROM device_authorizations WHERE id=$1",
      [auth.id],
    );
    expect(a.rows[0]).toMatchObject({
      status: "EXCHANGED",
      exchanged_device_id: result.deviceId,
      exchanged_session_id: result.sessionId,
      start_secret_ciphertext: null,
    });
    expect(await extension().authenticateAccess(result.accessToken)).toEqual({
      ok: true,
      value: {
        sessionId: result.sessionId,
        deviceId: result.deviceId,
        accountId: state.accountId,
      },
    });
    const replay = await service().exchange(
      auth.deviceCode,
      "A".repeat(16),
      "203.0.113.30",
      randomUUID(),
    );
    expect(replay).toMatchObject({
      kind: "ACTIVATED",
      replay: true,
      deviceId: result.deviceId,
      sessionId: result.sessionId,
      refreshToken: result.refreshToken,
    });
    expect(
      await service().exchange(
        auth.deviceCode,
        "B".repeat(16),
        "203.0.113.30",
        randomUUID(),
      ),
    ).toEqual({ kind: "CLOSED" });
    await q(
      "UPDATE device_authorizations SET exchange_replay_until=$2 WHERE id=$1",
      [auth.id, new Date(fixedNow.getTime() - 1)],
    );
    expect(
      await service().exchange(
        auth.deviceCode,
        "A".repeat(16),
        "203.0.113.30",
        randomUUID(),
      ),
    ).toEqual({ kind: "CLOSED" });
    const totals = await q<{
      devices: string;
      sessions: string;
      refreshes: string;
    }>(
      "SELECT (SELECT count(*) FROM devices) devices,(SELECT count(*) FROM sessions) sessions,(SELECT count(*) FROM refresh_tokens) refreshes",
    );
    expect(totals.rows[0]).toEqual({
      devices: "1",
      sessions: "1",
      refreshes: "1",
    });
  });

  it("preserves WITHHELD metadata through exchange/list and clears only the authenticated current device", async () => {
    const state = await owner();
    const other = await owner();
    const identified = await activate(state, 10);
    const withheldAuth = await approved(state, { withheld: true });
    const withheld = await service(10).exchange(
      withheldAuth.deviceCode,
      "N".repeat(16),
      "203.0.113.40",
      "withheld-exchange",
    );
    if (withheld.kind !== "ACTIVATED") {
      throw new Error("withheld activation fixture failed: " + withheld.kind);
    }
    const otherDevice = await activate(other, 10);

    expect(
      (
        await q<{
          browser_family: string | null;
          browser_version_last_seen: string | null;
          extension_version_last_seen: string | null;
        }>(
          "SELECT browser_family,browser_version_last_seen,extension_version_last_seen FROM devices WHERE id=$1",
          [withheld.deviceId],
        )
      ).rows[0],
    ).toEqual({
      browser_family: null,
      browser_version_last_seen: null,
      extension_version_last_seen: null,
    });

    const page = await service(10).list(state.userId, state.accountId, 10);
    if (page.kind !== "ok") throw new Error("privacy-neutral list failed");
    const withheldListed = page.devices.find((x) => x.id === withheld.deviceId);
    const identifiedListed = page.devices.find(
      (x) => x.id === identified.result.deviceId,
    );
    expect(withheldListed?.clientMetadata).toEqual({ state: "WITHHELD" });
    expect(withheldListed).not.toHaveProperty("browserFamily");
    expect(withheldListed).not.toHaveProperty("browserVersionLastSeen");
    expect(withheldListed).not.toHaveProperty("extensionVersionLastSeen");
    expect(identifiedListed).toMatchObject({
      clientMetadata: {
        state: "PRESENT",
        browserFamily: "chrome",
        browserVersion: "123",
        extensionVersion: "2.5",
      },
      browserFamily: "chrome",
      browserVersionLastSeen: "123",
      extensionVersionLastSeen: "2.5",
    });

    const authenticated = await extension().authenticateAccess(
      identified.result.accessToken,
    );
    if (!authenticated.ok) throw new Error(authenticated.code);
    const principal = authenticated.value;
    await expect(
      service(10).forgetCurrentClientMetadata(principal, "clear-1"),
    ).resolves.toEqual({
      kind: "CLEARED",
      deviceId: identified.result.deviceId,
    });
    await expect(
      service(10).forgetCurrentClientMetadata(principal, "clear-2"),
    ).resolves.toEqual({
      kind: "CLEARED",
      deviceId: identified.result.deviceId,
    });
    expect(
      (
        await q<{
          browser_family: string | null;
          browser_version_last_seen: string | null;
          extension_version_last_seen: string | null;
          status: string;
        }>(
          "SELECT browser_family,browser_version_last_seen,extension_version_last_seen,status FROM devices WHERE id=$1",
          [identified.result.deviceId],
        )
      ).rows[0],
    ).toEqual({
      browser_family: null,
      browser_version_last_seen: null,
      extension_version_last_seen: null,
      status: "ACTIVE",
    });
    expect(
      (await extension().authenticateAccess(identified.result.accessToken)).ok,
    ).toBe(true);
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text AS count FROM audit_events WHERE action='DEVICE_CLIENT_METADATA_CLEARED' AND target_id=$1",
          [identified.result.deviceId],
        )
      ).rows[0]?.count,
    ).toBe("1");

    await expect(
      service(10).forgetCurrentClientMetadata(
        {
          sessionId: otherDevice.result.sessionId,
          deviceId: identified.result.deviceId,
          accountId: state.accountId,
        },
        "clear-cross-account",
      ),
    ).resolves.toEqual({ kind: "UNAUTHORIZED" });
    await expect(
      q("UPDATE devices SET browser_family='chrome' WHERE id=$1", [
        identified.result.deviceId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      service(10).revoke(
        state.userId,
        identified.result.deviceId,
        "revoke-after-clear",
      ),
    ).resolves.toMatchObject({ kind: "REVOKED" });
    expect(
      (await extension().authenticateAccess(identified.result.accessToken)).ok,
    ).toBe(false);
    await expect(
      service(10).forgetCurrentClientMetadata(principal, "clear-after-revoke"),
    ).resolves.toEqual({ kind: "UNAUTHORIZED" });
  });

  it("D leaves pending closed and ineligible approval states without credentials", async () => {
    const state = await owner();
    for (const status of ["PENDING", "DENIED", "EXPIRED"]) {
      const auth = await approved(state, { status });
      expect(
        (
          await service().exchange(
            auth.deviceCode,
            "C".repeat(16),
            "203.0.113.31",
            randomUUID(),
          )
        ).kind,
      ).toBe(status === "PENDING" ? "PENDING" : "CLOSED");
    }
    const expired = await approved(state, {
      expiresAt: new Date(fixedNow.getTime() - 1),
    });
    expect(
      await service().exchange(
        expired.deviceCode,
        "D".repeat(16),
        "203.0.113.31",
        randomUUID(),
      ),
    ).toEqual({ kind: "CLOSED" });
    expect(
      (
        await q<{ status: string; start_secret_ciphertext: Buffer | null }>(
          "SELECT status,start_secret_ciphertext FROM device_authorizations WHERE id=$1",
          [expired.id],
        )
      ).rows[0],
    ).toMatchObject({ status: "EXPIRED", start_secret_ciphertext: null });
    await q("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
      state.accountId,
    ]);
    const suspended = await approved(state);
    expect(
      await service().exchange(
        suspended.deviceCode,
        "E".repeat(16),
        "203.0.113.31",
        randomUUID(),
      ),
    ).toEqual({ kind: "CLOSED" });
    const inactiveState = await owner();
    const inactive = await approved(inactiveState);
    await q("UPDATE users SET status='SUSPENDED' WHERE id=$1", [
      inactiveState.userId,
    ]);
    expect(
      await service().exchange(
        inactive.deviceCode,
        "L".repeat(16),
        "203.0.113.31",
        randomUUID(),
      ),
    ).toEqual({ kind: "CLOSED" });
    const noOwnerState = await owner();
    const noOwner = await approved(noOwnerState);
    await q(
      "DELETE FROM account_memberships WHERE account_id=$1 AND user_id=$2",
      [noOwnerState.accountId, noOwnerState.userId],
    );
    expect(
      await service().exchange(
        noOwner.deviceCode,
        "M".repeat(16),
        "203.0.113.31",
        randomUUID(),
      ),
    ).toEqual({ kind: "CLOSED" });
  });

  it("E/F serializes limit enforcement and releases capacity on revoke", async () => {
    const state = await owner();
    const one = await approved(state),
      two = await approved(state);
    const [left, right] = await Promise.all([
      service(1).exchange(
        one.deviceCode,
        "F".repeat(16),
        "203.0.113.32",
        randomUUID(),
      ),
      service(1).exchange(
        two.deviceCode,
        "G".repeat(16),
        "203.0.113.32",
        randomUUID(),
      ),
    ]);
    expect([left.kind, right.kind].sort()).toEqual([
      "ACTIVATED",
      "DEVICE_LIMIT_REACHED",
    ]);
    const winner =
      left.kind === "ACTIVATED"
        ? left
        : right.kind === "ACTIVATED"
          ? right
          : undefined;
    expect(winner).toBeDefined();
    const loser = left.kind === "DEVICE_LIMIT_REACHED" ? one : two;
    expect(
      await service(1).revoke(state.userId, winner!.deviceId, randomUUID()),
    ).toMatchObject({ kind: "REVOKED" });
    expect(
      (
        await service(1).exchange(
          loser.deviceCode,
          left.kind === "DEVICE_LIMIT_REACHED"
            ? "F".repeat(16)
            : "G".repeat(16),
          "203.0.113.32",
          randomUUID(),
        )
      ).kind,
    ).toBe("ACTIVATED");
  });

  it("G revokes live credentials immediately and is audit-idempotent", async () => {
    const state = await owner();
    const { result } = await activate(state);
    expect((await extension().authenticateAccess(result.accessToken)).ok).toBe(
      true,
    );
    expect(
      await service().revoke(state.userId, result.deviceId, randomUUID()),
    ).toEqual({ kind: "REVOKED", idempotent: false });
    expect((await extension().authenticateAccess(result.accessToken)).ok).toBe(
      false,
    );
    expect(
      (
        await extension().refresh(
          result.refreshToken,
          "H".repeat(16),
          randomUUID(),
        )
      ).ok,
    ).toBe(false);
    expect(
      await service().revoke(state.userId, result.deviceId, randomUUID()),
    ).toEqual({ kind: "REVOKED", idempotent: true });
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*) count FROM audit_events WHERE action='DEVICE_REVOKED'",
        )
      ).rows[0]?.count,
    ).toBe("1");
  });

  it("H lists safe ordered account-scoped pages, including suspended accounts", async () => {
    const state = await owner();
    const other = await owner();
    for (let n = 0; n < 3; n++) {
      const x = await activate(state, 10);
      if (n === 0)
        await service(10).revoke(state.userId, x.result.deviceId, randomUUID());
    }
    await activate(other, 10);
    await q("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
      state.accountId,
    ]);
    const first = await service(10).list(state.userId, state.accountId, 2);
    expect(first).toMatchObject({ kind: "ok" });
    if (first.kind !== "ok") throw new Error("page");
    expect(Object.keys(first.devices[0]!).sort()).toEqual([
      "activatedAt",
      "browserFamily",
      "browserVersionLastSeen",
      "clientMetadata",
      "createdAt",
      "extensionVersionLastSeen",
      "id",
      "label",
      "lastSeenAt",
      "revokedAt",
      "status",
    ]);
    const second = await service(10).list(
      state.userId,
      state.accountId,
      2,
      first.nextCursor,
    );
    expect(second).toMatchObject({ kind: "ok" });
    expect(await service(10).list(state.userId, state.accountId, 101)).toEqual({
      kind: "INVALID",
    });
    const otherPage = await service(10).list(other.userId, other.accountId);
    if (otherPage.kind !== "ok") throw new Error("other page");
    expect(
      await service(10).list(
        state.userId,
        state.accountId,
        50,
        otherPage.devices[0]!.id,
      ),
    ).toEqual({ kind: "INVALID_CURSOR" });
    expect(await service(10).list(other.userId, state.accountId)).toEqual({
      kind: "FORBIDDEN",
    });
  });

  it("I/J rate-limits every schema-valid request and persists only safe audit/pseudonymous data", async () => {
    const state = await owner();
    const pending = await approved(state, { status: "PENDING" });
    const results = await Promise.all(
      Array.from({ length: 150 }, (_, n) =>
        service().exchange(
          pending.deviceCode,
          "I".repeat(16),
          "203.0.113.99",
          String(n),
        ),
      ),
    );
    expect(
      results.filter((x) => x.kind === "RATE_LIMITED").length,
    ).toBeGreaterThanOrEqual(30);
    const bucket = await q<{ count: number; key_hash: string }>(
      "SELECT count,key_hash FROM auth_rate_limit_buckets WHERE action='DEVICE_AUTH_EXCHANGE_IP'",
    );
    expect(bucket.rows[0]?.count).toBe(150);
    expect(bucket.rows[0]?.key_hash).not.toContain("203.0.113.99");
    const active = await owner();
    const first = await approved(active),
      second = await approved(active);
    await service(1).exchange(
      first.deviceCode,
      "J".repeat(16),
      "203.0.113.98",
      randomUUID(),
    );
    await service(1).exchange(
      second.deviceCode,
      "K".repeat(16),
      "203.0.113.98",
      randomUUID(),
    );
    const audits = await q<{ action: string; safe_metadata: unknown }>(
      "SELECT action,safe_metadata FROM audit_events",
    );
    expect(audits.rows.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        "DEVICE_ACTIVATED",
        "EXTENSION_SESSION_CREATED",
        "EXTENSION_REFRESH_ISSUED",
        "DEVICE_ACTIVATION_LIMIT_REACHED",
      ]),
    );
    expect(JSON.stringify(audits.rows)).not.toContain(first.deviceCode);
    expect(JSON.stringify(audits.rows)).not.toContain("203.0.113.98");
  });
});
