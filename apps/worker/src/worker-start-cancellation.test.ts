import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CompositeJobRunner } from "./composite-runner.js";
import { createWorker, type JobRunner } from "./lifecycle.js";
import { JobFailureSignal, TerminalAdmissionDenied } from "./job-failure.js";

type Shape = "direct" | "composite" | "nested";
function wrap(child: JobRunner, shape: Shape): JobRunner {
  if (shape === "direct") return child;
  const composite = new CompositeJobRunner([child]);
  return shape === "nested" ? new CompositeJobRunner([composite]) : composite;
}
function fixture(
  shape: Shape,
  cancellation: unknown = new TerminalAdmissionDenied(),
) {
  let entered!: () => void;
  let rejectStart!: (cause: unknown) => void;
  const enteredStart = new Promise<void>((resolveEntered) => {
    entered = resolveEntered;
  });
  const pending = new Promise<void>((_resolve, reject) => {
    rejectStart = reject;
  });
  const failure = new JobFailureSignal("device-authorization-expiry");
  const child: JobRunner = {
    start: vi.fn(() => {
      entered();
      return pending;
    }),
    quiesce: vi.fn(() => {
      rejectStart(cancellation);
    }),
    stop: vi.fn(async (): Promise<void> => undefined),
    onFailure: (listener) => failure.subscribe(listener),
  };
  const runner = wrap(child, shape);
  const events: unknown[] = [];
  runner.onFailure((event) => {
    events.push(event);
  });
  const database = {
    ready: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const logger = { info: vi.fn() };
  return { child, runner, database, logger, enteredStart, failure, events };
}

describe("B05 normal startup cancellation is not a fatal failure", () => {
  it.each<Shape>(["direct", "composite", "nested"])(
    "%s preserves STOPPED and drains once",
    async (shape) => {
      const f = fixture(shape);
      const runtime = createWorker(f.database, f.runner, f.logger);
      const starting = runtime.start().catch((cause: unknown) => cause);
      await f.enteredStart;
      const first = runtime.shutdown("SIGTERM");
      expect(runtime.shutdown("SIGINT")).toBe(first);
      await first;
      expect(await starting).toBeInstanceOf(TerminalAdmissionDenied);
      expect(await runtime.completion).toEqual({ state: "STOPPED" });
      expect(f.events).toEqual([]);
      expect(f.child.start).toHaveBeenCalledOnce();
      expect(f.child.stop).toHaveBeenCalledOnce();
      expect(f.database.close).toHaveBeenCalledOnce();
      expect(f.logger.info).not.toHaveBeenCalledWith(
        { state: "ready" },
        "Worker ready",
      );
    },
  );

  it.each<Shape>(["direct", "composite", "nested"])(
    "%s keeps a genuine startup error during cancellation",
    async (shape) => {
      const original = new Error("synthetic startup failure");
      const f = fixture(shape, original);
      const runtime = createWorker(f.database, f.runner, f.logger);
      const starting = runtime.start().catch((cause: unknown) => cause);
      await f.enteredStart;
      await runtime.shutdown("SIGTERM");
      expect(await starting).toBe(original);
      expect(await runtime.completion).toMatchObject({
        state: "FAILED",
        code: "STARTUP_FAILED",
      });
      expect(f.child.stop).toHaveBeenCalledOnce();
      expect(f.database.close).toHaveBeenCalledOnce();
    },
  );

  it("an unexpected admission denial without shutdown remains a startup failure", async () => {
    const original = new TerminalAdmissionDenied();
    const f = fixture("nested");
    vi.mocked(f.child.start).mockRejectedValue(original);
    vi.mocked(f.child.quiesce).mockImplementation(() => undefined);
    const runtime = createWorker(f.database, f.runner, f.logger);
    await expect(runtime.start()).rejects.toBe(original);
    expect(await runtime.completion).toMatchObject({
      state: "FAILED",
      code: "STARTUP_FAILED",
    });
    expect(f.database.close).toHaveBeenCalledOnce();
  });

  it("a latched fatal cause is not erased by a later expected cancellation", async () => {
    const original = new Error("synthetic first failure");
    const f = fixture("nested");
    const runtime = createWorker(f.database, f.runner, f.logger);
    const starting = runtime.start().catch((cause: unknown) => cause);
    await f.enteredStart;
    f.failure.emit("SCHEDULED_OPERATION_FAILED", original);
    await runtime.shutdown("SIGTERM");
    expect(await starting).toBe(original);
    expect(await runtime.completion).toMatchObject({
      state: "FAILED",
      runner: "device-authorization-expiry",
      code: "SCHEDULED_OPERATION_FAILED",
    });
    expect(f.database.close).toHaveBeenCalledOnce();
  });

  it("a drain failure after normal cancellation is never reported as safely stopped", async () => {
    const f = fixture("nested");
    vi.mocked(f.child.stop).mockRejectedValue(
      new Error("synthetic unproven drain"),
    );
    const runtime = createWorker(f.database, f.runner, f.logger);
    const starting = runtime.start().catch((cause: unknown) => cause);
    await f.enteredStart;
    await runtime.shutdown("SIGTERM");
    await starting;
    expect(await runtime.completion).toMatchObject({
      state: "CLEANUP_INCOMPLETE",
    });
    expect(f.database.close).not.toHaveBeenCalled();
    expect(f.child.stop).toHaveBeenCalledOnce();
  });
});

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(sourceRoot, "../../..");
const actualMain = readFileSync(resolve(sourceRoot, "main.ts"), "utf8");
const entryMarker = "const runtime = createWorker(";
const entryStart = actualMain.indexOf(entryMarker);
if (entryStart < 0 || actualMain.indexOf(entryMarker, entryStart + 1) >= 0) {
  throw new Error("WORKER_MAIN_ENTRY_EXTRACTION_AMBIGUOUS");
}
const actualEntry = actualMain.slice(entryStart);
const moduleUrl = (name: string) =>
  JSON.stringify(pathToFileURL(resolve(sourceRoot, name)).href);

// Execute the actual main.ts entry tail with synthetic ports, not a hand-written
// copy of its exit handling. No configuration, real DB or SMTP is loaded.
describe("actual main entry with native SIGTERM during startup", () => {
  it.each([
    {
      stage: "child",
      mode: "cancel",
      expectedState: "STOPPED",
      expectedExit: 0,
      closed: 1,
    },
    {
      stage: "database",
      mode: "cancel",
      expectedState: "STOPPED",
      expectedExit: 0,
      closed: 1,
    },
    {
      stage: "child",
      mode: "genuine",
      expectedState: "FAILED",
      expectedExit: 1,
      closed: 1,
    },
    {
      stage: "child",
      mode: "drain-failure",
      expectedState: "CLEANUP_INCOMPLETE",
      expectedExit: 1,
      closed: 0,
    },
  ])(
    "$stage / $mode keeps the truthful process outcome",
    ({ stage, mode, expectedState, expectedExit, closed }) => {
      const program = `
import { createWorker } from ${moduleUrl("lifecycle.ts")};
import { CompositeJobRunner } from ${moduleUrl("composite-runner.ts")};
import { TerminalAdmissionDenied } from ${moduleUrl("job-failure.ts")};
const stage = ${JSON.stringify(stage)};
const mode = ${JSON.stringify(mode)};
const counts = { starts: 0, stops: 0, closed: 0, ready: 0, signals: 0, unhandled: 0, failureLogs: 0 };
let releaseReady, rejectStart;
const database = {
  ready: () => stage === "database" ? new Promise(resolve => {
    releaseReady = resolve;
    setImmediate(() => process.kill(process.pid, "SIGTERM"));
  }) : Promise.resolve(),
  close: async () => { counts.closed++; },
};
const runners = [{
  start: () => new Promise((_resolve, reject) => {
    counts.starts++; rejectStart = reject;
    setImmediate(() => process.kill(process.pid, "SIGTERM"));
  }),
  quiesce: () => { rejectStart?.(mode === "genuine" ? new Error("synthetic actual failure") : new TerminalAdmissionDenied()); },
  stop: async () => { counts.stops++; if (mode === "drain-failure") throw new Error("synthetic drain failure"); },
  onFailure: () => () => undefined,
}];
const logger = {
  info: data => { if (data.state === "ready") counts.ready++; },
  error: () => { counts.failureLogs++; },
};
process.on("unhandledRejection", () => { counts.unhandled++; });
${actualEntry}
process.once("SIGTERM", () => { counts.signals++; releaseReady?.(); });
// Keep this synthetic process alive until the OS signal and drain are observed.
const keepAlive = setInterval(() => undefined, 1000);
let observed;
runtime.completion.then(value => { observed = value.state; clearInterval(keepAlive); });
process.once("exit", code => console.log(JSON.stringify({ ...counts, state: observed, code })));
`;
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module"],
        {
          cwd: workspace,
          input: program,
          encoding: "utf8",
          timeout: 3000,
          maxBuffer: 32 * 1024,
          env: { ...process.env, TSX_DISABLE_CACHE: "1" },
        },
      );
      expect(child.error).toBeUndefined();
      expect(child.signal).toBeNull();
      expect(child.stderr).toBe("");
      expect(child.status).toBe(expectedExit);
      const observed = JSON.parse(child.stdout.trim());
      expect(observed).toMatchObject({
        state: expectedState,
        closed,
        ready: 0,
        signals: 1,
        unhandled: 0,
        code: expectedExit,
      });
      expect(observed.starts).toBe(stage === "database" ? 0 : 1);
      expect(observed.stops).toBe(stage === "database" ? 0 : 1);
      expect(observed.failureLogs).toBe(expectedExit === 0 ? 0 : 1);
    },
  );
});
