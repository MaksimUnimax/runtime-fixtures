import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApp } from "../../../../apps/api/src/app.js";
import {
  createDatabaseRuntime,
  createExtensionAuthRepository,
  createSyncRepository,
  createSyncSnapshotReader,
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
  results?: Array<{
    requestId: string;
    mutationId: string;
    entityId: string;
    outcome: string;
    serverRevision: number;
    serverState: Record<string, unknown> | null;
    code: string | null;
  }>;
  snapshots?: Array<{
    entityId: string;
    serverRevision: number;
    serverState: Record<string, unknown> | null;
  }>;
  error?: { code: string; message?: string };
  [key: string]: unknown;
};
type SyncResponse = { statusCode: number; json(): SyncResponseBody };
let runtime: DatabaseRuntime;
let auth: ExtensionAuthService;
let service: SyncService;
let reader: ReturnType<typeof createSyncSnapshotReader>;
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
  const entityId = (overrides.entityId as string | undefined) ?? "a".repeat(64);
  return {
    requestId,
    mutationId: `mutation-${requestId}`,
    entityId,
    baseRevision: 0,
    localSequence: 1,
    mutationGeneration: `generation-${requestId}`,
    kind: "BINDING_UPSERT" as const,
    payload: payload({
      conversationKeyDigest: createHash("sha256")
        .update(entityId)
        .digest("hex"),
    }),
    ...overrides,
  };
}

