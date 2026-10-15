import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createApiCleanup } from "./api-cleanup.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Runs the actual current main.ts startup/shutdown tail against controlled I/O. */
function mainTail() {
  const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  const marker = "let closing = false;";
  const at = source.indexOf(marker);
  if (at < 0 || at !== source.lastIndexOf(marker))
    throw new Error("MAIN_LIFECYCLE_BOUNDARY_DRIFT");
  const output = transpileModule(source.slice(at), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  const admission = deferred(),
    close = deferred();
  const handlers = new Map<string, () => void>();
  const app = {
    close: vi.fn(() => close.promise),
    listen: vi.fn(async () => {}),
    log: { info: vi.fn(), error: vi.fn() },
  };
  const database = { close: vi.fn(async () => {}) };
  const transferAdmission = {
    start: vi.fn(() => admission.promise),
    stop: vi.fn(),
  };
  const transferService = { stop: vi.fn() };
  const process = {
    exitCode: 0,
    once: (name: string, callback: () => void) => {
      handlers.set(name, callback);
    },
  };
  const startup = runInNewContext(
    `(async () => { ${output} })()`,
    {
      app,
      database,
      transferAdmission,
      transferService,
      config: { apiPort: 0 },
      process,
      createApiCleanup,
    },
    { timeout: 1_000 },
  ) as Promise<void>;
  const outcome = startup.then(
    () => ({ error: undefined }),
    (error: unknown) => ({ error }),
  );
  return {
    app,
    database,
    transferAdmission,
    transferService,
    process,
    handlers,
    admission,
    close,
    outcome,
  };
}

describe("API main startup/signal resource cleanup", () => {
  it("pending admission plus SIGTERM closes each resource once", async () => {
    const x = mainTail();
    const stopped = new Error("ADMISSION_STOPPED");
    x.handlers.get("SIGTERM")!();
    expect(x.transferService.stop).toHaveBeenCalled();
    x.admission.reject(stopped);
    // Both the signal and the actual startup catch have entered before close ends.
    await new Promise<void>((resolve) => setImmediate(resolve));
    x.close.resolve();
    expect((await x.outcome).error).toBe(stopped);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(x.app.close).toHaveBeenCalledTimes(1);
    expect(x.database.close).toHaveBeenCalledTimes(1);
    expect(x.app.listen).not.toHaveBeenCalled();
  });
  it("a late successful admission cannot listen after a stop request", async () => {
    const x = mainTail();
    x.handlers.get("SIGTERM")!();
    x.admission.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    x.close.resolve();
    await x.outcome;
    expect(x.app.listen).not.toHaveBeenCalled();
    expect(x.app.close).toHaveBeenCalledTimes(1);
    expect(x.database.close).toHaveBeenCalledTimes(1);
  });
  it("two termination signals do not duplicate cleanup", async () => {
    const x = mainTail();
    x.admission.resolve();
    expect((await x.outcome).error).toBeUndefined();
    x.handlers.get("SIGINT")!();
    expect(x.transferService.stop).toHaveBeenCalled();
    x.handlers.get("SIGTERM")!();
    x.close.resolve();
    await vi.waitFor(() => expect(x.database.close).toHaveBeenCalledTimes(1));
    expect(x.app.close).toHaveBeenCalledTimes(1);
  });
  it("a signal cleanup rejection is observed and marks failure", async () => {
    const x = mainTail();
    x.admission.resolve();
    await x.outcome;
    x.handlers.get("SIGTERM")!();
    x.close.reject(new Error("CLOSE_FAILED"));
    await vi.waitFor(() => expect(x.process.exitCode).toBe(1));
    expect(x.database.close).toHaveBeenCalledTimes(1);
    expect(x.app.log.error).toHaveBeenCalledTimes(1);
  });
});

describe("coalesced API cleanup primitive", () => {
  it("shares the in-flight promise and closes database despite application failure", async () => {
    const failure = new Error("APP_CLOSE_FAILED");
    const stop = vi.fn();
    const app = vi.fn(async () => {
      throw failure;
    });
    const db = vi.fn(async () => {});
    const close = createApiCleanup(stop, app, db);
    const first = close();
    expect(close()).toBe(first);
    await expect(first).rejects.toBe(failure);
    await expect(close()).rejects.toBe(failure);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(app).toHaveBeenCalledTimes(1);
    expect(db).toHaveBeenCalledTimes(1);
  });
  it("retains both close failures without an automatic retry", async () => {
    const appError = new Error("APP"),
      dbError = new Error("DB");
    const app = vi.fn(async () => {
      throw appError;
    });
    const db = vi.fn(async () => {
      throw dbError;
    });
    const close = createApiCleanup(() => {}, app, db);
    const error = await close().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([appError, dbError]);
    await expect(close()).rejects.toBe(error);
    expect(app).toHaveBeenCalledTimes(1);
    expect(db).toHaveBeenCalledTimes(1);
  });
});
