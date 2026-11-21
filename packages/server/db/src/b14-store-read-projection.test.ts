import { describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { decodeB14StoreCursor, encodeB14StoreCursor } from "@product/admin-ops";
import type { DatabaseQuery } from "./index.js";
import { readB14StoreMetadataPage } from "./b14-store-read-projection.js";

// Real domain projection/cursor functions with an explicitly fake query
// transport. SQL text/bindings and row handling are covered here; PostgreSQL
// snapshot/index behavior and admin authorization require separate integration.
const accountId = "9d842f0a-7e39-4e20-8cb6-7b7aeeaa1111";
const otherAccountId = "9d842f0b-7e39-4e20-8cb6-7b7aeeaa2222";
const timestamp = "2026-10-29T10:15:00.000Z";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accountExists: true,
    cursorExists: true,
    accountId,
    entityId: "store:shop-a",
    kind: "STORE_UPSERT",
    lifecycleState: "ACTIVE",
    storeId: "shop-a",
    marketplace: "ozon",
    name: "Public store A",
    providerAccountId: "provider-42",
    providerIdentityState: "CONFIRMED",
    metadataRevision: "4",
    serverRevision: 7,
    updatedAt: new Date(timestamp),
    ...overrides,
  };
}

function emptyRow(
  flags: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    accountExists: true,
    cursorExists: true,
    accountId: null,
    entityId: null,
    kind: null,
    lifecycleState: null,
    storeId: null,
    marketplace: null,
    name: null,
    providerAccountId: null,
    providerIdentityState: null,
    metadataRevision: null,
    serverRevision: null,
    updatedAt: null,
    ...flags,
  };
}

function transport(rows: Record<string, unknown>[] = [row()]) {
  const execute = vi.fn(async (_text: string, _values?: unknown[]) => ({
    rows,
  }));
  const query: DatabaseQuery = {
    async query<T extends Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: T[] }> {
      const result = await execute(text, values);
      return { rows: result.rows as T[] };
    },
  };
  return { query, execute };
}

function sqlOf(db: ReturnType<typeof transport>): string {
  expect(db.execute).toHaveBeenCalledTimes(1);
  return db.execute.mock.calls[0]![0].replace(/\s+/gu, " ").trim();
}

