import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  createSwaggerHandoffService,
  InMemorySwaggerSourceStore,
} from "@product/monitoring-control";
import {
  createInMemoryApiWatchState,
  InMemoryApiWatchStore,
  evaluateOperatorCandidate,
} from "./authority.js";
import { productionSourceRegistry } from "./source-registry.js";
import {
  WB_BUNDLE_DOCUMENT_KEY,
  WB_BUNDLE_OFFICIAL_URL,
  WB_BUNDLE_VERSION,
  createWbBundle,
  promoteAcceptedWbBundle,
  validateWbBundle,
  validateWbBundleUpload,
} from "./wb-bundle.js";

function yamlFor(index: number): string {
  return `openapi: 3.0.3\ninfo:\n  title: WB ${index}\n  version: '1'\npaths:\n  /document-${index}:\n    get:\n      responses:\n        '200':\n          description: ok\n`;
}

function bundleBytes(): Uint8Array {
  const documents = productionSourceRegistry
    .get("WILDBERRIES")
    .documents!.map((document, index) => ({
      documentKey: document.documentKey,
      filename: document.officialUrl.split("/").pop()!.split("?")[0]!,
      content: yamlFor(index + 1),
    }));
  return new TextEncoder().encode(
    createWbBundle(documents, "2026-09-22T00:00:00.000Z"),
  );
}

async function bundleRequest(store: InMemorySwaggerSourceStore) {
  return store.createRequest({
    requestId: "WILDBERRIES:WB_OPENAPI_BUNDLE",
    sourceFamily: "WILDBERRIES",
    documentKey: WB_BUNDLE_DOCUMENT_KEY,
    bundleVersion: WB_BUNDLE_VERSION,
    officialUrl: WB_BUNDLE_OFFICIAL_URL,
    expectedArtifactType: "JSON",
    blockerReason: "WB official documents require operator access.",
  });
}

