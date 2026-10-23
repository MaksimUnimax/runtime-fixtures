import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSwaggerHandoffService,
  InMemorySwaggerSourceStore,
} from "@product/monitoring-control";
import { acquireOfficialSource } from "./acquire.js";
import {
  createSourceRegistry,
  productionSourceRegistry,
} from "./source-registry.js";
import {
  canonicalFamilyManifest,
  combineWildberriesInventories,
  familyAuthorityStatus,
  runDocumentAuthorityPass,
  activateProductionSources,
} from "./source-set.js";
import { WB_BUNDLE_DOCUMENT_KEY, WB_BUNDLE_VERSION } from "./wb-bundle.js";
import { inventoryAcceptedSnapshots } from "./inventory.js";
import type {
  ApiWatchSqlQuery,
  ApiWatchSqlRuntime,
  OperationInventory,
  SnapshotMetadata,
} from "./types.js";
import {
  createInMemoryApiWatchState,
  createPostgresApiWatchStore,
  InMemoryApiWatchStore,
} from "./authority.js";

const validYaml = `openapi: 3.0.3\ninfo:\n  title: Wildberries\n  version: '1'\npaths:\n  /x:\n    get:\n      responses:\n        '200':\n          description: ok\n`;
const response = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "application/yaml" },
  });
const inventory = (
  key: string,
  identity = "WILDBERRIES:GET:/x",
): OperationInventory => ({
  sourceFamily: "WILDBERRIES",
  snapshotSha256: key,
  pathCount: 1,
  operationCount: 1,
  operationsByMethod: { GET: 1 },
  deprecatedCount: 0,
  operationIdPresentCount: 0,
  operationIdMissingCount: 1,
  operations: [
    {
      sourceFamily: "WILDBERRIES",
      documentKey: key,
      snapshotSha256: key,
      identity,
      method: "GET",
      path: "/x",
      operationId: null,
      tags: [],
      deprecated: false,
      summaryHash: null,
      securitySchemeReferences: [],
      requestBodyPresent: false,
      parameterCount: 0,
      responseStatusKeys: ["200"],
    },
  ],
});

