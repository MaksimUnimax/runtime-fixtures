import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../../../apps/api/src/app.js";
import {
  createDatabaseRuntime,
  createExtensionAuthRepository,
  createSyncRepository,
  type DatabaseRuntime,
} from "./index.js";
import { runMigrations } from "./migrations.js";
import { SyncService } from "../../sync/src/index.js";
import {
  ExtensionAuthService,
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
  type ExtensionPrincipal,
} from "../../extension-auth/src/index.js";
import type { AppConfig } from "../../../shared/src/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const config: AppConfig = {
  environment: "test",
  databaseUrl: connectionString,
  logLevel: "error",
  apiPort: 3000,
  workerReadyDelayMs: 0,
};

type Fixture = ExtensionPrincipal & { token: string };
type SyncResponseBody = {
  results?: Array<{ outcome: string; serverRevision: number }>;
  error?: { code: string };
  [key: string]: unknown;
};
type SyncResponse = { statusCode: number; json(): SyncResponseBody };
let runtime: DatabaseRuntime;
let auth: ExtensionAuthService;
let service: SyncService;
let app!: ReturnType<typeof createApiApp>;
let fixture: Fixture;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    kind: "BINDING_UPSERT" as const,
    conversationKeyDigest: "b".repeat(64),
    bindingId: "binding-1",
    bindingRevision: 1,
    storeId: "store-1",
    marketplace: "ozon" as const,
    credentialRevision: "credential-1",
    ...overrides,
  };
}

function entry(overrides: Record<string, unknown> = {}) {
  const requestId = randomUUID();
  return {
    requestId,
    mutationId: `mutation-${requestId}`,
    entityId: "a".repeat(64),
    baseRevision: 0,
    localSequence: 1,
    mutationGeneration: `generation-${requestId}`,
    kind: "BINDING_UPSERT" as const,
    payload: payload(),
    ...overrides,
  };
}

function body(entries: unknown[], installationId = fixture.deviceId) {
  return {
    syncVersion: "seller_agents_sync_v1" as const,
    installationId,
    entries,
  };
}

async function createFixture(): Promise<Fixture> {
  const userId = randomUUID();
  const accountId = randomUUID();
  const deviceId = randomUUID();
  const sessionId = randomUUID();
  await runtime.query("INSERT INTO users(id) VALUES($1)", [userId]);
  await runtime.query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
  await runtime.query(
    "INSERT INTO devices(id,account_id,created_by_user_id,browser_family) VALUES($1,$2,$3,'chrome')",
    [deviceId, accountId, userId],
  );
  await runtime.query(
    "INSERT INTO sessions(id,device_id,account_id,token_family_id) VALUES($1,$2,$3,$4)",
    [sessionId, deviceId, accountId, randomUUID()],
  );
  const issued = await auth.issue(sessionId);
  if (!issued.ok) throw new Error(issued.code);
  return { accountId, deviceId, sessionId, token: issued.value.accessToken };
}

async function post(
  input: unknown,
  token = fixture.token,
): Promise<SyncResponse> {
  return (await app.inject({
    method: "POST" as const,
    url: "/v1/sync",
    headers: { authorization: `Bearer ${token}` },
    payload: input as Record<string, unknown>,
  })) as unknown as SyncResponse;
}

