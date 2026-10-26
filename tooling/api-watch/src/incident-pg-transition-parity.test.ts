import { describe, expect, it } from "vitest";
import { createPostgresApiWatchIncidentStore } from "./incident.js";
import type { ApiWatchSqlRuntime } from "./types.js";

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
    );
    expect(updates).toBe(1);
    expect(result).toBeUndefined();
    expect(selects).toBe(0);
    expect(locks).toBe(1);
  });

  it("marks exactly one concurrent OPENED transition using a transaction-scoped key lock", async () => {
    let saved: Record<string, unknown> | null = null;
    let locks = 0;
    let transactionStarts = 0;
    let sequence = Promise.resolve();
    const query = async (sql: string) => {
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
    expect(
      (
        await store.resolve(
          incidentInput.incidentKey,
          new Date("2026-10-26T00:00:03Z"),
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
      ),
      store.resolve(
        incidentInput.incidentKey,
        new Date("2026-10-26T00:00:09Z"),
      ),
    ]);
    expect(twoClosures.filter(Boolean)).toHaveLength(1);
    expect(twoClosures.filter((row) => row === undefined)).toHaveLength(1);
    expect(saved).toMatchObject({ occurrenceCount: 5, state: "RESOLVED" });
    expect(transactionStarts).toBe(9);
    expect(locks).toBe(9);
  });
});
