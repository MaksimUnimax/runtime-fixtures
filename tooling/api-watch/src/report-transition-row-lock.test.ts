import { describe, expect, it } from "vitest";
import { createPostgresApiWatchReportStore } from "./report.js";
import type { ApiWatchSqlRuntime, ApiWatchSqlQuery } from "./types.js";

type ReportState = "RUNNING" | "COMPLETED" | "FAILED";
type Row = Record<string, unknown> & { state: ReportState };

class FakeTransactionalReportRows {
  row: Row = {
    reportId: "c04-rowlock-fixture",
    runSource: "SCHEDULED",
    createdAt: new Date("2026-10-20T00:00:00Z"),
    startedAt: new Date("2026-10-20T00:01:00Z"),
    completedAt: null,
    state: "RUNNING",
    addedCount: 0,
    removedCount: 0,
    changedCount: 0,
    unchangedCount: 0,
    blockingRiskCount: 0,
    reviewRequiredCount: 0,
    unknownCount: 0,
    noPolicyImpactCount: 0,
    overallImpactSeverity: null,
  };
  private noLockReaders = 0;
  private releaseNoLockReads!: () => void;
  private bothRead = new Promise<void>((resolve) => {
    this.releaseNoLockReads = resolve;
  });
  private tail: Promise<void> = Promise.resolve();
  sawLockingSelect = 0;
  sawNonLockingSelect = 0;
  updateCount = 0;

  readonly runtime: ApiWatchSqlRuntime = {
    query: async <T extends Record<string, unknown>>(
      sql: string,
    ): Promise<{ rows: T[] }> => {
      if (sql.includes("FROM api_watch_reports")) {
        this.sawNonLockingSelect++;
        return { rows: [{ ...this.row } as T] };
      }
      if (sql.includes("FROM api_watch_report_sources")) return { rows: [] };
      throw new Error("TEST_SQL_UNEXPECTED_DIRECT_QUERY");
    },
    transaction: async <T>(
      operation: (query: ApiWatchSqlQuery) => Promise<T>,
    ) => {
      let unlock: (() => void) | undefined;
      const query: ApiWatchSqlQuery = {
        query: async <U extends Record<string, unknown>>(
          sql: string,
          values?: unknown[],
        ): Promise<{ rows: U[] }> => {
          if (
            sql.startsWith("SELECT") &&
            sql.includes("FROM api_watch_reports")
          ) {
            if (sql.includes("FOR UPDATE")) {
              this.sawLockingSelect++;
              const previous = this.tail;
              let release!: () => void;
              this.tail = new Promise<void>((resolve) => {
                release = resolve;
              });
              await previous;
              unlock = release;
              return { rows: [{ ...this.row } as U] };
            }
            this.sawNonLockingSelect++;
            const snapshot = { ...this.row };
            if (++this.noLockReaders === 2) this.releaseNoLockReads();
            await this.bothRead;
            return { rows: [snapshot as U] };
          }
          if (
            sql.startsWith("SELECT") &&
            sql.includes("FROM api_watch_report_sources")
          )
            return { rows: [] };
          if (sql.startsWith("UPDATE api_watch_reports")) {
            if (!values || values[0] !== "c04-rowlock-fixture")
              throw new Error("TEST_BAD_REPORT_ID");
            this.row = {
              ...this.row,
              state: values[1] as ReportState,
              startedAt: values[2],
              completedAt: values[3],
            };
            this.updateCount++;
            return { rows: [] };
          }
          throw new Error("TEST_SQL_UNEXPECTED_IN_TRANSACTION");
        },
      };
      try {
        return await operation(query);
      } finally {
        unlock?.();
      }
    },
  };
}

describe("C04 PostgreSQL report terminal row serialization", () => {
  it("preserves ordinary unlocked report reads", async () => {
    const fake = new FakeTransactionalReportRows();
    const store = createPostgresApiWatchReportStore(fake.runtime);
    expect((await store.getReport("c04-rowlock-fixture"))?.state).toBe(
      "RUNNING",
    );
    expect(fake.sawNonLockingSelect).toBe(1);
    expect(fake.sawLockingSelect).toBe(0);
  });

  it("never accepts two conflicting concurrent terminal outcomes", async () => {
    const fake = new FakeTransactionalReportRows();
    const store = createPostgresApiWatchReportStore(fake.runtime);
    const first = store.transitionReport({
      reportId: "c04-rowlock-fixture",
      state: "COMPLETED",
      at: new Date("2026-10-20T00:02:00Z"),
    });
    const second = store.transitionReport({
      reportId: "c04-rowlock-fixture",
      state: "FAILED",
      at: new Date("2026-10-20T00:02:01Z"),
    });
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(fake.sawLockingSelect).toBe(2);
    expect(fake.sawNonLockingSelect).toBe(0);
    expect(fake.updateCount).toBe(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    expect(String((rejected as PromiseRejectedResult).reason)).toContain(
      "REPORT_TERMINAL_OR_INVALID_TRANSITION",
    );
    expect(["COMPLETED", "FAILED"]).toContain(fake.row.state);
  });
});
