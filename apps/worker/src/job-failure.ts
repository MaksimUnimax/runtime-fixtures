export type RunnerId =
  | "otp-email"
  | "device-authorization-expiry"
  | "subscription-lifecycle"
  | "billing-reconciliation"
  | "health-notification"
  | "feedback-retention"
  | "audit-retention"
  | "composite"
  | "worker";

export type JobFailureCode =
  | "SCHEDULED_OPERATION_FAILED"
  | "STARTUP_FAILED"
  | "SHUTDOWN_FAILED"
  | "NOTIFICATION_FAILED";

export interface JobFailureEvent {
  readonly runner: RunnerId;
  readonly code: JobFailureCode;
}

export type JobFailureListener = (
  event: JobFailureEvent,
) => void | Promise<void>;

const causes = new WeakMap<JobFailureSignal, unknown>();
const eventCauses = new WeakMap<JobFailureEvent, unknown>();

export function jobFailureCause(event: JobFailureEvent): unknown {
  return eventCauses.get(event);
}

export function latchedJobFailureCause(signal: JobFailureSignal): unknown {
  return causes.get(signal);
}

/** Fixed, safe event metadata with a private first-cause latch. */
export class JobFailureSignal {
  private readonly listeners = new Set<JobFailureListener>();
  private readonly delivered = new WeakSet<JobFailureListener>();
  private latchedEvent: JobFailureEvent | undefined;

  public constructor(private readonly runner: RunnerId) {}

  public get failed(): boolean {
    return this.latchedEvent !== undefined;
  }

  public subscribe(listener: JobFailureListener): () => void {
    if (this.latchedEvent) {
      this.deliver(listener, this.latchedEvent);
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public emit(code: JobFailureCode, cause: unknown): boolean {
    return this.latch(Object.freeze({ runner: this.runner, code }), cause);
  }

  public forward(event: JobFailureEvent): boolean {
    return this.latch(
      Object.freeze({ runner: event.runner, code: event.code }),
      jobFailureCause(event),
    );
  }

  private latch(event: JobFailureEvent, cause: unknown): boolean {
    if (this.latchedEvent) return false;
    causes.set(this, cause);
    eventCauses.set(event, cause);
    this.latchedEvent = event;
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) this.deliver(listener, event);
    return true;
  }

  private deliver(listener: JobFailureListener, event: JobFailureEvent): void {
    if (this.delivered.has(listener)) return;
    this.delivered.add(listener);
    safelyNotify(listener, event);
  }
}

export function safelyNotify(
  listener: (event: JobFailureEvent) => void | Promise<void>,
  event: JobFailureEvent,
): void {
  try {
    const result = listener(event);
    if (result && typeof (result as Promise<void>).then === "function") {
      void Promise.resolve(result).catch(() => undefined);
    }
  } catch {
    // Reporting must never block shutdown or replace the original failure.
  }
}

export class TerminalAdmissionDenied extends Error {
  public constructor() {
    super("WORKER_STOPPING");
    this.name = "TerminalAdmissionDenied";
  }
}

/** Synchronous admission latch, full-operation drain, timer cleanup and failure latch. */
export class RunnerControl {
  private terminal = false;
  private readonly inFlight = new Set<Promise<unknown>>();
  public readonly failure: JobFailureSignal;

  public constructor(runner: RunnerId) {
    this.failure = new JobFailureSignal(runner);
  }

  public get quiesced(): boolean {
    return this.terminal;
  }

  public ensureOpen(): void {
    if (this.terminal) throw new TerminalAdmissionDenied();
  }

  public admit<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.terminal) return Promise.reject(new TerminalAdmissionDenied());
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (cause: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.inFlight.add(result);
    void result
      .finally(() => this.inFlight.delete(result))
      .catch(() => undefined);
    try {
      Promise.resolve(operation()).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    return result;
  }

  public quiesce(clearTimer?: () => void): void {
    this.terminal = true;
    try {
      clearTimer?.();
    } catch {
      // The admission latch is terminal even if timer cleanup throws.
    }
  }

  public async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  public scheduledFailure(cause: unknown): void {
    if (cause instanceof TerminalAdmissionDenied) return;
    this.quiesce();
    this.failure.emit("SCHEDULED_OPERATION_FAILED", cause);
  }
}
