import { describe, expect, it } from "vitest";
import {
  createInMemorySwaggerSourceState,
  InMemorySwaggerSourceStore,
} from "./swagger-handoff.js";
const identity = {
  sourceFamily: "WILDBERRIES" as const,
  officialUrl: "https://dev.wildberries.ru/",
  documentKey: "WB_OPENAPI_BUNDLE",
  bundleVersion: "wb_openapi_bundle_v1",
  expectedArtifactType: "JSON",
  blockerReason: "Synthetic explicit renewal",
};
describe("explicit Swagger generations", () => {
  it("preserves candidate history and orders explicit generations across a backward clock", async () => {
    const store = new InMemorySwaggerSourceStore();
    const old = await store.createRequest({
      ...identity,
      createdAt: new Date("2030-01-01"),
    });
    await store.setRequestStatus(old.requestId, "CANDIDATE_READY");
    const next = await store.renewRequest({
      ...identity,
      createdAt: new Date("2029-01-01"),
    });
    await store.setRequestStatus(next.requestId, "CANDIDATE_READY");
    const last = await store.renewRequest({
      ...identity,
      createdAt: new Date("2028-01-01"),
    });
    await store.setRequestStatus(last.requestId, "CANDIDATE_READY");
    expect(
      (await store.listReadyRequests()).map((request) => request.requestId),
    ).toEqual([last.requestId, next.requestId, old.requestId]);
    expect(
      (await store.getRequest(old.requestId))?.createdAt.toISOString(),
    ).toBe("2030-01-01T00:00:00.000Z");
  });
  it("expires only the elapsed pending request and coalesces concurrent explicit requests", async () => {
    const state = createInMemorySwaggerSourceState();
    const first = new InMemorySwaggerSourceStore(state),
      second = new InMemorySwaggerSourceStore(state);
    const at = new Date("2030-01-01");
    const old = await first.createRequest({
      ...identity,
      createdAt: new Date("2029-01-01"),
      expiresAt: at,
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? first : second).renewRequest({
          ...identity,
          createdAt: at,
        }),
      ),
    );
    expect(new Set(results.map((request) => request.requestId)).size).toBe(1);
    expect((await first.getRequest(old.requestId))?.status).toBe("EXPIRED");
    expect(await first.listPending(at)).toHaveLength(1);
  });
});
