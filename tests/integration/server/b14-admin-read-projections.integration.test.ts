import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { permissionsForRole } from "@product/admin-auth";
import {
  encodeB14StoreCursor,
  type B14AuditSummary,
} from "../../../packages/server/admin-ops/src/index.js";
import {
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";
import { readB14AuditSummaries } from "../../../packages/server/db/src/b14-audit-read-projection.js";
import { readB14StoreMetadataPage } from "../../../packages/server/db/src/b14-store-read-projection.js";
import { resetTransferProtectedTestFixture } from "./helpers/credential-transfer-fixture-reset.js";

// Authored real PostgreSQL read-projection tests. They do not exercise public
// HTTP authorization or an installed application. Do not replace the fixture
// guard with an arbitrary local DATABASE_URL or spoof GitHub CI identity.
const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for B14 read projections");

let db: DatabaseRuntime;
const owner = permissionsForRole("ADMIN_OWNER");
const canary = "B14_SYNTHETIC_PRIVATE_CANARY";
const planRevisionId = "00000000-0000-4000-8000-0000000000a1";
const earlier = "2026-09-01T12:00:00.000Z";
const later = "2026-10-01T12:00:00.000Z";

type AuditFixture = {
  action: string;
  targetType: string;
  metadata: Record<string, unknown>;
  expected: B14AuditSummary;
};

// These are persisted writer shapes, not the already-flattened mapper input.
// In particular Beta old/new are nested, grant fromState and override expiry
// contain JSON null, and a legacy initial role grant lacks both revisions.
const auditFixtures: AuditFixture[] = [
  {
    action: "ADMIN_PRINCIPAL_CREATED",
    targetType: "ADMIN_PRINCIPAL",
    metadata: { initialRole: "ADMIN_SUPPORT" },
    expected: {
      what: {
        kind: "ADMIN_PRINCIPAL_CREATED",
        initialRole: "ADMIN_SUPPORT",
      },
    },
  },
  {
    action: "ADMIN_ROLE_GRANTED",
    targetType: "ADMIN_PRINCIPAL",
    metadata: { role: "ADMIN_SUPPORT" },
    expected: { what: { kind: "ADMIN_ROLE_GRANTED", role: "ADMIN_SUPPORT" } },
  },
  {
    action: "ADMIN_ROLE_REVOKED",
    targetType: "ADMIN_PRINCIPAL",
    metadata: { role: "ADMIN_SUPPORT", oldRevision: 1, newRevision: 2 },
    expected: {
      what: {
        kind: "ADMIN_ROLE_REVOKED",
        role: "ADMIN_SUPPORT",
        revision: { from: 1, to: 2 },
      },
    },
  },
  {
    action: "ADMIN_PRINCIPAL_SUSPENDED",
    targetType: "ADMIN_PRINCIPAL",
    metadata: { oldRevision: 2, newRevision: 3, revokedSessionCount: 0 },
    expected: {
      what: {
        kind: "ADMIN_PRINCIPAL_SUSPENDED",
        revision: { from: 2, to: 3 },
        revokedSessionCount: 0,
      },
    },
  },
  {
    action: "ADMIN_PRINCIPAL_RESTORED",
    targetType: "ADMIN_PRINCIPAL",
    metadata: { oldRevision: 3, newRevision: 4 },
    expected: {
      what: {
        kind: "ADMIN_PRINCIPAL_RESTORED",
        revision: { from: 3, to: 4 },
      },
    },
  },
  {
    action: "ADMIN_DEVICE_REVOKED",
    targetType: "DEVICE",
    metadata: { reasonCode: "ADMIN_REVOKED", accountId: randomUUID() },
    expected: { what: { kind: "ADMIN_DEVICE_REVOKED" } },
  },
  {
    action: "SUBSCRIPTION_GRANTED",
    targetType: "SUBSCRIPTION",
    metadata: {
      planRevisionId,
      fromState: null,
      toState: "ACTIVE",
      stateRevision: 1,
      transitionRevision: 1,
    },
    expected: {
      what: {
        kind: "SUBSCRIPTION_GRANTED",
        planRevisionId,
        fromState: null,
        toState: "ACTIVE",
        stateRevision: 1,
        transitionRevision: 1,
      },
    },
  },
  {
    action: "SUBSCRIPTION_EXTENDED",
    targetType: "SUBSCRIPTION",
    metadata: {
      oldStateRevision: 1,
      newStateRevision: 2,
      oldPeriodEnd: earlier,
      newPeriodEnd: later,
    },
    expected: {
      what: {
        kind: "SUBSCRIPTION_EXTENDED",
        revision: { from: 1, to: 2 },
        periodEnd: { from: earlier, to: later },
      },
    },
  },
  {
    action: "SUBSCRIPTION_SUSPENDED",
    targetType: "SUBSCRIPTION",
    metadata: {
      fromState: "ACTIVE",
      toState: "SUSPENDED",
      oldStateRevision: 2,
      newStateRevision: 3,
      transitionRevision: 2,
    },
    expected: {
      what: {
        kind: "SUBSCRIPTION_SUSPENDED",
        fromState: "ACTIVE",
        toState: "SUSPENDED",
        revision: { from: 2, to: 3 },
        transitionRevision: 2,
      },
    },
  },
  {
    action: "SUBSCRIPTION_RESTORED",
    targetType: "SUBSCRIPTION",
    metadata: {
      fromState: "SUSPENDED",
      toState: "ACTIVE",
      oldStateRevision: 3,
      newStateRevision: 4,
      transitionRevision: 3,
    },
    expected: {
      what: {
        kind: "SUBSCRIPTION_RESTORED",
        fromState: "SUSPENDED",
        toState: "ACTIVE",
        revision: { from: 3, to: 4 },
        transitionRevision: 3,
      },
    },
  },
  ...(["SET", "CLEAR"] as const).map((operation): AuditFixture => {
    const action =
      operation === "SET"
        ? "ACCOUNT_ENTITLEMENT_OVERRIDE_SET"
        : "ACCOUNT_ENTITLEMENT_OVERRIDE_CLEARED";
    const fields = {
      entitlementKey: "extension.max_devices",
      overrideRevision: operation === "SET" ? 1 : 2,
      operation,
      valueType: "INTEGER" as const,
      effectiveFrom: earlier,
      expiresAt: null,
    };
    return {
      action,
      targetType: "ACCOUNT",
      metadata: fields,
      expected: { what: { kind: action, ...fields } },
    };
  }),
  {
    action: "BETA_ADMISSION_CHANGED",
    targetType: "BETA_ADMISSION_STATE",
    metadata: {
      action: "OPEN",
      old: { mode: "CLOSED", capacity: 10, admitted: 3, revision: 6 },
      new: { mode: "OPEN", capacity: 10, admitted: 3, revision: 7 },
    },
    expected: {
      what: {
        kind: "BETA_ADMISSION_CHANGED",
        action: "OPEN",
        old: { mode: "CLOSED", capacity: 10, admitted: 3, revision: 6 },
        new: { mode: "OPEN", capacity: 10, admitted: 3, revision: 7 },
      },
    },
  },
  {
    action: "BETA_IDENTITY_INVITED",
    targetType: "BETA_IDENTITY_INVITATION",
    metadata: { expiresAt: later },
    expected: {
      what: { kind: "BETA_IDENTITY_INVITED", expiresAt: later },
    },
  },
  {
    action: "BETA_IDENTITY_INVITATION_REVOKED",
    targetType: "BETA_IDENTITY_INVITATION",
    metadata: { requestIdHash: canary },
    expected: { what: { kind: "BETA_IDENTITY_INVITATION_REVOKED" } },
  },
];

async function seedAccount() {
  const accountId = randomUUID();
  await db.query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
  return accountId;
}

async function seedStore(
  accountId: string,
  storeId: string,
  override: Record<string, unknown> = {},
) {
  const state = {
    kind: "STORE_UPSERT",
    storeId,
    name: `Store ${storeId}`,
    marketplace: "ozon",
    lifecycleState: "ACTIVE",
    metadataRevision: 1,
    providerIdentityState: "UNCONFIRMED",
    providerAccountId: null,
    bindingId: null,
    conversationKeyDigest: "a".repeat(64),
    credentialRevision: canary,
    // A nonempty hostile persisted extra proves that the reader selects an
    // allowlist. It is not a claim the current sync writer accepts this field.
    privateDiagnostic: { token: canary },
    ...override,
  };
  await db.query(
    "INSERT INTO sync_entities(account_id,entity_id,server_revision,state,installation_id,updated_at) VALUES($1,$2,1,$3::jsonb,$4,$5::timestamptz)",
    [accountId, `store:${storeId}`, JSON.stringify(state), randomUUID(), later],
  );
}

async function seedAudit(
  fixture: Pick<AuditFixture, "action" | "targetType" | "metadata">,
  targetId: string | null = randomUUID(),
) {
  const eventId = randomUUID();
  const correlationId = `b14-read-${eventId}`;
  await db.query(
    "INSERT INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata) VALUES($1,'ADMIN',$2,$3,$4,$5,$6,$7,$8::jsonb)",
    [
      eventId,
      randomUUID(),
      fixture.action,
      fixture.targetType,
      targetId,
      correlationId,
      canary,
      JSON.stringify({
        ...fixture.metadata,
        requestIdHash: canary,
        identityHash: canary,
        email: `${canary}@example.test`,
        privateDiagnostic: { token: canary },
      }),
    ],
  );
  return { eventId, targetId, correlationId };
}

describe.sequential("B14 internal read projections on real PostgreSQL", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString);
    await db.ready();
    await runMigrations({ connectionString });
  });
  beforeEach(async () => {
    // accounts CASCADE includes sync_entities through its real FK. Keep the
    // installed epoch fence and the existing database identity guard enabled.
    await resetTransferProtectedTestFixture(
      db,
      "TRUNCATE accounts,audit_events CASCADE",
    );
  });
  afterAll(async () => db?.close());

  it("reads only the requested account's ACTIVE store metadata without private sync fields", async () => {
    const accountId = await seedAccount();
    const otherAccount = await seedAccount();
    await seedStore(accountId, "a");
    await seedStore(otherAccount, "a", { name: "Other account store" });
    await seedStore(accountId, "gone", {
      kind: "STORE_TOMBSTONE",
      lifecycleState: "TOMBSTONED",
    });
    await seedStore(accountId, "binding", { kind: "BINDING_UPSERT" });
    const result = await readB14StoreMetadataPage(db, { accountId });
    expect(result).toEqual({
      kind: "OK",
      items: [
        {
          storeId: "a",
          name: "Store a",
          marketplace: "ozon",
          providerIdentityState: "UNCONFIRMED",
          providerAccountId: null,
          metadataRevision: 1,
          serverRevision: 1,
          updatedAt: later,
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(JSON.stringify(result)).not.toMatch(
      /installationId|credentialRevision|conversationKeyDigest|bindingId|privateDiagnostic/,
    );
  });

  it("uses bounded keyset pages with no missing or duplicate store", async () => {
    const accountId = await seedAccount();
    for (const id of ["c", "a", "b"]) await seedStore(accountId, id);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const result = await readB14StoreMetadataPage(db, {
        accountId,
        cursor,
        limit: 1,
      });
      expect(result.kind).toBe("OK");
      if (result.kind !== "OK") throw new Error(result.kind);
      expect(result.items).toHaveLength(1);
      seen.push(result.items[0]!.storeId);
      cursor = result.nextCursor;
      if (page < 2) expect(cursor).not.toBeNull();
    }
    expect(seen).toEqual(["a", "b", "c"]);
    expect(cursor).toBeNull();
  });

  it("rejects a cross-account or no-longer-ACTIVE cursor against the actual current set", async () => {
    const accountId = await seedAccount();
    const otherAccount = await seedAccount();
    for (const id of ["a", "b"]) await seedStore(accountId, id);
    await seedStore(otherAccount, "a");
    const cursor = encodeB14StoreCursor(accountId, "store:a");
    expect(cursor).not.toBeNull();
    expect(
      await readB14StoreMetadataPage(db, { accountId: otherAccount, cursor }),
    ).toEqual({ kind: "INVALID_CURSOR" });
    await db.query(
      "UPDATE sync_entities SET state=jsonb_set(state,'{lifecycleState}','\"TOMBSTONED\"'::jsonb) WHERE account_id=$1 AND entity_id='store:a'",
      [accountId],
    );
    expect(await readB14StoreMetadataPage(db, { accountId, cursor })).toEqual({
      kind: "INVALID_CURSOR",
    });
    expect(
      await readB14StoreMetadataPage(db, {
        accountId,
        cursor: encodeB14StoreCursor(accountId, "store:missing"),
      }),
    ).toEqual({ kind: "INVALID_CURSOR" });
  });

  it("distinguishes an existing empty account from an absent account", async () => {
    expect(
      await readB14StoreMetadataPage(db, { accountId: await seedAccount() }),
    ).toEqual({ kind: "OK", items: [], nextCursor: null });
    expect(
      await readB14StoreMetadataPage(db, { accountId: randomUUID() }),
    ).toEqual({ kind: "ACCOUNT_NOT_FOUND" });
  });

  it("keeps SQL JSON numbers distinct from strings and fails the full page closed", async () => {
    const accountId = await seedAccount();
    await seedStore(accountId, "a");
    await seedStore(accountId, "b", { metadataRevision: "1" });
    expect(await readB14StoreMetadataPage(db, { accountId, limit: 1 })).toEqual(
      { kind: "INVALID_STORE_METADATA" },
    );
  });

  it("does not round a fractional JSON numeric into a valid store revision", async () => {
    const accountId = await seedAccount();
    await seedStore(accountId, "a");
    // JSON.stringify would already round this input in JavaScript and would
    // not exercise PostgreSQL's exact numeric at the driver boundary.
    await db.query(
      "UPDATE sync_entities SET state=jsonb_set(state,'{metadataRevision}','1.0000000000000001'::jsonb) WHERE account_id=$1 AND entity_id='store:a'",
      [accountId],
    );
    expect(await readB14StoreMetadataPage(db, { accountId })).toEqual({
      kind: "INVALID_STORE_METADATA",
    });
  });

  it("withholds credential-shaped names and never asserts provider verification", async () => {
    const accountId = await seedAccount();
    await seedStore(accountId, "a", {
      name: `api_key=${canary}`,
      providerAccountId: "seller-42",
      providerIdentityState: "CONFIRMED",
    });
    const result = await readB14StoreMetadataPage(db, { accountId });
    expect(result).toMatchObject({
      kind: "OK",
      items: [
        {
          name: null,
          providerAccountId: "seller-42",
          providerIdentityState: "CONFIRMED",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(JSON.stringify(result)).not.toMatch(/credential|verified/i);
  });

  it.each(auditFixtures)(
    "extracts real JSON fields for $action without private reason or metadata",
    async (fixture) => {
      const { eventId } = await seedAudit(
        fixture,
        fixture.targetType === "BETA_ADMISSION_STATE" ? null : randomUUID(),
      );
      const result = await readB14AuditSummaries(db, {
        eventIds: [eventId],
        permissions: owner,
      });
      expect(result).toEqual({
        kind: "OK",
        items: [{ eventId, summary: fixture.expected }],
      });
      expect(JSON.stringify(result)).not.toContain(canary);
      expect(JSON.stringify(result)).not.toMatch(
        /requestIdHash|identityHash|privateDiagnostic|safeMetadata|email/,
      );
    },
  );

  it.each([
    { oldRevision: null, newRevision: null },
    { oldRevision: "1", newRevision: 2 },
    { oldRevision: { private: canary }, newRevision: 2 },
    { oldRevision: 1, newRevision: [2] },
    { reasonCategory: null },
  ])(
    "does not turn malformed present fields into a valid legacy initial grant: %j",
    async (override) => {
      const { eventId } = await seedAudit({
        action: "ADMIN_ROLE_GRANTED",
        targetType: "ADMIN_PRINCIPAL",
        metadata: { role: "ADMIN_SUPPORT", ...override },
      });
      expect(
        await readB14AuditSummaries(db, {
          eventIds: [eventId],
          permissions: owner,
        }),
      ).toEqual({ kind: "OK", items: [] });
    },
  );

  it("keeps an explicit known category but never invents why from freeform reason", async () => {
    const legacy = await seedAudit(auditFixtures[1]!);
    const categorized = await seedAudit({
      ...auditFixtures[1]!,
      metadata: {
        ...auditFixtures[1]!.metadata,
        reasonCategory: "SUPPORT_REQUEST",
      },
    });
    const result = await readB14AuditSummaries(db, {
      eventIds: [categorized.eventId, legacy.eventId],
      permissions: owner,
    });
    expect(result).toEqual({
      kind: "OK",
      items: [
        {
          eventId: categorized.eventId,
          summary: {
            ...auditFixtures[1]!.expected,
            reasonCategory: "SUPPORT_REQUEST",
          },
        },
        { eventId: legacy.eventId, summary: auditFixtures[1]!.expected },
      ],
    });
  });

  it("rejects fractional audit revisions before the JSON driver can round them", async () => {
    const { eventId } = await seedAudit({
      action: "ADMIN_ROLE_REVOKED",
      targetType: "ADMIN_PRINCIPAL",
      metadata: { role: "ADMIN_SUPPORT", oldRevision: 1, newRevision: 2 },
    });
    await db.query(
      "UPDATE audit_events SET safe_metadata=jsonb_set(safe_metadata,'{newRevision}','2.0000000000000001'::jsonb) WHERE id=$1",
      [eventId],
    );
    expect(
      await readB14AuditSummaries(db, {
        eventIds: [eventId],
        permissions: owner,
      }),
    ).toEqual({ kind: "OK", items: [] });
  });

  it("requires audit and action-specific read permissions for the requested event IDs", async () => {
    const principal = await seedAudit(auditFixtures[1]!);
    const device = await seedAudit(auditFixtures[5]!);
    const eventIds = [principal.eventId, device.eventId];
    expect(
      await readB14AuditSummaries(db, {
        eventIds,
        permissions: permissionsForRole("ADMIN_BETA_OPERATOR"),
      }),
    ).toEqual({ kind: "FORBIDDEN" });
    expect(
      await readB14AuditSummaries(db, {
        eventIds,
        permissions: ["admin.audit.read", "device.read"],
      }),
    ).toEqual({
      kind: "OK",
      items: [{ eventId: device.eventId, summary: auditFixtures[5]!.expected }],
    });
  });

  it("rechecks the exact original envelope filter instead of widening to other targets", async () => {
    const requested = await seedAudit(auditFixtures[1]!);
    const other = await seedAudit(auditFixtures[1]!);
    const result = await readB14AuditSummaries(db, {
      eventIds: [other.eventId, requested.eventId],
      permissions: owner,
      filter: {
        action: "ADMIN_ROLE_GRANTED",
        targetType: "ADMIN_PRINCIPAL",
        targetId: requested.targetId!,
        correlationId: requested.correlationId,
      },
    });
    expect(result).toEqual({
      kind: "OK",
      items: [
        { eventId: requested.eventId, summary: auditFixtures[1]!.expected },
      ],
    });
  });
});
