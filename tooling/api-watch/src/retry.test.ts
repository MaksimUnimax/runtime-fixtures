import { describe, expect, it } from "vitest";
import { applyRetryDecision, InMemoryApiWatchRetryStore } from "./retry.js";
import type { AcquisitionOutcome } from "./types.js";

const now = new Date("2026-09-22T00:00:00.000Z");
function outcome(
  httpStatus?: number,
  blockerReason = "network failure",
  retryAfterSeconds?: number,
): AcquisitionOutcome {
  return {
    kind: "SOURCE_TEMPORARILY_UNAVAILABLE",
    sourceFamily: "OZON_SELLER",
    officialUrl: "https://fixture.invalid/source.json",
    blockerReason,
    httpStatus,
    retryAfterSeconds,
  };
}
describe("A9 bounded retry", () => {
  it("uses 15m then 60m and stops after two network retries", async () => {
    const store = new InMemoryApiWatchRetryStore();
    const scheduled: Date[] = [];
    const schedule = async (at: Date): Promise<void> => {
      scheduled.push(at);
    };
    const first = await applyRetryDecision({
      sourceFamily: "OZON_SELLER",
      outcome: outcome(),
      store,
      now,
      scheduleEarlier: schedule,
    });
    const second = await applyRetryDecision({
      sourceFamily: "OZON_SELLER",
      outcome: outcome(),
      store,
      now: new Date(now.valueOf() + 1),
      scheduleEarlier: schedule,
    });
    const third = await applyRetryDecision({
      sourceFamily: "OZON_SELLER",
      outcome: outcome(),
      store,
      now: new Date(now.valueOf() + 2),
      scheduleEarlier: schedule,
    });
    expect(first?.retryCount).toBe(1);
    expect(second?.retryCount).toBe(2);
    expect(third?.nextRetryAt).toBeNull();
    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]!.valueOf() - now.valueOf()).toBe(15 * 60 * 1000);
    expect(scheduled[1]!.valueOf() - (now.valueOf() + 1)).toBe(60 * 60 * 1000);
  });
  it("clamps Retry-After for 429 and permits one retry", async () => {
    const store = new InMemoryApiWatchRetryStore();
    const low = await applyRetryDecision({
      sourceFamily: "OZON_SELLER",
      outcome: outcome(429, "rate limited", 1),
      store,
      now,
    });
    expect(
      low?.nextRetryAt ? low.nextRetryAt.valueOf() - now.valueOf() : undefined,
    ).toBe(5 * 60 * 1000);
    const high = await applyRetryDecision({
      sourceFamily: "OZON_SELLER",
      outcome: outcome(429, "rate limited", 99 * 60 * 60),
      store,
      now: new Date(now.valueOf() + 1),
    });
    expect(high?.nextRetryAt).toBeNull();
  });
  it("does not retry authority blockers and clears on success", async () => {
    const store = new InMemoryApiWatchRetryStore();
    await applyRetryDecision({
      sourceFamily: "OZON_SELLER",
      outcome: {
        kind: "SOURCE_URL_AUTHORITY_MISSING",
        sourceFamily: "OZON_SELLER",
        officialUrl: null,
        blockerReason: "missing",
      },
      store,
      now,
    });
    expect(await store.get("OZON_SELLER")).toBeUndefined();
    await applyRetryDecision({
      sourceFamily: "OZON_SELLER",
      outcome: outcome(),
      store,
      now,
    });
    await applyRetryDecision({
      sourceFamily: "OZON_SELLER",
      outcome: {
        kind: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
        sourceFamily: "OZON_SELLER",
        officialUrl: "https://fixture.invalid/source.json",
        bytes: new Uint8Array(),
        sha256: "a",
        sizeBytes: 0,
        specVersion: "3.0.0",
        artifactType: "JSON",
        finalUrl: "https://fixture.invalid/source.json",
        parserResult: {},
        validationResult: {},
      },
      store,
      now,
    });
    expect(await store.get("OZON_SELLER")).toBeUndefined();
  });
});
