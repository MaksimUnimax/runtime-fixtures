import { describe, expect, it } from "vitest";
import { createFeedbackSupportRepository } from "./feedback-support-repository.js";
import type { DatabaseRuntime } from "./index.js";

function syntheticRuntime() {
  const calls: { sql: string; values: unknown[] | undefined }[] = [];
  let transactions = 0;
  const query = async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT set_config(")) return { rows: [] };
    if (sql.includes("WITH case_candidates AS ("))
      return { rows: [{ cases: 2, signals: 3 }] };
    throw new Error("Unexpected synthetic SQL query");
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

describe("B06 feedback retention cutoff respects database clock (synthetic)", () => {
  it("prevents future caller time from becoming an uncapped destructive SQL cutoff", async () => {
    const fixture = syntheticRuntime();
    const now = new Date("2090-01-01T00:00:00.000Z");
    await expect(
      fixture.repository.purgeExpired({
        now,
        closedRetentionDays: 90,
        signalRetentionDays: 180,
        batchSize: 3,
        statementTimeoutMs: 5_000,
      }),
    ).resolves.toEqual({ cases: 2, signals: 3 });
    expect(fixture.transactions()).toBe(1);
    expect(fixture.calls).toHaveLength(2);
    const destructive = fixture.calls[1]!;
    expect(destructive.sql).toContain(
      "closed_at < LEAST($1::timestamptz, transaction_timestamp() - ($4::integer * INTERVAL '24 hours'))",
    );
    expect(destructive.sql).toContain(
      "occurred_at < LEAST($2::timestamptz, transaction_timestamp() - ($5::integer * INTERVAL '24 hours'))",
    );
    expect(destructive.values).toEqual([
      new Date("2089-10-03T00:00:00.000Z"),
      new Date("2089-07-05T00:00:00.000Z"),
      3,
      90,
      180,
    ]);
  });

  it("keeps accepted retention bounds and count schema", async () => {
    const fixture = syntheticRuntime();
    const now = new Date("2026-10-15T12:00:00.000Z");
    const result = await fixture.repository.purgeExpired({
      now,
      closedRetentionDays: 1,
      signalRetentionDays: 1,
      batchSize: 100,
      statementTimeoutMs: 5_000,
    });
    expect(result).toEqual({ cases: 2, signals: 3 });
    expect(fixture.calls[1]?.values?.slice(0, 3)).toEqual([
      new Date("2026-10-14T12:00:00.000Z"),
      new Date("2026-10-14T12:00:00.000Z"),
      100,
    ]);
  });
});
