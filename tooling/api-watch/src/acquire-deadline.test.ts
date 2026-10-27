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
  it("refuses a revoked run before invoking any source fetcher", async () => {
    const owner = new AbortController();
    owner.abort();
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      acquireOfficialSource({
        entry,
        timeoutMs: 60_000,
        signal: owner.signal,
        fetcher: fetcher as typeof fetch,
      }),
    ).rejects.toThrow("API_WATCH_ACQUISITION_REVOKED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("revokes a stalled header fetch even when the injected fetcher ignores AbortSignal", async () => {
    const owner = new AbortController();
    let started!: () => void;
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    const deliveredSignals: AbortSignal[] = [];
    const run = acquireOfficialSource({
      entry,
      timeoutMs: 60_000,
      signal: owner.signal,
      fetcher: async (_url, init) => {
        if (init?.signal) deliveredSignals.push(init.signal);
        started();
        return new Promise<Response>(() => undefined);
      },
    });
    await begun;
    owner.abort();
    await expect(run).rejects.toThrow("API_WATCH_ACQUISITION_REVOKED");
    expect(deliveredSignals).toHaveLength(1);
    expect(deliveredSignals[0]?.aborted).toBe(true);
  });

  it("revokes a stalled bodyless read without converting it to a retry", async () => {
    const owner = new AbortController();
    let beginRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      beginRead = resolve;
    });
    const signals: AbortSignal[] = [];
    const response = new Response(null, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(response, "arrayBuffer", {
      value: () => {
        beginRead();
        return new Promise<ArrayBuffer>(() => undefined);
      },
    });
    const run = acquireOfficialSource({
      entry,
      timeoutMs: 60_000,
      signal: owner.signal,
      fetcher: async (_url, init) => {
        if (init?.signal) signals.push(init.signal);
        return response;
      },
    });
    // This signal fires ONLY after response headers and body reading began.
    await readStarted;
    owner.abort();
    await expect(run).rejects.toThrow("API_WATCH_ACQUISITION_REVOKED");
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("cancels stalled streaming reader.read without waiting for a hanging cancel callback", async () => {
    const owner = new AbortController();
    let reading!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      reading = resolve;
    });
    let cancellations = 0;
    const signals: AbortSignal[] = [];
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          reading();
          return new Promise<void>(() => undefined);
        },
        cancel() {
          cancellations += 1;
          return new Promise<void>(() => undefined);
        },
      },
      // Do not initiate pull until acquireOfficialSource starts reader.read().
      { highWaterMark: 0 },
    );
    const run = acquireOfficialSource({
      entry,
      timeoutMs: 60_000,
      signal: owner.signal,
      fetcher: async (_url, init) => {
        if (init?.signal) signals.push(init.signal);
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await readStarted;
    owner.abort();
    await expect(run).rejects.toThrow("API_WATCH_ACQUISITION_REVOKED");
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    await vi.waitFor(() => expect(cancellations).toBeGreaterThan(0), {
      timeout: 150,
      interval: 5,
    });
  });

  it("prevents a second redirect hop after run ownership is revoked", async () => {
    const owner = new AbortController();
    let requests = 0;
    let firstCancel!: () => void;
    const firstCancellation = new Promise<void>((resolve) => {
      firstCancel = resolve;
    });
    const run = acquireOfficialSource({
      entry,
      timeoutMs: 60_000,
      signal: owner.signal,
      maxRedirects: 5,
      fetcher: async () => {
        requests += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              firstCancel();
              return new Promise<void>(() => undefined);
            },
          }),
          { status: 307, headers: { location: "/next.json" } },
        );
      },
    });
    await firstCancellation;
    owner.abort();
    await expect(run).rejects.toThrow("API_WATCH_ACQUISITION_REVOKED");
    expect(requests).toBe(1);
  });

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

  it("bounds a bodyless adapter whose arrayBuffer ignores the shared signal", async () => {
    let arrayBufferCalls = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const response = new Response(null, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    Object.defineProperty(response, "arrayBuffer", {
      value: () => {
        arrayBufferCalls += 1;
        return new Promise<ArrayBuffer>(() => undefined);
      },
    });
    try {
      const result = await Promise.race([
        acquireOfficialSource({
          entry,
          timeoutMs: 30,
          fetcher: async () => response,
        }),
        new Promise<"WATCHDOG_EXPIRED">((resolve) => {
          watchdog = setTimeout(() => resolve("WATCHDOG_EXPIRED"), 180);
        }),
      ]);
      expect(result).not.toBe("WATCHDOG_EXPIRED");
      if (result === "WATCHDOG_EXPIRED")
        throw new Error("BODYLESS_ARRAYBUFFER_BYPASSED_TOTAL_DEADLINE");
      expect(result.kind).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
      expect(arrayBufferCalls).toBe(1);
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

  it("does not follow a redirect if cancelling the previous response body rejects", async () => {
    let requests = 0;
    let cancellationAttempts = 0;
    const result = await acquireOfficialSource({
      entry,
      timeoutMs: 200,
      fetcher: async () => {
        requests += 1;
        if (requests === 1)
          return new Response(
            new ReadableStream<Uint8Array>({
              cancel() {
                cancellationAttempts += 1;
                throw new Error("REDIRECT_BODY_CANCEL_REJECTED");
              },
            }),
            { status: 307, headers: { location: "/next.json" } },
          );
        return new Response(null, { status: 403 });
      },
    });

    expect(cancellationAttempts).toBe(1);
    expect(requests).toBe(1);
    expect(result.kind).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
    if (result.kind === "SOURCE_TEMPORARILY_UNAVAILABLE")
      expect(result.blockerReason).toBe(
        "Official source redirect response body cleanup failed.",
      );
  });

  it("does not throw or follow a redirect when cancellation throws synchronously", async () => {
    let requests = 0;
    let cancellationAttempts = 0;
    const redirect = new Response(new ReadableStream<Uint8Array>(), {
      status: 307,
      headers: { location: "/next.json" },
    });
    if (!redirect.body) throw new Error("missing redirect body");
    Object.defineProperty(redirect.body, "cancel", {
      value: () => {
        cancellationAttempts += 1;
        throw new Error("SYNCHRONOUS_REDIRECT_CANCEL_ERROR");
      },
    });

    const result = await acquireOfficialSource({
      entry,
      timeoutMs: 200,
      fetcher: async () => {
        requests += 1;
        return requests === 1 ? redirect : new Response(null, { status: 403 });
      },
    });

    expect(cancellationAttempts).toBeGreaterThanOrEqual(1);
    expect(requests).toBe(1);
    expect(result.kind).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
    if (result.kind === "SOURCE_TEMPORARILY_UNAVAILABLE")
      expect(result.blockerReason).toBe(
        "Official source redirect response body cleanup failed.",
      );
  });

  it("bounds a stalled header fetcher and cancels a response arriving after timeout", async () => {
    let requests = 0;
    let lateCancelCalls = 0;
    let completeHeaders: ((response: Response) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        acquireOfficialSource({
          entry,
          timeoutMs: 30,
          fetcher: async (_input, init) => {
            requests += 1;
            requestSignal = init?.signal ?? undefined;
            return new Promise<Response>((resolve) => {
              completeHeaders = resolve;
            });
          },
        }),
        new Promise<"WATCHDOG_EXPIRED">((resolve) => {
          watchdog = setTimeout(() => resolve("WATCHDOG_EXPIRED"), 180);
        }),
      ]);
      expect(result).not.toBe("WATCHDOG_EXPIRED");
      if (result === "WATCHDOG_EXPIRED")
        throw new Error("FETCHER_HEADERS_BYPASSED_TOTAL_DEADLINE");
      expect(result.kind).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
      expect(requests).toBe(1);
      expect(requestSignal?.aborted).toBe(true);
      completeHeaders?.(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              lateCancelCalls += 1;
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await vi.waitFor(() => expect(lateCancelCalls).toBe(1), {
        timeout: 150,
        interval: 5,
      });
    } finally {
      if (watchdog) clearTimeout(watchdog);
      // Release the injected adapter even when the negative test fails.
      completeHeaders?.(new Response(null, { status: 204 }));
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