describe("production source authority model", () => {
  it("SRC-01..SRC-05 define one Ozon document each and thirteen unique WB documents", () => {
    const entries = productionSourceRegistry.list();
    expect(
      entries.find((entry) => entry.sourceFamily === "OZON_SELLER")?.documents,
    ).toHaveLength(1);
    expect(
      entries.find((entry) => entry.sourceFamily === "OZON_PERFORMANCE")
        ?.documents,
    ).toHaveLength(1);
    const wb = entries.find(
      (entry) => entry.sourceFamily === "WILDBERRIES",
    )!.documents!;
    expect(wb).toHaveLength(13);
    expect(new Set(wb.map((document) => document.documentKey)).size).toBe(13);
    expect(new Set(wb.map((document) => document.officialUrl)).size).toBe(13);
  });
  it("C03 does not activate snapshots with unresolved local Path Item refs", async () => {
    const officialUrl = "https://docs.ozon.ru/api/seller/swagger.json";
    const registry = createSourceRegistry({
      OZON_SELLER: {
        officialUrl,
        documents: [
          {
            documentKey: "OZON_SELLER",
            officialUrl,
            expectedArtifactTypes: ["JSON"],
          },
        ],
        requiredServerIdentity: undefined,
        titlePattern: undefined,
      },
      OZON_PERFORMANCE: { officialUrl: null, documents: [] },
      WILDBERRIES: { officialUrl: null, documents: [] },
    });
    const store = new InMemoryApiWatchStore();
    const root = await mkdtemp(
      join(tmpdir(), "s2-c03-source-inventory-first-"),
    );
    try {
      await expect(
        activateProductionSources({
          registry,
          store,
          pendingStore: new InMemorySwaggerSourceStore(),
          snapshotRoot: root,
          fetcher: async () =>
            new Response(
              JSON.stringify({
                openapi: "3.1.0",
                info: { title: "invalid reference", version: "1" },
                paths: {
                  "/orders": { $ref: "#/components/pathItems/Missing" },
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          now: () => new Date("2026-10-19T00:00:00Z"),
        }),
      ).rejects.toThrow("APIWATCH_PATH_ITEM_REF_UNRESOLVED");
      expect(await store.listSnapshots()).toHaveLength(0);
      expect(await readdir(root)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("C03 rejects atomic inventory-write failure in source activation without accepted metadata", async () => {
    const officialUrl = "https://docs.ozon.ru/api/seller/swagger.json";
    const registry = createSourceRegistry({
      OZON_SELLER: {
        officialUrl,
        documents: [
          {
            documentKey: "OZON_SELLER",
            officialUrl,
            expectedArtifactTypes: ["JSON"],
          },
        ],
        requiredServerIdentity: undefined,
        titlePattern: undefined,
      },
      OZON_PERFORMANCE: { officialUrl: null, documents: [] },
      WILDBERRIES: { officialUrl: null, documents: [] },
    });
    const state = createInMemoryApiWatchState();
    const store = new InMemoryApiWatchStore(state);
    const saved = store.saveSnapshotWithInventory.bind(store);
    let fail = true;
    store.saveSnapshotWithInventory = async (metadata, operationInventory) => {
      if (fail) {
        fail = false;
        throw new Error("SIMULATED_ATOMIC_SNAPSHOT_INVENTORY_FAILURE");
      }
      return saved(metadata, operationInventory);
    };
    const root = await mkdtemp(join(tmpdir(), "s2-c03-atomic-source-"));
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "Seller API", version: "1" },
          paths: { "/orders": { get: { responses: { "200": {} } } } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    try {
      await expect(
        activateProductionSources({
          registry,
          store,
          pendingStore: new InMemorySwaggerSourceStore(),
          snapshotRoot: root,
          fetcher,
          now: () => new Date("2026-10-19T00:00:00Z"),
        }),
      ).rejects.toThrow("SIMULATED_ATOMIC_SNAPSHOT_INVENTORY_FAILURE");
      expect(await store.listSnapshots()).toHaveLength(0);
      expect(state.inventories.size).toBe(0);
      const retry = await activateProductionSources({
        registry,
        store,
        pendingStore: new InMemorySwaggerSourceStore(),
        snapshotRoot: root,
        fetcher,
        now: () => new Date("2026-10-19T00:01:00Z"),
      });
      expect(retry.inventories).toHaveLength(1);
      expect(await store.listSnapshots()).toHaveLength(1);
      expect(
        await store.findInventory(
          "OZON_SELLER",
          retry.inventories[0]!.snapshotSha256,
        ),
      ).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("C03 PostgreSQL adapter commits snapshot and inventory in one transaction", async () => {
    const sha256 = "a".repeat(64);
    const metadata: SnapshotMetadata = {
      snapshotId: `WILDBERRIES:${sha256}`,
      sourceFamily: "WILDBERRIES",
      sha256,
      sizeBytes: 1,
      specVersion: "3.0.3",
      officialUrl:
        "https://dev.wildberries.ru/api/swagger/yaml/ru/01-general.yaml",
      acquisitionMode: "AUTOMATIC",
      createdAt: new Date("2026-10-19T00:00:00Z"),
      authorityRecordId: "fixture-authority",
      artifactPath: "/synthetic/snapshot.yaml",
      documentKey: null,
    };
    const completed: string[][] = [];
    const rolledBack: string[][] = [];
    let fail = true;
    let scopeConflict = false;
    let directScopeConflict = false;
    const pairInventory: OperationInventory = {
      ...inventory(sha256),
      operations: inventory(sha256).operations.map((operation) => ({
        ...operation,
        documentKey: null,
      })),
    };
    const runtime: ApiWatchSqlRuntime = {
      async query() {
        throw new Error("OUTSIDE_TRANSACTION_QUERY_FORBIDDEN");
      },
      async transaction(operation) {
        const pending: string[] = [];
        const scoped: ApiWatchSqlQuery = {
          async query<
            T extends Record<string, unknown> = Record<string, unknown>,
          >(text: string): Promise<{ rows: T[] }> {
            if (text.startsWith("SELECT pg_advisory_xact_lock")) {
              pending.push("scope-lock");
              return { rows: [] };
            }
            if (text.includes("document_key IS DISTINCT FROM")) {
              pending.push("scope-check");
              return {
                rows: scopeConflict
                  ? ([{ snapshotId: "other-scope" }] as unknown as T[])
                  : [],
              };
            }
            if (text.startsWith('SELECT document_key AS "documentKey"')) {
              pending.push("cache-scope-read");
              return {
                rows: directScopeConflict
                  ? ([{ documentKey: null }] as unknown as T[])
                  : [],
              };
            }
            if (text.startsWith("SELECT")) return { rows: [] };
            if (text.startsWith("INSERT INTO api_watch_snapshots")) {
              pending.push("snapshot");
              return { rows: [metadata as unknown as T] };
            }
            if (text.startsWith("INSERT INTO api_watch_inventories")) {
              // Fake SQL query cannot parse PostgreSQL; assert precise
              // production UPSERT field assignment instead.
              if (
                !text.includes(
                  "operation_id_present_count=EXCLUDED.operation_id_present_count,operation_id_missing_count=EXCLUDED.operation_id_missing_count",
                ) ||
                text.includes(
                  "operation_id_present_count=EXCLUDED.operation_id_missing_count",
                )
              )
                throw new Error("MALFORMED_INVENTORY_UPSERT_SQL");
              pending.push("inventory");
              if (fail) throw new Error("SIMULATED_POSTGRES_INVENTORY_FAILURE");
              return { rows: [] };
            }
            throw new Error("UNEXPECTED_SQL_IN_TRANSACTION");
          },
        };
        try {
          const result = await operation(scoped);
          completed.push(pending);
          return result;
        } catch (error) {
          rolledBack.push(pending);
          throw error;
        }
      },
    };
    const store = createPostgresApiWatchStore(runtime);
    await expect(
      store.saveSnapshotWithInventory(metadata, pairInventory),
    ).rejects.toThrow("SIMULATED_POSTGRES_INVENTORY_FAILURE");
    expect(completed).toEqual([]);
    expect(rolledBack).toEqual([
      [
        "scope-lock",
        "scope-check",
        "snapshot",
        "scope-lock",
        "cache-scope-read",
        "inventory",
      ],
    ]);
    fail = false;
    const accepted = await store.saveSnapshotWithInventory(
      metadata,
      pairInventory,
    );
    expect(accepted.snapshotId).toBe(metadata.snapshotId);
    expect(completed).toEqual([
      [
        "scope-lock",
        "scope-check",
        "snapshot",
        "scope-lock",
        "cache-scope-read",
        "inventory",
      ],
    ]);
    scopeConflict = true;
    const differentScope = { ...metadata, documentKey: "WB_OTHER" };
    const differentInventory: OperationInventory = {
      ...pairInventory,
      operations: pairInventory.operations.map((operation) => ({
        ...operation,
        documentKey: "WB_OTHER",
      })),
    };
    await expect(
      store.saveSnapshotWithInventory(differentScope, differentInventory),
    ).rejects.toThrow("API_WATCH_INVENTORY_DOCUMENT_SCOPE_CONFLICT");
    expect(rolledBack.at(-1)).toEqual(["scope-lock", "scope-check"]);
    directScopeConflict = true;
    await expect(store.saveInventory(differentInventory)).rejects.toThrow(
      "API_WATCH_INVENTORY_DOCUMENT_SCOPE_CONFLICT",
    );
    expect(rolledBack.at(-1)).toEqual(["scope-lock", "cache-scope-read"]);
    expect(completed).toHaveLength(1);
  });

  it("C03 rejects same-family equal-digest snapshots under different document keys", async () => {
    const sha256 = "b".repeat(64);
    const store = new InMemoryApiWatchStore();
    const metadata = (documentKey: string): SnapshotMetadata => ({
      snapshotId: `WILDBERRIES:${documentKey}:${sha256}`,
      sourceFamily: "WILDBERRIES",
      sha256,
      sizeBytes: 1,
      specVersion: "3.0.3",
      officialUrl:
        "https://dev.wildberries.ru/api/swagger/yaml/ru/01-general.yaml",
      acquisitionMode: "AUTOMATIC",
      createdAt: new Date("2026-10-19T00:00:00Z"),
      authorityRecordId: "synthetic",
      artifactPath: "/synthetic/shared.yaml",
      documentKey,
    });
    const scopedInventory = (documentKey: string): OperationInventory => ({
      ...inventory(sha256),
      operations: inventory(sha256).operations.map((operation) => ({
        ...operation,
        documentKey,
      })),
    });
    await store.saveSnapshotWithInventory(
      metadata("WB_A"),
      scopedInventory("WB_A"),
    );
    await expect(
      store.saveSnapshotWithInventory(
        metadata("WB_B"),
        scopedInventory("WB_B"),
      ),
    ).rejects.toThrow("API_WATCH_INVENTORY_DOCUMENT_SCOPE_CONFLICT");
    await expect(
      store.saveSnapshotWithInventory(
        metadata("WB_A"),
        scopedInventory("WB_B"),
      ),
    ).rejects.toThrow("API_WATCH_SNAPSHOT_INVENTORY_IDENTITY_MISMATCH");
    expect(await store.listSnapshots()).toHaveLength(1);
    await expect(store.saveInventory(scopedInventory("WB_B"))).rejects.toThrow(
      "API_WATCH_INVENTORY_DOCUMENT_SCOPE_CONFLICT",
    );
    await store.saveInventory(scopedInventory("WB_A"));
    expect(
      (await store.findInventory("WILDBERRIES", sha256))?.operations[0]
        ?.documentKey,
    ).toBe("WB_A");
    // Same document, same bytes: idempotent repetition must remain possible.
    await store.saveSnapshotWithInventory(
      metadata("WB_A"),
      scopedInventory("WB_A"),
    );
    expect(await store.listSnapshots()).toHaveLength(1);
  });

  it("C03 rebuilds accepted WB inventory with its original documentKey", async () => {
    const root = await mkdtemp(join(tmpdir(), "s2-c03-scoped-rebuild-"));
    try {
      const bytes = Buffer.from(
        JSON.stringify({
          openapi: "3.1.0",
          info: { title: "WB source", version: "1" },
          paths: {
            "/orders": { get: { responses: { "200": { description: "ok" } } } },
          },
        }),
      );
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const artifactPath = join(root, "source.json");
      await writeFile(artifactPath, bytes);
      const store = new InMemoryApiWatchStore();
      const metadata: SnapshotMetadata = {
        snapshotId: `WILDBERRIES:${sha256}`,
        sourceFamily: "WILDBERRIES",
        documentKey: "WB_A",
        sha256,
        sizeBytes: bytes.byteLength,
        specVersion: "3.1.0",
        officialUrl:
          "https://dev.wildberries.ru/api/swagger/yaml/ru/01-general.yaml",
        acquisitionMode: "AUTOMATIC",
        createdAt: new Date("2026-10-19T00:00:00Z"),
        authorityRecordId: "synthetic",
        artifactPath,
      };
      await store.saveSnapshot(metadata);
      const rebuilt = await inventoryAcceptedSnapshots({ store });
      expect(rebuilt).toHaveLength(1);
      expect(rebuilt[0]?.operationCount).toBe(1);
      expect(rebuilt[0]?.operations[0]?.documentKey).toBe("WB_A");
      expect(
        (await store.findInventory("WILDBERRIES", sha256))?.operations[0]
          ?.documentKey,
      ).toBe("WB_A");
      await expect(
        store.saveInventory({
          ...rebuilt[0]!,
          operations: rebuilt[0]!.operations.map((operation) => ({
            ...operation,
            documentKey: "WB_B",
          })),
        }),
      ).rejects.toThrow("API_WATCH_INVENTORY_DOCUMENT_SCOPE_CONFLICT");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("SRC-06 and SRC-23 bind pending requests to documentKey", async () => {
    const registry = createSourceRegistry({
      WILDBERRIES: {
        documents: [
          {
            documentKey: "WB_01_GENERAL",
            officialUrl:
              "https://dev.wildberries.ru/api/swagger/yaml/ru/01-general.yaml?region=ru",
            expectedArtifactTypes: ["YAML"],
          },
        ],
      },
    });
    const store = new InMemorySwaggerSourceStore();
    await store.createRequest({
      requestId: "WILDBERRIES:WB_01_GENERAL",
      sourceFamily: "WILDBERRIES",
      documentKey: "WB_01_GENERAL",
      officialUrl:
        "https://dev.wildberries.ru/api/swagger/yaml/ru/01-general.yaml?region=ru",
      expectedArtifactType: "YAML",
      blockerReason: "historical per-document request",
    });
    const result = await runDocumentAuthorityPass({
      registry,
      store: new InMemoryApiWatchStore(),
      pendingStore: store,
      fetcher: async () => response("<html>challenge</html>", 498),
      now: () => new Date(0),
    });
    expect(result.documents[0]?.status).toBe("OPERATOR_SOURCE_REQUIRED");
    const pending = (await store.listPending(new Date(0))).filter(
      (request) => request.sourceFamily === "WILDBERRIES",
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.documentKey).toBe(WB_BUNDLE_DOCUMENT_KEY);
    expect(pending[0]?.bundleVersion).toBe(WB_BUNDLE_VERSION);
    expect((await store.getRequest("WILDBERRIES:WB_01_GENERAL"))?.status).toBe(
      "CANCELLED",
    );
  });
  it("SRC-06a creates an Ozon operator request for the bounded __rr access-control loop", async () => {
    const officialUrl = "https://docs.ozon.ru/api/seller/swagger.json";
    const registry = createSourceRegistry({
      OZON_SELLER: {
        officialUrl,
        documents: [
          {
            documentKey: "OZON_SELLER",
            officialUrl,
            expectedArtifactTypes: ["JSON"],
          },
        ],
      },
      OZON_PERFORMANCE: { officialUrl: null, documents: [] },
      WILDBERRIES: { officialUrl: null, documents: [] },
    });
    const pendingStore = new InMemorySwaggerSourceStore();
    const result = await runDocumentAuthorityPass({
      registry,
      store: new InMemoryApiWatchStore(),
      pendingStore,
      fetcher: async (value) => {
        const current = new URL(String(value));
        const rr = Number(current.searchParams.get("__rr") ?? 0);
        return new Response(null, {
          status: 307,
          headers: {
            location: `${current.origin}${current.pathname}?__rr=${rr + 1}`,
          },
        });
      },
      now: () => new Date(0),
    });
    expect(result.outcomes[0]?.kind).toBe("OPERATOR_SOURCE_REQUIRED");
    expect(result.records[0]?.authorityStatus).toBe("AUTHORITY_BLOCKED");
    const pending = await pendingStore.listPending(new Date(0));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sourceFamily).toBe("OZON_SELLER");
    expect(pending[0]?.officialUrl).toBe(officialUrl);
    expect(pending[0]?.documentKey).toBe("OZON_SELLER");
  });

  it("SRC-07..SRC-10 classify partial, complete, and blocked families", () => {
    const accepted = (key: string) => ({
      sourceFamily: "WILDBERRIES" as const,
      documentKey: key,
      officialUrl: "https://dev.wildberries.ru/x",
      status: "ACQUIRED" as const,
      sha256: "a",
      sizeBytes: 1,
      specVersion: "3.0.3",
      authorityStatus: "AUTHORITY_ACCEPTED" as const,
      blockerReason: null,
    });
    const blocked = {
      ...accepted("x"),
      status: "OPERATOR_SOURCE_REQUIRED" as const,
      authorityStatus: "AUTHORITY_BLOCKED" as const,
      sha256: null,
      sizeBytes: null,
      specVersion: null,
    };
    expect(familyAuthorityStatus([accepted("a")], ["a", "b"])).toBe(
      "AUTHORITY_PARTIAL",
    );
    expect(
      familyAuthorityStatus([accepted("a"), accepted("b")], ["a", "b"]),
    ).toBe("AUTHORITY_ACCEPTED");
    expect(
      familyAuthorityStatus(
        [
          accepted("a"),
          ...Array.from({ length: 11 }, (_, index) =>
            blockedWithKey(`b${index}`),
          ),
          blocked,
        ],
        ["a", ...Array.from({ length: 12 }, (_, index) => `b${index}`), "x"],
      ),
    ).toBe("AUTHORITY_PARTIAL");
    expect(familyAuthorityStatus([blocked], ["x"])).toBe("AUTHORITY_BLOCKED");
  });
  it("rejects substituted or empty required WB document sets", () => {
    const required = Array.from({ length: 13 }, (_, i) => `WB_DOC_${i + 1}`);
    const firstRequiredKey = required[0];
    if (firstRequiredKey === undefined)
      throw new Error("Missing synthetic required WB document key");
    const accepted = (documentKey: string) => ({
      sourceFamily: "WILDBERRIES" as const,
      documentKey,
      officialUrl: "https://dev.wildberries.ru/x",
      status: "ACQUIRED" as const,
      sha256: "a",
      sizeBytes: 1,
      specVersion: "3.0.3",
      authorityStatus: "AUTHORITY_ACCEPTED" as const,
      blockerReason: null,
    });
    const complete = required.map(accepted);
    expect(familyAuthorityStatus(complete, required)).toBe(
      "AUTHORITY_ACCEPTED",
    );
    // Every required key must be represented by exactly one accepted row.
    // A set of successful keys cannot hide duplicate or denied source rows.
    const blockedDuplicate = {
      ...accepted(firstRequiredKey),
      status: "OPERATOR_SOURCE_REQUIRED" as const,
      authorityStatus: "AUTHORITY_BLOCKED" as const,
      sha256: null,
      sizeBytes: null,
      specVersion: null,
      blockerReason: "synthetic denial on duplicate key",
    };
    expect(
      familyAuthorityStatus([...complete, blockedDuplicate], required),
    ).toBe("AUTHORITY_PARTIAL");
    expect(
      familyAuthorityStatus(
        [...complete, accepted(firstRequiredKey)],
        required,
      ),
    ).toBe("AUTHORITY_PARTIAL");
    expect(
      familyAuthorityStatus(
        [...complete, { ...blockedDuplicate, documentKey: "UNREGISTERED_DOC" }],
        required,
      ),
    ).toBe("AUTHORITY_PARTIAL");
    const substituted = complete.map((doc, index) =>
      index === 0 ? accepted("UNREGISTERED_DOC") : doc,
    );
    expect(familyAuthorityStatus(substituted, required)).toBe(
      "AUTHORITY_PARTIAL",
    );
    expect(
      familyAuthorityStatus([accepted("UNREGISTERED_DOC")], required),
    ).toBe("AUTHORITY_BLOCKED");
    expect(familyAuthorityStatus([], [])).toBe("AUTHORITY_BLOCKED");
    expect(
      familyAuthorityStatus(
        [...complete, accepted("UNREGISTERED_DOC")],
        required,
      ),
    ).toBe("AUTHORITY_PARTIAL");
  });

  it("SRC-11..SRC-14 create an order-independent manifest and fail duplicate operation identities", () => {
    const a = canonicalFamilyManifest({
      sourceFamily: "WILDBERRIES",
      documents: [
        { documentKey: "B", sha256: "b", sizeBytes: 2, specVersion: "3.0.3" },
        { documentKey: "A", sha256: "a", sizeBytes: 1, specVersion: "3.0.3" },
      ],
    });
    const b = canonicalFamilyManifest({
      sourceFamily: "WILDBERRIES",
      documents: [
        { documentKey: "A", sha256: "a", sizeBytes: 1, specVersion: "3.0.3" },
        { documentKey: "B", sha256: "b", sizeBytes: 2, specVersion: "3.0.3" },
      ],
    });
    expect(a.manifestSha256).toBe(b.manifestSha256);
    expect(a.manifestSha256).not.toContain("a\nb");
    expect(
      combineWildberriesInventories([inventory("A"), inventory("B")])
        .duplicateIdentities,
    ).toEqual(["WILDBERRIES:GET:/x"]);
  });
  it("SRC-15..SRC-16 never use mirrors and reject external redirects", async () => {
    const source = await readFile(
      new URL("./source-registry.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/mirror/i);
    const entry = createSourceRegistry({
      OZON_SELLER: {
        officialUrl: "https://docs.ozon.ru/api/seller/swagger.json",
      },
    }).get("OZON_SELLER");
    const result = await acquireOfficialSource({
      entry,
      fetcher: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://unrelated.invalid/spec.json" },
        }),
    });
    expect(result.kind).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
  });
  it("SRC-17..SRC-20 enforce Ozon server identity and title", async () => {
    const make = (family: "OZON_SELLER" | "OZON_PERFORMANCE") =>
      createSourceRegistry({
        [family]: { officialUrl: "https://docs.ozon.ru/spec.json" },
      }).get(family);
    const fetcher = (server: string, title: string) => async () =>
      new Response(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title, version: "1" },
          servers: [{ url: server }],
          paths: { "/x": { get: { responses: { "200": {} } } } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    expect(
      (
        await acquireOfficialSource({
          entry: make("OZON_SELLER"),
          fetcher: fetcher("https://api-seller.ozon.ru", "Seller API"),
        })
      ).kind,
    ).toBe("ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
    expect(
      (
        await acquireOfficialSource({
          entry: make("OZON_PERFORMANCE"),
          fetcher: fetcher(
            "https://api-performance.ozon.ru",
            "Performance API",
          ),
        })
      ).kind,
    ).toBe("ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
    expect(
      (
        await acquireOfficialSource({
          entry: make("OZON_SELLER"),
          fetcher: fetcher("https://wrong.invalid", "Seller API"),
        })
      ).kind,
    ).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
    expect(
      (
        await acquireOfficialSource({
          entry: make("OZON_PERFORMANCE"),
          fetcher: fetcher("https://api-performance.ozon.ru", "Seller API"),
        })
      ).kind,
    ).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
  });
  it("SRC-21..SRC-22 classify WB challenges as operator handoff", async () => {
    const entry = productionSourceRegistry.get("WILDBERRIES");
    for (const status of [498, 200]) {
      const result = await acquireOfficialSource({
        entry,
        document: entry.documents![0],
        fetcher: async () =>
          status === 498
            ? response("challenge", 498)
            : response("<html>captcha</html>"),
      });
      expect(result.kind).toBe("OPERATOR_SOURCE_REQUIRED");
    }
  });
  it("SRC-24..SRC-25 require the correct documentKey on upload", async () => {
    const store = new InMemorySwaggerSourceStore();
    const request = await store.createRequest({
      requestId: "wb-request",
      sourceFamily: "WILDBERRIES",
      documentKey: "WB_01_GENERAL",
      officialUrl:
        "https://dev.wildberries.ru/api/swagger/yaml/ru/01-general.yaml?region=ru",
      expectedArtifactType: "YAML",
      blockerReason: "challenge",
    });
    const service = createSwaggerHandoffService({
      store,
      quarantineDir: "/tmp/octoport-source-set-test",
    });
    const wrong = await service.upload({
      requestId: request.requestId,
      documentKey: "WB_02_ITEMS",
      operatorId: "1",
      originalFilename: "01-general.yaml",
      bytes: new TextEncoder().encode(validYaml),
    });
    const right = await service.upload({
      requestId: request.requestId,
      documentKey: "WB_01_GENERAL",
      operatorId: "1",
      originalFilename: "01-general.yaml",
      bytes: new TextEncoder().encode(validYaml),
    });
    expect(wrong).toMatchObject({
      kind: "REJECTED",
      code: "DOCUMENT_KEY_MISMATCH",
    });
    expect(right.kind).toBe("CANDIDATE_READY");
  });
  it("SRC-26..SRC-28 have no bypass, mirror, or marketplace credential path", async () => {
    const [acquire, sourceSet] = await Promise.all([
      readFile(new URL("./acquire.ts", import.meta.url), "utf8"),
      readFile(new URL("./source-set.ts", import.meta.url), "utf8"),
    ]);
    expect(`${acquire}\n${sourceSet}`).not.toMatch(
      /patchright|navigator\.webdriver|cookie|MARKETPLACE|TELEGRAM_BOT_TOKEN|mirror/i,
    );
  });
});

function blockedWithKey(documentKey: string) {
  return {
    sourceFamily: "WILDBERRIES" as const,
    documentKey,
    officialUrl: "https://dev.wildberries.ru/x",
    status: "OPERATOR_SOURCE_REQUIRED" as const,
    sha256: null,
    sizeBytes: null,
    specVersion: null,
    authorityStatus: "AUTHORITY_BLOCKED" as const,
    blockerReason: "challenge",
  };
}
