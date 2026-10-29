import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAccountParamsV1Schema } from "../../../packages/contracts/src/index";
import { loadOverrideAuthority, overrideValue } from "./b14-override-authority";
import { ControlPlaneError } from "./control-plane";

// The real browser control-plane client parses synthetic fetch responses. These
// tests establish bounded read/projection behavior, not PostgreSQL/RBAC or an
// installed admin session. The existing mutation endpoint remains the CAS owner.
const accountId = "aaaaaaaa-0000-4000-8000-000000000001";
const otherAccountId = "aaaaaaaa-0000-4000-8000-000000000002";
const entitlementKey = "b14.override_limit";
const historyPath = `/v1/admin/accounts/${accountId}/entitlement-overrides`;
const definitionPath = "/v1/admin/commercial/entitlements/definitions";
const path = `${historyPath}?limit=100&entitlementKey=${entitlementKey}`;
const id = (value: number) =>
  `bbbbbbbb-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const definition = (overrides: Record<string, unknown> = {}) => ({
  entitlementKey,
  valueType: "INTEGER",
  securityClassification: "LIMIT",
  description: "Synthetic test definition",
  deprecatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});
const row = (revision = 1, overrides: Record<string, unknown> = {}) => ({
  id: id(revision),
  accountId,
  entitlementKey,
  revision,
  operation: "SET",
  value: { kind: "INTEGER", value: 42 },
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

type Read = { url: URL; init: RequestInit | undefined };
type Reply = { status?: number; body?: unknown };

function fixtures(
  options: {
    definitions?: unknown;
    history?: unknown;
    respond?: (read: Read) => Reply | Promise<Reply>;
  } = {},
) {
  const reads: Read[] = [];
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const read = { url: new URL(String(input), "http://admin.test"), init };
      reads.push(read);
      const reply = options.respond
        ? await options.respond(read)
        : {
            body: read.url.pathname.endsWith(definitionPath)
              ? (options.definitions ?? { items: [definition()] })
              : (options.history ?? { items: [] }),
          };
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    });
  return {
    fetch,
    reads,
    historyReads: () =>
      reads.filter((read) =>
        read.url.pathname.endsWith("/entitlement-overrides"),
      ),
  };
}

function load(input = path, signal = new AbortController().signal) {
  return loadOverrideAuthority(input, { signal });
}

async function rejected(input = path) {
  await expect(load(input)).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
    status: 502,
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ADMIN_BASE_PATH", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("B14 complete exact-key override authority", () => {
  it.each([
    { name: "omitted cursor", body: { items: [] } },
    { name: "explicit null cursor", body: { items: [], nextCursor: null } },
  ])(
    "recognizes proven empty history with $name as null revision",
    async ({ body }) => {
      const mock = fixtures({ history: body });
      await expect(load()).resolves.toEqual({
        accountId,
        entitlementKey,
        latestRevision: null,
        valueType: "INTEGER",
        deprecated: false,
      });
      expect(mock.reads).toHaveLength(2);
      for (const read of mock.reads) {
        expect(read.init?.method).toBe("GET");
        expect(read.init?.cache).toBe("no-store");
        expect(read.init?.credentials).toBe("same-origin");
        expect(read.url.searchParams.get("entitlementKey")).toBe(
          entitlementKey,
        );
        expect(read.url.searchParams.get("limit")).toBe("100");
      }
    },
  );

  it("keeps all fields of the CAS projection explicit and excludes private or effective-value extras", async () => {
    const privateMarker = "INERT_B14_PRIVATE_EXTRA";
    fixtures({
      definitions: { items: [definition({ description: privateMarker })] },
      history: {
        items: [
          row(4, {
            reason: privateMarker,
            privateMetadata: privateMarker,
            value: { kind: "INTEGER", value: -777 },
          }),
        ],
        metadata: privateMarker,
      },
    });
    const result = await load();
    expect(result).toEqual({
      accountId,
      entitlementKey,
      latestRevision: 4,
      valueType: "INTEGER",
      deprecated: false,
    });
    expect(JSON.stringify(result)).not.toContain(privateMarker);
    expect(result).not.toHaveProperty("value");
  });

  it.each([
    { valueType: "BOOLEAN", securityClassification: "CAPABILITY" },
    { valueType: "INTEGER", securityClassification: "LIMIT" },
  ])(
    "reads accepted $valueType definitions without inferring type from existing values",
    async (type) => {
      fixtures({
        definitions: { items: [definition(type)] },
        history: { items: [row(3, { value: null, operation: "CLEAR" })] },
      });
      await expect(load()).resolves.toMatchObject({
        valueType: type.valueType,
        latestRevision: 3,
      });
    },
  );

  it("retains deprecated definition state so the caller can block set while permitting clear", async () => {
    fixtures({
      definitions: {
        items: [definition({ deprecatedAt: "2026-10-29T12:00:00.000Z" })],
      },
    });
    await expect(load()).resolves.toMatchObject({ deprecated: true });
  });

  it("accepts UUID case equivalence while keeping the exact selected entitlement key", async () => {
    fixtures({
      history: {
        items: [
          row(3, {
            accountId: accountId.toUpperCase(),
            id: id(3).toUpperCase(),
          }),
        ],
      },
    });
    await expect(load()).resolves.toMatchObject({ latestRevision: 3 });
  });

  it("finds maximum revision over every page without using creation time or effective-date ordering", async () => {
    const signal = new AbortController().signal;
    const mock = fixtures({
      respond: ({ url }) => {
        if (url.pathname.endsWith(definitionPath))
          return { body: { items: [definition()] } };
        const cursor = url.searchParams.get("cursor");
        if (!cursor)
          return {
            body: {
              items: [row(5, { createdAt: "2030-01-01T00:00:00.000Z" })],
              nextCursor: id(5),
            },
          };
        if (cursor === id(5))
          return {
            body: {
              items: [row(12, { effectiveFrom: "2035-01-01T00:00:00.000Z" })],
              nextCursor: id(12),
            },
          };
        return { body: { items: [row(7)], nextCursor: null } };
      },
    });
    await expect(load(path, signal)).resolves.toMatchObject({
      latestRevision: 12,
    });
    expect(
      mock.historyReads().map((read) => read.url.searchParams.get("cursor")),
    ).toEqual([null, id(5), id(12)]);
    for (const read of mock.reads) {
      expect(read.init?.signal).toBe(signal);
      expect(read.url.searchParams.get("entitlementKey")).toBe(entitlementKey);
      expect(read.url.searchParams.get("limit")).toBe("100");
    }
  });

  it("does not convert a bad later page into a successful partial revision", async () => {
    const mock = fixtures({
      respond: ({ url }) => ({
        body: url.pathname.endsWith(definitionPath)
          ? { items: [definition()] }
          : url.searchParams.has("cursor")
            ? { items: [row(6, { accountId: otherAccountId })] }
            : { items: [row(5)], nextCursor: id(5) },
      }),
    });
    await rejected();
    expect(mock.historyReads()).toHaveLength(2);
  });

  it.each([100, 101])(
    "bounds a history of %i pages and never reads page101",
    async (pageCount) => {
      let historyPage = 0;
      const mock = fixtures({
        respond: ({ url }) => {
          if (url.pathname.endsWith(definitionPath))
            return { body: { items: [definition()] } };
          historyPage += 1;
          return {
            body: {
              items: [row(historyPage)],
              ...(historyPage < pageCount
                ? { nextCursor: id(historyPage) }
                : {}),
            },
          };
        },
      });
      if (pageCount === 100)
        await expect(load()).resolves.toMatchObject({ latestRevision: 100 });
      else await rejected();
      expect(mock.historyReads()).toHaveLength(100);
    },
  );
});

describe("B14 unknown or mismatched authority fails closed", () => {
  it.each([
    { name: "null result", body: null },
    { name: "array result", body: [] },
    { name: "missing items", body: {} },
    { name: "nonarray items", body: { items: {} } },
    {
      name: "oversized page",
      body: {
        items: Array.from({ length: 101 }, (_, index) => row(index + 1)),
      },
    },
    { name: "invalid cursor type", body: { items: [], nextCursor: 4 } },
  ])("rejects a $name history page", async ({ body }) => {
    fixtures({
      respond: ({ url }) => ({
        body: url.pathname.endsWith(definitionPath)
          ? { items: [definition()] }
          : body,
      }),
    });
    await rejected();
  });

  it.each([
    { name: "no definition", body: { items: [] } },
    { name: "two definitions", body: { items: [definition(), definition()] } },
    {
      name: "continued definition page",
      body: { items: [definition()], nextCursor: entitlementKey },
    },
    {
      name: "wrong key",
      body: { items: [definition({ entitlementKey: "other.key" })] },
    },
    {
      name: "wrong key case",
      body: {
        items: [definition({ entitlementKey: entitlementKey.toUpperCase() })],
      },
    },
    {
      name: "wrong type",
      body: { items: [definition({ valueType: "STRING" })] },
    },
    {
      name: "wrong type classification",
      body: { items: [definition({ valueType: "BOOLEAN" })] },
    },
    {
      name: "missing deprecated state",
      body: { items: [definition({ deprecatedAt: undefined })] },
    },
    {
      name: "invalid deprecated timestamp",
      body: { items: [definition({ deprecatedAt: "not-a-date" })] },
    },
    {
      name: "wrong deprecated timestamp type",
      body: { items: [definition({ deprecatedAt: false })] },
    },
    { name: "null definition", body: { items: [null] } },
    { name: "array definition", body: { items: [[]] } },
  ])(
    "rejects $name before using history as write authority",
    async ({ body }) => {
      const mock = fixtures({
        definitions: body,
        history: { items: [row(3)], nextCursor: id(3) },
      });
      await rejected();
      expect(mock.historyReads()).toHaveLength(1);
    },
  );

  it.each([
    { name: "foreign account", value: row(3, { accountId: otherAccountId }) },
    { name: "missing account", value: row(3, { accountId: undefined }) },
    { name: "foreign key", value: row(3, { entitlementKey: "other.key" }) },
    { name: "missing key", value: row(3, { entitlementKey: undefined }) },
    { name: "invalid identity", value: row(3, { id: "invalid" }) },
    { name: "missing identity", value: row(3, { id: undefined }) },
    { name: "revision zero", value: row(0) },
    { name: "negative revision", value: row(3, { revision: -1 }) },
    { name: "fractional revision", value: row(3, { revision: 1.5 }) },
    { name: "string revision", value: row(3, { revision: "3" }) },
    { name: "missing revision", value: row(3, { revision: undefined }) },
    {
      name: "unsafe revision",
      value: row(3, { revision: Number.MAX_SAFE_INTEGER + 1 }),
    },
    { name: "null row", value: null },
    { name: "array row", value: [] },
  ])("rejects $name without null or a partial revision", async ({ value }) => {
    fixtures({ history: { items: [row(2), value] } });
    await rejected();
  });

  it.each([
    {
      name: "duplicate identity",
      body: { items: [row(3), row(4, { id: id(3) })] },
    },
    {
      name: "case-folded duplicate identity",
      body: { items: [row(3), row(4, { id: id(3).toUpperCase() })] },
    },
    { name: "empty continued page", body: { items: [], nextCursor: id(1) } },
    { name: "empty cursor", body: { items: [row(3)], nextCursor: "" } },
    { name: "invalid cursor", body: { items: [row(3)], nextCursor: "bad" } },
    {
      name: "cursor with query injection",
      body: {
        items: [row(3)],
        nextCursor: `${id(3)}&entitlementKey=other.key`,
      },
    },
    {
      name: "cursor not matching last item",
      body: { items: [row(3), row(4)], nextCursor: id(3) },
    },
  ])(
    "rejects $name before issuing a second history request",
    async ({ body }) => {
      const mock = fixtures({ history: body });
      await rejected();
      expect(mock.historyReads()).toHaveLength(1);
    },
  );

  it("stops a cursor cycle and duplicate record across pages instead of retrying", async () => {
    const mock = fixtures({ history: { items: [row(3)], nextCursor: id(3) } });
    await rejected();
    expect(mock.historyReads()).toHaveLength(2);
  });

  it.each([
    `/v1/admin/accounts/not-a-uuid/entitlement-overrides?limit=100&entitlementKey=${entitlementKey}`,
    `${historyPath}?limit=100`,
    `${historyPath}?limit=100&entitlementKey=`,
    `${historyPath}?limit=100&entitlementKey=invalid%2Fkey`,
    `${historyPath}?limit=50&entitlementKey=${entitlementKey}`,
    `${path}&cursor=${id(1)}`,
    `${path}&cursor=`,
    `/v1/admin/accounts/${accountId}/devices?limit=100&entitlementKey=${entitlementKey}`,
  ])(
    "does not fetch an unsuitable initial authority path %s",
    async (input) => {
      const mock = fixtures();
      await rejected(input);
      expect(mock.fetch).not.toHaveBeenCalled();
    },
  );
});

describe("B14 authority cancellation and failed reads", () => {
  it("does not start reads for an already aborted selection", async () => {
    const controller = new AbortController();
    controller.abort();
    const mock = fixtures();
    await expect(load(path, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mock.fetch).not.toHaveBeenCalled();
  });

  it("does not continue pagination after cancellation of the initial reads", async () => {
    const controller = new AbortController();
    const mock = fixtures({
      respond: ({ url }) => {
        if (url.pathname.endsWith(definitionPath))
          return { body: { items: [definition()] } };
        controller.abort();
        return { body: { items: [row(3)], nextCursor: id(3) } };
      },
    });
    await expect(load(path, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mock.historyReads()).toHaveLength(1);
    expect(
      mock.reads.every((read) => read.init?.signal === controller.signal),
    ).toBe(true);
  });

  it("does not continue pagination after cancellation while a later page resolves", async () => {
    const controller = new AbortController();
    const mock = fixtures({
      respond: ({ url }) => {
        if (url.pathname.endsWith(definitionPath))
          return { body: { items: [definition()] } };
        if (url.searchParams.has("cursor")) {
          controller.abort();
          return { body: { items: [row(4)], nextCursor: id(4) } };
        }
        return { body: { items: [row(3)], nextCursor: id(3) } };
      },
    });
    await expect(load(path, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mock.historyReads()).toHaveLength(2);
  });

  it.each([
    { code: "ADMIN_UNAUTHORIZED", status: 401, target: "definition" },
    { code: "ADMIN_FORBIDDEN", status: 403, target: "history" },
    { code: "SERVICE_UNAVAILABLE", status: 503, target: "history" },
    { code: "INVALID_CURSOR", status: 400, target: "later" },
  ])(
    "preserves $code from the $target read for the session/data owner",
    async ({ code, status, target }) => {
      const mock = fixtures({
        respond: ({ url }) => {
          const current = url.pathname.endsWith(definitionPath)
            ? "definition"
            : url.searchParams.has("cursor")
              ? "later"
              : "history";
          if (current === target)
            return {
              status,
              body: { error: { code, message: "Synthetic read failure" } },
            };
          return {
            body:
              current === "definition"
                ? { items: [definition()] }
                : { items: [row(3)], nextCursor: id(3) },
          };
        },
      });
      await expect(load()).rejects.toMatchObject({ code, status });
      expect(mock.historyReads()).toHaveLength(target === "later" ? 2 : 1);
    },
  );

  it("keeps a network failure as unavailable, never an empty history", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("INERT network detail"),
    );
    await expect(load()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
    });
  });

  it("retains the typed control-plane error class", async () => {
    fixtures({
      respond: () => ({
        status: 403,
        body: { error: { code: "ADMIN_FORBIDDEN" } },
      }),
    });
    await expect(load()).rejects.toBeInstanceOf(ControlPlaneError);
  });
});

describe("B14 explicit typed override values", () => {
  it.each([
    {
      type: "BOOLEAN" as const,
      input: "true",
      value: { kind: "BOOLEAN", value: true },
    },
    {
      type: "BOOLEAN" as const,
      input: "false",
      value: { kind: "BOOLEAN", value: false },
    },
    {
      type: "INTEGER" as const,
      input: "0",
      value: { kind: "INTEGER", value: 0 },
    },
    {
      type: "INTEGER" as const,
      input: "42",
      value: { kind: "INTEGER", value: 42 },
    },
    {
      type: "INTEGER" as const,
      input: "-42",
      value: { kind: "INTEGER", value: -42 },
    },
    {
      type: "INTEGER" as const,
      input: "9007199254740991",
      value: { kind: "INTEGER", value: Number.MAX_SAFE_INTEGER },
    },
    {
      type: "INTEGER" as const,
      input: "-9007199254740991",
      value: { kind: "INTEGER", value: Number.MIN_SAFE_INTEGER },
    },
  ])("accepts explicit $type $input", ({ type, input, value }) => {
    expect(overrideValue(type, input)).toEqual(value);
  });

  it.each([
    "",
    "TRUE",
    "FALSE",
    "0",
    "1",
    " true",
    "false ",
    "null",
    "undefined",
  ])("does not coerce BOOLEAN %j", (input) => {
    expect(overrideValue("BOOLEAN", input)).toBeUndefined();
  });

  it.each([
    "",
    " ",
    "1.5",
    "1e2",
    "0x10",
    "NaN",
    "Infinity",
    "+1",
    " 1",
    "1 ",
    "9007199254740992",
    "-9007199254740992",
    "1\n",
    "--1",
    "true",
  ])("does not coerce invalid INTEGER %j", (input) => {
    expect(overrideValue("INTEGER", input)).toBeUndefined();
  });

  it.each(["true", "false", "0", "42"])(
    "cannot construct %s without an authoritative definition",
    (input) => {
      expect(overrideValue(undefined, input)).toBeUndefined();
    },
  );
});

describe("B14 authority UUID spelling matches the current account wire schema", () => {
  const lowerMax = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const rejectedMax = [
    { name: "uppercase", value: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" },
    { name: "mixed-case", value: "Ffffffff-ffff-ffff-ffff-ffffffffffff" },
  ];

  for (const position of [
    "account path",
    "history row ID",
    "next cursor",
  ] as const) {
    it.each(rejectedMax)(
      `rejects $name MAX in ${position} without continuing reads`,
      async ({ value }) => {
        expect(
          AdminAccountParamsV1Schema.safeParse({ account_id: value }).success,
        ).toBe(false);
        const mock = fixtures({
          respond: ({ url }) => {
            if (url.pathname.endsWith(definitionPath))
              return { body: { items: [definition()] } };
            if (position === "history row ID")
              return { body: { items: [row(1, { id: value })] } };
            if (position === "next cursor")
              return {
                body: url.searchParams.has("cursor")
                  ? { items: [row(2)] }
                  : {
                      items: [row(1, { id: lowerMax })],
                      nextCursor: value,
                    },
              };
            return { body: { items: [] } };
          },
        });
        const input =
          position === "account path"
            ? `/v1/admin/accounts/${value}/entitlement-overrides?limit=100&entitlementKey=${entitlementKey}`
            : path;
        await rejected(input);
        if (position === "account path") {
          expect(mock.fetch).not.toHaveBeenCalled();
        } else {
          expect(mock.historyReads()).toHaveLength(1);
          expect(mock.reads).toHaveLength(2);
        }
      },
    );
  }

  it.each([
    {
      name: "uppercase UUID versions 1 through 8",
      values: Array.from(
        { length: 8 },
        (_, index) => `123E4567-E89B-${index + 1}2D3-A456-426614174000`,
      ),
    },
    { name: "nil UUID", values: ["00000000-0000-0000-0000-000000000000"] },
    { name: "lowercase MAX UUID", values: [lowerMax] },
  ])(
    "retains wire-accepted $name in account, history and continuation positions",
    async ({ values }) => {
      for (const value of values) {
        expect(
          AdminAccountParamsV1Schema.safeParse({ account_id: value }).success,
        ).toBe(true);
        const input = `/v1/admin/accounts/${value}/entitlement-overrides?limit=100&entitlementKey=${entitlementKey}`;
        const mock = fixtures({
          respond: ({ url }) => {
            if (url.pathname.endsWith(definitionPath))
              return { body: { items: [definition()] } };
            return {
              body: url.searchParams.has("cursor")
                ? { items: [row(9, { accountId: value })] }
                : {
                    items: [row(3, { id: value, accountId: value })],
                    nextCursor: value,
                  },
            };
          },
        });
        await expect(load(input)).resolves.toEqual({
          accountId: value,
          entitlementKey,
          latestRevision: 9,
          valueType: "INTEGER",
          deprecated: false,
        });
        expect(
          mock
            .historyReads()
            .map((read) => read.url.searchParams.get("cursor")),
        ).toEqual([null, value]);
        mock.fetch.mockRestore();
      }
    },
  );
});
