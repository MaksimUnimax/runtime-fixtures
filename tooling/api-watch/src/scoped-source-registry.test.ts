import { describe, expect, it, vi } from "vitest";
import { InMemorySwaggerSourceStore } from "@product/monitoring-control";
import {
  createSourceRegistry,
  scopeSourceRegistry,
} from "./source-registry.js";
import { InMemoryApiWatchStore, runAuthorityPass } from "./authority.js";

describe("C03 retry family scope is an egress fence, not only a display filter", () => {
  it("restricts get and list to exactly the selected families with cloned authority", () => {
    const base = createSourceRegistry();
    const scoped = scopeSourceRegistry(base, ["OZON_SELLER"]);
    expect(scoped.list().map((entry) => entry.sourceFamily)).toEqual([
      "OZON_SELLER",
    ]);
    expect(scoped.get("OZON_SELLER").officialUrl).toBe(
      base.get("OZON_SELLER").officialUrl,
    );
    expect(() => scoped.get("WILDBERRIES")).toThrow(
      "SOURCE_FAMILY_OUT_OF_SCOPE",
    );
    const entry = scoped.get("OZON_SELLER");
    entry.acceptedHosts?.splice(0);
    expect(scoped.get("OZON_SELLER").acceptedHosts).toEqual(["docs.ozon.ru"]);
  });

  it("fails closed on empty, duplicate, or unavailable requested families", () => {
    const base = createSourceRegistry();
    expect(() => scopeSourceRegistry(base, [])).toThrow(
      "SOURCE_FAMILY_SCOPE_INVALID",
    );
    expect(() =>
      scopeSourceRegistry(base, ["OZON_SELLER", "OZON_SELLER"]),
    ).toThrow("SOURCE_FAMILY_SCOPE_INVALID");
    const incomplete = scopeSourceRegistry(base, ["OZON_SELLER"]);
    expect(() => scopeSourceRegistry(incomplete, ["WILDBERRIES"])).toThrow(
      "SOURCE_FAMILY_SCOPE_UNAVAILABLE",
    );
    expect(base.list()).toHaveLength(3);
  });

  it("never forwards a one-family retry scope to other source URLs", async () => {
    const base = createSourceRegistry({
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
        officialUrl: "http://127.0.0.1/wb.yaml",
        acceptedHosts: ["127.0.0.1"],
        documents: [],
      },
    });
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response("synthetic source unavailable", { status: 503 });
    });
    const run = await runAuthorityPass({
      registry: scopeSourceRegistry(base, ["OZON_SELLER"]),
      store: new InMemoryApiWatchStore(),
      pendingStore: new InMemorySwaggerSourceStore(),
      fetcher: fetcher as typeof fetch,
    });
    expect(run.outcomes).toHaveLength(1);
    expect(run.outcomes[0]?.sourceFamily).toBe("OZON_SELLER");
    expect(calls).toEqual(["http://127.0.0.1/seller.json"]);
    expect(
      calls.some(
        (url) => url.includes("performance") || url.includes("wb.yaml"),
      ),
    ).toBe(false);
  });
});
