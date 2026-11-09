import { describe, expect, it, vi } from "vitest";
import type { DatabaseRuntime } from "./index.js";
import { createHealthDiagnosticsReadRepository } from "./health-diagnostics-read-repository.js";

const now = new Date("2034-05-06T12:00:00.500Z");
const windows = { "1h": 60, "24h": 1440, "7d": 10080, "30d": 43200 } as const;
const states = ["HEALTHY", "DRIFT", "DEGRADED", "BROKEN", "UNKNOWN", "MAINTENANCE"] as const;
function target(at: unknown, state: string | null = "UNKNOWN") {
  return {
    targetId: "a".repeat(64), provider: "chatgpt", surface: "CHATGPT_STANDARD",
    variant: "default", monitoringLayer: "NO_SESSION", browserFamily: "chrome",
    browserVersion: "153", latestHealthState: state, latestCompletedRunAt: at,
    latestHealthyAt: null, activeIncidentCount: 0,
  };
}
function fixture(rows: Record<string, unknown>[] = [], state = "UNKNOWN") {
  const groups = [rows, [{ state, count: rows.length }], [], [], []];
  const query = vi.fn(async () => ({ rows: groups.shift() ?? [] }));
  const repo = createHealthDiagnosticsReadRepository(
    { query } as unknown as DatabaseRuntime,
    () => now,
  );
  return { repo, query };
}
const boundaryCases = Object.entries(windows).flatMap(([window, minutes]) =>
  [-1, 0, 1].flatMap((offset) => ["Date", "ISO", "offset"].map((format) => ({
    window: window as keyof typeof windows, minutes, offset, format,
  }))),
);

describe("Health diagnostic freshness uses the original timestamp instant", () => {
  it.each(boundaryCases)("$window T$offset $format", async ({ window, minutes, offset, format }) => {
    const instant = new Date(now.valueOf() - minutes * 60_000 + offset);
    const input = format === "Date" ? instant : format === "ISO" ? instant.toISOString()
      : new Date(instant.valueOf() + 5 * 60 * 60_000).toISOString().replace("Z", "+05:00");
    const { repo, query } = fixture([target(input)]);
    const result = await repo.getSummary({ window });
    expect(result.latestHealthObservationAt).toBe(instant.toISOString());
    expect(result.currentTargets[0]?.latestCompletedRunAt).toBe(instant.toISOString());
    expect(result.currentTargets[0]?.observationStatus).toBe(offset < 0 ? "NO_RECENT_RUN" : "OBSERVED");
    expect(result.currentTargets[0]?.latestHealthState).toBe("UNKNOWN");
    expect(result.stale).toBe(offset < 0);
    expect(query).toHaveBeenCalledTimes(5);
    expect(instant.valueOf()).toBe(now.valueOf() - minutes * 60_000 + offset);
  });

  it.each(states)("preserves %s independently of freshness", async (state) => {
    const { repo } = fixture([target(new Date(now.valueOf() - 1000), state)], state);
    const result = await repo.getSummary({ window: "1h" });
    expect(result.currentTargets[0]?.latestHealthState).toBe(state);
    expect(result.stateCounts.find((x) => x.state === state)?.count).toBe(1);
    expect(result.environmentCounts.map((x) => x.state)).toEqual(["UNKNOWN", "MAINTENANCE"]);
    expect(result.productQualityCounts.map((x) => x.state)).toEqual(["HEALTHY", "DRIFT", "DEGRADED", "BROKEN"]);
  });

  it("keeps missing observations and successful empty reads explicit", async () => {
    const missing = await fixture([target(null, null)]).repo.getSummary({ window: "1h" });
    expect(missing.currentTargets[0]?.observationStatus).toBe("NO_DATA");
    expect(missing.currentTargets[0]?.latestHealthState).toBeNull();
    expect(missing.latestHealthObservationAt).toBeNull();
    expect(missing.stale).toBe(true);
    const empty = await fixture().repo.getSummary({ window: "1h" });
    expect(empty.currentTargets).toEqual([]);
    expect(empty.latestHealthObservationAt).toBeNull();
    expect(empty.stale).toBe(true);
  });

  it("preserves every summary timestamp and the latest target ordering", async () => {
    const at = new Date("2034-05-06T11:59:59.123Z");
    const newer = new Date(at.valueOf() + 1);
    const groups = [
      [{ ...target(at), latestHealthyAt: at }, { ...target(newer), targetId: "b".repeat(64) }],
      [], [], [{ oldestPendingAt: at, nextRetryAt: newer }],
      [{ latestSuccessfulScheduledRunAt: at, latestFailedScheduledExecutionAt: newer }],
    ];
    const query = vi.fn(async () => ({ rows: groups.shift() ?? [] }));
    const repo = createHealthDiagnosticsReadRepository({ query } as unknown as DatabaseRuntime, () => now);
    const value = await repo.getSummary({ window: "1h" });
    expect(value.latestHealthObservationAt).toBe(newer.toISOString());
    expect(value.currentTargets[0]?.latestHealthyAt).toBe(at.toISOString());
    expect(value.notification.oldestPendingAt).toBe(at.toISOString());
    expect(value.notification.nextRetryAt).toBe(newer.toISOString());
    expect(value.scheduler.latestSuccessfulScheduledRunAt).toBe(at.toISOString());
    expect(value.scheduler.latestFailedScheduledExecutionAt).toBe(newer.toISOString());
  });

  it("preserves breakdown oldest-active milliseconds", async () => {
    const at = new Date("2034-05-06T11:59:59.987Z");
    const groups = [[], [], [], [{ rootContourKey: null, status: "OPEN", provider: "chatgpt", surface: "CHATGPT_STANDARD", activeCount: 1, newCount: 0, resolvedCount: 0, medianDurationSeconds: 1, oldestActiveAt: at }]];
    const query = vi.fn(async () => ({ rows: groups.shift() ?? [] }));
    const repo = createHealthDiagnosticsReadRepository({ query } as unknown as DatabaseRuntime, () => now);
    const result = await repo.getBreakdown({ window: "1h" });
    expect(result.incidentRoots[0]?.oldestActiveAt).toBe(at.toISOString());
  });

  it.each([new Date(NaN), "invalid-timestamp"])("rejects invalid observed instants: %s", async (at) => {
    await expect(fixture([target(at)]).repo.getSummary({ window: "1h" })).rejects.toThrow();
  });

  it("propagates an existing non-wrapped query rejection unchanged", async () => {
    const error = new Error("SCHEDULER_READ_FAILED");
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(error);
    const repo = createHealthDiagnosticsReadRepository({ query } as unknown as DatabaseRuntime, () => now);
    await expect(repo.getSummary({ window: "1h" })).rejects.toBe(error);
  });
});
