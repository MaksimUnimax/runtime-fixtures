import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DeviceAuthorizationService,
  deviceCodeArtifact,
  deriveDeviceAuthKeys,
  idempotencyKeyArtifact,
  requestFingerprint,
  userCodeArtifact,
} from "../../../packages/server/device-auth/src/index.js";
import {
  createDatabaseRuntime,
  createDeviceAuthorizationRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for real PostgreSQL tests");
const keys = deriveDeviceAuthKeys(Buffer.alloc(32, 23));
let db: DatabaseRuntime;
const body = {
  clientType: "browser_extension" as const,
  browserFamily: "chrome" as const,
  extensionVersion: "1",
};
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const service = () =>
  new DeviceAuthorizationService(createDeviceAuthorizationRepository(db), keys);
const start = (key = `key-${randomUUID().replaceAll("-", "")}`) =>
  service().start(body, key, "198.51.100.25", `test-${randomUUID()}`);

async function truncate() {
  await q(
    "TRUNCATE audit_events,auth_rate_limit_buckets,refresh_tokens,sessions,devices,device_authorizations,portal_sessions,user_identities,account_memberships,accounts,users CASCADE",
  );
}
async function owner(status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  const userId = randomUUID(),
    accountId = randomUUID();
  await q("INSERT INTO users(id) VALUES($1)", [userId]);
  await q("INSERT INTO accounts(id,status) VALUES($1,$2)", [accountId, status]);
  await q(
    "INSERT INTO account_memberships(account_id,user_id,role) VALUES($1,$2,'OWNER')",
    [accountId, userId],
  );
  return { userId, accountId };
}
function value<T>(x: { ok: true; value: T } | { ok: false; code: string }): T {
  if (!x.ok) throw new Error(x.code);
  return x.value;
}

describe.sequential("P2.3 real PostgreSQL device authorization matrix", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(url!);
    await db.ready();
    await runMigrations({ connectionString: url! });
  });
  beforeEach(truncate);
  afterAll(async () => db.close());

  it("T2-05..10 stores only HMAC/envelope material and makes sequential/parallel idempotency one logical start", async () => {
    const key = "I".repeat(16);
    const first = value(
      await service().start(body, key, "198.51.100.25", "start-a"),
    );
    const replay = value(
      await service().start(body, key, "198.51.100.25", "start-b"),
    );
    expect(replay).toEqual(first);
    const parallel = await Promise.all(
      Array.from({ length: 10 }, () =>
        service().start(body, key, "198.51.100.25", randomUUID()),
      ),
    );
    expect(
      parallel
        .map(value)
        .every(
          (x) =>
            x.authorizationId === first.authorizationId &&
            x.deviceCode === first.deviceCode &&
            x.userCode === first.userCode,
        ),
    ).toBe(true);
    const rows = await q<{
      device_code_hash: string;
      user_code_hash: string;
      idempotency_key_hash: string;
      start_secret_ciphertext: Buffer;
      start_secret_nonce: Buffer;
      start_secret_auth_tag: Buffer;
    }>(
      "SELECT device_code_hash,user_code_hash,idempotency_key_hash,start_secret_ciphertext,start_secret_nonce,start_secret_auth_tag FROM device_authorizations",
    );
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(
      [
        row.device_code_hash,
        row.user_code_hash,
        row.idempotency_key_hash,
        row.start_secret_ciphertext.toString("hex"),
      ].join(" "),
    ).not.toContain(first.deviceCode);
    expect(
      [
        row.device_code_hash,
        row.user_code_hash,
        row.idempotency_key_hash,
        row.start_secret_ciphertext.toString("hex"),
      ].join(" "),
    ).not.toContain(first.userCode);
    expect(
      [
        row.start_secret_ciphertext,
        row.start_secret_nonce,
        row.start_secret_auth_tag,
      ].every(Boolean),
    ).toBe(true);
    const conflict = await service().start(
      { ...body, deviceLabel: "other" },
      key,
      "198.51.100.25",
      "conflict",
    );
    expect(conflict).toEqual({
      ok: false,
      code: "DEVICE_AUTH_IDEMPOTENCY_CONFLICT",
    });
    expect((await q("SELECT * FROM device_authorizations")).rows).toHaveLength(
      1,
    );
  });

  it("stores privacy-neutral authorization as WITHHELD and keeps identified replay distinct", async () => {
    const neutralBody = {
      clientType: "browser_extension" as const,
      deviceLabel: "manual-label",
    };
    const key = "W".repeat(16);
    const first = value(
      await service().start(neutralBody, key, "198.51.100.25", "neutral-start"),
    );
    expect(
      value(
        await service().start(
          neutralBody,
          key,
          "198.51.100.25",
          "neutral-replay",
        ),
      ),
    ).toEqual(first);
    const preview = await service().previewPendingAuthorization(
      first.authorizationId,
    );
    expect(preview).toMatchObject({
      clientMetadata: { state: "WITHHELD" },
      deviceLabel: "manual-label",
    });
    expect(preview).not.toHaveProperty("browserFamily");
    expect(preview).not.toHaveProperty("browserVersion");
    expect(preview).not.toHaveProperty("extensionVersion");
    expect(
      (
        await q<{
          browser_family: string | null;
          browser_version: string | null;
          extension_version: string | null;
        }>(
          "SELECT browser_family,browser_version,extension_version FROM device_authorizations WHERE id=$1",
          [first.authorizationId],
        )
      ).rows[0],
    ).toEqual({
      browser_family: null,
      browser_version: null,
      extension_version: null,
    });
    expect(
      await service().start(body, key, "198.51.100.25", "neutral-conflict"),
    ).toEqual({ ok: false, code: "DEVICE_AUTH_IDEMPOTENCY_CONFLICT" });
    await expect(
      q(
        "UPDATE device_authorizations SET browser_family='chrome' WHERE id=$1",
        [first.authorizationId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const identified = value(await start("J".repeat(16)));
    expect(
      await service().previewPendingAuthorization(identified.authorizationId),
    ).toMatchObject({
      clientMetadata: {
        state: "PRESENT",
        browserFamily: "chrome",
        browserVersion: null,
        extensionVersion: "1",
      },
      browserFamily: "chrome",
      browserVersion: null,
      extensionVersion: "1",
    });
    await expect(
      q("UPDATE device_authorizations SET extension_version=NULL WHERE id=$1", [
        identified.authorizationId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("T2-11/12/23/24/26/27/29/34/35 closes terminal records, clears secrets, and preserves approved replay secrets", async () => {
    const { userId, accountId } = await owner();
    const created = value(await start("C".repeat(16)));
    const approved = value(
      await service().approve(
        created.authorizationId,
        accountId,
        created.userCode,
        userId,
        "198.51.100.25",
        "approve",
      ),
    );
    expect(approved.record.status).toBe("APPROVED");
    const beforeExpiry = await q<{ start_secret_ciphertext: Buffer }>(
      "SELECT start_secret_ciphertext FROM device_authorizations WHERE id=$1",
      [created.authorizationId],
    );
    expect(beforeExpiry.rows[0]?.start_secret_ciphertext).toBeTruthy();
    await q(
      "UPDATE device_authorizations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [created.authorizationId],
    );
    expect(
      await createDeviceAuthorizationRepository(db).expireDue(100, "expiry"),
    ).toBe(1);
    const expired = await q<{
      status: string;
      expired_at: Date;
      start_secret_ciphertext: Buffer | null;
      start_secret_nonce: Buffer | null;
      start_secret_auth_tag: Buffer | null;
    }>(
      "SELECT status,expired_at,start_secret_ciphertext,start_secret_nonce,start_secret_auth_tag FROM device_authorizations WHERE id=$1",
      [created.authorizationId],
    );
    expect(expired.rows[0]).toMatchObject({
      status: "EXPIRED",
      start_secret_ciphertext: null,
      start_secret_nonce: null,
      start_secret_auth_tag: null,
    });
    expect(expired.rows[0]?.expired_at).toBeTruthy();
    expect(
      await service().start(body, "C".repeat(16), "198.51.100.25", "closed"),
    ).toEqual({ ok: false, code: "DEVICE_AUTH_CLOSED" });
    const denied = value(await start("D".repeat(16)));
    expect(
      await service().deny(
        denied.authorizationId,
        denied.userCode,
        userId,
        "198.51.100.25",
        "deny",
      ),
    ).toMatchObject({ ok: true });
    expect(
      await service().start(
        body,
        "D".repeat(16),
        "198.51.100.25",
        "closed-denied",
      ),
    ).toEqual({ ok: false, code: "DEVICE_AUTH_CLOSED" });
  });

  it("T2-13/14/30/31 atomically caps start and portal rate buckets and persists only HMAC pseudonyms", async () => {
    const starts = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        start(`S${String(i).padStart(15, "0")}`),
      ),
    );
    expect(starts.filter((x) => x.ok).length).toBeLessThanOrEqual(20);
    const bucket = await q<{ key_hash: string; count: number }>(
      "SELECT key_hash,count FROM auth_rate_limit_buckets WHERE action='DEVICE_AUTH_START_IP'",
    );
    expect(bucket.rows[0]?.count).toBe(30);
    expect(bucket.rows[0]?.key_hash).not.toContain("198.51.100.25");
  });

  it("T2-15..22/25 and T2-36..38 approve/deny authorization and audit without creating capability state", async () => {
    const { userId, accountId } = await owner();
    const created = value(await start());
    expect(
      await service().approve(
        created.authorizationId,
        accountId,
        "ABCD-EFGH",
        userId,
        "198.51.100.25",
        "wrong",
      ),
    ).toEqual({ ok: false, code: "DEVICE_AUTH_INVALID" });
    const approved = value(
      await service().approve(
        created.authorizationId,
        accountId,
        created.userCode,
        userId,
        "198.51.100.25",
        "right",
      ),
    );
    expect(approved.record.status).toBe("APPROVED");
    expect(
      await service().approve(
        created.authorizationId,
        accountId,
        created.userCode,
        userId,
        "198.51.100.25",
        "retry",
      ),
    ).toMatchObject({ ok: true });
    expect((await q("SELECT * FROM devices")).rows).toHaveLength(0);
    expect((await q("SELECT * FROM sessions")).rows).toHaveLength(0);
    expect((await q("SELECT * FROM refresh_tokens")).rows).toHaveLength(0);
    expect(
      await service().deny(
        created.authorizationId,
        created.userCode,
        userId,
        "198.51.100.25",
        "deny-approved",
      ),
    ).toEqual({ ok: false, code: "DEVICE_AUTH_STATE_CONFLICT" });
    const audit = await q<{
      action: string;
      safe_metadata: unknown;
      reason: string | null;
    }>(
      "SELECT action,safe_metadata,reason FROM audit_events ORDER BY created_at",
    );
    expect(audit.rows.map((x) => x.action)).toEqual(
      expect.arrayContaining([
        "DEVICE_AUTH_STARTED",
        "DEVICE_AUTH_USER_CODE_FAILED",
        "DEVICE_AUTH_APPROVED",
      ]),
    );
    expect(JSON.stringify(audit.rows)).not.toContain(created.deviceCode);
    expect(JSON.stringify(audit.rows)).not.toContain(created.userCode);
  });

  it("A migrates complete history idempotently, preserves historical migration bytes, and has P2.3 schema", async () => {
    const migration = (name: string) =>
      readFile(
        fileURLToPath(
          new URL(
            `../../../packages/server/db/drizzle/${name}`,
            import.meta.url,
          ),
        ),
      ).then((x) => createHash("sha256").update(x).digest("hex"));
    await runMigrations({ connectionString: url! });
    expect(
      await Promise.all([
        migration("0000_p1_migration_probe.sql"),
        migration("0001_sturdy_doctor_spectrum.sql"),
        migration("0002_p2_2_otp_portal_auth.sql"),
      ]),
    ).toEqual([
      "9a7cde34d8b38667ccedd630cd2dc40697b2ee5c922927bb08f93f242bc5af56",
      "0544b377425ee3a6ebc9dc21ebb402febe27852c7bf93666f4154fbc0f723b2f",
      "f6f302d14574a7f9dff3675b8b330fbbf90a4d69387041b9fdf8fbe0454ce449",
    ]);
    const schema = await q<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='device_authorizations' AND column_name IN ('idempotency_key_hash','request_fingerprint','start_secret_ciphertext','start_secret_nonce','start_secret_auth_tag','expired_at')",
    );
    expect(schema.rows).toHaveLength(6);
    expect(
      (
        await q(
          "SELECT * FROM pg_constraint WHERE conname='device_authorizations_p2_3_secret_state'",
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("G/H/J handles approval failures, deny cleanup, terminal race, and portal budgets without raw peer data", async () => {
    const created = value(await start("G".repeat(16)));
    const userId = randomUUID(),
      accountId = randomUUID();
    await q("INSERT INTO users(id) VALUES($1)", [userId]);
    await q("INSERT INTO accounts(id,status) VALUES($1,'ACTIVE')", [accountId]);
    expect(
      await service().approve(
        created.authorizationId,
        accountId,
        created.userCode,
        userId,
        "198.51.100.25",
        "no-owner",
      ),
    ).toEqual({ ok: false, code: "DEVICE_AUTH_FORBIDDEN" });
    await q("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [accountId]);
    expect(
      await service().approve(
        created.authorizationId,
        accountId,
        created.userCode,
        userId,
        "198.51.100.25",
        "suspended",
      ),
    ).toEqual({ ok: false, code: "DEVICE_AUTH_FORBIDDEN" });
    const allowed = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        service().approve(
          created.authorizationId,
          accountId,
          "ABCD-EFGH",
          userId,
          "203.0.113.1",
          `portal-${i}`,
        ),
      ),
    );
    expect(
      allowed.filter((x) => x.ok || x.code !== "DEVICE_AUTH_RATE_LIMITED")
        .length,
    ).toBeLessThanOrEqual(10);
    const peerAllowed = await Promise.all(
      Array.from({ length: 31 }, (_, i) =>
        service().approve(
          created.authorizationId,
          accountId,
          "ABCD-EFGH",
          randomUUID(),
          "203.0.113.2",
          `portal-peer-${i}`,
        ),
      ),
    );
    expect(
      peerAllowed.filter((x) => x.ok || x.code !== "DEVICE_AUTH_RATE_LIMITED")
        .length,
    ).toBeLessThanOrEqual(30);
    expect(
      JSON.stringify(
        (await q("SELECT key_hash FROM auth_rate_limit_buckets")).rows,
      ),
    ).not.toContain("203.0.113.1");

    const { userId: ownerId, accountId: ownerAccount } = await owner();
    const denied = value(await start("N".repeat(16)));
    expect(
      (
        await service().deny(
          denied.authorizationId,
          denied.userCode,
          ownerId,
          "198.51.100.25",
          "deny",
        )
      ).ok,
    ).toBe(true);
    expect(
      await service().approve(
        denied.authorizationId,
        ownerAccount,
        denied.userCode,
        ownerId,
        "198.51.100.25",
        "closed",
      ),
    ).toEqual({ ok: false, code: "DEVICE_AUTH_CLOSED" });
    const secrets = await q(
      "SELECT start_secret_ciphertext,start_secret_nonce,start_secret_auth_tag,denied_at FROM device_authorizations WHERE id=$1",
      [denied.authorizationId],
    );
    expect(secrets.rows[0]).toMatchObject({
      start_secret_ciphertext: null,
      start_secret_nonce: null,
      start_secret_auth_tag: null,
    });
    const race = value(await start("R".repeat(16)));
    const outcomes = await Promise.all([
      service().approve(
        race.authorizationId,
        ownerAccount,
        race.userCode,
        ownerId,
        "198.51.100.25",
        "race-a",
      ),
      service().deny(
        race.authorizationId,
        race.userCode,
        ownerId,
        "198.51.100.25",
        "race-d",
      ),
    ]);
    expect(outcomes.filter((x) => x.ok)).toHaveLength(1);
    expect(
      (
        await q<{ status: string }>(
          "SELECT status FROM device_authorizations WHERE id=$1",
          [race.authorizationId],
        )
      ).rows[0]?.status,
    ).toMatch(/APPROVED|DENIED/);
  });

  it("I expires pending and approved once across workers but leaves non-due approved encrypted", async () => {
    const { userId, accountId } = await owner();
    const pending = value(await start("P".repeat(16)));
    const dueApproved = value(await start("Q".repeat(16)));
    const futureApproved = value(await start("T".repeat(16)));
    for (const x of [dueApproved, futureApproved])
      value(
        await service().approve(
          x.authorizationId,
          accountId,
          x.userCode,
          userId,
          "198.51.100.25",
          randomUUID(),
        ),
      );
    await q(
      "UPDATE device_authorizations SET expires_at=now()-interval '1 second' WHERE id = ANY($1::uuid[])",
      [[pending.authorizationId, dueApproved.authorizationId]],
    );
    const repo = createDeviceAuthorizationRepository(db);
    await Promise.all([
      repo.expireDue(10, "worker-a"),
      repo.expireDue(10, "worker-b"),
    ]);
    const rows = await q<{
      id: string;
      status: string;
      start_secret_ciphertext: Buffer | null;
    }>(
      "SELECT id,status,start_secret_ciphertext FROM device_authorizations ORDER BY id",
    );
    expect(
      rows.rows
        .filter((r) => r.id !== futureApproved.authorizationId)
        .every(
          (r) => r.status === "EXPIRED" && r.start_secret_ciphertext === null,
        ),
    ).toBe(true);
    expect(
      rows.rows.find((r) => r.id === futureApproved.authorizationId),
    ).toMatchObject({ status: "APPROVED" });
    expect(
      rows.rows.find((r) => r.id === futureApproved.authorizationId)
        ?.start_secret_ciphertext,
    ).toBeTruthy();
    expect(
      (await q("SELECT * FROM audit_events WHERE action='DEVICE_AUTH_EXPIRED'"))
        .rows,
    ).toHaveLength(2);
  });

  it("K classifies only code hash constraints, retries collisions through attempt eight, and rolls collision rate use back", async () => {
    const device = "A".repeat(43),
      user = "ABCDEFGH";
    const seed = new DeviceAuthorizationService(
      createDeviceAuthorizationRepository(db),
      keys,
      undefined,
      () => ({ deviceCode: device, rawUserCode: user }),
    );
    value(await seed.start(body, "K".repeat(16), "192.0.2.9", "seed"));
    let n = 0;
    const retry = new DeviceAuthorizationService(
      createDeviceAuthorizationRepository(db),
      keys,
      undefined,
      () =>
        ++n < 8
          ? { deviceCode: device, rawUserCode: user }
          : { deviceCode: "B".repeat(43), rawUserCode: "BCDEFGHJ" },
    );
    expect(
      (await retry.start(body, "L".repeat(16), "192.0.2.9", "retry")).ok,
    ).toBe(true);
    expect(n).toBe(8);
    expect(
      (
        await q<{ count: number }>(
          "SELECT count FROM auth_rate_limit_buckets WHERE action='DEVICE_AUTH_START_IP'",
        )
      ).rows[0]?.count,
    ).toBe(2);
    const repository = createDeviceAuthorizationRepository(db);
    const collisionInput = (
      deviceCode: string,
      userCode: string,
      key: string,
    ) => ({
      record: {
        id: randomUUID(),
        status: "PENDING" as const,
        idempotencyKeyHash: idempotencyKeyArtifact(keys, key),
        requestFingerprint: requestFingerprint(body),
        deviceCodeHash: deviceCodeArtifact(keys, deviceCode),
        userCodeHash: userCodeArtifact(keys, userCode),
        browserFamily: "chrome" as const,
        extensionVersion: "1",
        expiresAt: new Date(Date.now() + 60_000),
        envelope: {
          ciphertext: Buffer.from("x"),
          nonce: Buffer.alloc(12),
          authTag: Buffer.alloc(16),
        },
      },
      ipKey: "v1:collision-check",
      correlationId: "collision-check",
    });
    expect(
      await repository.start(
        collisionInput(device, "BCDEFGHJ", "Y".repeat(16)),
      ),
    ).toEqual({ ok: false, code: "DEVICE_AUTH_COLLISION" });
    expect(
      await repository.start(
        collisionInput("C".repeat(43), user, "Z".repeat(16)),
      ),
    ).toEqual({ ok: false, code: "DEVICE_AUTH_COLLISION" });
    const duplicateId = randomUUID();
    await q(
      "INSERT INTO device_authorizations(id,device_code_hash,user_code_hash,status,requested_client_type,browser_family,extension_version,idempotency_key_hash,request_fingerprint,start_secret_ciphertext,start_secret_nonce,start_secret_auth_tag,expires_at) VALUES($1,$2,$3,'PENDING','browser_extension','chrome','1',$4,$5,$6,$7,$8,now()+interval '1 hour')",
      [
        duplicateId,
        deviceCodeArtifact(keys, "C".repeat(43)),
        userCodeArtifact(keys, "CDEFGHJK"),
        idempotencyKeyArtifact(keys, "M".repeat(16)),
        requestFingerprint(body),
        Buffer.from("x"),
        Buffer.alloc(12),
        Buffer.alloc(16),
      ],
    );
    await expect(
      createDeviceAuthorizationRepository(db).start({
        record: {
          id: duplicateId,
          status: "PENDING",
          idempotencyKeyHash: idempotencyKeyArtifact(keys, "Z".repeat(16)),
          requestFingerprint: requestFingerprint(body),
          deviceCodeHash: deviceCodeArtifact(keys, "D".repeat(43)),
          userCodeHash: userCodeArtifact(keys, "DEFGHJKL"),
          browserFamily: "chrome",
          extensionVersion: "1",
          expiresAt: new Date(Date.now() + 60_000),
          envelope: {
            ciphertext: Buffer.from("x"),
            nonce: Buffer.alloc(12),
            authTag: Buffer.alloc(16),
          },
        },
        ipKey: "v1:test",
        correlationId: "unrelated",
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("L persists the complete safe audit matrix without secret or raw identifiers", async () => {
    const { userId, accountId } = await owner();
    const x = value(await start("V".repeat(16)));
    await service().start(
      { ...body, deviceLabel: "conflict" },
      "V".repeat(16),
      "198.51.100.25",
      "conflict",
    );
    await service().approve(
      x.authorizationId,
      accountId,
      "ABCD-EFGH",
      userId,
      "198.51.100.25",
      "bad",
    );
    value(
      await service().approve(
        x.authorizationId,
        accountId,
        x.userCode,
        userId,
        "198.51.100.25",
        "approve",
      ),
    );
    const y = value(await start("W".repeat(16)));
    value(
      await service().deny(
        y.authorizationId,
        y.userCode,
        userId,
        "198.51.100.25",
        "deny",
      ),
    );
    await q(
      "UPDATE device_authorizations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [x.authorizationId],
    );
    await createDeviceAuthorizationRepository(db).expireDue(10, "expire");
    await Promise.all(
      Array.from({ length: 21 }, (_, i) =>
        start(`X${String(i).padStart(15, "0")}`),
      ),
    );
    const audit = JSON.stringify((await q("SELECT * FROM audit_events")).rows);
    for (const action of [
      "DEVICE_AUTH_STARTED",
      "DEVICE_AUTH_RATE_LIMITED",
      "DEVICE_AUTH_IDEMPOTENCY_CONFLICT",
      "DEVICE_AUTH_USER_CODE_FAILED",
      "DEVICE_AUTH_APPROVED",
      "DEVICE_AUTH_DENIED",
      "DEVICE_AUTH_EXPIRED",
    ])
      expect(audit).toContain(action);
    for (const secret of [
      x.deviceCode,
      x.userCode,
      "V".repeat(16),
      "198.51.100.25",
      "AUTH_ROOT_SECRET",
    ])
      expect(audit).not.toContain(secret);
  });
});
