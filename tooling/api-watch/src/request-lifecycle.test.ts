import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSwaggerHandoffService,
  createInMemorySwaggerSourceState,
  InMemorySwaggerSourceStore,
} from "@product/monitoring-control";
import { InMemoryApiWatchStore } from "./authority.js";
import { InMemoryApiWatchReportStore } from "./report.js";
import { InMemoryApiWatchRetryStore } from "./retry.js";
import { runApiWatchReport } from "./run.js";
import { productionSourceRegistry } from "./source-registry.js";
import {
  createWbBundle,
  validateWbBundleUpload,
  WB_BUNDLE_DOCUMENT_KEY,
  WB_BUNDLE_OFFICIAL_URL,
  WB_BUNDLE_VERSION,
} from "./wb-bundle.js";

function validBundle(): Uint8Array {
  return new TextEncoder().encode(
    createWbBundle(
      productionSourceRegistry
        .get("WILDBERRIES")
        .documents!.map((document, index) => ({
          documentKey: document.documentKey,
          filename: document.officialUrl.split("/").pop()!.split("?")[0]!,
          content: `openapi: 3.0.3\ninfo:\n  title: WB ${index}\n  version: '1'\npaths:\n  /document-${index}:\n    get:\n      responses:\n        '200':\n          description: ok\n`,
        })),
      "2026-10-14T00:00:00.000Z",
    ),
  );
}

describe("review main1691 operator request lifecycle", () => {
  it.each(["CANDIDATE_READY", "CANCELLED", "EXPIRED"] as const)(
    "%s history cannot fail a later full report or silently reopen a request",
    async (terminal) => {
      const state = createInMemorySwaggerSourceState();
      const pendingStore = new InMemorySwaggerSourceStore(state);
      const now = new Date("2026-10-14T00:00:00Z");
      const dependencies = {
        registry: productionSourceRegistry,
        store: new InMemoryApiWatchStore(),
        reportStore: new InMemoryApiWatchReportStore(),
        retryStore: new InMemoryApiWatchRetryStore(),
        pendingStore,
        clock: () => now,
        fetcher: (async () =>
          new Response("synthetic403", { status: 403 })) as typeof fetch,
      };
      let index = 0;
      const pass = () =>
        runApiWatchReport({
          runId: "request-lifecycle-" + index++,
          source: "FORCED",
          dependencies,
        });
      expect((await pass()).status).toBe("NOT_OBSERVABLE");
      const first = (await pendingStore.listPending(now)).find(
        (request) => request.documentKey === WB_BUNDLE_DOCUMENT_KEY,
      )!;
      expect(first).toBeDefined();
      expect((await pass()).status).toBe("NOT_OBSERVABLE");
      expect(
        (await pendingStore.listPending(now))
          .filter((request) => request.documentKey === WB_BUNDLE_DOCUMENT_KEY)
          .map((request) => request.requestId),
      ).toEqual([first.requestId]);
      const root = await mkdtemp(
        join(tmpdir(), "octoport-review-request-lifecycle-"),
      );
      try {
        if (terminal === "CANDIDATE_READY") {
          const service = createSwaggerHandoffService({
            store: pendingStore,
            quarantineDir: root,
            validateUpload: validateWbBundleUpload,
          });
          const uploaded = await service.upload({
            requestId: first.requestId,
            operatorId: "synthetic-operator",
            originalFilename: "wildberries-openapi-bundle.json",
            bytes: validBundle(),
            receivedAt: now,
          });
          expect(uploaded.kind).toBe("CANDIDATE_READY");
          expect(
            await pendingStore.listArtifacts(first.requestId),
          ).toHaveLength(1);
        } else {
          await pendingStore.setRequestStatus(first.requestId, terminal);
        }
        expect((await pass()).status).toBe("NOT_OBSERVABLE");
        expect((await pass()).status).toBe("NOT_OBSERVABLE");
        expect((await pendingStore.getRequest(first.requestId))?.status).toBe(
          terminal,
        );
        expect(
          [...state.requests.values()].filter(
            (request) => request.documentKey === WB_BUNDLE_DOCUMENT_KEY,
          ),
        ).toHaveLength(1);
        expect(
          (await pendingStore.listPending(now)).filter(
            (request) => request.documentKey === WB_BUNDLE_DOCUMENT_KEY,
          ),
        ).toHaveLength(0);
        // Only an explicit new request creates a new generation. History stays intact.
        const explicit = await pendingStore.createRequest({
          sourceFamily: "WILDBERRIES",
          officialUrl: WB_BUNDLE_OFFICIAL_URL,
          documentKey: WB_BUNDLE_DOCUMENT_KEY,
          bundleVersion: WB_BUNDLE_VERSION,
          expectedArtifactType: "JSON",
          blockerReason: "Explicit synthetic operator request",
          createdAt: now,
        });
        expect(explicit.requestId).not.toBe(first.requestId);
        expect((await pass()).status).toBe("NOT_OBSERVABLE");
        expect((await pendingStore.getRequest(first.requestId))?.status).toBe(
          terminal,
        );
        expect(
          (await pendingStore.listPending(now))
            .filter((request) => request.documentKey === WB_BUNDLE_DOCUMENT_KEY)
            .map((request) => request.requestId),
        ).toEqual([explicit.requestId]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it("concurrent initial full reports create one WB generation", async () => {
    const state = createInMemorySwaggerSourceState();
    const pendingStore = new InMemorySwaggerSourceStore(state);
    const dependencies = {
      registry: productionSourceRegistry,
      store: new InMemoryApiWatchStore(),
      reportStore: new InMemoryApiWatchReportStore(),
      retryStore: new InMemoryApiWatchRetryStore(),
      pendingStore,
      fetcher: (async () =>
        new Response("synthetic403", { status: 403 })) as typeof fetch,
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        runApiWatchReport({
          runId: "concurrent-lifecycle-" + index,
          source: "FORCED",
          dependencies,
        }),
      ),
    );
    expect(results.map((result) => result.status)).toEqual(
      Array(4).fill("NOT_OBSERVABLE"),
    );
    expect(
      [...state.requests.values()].filter(
        (request) => request.documentKey === WB_BUNDLE_DOCUMENT_KEY,
      ),
    ).toHaveLength(1);
  });
});
