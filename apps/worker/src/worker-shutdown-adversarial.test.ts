import { describe, expect, it, vi } from "vitest";
import { createWorker, type JobRunner } from "./lifecycle.js";
import { CompositeJobRunner } from "./composite-runner.js";
import { NoopJobRunner } from "./noop-runner.js";
import { DeviceAuthorizationExpiryRunner } from "./device-authorization-expiry-runner.js";
import {
  JobFailureSignal,
  RunnerControl,
  TerminalAdmissionDenied,
} from "./job-failure.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function dependencies() {
  const signal = new JobFailureSignal("otp-email");
  const runner: JobRunner = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    quiesce: vi.fn(),
    onFailure: (listener) => signal.subscribe(listener),
  };
  const database = {
    ready: vi.fn(async () => undefined),
    close: vi.fn(async (): Promise<void> => undefined),
  };
  return { signal, runner, database, logger: { info: vi.fn() } };
}

describe("parent-reviewed shutdown adversarial boundaries", () => {
  it("registers work before synchronous repository reentry can start draining", async () => {
    const control = new RunnerControl("otp-email");
    const pending = deferred<number>();
    let drained = false;
    let draining!: Promise<void>;
    const work = control.admit(() => {
      control.quiesce();
      draining = control.drain().then(() => {
        drained = true;
      });
      return pending.promise;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(drained).toBe(false);
    pending.resolve(7);
    expect(await work).toBe(7);
    await draining;
    expect(drained).toBe(true);
  });

  it("logger reentry observes the original shutdown promise and one close", async () => {
    const { runner, database } = dependencies();
    let recursive: Promise<void> | undefined;
    const runtime = createWorker(database, runner, {
      info: (bindings) => {
        if (bindings.signal) recursive = runtime.shutdown("SIGINT");
      },
    });
    await runtime.start();
    const stopped = runtime.shutdown("SIGTERM");
    expect(recursive).toBe(stopped);
    await stopped;
    expect(runner.stop).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("retains the original startup cause when composite cleanup also fails", async () => {
    const { runner, database, logger } = dependencies();
    const original = new Error("synthetic original startup");
    vi.mocked(runner.start).mockRejectedValue(original);
    vi.mocked(runner.stop).mockRejectedValue(
      new Error("synthetic later cleanup"),
    );
    const runtime = createWorker(
      database,
      new CompositeJobRunner([runner]),
      logger,
    );
    await expect(runtime.start()).rejects.toBe(original);
    expect(await runtime.completion).toMatchObject({
      state: "CLEANUP_INCOMPLETE",
      code: "STARTUP_FAILED",
    });
    expect(database.close).not.toHaveBeenCalled();
    expect(runner.stop).toHaveBeenCalledOnce();
  });

  it("a fatal already latched at subscription prevents startup and is not lost", async () => {
    const { runner, database, signal, logger } = dependencies();
    signal.emit("SCHEDULED_OPERATION_FAILED", undefined);
    const runtime = createWorker(database, runner, logger);
    await expect(runtime.start()).rejects.toBeUndefined();
    expect(await runtime.completion).toMatchObject({
      state: "FAILED",
      code: "SCHEDULED_OPERATION_FAILED",
    });
    expect(runner.start).not.toHaveBeenCalled();
    expect(database.ready).not.toHaveBeenCalled();
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("successful defensive stop proves drain after an unexpected quiesce throw", async () => {
    const { runner, database, logger } = dependencies();
    vi.mocked(runner.quiesce).mockImplementation(() => {
      throw new Error("synthetic quiesce");
    });
    const runtime = createWorker(database, runner, logger);
    await runtime.start();
    await runtime.shutdown("SIGTERM");
    expect(runner.stop).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
    expect(await runtime.completion).toMatchObject({
      state: "FAILED",
      code: "SHUTDOWN_FAILED",
    });
  });

  it("does not claim a hanging admitted start drained or close its database", async () => {
    const { runner, database, logger } = dependencies();
    const entered = deferred<void>();
    const pending = deferred<void>();
    vi.mocked(runner.start).mockImplementation(() => {
      entered.resolve();
      return pending.promise;
    });
    const runtime = createWorker(database, runner, logger);
    const starting = runtime.start();
    const rejected = expect(starting).rejects.toBeInstanceOf(
      TerminalAdmissionDenied,
    );
    await entered.promise;
    let completed = false;
    void runtime.completion.then(() => {
      completed = true;
    });
    const stopping = runtime.shutdown("SIGTERM");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(completed).toBe(false);
    expect(database.close).not.toHaveBeenCalled();
    pending.resolve();
    await rejected;
    await stopping;
    expect(database.close).toHaveBeenCalledOnce();
  });

  it("Noop is terminal too, rather than an optional no-op admission guard", async () => {
    const runner = new NoopJobRunner();
    await runner.start();
    runner.quiesce();
    await expect(runner.start()).rejects.toBeInstanceOf(
      TerminalAdmissionDenied,
    );
    await runner.stop();
    await runner.stop();
  });

  it("an already-queued interval callback after quiesce cannot admit work or a new fatal", async () => {
    vi.useFakeTimers();
    const originalInterval = globalThis.setInterval;
    let callback: (() => void) | undefined;
    const intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation((handler, delay) => {
        callback = () => {
          handler();
        };
        return originalInterval(handler, delay);
      });
    const expireDue = vi.fn(async () => 0);
    const runner = new DeviceAuthorizationExpiryRunner({ expireDue }, 10);
    const failure = vi.fn();
    runner.onFailure(failure);
    try {
      await runner.start();
      runner.quiesce();
      callback?.();
      await Promise.resolve();
      expect(expireDue).toHaveBeenCalledOnce();
      expect(failure).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await runner.stop();
      intervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });
  it("forwards the original leaf identity through nested composites", async () => {
    const { runner, database, signal, logger } = dependencies();
    const runtime = createWorker(
      database,
      new CompositeJobRunner([new CompositeJobRunner([runner])]),
      logger,
    );
    await runtime.start();
    signal.emit("SCHEDULED_OPERATION_FAILED", new Error("synthetic failure"));
    expect(await runtime.completion).toEqual({
      state: "FAILED",
      runner: "otp-email",
      code: "SCHEDULED_OPERATION_FAILED",
    });
    expect(database.close).toHaveBeenCalledOnce();
  });
  it("does not reuse successful startup after the runtime has stopped", async () => {
    const { runner, database, logger } = dependencies();
    const runtime = createWorker(database, runner, logger);
    await runtime.start();
    await runtime.shutdown("SIGTERM");
    await expect(runtime.start()).rejects.toBeInstanceOf(
      TerminalAdmissionDenied,
    );
    expect(runner.start).toHaveBeenCalledOnce();
    expect(database.ready).toHaveBeenCalledOnce();
    expect(database.close).toHaveBeenCalledOnce();
  });
  it("prelatched fatal startup rejects with the original cause only after shared close", async () => {
    const { runner, database, signal, logger } = dependencies();
    const enteredClose = deferred<void>();
    const close = deferred<void>();
    const cause = new Error("synthetic prelatched cause");
    vi.mocked(database.close).mockImplementation(() => {
      enteredClose.resolve();
      return close.promise;
    });
    signal.emit("SCHEDULED_OPERATION_FAILED", cause);
    const runtime = createWorker(database, runner, logger);
    let rejected = false;
    const starting = runtime.start().then(
      () => undefined,
      (error: unknown) => {
        rejected = true;
        return error;
      },
    );
    await enteredClose.promise;
    try {
      expect(rejected).toBe(false);
    } finally {
      close.resolve();
    }
    expect(await starting).toBe(cause);
    expect(await runtime.completion).toMatchObject({ state: "FAILED" });
    expect(database.close).toHaveBeenCalledOnce();
    expect(runner.start).not.toHaveBeenCalled();
  });
});
