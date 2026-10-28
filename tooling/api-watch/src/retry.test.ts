import { describe, expect, it } from "vitest";
import {
  applyRetryDecision,
  applyRetryPassDecisions,
  InMemoryApiWatchRetryStore,
} from "./retry.js";
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
  it.each([
    "SOURCE_URL_AUTHORITY_MISSING",
    "INVALID_OFFICIAL_SOURCE_RESPONSE",
    "OPERATOR_SOURCE_REQUIRED",
  ] as const)(
    "withdraws a stale transient retry after %s without refunding its budget",
    async (kind) => {
      for (const route of ["direct", "family-pass"] as const) {
        const store = new InMemoryApiWatchRetryStore();
        const now = new Date("2026-10-28T00:00:00Z");
        await applyRetryDecision({
          sourceFamily: "OZON_SELLER",
          outcome: outcome(503),
          store,
          now,
        });
        const before = await store.get("OZON_SELLER");
        expect(before?.nextRetryAt).toBeInstanceOf(Date);

        const later = new Date(now.valueOf() + 1000);
        const terminal: AcquisitionOutcome = {
          kind,
          sourceFamily: "OZON_SELLER",
          officialUrl: null,
          blockerReason: "synthetic terminal classification",
        };
        const scheduled: Date[] = [];
        const scheduleEarlier = async (at: Date) => {
          scheduled.push(at);
        };
        if (route === "direct") {
          await applyRetryDecision({
            sourceFamily: "OZON_SELLER",
            outcome: terminal,
            store,
            scheduleEarlier,
            now: later,
          });
        } else {
          await applyRetryPassDecisions({
            outcomes: [terminal],
            store,
            scheduleEarlier,
            now: later,
          });
        }
        const after = await store.get("OZON_SELLER");
        expect(after?.nextRetryAt).toBeNull();
        expect(after?.lastAttemptAt).toEqual(later);
        expect(after?.updatedAt).toEqual(later);
        expect(after?.lastResult).toBe(kind);
        expect(after?.retryCount).toBe(1);
        expect(after?.failureEpisodeId).toBe(before?.failureEpisodeId);
        expect(scheduled).toHaveLength(0);
      }
    },
  );

  it("does not create a retry state from a terminal outcome alone", async () => {
    const store = new InMemoryApiWatchRetryStore();
    await applyRetryDecision({
      sourceFamily: "OZON_SELLER",
      outcome: {
        kind: "INVALID_OFFICIAL_SOURCE_RESPONSE",
        sourceFamily: "OZON_SELLER",
        officialUrl: null,
        blockerReason: "synthetic",
      },
      store,
      now,
    });
    expect(await store.get("OZON_SELLER")).toBeUndefined();
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
