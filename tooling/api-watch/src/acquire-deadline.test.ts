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

function abortError() {
  return new DOMException("aborted", "AbortError");
}

function abortAwareDelay(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

describe("C03 acquisition deadline", () => {
  it("aborts a stalled body read through the shared deadline and releases the stream", async () => {
    let body: ReadableStream<Uint8Array> | undefined;
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    let listenerRemoved = false;

    const fetcher: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("missing signal");
      body = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
          controller.enqueue(new TextEncoder().encode("{"));
        },
      });
      const onAbort = () => {
        controllerRef?.error(abortError());
        signal.removeEventListener("abort", onAbort);
        listenerRemoved = true;
      };
      signal.addEventListener("abort", onAbort, { once: true });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await acquireOfficialSource({
      entry,
      timeoutMs: 20,
      fetcher,
    });

    expect(result.kind).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
    expect(body?.locked).toBe(false);
    expect(listenerRemoved).toBe(true);
  });

  it("bounds cancellation even when an oversized body stream never settles cancel", async () => {
    let cancelCalls = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        acquireOfficialSource({
          entry: { ...entry, maximumBytes: 8 },
          timeoutMs: 30,
          fetcher: async () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new Uint8Array(16));
                },
                cancel() {
                  cancelCalls += 1;
                  return new Promise<void>(() => undefined);
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        }),
        new Promise<"WATCHDOG_EXPIRED">((resolve) => {
          watchdog = setTimeout(() => resolve("WATCHDOG_EXPIRED"), 180);
        }),
      ]);
      expect(result).not.toBe("WATCHDOG_EXPIRED");
      if (result === "WATCHDOG_EXPIRED")
        throw new Error("BODY_CANCEL_BYPASSED_TOTAL_DEADLINE");
      expect(result.kind).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
      expect(cancelCalls).toBe(1);
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  });

  it("bounds a stalled body read even if an injected adapter ignores its signal", async () => {
    let cancelCalls = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        acquireOfficialSource({
          entry,
          timeoutMs: 30,
          fetcher: async () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("{"));
                },
                cancel() {
                  cancelCalls += 1;
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        }),
        new Promise<"WATCHDOG_EXPIRED">((resolve) => {
          watchdog = setTimeout(() => resolve("WATCHDOG_EXPIRED"), 180);
        }),
      ]);
      expect(result).not.toBe("WATCHDOG_EXPIRED");
      if (result === "WATCHDOG_EXPIRED")
        throw new Error("BODY_READ_BYPASSED_TOTAL_DEADLINE");
      expect(result.kind).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
      expect(cancelCalls).toBe(1);
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  });

  it("does not hang past the total deadline when redirect-body cancellation never settles", async () => {
    let requests = 0;
    const signals: AbortSignal[] = [];
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        acquireOfficialSource({
          entry,
          timeoutMs: 30,
          fetcher: async (_input, init) => {
            if (!init?.signal) throw new Error("missing signal");
            const signal = init.signal;
            signals.push(signal);
            requests += 1;
            if (requests === 1) {
              return new Response(
                new ReadableStream<Uint8Array>({
                  cancel() {
                    return new Promise<void>(() => undefined);
                  },
                }),
                { status: 307, headers: { location: "/next.json" } },
              );
            }
            if (signal.aborted) throw abortError();
            await abortAwareDelay(signal, 100);
            return new Response(null, { status: 204 });
          },
        }),
        new Promise<"WATCHDOG_EXPIRED">((resolve) => {
          watchdog = setTimeout(() => resolve("WATCHDOG_EXPIRED"), 150);
        }),
      ]);
      expect(result).not.toBe("WATCHDOG_EXPIRED");
      if (result === "WATCHDOG_EXPIRED")
        throw new Error("REDIRECT_CANCEL_BYPASSED_TOTAL_DEADLINE");
      expect(result.kind).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
      expect(requests).toBe(1);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(true);
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  });

  it("uses one abort-aware deadline across redirect hops", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const signals: AbortSignal[] = [];
      const resultPromise = acquireOfficialSource({
        entry,
        timeoutMs: 30,
        maxRedirects: 5,
        fetcher: async (input, init) => {
          if (!init?.signal) throw new Error("missing signal");
          signals.push(init.signal);
          await abortAwareDelay(init.signal, 20);
          calls += 1;
          return new Response(null, {
            status: 307,
            headers: {
              location: `${String(input).split("?")[0]}?hop=${calls}`,
            },
          });
        },
      });
      await vi.advanceTimersByTimeAsync(20);
      expect(calls).toBeGreaterThanOrEqual(1);
      await vi.advanceTimersByTimeAsync(20);
      const result = await resultPromise;

      expect(result.kind).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
      expect(calls).toBeLessThan(5);
      expect(new Set(signals).size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
