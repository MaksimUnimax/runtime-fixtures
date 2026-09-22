import { z } from "zod";

export const MonitoringLaneSchema = z.enum(["LLM", "SWAGGER_API"]);
export type MonitoringLane = z.infer<typeof MonitoringLaneSchema>;

export const MONITORING_LANES = ["LLM", "SWAGGER_API"] as const;
export const MONITORING_INTERVAL_MIN_SECONDS = 5 * 60;
export const MONITORING_INTERVAL_MAX_SECONDS = 30 * 24 * 60 * 60;
export const MONITORING_DEFAULT_INTERVAL_SECONDS = Object.freeze({
  LLM: 90 * 60,
  SWAGGER_API: 6 * 60 * 60,
} satisfies Record<MonitoringLane, number>);

export const MonitoringRunSourceSchema = z.enum(["SCHEDULED", "FORCED"]);
export type MonitoringRunSource = z.infer<typeof MonitoringRunSourceSchema>;

export const MonitoringResultStatusSchema = z.enum([
  "SUCCEEDED",
  "AUTH_REQUIRED",
  "NOT_OBSERVABLE",
  "SOURCE_UNAVAILABLE",
  "FAILED",
]);
export type MonitoringResultStatus = z.infer<
  typeof MonitoringResultStatusSchema
>;

export const MonitoringRunResultSchema = z
  .object({
    status: MonitoringResultStatusSchema,
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .nullable(),
    summary: z.string().max(240),
  })
  .strict();
export type MonitoringRunResult = z.infer<typeof MonitoringRunResultSchema>;

export type MonitoringActiveRun = {
  runId: string;
  source: MonitoringRunSource;
  startedAt: Date;
  leaseExpiresAt: Date;
};

export type MonitoringLaneState = {
  lane: MonitoringLane;
  enabled: boolean;
  intervalSeconds: number;
  nextRunAt: Date;
  lastRunAt: Date | null;
  activeRun: MonitoringActiveRun | null;
  lastResult:
    | (MonitoringRunResult & { runId: string; finishedAt: Date })
    | null;
  notificationFailureCount: number;
  lastNotificationError: string | null;
  updatedAt: Date;
};

export type MonitoringRun = {
  runId: string;
  lane: MonitoringLane;
  source: MonitoringRunSource;
  startedAt: Date;
  leaseExpiresAt: Date;
};

export type MonitoringStartResult =
  | { kind: "STARTED"; run: MonitoringRun }
  | { kind: "ALREADY_RUNNING"; runId: string }
  | { kind: "NOT_DUE" };

export type MonitoringClock = { now(): Date };

export type MonitoringLaneRunner = (input: {
  lane: MonitoringLane;
  runId: string;
  source: MonitoringRunSource;
}) => Promise<MonitoringRunResult>;

export type MonitoringNotification = {
  lane: MonitoringLane;
  runId: string;
  source: MonitoringRunSource;
  result: MonitoringRunResult;
};

export type MonitoringNotifier = (
  notification: MonitoringNotification,
) => Promise<void>;

export function parseMonitoringDuration(raw: string): number {
  const match = /^(\d+)(s|m|h|d)$/i.exec(raw.trim());
  if (!match) throw new Error("INVALID_MONITORING_DURATION");
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier =
    unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  const seconds = amount * multiplier;
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < MONITORING_INTERVAL_MIN_SECONDS ||
    seconds > MONITORING_INTERVAL_MAX_SECONDS
  ) {
    throw new Error("MONITORING_DURATION_OUT_OF_RANGE");
  }
  return seconds;
}

export function formatMonitoringDuration(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function safeMonitoringResult(
  value: MonitoringRunResult,
): MonitoringRunResult {
  return MonitoringRunResultSchema.parse({
    status: value.status,
    code: value.code,
    summary: value.summary.slice(0, 240),
  });
}
