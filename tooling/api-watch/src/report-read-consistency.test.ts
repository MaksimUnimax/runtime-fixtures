import { describe, expect, it } from "vitest";
import { createPostgresApiWatchReportStore } from "./report.js";
import type { ApiWatchSqlQuery, ApiWatchSqlRuntime } from "./types.js";

const started = new Date("2026-10-26T00:00:01Z");
const reportRow = {
  reportId: "c03-report-consistency-synthetic",
  runSource: "SCHEDULED",
  createdAt: new Date("2026-10-26T00:00:00Z"),
  startedAt: started,
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

const newlyCommittedSource = {
  reportId: reportRow.reportId,
  sourceFamily: "OZON_SELLER",
  documentKey: "c03-synthetic-document",
  acquisitionOutcome: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
  authorityStatus: "AUTHORITY_ACCEPTED",
  snapshotSha256: "a".repeat(64),
  inventoryOperationCount: 1,
  baseSnapshotSha256: null,
  diffSha256: null,
  impactSeverity: null,
  blockerCode: null,
  errorCode: null,
  changeMode: "FIRST_SNAPSHOT",
  addedCount: 0,
  removedCount: 0,
  changedCount: 0,
  unchangedCount: 1,
  blockingRiskCount: 0,
  reviewRequiredCount: 0,
  unknownCount: 0,
  noPolicyImpactCount: 1,
};

describe("C03 coherent read of report header and source rows", () => {
  it("never exposes terminal rows during the creation readback", async () => {
    let transactionCount = 0;
    let insideCreate = false;
    let simulatedExternalCommit = false;
    const row = { ...reportRow, state: "CREATED", startedAt: null };

    const query = async <T extends Record<string, unknown>>(
      sql: string,
    ): Promise<{ rows: T[] }> => {
      if (sql.startsWith("INSERT INTO api_watch_reports")) {
        return { rows: [{ ...row } as unknown as T] };
      }
      if (sql.includes("FROM api_watch_reports")) {
        return { rows: [{ ...row } as unknown as T] };
      }
      if (sql.includes("FROM api_watch_report_sources")) {
        // The insert is not visible to another writer until its transaction
        // commits; without a transaction this competing terminal update can
        // commit before the subsequent source SELECT.
        if (!insideCreate) simulatedExternalCommit = true;
        return {
          rows: (simulatedExternalCommit
            ? [{ ...newlyCommittedSource }]
            : []) as unknown as T[],
        };
      }
      throw new Error("TEST_UNEXPECTED_SQL");
    };
    const runtime: ApiWatchSqlRuntime = {
      query,
      async transaction<T>(operation: (query: ApiWatchSqlQuery) => Promise<T>) {
        transactionCount++;
        insideCreate = true;
        try {
          return await operation({ query });
        } finally {
          insideCreate = false;
        }
      },
    };
    const store = createPostgresApiWatchReportStore(runtime);
    const created = await store.createReport({
      reportId: reportRow.reportId,
      runSource: "SCHEDULED",
      createdAt: reportRow.createdAt,
    });
    expect(created).toMatchObject({ state: "CREATED", sources: [] });
    expect(simulatedExternalCommit).toBe(false);
    expect(transactionCount).toBe(1);
  });

  it("cannot combine RUNNING header with sources committed after the first SELECT", async () => {
    let transactionCount = 0;
    let sawSharedRowLock = false;
    let writerCommitted = false;

    const query = async <T extends Record<string, unknown>>(
      sql: string,
    ): Promise<{ rows: T[] }> => {
      if (sql.includes("FROM api_watch_reports")) {
        if (sql.includes("FOR SHARE")) sawSharedRowLock = true;
        return { rows: [{ ...reportRow } as unknown as T] };
      }
      if (sql.includes("FROM api_watch_report_sources")) {
        // A competing terminal writer can commit between the two SELECTs
        // unless the first SELECT holds a conflicting row lock.
        if (!sawSharedRowLock) writerCommitted = true;
        return {
          rows: (writerCommitted
            ? [{ ...newlyCommittedSource }]
            : []) as unknown as T[],
        };
      }
      throw new Error("TEST_UNEXPECTED_SQL");
    };
    const runtime: ApiWatchSqlRuntime = {
      query,
      async transaction<T>(operation: (query: ApiWatchSqlQuery) => Promise<T>) {
        transactionCount++;
        return operation({ query });
      },
    };
    const store = createPostgresApiWatchReportStore(runtime);
    const result = await store.getReport(reportRow.reportId);
    expect(result).toMatchObject({ state: "RUNNING", sources: [] });
    expect(writerCommitted).toBe(false);
    expect(sawSharedRowLock).toBe(true);
    expect(transactionCount).toBe(1);
  });
});
