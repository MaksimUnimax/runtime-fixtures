import { resetTransferProtectedTestFixture } from "./helpers/credential-transfer-fixture-reset.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CommercialAccessService,
  CommercialPortalService,
} from "../../../packages/server/commercial-access/src/index.js";
import {
  deriveDeviceAuthKeys,
  deviceCodeArtifact,
  generateDeviceCode,
} from "../../../packages/server/device-auth/src/index.js";
import { DeviceManagementService } from "../../../packages/server/device-management/src/index.js";
import { createEphemeralAccessTokenSigningKey } from "../../../packages/server/extension-auth/src/index.js";
import {
  createP4EntitlementRepository,
  createP5CommercialPortalRepository,
  createP5SubscriptionAccessResolver,
  createP5SubscriptionRepository,
  createDatabaseRuntime,
  createDeviceManagementRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for real PostgreSQL tests");

let db: DatabaseRuntime;
const now = new Date("2026-09-07T12:00:00.000Z");
const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => db.query<T>(text, values);
const d = (value: string) => new Date(value);
const deviceRoot = Buffer.alloc(32, 56);
const deviceSigningKey = createEphemeralAccessTokenSigningKey("p56-device");

async function truncate() {
  await resetTransferProtectedTestFixture(
    db,
    "TRUNCATE billing_reconciliation_jobs,checkout_intents,billing_events,subscription_transitions,payments,devices,device_authorizations,sessions,account_entitlement_overrides,subscriptions,price_sale_assignments,price_revisions,plan_entitlements,prices,plan_revisions,entitlement_definitions,plans,account_memberships,accounts,users,audit_events CASCADE",
  );
}

async function fixture(
  options: {
    state?: string;
    end?: Date;
    graceUntil?: Date | null;
    cancelAtPeriodEnd?: boolean;
    accountStatus?: string;
    maxActive?: number;
    includeSubscription?: boolean;
    includePrice?: boolean;
  } = {},
) {
  const accountId = randomUUID();
  await q("INSERT INTO accounts(id,status) VALUES($1,$2)", [
    accountId,
    options.accountStatus ?? "ACTIVE",
  ]);
  const userId = randomUUID();
  await q("INSERT INTO users(id) VALUES($1)", [userId]);
  await q(
    "INSERT INTO account_memberships(id,account_id,user_id,role) VALUES($1,$2,$3,'OWNER')",
    [randomUUID(), accountId, userId],
  );
  const planId = randomUUID();
  const planRevisionId = randomUUID();
  await q("INSERT INTO plans(id,code,status) VALUES($1,$2,'ACTIVE')", [
    planId,
    `p56-${planId.replaceAll("-", "")}`,
  ]);
  await q(
    "INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description) VALUES($1,$2,1,'DRAFT','P5.6 Integration Plan','P5.6 integration plan')",
    [planRevisionId, planId],
  );
  await q(
    "INSERT INTO entitlement_definitions(entitlement_key,value_type,security_classification,description) VALUES('device.max_active','INTEGER','LIMIT','Device limit'),('feature.analytics','BOOLEAN','CAPABILITY','Analytics')",
  );
  await q(
    "INSERT INTO plan_entitlements(plan_revision_id,entitlement_key,integer_value) VALUES($1,'device.max_active',$2)",
    [planRevisionId, options.maxActive ?? 2],
  );
  await q(
    "INSERT INTO plan_entitlements(plan_revision_id,entitlement_key,boolean_value) VALUES($1,'feature.analytics',true)",
    [planRevisionId],
  );
  await q(
    "UPDATE plan_revisions SET state='PUBLISHED',published_at=$2 WHERE id=$1",
    [planRevisionId, d("2026-09-01T00:00:00.000Z")],
  );
  let priceRevisionId: string | null = null;
  if (options.includePrice !== false) {
    const priceId = randomUUID();
    priceRevisionId = randomUUID();
    await q(
      "INSERT INTO prices(id,plan_id,code,market_key,channel_key,status) VALUES($1,$2,$3,'global','direct','ACTIVE')",
      [priceId, planId, `price-${priceId.replaceAll("-", "")}`],
    );
    await q(
      "INSERT INTO price_revisions(id,price_id,plan_revision_id,revision,state,amount_minor,currency,billing_interval_unit,billing_interval_count,effective_from,published_at) VALUES($1,$2,$3,1,'PUBLISHED',9900,'EUR','MONTH',1,$4,$4)",
      [priceRevisionId, priceId, planRevisionId, d("2026-09-01T00:00:00.000Z")],
    );
  }
  let subscriptionId: string | null = null;
  if (options.includeSubscription !== false) {
    subscriptionId = randomUUID();
    const end = options.end ?? d("2026-10-01T00:00:00.000Z");
    await q(
      "INSERT INTO subscriptions(id,account_id,state,state_revision,current_plan_revision_id,bound_price_revision_id,started_at,current_period_start,current_period_end,grace_until,cancel_at_period_end,state_reason) VALUES($1,$2,$3,1,$4,$5,$6,$6,$7,$8,$9,'P5.6 integration')",
      [
        subscriptionId,
        accountId,
        options.state ?? "ACTIVE",
        planRevisionId,
        priceRevisionId,
        d("2026-09-01T00:00:00.000Z"),
        end,
        options.graceUntil ?? null,
        options.cancelAtPeriodEnd ?? false,
      ],
    );
  }
  const subscriptions = createP5SubscriptionRepository(db);
  const commercial = new CommercialAccessService({
    accessResolver: createP5SubscriptionAccessResolver(subscriptions),
    currentSubscriptionReader: subscriptions,
    entitlementResolver: createP4EntitlementRepository(db),
  });
  const portal = new CommercialPortalService(
    createP5CommercialPortalRepository(db),
    commercial,
    () => now,
  );
  return {
    accountId,
    userId,
    planRevisionId,
    priceRevisionId,
    subscriptionId,
    commercial,
    portal,
  };
}

async function approvedDevice(f: Awaited<ReturnType<typeof fixture>>) {
  const id = randomUUID();
  const deviceCode = generateDeviceCode(
    Buffer.from(id.replaceAll("-", "").slice(0, 32)),
  );
  await q(
    "INSERT INTO device_authorizations(id,device_code_hash,user_code_hash,status,requested_client_type,browser_family,browser_version,extension_version,device_label,approved_account_id,approved_user_id,expires_at,start_secret_ciphertext,start_secret_nonce,start_secret_auth_tag) VALUES($1,$2,$3,'APPROVED','browser_extension','chrome','123','2.5','P5.6 race device',$4,$5,$6,$7,$8,$9)",
    [
      id,
      deviceCodeArtifact(deriveDeviceAuthKeys(deviceRoot), deviceCode),
      `user-${id}`,
      f.accountId,
      f.userId,
      new Date(now.getTime() + 60_000),
      Buffer.from("envelope"),
      Buffer.alloc(12, 1),
      Buffer.alloc(16, 2),
    ],
  );
  return deviceCode;
}

function deviceService(f: Awaited<ReturnType<typeof fixture>>) {
  return new DeviceManagementService(
    createDeviceManagementRepository(db),
    deviceRoot,
    deviceSigningKey,
    {
      resolve: (accountId, at) =>
        f.commercial.resolveDeviceAdmission(accountId, at ?? now),
    },
    () => now,
  );
}

const accessCases = [
  ["none", undefined, "NO_CURRENT_SUBSCRIPTION", false],
  ["trial", "TRIAL", null, true],
  ["active", "ACTIVE", null, true],
  ["grace", "GRACE", null, true],
  ["past-due", "PAST_DUE", "PAST_DUE", false],
  ["suspended", "SUSPENDED", "SUBSCRIPTION_SUSPENDED", false],
  ["canceled-with-access", "CANCELED", null, true],
  ["canceled-ended", "CANCELED", "CANCELED", false],
  ["expired", "EXPIRED", "SUBSCRIPTION_EXPIRED", false],
  ["period-ended", "ACTIVE", "PERIOD_ENDED", false],
  ["grace-ended", "GRACE", "GRACE_ENDED", false],
  ["account-suspended", "ACTIVE", "ACCOUNT_SUSPENDED", false],
  ["trial-boundary", "TRIAL", "PERIOD_ENDED", false],
  ["active-boundary", "ACTIVE", "PERIOD_ENDED", false],
  ["grace-boundary", "GRACE", "GRACE_ENDED", false],
  ["canceled-boundary", "CANCELED", "CANCELED", false],
  ["trial-before", "TRIAL", null, true],
  ["active-before", "ACTIVE", null, true],
  ["grace-before", "GRACE", null, true],
  ["canceled-before", "CANCELED", null, true],
  ["past-due-future-end", "PAST_DUE", "PAST_DUE", false],
  ["suspended-future-end", "SUSPENDED", "SUBSCRIPTION_SUSPENDED", false],
  ["expired-future-end", "EXPIRED", "SUBSCRIPTION_EXPIRED", false],
  ["account-suspended-no-sub", undefined, "ACCOUNT_SUSPENDED", false],
] as const;

describe.sequential("P5.6 commercial production integration", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString!);
    await db.ready();
    await runMigrations({ connectionString: connectionString! });
    await runMigrations({ connectionString: connectionString! });
  });
  beforeEach(truncate);
  afterAll(async () => db.close());

  it.each(accessCases)(
    "access authority: %s",
    async (_name, state, expected, eligible) => {
      const boundary = String(_name).includes("boundary");
      const isGrace = state === "GRACE";
      const isCanceled = state === "CANCELED";
      const f = await fixture({
        includeSubscription:
          _name !== "none" && _name !== "account-suspended-no-sub",
        state,
        end: isGrace
          ? d("2026-09-06T00:00:00.000Z")
          : isCanceled
            ? boundary || _name === "canceled-ended"
              ? now
              : d("2026-10-01T00:00:00.000Z")
            : boundary || _name === "period-ended"
              ? now
              : d("2026-10-01T00:00:00.000Z"),
        graceUntil: isGrace
          ? _name === "grace-ended" || boundary
            ? now
            : d("2026-09-08T00:00:00.000Z")
          : null,
        cancelAtPeriodEnd: isCanceled,
      });
      if (_name === "account-suspended" || _name === "account-suspended-no-sub")
        await q("UPDATE accounts SET status='SUSPENDED' WHERE id=$1", [
          f.accountId,
        ]);
      const result = await f.commercial.resolve(f.accountId, now);
      expect(result.kind).toBe("OK");
      if (result.kind === "OK") {
        expect(result.value.access.kind === "ELIGIBLE").toBe(eligible);
        expect(
          result.value.access.kind === "INELIGIBLE"
            ? result.value.access.reason
            : null,
        ).toBe(expected);
      }
    },
  );

  const projectionCases = Array.from({ length: 24 }, (_, index) => index);
  it.each(projectionCases)("entitlement projection case %s", async (index) => {
    const f = await fixture({
      maxActive: index % 3,
      includePrice: index % 2 === 0,
    });
    if (index % 6 === 1)
      await q(
        "INSERT INTO account_entitlement_overrides(account_id,entitlement_key,revision,operation,integer_value,effective_from,reason) VALUES($1,'device.max_active',1,'SET',$2,$3,'integration override')",
        [f.accountId, index, d("2026-09-01T00:00:00.000Z")],
      );
    if (index % 6 === 2)
      await q(
        "INSERT INTO account_entitlement_overrides(account_id,entitlement_key,revision,operation,effective_from,reason) VALUES($1,'device.max_active',1,'CLEAR',$2,'integration clear')",
        [f.accountId, d("2026-09-01T00:00:00.000Z")],
      );
    const result = await f.commercial.resolve(f.accountId, now);
    expect(result.kind).toBe("OK");
    if (result.kind === "OK") {
      expect(result.value.planRevisionId).toBe(f.planRevisionId);
      expect(result.value.entitlements["feature.analytics"]).toBe(true);
      expect(result.value.entitlements["device.max_active"]).toBe(
        index % 6 === 1 ? index : index % 6 === 2 ? index % 3 : index % 3,
      );
    }
  });

  const deadlineCases = Array.from({ length: 24 }, (_, index) => index);
  it.each(deadlineCases)(
    "bootstrap deadline authority case %s",
    async (index) => {
      const end = new Date(now.getTime() + (index + 1) * 60_000);
      const f = await fixture({
        end,
        state:
          index % 4 === 0 ? "GRACE" : index % 4 === 1 ? "CANCELED" : "ACTIVE",
        graceUntil: index % 4 === 0 ? new Date(end.getTime() + 60_000) : null,
        cancelAtPeriodEnd: index % 4 === 1,
      });
      const result = await f.commercial.resolve(f.accountId, now);
      expect(result.kind).toBe("OK");
      if (result.kind === "OK") {
        expect(result.value.accessUntil?.getTime()).toBe(
          index % 4 === 0 ? end.getTime() + 60_000 : end.getTime(),
        );
        expect(result.value.access.kind).toBe("ELIGIBLE");
      }
    },
  );

  const portalCases = Array.from({ length: 24 }, (_, index) => index);
  it.each(portalCases)("portal safe read case %s", async (index) => {
    const f = await fixture({
      includePrice: index % 3 !== 0,
      maxActive: index % 4,
    });
    const result = await f.portal.readSubscription(f.userId, f.accountId);
    expect(result.kind).toBe("OK");
    if (result.kind === "OK") {
      expect(result.value.accountId).toBe(f.accountId);
      expect(result.value.subscription?.plan.planRevisionId).toBe(
        f.planRevisionId,
      );
      expect(result.value.deviceAllowance.maxActive).toBe(index % 4);
      expect(JSON.stringify(result.value)).not.toMatch(
        /provider|idempotency|event|reconciliation/i,
      );
    }
    const forbidden = await f.portal.readSubscription(
      randomUUID(),
      f.accountId,
    );
    expect(forbidden.kind).toBe("ACCOUNT_FORBIDDEN");
  });

  const deviceCases = Array.from({ length: 24 }, (_, index) => index);
  it.each(deviceCases)("device admission parity case %s", async (index) => {
    const state =
      index % 5 === 0
        ? "PAST_DUE"
        : index % 5 === 1
          ? "SUSPENDED"
          : index % 5 === 2
            ? "GRACE"
            : index % 5 === 3
              ? "CANCELED"
              : "ACTIVE";
    const f = await fixture({
      state,
      end: state === "GRACE" ? d("2026-09-06T00:00:00.000Z") : undefined,
      maxActive: index % 4,
      graceUntil: state === "GRACE" ? d("2026-09-08T00:00:00.000Z") : null,
      cancelAtPeriodEnd: state === "CANCELED",
    });
    const result = await f.commercial.resolveDeviceAdmission(f.accountId, now);
    if (state === "PAST_DUE" || state === "SUSPENDED")
      expect(result.kind).toBe("INELIGIBLE");
    else {
      expect(result.kind).toBe("ELIGIBLE");
      if (result.kind === "ELIGIBLE") {
        expect(result.maxActive).toBe(index % 4);
        expect(result.source).toBe("COMMERCIAL_PLAN_REVISION");
      }
    }
  });

  const integrityCases = Array.from({ length: 24 }, (_, index) => index);
  it.each(integrityCases)(
    "commercial integrity and privacy case %s",
    async (index) => {
      const f = await fixture({
        includeSubscription: index % 7 !== 0,
        includePrice: index % 2 === 0,
      });
      if (index % 6 === 0 && f.priceRevisionId)
        await q(
          "INSERT INTO payments(account_id,provider,provider_payment_id,price_revision_id,amount_minor,currency,state,idempotency_key_hash,request_fingerprint_sha256) VALUES($1,'fake.billing','hidden-provider',$2,9900,'EUR','SUCCEEDED',$3,$4)",
          [f.accountId, f.priceRevisionId, "a".repeat(64), "b".repeat(64)],
        );
      const payments = await f.portal.listPayments(f.userId, f.accountId, 50);
      expect(payments.kind).toBe("OK");
      if (payments.kind === "OK")
        expect(JSON.stringify(payments)).not.toMatch(
          /fake.billing|hidden-provider|aaaaaaaa|bbbbbbbb|event|job/i,
        );
      const invalid = await f.portal.listPayments(
        f.userId,
        f.accountId,
        50,
        randomUUID(),
      );
      expect(invalid.kind).toBe("INVALID_CURSOR");
    },
  );

  it("linearizes two concurrent activations at maxActive one", async () => {
    const f = await fixture({ maxActive: 1 });
    const first = await approvedDevice(f);
    const second = await approvedDevice(f);
    const service = deviceService(f);
    const results = await Promise.all([
      service.exchange(
        first,
        "p56-race-first-01",
        "198.51.100.1",
        randomUUID(),
      ),
      service.exchange(
        second,
        "p56-race-second-1",
        "198.51.100.2",
        randomUUID(),
      ),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(
      ["DEVICE_LIMIT_REACHED", "ACTIVATED"].sort(),
    );
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text AS count FROM devices WHERE account_id=$1 AND status='ACTIVE'",
          [f.accountId],
        )
      ).rows[0]?.count,
    ).toBe("1");
  });

  it("returns SUBSCRIPTION_REQUIRED for an approved device without subscription", async () => {
    const f = await fixture({ includeSubscription: false });
    const result = await deviceService(f).exchange(
      await approvedDevice(f),
      "p56-no-subscription",
      "198.51.100.3",
      randomUUID(),
    );
    expect(result.kind).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("returns SUBSCRIPTION_REQUIRED for PAST_DUE before lifecycle materialization", async () => {
    const f = await fixture({ state: "PAST_DUE" });
    const result = await deviceService(f).exchange(
      await approvedDevice(f),
      "p56-past-due-001",
      "198.51.100.4",
      randomUUID(),
    );
    expect(result.kind).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("denies at the exact subscription period end", async () => {
    const f = await fixture({ state: "ACTIVE", end: now });
    const result = await deviceService(f).exchange(
      await approvedDevice(f),
      "p56-period-end-01",
      "198.51.100.5",
      randomUUID(),
    );
    expect(result.kind).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("enforces a zero commercial device allowance", async () => {
    const f = await fixture({ maxActive: 0 });
    const result = await deviceService(f).exchange(
      await approvedDevice(f),
      "p56-zero-limit-01",
      "198.51.100.6",
      randomUUID(),
    );
    expect(result.kind).toBe("DEVICE_LIMIT_REACHED");
  });

  it("enforces an override limit before activation", async () => {
    const f = await fixture({ maxActive: 2 });
    await q(
      "INSERT INTO account_entitlement_overrides(account_id,entitlement_key,revision,operation,integer_value,effective_from,reason) VALUES($1,'device.max_active',1,'SET',0,$2,'p56 override')",
      [f.accountId, d("2026-09-01T00:00:00.000Z")],
    );
    const result = await deviceService(f).exchange(
      await approvedDevice(f),
      "p56-override-001",
      "198.51.100.7",
      randomUUID(),
    );
    expect(result.kind).toBe("DEVICE_LIMIT_REACHED");
  });

  it("serializes suspension before admission and leaves no device", async () => {
    const f = await fixture({ maxActive: 1 });
    await q(
      "UPDATE subscriptions SET state='SUSPENDED',state_revision=state_revision+1,suspended_at=$2,state_reason='p56 suspend' WHERE account_id=$1",
      [f.accountId, now],
    );
    const result = await deviceService(f).exchange(
      await approvedDevice(f),
      "p56-suspend-001x",
      "198.51.100.8",
      randomUUID(),
    );
    expect(result.kind).toBe("SUBSCRIPTION_REQUIRED");
    expect(
      (
        await q<{ count: string }>(
          "SELECT count(*)::text AS count FROM devices WHERE account_id=$1",
          [f.accountId],
        )
      ).rows[0]?.count,
    ).toBe("0");
  });

  it("does not auto-revoke an active device after a limit decrease", async () => {
    const f = await fixture({ maxActive: 1 });
    const result = await deviceService(f).exchange(
      await approvedDevice(f),
      "p56-no-revoke-01",
      "198.51.100.9",
      randomUUID(),
    );
    expect(result.kind).toBe("ACTIVATED");
    await q(
      "INSERT INTO account_entitlement_overrides(account_id,entitlement_key,revision,operation,integer_value,effective_from,reason) VALUES($1,'device.max_active',1,'SET',0,$2,'p56 lower')",
      [f.accountId, d("2026-09-01T00:00:00.000Z")],
    );
    expect(
      (
        await q<{ status: string }>(
          "SELECT status FROM devices WHERE account_id=$1",
          [f.accountId],
        )
      ).rows[0]?.status,
    ).toBe("ACTIVE");
    expect(
      (
        await deviceService(f).exchange(
          await approvedDevice(f),
          "p56-no-revoke-02",
          "198.51.100.10",
          randomUUID(),
        )
      ).kind,
    ).toBe("DEVICE_LIMIT_REACHED");
  });
});
