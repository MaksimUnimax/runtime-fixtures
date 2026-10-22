import { describe, expect, it } from "vitest";
import { createFeedbackSupportRepository } from "./feedback-support-repository.js";
import type { DatabaseRuntime } from "./index.js";

const accountId = "00000000-0000-4000-8000-000000000001";
const at = (seconds: number) =>
  new Date(Date.parse("2026-09-01T00:00:00.000Z") + seconds * 1000);
type SignalRow = {
  id: string;
  event: string;
  accountId: string;
  subjectId: null;
  occurredAt: Date;
  productVersion: string;
  extensionVersion: string;
  releaseIdentity: string;
  browserFamily: string;
  browserVersion: string;
  marketplace: string | null;
  supportCode: null;
};
const signal = (
  number: string,
  event: string,
  seconds: number,
  marketplace: string | null = null,
): SignalRow => ({
  id: "00000000-0000-4000-8000-" + number.padStart(12, "0"),
  event,
  accountId,
  subjectId: null,
  occurredAt: at(seconds),
  productVersion: "1.0.0",
  extensionVersion: "1.0.0",
  releaseIdentity: "rc-1",
  browserFamily: "chromium",
  browserVersion: "151",
  marketplace,
  supportCode: null,
});
const baseRows = [
  signal("1", "account_created", 0),
  signal("2", "device_activated", 1),
  signal("4", "first_store_added", 2, "WILDBERRIES"),
  signal("3", "first_store_added", 2, "OZON"),
  signal("5", "first_start", 3),
];

describe("B06 support funnel stable SQL event tie ordering (synthetic, no PostgreSQL)", () => {
  it.each([false, true])(
    "orders equal-time events deterministically before aggregation (reverse=%s)",
    async (reverse) => {
      let generatedSql = "";
      const rawRows = reverse ? [...baseRows].reverse() : [...baseRows];
      const query = async (sql: string, _params?: unknown[]) => {
        if (!sql.includes("FROM feedback_signal_events WHERE"))
          throw new Error("Unexpected synthetic SQL");
        generatedSql = sql;
        // Model the database's documented ORDER BY semantics only when
        // the real query actually requests that order.
        const selected = sql.includes("ORDER BY occurred_at ASC, id ASC")
          ? [...rawRows].sort(
              (a, b) =>
                a.occurredAt.getTime() - b.occurredAt.getTime() ||
                a.id.localeCompare(b.id),
            )
          : rawRows;
        return {
          rows: selected.map(({ id: _id, ...record }) => record),
        };
      };
      const repo = createFeedbackSupportRepository({
        query,
      } as unknown as DatabaseRuntime);
      const result = await repo.aggregateFunnel({
        funnel: "FIRST_VALUE",
        window: "30D",
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-02T00:00:00.000Z",
      });
      expect(generatedSql).toContain("ORDER BY occurred_at ASC, id ASC");
      expect(result.cohortCount).toBe(1);
      expect(result.stages.map((stage) => stage.reachedCount)).toEqual([
        1, 1, 1, 1,
      ]);
      expect(
        result.breakdowns.filter(
          (item) =>
            item.stage === "first_store_added" &&
            item.dimension === "marketplace",
        ),
      ).toEqual([
        {
          stage: "first_store_added",
          dimension: "marketplace",
          value: "OZON",
          count: 1,
        },
      ]);
    },
  );
});
