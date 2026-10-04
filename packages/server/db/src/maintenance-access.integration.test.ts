import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AdminAuthService,
  deriveAdminAuthKeys,
  MaintenanceAccessService,
  MAINTENANCE_LEASE_MS,
  type AdminSubject,
} from "@product/admin-auth";
import {
  createDatabaseRuntime,
  createAdminAuthRepository,
  createMaintenanceRepository,
  type DatabaseRuntime,
} from "./index.js";
import { runMigrations } from "./migrations.js";

// Use the same explicitly supplied disposable database as the repository integration runner.
// The dedicated task harness supplies its own isolated loopback database; no API env file is read.
const url = process.env.MAINTENANCE_TEST_DB_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Explicit disposable test DATABASE_URL is required");
let db: DatabaseRuntime;
const start = new Date("2030-01-01T00:00:00Z");
let now: Date;
function service() {
  return new MaintenanceAccessService(
    createMaintenanceRepository(db),
    () => now,
  );
}
async function owner(): Promise<AdminSubject> {
  const userId = randomUUID(),
    principalId = randomUUID(),
    portalId = randomUUID();
  await db.query("INSERT INTO users(id,status) VALUES($1,'ACTIVE')", [userId]);
  await db.query("INSERT INTO admin_principals(id,user_id) VALUES($1,$2)", [
    principalId,
    userId,
  ]);
  await db.query(
    "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,'ADMIN_OWNER')",
    [principalId],
  );
  await db.query(
    "INSERT INTO portal_sessions(id,user_id,created_at,expires_at,session_token_hash) VALUES($1,$2,$3,$4,$5)",
    [
      portalId,
      userId,
      now,
      new Date(now.getTime() + 86400_000),
      "fixture-" + portalId,
    ],
  );
  const auth = new AdminAuthService(
    createAdminAuthRepository(db),
    deriveAdminAuthKeys(Buffer.alloc(32, 7)),
    () => now,
  );
  const issued = await auth.createAdminSession(
    { sessionId: portalId, userId, createdAt: now },
    "fixture-elevation",
  );
  if (!issued.ok) throw new Error("Fixture human elevation failed");
  return issued.value.subject;
}
async function issue(issuer: AdminSubject) {
  const result = await service().issue(
    issuer,
    "Controller",
    ["compatibility.read", "compatibility.manage"],
    "fixture-issue",
  );
  if (!result.ok) throw new Error("Fixture delegation failed");
  return result.value;
}
describe.sequential(
  "maintenance access with actual PostgreSQL repository",
  () => {
    it("keeps an old live grant visible and revocable after 101 historical grants", async () => {
      const human = await owner();
      const credential = await issue(human);
      await db.query(
        `INSERT INTO admin_maintenance_grants
         (id,label,admin_principal_id,issuer_revision,source_admin_session_id,
          permissions,token_hash,created_at,expires_at,revoked_at)
         SELECT gen_random_uuid(),'History',$1,1,$2,'["health.read"]'::jsonb,
           repeat('a',32)||lpad(n::text,32,'0'),$3::timestamptz+interval '1 second',
           $3::timestamptz+interval '1 day',$3::timestamptz+interval '2 seconds'
         FROM generate_series(1,101) n`,
        [human.adminPrincipalId, human.adminSessionId, now],
      );
      const listed = await service().list(human);
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.value).toHaveLength(100);
      expect(listed.value[0]?.id).toBe(credential.grant.id);
      expect(
        (await service().revoke(human, credential.grant.id, "revoke-old-live"))
          .ok,
      ).toBe(true);
      expect((await service().authenticate(credential.token)).ok).toBe(false);
    });

    beforeAll(async () => {
      db = createDatabaseRuntime(url);
      await db.ready();
      await runMigrations({ connectionString: url });
    }, 60_000);
    beforeEach(async () => {
      now = start;
      await db.query(
        "TRUNCATE admin_sessions,admin_role_grants,admin_principals,audit_events,portal_sessions,user_identities,accounts,users CASCADE",
      );
    });
    afterAll(async () => {
      await db?.close();
    });

    it("outlives the issuing session, rotates atomically and stores no plaintext credentials", async () => {
      const human = await owner();
      const credential = await issue(human);
      now = new Date(start.getTime() + 2 * 86400_000);
      expect((await service().authenticate(credential.token)).ok).toBe(true);
      const nonce = "n".repeat(43);
      const responses = await Promise.all([
        service().rotate(credential.token, nonce, "one"),
        service().rotate(credential.token, nonce, "two"),
      ]);
      expect(responses[0]).toEqual(responses[1]);
      expect(responses[0]?.ok).toBe(true);
      const rotated = responses[0]!;
      if (!rotated.ok) return;
      expect((await service().authenticate(credential.token)).ok).toBe(false);
      expect((await service().authenticate(rotated.value.token)).ok).toBe(true);
      const stored = await db.query("SELECT * FROM admin_maintenance_grants");
      expect(JSON.stringify(stored.rows)).not.toContain(credential.token);
      expect(JSON.stringify(stored.rows)).not.toContain(rotated.value.token);
      expect(
        (await service().rotate(credential.token, "x".repeat(43), "conflict"))
          .ok,
      ).toBe(false);
      now = new Date(now.getTime() + 120_000);
      expect(
        (await service().rotate(credential.token, nonce, "too-late")).ok,
      ).toBe(false);
    });
    it("rechecks actual issuing session and owner state instead of trusting a supplied subject", async () => {
      const human = await owner();
      await db.query(
        "UPDATE admin_sessions SET revoked_at=$2,revoke_reason='LOGOUT' WHERE id=$1",
        [human.adminSessionId, now],
      );
      expect(
        (
          await service().issue(
            human,
            "Controller",
            ["health.read"],
            "revoked-human",
          )
        ).ok,
      ).toBe(false);
      expect(
        (
          await db.query<{ count: string }>(
            "SELECT count(*) FROM admin_maintenance_grants",
          )
        ).rows[0]?.count,
      ).toBe("0");
    });
    it("rejects revoked grants, changed issuer revision and expired credentials", async () => {
      const human = await owner();
      const first = await issue(human);
      expect((await service().revoke(human, first.grant.id, "revoke")).ok).toBe(
        true,
      );
      expect((await service().authenticate(first.token)).ok).toBe(false);
      expect(
        (await service().rotate(first.token, "n".repeat(43), "revoked")).ok,
      ).toBe(false);
      const second = await issue(human);
      await db.query(
        "UPDATE admin_principals SET revision=revision+1 WHERE id=$1",
        [human.adminPrincipalId],
      );
      expect((await service().authenticate(second.token)).ok).toBe(false);
      const third = await issue(human);
      now = new Date(start.getTime() + MAINTENANCE_LEASE_MS);
      expect((await service().authenticate(third.token)).ok).toBe(false);
      expect(
        (await service().rotate(third.token, "n".repeat(43), "expired")).ok,
      ).toBe(false);
    });
    it("does not let stale authority revisions consume capacity or appear current", async () => {
      const human = await owner();
      const stale = [];
      for (let index = 0; index < 10; index += 1)
        stale.push(await issue(human));
      expect(
        (
          await service().issue(
            human,
            "Over old revision limit",
            ["health.read"],
            "old-revision-cap",
          )
        ).ok,
      ).toBe(false);

      await db.query(
        "UPDATE admin_principals SET revision=revision+1 WHERE id=$1",
        [human.adminPrincipalId],
      );
      for (const credential of stale) {
        expect((await service().authenticate(credential.token)).ok).toBe(false);
        expect(
          (
            await service().rotate(
              credential.token,
              "n".repeat(43),
              "stale-revision",
            )
          ).ok,
        ).toBe(false);
      }

      const afterRevision = await service().list(human);
      expect(afterRevision.ok).toBe(true);
      if (!afterRevision.ok) return;
      expect(afterRevision.value).toEqual([]);

      const current = [await issue(human)];
      for (let index = 1; index < 10; index += 1)
        current.push(await issue(human));
      const listed = await service().list(human);
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.value).toHaveLength(10);
      expect(new Set(listed.value.map((grant) => grant.id))).toEqual(
        new Set(current.map((credential) => credential.grant.id)),
      );
      expect(
        (
          await service().issue(
            human,
            "Over current revision limit",
            ["health.read"],
            "current-revision-cap",
          )
        ).ok,
      ).toBe(false);
      expect(
        (
          await db.query<{ count: string }>(
            "SELECT count(*) FROM admin_maintenance_grants WHERE admin_principal_id=$1",
            [human.adminPrincipalId],
          )
        ).rows[0]?.count,
      ).toBe("20");
    });
    it("revoking the owner's role disables authentication and rotation", async () => {
      const human = await owner();
      const credential = await issue(human);
      await db.query(
        "UPDATE admin_role_grants SET revoked_at=$2,revoked_by_admin_principal_id=$1 WHERE admin_principal_id=$1",
        [human.adminPrincipalId, now],
      );
      expect((await service().authenticate(credential.token)).ok).toBe(false);
      expect(
        (
          await service().rotate(
            credential.token,
            "n".repeat(43),
            "removed-role",
          )
        ).ok,
      ).toBe(false);
    });
    it("a separate grant survives logout of its issuing human session", async () => {
      const human = await owner();
      const credential = await issue(human);
      await db.query(
        "UPDATE admin_sessions SET revoked_at=$2,revoke_reason='LOGOUT' WHERE id=$1",
        [human.adminSessionId, now],
      );
      expect((await service().authenticate(credential.token)).ok).toBe(true);
    });
  },
);
