import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDatabaseConnection,
  createDatabaseRuntime,
  type DatabaseQuery,
} from "./index.js";

// Execute the actual exported runtime. Only the driver transport is injected.
const selected = vi.hoisted(() => ({ pool: undefined as unknown }));
vi.mock("pg", () => ({
  Pool: class {
    constructor() {
      return selected.pool as object;
    }
  },
}));

type Options = {
  faults?: Record<string, unknown>;
  operationFailure?: unknown;
  releaseFailure?: unknown;
  connectFailure?: unknown;
  gate?: { sql: string; promise: Promise<void> };
  value?: unknown;
  callback?: (tx: DatabaseQuery) => Promise<unknown>;
};
const has = (value: object, key: string) => Object.hasOwn(value, key);
function fixture(options: Options = {}) {
  const trace: string[] = [],
    releases: (boolean | undefined)[] = [];
  let actions = 0;
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    trace.push(text);
    if (options.gate?.sql === text) await options.gate.promise;
    if (options.faults && has(options.faults, text)) throw options.faults[text];
    return { rows: text === "WORK" ? [{ echoed: values?.[0] }] : [] };
  });
  const client = {
    query,
    release: vi.fn((discard?: boolean) => {
      releases.push(discard);
      trace.push("release");
      if (has(options, "releaseFailure")) throw options.releaseFailure;
    }),
  };
  const pool = {
    connect: vi.fn(async () => {
      trace.push("connect");
      if (has(options, "connectFailure")) throw options.connectFailure;
      return client;
    }),
    query: vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [] })),
    end: vi.fn(async () => {}),
  };
  selected.pool = pool;
  const runtime = createDatabaseRuntime(
    "postgres://example.invalid/not-connected",
  );
  const run = () =>
    runtime.transaction(async (tx) => {
      actions++;
      if (options.callback) return options.callback(tx);
      if (has(options, "operationFailure")) throw options.operationFailure;
      await tx.query("WORK", ["synthetic"]);
      return has(options, "value") ? options.value : "success";
    });
  return {
    runtime,
    run,
    pool,
    client,
    trace,
    releases,
    actions: () => actions,
  };
}
async function outcome(promise: Promise<unknown>) {
  return promise.then(
    (value) => ({ rejected: false, value, reason: undefined }),
    (reason: unknown) => ({ rejected: true, value: undefined, reason }),
  );
}
async function rejectsExact(promise: Promise<unknown>, original: unknown) {
  const result = await outcome(promise);
  expect(result.rejected).toBe(true);
  expect(result.reason).toBe(original);
}
function released(f: ReturnType<typeof fixture>, discard: boolean) {
  expect(f.releases).toHaveLength(1);
  expect(f.releases[0] === true).toBe(discard);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("transaction failure identity and one-shot cleanup", () => {
  afterEach(() => {
    selected.pool = undefined;
  });
  it("returns exact success value in same-client order", async () => {
    const value = { committed: true },
      f = fixture({ value });
    expect(await f.run()).toBe(value);
    expect(f.trace).toEqual(["connect", "BEGIN", "WORK", "COMMIT", "release"]);
    expect(f.actions()).toBe(1);
    released(f, false);
  });
  it("preserves a business error after confirmed rollback", async () => {
    const error = new Error("operation"),
      f = fixture({ operationFailure: error });
    await rejectsExact(f.run(), error);
    released(f, false);
    expect(f.trace).toEqual(["connect", "BEGIN", "ROLLBACK", "release"]);
  });
  it("preserves a business error when rollback fails", async () => {
    const error = new Error("operation"),
      f = fixture({
        operationFailure: error,
        faults: { ROLLBACK: new Error("rollback") },
      });
    await rejectsExact(f.run(), error);
    released(f, true);
    expect(f.actions()).toBe(1);
  });
  it("explicitly discards an unconfirmed rollback client", async () => {
    const f = fixture({
      operationFailure: new Error("operation"),
      faults: { ROLLBACK: new Error("rollback") },
    });
    await outcome(f.run());
    released(f, true);
  });
  it("discards on COMMIT rejection even when subsequent rollback succeeds", async () => {
    const error = new Error("commit-unknown"),
      f = fixture({ faults: { COMMIT: error } });
    await rejectsExact(f.run(), error);
    released(f, true);
    expect(f.trace).toEqual([
      "connect",
      "BEGIN",
      "WORK",
      "COMMIT",
      "ROLLBACK",
      "release",
    ]);
    expect(f.actions()).toBe(1);
  });
  it("preserves COMMIT rejection when rollback also fails", async () => {
    const error = new Error("commit-unknown"),
      f = fixture({
        faults: { COMMIT: error, ROLLBACK: new Error("rollback") },
      });
    await rejectsExact(f.run(), error);
    released(f, true);
  });
  it("BEGIN failure never enters the callback", async () => {
    const error = new Error("begin"),
      f = fixture({ faults: { BEGIN: error } });
    await rejectsExact(f.run(), error);
    expect(f.actions()).toBe(0);
    released(f, false);
  });
  it("preserves BEGIN failure over failed rollback", async () => {
    const error = new Error("begin"),
      f = fixture({
        faults: { BEGIN: error, ROLLBACK: new Error("rollback") },
      });
    await rejectsExact(f.run(), error);
    expect(f.actions()).toBe(0);
    released(f, true);
  });
  it("does not release or retry a failed connection acquisition", async () => {
    const error = new Error("connect"),
      f = fixture({ connectFailure: error });
    await rejectsExact(f.run(), error);
    expect(f.trace).toEqual(["connect"]);
    expect(f.actions()).toBe(0);
    expect(f.releases).toHaveLength(0);
  });
  it("reports release failure after successful COMMIT without retry", async () => {
    const error = new Error("release"),
      f = fixture({ releaseFailure: error });
    await rejectsExact(f.run(), error);
    expect(f.actions()).toBe(1);
    released(f, false);
    expect(f.trace).toEqual(["connect", "BEGIN", "WORK", "COMMIT", "release"]);
  });
  it("release failure does not replace the original operation error", async () => {
    const error = new Error("operation"),
      f = fixture({
        operationFailure: error,
        releaseFailure: new Error("release"),
      });
    await rejectsExact(f.run(), error);
    released(f, false);
  });
  it("three failures retain the first operation error", async () => {
    const error = new Error("operation"),
      f = fixture({
        operationFailure: error,
        faults: { ROLLBACK: new Error("rollback") },
        releaseFailure: new Error("release"),
      });
    await rejectsExact(f.run(), error);
    released(f, true);
  });
  it("release failure cannot hide uncertain COMMIT", async () => {
    const error = new Error("commit"),
      f = fixture({
        faults: { COMMIT: error },
        releaseFailure: new Error("release"),
      });
    await rejectsExact(f.run(), error);
    released(f, true);
  });
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["false", false],
    ["zero", 0],
    ["empty string", ""],
    ["symbol", Symbol("primary")],
    ["object", { marker: "primary" }],
  ])("preserves %s rejection over rollback failure", async (_label, reason) => {
    const f = fixture({
      operationFailure: reason,
      faults: { ROLLBACK: new Error("secondary") },
    });
    await rejectsExact(f.run(), reason);
    released(f, true);
  });
  it("undefined callback rejection is never success", async () => {
    const f = fixture({ operationFailure: undefined });
    await rejectsExact(f.run(), undefined);
    released(f, false);
  });
  it("undefined COMMIT rejection is retained", async () => {
    const f = fixture({
      faults: { COMMIT: undefined, ROLLBACK: new Error("rollback") },
    });
    await rejectsExact(f.run(), undefined);
    released(f, true);
  });
  it("undefined release rejection after COMMIT is retained", async () => {
    const f = fixture({ releaseFailure: undefined });
    await rejectsExact(f.run(), undefined);
    released(f, false);
  });
  it("query error wins over rollback error", async () => {
    const error = new Error("query"),
      f = fixture({ faults: { WORK: error, ROLLBACK: new Error("rollback") } });
    await rejectsExact(f.run(), error);
    released(f, true);
    expect(f.trace).toEqual([
      "connect",
      "BEGIN",
      "WORK",
      "ROLLBACK",
      "release",
    ]);
  });
  it("waits for rollback before release", async () => {
    const gate = deferred(),
      error = new Error("operation"),
      f = fixture({
        operationFailure: error,
        gate: { sql: "ROLLBACK", promise: gate.promise },
      });
    const pending = outcome(f.run());
    try {
      await new Promise<void>((done) => setImmediate(done));
      expect(f.releases).toHaveLength(0);
    } finally {
      gate.resolve();
    }
    expect((await pending).reason).toBe(error);
    released(f, false);
  });
  it("late rollback rejection cannot replace the first error", async () => {
    const gate = deferred(),
      error = new Error("operation"),
      f = fixture({
        operationFailure: error,
        gate: { sql: "ROLLBACK", promise: gate.promise },
        faults: { ROLLBACK: new Error("late") },
      });
    const pending = outcome(f.run());
    try {
      await new Promise<void>((done) => setImmediate(done));
      expect(f.releases).toHaveLength(0);
    } finally {
      gate.resolve();
    }
    expect((await pending).reason).toBe(error);
    released(f, true);
  });
  it("never retries any of the three failed cleanup stages", async () => {
    const f = fixture({
      faults: { COMMIT: new Error("commit"), ROLLBACK: new Error("rollback") },
      releaseFailure: new Error("release"),
    });
    await outcome(f.run());
    expect(f.trace).toEqual([
      "connect",
      "BEGIN",
      "WORK",
      "COMMIT",
      "ROLLBACK",
      "release",
    ]);
    expect(f.pool.connect).toHaveBeenCalledTimes(1);
    expect(f.actions()).toBe(1);
    released(f, true);
  });
  it("preserves ready, query, close, and public alias", async () => {
    const f = fixture();
    await f.runtime.ready();
    await f.runtime.query("SELECT synthetic", [7]);
    await f.runtime.close();
    expect(f.pool.query.mock.calls).toEqual([
      ["SELECT 1"],
      ["SELECT synthetic", [7]],
    ]);
    expect(f.pool.end).toHaveBeenCalledTimes(1);
    expect(f.pool.connect).not.toHaveBeenCalled();
    expect(createDatabaseConnection).toBe(createDatabaseRuntime);
  });
  it("returns undefined from a successful callback without SQL", async () => {
    const f = fixture({ callback: async () => undefined });
    expect(await outcome(f.run())).toEqual({
      rejected: false,
      value: undefined,
      reason: undefined,
    });
    expect(f.trace).toEqual(["connect", "BEGIN", "COMMIT", "release"]);
    released(f, false);
  });
});
