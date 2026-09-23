import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
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
} from "./source-set.js";
import { WB_BUNDLE_DOCUMENT_KEY, WB_BUNDLE_VERSION } from "./wb-bundle.js";
import type { OperationInventory } from "./types.js";
import { InMemoryApiWatchStore } from "./authority.js";

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