describe("prepared B14 store page input boundary", () => {
  it.each([
    undefined,
    null,
    1,
    "",
    "not-a-uuid",
    accountId + "';DROP TABLE accounts;--",
    " " + accountId,
    {},
  ])("rejects invalid account %j without database access", async (value) => {
    const db = transport();
    await expect(
      readB14StoreMetadataPage(db.query, { accountId: value }),
    ).resolves.toEqual({ kind: "INVALID_ACCOUNT_ID" });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it.each([null, 0, -1, 101, 1.5, Infinity, NaN, "50", {}, 2 ** 53])(
    "rejects invalid page limit %j without database access",
    async (limit) => {
      const db = transport();
      await expect(
        readB14StoreMetadataPage(db.query, { accountId, limit }),
      ).resolves.toEqual({ kind: "INVALID_LIMIT" });
      expect(db.execute).not.toHaveBeenCalled();
    },
  );

  const wrongAccountCursor = encodeB14StoreCursor(
    otherAccountId,
    "store:shop-a",
  )!;
  const nonStoreCursor = Buffer.from(
    JSON.stringify({ v: 1, accountId, entityId: "conversation:abcd" }),
  ).toString("base64url");
  it.each([
    "",
    "not-a-canonical-cursor",
    "=",
    "x".repeat(1025),
    5,
    {},
    [],
    wrongAccountCursor,
    nonStoreCursor,
  ])("rejects invalid cursor %j without database access", async (cursor) => {
    const db = transport();
    await expect(
      readB14StoreMetadataPage(db.query, { accountId, cursor }),
    ).resolves.toEqual({ kind: "INVALID_CURSOR" });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it.each([undefined, null])(
    "accepts an absent cursor %j and canonicalizes the account",
    async (cursor) => {
      const db = transport([emptyRow()]);
      await expect(
        readB14StoreMetadataPage(db.query, {
          accountId: accountId.toUpperCase(),
          cursor,
        }),
      ).resolves.toEqual({ kind: "OK", items: [], nextCursor: null });
      expect(db.execute.mock.calls[0]![1]).toEqual([accountId, null, 51]);
    },
  );

  it.each([1, 100])("bounds lookahead for limit %i", async (limit) => {
    const db = transport([emptyRow()]);
    await readB14StoreMetadataPage(db.query, { accountId, limit });
    expect(db.execute.mock.calls[0]![1]).toEqual([accountId, null, limit + 1]);
  });
});

describe("prepared B14 store page query", () => {
  it("uses one read snapshot for account/cursor membership and keyset selection", async () => {
    const db = transport([emptyRow()]);
    const cursor = encodeB14StoreCursor(accountId, "store:shop-a")!;
    await readB14StoreMetadataPage(db.query, { accountId, cursor, limit: 2 });
    const sql = sqlOf(db);
    expect(db.execute.mock.calls[0]![1]).toEqual([
      accountId,
      "store:shop-a",
      3,
    ]);
    expect(sql).toContain("EXISTS(SELECT 1 FROM accounts WHERE id=$1::uuid)");
    expect(sql).toContain("cursor_entity.account_id=$1::uuid");
    expect(sql).toContain("cursor_entity.entity_id=$2::text");
    expect(sql).toContain("cursor_entity.state->>'kind'='STORE_UPSERT'");
    expect(sql).toContain("cursor_entity.state->>'lifecycleState'='ACTIVE'");
    expect(sql).toContain("entity.account_id=$1::uuid");
    expect(sql).toContain("entity.state->>'kind'='STORE_UPSERT'");
    expect(sql).toContain("entity.state->>'lifecycleState'='ACTIVE'");
    expect(sql).toContain(
      'WHERE guards."accountExists" AND guards."cursorExists"',
    );
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain("entity.entity_id>$2::text");
    expect(sql).toContain("ORDER BY entity.entity_id ASC LIMIT $3");
    expect(sql).not.toMatch(
      /\b(?:OFFSET|BEGIN|INSERT|UPDATE|DELETE|FOR UPDATE)\b/iu,
    );
  });

  it("never interpolates a valid but SQL-shaped cursor entity", async () => {
    const entityId = "store:a');DROP_TABLE;--";
    const cursor = encodeB14StoreCursor(accountId, entityId)!;
    expect(cursor).not.toBeNull();
    const db = transport([emptyRow()]);
    await readB14StoreMetadataPage(db.query, { accountId, cursor });
    const sql = sqlOf(db);
    expect(sql).not.toContain(accountId);
    expect(sql).not.toContain(entityId);
    expect(db.execute.mock.calls[0]![1]).toEqual([accountId, entityId, 51]);
  });

  it("selects only allowed scalar JSON paths and preserves exact revision text", async () => {
    const db = transport();
    await readB14StoreMetadataPage(db.query, { accountId });
    const sql = sqlOf(db);
    const paths = [...sql.matchAll(/state->>?'([^']+)'/gu)].map(
      (match) => match[1],
    );
    expect([...new Set(paths)].sort()).toEqual([
      "kind",
      "lifecycleState",
      "marketplace",
      "metadataRevision",
      "name",
      "providerAccountId",
      "providerIdentityState",
      "storeId",
    ]);
    expect(sql).toContain(
      "jsonb_typeof(entity.state->'metadataRevision')='number'",
    );
    expect(sql).toContain("THEN entity.state->>'metadataRevision'");
    for (const key of [
      "storeId",
      "marketplace",
      "name",
      "providerAccountId",
      "providerIdentityState",
    ]) {
      expect(sql).toContain(
        "jsonb_typeof(entity.state->'" + key + "')='string'",
      );
    }
    expect(sql).not.toMatch(/\bSELECT\s+(?:\w+\.)?\*/iu);
    expect(sql).not.toMatch(
      /\b(?:installation_id|credentialRevision|conversationKeyDigest|bindingId|server_state|sync_request_receipts)\b/u,
    );
    expect(sql).not.toMatch(/\bentity\.state\s*(?:,|AS|\bFROM\b)/iu);
  });

  it("uses the supplied query handle and propagates its failure without retry", async () => {
    const db = transport();
    const failure = new Error("SYNTHETIC_QUERY_FAILURE");
    db.execute.mockRejectedValueOnce(failure);
    await expect(
      readB14StoreMetadataPage(db.query, { accountId }),
    ).rejects.toBe(failure);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

describe("prepared B14 store page guards and pagination", () => {
  it("distinguishes an absent account from an existing empty account", async () => {
    const missing = transport([emptyRow({ accountExists: false })]);
    await expect(
      readB14StoreMetadataPage(missing.query, { accountId }),
    ).resolves.toEqual({ kind: "ACCOUNT_NOT_FOUND" });
    const empty = transport([emptyRow()]);
    await expect(
      readB14StoreMetadataPage(empty.query, { accountId }),
    ).resolves.toEqual({ kind: "OK", items: [], nextCursor: null });
  });

  it("rejects a well-formed cursor which is not a current active member", async () => {
    const db = transport([emptyRow({ cursorExists: false })]);
    const cursor = encodeB14StoreCursor(accountId, "store:shop-a")!;
    await expect(
      readB14StoreMetadataPage(db.query, { accountId, cursor }),
    ).resolves.toEqual({ kind: "INVALID_CURSOR" });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "missing guard row", rows: [] },
    {
      name: "nonboolean account flag",
      rows: [emptyRow({ accountExists: "false" })],
    },
    {
      name: "nonboolean cursor flag",
      rows: [emptyRow({ cursorExists: "true" })],
    },
    {
      name: "impossible first-page cursor failure",
      rows: [emptyRow({ cursorExists: false })],
    },
    {
      name: "partially populated empty row",
      rows: [emptyRow({ name: "not-an-empty-row" })],
    },
    {
      name: "inconsistent guard flags across rows",
      rows: [
        row(),
        row({
          cursorExists: false,
          storeId: "shop-b",
          entityId: "store:shop-b",
        }),
      ],
    },
  ])("fails closed for $name", async ({ rows }) => {
    const db = transport(rows);
    await expect(
      readB14StoreMetadataPage(db.query, { accountId }),
    ).resolves.toEqual({ kind: "INVALID_STORE_METADATA" });
  });

  it("rejects a result larger than the bounded query and rejects duplicates", async () => {
    const excessive = transport([row(), row(), row()]);
    await expect(
      readB14StoreMetadataPage(excessive.query, { accountId, limit: 1 }),
    ).resolves.toEqual({ kind: "INVALID_STORE_METADATA" });
    const duplicate = transport([row(), row()]);
    await expect(
      readB14StoreMetadataPage(duplicate.query, { accountId, limit: 2 }),
    ).resolves.toEqual({ kind: "INVALID_STORE_METADATA" });
  });

  it("encodes the last included entity rather than the lookahead", async () => {
    const db = transport([
      row(),
      row({ storeId: "shop-b", entityId: "store:shop-b" }),
      row({ storeId: "shop-c", entityId: "store:shop-c" }),
    ]);
    const result = await readB14StoreMetadataPage(db.query, {
      accountId,
      limit: 2,
    });
    expect(result.kind).toBe("OK");
    if (result.kind !== "OK") throw new Error("expected a projected page");
    expect(result.items.map((item) => item.storeId)).toEqual([
      "shop-a",
      "shop-b",
    ]);
    expect(decodeB14StoreCursor(result.nextCursor, accountId)).toEqual({
      v: 1,
      accountId,
      entityId: "store:shop-b",
    });
    expect(decodeB14StoreCursor(result.nextCursor, otherAccountId)).toBeNull();
  });

  it("does not offer another page when there is no lookahead", async () => {
    const db = transport([row()]);
    const result = await readB14StoreMetadataPage(db.query, {
      accountId,
      limit: 1,
    });
    expect(result).toMatchObject({ kind: "OK", nextCursor: null });
  });

  it("validates the entire selected page including a malformed lookahead", async () => {
    const db = transport([
      row(),
      row({ storeId: "shop-b", entityId: "store:shop-b", name: null }),
    ]);
    await expect(
      readB14StoreMetadataPage(db.query, { accountId, limit: 1 }),
    ).resolves.toEqual({ kind: "INVALID_STORE_METADATA" });
  });
});

describe("prepared B14 store page scalar projection", () => {
  it("uses the real allowlisted mapper without spreading accidental private columns", async () => {
    const source = row();
    for (const key of [
      "state",
      "credentialRevision",
      "conversationKeyDigest",
      "bindingId",
      "installation_id",
      "receipt",
    ]) {
      Object.defineProperty(source, key, {
        enumerable: true,
        get() {
          throw new Error("SYNTHETIC_PRIVATE_COLUMN_READ:" + key);
        },
      });
    }
    const db = transport([source]);
    await expect(
      readB14StoreMetadataPage(db.query, { accountId }),
    ).resolves.toEqual({
      kind: "OK",
      items: [
        {
          storeId: "shop-a",
          marketplace: "ozon",
          name: "Public store A",
          providerAccountId: "provider-42",
          providerIdentityState: "CONFIRMED",
          metadataRevision: 4,
          serverRevision: 7,
          updatedAt: timestamp,
        },
      ],
      nextCursor: null,
    });
  });

  it.each([
    ["0", 0],
    ["4.000", 4],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
    ["9007199254740991.000", Number.MAX_SAFE_INTEGER],
  ] as const)(
    "preserves exact integer metadata revision %s",
    async (value, expected) => {
      const db = transport([row({ metadataRevision: value })]);
      const result = await readB14StoreMetadataPage(db.query, { accountId });
      expect(result).toMatchObject({
        kind: "OK",
        items: [{ metadataRevision: expected }],
      });
    },
  );

  it.each([
    "1.0000000000000001",
    "9007199254740991.1",
    "9007199254740992",
    "-1",
    "0.5",
    "01",
    "1e3",
    "NaN",
    "Infinity",
    "1" + ".0".repeat(2048),
    4,
    null,
  ])(
    "rejects an inexact or noncanonical numeric transport value %j",
    async (value) => {
      const db = transport([row({ metadataRevision: value })]);
      await expect(
        readB14StoreMetadataPage(db.query, { accountId }),
      ).resolves.toEqual({ kind: "INVALID_STORE_METADATA" });
    },
  );

  it.each([
    { accountId: otherAccountId },
    { entityId: "store:another-store" },
    { kind: "BINDING_UPSERT" },
    { lifecycleState: "TOMBSTONED" },
    { marketplace: "unknown" },
    { name: { diagnostic: "SYNTHETIC_RAW_CANARY" } },
    { serverRevision: 0 },
    { serverRevision: "7" },
    { updatedAt: "not-a-timestamp" },
  ])(
    "fails the whole page instead of coercing malformed selected data %j",
    async (change) => {
      const db = transport([
        row(),
        row({ storeId: "shop-b", entityId: "store:shop-b", ...change }),
      ]);
      await expect(
        readB14StoreMetadataPage(db.query, { accountId }),
      ).resolves.toEqual({ kind: "INVALID_STORE_METADATA" });
    },
  );

  it("retains unknown identity semantics and withholds a recognizable credential label", async () => {
    const db = transport([
      row({
        name: '{"api_key":"SYNTHETIC_LABEL_CANARY"}',
        providerIdentityState: "CONFIRMED",
        providerAccountId: "Bearer SYNTHETIC_ID_CANARY",
      }),
    ]);
    const result = await readB14StoreMetadataPage(db.query, { accountId });
    expect(result).toMatchObject({
      kind: "OK",
      items: [
        {
          name: null,
          providerAccountId: null,
          providerIdentityState: "UNCONFIRMED",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("CANARY");
    expect(JSON.stringify(result)).not.toMatch(
      /credential|verification|installation/iu,
    );
  });

  it("does not infer confirmation from an ID when the identity state is unknown", async () => {
    const db = transport([row({ providerIdentityState: null })]);
    const result = await readB14StoreMetadataPage(db.query, { accountId });
    expect(result).toMatchObject({
      kind: "OK",
      items: [
        {
          providerAccountId: null,
          providerIdentityState: "UNCONFIRMED",
        },
      ],
    });
  });
});
