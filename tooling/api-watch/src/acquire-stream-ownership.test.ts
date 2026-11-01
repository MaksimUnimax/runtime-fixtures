import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { acquireOfficialSource } from "./acquire.js";
import type { SourceRegistryEntry } from "./types.js";

const entry: SourceRegistryEntry = {
  sourceFamily: "OZON_SELLER",
  officialUrl: "https://docs.ozon.ru/spec.json",
  expectedArtifactTypes: ["JSON"],
  maximumBytes: 1024 * 1024,
  acquisitionPolicy: "OPERATOR_ASSISTED_WHEN_AUTOMATIC_ACCESS_IS_BLOCKED",
  operatorAcceptancePolicy: "DETERMINISTIC",
};
const document = new TextEncoder().encode(
  JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Synthetic official API", version: "1" },
    paths: {
      "/synthetic": { get: { responses: { "200": { description: "ok" } } } },
    },
  }),
);
function response(read: () => Promise<ReadableStreamReadResult<Uint8Array>>) {
  const cancel = vi.fn(async () => undefined),
    releaseLock = vi.fn();
  const value = new Response(null, { status: 200 });
  Object.defineProperty(value, "body", {
    value: {
      getReader: () => ({ read, cancel, releaseLock }),
      cancel,
    },
  });
  return { value, cancel, releaseLock };
}
function spin(milliseconds: number) {
  const until = performance.now() + milliseconds;
  while (performance.now() < until) {
    /* bounded producer work */
  }
}

describe("whole C03 stream ownership and elapsed deadline", () => {
  for (const carrier of [
    "Uint8Array",
    "Buffer",
    "offset-view",
    "overridden-slice",
  ] as const) {
    it(`snapshots reused ${carrier} storage before the next read`, async () => {
      const storage =
        carrier === "Buffer" ? Buffer.alloc(67) : new Uint8Array(67);
      let offset = 0;
      const r = response(async () => {
        storage.fill(0xff);
        if (offset >= document.length) return { done: true, value: undefined };
        const size = Math.min(61, document.length - offset);
        storage.set(document.subarray(offset, offset + size), 3);
        const view = storage.subarray(3, 3 + size);
        if (carrier === "overridden-slice")
          Object.defineProperty(view, "slice", {
            value: () => {
              throw new Error("virtual slice must not be called");
            },
          });
        offset += size;
        return { done: false, value: view };
      });
      const fetcher = vi.fn(async () => r.value);
      const outcome = await acquireOfficialSource({
        entry,
        fetcher,
        timeoutMs: 1000,
      });
      expect(outcome.kind).toBe("ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
      if (outcome.kind !== "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE")
        throw new Error(outcome.kind);
      expect(outcome.bytes).toEqual(document);
      expect(outcome.sha256).toBe(
        createHash("sha256").update(document).digest("hex"),
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(r.releaseLock).toHaveBeenCalledTimes(1);
    });
  }
  it("rejects an elapsed body deadline even while ready reads starve its timer", async () => {
    let count = 0;
    const r = response(async () => {
      if (++count <= 80) {
        spin(1);
        return { done: false, value: new Uint8Array() };
      }
      if (count === 81) return { done: false, value: document };
      return { done: true, value: undefined };
    });
    const outcome = await acquireOfficialSource({
      entry,
      fetcher: async () => r.value,
      timeoutMs: 10,
    });
    expect(outcome).toMatchObject({
      kind: "SOURCE_TEMPORARILY_UNAVAILABLE",
      blockerReason: "Official source acquisition timed out.",
    });
    expect(count).toBeLessThan(81);
    expect(r.cancel).toHaveBeenCalled();
  });
  it("lets external owner revocation run during a long chain of empty ready chunks", async () => {
    const owner = new AbortController();
    let reads = 0;
    const r = response(async () => {
      if (++reads <= 500) {
        spin(0.1);
        return { done: false, value: new Uint8Array() };
      }
      return reads === 501
        ? { done: false, value: document }
        : { done: true, value: undefined };
    });
    const timer = setTimeout(() => owner.abort(), 0);
    try {
      await expect(
        acquireOfficialSource({
          entry,
          signal: owner.signal,
          fetcher: async () => r.value,
          timeoutMs: 1000,
        }),
      ).rejects.toThrow("API_WATCH_ACQUISITION_REVOKED");
      expect(reads).toBeLessThan(501);
    } finally {
      clearTimeout(timer);
    }
  });
  it("rejects headers completing after the monotonic acquisition deadline", async () => {
    const outcome = await acquireOfficialSource({
      entry,
      timeoutMs: 2,
      fetcher: async () => {
        spin(15);
        return new Response(document);
      },
    });
    expect(outcome).toMatchObject({
      kind: "SOURCE_TEMPORARILY_UNAVAILABLE",
      blockerReason: "Official source acquisition timed out.",
    });
  });
  it("retains every byte of a successful many-chunk document while yielding to timers", async () => {
    let offset = 0,
      turns = 0;
    const timer = setTimeout(() => {
      ++turns;
    }, 0);
    const r = response(async () =>
      offset < document.length
        ? { done: false, value: document.subarray(offset, ++offset) }
        : { done: true, value: undefined },
    );
    try {
      const outcome = await acquireOfficialSource({
        entry,
        timeoutMs: 1000,
        fetcher: async () => r.value,
      });
      expect(outcome.kind).toBe("ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
      if (outcome.kind !== "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE")
        throw new Error(outcome.kind);
      expect(outcome.bytes).toEqual(document);
      expect(turns).toBeGreaterThan(0);
    } finally {
      clearTimeout(timer);
    }
  });
});
