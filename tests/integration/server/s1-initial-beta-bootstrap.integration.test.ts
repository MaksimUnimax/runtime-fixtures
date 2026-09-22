import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, afterAll } from "vitest";
import { BetaAdmissionService } from "../../../packages/server/beta-access/src/index.js";
import {
  bootstrapInitialBetaAdmission,
  createBetaAdmissionRepository,
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for initial beta bootstrap tests");

let db: DatabaseRuntime;
const now = new Date("2030-01-01T00:00:00.000Z");

async function q<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) {
  return db.query<T>(text, values);
}

async function reset() {
  await q(
    "TRUNCATE beta_admission_mutations,beta_admission_state,audit_events,admin_role_grants,admin_principals,users CASCADE",
  );
  await q(
    "INSERT INTO beta_admission_state(id,mode,capacity,admitted,revision,updated_at) VALUES(1,'CLOSED',0,0,1,$1)",
    [now],
  );
}

async function grant(role: string) {
  const userId = randomUUID();
  const principalId = randomUUID();
  await q("INSERT INTO users(id) VALUES($1)", [userId]);
  await q("INSERT INTO admin_principals(id,user_id) VALUES($1,$2)", [
    principalId,
    userId,
  ]);
  await q(
    "INSERT INTO admin_role_grants(admin_principal_id,role) VALUES($1,$2)",
    [principalId, role],
  );
}

async function auditRows() {
  return q<{
    actor_type: string;
    actor_id: string | null;
    action: string;
    reason: string | null;
    safe_metadata: Record<string, unknown>;
  }>(
    "SELECT actor_type,actor_id,action,reason,safe_metadata FROM audit_events WHERE action='BETA_ADMISSION_INITIAL_BOOTSTRAPPED'",
  );
}

async function count(table: string) {
  const result = await q<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]!.count);
}

function call() {
  return bootstrapInitialBetaAdmission(db, {
    correlationId: randomUUID(),
    reason:
      "Initial production beta bootstrap for first verified owner account",
  });
}

describe.sequential("initial beta admission bootstrap", () => {
  beforeAll(async () => {
    await runMigrations({ connectionString });
    db = createDatabaseRuntime(connectionString);
    await db.ready();
  });
  beforeEach(reset);
  afterAll(() => db.close());

  it("BOOT-01 pristine state and no admin grants applies", async () => {
    await expect(call()).resolves.toMatchObject({ kind: "APPLIED" });
  });

  it("BOOT-02 returns exactly one open slot at revision 2", async () => {
    const result = await call();
    expect(result).toMatchObject({
      kind: "APPLIED",
      state: {
        mode: "OPEN",
        capacity: 1,
        admitted: 0,
        remaining: 1,
        revision: 2,
      },
    });
  });

  it("BOOT-03 writes exactly one bootstrap audit event", async () => {
    await call();
    expect((await auditRows()).rows).toHaveLength(1);
  });

  it("BOOT-04/05 uses SYSTEM with a null actor", async () => {
    await call();
    expect((await auditRows()).rows[0]).toMatchObject({
      actor_type: "SYSTEM",
      actor_id: null,
    });
  });

  it("BOOT-06/07/08/09/10 creates no user, account, admission, principal, or grant", async () => {
    const before = await Promise.all([
      count("users"),
      count("accounts"),
      count("beta_admissions"),
      count("admin_principals"),
      count("admin_role_grants"),
    ]);
    await call();
    const after = await Promise.all([
      count("users"),
      count("accounts"),
      count("beta_admissions"),
      count("admin_principals"),
      count("admin_role_grants"),
    ]);
    expect(after).toEqual(before);
  });

  it.each(["ADMIN_OWNER", "ADMIN_BETA_OPERATOR", "ADMIN_OPS"])(
    "BOOT-11/12/13 active %s closes bootstrap",
    async (role) => {
      await grant(role);
      await expect(call()).resolves.toEqual({ kind: "BOOTSTRAP_CLOSED" });
      expect((await auditRows()).rows).toHaveLength(0);
    },
  );

  it.each([
    ["BOOT-14", "OPEN", 0, 0, 1],
    ["BOOT-15", "PAUSED", 0, 0, 1],
    ["BOOT-16", "CLOSED", 1, 0, 1],
    ["BOOT-17", "CLOSED", 1, 1, 1],
    ["BOOT-18", "CLOSED", 0, 0, 2],
  ] as const)(
    "%s non-pristine state closes bootstrap",
    async (_case, mode, capacity, admitted, revision) => {
      await q(
        "UPDATE beta_admission_state SET mode=$1,capacity=$2,admitted=$3,revision=$4 WHERE id=1",
        [mode, capacity, admitted, revision],
      );
      await expect(call()).resolves.toEqual({ kind: "BOOTSTRAP_CLOSED" });
      expect((await auditRows()).rows).toHaveLength(0);
    },
  );

  it("BOOT-19 second invocation is closed", async () => {
    await expect(call()).resolves.toMatchObject({ kind: "APPLIED" });
    await expect(call()).resolves.toEqual({ kind: "BOOTSTRAP_CLOSED" });
    expect((await auditRows()).rows).toHaveLength(1);
  });

  it("BOOT-20 concurrent invocations apply exactly once", async () => {
    const other = createDatabaseRuntime(connectionString);
    await other.ready();
    try {
      const second = new BetaAdmissionService(
        createBetaAdmissionRepository(other),
      );
      const results = await Promise.all([
        call(),
        bootstrapInitialBetaAdmission(other, {
          correlationId: randomUUID(),
          reason: "concurrent test",
        }),
      ]);
      expect(
        results.filter((result) => result.kind === "APPLIED"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.kind === "BOOTSTRAP_CLOSED"),
      ).toHaveLength(1);
      expect((await auditRows()).rows).toHaveLength(1);
      expect(await second.read()).toMatchObject({
        mode: "OPEN",
        capacity: 1,
        admitted: 0,
        remaining: 1,
        revision: 2,
      });
    } finally {
      await other.close();
    }
  });

  it("BOOT-21 normal BetaAdmissionService authorization is unchanged", async () => {
    const service = new BetaAdmissionService(createBetaAdmissionRepository(db));
    await expect(
      service.mutate({
        actorPrincipalId: randomUUID(),
        requestId: randomUUID(),
        correlationId: randomUUID(),
        expectedRevision: 1,
        action: "OPEN",
        reason: "normal authorization check",
      }),
    ).resolves.toEqual({ kind: "FORBIDDEN" });
    expect((await auditRows()).rows).toHaveLength(0);
  });

  it("BOOT-24 audit contains only safe state metadata", async () => {
    await call();
    const row = (await auditRows()).rows[0]!;
    expect(row.reason).toBe(
      "Initial production beta bootstrap for first verified owner account",
    );
    expect(row.safe_metadata).toEqual({
      old: { mode: "CLOSED", capacity: 0, admitted: 0, revision: 1 },
      new: { mode: "OPEN", capacity: 1, admitted: 0, revision: 2 },
    });
    expect(JSON.stringify(row)).not.toMatch(
      /email|user|secret|token|password/i,
    );
  });
});
