import {
  safeMonitoringResult,
  type MonitoringClock,
  type MonitoringLane,
  type MonitoringLaneRunner,
  type MonitoringLaneState,
  type MonitoringNotifier,
  type MonitoringRun,
  type MonitoringRunResult,
} from "./contracts.js";
import { MONITORING_LANES, type MonitoringScheduleStore } from "./store.js";
import {
  withMonitoringRun,
  isMonitoringEffectOutcomeUnknown,
  type MonitoringRunAuthority,
} from "./run-authority.js";

export type MonitoringRunAcknowledgement =
  | {
      kind: "STARTED";
      lane: MonitoringLane;
      runId: string;
      source: "SCHEDULED" | "FORCED";
    }
  | { kind: "ALREADY_RUNNING"; lane: MonitoringLane; runId: string }
  | { kind: "NOT_DUE"; lane: MonitoringLane };

export type IndependentMonitoringSchedulerOptions = {
  store: MonitoringScheduleStore;
  runners: Record<MonitoringLane, MonitoringLaneRunner>;
  clock?: MonitoringClock;
  leaseMs?: number;
  tickMs?: number;
  notifier?: MonitoringNotifier;
  notificationRetryDelaysMs?: readonly number[];
  onError?: (event: {
    code: "MONITORING_BACKGROUND_FAILED";
    lane?: MonitoringLane;
  }) => void | Promise<void>;
};

export class IndependentMonitoringScheduler {
  private readonly clock: MonitoringClock;
  private readonly leaseMs: number;
  private readonly tickMs: number;
  private readonly active = new Map<string, Promise<void>>();
  private readonly executions = new Map<
    string,
    { run: MonitoringRun; controller: AbortController }
  >();
  private timer: ReturnType<typeof setInterval> | undefined;
  private starting: Promise<void> | undefined;
  private lifecycle = 0;

