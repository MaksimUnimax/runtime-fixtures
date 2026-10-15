import { describe, expect, it, vi } from "vitest";
import {
  createWorker,
  startWorker,
  type JobRunner,
  type WorkerLogger,
} from "./lifecycle.js";
import { JobFailureSignal } from "./job-failure.js";
import type { DatabaseRuntime } from "@product/db";

function dependencies(): {
  database: DatabaseRuntime;
  runner: JobRunner;
  logger: WorkerLogger;
  events: string[];
} {
  const events: string[] = [];
  return {
    database: {
      db: {} as DatabaseRuntime["db"],
      ready: vi.fn(async () => {
        events.push("database.ready");
      }),
      close: vi.fn(async () => {
        events.push("database.close");
      }),
      query: vi.fn(),
      transaction: vi.fn(),
    },
    runner: {
      quiesce: vi.fn(),
      start: vi.fn(async () => {
        events.push("runner.start");
      }),
      stop: vi.fn(async () => {
        events.push("runner.stop");
      }),
      onFailure: vi.fn(() => () => undefined),
    },
    logger: {
      info: vi.fn((bindings: Record<string, unknown>) => {
        events.push(`log.${String(bindings.state ?? bindings.signal)}`);
      }),
    },
    events,
  };
}

describe("worker lifecycle", () => {
  it("checks database readiness before starting the job runner", async () => {
    const { database, runner, logger, events } = dependencies();
    await startWorker(database, runner, logger);
    expect(events).toEqual(["database.ready", "runner.start", "log.ready"]);
  });

  it("does not start the job runner and closes the database when readiness fails", async () => {
    const { database, runner, logger } = dependencies();
    const failure = new Error("database unavailable");
    vi.mocked(database.ready).mockRejectedValue(failure);
    await expect(startWorker(database, runner, logger)).rejects.toThrow(
      failure,
    );
    expect(runner.start).not.toHaveBeenCalled();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("stops the job runner before closing the database during shutdown", async () => {
    const { database, runner, logger, events } = dependencies();
    const runtime = await startWorker(database, runner, logger);
    await runtime.shutdown("SIGTERM");
    expect(events).toEqual([
      "database.ready",
      "runner.start",
      "log.ready",
      "log.SIGTERM",
      "runner.stop",
      "database.close",
    ]);
  });

  it("closes allocated database resources when job runner startup fails", async () => {
    const { database, runner, logger } = dependencies();
    const failure = new Error("runner unavailable");
    vi.mocked(runner.start).mockRejectedValue(failure);
    await expect(startWorker(database, runner, logger)).rejects.toThrow(
      failure,
    );
    expect(runner.stop).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("shares one shutdown promise and closes the database once", async () => {
    const { database, runner, logger } = dependencies();
    const runtime = createWorker(database, runner, logger);
    await runtime.start();
    const first = runtime.shutdown("SIGTERM");
    const second = runtime.shutdown("SIGINT");
    expect(second).toBe(first);
    await first;
    expect(database.close).toHaveBeenCalledOnce();
    expect(await runtime.completion).toEqual({ state: "STOPPED" });
  });

  it("waits for pending readiness and does not admit runner start after shutdown", async () => {
    const { database, runner, logger } = dependencies();
    let ready!: () => void;
    vi.mocked(database.ready).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const runtime = createWorker(database, runner, logger);
    const starting = runtime.start();
    await vi.waitFor(() => expect(typeof ready).toBe("function"));
    const stopping = runtime.shutdown("SIGTERM");
    const rejected = expect(starting).rejects.toThrow("WORKER_STOPPING");
    ready();
    await Promise.all([rejected, stopping]);
    expect(runner.start).not.toHaveBeenCalled();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("settles startup failure through raw barriers without waiting on its catch", async () => {
    const { database, runner, logger } = dependencies();
    const original = new Error("startup rejection");
    vi.mocked(runner.start).mockRejectedValue(original);
    const runtime = createWorker(database, runner, logger);
    await expect(runtime.start()).rejects.toBe(original);
    expect(await runtime.completion).toEqual({
      state: "FAILED",
      runner: "worker",
      code: "STARTUP_FAILED",
    });
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("does not close the database when runner drain is rejected", async () => {
    const { database, runner, logger } = dependencies();
    vi.mocked(runner.stop).mockRejectedValue(new Error("unsafe raw detail"));
    const runtime = createWorker(database, runner, logger);
    await runtime.start();
    await runtime.shutdown("SIGTERM");
    expect(database.close).not.toHaveBeenCalled();
    expect(await runtime.completion).toEqual({ state: "CLEANUP_INCOMPLETE" });
  });

  it("marks a close rejection cleanup incomplete", async () => {
    const { database, runner, logger } = dependencies();
    vi.mocked(database.close).mockRejectedValue(new Error("close detail"));
    const runtime = createWorker(database, runner, logger);
    await runtime.start();
    await runtime.shutdown("SIGTERM");
    expect(database.close).toHaveBeenCalledOnce();
    expect(await runtime.completion).toEqual({ state: "CLEANUP_INCOMPLETE" });
  });

  it("isolates throwing, rejecting, and never-settling logger notifications", async () => {
    const { database, runner } = dependencies();
    const logger: WorkerLogger = {
      info: vi.fn((bindings: Record<string, unknown>) => {
        if (bindings.state === "ready")
          throw new Error("private sync log detail");
        if (bindings.signal)
          return Promise.reject(new Error("private async log detail"));
        return new Promise<void>(() => undefined);
      }),
    };
    const runtime = createWorker(database, runner, logger);
    await runtime.start();
    await runtime.shutdown("SIGTERM");
    expect(await runtime.completion).toEqual({ state: "STOPPED" });
    expect(database.close).toHaveBeenCalledOnce();
    const second = dependencies();
    const pendingLogger: WorkerLogger = {
      info: () => new Promise<void>(() => undefined),
    };
    const pendingRuntime = createWorker(
      second.database,
      second.runner,
      pendingLogger,
    );
    await pendingRuntime.start();
    await pendingRuntime.shutdown("SIGTERM");
    expect(second.database.close).toHaveBeenCalledOnce();
  });

  it("preserves an undefined first failure cause while later requests share cleanup", async () => {
    const { database, logger } = dependencies();
    const signal = new JobFailureSignal("device-authorization-expiry");
    const runner: JobRunner = {
      quiesce: vi.fn(),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      onFailure: (listener) => signal.subscribe(listener),
    };
    const runtime = createWorker(database, runner, logger);
    await runtime.start();
    signal.emit("SCHEDULED_OPERATION_FAILED", undefined);
    const shutdown = runtime.shutdown("SIGTERM");
    await shutdown;
    expect(await runtime.completion).toEqual({
      state: "FAILED",
      runner: "device-authorization-expiry",
      code: "SCHEDULED_OPERATION_FAILED",
    });
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("does not publish ready when a fatal arrives during runner startup", async () => {
    const { database, logger } = dependencies();
    const signal = new JobFailureSignal("device-authorization-expiry");
    let releaseStart!: () => void;
    const runner: JobRunner = {
      quiesce: vi.fn(),
      start: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseStart = resolve;
          }),
      ),
      stop: vi.fn(async () => undefined),
      onFailure: (listener) => signal.subscribe(listener),
    };
    const runtime = createWorker(database, runner, logger);
    const starting = runtime.start();
    await vi.waitFor(() => expect(typeof releaseStart).toBe("function"));
    const cause = new Error("private failure");
    const rejected = expect(starting).rejects.toBe(cause);
    signal.emit("SCHEDULED_OPERATION_FAILED", cause);
    releaseStart();
    await rejected;
    await runtime.completion;
    expect(logger.info).not.toHaveBeenCalledWith(
      { state: "ready" },
      "Worker ready",
    );
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("lets fatal, signals and startup rejection share one drain while preserving the first cause", async () => {
    const { database, logger } = dependencies();
    const signal = new JobFailureSignal("otp-email");
    let rejectStart!: (cause: unknown) => void;
    const startupCause = new Error("later startup cause");
    const runner: JobRunner = {
      quiesce: vi.fn(),
      start: vi.fn(
        () =>
          new Promise<void>((_, reject) => {
            rejectStart = reject;
          }),
      ),
      stop: vi.fn(async () => undefined),
      onFailure: (listener) => signal.subscribe(listener),
    };
    const runtime = createWorker(database, runner, logger);
    const starting = runtime.start();
    await vi.waitFor(() => expect(typeof rejectStart).toBe("function"));
    signal.emit("SCHEDULED_OPERATION_FAILED", undefined);
    const shutdown = runtime.shutdown("SIGTERM");
    rejectStart(startupCause);
    await expect(starting).rejects.toBeUndefined();
    await shutdown;
    expect(runner.stop).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
    expect(await runtime.completion).toEqual({
      state: "FAILED",
      runner: "otp-email",
      code: "SCHEDULED_OPERATION_FAILED",
    });
  });
});
