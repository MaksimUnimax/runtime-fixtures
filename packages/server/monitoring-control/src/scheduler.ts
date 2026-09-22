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
};

export class IndependentMonitoringScheduler {
  private readonly clock: MonitoringClock;
  private readonly leaseMs: number;
  private readonly tickMs: number;
  private readonly active = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    private readonly options: IndependentMonitoringSchedulerOptions,
  ) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.leaseMs = options.leaseMs ?? 15 * 60 * 1000;
    this.tickMs = options.tickMs ?? 1_000;
  }

  async start(): Promise<void> {
    await this.options.store.ensureDefaults(this.clock.now());
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    await this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
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

  async runNow(lane: MonitoringLane): Promise<MonitoringRunAcknowledgement> {
    return this.begin(lane, "FORCED");
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
    await Promise.all(
      MONITORING_LANES.map(async (lane) => {
        const acknowledgement = await this.begin(lane, "SCHEDULED");
        if (acknowledgement.kind === "STARTED")
          await this.active.get(acknowledgement.runId);
      }),
    );
  }

  private async begin(
    lane: MonitoringLane,
    source: "SCHEDULED" | "FORCED",
  ): Promise<MonitoringRunAcknowledgement> {
    const result = await this.options.store.startRun({
      lane,
      source,
      now: this.clock.now(),
      leaseMs: this.leaseMs,
    });
    if (result.kind === "NOT_DUE") return { kind: "NOT_DUE", lane };
    if (result.kind === "ALREADY_RUNNING")
      return { kind: "ALREADY_RUNNING", lane, runId: result.runId };
    const work = this.execute(result.run);
    this.active.set(result.run.runId, work);
    void work.finally(() => this.active.delete(result.run.runId));
    return { kind: "STARTED", lane, runId: result.run.runId, source };
  }

  private async execute(run: MonitoringRun): Promise<void> {
    let result: MonitoringRunResult;
    try {
      const runner = this.options.runners[run.lane];
      if (!runner) throw new Error("MONITORING_RUNNER_NOT_CONFIGURED");
      result = safeMonitoringResult(await runner(run));
    } catch {
      result = {
        status: "FAILED",
        code: "MONITORING_EXECUTION_FAILED",
        summary: "Monitoring execution failed safely.",
      };
    }
    const before = await this.options.store.getState(run.lane);
    const after = await this.options.store.finishRun({
      lane: run.lane,
      runId: run.runId,
      now: this.clock.now(),
      result,
    });
    const changed =
      !before.lastResult ||
      before.lastResult.status !== after.lastResult?.status ||
      before.lastResult.code !== after.lastResult?.code;
    if (!this.options.notifier || (!changed && run.source === "SCHEDULED"))
      return;
    try {
      const retryDelays = this.options.notificationRetryDelaysMs ?? [
        0, 100, 500,
      ];
      let lastError: unknown;
      for (const [attempt, delayMs] of retryDelays.entries()) {
        if (delayMs > 0)
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        try {
          await this.options.notifier({
            lane: run.lane,
            runId: run.runId,
            source: run.source,
            result,
          });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt === retryDelays.length - 1) break;
        }
      }
      if (lastError !== undefined) {
        await this.options.store.recordNotificationFailure({
          lane: run.lane,
          now: this.clock.now(),
          error:
            lastError instanceof Error
              ? lastError.message
              : "NOTIFICATION_FAILED",
        });
      }
    } catch (error) {
      await this.options.store.recordNotificationFailure({
        lane: run.lane,
        now: this.clock.now(),
        error: error instanceof Error ? error.message : "NOTIFICATION_FAILED",
      });
    }
  }
}