  public constructor(
    private readonly options: IndependentMonitoringSchedulerOptions,
  ) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.leaseMs = options.leaseMs ?? 15 * 60 * 1000;
    this.tickMs = options.tickMs ?? 1_000;
  }

  start(): Promise<void> {
    if (this.timer) return Promise.resolve();
    if (this.starting) return this.starting;
    const lifecycle = ++this.lifecycle;
    const pending = (async () => {
      try {
        await this.options.store.ensureDefaults(this.clock.now());
        this.assertLifecycle(lifecycle);
        // A rejected initial tick must propagate without leaving periodic work.
        await this.tickForLifecycle(lifecycle);
        this.assertLifecycle(lifecycle);
        this.timer = setInterval(() => {
          void this.tickForLifecycle(lifecycle).catch(() =>
            this.reportBackgroundFailure(),
          );
        }, this.tickMs);
      } catch (error) {
        // Other lanes can still be awaiting their store reservation when one
        // lane rejects. They must release, rather than dispatch after failure.
        if (lifecycle === this.lifecycle) ++this.lifecycle;
        throw error;
      }
    })();
    this.starting = pending;
    const clearStarting = () => {
      if (this.starting === pending) this.starting = undefined;
    };
    void pending.then(clearStarting, clearStarting);
    return pending;
  }

  async stop(): Promise<void> {
    ++this.lifecycle;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.starting = undefined;
    // stop cancels not-yet-accepted work. It does not wait forever for an
    // uncooperative transport, nor claim to undo an already started effect.
    const executions = [...this.executions.values()];
    for (const { controller } of executions) controller.abort();
    await Promise.all(
      executions.map(({ run }) =>
        this.options.store.cancelRun({
          lane: run.lane,
          runId: run.runId,
          now: this.clock.now(),
        }),
      ),
    );
  }

  async status(lane: MonitoringLane): Promise<MonitoringLaneState> {
    return this.options.store.getState(lane);
  }

  async setInterval(
    lane: MonitoringLane,
    intervalSeconds: number,
  ): Promise<MonitoringLaneState> {
    return this.options.store.setInterval(
      lane,
      intervalSeconds,
      this.clock.now(),
    );
  }

  async scheduleEarlier(
    lane: MonitoringLane,
    retryAt: Date,
  ): Promise<MonitoringLaneState> {
    return this.options.store.scheduleEarlier(lane, retryAt, this.clock.now());
  }

  async runNow(lane: MonitoringLane): Promise<MonitoringRunAcknowledgement> {
    return this.begin(lane, "FORCED", this.lifecycle);
  }

  async runNowAndWait(lane: MonitoringLane): Promise<MonitoringRunResult> {
    const acknowledgement = await this.runNow(lane);
    if (acknowledgement.kind !== "STARTED") {
      throw new Error(
        acknowledgement.kind === "ALREADY_RUNNING"
          ? "ALREADY_RUNNING"
          : "MONITORING_NOT_STARTED",
      );
    }
    await this.active.get(acknowledgement.runId);
    const state = await this.status(lane);
    if (!state.lastResult || state.lastResult.runId !== acknowledgement.runId)
      throw new Error("MONITORING_RESULT_NOT_PERSISTED");
    return state.lastResult;
  }

  async tick(): Promise<void> {
    await this.tickForLifecycle(this.lifecycle);
  }

  private assertLifecycle(lifecycle: number): void {
    if (lifecycle !== this.lifecycle)
      throw new Error("MONITORING_START_STOPPED");
  }

  private async tickForLifecycle(lifecycle: number): Promise<void> {
    this.assertLifecycle(lifecycle);
    await Promise.all(
      MONITORING_LANES.map(async (lane) => {
        const acknowledgement = await this.begin(lane, "SCHEDULED", lifecycle);
        if (acknowledgement.kind === "STARTED")
          await this.active.get(acknowledgement.runId);
      }),
    );
  }

  private async begin(
    lane: MonitoringLane,
    source: "SCHEDULED" | "FORCED",
    lifecycle: number,
  ): Promise<MonitoringRunAcknowledgement> {
    this.assertLifecycle(lifecycle);
    const reservationRequestedMonotonicMs = performance.now();
    const result = await this.options.store.startRun({
      lane,
      source,
      now: this.clock.now(),
      leaseMs: this.leaseMs,
    });
    // Responses without a new reservation have no effect to cancel. Let them
    // settle without masking a different lane's actual cancellation write error.
    if (result.kind === "NOT_DUE") return { kind: "NOT_DUE", lane };
    if (result.kind === "ALREADY_RUNNING")
      return { kind: "ALREADY_RUNNING", lane, runId: result.runId };
    if (lifecycle !== this.lifecycle) {
      if (result.kind === "STARTED") {
        try {
          await this.options.store.releaseUnstartedRun({
            lane,
            runId: result.run.runId,
            now: this.clock.now(),
          });
        } catch (error) {
          // Keep the lease and original storage failure visible; never dispatch
          // or fabricate a monitoring result when cancellation is uncertain.
          this.reportBackgroundFailure(lane);
          throw error;
        }
      }
      throw new Error("MONITORING_START_STOPPED");
    }
    // Legacy stores can omit the process-local hint. Their conservative
    // fallback consumes request latency but never compares DB and local dates.
    const cancellationDeadlineMonotonicMs =
      result.cancellationDeadlineMonotonicMs ??
      reservationRequestedMonotonicMs +
        Math.max(
          0,
          result.run.leaseExpiresAt.valueOf() - result.run.startedAt.valueOf(),
        );
    const work = this.execute(result.run, cancellationDeadlineMonotonicMs);
    this.active.set(result.run.runId, work);
    // Handle both branches without creating an unobserved rejected finally promise.
    // The original promise remains rejected for callers waiting on this run.
    void work.then(
      () => this.active.delete(result.run.runId),
      () => {
        this.active.delete(result.run.runId);
        this.reportBackgroundFailure(lane);
      },
    );
    return { kind: "STARTED", lane, runId: result.run.runId, source };
  }

  private reportBackgroundFailure(lane?: MonitoringLane): void {
    try {
      void Promise.resolve(
        this.options.onError?.({ code: "MONITORING_BACKGROUND_FAILED", lane }),
      ).catch(() => {
        // An asynchronous diagnostic failure is contained too.
      });
    } catch {
      // Diagnostic callbacks must not recreate an unhandled rejection.
    }
  }

  private async execute(
    run: MonitoringRun,
    cancellationDeadlineMonotonicMs: number,
  ): Promise<void> {
    const controller = new AbortController();
    this.executions.set(run.runId, { run, controller });
    const deadline = setTimeout(
      () => controller.abort(),
      Math.max(0, cancellationDeadlineMonotonicMs - performance.now()),
    );
    deadline.unref?.();
    const authority: MonitoringRunAuthority = {
      lane: run.lane,
      runId: run.runId,
      signal: controller.signal,
      revoke: () => controller.abort(),
      assertCurrent: async () => {
        try {
          await this.options.store.withRunLease(
            authority,
            this.clock.now(),
            async () => undefined,
          );
        } catch (error) {
          controller.abort();
          throw error;
        }
      },
      assertCurrentSync: () => {
        if (controller.signal.aborted)
          throw new Error("MONITORING_RUN_CANCELLED");
        if (!this.options.store.assertRunCurrentSync)
          throw new Error("MONITORING_MEMORY_FENCE_UNAVAILABLE");
        try {
          this.options.store.assertRunCurrentSync(run, this.clock.now());
        } catch (error) {
          controller.abort();
          throw error;
        }
      },
      withCurrent: (operation) =>
        this.options.store.withRunLease(authority, this.clock.now(), operation),
    };
    try {
      await withMonitoringRun(authority, () =>
        this.executeOwned(run, controller, deadline, authority),
      );
    } finally {
      clearTimeout(deadline);
      this.executions.delete(run.runId);
    }
  }

  private async executeOwned(
    run: MonitoringRun,
    controller: AbortController,
    deadline: ReturnType<typeof setTimeout>,
    authority: MonitoringRunAuthority,
  ): Promise<void> {
    let result: MonitoringRunResult;
    try {
      const runner = this.options.runners[run.lane];
      if (!runner) throw new Error("MONITORING_RUNNER_NOT_CONFIGURED");
      if (this.options.store.assertRunCurrentSync)
        authority.assertCurrentSync();
      else await authority.assertCurrent();
      result = safeMonitoringResult(
        await runner({ ...run, signal: controller.signal, authority }),
      );
    } catch {
      result = {
        status: "FAILED",
        code: "MONITORING_EXECUTION_FAILED",
        summary: "Monitoring execution failed safely.",
      };
    }
    if (controller.signal.aborted) throw new Error("MONITORING_RUN_CANCELLED");
    const before = await this.options.store.getState(run.lane);
    const after = await this.options.store.finishRun({
      lane: run.lane,
      runId: run.runId,
      now: this.clock.now(),
      result,
    });
    clearTimeout(deadline);
    const changed =
      !before.lastResult ||
      before.lastResult.status !== after.lastResult?.status ||
      before.lastResult.code !== after.lastResult?.code;
    if (!this.options.notifier || (!changed && run.source === "SCHEDULED"))
      return;
    const retryDelays = this.options.notificationRetryDelaysMs ?? [0, 100, 500];
    let lastError: unknown;
    // A notifier may fan out to several recipients. Once any transport has
    // begun, repeating the whole notifier could resend an acknowledged prefix.
    // Keep this flag across attempts; pre-dispatch failures remain retryable.
    let effectInitiated = false;
    for (const [attempt, delayMs] of retryDelays.entries()) {
      if (delayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        await this.options.store.withCompletedRun(run, async () => {
          if (controller.signal.aborted)
            throw new Error("MONITORING_RUN_CANCELLED");
          await this.options.notifier!({
            lane: run.lane,
            runId: run.runId,
            source: run.source,
            result,
            admission: {
              signal: controller.signal,
              dispatch: (operation) =>
                this.options.store.withCompletedRun(run, () => {
                  if (controller.signal.aborted)
                    throw new Error("MONITORING_RUN_CANCELLED");
                  effectInitiated = true;
                  return operation();
                }),
            },
          });
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (controller.signal.aborted) throw error;
        if (
          effectInitiated ||
          isMonitoringEffectOutcomeUnknown(error) ||
          (error instanceof Error &&
            error.message === "MONITORING_RUN_STALE_OWNER")
        )
          break;
        if (attempt === retryDelays.length - 1) break;
      }
    }
    if (lastError !== undefined) {
      if (controller.signal.aborted)
        throw new Error("MONITORING_RUN_CANCELLED");
      // Exactly one accounting attempt. A rejected commit ACK is uncertainty,
      // not permission for a second increment hidden inside an outer catch.
      await this.options.store.recordNotificationFailure({
        lane: run.lane,
        runId: run.runId,
        now: this.clock.now(),
        error:
          lastError instanceof Error
            ? lastError.message
            : "NOTIFICATION_FAILED",
      });
    }
  }
}