describe("WB single-file operator bundle", () => {
  it("BUNDLE-01..BUNDLE-04 performs one helper execution, thirteen fetches, and one download", async () => {
    const source = await readFile(
      new URL("../operator/wb-official-bundle-browser.js", import.meta.url),
      "utf8",
    );
    const downloads: Array<{ name: string; body: string }> = [];
    let fetchCount = 0;
    const context = {
      window: {} as Record<string, unknown>,
      location: { origin: "https://dev.wildberries.ru" },
      fetch: async () => {
        fetchCount += 1;
        return {
          status: 200,
          text: async () => "openapi: 3.0.3\npaths:\n  /x: {}\n",
        };
      },
      Blob: class {
        public constructor(public readonly parts: unknown[]) {}
      },
      URL: {
        createObjectURL: (blob: { parts: unknown[] }) => {
          const body = String(blob.parts[0]);
          return `blob:${body}`;
        },
        revokeObjectURL: () => undefined,
      },
      document: {
        body: { appendChild: () => undefined },
        createElement: () => ({
          click: () => undefined,
          remove: () => undefined,
          set href(value: string) {
            this._href = value;
          },
          set download(value: string) {
            this._download = value;
          },
          _href: "",
          _download: "",
        }),
      },
      console: { error: () => undefined, info: () => undefined },
    } as Record<string, unknown>;
    const anchor = (
      context.document as { createElement: () => Record<string, unknown> }
    ).createElement();
    anchor.click = () => {
      const body = String(anchor._href).slice("blob:".length);
      downloads.push({ name: String(anchor._download), body });
    };
    (
      context.document as { createElement: () => Record<string, unknown> }
    ).createElement = () => anchor;
    vm.runInNewContext(source, context);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchCount).toBe(13);
    expect(downloads).toHaveLength(1);
    const downloaded = JSON.parse(downloads[0]!.body) as {
      documents: unknown[];
    };
    expect(downloaded.documents).toHaveLength(13);
  });

  it("BUNDLE-05..BUNDLE-07 fails atomically and refuses a non-official origin without browser-state extraction", async () => {
    const source = await readFile(
      new URL("../operator/wb-official-bundle-browser.js", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /cookie|localStorage|sessionStorage|Patchright|webdriver/i,
    );
    expect(source).toContain("location.origin !== ORIGIN");
    expect(source).toContain("anchor.click()");
    expect(source).not.toMatch(/mirror/i);
    const failures: unknown[] = [];
    const context = {
      window: {},
      location: { origin: "https://example.invalid" },
      fetch: async () => {
        failures.push("fetch");
        return { status: 200, text: async () => "" };
      },
      console: { error: (...args: unknown[]) => failures.push(args) },
    };
    vm.runInNewContext(source, context);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(failures).toHaveLength(1);
  });

  it("BUNDLE-08..BUNDLE-10 creates one request and one JSON upload expands to thirteen independently checked documents", async () => {
    const store = new InMemorySwaggerSourceStore();
    const request = await bundleRequest(store);
    const root = await mkdtemp(join(tmpdir(), "s2-wb-bundle-"));
    try {
      const service = createSwaggerHandoffService({
        store,
        quarantineDir: root,
        validateUpload: validateWbBundleUpload,
      });
      const result = await service.upload({
        requestId: request.requestId,
        operatorId: "7",
        originalFilename: "wildberries-openapi-bundle-2026.json",
        bytes: bundleBytes(),
      });
      expect(result.kind).toBe("CANDIDATE_READY");
      expect(await store.listPending(new Date())).toHaveLength(0);
      expect(await store.listArtifacts(request.requestId)).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("BUNDLE-11..BUNDLE-14 rejects missing, extra, duplicate, and wrong-URL documents", () => {
    const base = JSON.parse(new TextDecoder().decode(bundleBytes())) as {
      documents: Array<Record<string, unknown>>;
    };
    const cases = [
      [
        "WB_BUNDLE_DOCUMENT_COUNT_INVALID",
        { documents: base.documents.slice(0, 12) },
      ],
      [
        "WB_BUNDLE_DOCUMENT_COUNT_INVALID",
        { documents: [...base.documents, base.documents[0]] },
      ],
      [
        "WB_BUNDLE_DUPLICATE_DOCUMENT_KEY",
        {
          documents: base.documents.map((document, index) =>
            index === 1
              ? { ...document, documentKey: base.documents[0]!.documentKey }
              : document,
          ),
        },
      ],
      [
        "WB_BUNDLE_OFFICIAL_URL_MISMATCH",
        {
          documents: base.documents.map((document, index) =>
            index === 0
              ? {
                  ...document,
                  officialUrl: "https://dev.wildberries.ru/wrong.yaml",
                }
              : document,
          ),
        },
      ],
    ] as const;
    for (const [code, change] of cases) {
      const candidate = { ...base, ...change };
      expect(() =>
        validateWbBundle(
          new TextEncoder().encode(JSON.stringify(candidate)),
          "bundle.json",
        ),
      ).toThrow(code);
    }
  });

  it("BUNDLE-15..BUNDLE-17 parses and hashes every YAML with a deterministic family manifest", () => {
    const bytes = bundleBytes();
    const first = validateWbBundle(bytes, "bundle.json");
    const reversed = {
      ...JSON.parse(new TextDecoder().decode(bytes)),
      documents: [...first.documents].reverse(),
    };
    const second = validateWbBundle(
      new TextEncoder().encode(JSON.stringify(reversed)),
      "bundle.json",
    );
    expect(first.documents).toHaveLength(13);
    expect(
      first.documents.every(
        (document) => document.sha256.length === 64 && document.pathCount > 0,
      ),
    ).toBe(true);
    expect(first.familyManifestSha256).toBe(second.familyManifestSha256);
  });

  it("BUNDLE-18..BUNDLE-21 makes no partial authority decision and starts thirteen A2/A3 snapshots only after 13/13 validation", async () => {
    const store = new InMemorySwaggerSourceStore();
    const request = await bundleRequest(store);
    const root = await mkdtemp(join(tmpdir(), "s2-wb-bundle-authority-"));
    const snapshotRoot = await mkdtemp(
      join(tmpdir(), "s2-wb-bundle-snapshots-"),
    );
    try {
      const service = createSwaggerHandoffService({
        store,
        quarantineDir: root,
        validateUpload: validateWbBundleUpload,
      });
      const bytes = bundleBytes();
      const uploaded = await service.upload({
        requestId: request.requestId,
        operatorId: "7",
        originalFilename: "wildberries-openapi-bundle.json",
        bytes,
      });
      if (uploaded.kind !== "CANDIDATE_READY")
        throw new Error("BUNDLE_FIXTURE_NOT_READY");
      const apiState = createInMemoryApiWatchState();
      const apiStore = new InMemoryApiWatchStore(apiState);
      const review = await evaluateOperatorCandidate({
        requestId: request.requestId,
        registry: productionSourceRegistry,
        pendingStore: store,
        store: apiStore,
        quarantineDir: root,
      });
      expect(review.kind).toBe("AUTHORITY_ACCEPTED");
      if (review.kind !== "AUTHORITY_ACCEPTED" || !review.records)
        throw new Error("BUNDLE_AUTHORITY_NOT_ACCEPTED");
      const duplicateOperationRoot = JSON.parse(
        new TextDecoder().decode(bytes),
      ) as { documents: Array<{ content: string }> };
      duplicateOperationRoot.documents[1]!.content =
        duplicateOperationRoot.documents[0]!.content;
      const duplicateOperationBundle = validateWbBundle(
        new TextEncoder().encode(JSON.stringify(duplicateOperationRoot)),
        "wildberries-openapi-bundle.json",
      );
      await expect(
        promoteAcceptedWbBundle({
          bundle: duplicateOperationBundle,
          records: review.records,
          store: apiStore,
          snapshotRoot,
        }),
      ).rejects.toThrow("WB_BUNDLE_AUTHORITY_PROVENANCE_MISMATCH");
      expect(await apiStore.listSnapshots()).toHaveLength(0);
      const downstream = await promoteAcceptedWbBundle({
        bundle: validateWbBundle(bytes, "wildberries-openapi-bundle.json"),
        records: review.records,
        store: apiStore,
        snapshotRoot,
        now: () => new Date("2026-09-22T00:00:00.000Z"),
      });
      expect(review.records).toHaveLength(13);
      expect(downstream.snapshots).toHaveLength(13);
      expect(downstream.inventories).toHaveLength(13);
      expect(downstream.familyInventory.operationCount).toBe(13);
      expect(
        downstream.inventories.every(
          (inventory) => inventory.operationCount === 1,
        ),
      ).toBe(true);
      expect(apiState.diffs.size).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(snapshotRoot, { recursive: true, force: true });
    }
  });

  it("BUNDLE-22..BUNDLE-25 has no mirror, bypass, or Stream-1 mutation path", async () => {
    const source = await readFile(
      new URL("./wb-bundle.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /mirror|Patchright|webdriver|child_process|eval\s*\(/i,
    );
    expect(source).not.toMatch(
      /executionAuthority|offlineGrace|bootstrapAuthority/,
    );
  });
});
