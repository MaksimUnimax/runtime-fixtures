import { describe, expect, it } from "vitest";
import {
  createPostgresApiWatchIncidentStore,
  InMemoryApiWatchIncidentStore,
  evaluateApiWatchIncidents,
} from "./incident.js";
import type {
  ApiWatchIncidentStore,
  ApiWatchReport,
  ApiWatchSqlRuntime,
} from "./types.js";

const incidentInput = {
  incidentKey: "SOURCE_AUTHORITY_BLOCKED:OZON_SELLER:SOURCE",
  incidentType: "SOURCE_AUTHORITY_BLOCKED" as const,
  sourceFamily: "OZON_SELLER" as const,
  documentKey: null,
  operationIdentity: null,
  firstSeenAt: new Date("2026-10-26T00:00:00Z"),
  lastSeenAt: new Date("2026-10-26T00:00:00Z"),
  severity: "BLOCKING_RISK" as const,
  latestReportId: "synthetic-report",
  latestDiffSha256: null,
  safeSummaryCode: "SOURCE_URL_AUTHORITY_MISSING",
};

describe("PostgreSQL incident state transition parity", () => {
  it("returns undefined for an already-RESOLVED row rather than replaying RESOLVED", async () => {
    const resolved = {
      ...incidentInput,
      incidentId: "synthetic-incident",
      state: "RESOLVED",
      occurrenceCount: 1,
      resolvedAt: new Date("2026-10-26T00:00:01Z"),
    };
    let updates = 0;
    let selects = 0;
    let locks = 0;
    const query = async (sql: string) => {
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) {
        locks++;
        return { rows: [{}] };
      }
      if (sql.startsWith("UPDATE api_watch_incidents")) {
        updates++;
        return { rows: [] };
      }
      if (sql.startsWith("SELECT ")) {
        selects++;
        return { rows: [resolved] };
      }
      throw new Error("Unexpected synthetic SQL");
    };
    const runtime = {
      query,
      async transaction<T>(
        operation: (tx: { query: typeof query }) => Promise<T>,
      ): Promise<T> {
        return operation({ query });
      },
    } as unknown as ApiWatchSqlRuntime;
    const result = await createPostgresApiWatchIncidentStore(runtime).resolve(
      incidentInput.incidentKey,
      new Date("2026-10-26T00:00:02Z"),
      resolved.occurrenceCount,
    );
    expect(updates).toBe(1);
    expect(result).toBeUndefined();
    expect(selects).toBe(0);
    expect(locks).toBe(1);
  });

  it("preserves firstSeenAt on re-observation and reopening while updating lastSeenAt", async () => {
    const store = new InMemoryApiWatchIncidentStore();
    const first = await store.observe(incidentInput);
    expect(first.incident.firstSeenAt.toISOString()).toBe(
      "2026-10-26T00:00:00.000Z",
    );
    const second = await store.observe({
      ...incidentInput,
      firstSeenAt: new Date("2026-10-26T00:00:01Z"),
      lastSeenAt: new Date("2026-10-26T00:00:01Z"),
      latestReportId: "second-report",
    });
    expect(second.incident.firstSeenAt.toISOString()).toBe(
      "2026-10-26T00:00:00.000Z",
    );
    expect(second.incident.lastSeenAt.toISOString()).toBe(
      "2026-10-26T00:00:01.000Z",
    );
    expect(second.incident.occurrenceCount).toBe(2);
    expect(second.opened).toBe(false);
    expect(
      (
        await store.resolve(
          incidentInput.incidentKey,
          new Date("2026-10-26T00:00:02Z"),
          2,
        )
      )?.state,
    ).toBe("RESOLVED");
    const reopened = await store.observe({
      ...incidentInput,
      firstSeenAt: new Date("2026-10-26T00:00:03Z"),
      lastSeenAt: new Date("2026-10-26T00:00:03Z"),
      latestReportId: "third-report",
    });
    expect(reopened.opened).toBe(true);
    expect(reopened.incident.firstSeenAt.toISOString()).toBe(
      "2026-10-26T00:00:00.000Z",
    );
    expect(reopened.incident.lastSeenAt.toISOString()).toBe(
      "2026-10-26T00:00:03.000Z",
    );
    expect(reopened.incident.latestReportId).toBe("third-report");
    expect(reopened.incident.occurrenceCount).toBe(3);
  });

  it("keeps a newer in-memory observation open if recovery uses an old occurrence count", async () => {
    const memory = new InMemoryApiWatchIncidentStore();
    const first = await memory.observe(incidentInput);
    await memory.observe({
      ...incidentInput,
      lastSeenAt: new Date("2026-10-26T00:00:01Z"),
    });
    const staleClose = await memory.resolve(
      incidentInput.incidentKey,
      new Date("2026-10-26T00:00:02Z"),
      first.incident.occurrenceCount,
    );
    expect(staleClose).toBeUndefined();
    expect(await memory.find(incidentInput.incidentKey)).toMatchObject({
      state: "OPEN",
      occurrenceCount: 2,
    });
  });

  it("rejects stale recovery proof after a newer observation and does not notify RESOLVED", async () => {
    const memory = new InMemoryApiWatchIncidentStore();
    const first = await memory.observe(incidentInput);
    expect(first.incident.occurrenceCount).toBe(1);
    let interrupted = false;
    const racingStore: ApiWatchIncidentStore = {
      observe: (value) => memory.observe(value),
      resolve: (key, at, version) => memory.resolve(key, at, version),
      find: (key) => memory.find(key),
      async listOpen() {
        const snapshot = await memory.listOpen();
        if (!interrupted) {
          interrupted = true;
          await memory.observe({
            ...incidentInput,
            latestReportId: "new-observation-after-snapshot",
            lastSeenAt: new Date("2026-10-26T00:00:03Z"),
          });
        }
        return snapshot;
      },
    };
    const report: ApiWatchReport = {
      reportId: "recovery-before-newer-observation",
      runSource: "SCHEDULED",
      createdAt: new Date(1),
      startedAt: new Date(1),
      completedAt: new Date(2),
      state: "COMPLETED",
      sources: [
        {
          sourceFamily: "OZON_SELLER",
          acquisitionOutcome: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
          authorityStatus: "AUTHORITY_ACCEPTED",
          snapshotSha256: "a".repeat(64),
          inventoryOperationCount: 1,
          baseSnapshotSha256: "a".repeat(64),
          diffSha256: null,
          impactSeverity: null,
          blockerCode: null,
          errorCode: null,
          changeMode: "NO_CHANGE",
          addedCount: 0,
          removedCount: 0,
          changedCount: 0,
          unchangedCount: 1,
          blockingRiskCount: 0,
          reviewRequiredCount: 0,
          unknownCount: 0,
          noPolicyImpactCount: 1,
        },
      ],
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
      unchangedCount: 1,
      blockingRiskCount: 0,
      reviewRequiredCount: 0,
      unknownCount: 0,
      noPolicyImpactCount: 1,
      overallImpactSeverity: null,
    };
    const notifications: string[] = [];
    await evaluateApiWatchIncidents({
      report,
      store: racingStore,
      now: new Date("2026-10-26T00:00:04Z"),
      notifier: async ({ kind }) => {
        notifications.push(kind);
      },
    });
    expect(interrupted).toBe(true);
    expect(notifications).toEqual([]);
    expect(await memory.find(incidentInput.incidentKey)).toMatchObject({
      state: "OPEN",
      occurrenceCount: 2,
      latestReportId: "new-observation-after-snapshot",
    });
    await evaluateApiWatchIncidents({
      report,
      store: memory,
      now: new Date("2026-10-26T00:00:05Z"),
      notifier: async ({ kind }) => {
        notifications.push(kind);
      },
    });
    expect(notifications).toEqual(["RESOLVED"]);
    expect(await memory.find(incidentInput.incidentKey)).toMatchObject({
      state: "RESOLVED",
      occurrenceCount: 2,
    });
  });

  it("marks exactly one concurrent OPENED transition using a transaction-scoped key lock", async () => {
    let saved: Record<string, unknown> | null = null;
    let locks = 0;
    let transactionStarts = 0;
    let sequence = Promise.resolve();
    const query = async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) {
        locks++;
        return { rows: [{}] };
      }
      if (
        sql.startsWith("SELECT ") &&
        sql.includes("FROM api_watch_incidents")
      ) {
        return { rows: saved ? [{ ...saved }] : [] };
      }
      if (sql.startsWith("UPDATE api_watch_incidents")) {
        if (!saved || saved.state !== "OPEN") return { rows: [] };
        if (
          sql.includes("occurrence_count=$3") &&
          Number(saved.occurrenceCount) !== Number(values[2])
        )
          return { rows: [] };
        saved = {
          ...saved,
          state: "RESOLVED",
          resolvedAt: new Date("2026-10-26T00:00:03Z"),
        };
        return { rows: [{ ...saved }] };
      }
      if (sql.startsWith("INSERT INTO api_watch_incidents")) {
        saved = saved
          ? {
              ...saved,
              state: "OPEN",
              resolvedAt: null,
              occurrenceCount: Number(saved.occurrenceCount) + 1,
            }
          : {
              ...incidentInput,
              incidentId: "synthetic-incident",
              state: "OPEN",
              occurrenceCount: 1,
              resolvedAt: null,
            };
        return { rows: [] };
      }
      throw new Error("Unexpected synthetic SQL");
    };
    const runtime = {
      query,
      async transaction<T>(
        operation: (tx: { query: typeof query }) => Promise<T>,
      ): Promise<T> {
        transactionStarts++;
        const before = sequence;
        let release!: () => void;
        sequence = new Promise<void>((done) => {
          release = done;
        });
        await before;
        try {
          return await operation({ query });
        } finally {
          release();
        }
      },
    } as unknown as ApiWatchSqlRuntime;

    const store = createPostgresApiWatchIncidentStore(runtime);
    const results = await Promise.all([
      store.observe(incidentInput),
      store.observe({
        ...incidentInput,
        lastSeenAt: new Date("2026-10-26T00:00:02Z"),
      }),
    ]);
    expect(results.filter((r) => r.opened)).toHaveLength(1);
    expect(results.filter((r) => !r.opened)).toHaveLength(1);
    expect(saved).toMatchObject({ occurrenceCount: 2 });
    const staleVersion = Math.min(
      ...results.map((r) => r.incident.occurrenceCount),
    );
    const refusedStale = await store.resolve(
      incidentInput.incidentKey,
      new Date("2026-10-26T00:00:02Z"),
      staleVersion,
    );
    expect(refusedStale).toBeUndefined();
    expect(saved).toMatchObject({ occurrenceCount: 2, state: "OPEN" });
    expect(
      (
        await store.resolve(
          incidentInput.incidentKey,
          new Date("2026-10-26T00:00:03Z"),
          2,
        )
      )?.state,
    ).toBe("RESOLVED");
    const reopened = await Promise.all([
      store.observe({
        ...incidentInput,
        lastSeenAt: new Date("2026-10-26T00:00:04Z"),
      }),
      store.observe({
        ...incidentInput,
        lastSeenAt: new Date("2026-10-26T00:00:05Z"),
      }),
    ]);
    expect(reopened.filter((result) => result.opened)).toHaveLength(1);
    expect(reopened.filter((result) => !result.opened)).toHaveLength(1);
    expect(saved).toMatchObject({ occurrenceCount: 4, state: "OPEN" });
    const closeAndReopen = await Promise.all([
      store.resolve(
        incidentInput.incidentKey,
        new Date("2026-10-26T00:00:06Z"),
        4,
      ),
      store.observe({
        ...incidentInput,
        lastSeenAt: new Date("2026-10-26T00:00:07Z"),
      }),
    ]);
    expect(closeAndReopen[0]?.state).toBe("RESOLVED");
    expect(closeAndReopen[1]?.opened).toBe(true);
    expect(saved).toMatchObject({ occurrenceCount: 5, state: "OPEN" });

    const twoClosures = await Promise.all([
      store.resolve(
        incidentInput.incidentKey,
        new Date("2026-10-26T00:00:08Z"),
        5,
      ),
      store.resolve(
        incidentInput.incidentKey,
        new Date("2026-10-26T00:00:09Z"),
        5,
      ),
    ]);
    expect(twoClosures.filter(Boolean)).toHaveLength(1);
    expect(twoClosures.filter((row) => row === undefined)).toHaveLength(1);
    expect(saved).toMatchObject({ occurrenceCount: 5, state: "RESOLVED" });
    expect(transactionStarts).toBe(10);
    expect(locks).toBe(10);
  });
});
