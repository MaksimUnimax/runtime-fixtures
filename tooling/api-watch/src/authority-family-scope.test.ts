import { describe, expect, it, vi } from "vitest";
import { InMemorySwaggerSourceStore } from "@product/monitoring-control";
import { InMemoryApiWatchStore, runAuthorityPass } from "./authority.js";
import { createSourceRegistry } from "./source-registry.js";

function syntheticRegistry() {
  return createSourceRegistry({
    OZON_SELLER: {
      officialUrl: "http://127.0.0.1/seller.json",
      acceptedHosts: ["127.0.0.1"],
      requiredServerIdentity: undefined,
      titlePattern: undefined,
    },
    OZON_PERFORMANCE: {
      officialUrl: "http://127.0.0.1/performance.json",
      acceptedHosts: ["127.0.0.1"],
      requiredServerIdentity: undefined,
      titlePattern: undefined,
    },
    WILDBERRIES: {
      officialUrl: null,
      documents: [
        {
          documentKey: "WB_01_GENERAL",
          officialUrl: "http://127.0.0.1/wb-general.yaml",
          expectedArtifactTypes: ["YAML"],
        },
      ],
      acceptedHosts: ["127.0.0.1"],
    },
  });
}

function fakeFetcher() {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response("synthetic unavailable", { status: 503 });
  });
  return { calls, fetcher: fetcher as typeof fetch };
}

describe("C03 runAuthorityPass retry-only family egress bound", () => {
  it("reads only one claimed family and cannot touch unselected sources", async () => {
    const transport = fakeFetcher();
    const result = await runAuthorityPass({
      registry: syntheticRegistry(),
      store: new InMemoryApiWatchStore(),
      pendingStore: new InMemorySwaggerSourceStore(),
      skipOperatorBlocked: true,
      sourceFamilies: ["OZON_SELLER"],
      fetcher: transport.fetcher,
    });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.sourceFamily).toBe("OZON_SELLER");
    expect(transport.calls).toEqual(["http://127.0.0.1/seller.json"]);
  });

  it("keeps original unscoped passes and their three-family coverage", async () => {
    const transport = fakeFetcher();
    const result = await runAuthorityPass({
      registry: syntheticRegistry(),
      store: new InMemoryApiWatchStore(),
      pendingStore: new InMemorySwaggerSourceStore(),
      fetcher: transport.fetcher,
    });
    expect(result.outcomes.map((value) => value.sourceFamily)).toEqual([
      "OZON_SELLER",
      "OZON_PERFORMANCE",
      "WILDBERRIES",
    ]);
    expect(transport.calls).toEqual([
      "http://127.0.0.1/seller.json",
      "http://127.0.0.1/performance.json",
      "http://127.0.0.1/wb-general.yaml",
    ]);
  });

  it("fails before fetch for empty, duplicate or unauthorized automatic scope", async () => {
    const transport = fakeFetcher();
    const args = {
      registry: syntheticRegistry(),
      store: new InMemoryApiWatchStore(),
      pendingStore: new InMemorySwaggerSourceStore(),
      fetcher: transport.fetcher,
    };
    await expect(
      runAuthorityPass({
        ...args,
        skipOperatorBlocked: true,
        sourceFamilies: [],
      }),
    ).rejects.toThrow("SOURCE_FAMILY_SCOPE_INVALID");
    await expect(
      runAuthorityPass({
        ...args,
        skipOperatorBlocked: true,
        sourceFamilies: ["OZON_SELLER", "OZON_SELLER"],
      }),
    ).rejects.toThrow("SOURCE_FAMILY_SCOPE_INVALID");
    await expect(
      runAuthorityPass({ ...args, sourceFamilies: ["OZON_SELLER"] }),
    ).rejects.toThrow("SOURCE_FAMILY_SCOPE_REQUIRES_AUTOMATIC_PASS");
    expect(transport.calls).toEqual([]);
  });
});
