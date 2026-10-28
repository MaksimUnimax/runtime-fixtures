import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitForPgBackendExit } from "./wait-for-pg-backend-exit.js";

const backend = { pid: 123, startedAt: "2026-10-28 07:00:00.123456+00" };
beforeEach(() =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }),
);
afterEach(() => vi.useRealTimers());

it("waits for the same old backend after pool.end resolves early", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false);
  const pending = waitForPgBackendExit(read, backend, {
    timeoutMs: 100,
    pollMs: 10,
  });
  await vi.advanceTimersByTimeAsync(20);
  await pending;
  expect(read.mock.calls).toEqual([[backend], [backend], [backend]]);
  expect(vi.getTimerCount()).toBe(0);
});

it("fails by the fixed deadline when the old backend remains", async () => {
  const read = vi.fn().mockResolvedValue(true);
  const result = waitForPgBackendExit(read, backend, {
    timeoutMs: 40,
    pollMs: 10,
  }).catch((e: Error) => e.message);
  await vi.advanceTimersByTimeAsync(40);
  expect(await result).toBe("PG_BACKEND_EXIT_UNCONFIRMED");
  expect(read).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(100);
  expect(read).toHaveBeenCalledTimes(4);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a pending observation without issuing a second read", async () => {
  const read = vi.fn(() => new Promise<boolean>(() => {}));
  const result = waitForPgBackendExit(read, backend, { timeoutMs: 40 }).catch(
    (e: Error) => e.message,
  );
  await vi.advanceTimersByTimeAsync(40);
  expect(await result).toBe("PG_BACKEND_EXIT_UNCONFIRMED");
  expect(read).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not accept disappearance first observed at the deadline", async () => {
  const read = () =>
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 40));
  const result = waitForPgBackendExit(read, backend, { timeoutMs: 40 }).catch(
    (e: Error) => e.message,
  );
  await vi.advanceTimersByTimeAsync(40);
  expect(await result).toBe("PG_BACKEND_EXIT_UNCONFIRMED");
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves an observation error instead of treating it as an absent backend", async () => {
  const error = new Error("OBSERVER_FAILURE");
  const read = vi.fn().mockRejectedValue(error);
  await expect(waitForPgBackendExit(read, backend)).rejects.toBe(error);
  expect(read).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("accepts immediate verified absence and cancels its deadline timer", async () => {
  await waitForPgBackendExit(async () => false, backend);
  expect(vi.getTimerCount()).toBe(0);
});

it("rejects an invalid identity or observation without claiming absence", async () => {
  const read = vi.fn().mockResolvedValue(false);
  await expect(
    waitForPgBackendExit(read, { ...backend, pid: 0 }),
  ).rejects.toThrow("INVALID_BACKEND_WAIT");
  expect(read).not.toHaveBeenCalled();
  await expect(
    waitForPgBackendExit(async () => undefined as unknown as boolean, backend),
  ).rejects.toThrow("INVALID_BACKEND_OBSERVATION");
  expect(vi.getTimerCount()).toBe(0);
});
