import { beforeEach, describe, expect, it, vi } from "vitest";

// Execute the real hook with deterministic hook slots and delayed transport.
// No timers or network races are needed to force B-before-A completion.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: new Map<
    number,
    { deps: unknown[]; create: () => void | (() => void) }
  >(),
  cleanups: new Map<number, () => void>(),
  writes: 0,
  request: vi.fn(),
  refresh: vi.fn(),
  notice: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const same = (a: unknown[] | undefined, b: unknown[]) =>
    a?.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
  return {
    ...actual,
    useContext: () => ({ refresh: harness.refresh, setNotice: harness.notice }),
    useState: <T,>(initial: T | (() => T)) => {
      const index = harness.cursor++;
      if (!(index in harness.slots))
        harness.slots[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        harness.slots[index] as T,
        (value: T | ((previous: T) => T)) => {
          harness.writes++;
          harness.slots[index] =
            typeof value === "function"
              ? (value as (previous: T) => T)(harness.slots[index] as T)
              : value;
        },
      ];
    },
    useMemo: <T,>(create: () => T, deps: unknown[]) => {
      const index = harness.cursor++;
      const previous = harness.slots[index] as
        | { deps: unknown[]; value: T }
        | undefined;
      if (!previous || !same(previous.deps, deps))
        harness.slots[index] = { deps, value: create() };
      return (harness.slots[index] as { value: T }).value;
    },
    useEffect: (create: () => void | (() => void), deps: unknown[]) => {
      const index = harness.cursor++;
      if (!same(harness.slots[index] as unknown[] | undefined, deps))
        harness.effects.set(index, { deps, create });
    },
  };
});
vi.mock("./control-plane", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./control-plane")>()),
  controlPlane: harness.request,
}));

import { useData } from "../app/admin-ui";
import { ControlPlaneError } from "./control-plane";

type Item = { repairCaseId: string };
function render(path: string | null) {
  harness.cursor = 0;
  return useData<Item>(path);
}
function effects() {
  for (const [index, effect] of harness.effects) {
    harness.cleanups.get(index)?.();
    harness.slots[index] = effect.deps;
    const cleanup = effect.create();
    if (cleanup) harness.cleanups.set(index, cleanup);
  }
  harness.effects.clear();
}
function unmount() {
  for (const cleanup of harness.cleanups.values()) cleanup();
  harness.cleanups.clear();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  unmount();
  harness.slots = [];
  harness.cursor = 0;
  harness.effects.clear();
  harness.writes = 0;
  harness.request.mockReset();
  harness.refresh.mockReset().mockResolvedValue(undefined);
  harness.notice.mockReset();
});

describe("useData request lifetime", () => {
  it("preserves selected B after B then A responses even if transport ignores abort", async () => {
    const a = deferred<Item>(),
      b = deferred<Item>();
    harness.request
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    render("/v1/A");
    effects();
    render("/v1/B");
    effects();
    expect(harness.request.mock.calls[0]![1].signal.aborted).toBe(true);
    b.resolve({ repairCaseId: "B" });
    await settle();
    expect(render("/v1/B")).toMatchObject({
      data: { repairCaseId: "B" },
      busy: false,
      error: null,
    });
    a.resolve({ repairCaseId: "A" });
    await settle();
    expect(render("/v1/B")).toMatchObject({
      data: { repairCaseId: "B" },
      busy: false,
      error: null,
    });
  });

  it("does not let old rejection/finally clear a new request's busy state or refresh permissions", async () => {
    const a = deferred<Item>(),
      b = deferred<Item>();
    harness.request
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    render("/v1/A");
    effects();
    render("/v1/B");
    effects();
    a.reject(new ControlPlaneError("ADMIN_FORBIDDEN", 403));
    await settle();
    expect(render("/v1/B")).toMatchObject({
      data: null,
      busy: true,
      error: null,
    });
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(harness.notice).not.toHaveBeenCalled();
    b.resolve({ repairCaseId: "B" });
    await settle();
  });

  it("hides old data on the selection render and clears it when the path becomes null", async () => {
    harness.request.mockResolvedValue({ repairCaseId: "A" });
    const old = render("/v1/A");
    effects();
    await settle();
    expect(render("/v1/A").data?.repairCaseId).toBe("A");
    expect(render("/v1/B")).toMatchObject({
      data: null,
      busy: true,
      error: null,
    });
    effects();
    expect(render(null)).toMatchObject({
      data: null,
      busy: false,
      error: null,
    });
    effects();
    const calls = harness.request.mock.calls.length;
    await old.load();
    expect(harness.request).toHaveBeenCalledTimes(calls);
    await settle();
    expect(render(null)).toMatchObject({
      data: null,
      busy: false,
      error: null,
    });
  });

  it("keeps only the latest manual reload of the same path", async () => {
    const first = deferred<Item>(),
      second = deferred<Item>();
    harness.request
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render("/v1/A");
    effects();
    const reload = render("/v1/A").load();
    second.resolve({ repairCaseId: "new" });
    await reload;
    first.resolve({ repairCaseId: "old" });
    await settle();
    expect(render("/v1/A")).toMatchObject({
      data: { repairCaseId: "new" },
      busy: false,
    });
  });

  it("aborts on unmount and ignores completion after unmount", async () => {
    const pending = deferred<Item>();
    harness.request.mockReturnValue(pending.promise);
    render("/v1/A");
    effects();
    unmount();
    const writes = harness.writes;
    expect(harness.request.mock.calls[0]![1].signal.aborted).toBe(true);
    pending.resolve({ repairCaseId: "A" });
    await settle();
    expect(harness.writes).toBe(writes);
  });

  it("handles current permission errors but suppresses a stale post-refresh notice", async () => {
    const a = deferred<Item>(),
      refresh = deferred<void>(),
      b = deferred<Item>();
    harness.request
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise);
    harness.refresh.mockReturnValue(refresh.promise);
    render("/v1/A");
    effects();
    a.reject(new ControlPlaneError("ADMIN_FORBIDDEN", 403));
    await settle();
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(render("/v1/A").error).toBeInstanceOf(ControlPlaneError);
    render("/v1/B");
    effects();
    refresh.resolve();
    await settle();
    expect(harness.notice).not.toHaveBeenCalled();
    expect(render("/v1/B")).toMatchObject({
      data: null,
      busy: true,
      error: null,
    });
    b.resolve({ repairCaseId: "B" });
    await settle();
  });
});