describe.sequential("C3E real PostgreSQL sync acceptance", () => {
  beforeAll(async () => {
    runtime = createDatabaseRuntime(connectionString);
    await runtime.ready();
    await runMigrations({ connectionString });
    auth = new ExtensionAuthService(
      createExtensionAuthRepository(runtime),
      deriveExtensionAuthKeys(Buffer.alloc(32, 83)),
      undefined,
      createEphemeralAccessTokenSigningKey("c3e-sync-test"),
    );
    service = new SyncService(createSyncRepository(runtime));
    app = createApiApp({
      config,
      isInfrastructureReady: async () => true,
      extensionAuthService: auth,
      syncService: service,
    });
  });

  beforeEach(async () => {
    await runtime.query(
      "TRUNCATE sync_request_receipts, sync_entities RESTART IDENTITY",
    );
    fixture = await createFixture();
  });

  afterAll(async () => {
    if (app) await app.close();
    await runtime.close();
  });

  it("physically installs scoped constraints, indexes, and a compact-only schema", async () => {
    const columns = await runtime.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('sync_entities','sync_request_receipts') ORDER BY column_name",
    );
    expect(columns.rows.map((row) => row.column_name)).not.toEqual(
      expect.arrayContaining([
        "report",
        "token",
        "conversation",
        "raw_payload",
      ]),
    );
    const constraints = await runtime.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conrelid IN ('sync_entities'::regclass,'sync_request_receipts'::regclass)",
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual(
      expect.arrayContaining([
        "sync_entities_account_entity_unique",
        "sync_request_receipts_account_installation_request_unique",
        "sync_entities_state_bounded",
        "sync_request_receipts_state_bounded",
      ]),
    );
    const indexes = await runtime.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('sync_entities','sync_request_receipts')",
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "sync_entities_account_updated_index",
        "sync_request_receipts_account_entity_index",
      ]),
    );
  });

  it("authenticates, applies once, returns the same duplicate result, and rejects reuse", async () => {
    const item = entry();
    const first = await post(body([item]));
    expect(first.statusCode).toBe(200);
    const firstResult = first.json().results?.[0];
    expect(firstResult).toBeDefined();
    expect(firstResult).toMatchObject({
      outcome: "ACK",
      serverRevision: 1,
    });
    const duplicate = await post(body([item]));
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(first.json());
    const rows = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sync_entities WHERE account_id=$1",
      [fixture.accountId],
    );
    expect(rows.rows[0]?.count).toBe("1");
    const conflict = await post(
      body([
        {
          ...item,
          mutationId: "different-mutation",
          payload: payload({ bindingRevision: 2 }),
        },
      ]),
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error?.code).toBe("SYNC_REQUEST_ID_CONFLICT");
  });

  it("preserves stale-base state and returns mixed per-entity outcomes", async () => {
    const initial = entry();
    expect(
      (await service.apply(fixture, body([initial]))).results[0]?.outcome,
    ).toBe("ACK");
    const stale = entry({
      entityId: initial.entityId,
      baseRevision: 0,
      payload: payload({ bindingRevision: 9 }),
    });
    const independent = entry({ entityId: "c".repeat(64) });
    const response = await service.apply(fixture, body([stale, independent]));
    expect(response.results.map((row) => row.outcome)).toEqual([
      "CONFLICT",
      "ACK",
    ]);
    expect(response.results[0]?.serverRevision).toBe(1);
    const state = await runtime.query<{
      server_revision: number;
      state: Record<string, unknown>;
    }>(
      "SELECT server_revision,state FROM sync_entities WHERE account_id=$1 AND entity_id=$2",
      [fixture.accountId, initial.entityId],
    );
    expect(state.rows[0]).toMatchObject({
      server_revision: 1,
      state: initial.payload,
    });
  });

  it("serializes identical and same-entity concurrent mutations without global serialization", async () => {
    const same = entry();
    const identical = await Promise.all([
      service.apply(fixture, body([same])),
      service.apply(fixture, body([same])),
    ]);
    expect(identical.map((result) => result.results[0]?.outcome)).toEqual([
      "ACK",
      "ACK",
    ]);
    expect(identical[0]).toEqual(identical[1]);

    const nextA = entry({ entityId: "d".repeat(64) });
    const nextB = entry({
      entityId: "d".repeat(64),
      payload: payload({ bindingRevision: 2 }),
    });
    const sameEntity = await Promise.all([
      service.apply(fixture, body([nextA])),
      service.apply(fixture, body([nextB])),
    ]);
    expect(
      sameEntity.map((result) => result.results[0]?.outcome).sort(),
    ).toEqual(["ACK", "CONFLICT"]);

    const independentA = entry({ entityId: "e".repeat(64) });
    const independentB = entry({ entityId: "f".repeat(64) });
    const independent = await Promise.all([
      service.apply(fixture, body([independentA])),
      service.apply(fixture, body([independentB])),
    ]);
    expect(independent.map((result) => result.results[0]?.outcome)).toEqual([
      "ACK",
      "ACK",
    ]);
    expect(
      independent.map((result) => result.results[0]?.serverRevision),
    ).toEqual([1, 1]);
  });

  it("rolls back a failed transaction without leaving a receipt/state pair", async () => {
    const missing: ExtensionPrincipal = {
      accountId: randomUUID(),
      deviceId: randomUUID(),
      sessionId: randomUUID(),
    };
    await expect(
      service.apply(missing, body([entry()], missing.deviceId)),
    ).rejects.toBeInstanceOf(Error);
    const rows = await runtime.query<{ count: string }>(
      "SELECT (SELECT count(*) FROM sync_entities)::text || ':' || (SELECT count(*) FROM sync_request_receipts)::text AS count",
    );
    expect(rows.rows[0]?.count).toBe("0:0");
  });

  it("isolates accounts and fails closed for wrong installation, revoked access, and arbitrary input", async () => {
    const other = await createFixture();
    const item = entry();
    expect(
      (await service.apply(fixture, body([item]))).results[0]?.outcome,
    ).toBe("ACK");
    expect(
      (await service.apply(other, body([item], other.deviceId))).results[0]
        ?.outcome,
    ).toBe("ACK");
    const scoped = await runtime.query<{
      account_id: string;
      server_revision: number;
    }>(
      "SELECT account_id,server_revision FROM sync_entities WHERE entity_id=$1 ORDER BY account_id",
      [item.entityId],
    );
    expect(scoped.rows).toHaveLength(2);
    expect(new Set(scoped.rows.map((row) => row.account_id))).toEqual(
      new Set([fixture.accountId, other.accountId]),
    );
    expect((await post(body([entry()], randomUUID()))).statusCode).toBe(403);
    await runtime.query(
      "UPDATE devices SET status='REVOKED', revoked_at=now() WHERE id=$1",
      [fixture.deviceId],
    );
    expect((await post(body([entry()]))).statusCode).toBe(401);
    expect(
      (await post({ ...body([entry()]), arbitrary: "rejected" }, other.token))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(body(Array.from({ length: 33 }, () => entry())), other.token))
        .statusCode,
    ).toBe(400);
  });
});
