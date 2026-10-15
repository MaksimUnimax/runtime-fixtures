import { describe, expect, it } from "vitest";
import { createFeedbackSupportRepository } from "./feedback-support-repository.js";
import type { DatabaseRuntime } from "./index.js";

const base = {
  now: new Date("2030-01-01T00:00:00.000Z"),
  closedRetentionDays: 90,
  signalRetentionDays: 180,
  batchSize: 100,
  statementTimeoutMs: 5_000,
};

function syntheticRuntime() {
  let transactions = 0;
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const query = async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT set_config(")) return { rows: [] };
    if (sql.includes("WITH case_candidates AS ("))
      return { rows: [{ cases: 2, signals: 3 }] };
    throw new Error("Unexpected synthetic SQL");
  };
  const runtime = {
    transaction: async (
      fn: (tx: { query: typeof query }) => Promise<unknown>,
    ) => {
      transactions += 1;
      return fn({ query });
    },
  } as unknown as DatabaseRuntime;
  return {
    repository: createFeedbackSupportRepository(runtime),
    calls,
    transactions: () => transactions,
  };
}

describe("B06 feedback retention input safety (synthetic without DB)", () => {
  it.each([
    [{ closedRetentionDays: -1 }, "closedRetentionDays"],
    [{ closedRetentionDays: 0 }, "closedRetentionDays"],
    [{ closedRetentionDays: 3651 }, "closedRetentionDays"],
    [{ closedRetentionDays: 0.5 }, "closedRetentionDays"],
    [{ closedRetentionDays: Number.NaN }, "closedRetentionDays"],
    [{ signalRetentionDays: -1 }, "signalRetentionDays"],
    [{ signalRetentionDays: 0 }, "signalRetentionDays"],
    [{ signalRetentionDays: 3651 }, "signalRetentionDays"],
    [{ signalRetentionDays: Number.POSITIVE_INFINITY }, "signalRetentionDays"],
    [{ now: new Date(Number.NaN) }, "now"],
    [{ now: new Date(-8_640_000_000_000_000) }, "cutoff"],
  ])(
    "rejects invalid %s before starting a destructive transaction",
    async (patch, expectedError) => {
      const fixture = syntheticRuntime();
      await expect(
        fixture.repository.purgeExpired({ ...base, ...patch }),
      ).rejects.toThrow(expectedError);
      expect(fixture.transactions()).toBe(0);
      expect(fixture.calls).toEqual([]);
    },
  );

  it.each([1, 90, 180, 3650])(
    "preserves valid days=%s and database cutoff arguments",
    async (days) => {
      const fixture = syntheticRuntime();
      const result = await fixture.repository.purgeExpired({
        ...base,
        closedRetentionDays: days,
        signalRetentionDays: days,
      });
      expect(result).toEqual({ cases: 2, signals: 3 });
      expect(fixture.transactions()).toBe(1);
      const deleteCall = fixture.calls.find((call) =>
        call.sql.includes("WITH case_candidates AS ("),
      );
      const cutoff = new Date(base.now.getTime() - days * 86_400_000);
      expect(deleteCall?.values).toEqual([cutoff, cutoff, base.batchSize]);
    },
  );
});
