import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  decodeB14StoreCursor,
  encodeB14StoreCursor,
  projectB14StoreMetadata,
  type B14StoreMetadataInput,
} from "./b14-store-projection.js";

const accountId = "00000000-0000-4000-8000-0000000000a1";
const otherAccountId = "00000000-0000-4000-8000-0000000000a2";
const entityId = "store:store-1";
const time = "2026-10-29T12:34:56.789Z";
const invalid = { kind: "INVALID_STORE_METADATA" };
const row = (
  overrides: Record<string, unknown> = {},
): B14StoreMetadataInput => ({
  accountId,
  entityId,
  kind: "STORE_UPSERT",
  lifecycleState: "ACTIVE",
  storeId: "store-1",
  marketplace: "ozon",
  name: "Публичный магазин — 東京",
  providerAccountId: "provider-42",
  providerIdentityState: "CONFIRMED",
  metadataRevision: 4,
  serverRevision: 7,
  updatedAt: new Date(time),
  ...overrides,
});

function projected(overrides: Record<string, unknown> = {}) {
  const result = projectB14StoreMetadata(row(overrides), accountId);
  if (result.kind !== "OK") throw new Error("Expected valid projection");
  return result.value;
}

const encoded = (value: unknown) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

describe("B14 prepared scalar store projection, without API or DB wiring", () => {
  it("returns exactly the public allowlist without inventing verification", () => {
    expect(projected()).toEqual({
      storeId: "store-1",
      marketplace: "ozon",
      name: "Публичный магазин — 東京",
      providerAccountId: "provider-42",
      providerIdentityState: "CONFIRMED",
      metadataRevision: 4,
      serverRevision: 7,
      updatedAt: time,
    });
    expect(projected()).not.toHaveProperty("credentialPresence");
    expect(projected()).not.toHaveProperty("credentialsVerified");
    expect(projected()).not.toHaveProperty("marketplaceVerified");
  });

  it.each([
    "state",
    "rawState",
    "credentialRevision",
    "credentials",
    "conversationKeyDigest",
    "bindingId",
    "bindingRevision",
    "installationId",
    "receipt",
    "requestId",
    "payload",
  ])("rejects extra %s rather than leaking its synthetic canary", (field) => {
    const result = projectB14StoreMetadata(
      {
        ...row(),
        [field]: "SYNTHETIC_PRIVATE_CANARY_DO_NOT_PROJECT",
      },
      accountId,
    );
    expect(result).toEqual(invalid);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE_CANARY");
  });

  it("does not mutate input or its timestamp", () => {
    const source = Object.freeze(row());
    const stamp = source.updatedAt as Date;
    projectB14StoreMetadata(source, accountId);
    expect(source.name).toBe("Публичный магазин — 東京");
    expect(stamp.toISOString()).toBe(time);
  });

  it("checks account scope and matches entity_id to storeId", () => {
    expect(projectB14StoreMetadata(row(), otherAccountId)).toEqual(invalid);
    expect(
      projectB14StoreMetadata(row({ accountId: otherAccountId }), accountId),
    ).toEqual(invalid);
    expect(
      projectB14StoreMetadata(row({ entityId: "store:another" }), accountId),
    ).toEqual(invalid);
    expect(
      projectB14StoreMetadata(
        row({ entityId: `conversation:${"a".repeat(64)}` }),
        accountId,
      ),
    ).toEqual(invalid);
    expect(projectB14StoreMetadata(row(), "not-an-account")).toEqual(invalid);
    expect(
      projectB14StoreMetadata(
        row({ accountId: accountId.toUpperCase() }),
        accountId,
      ).kind,
    ).toBe("OK");
  });

  it.each([
    ["kind", "STORE_TOMBSTONE"],
    ["kind", "BINDING_UPSERT"],
    ["lifecycleState", "TOMBSTONED"],
    ["lifecycleState", "active"],
    ["marketplace", "amazon"],
    ["marketplace", null],
    ["storeId", ""],
    ["storeId", null],
    ["storeId", 42],
    ["name", ""],
    ["name", null],
    ["name", "x".repeat(81)],
    ["providerAccountId", { token: "SYNTHETIC_PROVIDER_CANARY" }],
    ["providerIdentityState", ["CONFIRMED"]],
  ])("fails closed for invalid %s", (field, value) => {
    expect(
      projectB14StoreMetadata(row({ [String(field)]: value }), accountId),
    ).toEqual(invalid);
  });

  it.each([null, [], "row", 1, true])("rejects a non-row value %j", (value) => {
    expect(projectB14StoreMetadata(value, accountId)).toEqual(invalid);
  });

  it("accepts both named marketplaces as metadata without claiming verification", () => {
    expect(projected({ marketplace: "wildberries" }).marketplace).toBe(
      "wildberries",
    );
  });

  it("respects the durable 128-character entity key including its prefix", () => {
    const maximum = "x".repeat(122);
    expect(
      projected({ storeId: maximum, entityId: `store:${maximum}` }).storeId,
    ).toBe(maximum);
    const tooLong = "x".repeat(123);
    expect(
      projectB14StoreMetadata(
        row({ storeId: tooLong, entityId: `store:${tooLong}` }),
        accountId,
      ),
    ).toEqual(invalid);
  });

  it.each([
    " store",
    "store ",
    "two stores",
    "x\u202ey",
    "x\u0085y",
    "x\ud800y",
  ])("rejects unsafe identity text without normalizing it: %j", (storeId) => {
    expect(
      projectB14StoreMetadata(
        row({ storeId, entityId: `store:${storeId}` }),
        accountId,
      ),
    ).toEqual(invalid);
  });

  it("keeps distinct Unicode IDs intact while normalizing only the public name", () => {
    const storeId = "cafe\u0301";
    expect(
      projected({
        storeId,
        entityId: `store:${storeId}`,
        name: "  Cafe\u0301  ",
      }),
    ).toMatchObject({ storeId, name: "Café" });
  });

  it.each([
    "\n",
    "\t",
    "\u0000",
    "\u007f",
    "\u0085",
    "\u200b",
    "\u202e",
    "\u2066",
    "\u2028",
    "\u2029",
    "\ud800",
  ])("withholds the whole public label containing %j", (control) => {
    expect(projected({ name: `Shop${control}name` }).name).toBeNull();
  });

  it.each([
    "  ",
    "API_KEY=SYNTHETIC_LABEL_CANARY",
    "client-secret: SYNTHETIC_LABEL_CANARY",
    "Bearer SYNTHETIC_LABEL_CANARY",
    "-----BEGIN PRIVATE KEY-----",
  ])("withholds obvious unsafe public labels %j", (name) => {
    expect(projected({ name }).name).toBeNull();
    expect(JSON.stringify(projected({ name }))).not.toContain(
      "SYNTHETIC_LABEL_CANARY",
    );
  });

  it("preserves normal public labels and does not claim arbitrary secret detection", () => {
    expect(projected({ name: "SYNTHETIC_PUBLIC_LABEL" }).name).toBe(
      "SYNTHETIC_PUBLIC_LABEL",
    );
    expect(projected({ name: "API key shop" }).name).toBe("API key shop");
    expect(projected({ name: "a".repeat(80) }).name).toHaveLength(80);
    // NFC can expand some combining characters; the output remains bounded.
    expect(projected({ name: "\u0344".repeat(80) }).name).toBeNull();
  });

  it.each([
    "secret_key=CANARY_B14",
    "private-key:CANARY_B14",
    '{"api_key":"CANARY_B14"}',
    "{'secret_key':'CANARY_B14'}",
    "ａｐｉ＿ｋｅｙ=CANARY_B14",
    "ｓｅｃｒｅｔ＿ｋｅｙ：CANARY_B14",
  ])("review regression: withholds recognizable credentials %j", (value) => {
    const result = projected({ name: value, providerAccountId: value });
    expect(result).toMatchObject({
      name: null,
      providerAccountId: null,
      providerIdentityState: "UNCONFIRMED",
    });
    expect(JSON.stringify(result)).not.toContain("CANARY_B14");
  });

  it.each([
    "provider/42",
    "provider=42",
    "поставщик-42",
    "ｐｒｏｖｉｄｅｒ-42",
  ])(
    "review regression: does not normalize an invalid confirmed provider ID %j",
    (providerAccountId) => {
      expect(projected({ providerAccountId })).toMatchObject({
        providerAccountId: null,
        providerIdentityState: "UNCONFIRMED",
      });
    },
  );

  it.each([
    null,
    "",
    " ",
    " provider-42",
    "provider 42",
    "provider-42\n",
    "x".repeat(129),
    "x\u202ey",
    42,
    false,
  ])(
    "does not retain CONFIRMED without a valid provider ID: %j",
    (providerAccountId) => {
      expect(projected({ providerAccountId })).toMatchObject({
        providerAccountId: null,
        providerIdentityState: "UNCONFIRMED",
      });
    },
  );

  it.each(["UNCONFIRMED", "confirmed", "FUTURE", "", null, false, 1])(
    "does not promote provider state %j",
    (providerIdentityState) => {
      expect(
        projected({
          providerIdentityState,
          providerAccountId: "SYNTHETIC_UNCONFIRMED_ID",
        }),
      ).toMatchObject({
        providerAccountId: null,
        providerIdentityState: "UNCONFIRMED",
      });
    },
  );

  it("accepts a bounded provider ID without coercing or authenticating it", () => {
    expect(
      projected({ providerAccountId: "p".repeat(128) }).providerAccountId,
    ).toHaveLength(128);
    expect(
      projected({ providerAccountId: "api_key=SYNTHETIC_PROVIDER_CANARY" }),
    ).toMatchObject({
      providerAccountId: null,
      providerIdentityState: "UNCONFIRMED",
    });
  });

  it.each([-1, 1.5, NaN, Infinity, "1", null, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe metadata revision %j",
    (metadataRevision) => {
      expect(
        projectB14StoreMetadata(row({ metadataRevision }), accountId),
      ).toEqual(invalid);
    },
  );
  it.each([0, -1, 1.5, NaN, Infinity, "1", 2_147_483_648])(
    "rejects an unaccepted or out-of-column-range server revision %j",
    (serverRevision) => {
      expect(
        projectB14StoreMetadata(row({ serverRevision }), accountId),
      ).toEqual(invalid);
    },
  );
  it("allows actual safe revision boundaries", () => {
    expect(projected({ metadataRevision: 0, serverRevision: 1 })).toMatchObject(
      { metadataRevision: 0, serverRevision: 1 },
    );
    expect(
      projected({
        metadataRevision: Number.MAX_SAFE_INTEGER,
        serverRevision: 2_147_483_647,
      }),
    ).toMatchObject({
      metadataRevision: Number.MAX_SAFE_INTEGER,
      serverRevision: 2_147_483_647,
    });
  });

  it.each([
    new Date(NaN),
    new Date(-1),
    new Date(253_402_300_800_000),
    "2026-02-30T12:00:00Z",
    "2026-10-29",
    "2026-10-29T12:34:56",
    "tomorrow",
    "2026-10-29T12:34:56Z\n",
    0,
    null,
    "1970-01-01T00:00:00+01:00",
  ])("rejects invalid or out-of-range update time %j", (updatedAt) => {
    expect(projectB14StoreMetadata(row({ updatedAt }), accountId)).toEqual(
      invalid,
    );
  });
  it("normalizes valid UTC/offset timestamps and bounds display years", () => {
    expect(
      projected({ updatedAt: "2026-10-29T15:34:56.789+03:00" }).updatedAt,
    ).toBe(time);
    expect(projected({ updatedAt: new Date(0) }).updatedAt).toBe(
      "1970-01-01T00:00:00.000Z",
    );
    expect(
      projected({ updatedAt: new Date(253_402_300_799_999) }).updatedAt,
    ).toBe("9999-12-31T23:59:59.999Z");
  });

  it.each([
    ["prototype-only Date", Object.create(Date.prototype) as unknown],
    ["proxied Date", new Proxy(new Date(time), {})],
  ])("review regression: rejects %s without throwing", (_name, updatedAt) => {
    expect(projectB14StoreMetadata(row({ updatedAt }), accountId)).toEqual(
      invalid,
    );
  });

  it("review regression: reads a native Date without calling an instance override", () => {
    const updatedAt = new Date(time);
    let calls = 0;
    updatedAt.getTime = () => {
      calls++;
      throw new Error("unsafe instance method must not run");
    };
    expect(projected({ updatedAt }).updatedAt).toBe(time);
    expect(calls).toBe(0);
  });

  it.each(["revoked proxy", "hostile prototype trap"])(
    "review regression: rejects a Date with %s without invoking unsafe object access",
    (variant) => {
      const revocable = Proxy.revocable(new Date(time), {});
      revocable.revoke();
      const updatedAt =
        variant === "revoked proxy"
          ? revocable.proxy
          : new Proxy(new Date(time), {
              getPrototypeOf() {
                throw new Error("unsafe prototype trap must not run");
              },
            });
      expect(projectB14StoreMetadata(row({ updatedAt }), accountId)).toEqual(
        invalid,
      );
    },
  );
});

describe("B14 account-bound opaque store cursor without repository authority", () => {
  it("round-trips only its exact version, account and entity fields", () => {
    const cursor = encodeB14StoreCursor(accountId, entityId);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor!.length).toBeLessThanOrEqual(1024);
    expect(decodeB14StoreCursor(cursor, accountId)).toEqual({
      v: 1,
      accountId,
      entityId,
    });
    expect(decodeB14StoreCursor(cursor, otherAccountId)).toBeNull();
    expect(decodeB14StoreCursor(cursor, "bad-account")).toBeNull();
    expect(encodeB14StoreCursor(accountId.toUpperCase(), entityId)).toBe(
      cursor,
    );
  });

  it("does not infer existence or ACTIVE membership from a valid cursor", () => {
    const cursor = encodeB14StoreCursor(accountId, "store:not-in-any-database");
    expect(decodeB14StoreCursor(cursor, accountId)).toEqual({
      v: 1,
      accountId,
      entityId: "store:not-in-any-database",
    });
  });

  it.each([null, undefined, 1, "", "a".repeat(1025), "=", "+/", "A", "AA"])(
    "rejects malformed or oversized cursor %j",
    (cursor) => {
      expect(decodeB14StoreCursor(cursor, accountId)).toBeNull();
    },
  );

  it("rejects padding, whitespace, BOM and corrupted UTF-8", () => {
    const cursor = encodeB14StoreCursor(accountId, entityId)!;
    for (const malformed of [
      cursor + "=",
      " " + cursor,
      cursor + "\n",
      cursor + "A",
    ])
      expect(decodeB14StoreCursor(malformed, accountId)).toBeNull();
    const invalidUtf8 = Buffer.concat([
      Buffer.from(`{"v":1,"accountId":"${accountId}","entityId":"store:`),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}'),
    ]).toString("base64url");
    expect(decodeB14StoreCursor(invalidUtf8, accountId)).toBeNull();
    const withBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify({ v: 1, accountId, entityId })),
    ]).toString("base64url");
    expect(decodeB14StoreCursor(withBom, accountId)).toBeNull();
  });

  it.each([
    { v: 2, accountId, entityId },
    { v: "1", accountId, entityId },
    { v: 1, accountId },
    { v: 1, accountId, entityId: "conversation:abc" },
    { v: 1, accountId, entityId: "store:" },
    { v: 1, accountId, entityId: "store:x\u202ey" },
    {
      v: 1,
      accountId,
      entityId,
      credentialRevision: "SYNTHETIC_CURSOR_CANARY",
    },
    null,
    [],
    { v: 1, accountId: "invalid", entityId },
  ])("rejects invalid cursor data %j", (value) => {
    expect(decodeB14StoreCursor(encoded(value), accountId)).toBeNull();
  });

  it("rejects duplicate keys and alternate JSON spellings", () => {
    const variants = [
      `{"v":1,"accountId":"${otherAccountId}","accountId":"${accountId}","entityId":"${entityId}"}`,
      `{"entityId":"${entityId}","accountId":"${accountId}","v":1}`,
      `{ "v":1,"accountId":"${accountId}","entityId":"${entityId}"}`,
      `{"v":1.0,"accountId":"${accountId}","entityId":"${entityId}"}`,
    ];
    for (const value of variants)
      expect(
        decodeB14StoreCursor(
          Buffer.from(value).toString("base64url"),
          accountId,
        ),
      ).toBeNull();
  });

  it("rejects noncanonical base64 trailing bits", () => {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const cursor = ["store:x", "store:xx", "store:xxx"]
      .map((entity) => encodeB14StoreCursor(accountId, entity)!)
      .find((value) => value.length % 4 !== 0)!;
    const last = alphabet.indexOf(cursor.at(-1)!);
    // Low unused bits are zero in canonical base64url. A decoder can ignore
    // them and produce the same bytes, so a decoding-only check is insufficient.
    const alternate = cursor.slice(0, -1) + alphabet[last | 1];
    expect(Buffer.from(alternate, "base64url")).toEqual(
      Buffer.from(cursor, "base64url"),
    );
    expect(decodeB14StoreCursor(cursor, accountId)).not.toBeNull();
    expect(decodeB14StoreCursor(alternate, accountId)).toBeNull();
  });

  it("encodes bounded Unicode IDs without including private metadata", () => {
    const entity = `store:${"店".repeat(122)}`;
    const cursor = encodeB14StoreCursor(accountId, entity);
    expect(cursor).not.toBeNull();
    expect(cursor!.length).toBeLessThanOrEqual(1024);
    expect(decodeB14StoreCursor(cursor, accountId)).toEqual({
      v: 1,
      accountId,
      entityId: entity,
    });
    expect(
      encodeB14StoreCursor(accountId, `store:${"店".repeat(123)}`),
    ).toBeNull();
    expect(encodeB14StoreCursor("bad-account", entityId)).toBeNull();
  });
});
