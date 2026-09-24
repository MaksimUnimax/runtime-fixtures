import { createHash } from "node:crypto";
import {
  DEFAULT_NO_SESSION_CADENCE,
  HealthScheduleCadenceSchema,
  type HealthScheduleInput,
} from "@product/health";
import type { HealthSchedule } from "@product/health";
import { NO_SESSION_TARGETS } from "./no-session-target-authority.js";

function stableScheduleId(targetKey: string): string {
  const hex = createHash("sha256")
    .update(`octoport-health:${targetKey}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function noSessionCadence(intervalSeconds: number): HealthSchedule["cadence"] {
  const result = HealthScheduleCadenceSchema.safeParse({
    ...DEFAULT_NO_SESSION_CADENCE,
    intervalSeconds,
  });
  if (!result.success) throw new Error("NO_SESSION_SCHEDULE_CADENCE_INVALID");
  return result.data;
}

/**
 * The public monitor is a typed durable capability. It deliberately has no
 * authenticated-session lookup or readiness gate; deep probes are additive.
 */
export function createNoSessionHealthSchedules(
  firstDueAt: Date,
  intervalSeconds = DEFAULT_NO_SESSION_CADENCE.intervalSeconds,
): readonly HealthScheduleInput[] {
  const cadence = noSessionCadence(intervalSeconds);
  return NO_SESSION_TARGETS.map((target) => ({
    scheduleId: stableScheduleId(target.targetKey),
    monitorTarget: target.targetKey,
    provider: target.providerId,
    surface: target.surfaceId,
    probeLayer: "NO_SESSION" as const,
    enabled: true,
    cadence,
    nextDueAt: new Date(firstDueAt),
    revision: 1,
  }));
}

export interface NoSessionScheduleBootstrapRepository {
  getSchedule(scheduleId: string): Promise<HealthSchedule | undefined>;
  createSchedule(input: unknown): Promise<HealthSchedule>;
  updateSchedule(input: {
    scheduleId: string;
    enabled: boolean;
    cadence: HealthSchedule["cadence"];
    nextDueAt: Date;
  }): Promise<HealthSchedule>;
}

/** Ensures the accepted target schedules exist; retries are safe across wakes. */
export async function ensureNoSessionHealthSchedules(
  repository: NoSessionScheduleBootstrapRepository,
  firstDueAt: Date,
  intervalSeconds = DEFAULT_NO_SESSION_CADENCE.intervalSeconds,
): Promise<number> {
  let created = 0;
  for (const schedule of createNoSessionHealthSchedules(
    firstDueAt,
    intervalSeconds,
  )) {
    const existing = await repository.getSchedule(schedule.scheduleId);
    if (existing) {
      if (
        existing.monitorTarget !== schedule.monitorTarget ||
        existing.provider !== schedule.provider ||
        existing.surface !== schedule.surface ||
        existing.probeLayer !== schedule.probeLayer
      ) {
        throw new Error("NO_SESSION_SCHEDULE_IDENTITY_CONFLICT");
      }
      if (existing.cadence.intervalSeconds !== intervalSeconds) {
        const cadence = noSessionCadence(intervalSeconds);
        try {
          await repository.updateSchedule({
            scheduleId: existing.scheduleId,
            enabled: existing.enabled,
            cadence,
            nextDueAt: new Date(firstDueAt),
          });
        } catch {
          const raced = await repository.getSchedule(existing.scheduleId);
          if (!raced || raced.cadence.intervalSeconds !== intervalSeconds) {
            throw new Error("NO_SESSION_SCHEDULE_CADENCE_UPDATE_FAILED");
          }
        }
      }
      continue;
    }
    try {
      await repository.createSchedule(schedule);
      created += 1;
    } catch {
      // A concurrent process may have inserted this stable ID after our read.
      const raced = await repository.getSchedule(schedule.scheduleId);
      if (
        !raced ||
        raced.monitorTarget !== schedule.monitorTarget ||
        raced.provider !== schedule.provider ||
        raced.surface !== schedule.surface ||
        raced.probeLayer !== schedule.probeLayer
      ) {
        throw new Error("NO_SESSION_SCHEDULE_BOOTSTRAP_FAILED");
      }
    }
  }
  return created;
}
