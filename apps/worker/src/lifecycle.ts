import type { DatabaseRuntime } from "@product/db";
import {
  JobFailureSignal,
  TerminalAdmissionDenied,
  jobFailureCause,
  latchedJobFailureCause,
  type JobFailureEvent,
} from "./job-failure.js";

export interface JobRunner {
  quiesce(): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  onFailure(
    listener: (event: JobFailureEvent) => void | Promise<void>,
  ): () => void;
}

export interface WorkerLogger {
  info(
    bindings: Record<string, unknown>,
    message: string,
  ): void | Promise<void>;
}

export type WorkerDatabase = Pick<DatabaseRuntime, "ready" | "close">;

export type WorkerOutcome = {
  readonly state: "STOPPED" | "FAILED" | "CLEANUP_INCOMPLETE";
  readonly runner?: JobFailureEvent["runner"];
  readonly code?: JobFailureEvent["code"];
};

export interface WorkerRuntime {
  start(): Promise<void>;
  shutdown(signal: string): Promise<void>;
  readonly completion: Promise<WorkerOutcome>;
}

const SAFE_SIGNALS = new Set(["SIGINT", "SIGTERM"]);

export function createWorker(
  database: WorkerDatabase,
  runner: JobRunner,
  logger: WorkerLogger,
): WorkerRuntime {
  const failure = new JobFailureSignal("worker");
  let closing = false;
  let originalCause: unknown;
  let hasOriginalCause = false;
  let firstEvent: JobFailureEvent | undefined;
  let rawReady: Promise<void> | undefined;
  let rawStart: Promise<void> | undefined;
  let startupPromise: Promise<void> | undefined;
  let terminalStartPromise: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;
  let closeAttempted = false;
  let cleanupIncomplete = false;
  let resolveCompletion!: (outcome: WorkerOutcome) => void;
  const completion = new Promise<WorkerOutcome>((resolve) => {
    resolveCompletion = resolve;
  });

  const rememberCause = (cause: unknown, event?: JobFailureEvent) => {
    if (!hasOriginalCause) {
      hasOriginalCause = true;
      originalCause = cause;
      firstEvent = event;
    }
  };
  const safeInfo = (bindings: Record<string, unknown>, message: string) => {
    try {
      const result = logger.info(bindings, message);
      if (result && typeof (result as Promise<void>).then === "function")
        void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Optional logging cannot alter lifecycle state.
    }
  };

  const beginShutdown = (signal?: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    let resolveShutdown!: () => void;
    shutdownPromise = new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    });
    try {
      runner.quiesce();
    } catch (cause) {
      // A later successful defensive stop can still prove safe drain.
      rememberCause(cause, { runner: "worker", code: "SHUTDOWN_FAILED" });
    }
    if (signal && SAFE_SIGNALS.has(signal))
      safeInfo({ signal }, "Worker shutdown requested");
    void (async () => {
      if (rawReady) await Promise.allSettled([rawReady]);
      if (rawStart) await Promise.allSettled([rawStart]);
      try {
        await runner.stop();
      } catch {
        cleanupIncomplete = true;
      }
      if (!cleanupIncomplete && !closeAttempted) {
        closeAttempted = true;
        try {
          await database.close();
        } catch {
          cleanupIncomplete = true;
        }
      }
      const state: WorkerOutcome["state"] = cleanupIncomplete
        ? "CLEANUP_INCOMPLETE"
        : hasOriginalCause
          ? "FAILED"
          : "STOPPED";
      resolveCompletion({
        state,
        ...(firstEvent
          ? { runner: firstEvent.runner, code: firstEvent.code }
          : {}),
      });
    })().then(resolveShutdown, () => {
      cleanupIncomplete = true;
      resolveCompletion({ state: "CLEANUP_INCOMPLETE" });
      resolveShutdown();
    });
    return shutdownPromise;
  };

  failure.subscribe((event) => {
    if (failure.failed) rememberCause(latchedJobFailureCause(failure), event);
    void beginShutdown();
  });
  runner.onFailure((event) => {
    rememberCause(jobFailureCause(event), event);
    failure.emit(event.code, hasOriginalCause ? originalCause : undefined);
  });

  const start = (): Promise<void> => {
    if (closing) {
      terminalStartPromise ??= beginShutdown().then(() => {
        throw hasOriginalCause ? originalCause : new TerminalAdmissionDenied();
      });
      return terminalStartPromise;
    }
    if (startupPromise) return startupPromise;
    rawReady = Promise.resolve().then(() => database.ready());
    startupPromise = (async () => {
      try {
        await rawReady;
        if (closing) {
          await beginShutdown();
          throw hasOriginalCause
            ? originalCause
            : new TerminalAdmissionDenied();
        }
        rawStart = Promise.resolve().then(() => {
          if (closing) return;
          return runner.start();
        });
        await rawStart;
        if (closing || failure.failed) {
          await beginShutdown();
          throw hasOriginalCause
            ? originalCause
            : new TerminalAdmissionDenied();
        }
        safeInfo({ state: "ready" }, "Worker ready");
      } catch (cause) {
        if (
          !(
            cause instanceof TerminalAdmissionDenied &&
            closing &&
            !hasOriginalCause
          )
        ) {
          rememberCause(cause, { runner: "worker", code: "STARTUP_FAILED" });
          failure.emit("STARTUP_FAILED", cause);
        }
        await beginShutdown();
        throw hasOriginalCause ? originalCause : cause;
      }
    })();
    return startupPromise;
  };

  const shutdown = (signal: string): Promise<void> => beginShutdown(signal);
  return { start, shutdown, completion };
}

/** Compatible convenience factory used by existing callers and tests. */
export async function startWorker(
  database: WorkerDatabase,
  runner: JobRunner,
  logger: WorkerLogger,
): Promise<WorkerRuntime> {
  const runtime = createWorker(database, runner, logger);
  await runtime.start();
  return runtime;
}
