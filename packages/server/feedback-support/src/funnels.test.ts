import {
  FeedbackCommercialFunnelStageV1Schema,
  FeedbackFunnelResponseV1Schema,
} from "@product/contracts";
import { describe, expect, it } from "vitest";
import {
  calculateFunnel,
  funnelWindow,
  type FunnelSignalRecord,
} from "./funnels.js";

const accountA = "00000000-0000-4000-8000-000000000001";
const accountB = "00000000-0000-4000-8000-000000000002";
const base = new Date("2026-09-01T00:00:00.000Z");
const row = (
  event: FunnelSignalRecord["event"],
  accountId: string,
  seconds: number,
  extra: Partial<FunnelSignalRecord> = {},
): FunnelSignalRecord => ({
  event,
  accountId,
  subjectId: null,
  occurredAt: new Date(base.getTime() + seconds * 1000),
  productVersion: "1.0.0",
  extensionVersion: "1.0.0",
  releaseIdentity: "rc-1",
  browserFamily: "chromium",
  browserVersion: "151",
  marketplace: "OZON",
  supportCode: null,
  ...extra,
});

describe("M1-C privacy-safe funnel calculations", () => {
  it("defines onboarding order, account cohorts, and first occurrence semantics", () => {
    const result = calculateFunnel({
      funnel: "ONBOARDING",
      from: base,
      to: new Date("2026-09-02T00:00:00.000Z"),
      records: [
        row("first_start", accountA, 40),
        row("registration_started", accountA, 0),
        row("account_created", accountA, 10),
        row("device_activated", accountA, 20),
        row("first_store_added", accountA, 30),
        row("first_start", accountA, 41),
        row("registration_started", accountB, 0),
        row("account_created", accountB, 5),
      ],
    });
    expect(result.cohortCount).toBe(2);
    expect(result.stages.map((stage) => stage.reachedCount)).toEqual([
      2, 2, 1, 1, 1,
    ]);
    expect(result.stages[3]?.conversionFromPrevious).toBe(1);
    expect(result.stages[3]?.cumulativeConversion).toBe(0.5);
    expect(result.stages[4]?.cumulativeConversion).toBe(0.5);
  });

  it("does not count a later funnel stage when its preceding stage was missed", () => {
    const result = calculateFunnel({
      funnel: "FIRST_VALUE",
      from: base,
      to: new Date("2026-09-02T00:00:00.000Z"),
      records: [
        row("account_created", accountA, 0),
        row("device_activated", accountA, 10),
        row("first_store_added", accountA, 20),
        row("first_start", accountA, 30),
        row("account_created", accountB, 0),
        row("first_store_added", accountB, 5),
        row("first_start", accountB, 6),
      ],
    });
    expect(result.cohortCount).toBe(2);
    expect(result.stages.map((stage) => stage.reachedCount)).toEqual([
      2, 1, 1, 1,
    ]);
    expect(result.stages[2]?.conversionFromPrevious).toBe(1);
    expect(FeedbackFunnelResponseV1Schema.safeParse(result).success).toBe(true);
  });

  it("counts the first eligible event after the previous reached stage", () => {
    const result = calculateFunnel({
      funnel: "FIRST_VALUE",
      from: base,
      to: new Date("2026-09-02T00:00:00.000Z"),
      records: [
        row("account_created", accountA, 0),
        row("first_store_added", accountA, 2, { marketplace: "WILDBERRIES" }),
        row("device_activated", accountA, 3),
        row("first_store_added", accountA, 5, { marketplace: "OZON" }),
        row("first_start", accountA, 7),
      ],
    });
    expect(result.stages.map((stage) => stage.reachedCount)).toEqual([
      1, 1, 1, 1,
    ]);
    expect(result.stages[2]?.medianSeconds).toBe(5);
    expect(result.breakdowns).toContainEqual({
      stage: "first_store_added",
      dimension: "marketplace",
      value: "OZON",
      count: 1,
    });
    expect(result.breakdowns).not.toContainEqual({
      stage: "first_store_added",
      dimension: "marketplace",
      value: "WILDBERRIES",
      count: 1,
    });
  });

  it("requires ordered support events before resolved and closed conversions", () => {
    const result = calculateFunnel({
      funnel: "SUPPORT",
      from: base,
      to: new Date("2026-09-02T00:00:00.000Z"),
      records: [
        row("feedback_case_created", accountA, 0, { subjectId: "case-a" }),
        row("feedback_case_resolved", accountA, 2, { subjectId: "case-a" }),
        row("feedback_case_closed", accountA, 3, { subjectId: "case-a" }),
        row("feedback_case_created", accountB, 0, { subjectId: "case-b" }),
        row("feedback_case_triaged", accountB, 1, { subjectId: "case-b" }),
        row("feedback_case_resolved", accountB, 2, { subjectId: "case-b" }),
        row("feedback_case_closed", accountB, 3, { subjectId: "case-b" }),
      ],
    });
    expect(result.stages.map((stage) => stage.reachedCount)).toEqual([
      2, 1, 1, 1,
    ]);
    expect(FeedbackFunnelResponseV1Schema.safeParse(result).success).toBe(true);
  });

  it("keeps account counts stable across devices, stores, and marketplace breakdowns", () => {
    const records = [
      row("account_created", accountA, 0),
      row("device_activated", accountA, 1, { subjectId: "device-1" }),
      row("device_activated", accountA, 2, {
        subjectId: "device-2",
        marketplace: "WILDBERRIES",
      }),
      row("first_store_added", accountA, 3, { marketplace: "OZON" }),
      row("first_store_added", accountA, 4, { marketplace: "WILDBERRIES" }),
      row("first_start", accountA, 5),
    ];
    const result = calculateFunnel({
      funnel: "FIRST_VALUE",
      from: base,
      to: new Date("2026-09-02T00:00:00.000Z"),
      records,
    });
    expect(result.cohortCount).toBe(1);
    expect(result.stages.every((stage) => stage.reachedCount === 1)).toBe(true);
    expect(
      result.breakdowns
        .filter((item) => item.stage === "device_activated")
        .map((item) => item.count),
    ).toContain(1);
  });

  it("calculates explicit windows, median and p90 without exposing identities", () => {
    const result = calculateFunnel({
      funnel: "FIRST_VALUE",
      from: base,
      to: new Date("2026-09-02T00:00:00.000Z"),
      records: [
        row("account_created", accountA, 0),
        row("device_activated", accountA, 10),
        row("first_store_added", accountA, 20),
        row("first_start", accountA, 30),
        row("account_created", accountB, 0),
        row("device_activated", accountB, 20),
        row("first_store_added", accountB, 40),
        row("first_start", accountB, 60),
      ],
    });
    expect(result.stages[1]?.medianSeconds).toBe(15);
    expect(result.stages[1]?.p90Seconds).toBe(20);
    expect(JSON.stringify(result)).not.toContain(accountA);
    expect(
      funnelWindow({ window: "7D" }, new Date("2026-09-08T00:00:00.000Z")),
    ).toEqual({
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-08T00:00:00.000Z"),
    });
  });

  it("supports support status funnel and safe error breakdowns", () => {
    const caseA = "case-a";
    const result = calculateFunnel({
      funnel: "SUPPORT",
      from: base,
      to: new Date("2026-09-02T00:00:00.000Z"),
      records: [
        row("feedback_case_created", accountA, 0, {
          subjectId: caseA,
          supportCode: "AUTH",
        }),
        row("feedback_case_triaged", accountA, 10, {
          subjectId: caseA,
          supportCode: "AUTH",
        }),
        row("feedback_case_resolved", accountA, 20, {
          subjectId: caseA,
          supportCode: "AUTH",
        }),
        row("feedback_case_closed", accountA, 30, {
          subjectId: caseA,
          supportCode: "AUTH",
        }),
      ],
    });
    expect(result.cohortCount).toBe(1);
    expect(result.stages[3]?.reachedCount).toBe(1);
    expect(result.breakdowns).toContainEqual({
      stage: "feedback_case_created",
      dimension: "supportCode",
      value: "AUTH",
      count: 1,
    });
  });

  it("represents future commercial stages without making them runtime events", () => {
    expect(
      FeedbackCommercialFunnelStageV1Schema.parse("checkout_started"),
    ).toBe("checkout_started");
    expect(() =>
      FeedbackCommercialFunnelStageV1Schema.parse("first_start"),
    ).toThrow();
  });

  it("handles empty cohorts and bounded synthetic volume", () => {
    const empty = calculateFunnel({
      funnel: "ONBOARDING",
      from: base,
      to: new Date(base.getTime() + 1000),
      records: [],
    });
    expect(empty.cohortCount).toBe(0);
    expect(
      empty.stages.every(
        (stage) => stage.reachedCount === 0 && stage.medianSeconds === null,
      ),
    ).toBe(true);
    const records: FunnelSignalRecord[] = [];
    for (let i = 0; i < 500; i++) {
      const id = `account-${i}`;
      records.push(row("account_created", id, i));
      records.push(row("device_activated", id, i + 1));
      records.push(row("first_store_added", id, i + 2));
      records.push(row("first_start", id, i + 3));
    }
    const started = performance.now();
    const result = calculateFunnel({
      funnel: "FIRST_VALUE",
      from: base,
      to: new Date("2026-09-02T00:00:00.000Z"),
      records,
    });
    expect(result.cohortCount).toBe(500);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