function body(
  entries: unknown[],
  installationId = fixture.deviceId,
  readEntityIds?: string[],
) {
  return {
    syncVersion: "seller_agents_sync_v1" as const,
    installationId,
    entries,
    ...(readEntityIds ? { readEntityIds } : {}),
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
    "INSERT INTO devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$2,$3,'chrome','1.0.0')",
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
    reader = createSyncSnapshotReader(runtime);
    service = new SyncService(createSyncRepository(runtime), reader);
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
      payload: payload({
        conversationKeyDigest: initial.payload.conversationKeyDigest,
        bindingRevision: 9,
      }),
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
      [
        fixture.accountId,
        `conversation:${initial.payload.conversationKeyDigest}`,
      ],
    );
    expect(state.rows[0]?.server_revision).toBe(1);
    expect(state.rows[0]?.state).toMatchObject({
      ...initial.payload,
      bindingState: "BOUND",
      reconciliation: {
        preferred: { state: "VALID_CURRENT", installationId: fixture.deviceId },
      },
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
      payload: payload({
        conversationKeyDigest: nextA.payload.conversationKeyDigest,
        bindingRevision: 2,
      }),
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

  it("B04 rejects a stale principal if device/session authority is revoked before the sync transaction", async () => {
    const authenticated = await auth.authenticateAccess(fixture.token);
    expect(authenticated.ok).toBe(true);
    if (!authenticated.ok) throw new Error(authenticated.code);

    await runtime.query(
      "UPDATE devices SET status='REVOKED',revoked_at=now() WHERE id=$1",
      [fixture.deviceId],
    );
    await runtime.query(
      "UPDATE sessions SET status='REVOKED',revoked_at=now(),revoke_reason='DEVICE_REVOKED' WHERE id=$1",
      [fixture.sessionId],
    );

    await expect(
      service.apply(authenticated.value, body([entry()])),
    ).rejects.toThrow("EXTENSION_AUTH_UNAUTHORIZED");
    expect(
      (
        await runtime.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM sync_entities WHERE account_id=$1",
          [fixture.accountId],
        )
      ).rows[0]?.count,
    ).toBe("0");
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
      [`conversation:${item.payload.conversationKeyDigest}`],
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

  it("stores legacy binding requests under the digest key while retaining the wire ID in response and receipt", async () => {
    const digest = "c".repeat(64);
    const wireId = randomUUID();
    const item = entry({
      entityId: wireId,
      payload: payload({ conversationKeyDigest: digest }),
    });
    const response = await post(body([item]));
    expect(response.statusCode).toBe(200);
    expect(response.json().results?.[0]?.entityId).toBe(wireId);
    const entities = await runtime.query<{ entity_id: string }>(
      "SELECT entity_id FROM sync_entities WHERE account_id=$1",
      [fixture.accountId],
    );
    const receipts = await runtime.query<{ entity_id: string }>(
      "SELECT entity_id FROM sync_request_receipts WHERE account_id=$1",
      [fixture.accountId],
    );
    expect(entities.rows.map((row) => row.entity_id)).toEqual([
      `conversation:${digest}`,
    ]);
    expect(receipts.rows.map((row) => row.entity_id)).toEqual([wireId]);
  });

  it("accepts the exact canonical binding wire entity ID", async () => {
    const digest = "d".repeat(64);
    const canonicalId = `conversation:${digest}`;
    const response = await post(
      body([
        entry({
          entityId: canonicalId,
          payload: payload({ conversationKeyDigest: digest }),
        }),
      ]),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().results?.[0]?.entityId).toBe(canonicalId);
    const rows = await runtime.query<{ entity_id: string }>(
      "SELECT entity_id FROM sync_entities WHERE account_id=$1",
      [fixture.accountId],
    );
    expect(rows.rows.map((row) => row.entity_id)).toEqual([canonicalId]);
  });

  it("rejects a prefixed noncanonical binding ID without writing state or receipt", async () => {
    const item = entry({
      entityId: `conversation:${"e".repeat(64)}`,
      payload: payload({ conversationKeyDigest: "f".repeat(64) }),
    });
    const response = await post(body([item]));
    expect(response.statusCode).toBe(409);
    expect(response.json().error?.code).toBe("SYNC_CONFLICT");
    expect(response.json().error?.message).toBe(
      "Binding entity identity mismatch",
    );
    const counts = await runtime.query<{ entities: string; receipts: string }>(
      "SELECT (SELECT count(*) FROM sync_entities WHERE account_id=$1)::text AS entities,(SELECT count(*) FROM sync_request_receipts WHERE account_id=$1)::text AS receipts",
      [fixture.accountId],
    );
    expect(counts.rows[0]).toEqual({ entities: "0", receipts: "0" });
  });

  it("uses one matching legacy physical row as current state and renames that row on ACK", async () => {
    const digest = "1".repeat(64);
    const legacyId = randomUUID();
    const initialState = payload({
      conversationKeyDigest: digest,
      bindingRevision: 3,
    });
    await runtime.query(
      "INSERT INTO sync_entities(account_id,entity_id,server_revision,state,installation_id) VALUES($1,$2,4,$3,$4)",
      [
        fixture.accountId,
        legacyId,
        JSON.stringify(initialState),
        fixture.deviceId,
      ],
    );
    const item = entry({
      entityId: randomUUID(),
      baseRevision: 4,
      payload: payload({ conversationKeyDigest: digest, bindingRevision: 4 }),
    });
    const response = await post(body([item]));
    expect(response.statusCode).toBe(200);
    expect(response.json().results?.[0]).toMatchObject({
      outcome: "ACK",
      serverRevision: 5,
      entityId: item.entityId,
    });
    const rows = await runtime.query<{
      entity_id: string;
      server_revision: number;
    }>(
      "SELECT entity_id,server_revision FROM sync_entities WHERE account_id=$1",
      [fixture.accountId],
    );
    expect(rows.rows).toEqual([
      { entity_id: `conversation:${digest}`, server_revision: 5 },
    ]);
  });

  it("fails closed when the canonical physical row carries another conversation digest", async () => {
    const digest = "7".repeat(64);
    const canonicalId = `conversation:${digest}`;
    await runtime.query(
      "INSERT INTO sync_entities(account_id,entity_id,server_revision,state,installation_id) VALUES($1,$2,3,$3,$4)",
      [
        fixture.accountId,
        canonicalId,
        JSON.stringify(
          payload({
            conversationKeyDigest: "8".repeat(64),
            bindingRevision: 3,
          }),
        ),
        fixture.deviceId,
      ],
    );
    const before = await runtime.query<{
      entity_id: string;
      server_revision: number;
      state: unknown;
    }>(
      "SELECT entity_id,server_revision,state FROM sync_entities WHERE account_id=$1",
      [fixture.accountId],
    );
    const response = await post(
      body([
        entry({
          entityId: canonicalId,
          baseRevision: 3,
          payload: payload({
            conversationKeyDigest: digest,
            bindingRevision: 4,
          }),
        }),
      ]),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().error?.code).toBe("SYNC_CONFLICT");
    expect(response.json().error?.message).toBe(
      "Binding entity state is ambiguous",
    );
    expect(
      (
        await runtime.query(
          "SELECT 1 FROM sync_request_receipts WHERE account_id=$1",
          [fixture.accountId],
        )
      ).rows,
    ).toHaveLength(0);
    const after = await runtime.query<{
      entity_id: string;
      server_revision: number;
      state: unknown;
    }>(
      "SELECT entity_id,server_revision,state FROM sync_entities WHERE account_id=$1",
      [fixture.accountId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("fails closed on duplicate physical binding rows without changing rows or writing a receipt", async () => {
    const digest = "2".repeat(64);
    const keys = [randomUUID(), randomUUID()];
    for (const [index, key] of keys.entries())
      await runtime.query(
        "INSERT INTO sync_entities(account_id,entity_id,server_revision,state,installation_id) VALUES($1,$2,$3,$4,$5)",
        [
          fixture.accountId,
          key,
          index + 2,
          JSON.stringify(
            payload({
              conversationKeyDigest: digest,
              bindingRevision: index + 1,
            }),
          ),
          fixture.deviceId,
        ],
      );
    const before = await runtime.query<{
      entity_id: string;
      server_revision: number;
      state: unknown;
    }>(
      "SELECT entity_id,server_revision,state FROM sync_entities WHERE account_id=$1 ORDER BY entity_id",
      [fixture.accountId],
    );
    const response = await post(
      body([entry({ payload: payload({ conversationKeyDigest: digest }) })]),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().error?.code).toBe("SYNC_CONFLICT");
    expect(response.json().error?.message).toBe(
      "Binding entity state is ambiguous",
    );
    const after = await runtime.query<{
      entity_id: string;
      server_revision: number;
      state: unknown;
    }>(
      "SELECT entity_id,server_revision,state FROM sync_entities WHERE account_id=$1 ORDER BY entity_id",
      [fixture.accountId],
    );
    expect(after.rows).toEqual(before.rows);
    expect(
      (
        await runtime.query(
          "SELECT 1 FROM sync_request_receipts WHERE account_id=$1",
          [fixture.accountId],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("keeps the same canonical digest isolated by account", async () => {
    const other = await createFixture();
    const digest = "3".repeat(64);
    for (const owner of [fixture, other]) {
      const response = await post(
        body(
          [
            entry({
              entityId: randomUUID(),
              payload: payload({ conversationKeyDigest: digest }),
            }),
          ],
          owner.deviceId,
        ),
        owner.token,
      );
      expect(response.statusCode).toBe(200);
    }
    const rows = await runtime.query<{ account_id: string; entity_id: string }>(
      "SELECT account_id,entity_id FROM sync_entities WHERE entity_id=$1 ORDER BY account_id",
      [`conversation:${digest}`],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.account_id)).toEqual(
      [fixture.accountId, other.accountId].sort(),
    );
  });

  it("replays an old legacy receipt after row rename without consulting physical state", async () => {
    const digest = "4".repeat(64);
    const legacyId = randomUUID();
    const item = entry({
      entityId: legacyId,
      payload: payload({ conversationKeyDigest: digest }),
    });
    const first = await post(body([item]));
    expect(first.statusCode).toBe(200);
    await runtime.query(
      "INSERT INTO sync_entities(account_id,entity_id,server_revision,state,installation_id) VALUES($1,$2,9,$3,$4)",
      [
        fixture.accountId,
        randomUUID(),
        JSON.stringify(
          payload({
            conversationKeyDigest: digest,
            bindingRevision: 9,
          }),
        ),
        fixture.deviceId,
      ],
    );
    const replay = await post(body([item]));
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(replay.json().results?.[0]?.entityId).toBe(legacyId);
    const changed = await post(
      body([
        {
          ...item,
          payload: payload({
            conversationKeyDigest: digest,
            bindingRevision: 9,
          }),
        },
      ]),
    );
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error?.code).toBe("SYNC_REQUEST_ID_CONFLICT");
    const rows = await runtime.query<{ entity_id: string }>(
      "SELECT entity_id FROM sync_entities WHERE account_id=$1 ORDER BY entity_id",
      [fixture.accountId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.entity_id)).toContain(
      `conversation:${digest}`,
    );
  });

  it("keeps FINISH dominant over a late marker sent under another wire identity", async () => {
    const digest = "5".repeat(64);
    const finish = entry({
      entityId: randomUUID(),
      kind: "FINISH",
      payload: payload({
        conversationKeyDigest: digest,
        kind: "FINISH",
        bindingRevision: 2,
      }),
    });
    expect((await post(body([finish]))).statusCode).toBe(200);
    const marker = entry({
      entityId: `conversation:${digest}`,
      baseRevision: 1,
      kind: "DELIVERY_MARKER",
      payload: payload({
        conversationKeyDigest: digest,
        kind: "DELIVERY_MARKER",
        bindingRevision: 2,
        deliveryMarkerId: "late-marker",
      }),
    });
    const response = await post(body([marker]));
    expect(response.statusCode).toBe(200);
    expect(response.json().results?.[0]?.code).toBe(
      "SERVER_FINISH_WINS_OVER_LATE_DELIVERY",
    );
    const rows = await runtime.query<{ entity_id: string }>(
      "SELECT entity_id FROM sync_entities WHERE account_id=$1",
      [fixture.accountId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.entity_id).toBe(`conversation:${digest}`);
  });

  it("keeps store metadata keyed by its existing entity ID", async () => {
    const storeId = "store:stable-id";
    const item = entry({
      entityId: storeId,
      kind: "STORE_UPSERT",
      payload: {
        ...payload({
          kind: "STORE_UPSERT",
          conversationKeyDigest: "6".repeat(64),
          bindingId: null,
        }),
        name: "Store",
        providerIdentityState: "UNCONFIRMED",
        metadataRevision: 1,
        lifecycleState: "ACTIVE",
      },
    });
    const response = await post(body([item]));
    expect(response.statusCode).toBe(200);
    const rows = await runtime.query<{ entity_id: string }>(
      "SELECT entity_id FROM sync_entities WHERE account_id=$1",
      [fixture.accountId],
    );
    expect(rows.rows.map((row) => row.entity_id)).toEqual([storeId]);
  });

  it("reads canonical snapshots in request order without receipts, state writes, or timestamp changes", async () => {
    const digest = "9".repeat(64);
    const conversationId = `conversation:${digest}`;
    const binding = entry({
      entityId: randomUUID(),
      payload: payload({
        conversationKeyDigest: digest,
        bindingId: "binding-read",
      }),
    });
    expect(
      (await service.apply(fixture, body([binding]))).results[0]?.outcome,
    ).toBe("ACK");

    const storeEntityId = "store:read-store";
    const storeEntry = entry({
      entityId: storeEntityId,
      kind: "STORE_UPSERT",
      payload: {
        ...payload({
          kind: "STORE_UPSERT",
          conversationKeyDigest: "a".repeat(64),
          bindingId: null,
          storeId: "read-store",
        }),
        name: "Read Store",
        providerIdentityState: "UNCONFIRMED",
        metadataRevision: 1,
        lifecycleState: "ACTIVE",
      },
    });
    expect(
      (await service.apply(fixture, body([storeEntry]))).results[0]?.outcome,
    ).toBe("ACK");

    const before = await runtime.query<{
      entity_id: string;
      server_revision: number;
      state: Record<string, unknown>;
      updated_at: string;
    }>(
      "SELECT entity_id,server_revision,state,updated_at::text AS updated_at FROM sync_entities WHERE account_id=$1 ORDER BY entity_id",
      [fixture.accountId],
    );
    const receiptsBefore = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sync_request_receipts WHERE account_id=$1",
      [fixture.accountId],
    );

    const missing = `conversation:${"0".repeat(64)}`;
    const snapshots = await reader.readSnapshots({
      principal: fixture,
      entityIds: [storeEntityId, missing, conversationId],
    });
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]).toMatchObject({
      entityId: storeEntityId,
      serverRevision: 1,
      serverState: { kind: "STORE_UPSERT", storeId: "read-store" },
    });
    expect(snapshots[1]).toEqual({
      entityId: missing,
      serverRevision: 0,
      serverState: null,
    });
    expect(snapshots[2]).toMatchObject({
      entityId: conversationId,
      serverRevision: 1,
      serverState: {
        kind: "BINDING_UPSERT",
        conversationKeyDigest: digest,
        bindingId: "binding-read",
      },
    });

    const after = await runtime.query<{
      entity_id: string;
      server_revision: number;
      state: Record<string, unknown>;
      updated_at: string;
    }>(
      "SELECT entity_id,server_revision,state,updated_at::text AS updated_at FROM sync_entities WHERE account_id=$1 ORDER BY entity_id",
      [fixture.accountId],
    );
    const receiptsAfter = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sync_request_receipts WHERE account_id=$1",
      [fixture.accountId],
    );
    expect(after.rows).toEqual(before.rows);
    expect(receiptsAfter.rows).toEqual(receiptsBefore.rows);

    const replay = await service.apply(fixture, body([binding]));
    expect(replay.results[0]).toMatchObject({
      outcome: "ACK",
      entityId: binding.entityId,
      serverRevision: 1,
    });
  });

  it("serves read-only snapshots over POST /v1/sync without creating receipts", async () => {
    const digest = "4".repeat(64);
    const conversationId = `conversation:${digest}`;
    const binding = entry({
      entityId: randomUUID(),
      payload: payload({
        conversationKeyDigest: digest,
        bindingId: "binding-http-read",
      }),
    });
    expect(
      (await service.apply(fixture, body([binding]))).results[0]?.outcome,
    ).toBe("ACK");
    const receiptsBefore = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sync_request_receipts WHERE account_id=$1",
      [fixture.accountId],
    );

    const missing = `conversation:${"5".repeat(64)}`;
    const response = await post(
      body([], fixture.deviceId, [missing, conversationId]),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([]);
    expect(response.json().snapshots).toEqual([
      { entityId: missing, serverRevision: 0, serverState: null },
      expect.objectContaining({
        entityId: conversationId,
        serverRevision: 1,
        serverState: expect.objectContaining({
          bindingId: "binding-http-read",
          conversationKeyDigest: digest,
        }),
      }),
    ]);
    const receiptsAfter = await runtime.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sync_request_receipts WHERE account_id=$1",
      [fixture.accountId],
    );
    expect(receiptsAfter.rows).toEqual(receiptsBefore.rows);
  });

  it("returns the post-mutation committed snapshot for a mixed HTTP sync request", async () => {
    const digest = "6".repeat(64);
    const conversationId = `conversation:${digest}`;
    const first = entry({
      entityId: randomUUID(),
      payload: payload({
        conversationKeyDigest: digest,
        bindingId: "binding-http-mixed",
        bindingRevision: 1,
      }),
    });
    expect(
      (await service.apply(fixture, body([first]))).results[0]?.outcome,
    ).toBe("ACK");

    const next = entry({
      entityId: randomUUID(),
      baseRevision: 1,
      payload: payload({
        conversationKeyDigest: digest,
        bindingId: "binding-http-mixed",
        bindingRevision: 2,
      }),
    });
    const response = await post(
      body([next], fixture.deviceId, [conversationId]),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().results?.[0]).toMatchObject({
      outcome: "ACK",
      serverRevision: 2,
    });
    expect(response.json().snapshots?.[0]).toMatchObject({
      entityId: conversationId,
      serverRevision: 2,
      serverState: {
        bindingId: "binding-http-mixed",
        bindingRevision: 2,
      },
    });
  });

  it("isolates snapshot reads by principal account even for the same canonical entity ID", async () => {
    const other = await createFixture();
    const digest = "a".repeat(64);
    const entityId = `conversation:${digest}`;
    const first = entry({
      entityId: randomUUID(),
      payload: payload({
        conversationKeyDigest: digest,
        bindingId: "binding-account-one",
      }),
    });
    const second = entry({
      entityId: randomUUID(),
      payload: payload({
        conversationKeyDigest: digest,
        bindingId: "binding-account-two",
      }),
    });
    expect(
      (await service.apply(fixture, body([first]))).results[0]?.outcome,
    ).toBe("ACK");
    expect(
      (await service.apply(other, body([second], other.deviceId))).results[0]
        ?.outcome,
    ).toBe("ACK");

    const own = await reader.readSnapshots({
      principal: fixture,
      entityIds: [entityId],
    });
    const theirs = await reader.readSnapshots({
      principal: other,
      entityIds: [entityId],
    });
    expect(own[0]?.serverState?.bindingId).toBe("binding-account-one");
    expect(theirs[0]?.serverState?.bindingId).toBe("binding-account-two");
  });

  it("re-checks session, device, account, and user authority inside every snapshot transaction", async () => {
    const entityId = `conversation:${"b".repeat(64)}`;
    const cases = [
      {
        update: "UPDATE sessions SET status='REVOKED' WHERE id=$1",
        id: (owner: Fixture) => owner.sessionId,
      },
      {
        update: "UPDATE devices SET status='REVOKED' WHERE id=$1",
        id: (owner: Fixture) => owner.deviceId,
      },
      {
        update: "UPDATE accounts SET status='SUSPENDED' WHERE id=$1",
        id: (owner: Fixture) => owner.accountId,
      },
      {
        update:
          "UPDATE users SET status='SUSPENDED' WHERE id=(SELECT created_by_user_id FROM devices WHERE id=$1)",
        id: (owner: Fixture) => owner.deviceId,
      },
    ] as const;

    for (const scenario of cases) {
      const owner = await createFixture();
      await runtime.query(scenario.update, [scenario.id(owner)]);
      await expect(
        reader.readSnapshots({ principal: owner, entityIds: [entityId] }),
      ).rejects.toThrow("EXTENSION_AUTH_UNAUTHORIZED");
    }
  });

  it("rejects noncanonical, duplicate, and oversized snapshot keys before reading state", async () => {
    const valid = Array.from(
      { length: 32 },
      (_, index) => `conversation:${index.toString(16).padStart(64, "0")}`,
    );
    expect(
      await reader.readSnapshots({ principal: fixture, entityIds: valid }),
    ).toEqual(
      valid.map((entityId) => ({
        entityId,
        serverRevision: 0,
        serverState: null,
      })),
    );

    const invalidSets = [
      [...valid, `conversation:${"f".repeat(64)}`],
      [valid[0]!, valid[0]!],
      [randomUUID()],
      [`conversation:${"A".repeat(64)}`],
      ["store:"],
      [`store:${"x".repeat(123)}`],
      ["store:bad\ncontrol"],
    ];
    for (const entityIds of invalidSets)
      await expect(
        reader.readSnapshots({ principal: fixture, entityIds }),
      ).rejects.toThrow("SYNC_SNAPSHOT_ENTITY_IDS_INVALID");
  });

  it("returns a coherent revision/state pair during a concurrent mutation and read", async () => {
    const digest = "c".repeat(64);
    const entityId = `conversation:${digest}`;
    const initial = entry({
      entityId: randomUUID(),
      payload: payload({
        conversationKeyDigest: digest,
        bindingId: "binding-concurrent",
        bindingRevision: 1,
      }),
    });
    expect(
      (await service.apply(fixture, body([initial]))).results[0]?.outcome,
    ).toBe("ACK");

    const next = entry({
      entityId: randomUUID(),
      baseRevision: 1,
      payload: payload({
        conversationKeyDigest: digest,
        bindingId: "binding-concurrent",
        bindingRevision: 2,
      }),
    });
    const [, snapshots] = await Promise.all([
      service.apply(fixture, body([next])),
      reader.readSnapshots({ principal: fixture, entityIds: [entityId] }),
    ]);
    const snapshot = snapshots[0];
    expect(
      snapshot?.serverRevision === 1 || snapshot?.serverRevision === 2,
    ).toBe(true);
    expect(snapshot?.serverState?.bindingRevision).toBe(
      snapshot?.serverRevision,
    );
  });
});
