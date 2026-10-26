import { describe, expect, it } from "vitest";
import {
  claimDueApiWatchAttempt,
  emptyApiWatchAttemptFence,
  enterClaimedApiWatchAttempt,
  expireApiWatchAttemptFence,
  releaseUnenteredApiWatchAttempt,
} from "./retry-attempt-fence.js";

const t0 = new Date("2026-10-26T00:00:00Z");
const at = (sec: number) => new Date(t0.valueOf() + 1000 * sec);
const runA = "11111111-1111-4111-8111-111111111111";
const runB = "22222222-2222-4222-8222-222222222222";
const lease = { runId: runA, leaseExpiresAt: at(900) };

describe("C03 per-family durable retry fence state", () => {
  it("claims only a due retry with a valid live lease and preserves input", () => {
    const initial = emptyApiWatchAttemptFence("WILDBERRIES", t0);
    expect(
      claimDueApiWatchAttempt({
        state: initial,
        nextRetryAt: at(60),
        lease,
        now: at(59),
      }),
    ).toBeNull();
    expect(
      claimDueApiWatchAttempt({
        state: initial,
        nextRetryAt: null,
        lease,
        now: at(60),
      }),
    ).toBeNull();
    const claimed = claimDueApiWatchAttempt({
      state: initial,
      nextRetryAt: at(60),
      lease,
      now: at(60),
    });
    expect(claimed?.claimStage).toBe("CLAIMED");
    expect(claimed?.claimedRunId).toBe(runA);
    expect(initial.claimStage).toBe("IDLE");
    expect(initial.claimedRunId).toBeNull();
    expect(initial.updatedAt.toISOString()).toBe(t0.toISOString());
  });

  it("requires exact ownership and an unexpired lease before egress", () => {
    const initial = emptyApiWatchAttemptFence("OZON_SELLER", t0);
    const claimed = claimDueApiWatchAttempt({
      state: initial,
      nextRetryAt: t0,
      lease,
      now: at(2),
    })!;
    expect(() =>
      enterClaimedApiWatchAttempt({
        state: claimed,
        lease: { ...lease, runId: runB },
        now: at(3),
      }),
    ).toThrow("API_WATCH_RETRY_FENCE_STALE_OWNER");
    expect(() =>
      enterClaimedApiWatchAttempt({
        state: claimed,
        lease,
        now: at(900),
      }),
    ).toThrow("API_WATCH_RETRY_FENCE_LEASE_EXPIRED");
    const entered = enterClaimedApiWatchAttempt({
      state: claimed,
      lease,
      now: at(3),
    });
    expect(entered.claimStage).toBe("ENTERED");
    expect(entered.enteredAt?.toISOString()).toBe(at(3).toISOString());
    expect(claimed.enteredAt).toBeNull();
  });

  it("rejects a duplicate concurrent claim and an invalid active run", () => {
    const claimed = claimDueApiWatchAttempt({
      state: emptyApiWatchAttemptFence("OZON_PERFORMANCE", t0),
      nextRetryAt: t0,
      lease,
      now: at(1),
    })!;
    expect(() =>
      claimDueApiWatchAttempt({
        state: claimed,
        nextRetryAt: t0,
        lease: { runId: runB, leaseExpiresAt: at(1000) },
        now: at(2),
      }),
    ).toThrow("API_WATCH_RETRY_ALREADY_CLAIMED");
    expect(() =>
      claimDueApiWatchAttempt({
        state: emptyApiWatchAttemptFence("OZON_SELLER", t0),
        nextRetryAt: t0,
        lease: { runId: runB, leaseExpiresAt: at(1) },
        now: at(2),
      }),
    ).toThrow("API_WATCH_RETRY_FENCE_LEASE_EXPIRED");
  });

  it("returns an unentered claim without consuming retry timing", () => {
    const initial = emptyApiWatchAttemptFence("WILDBERRIES", t0);
    const due = at(60);
    const claimed = claimDueApiWatchAttempt({
      state: initial,
      nextRetryAt: due,
      lease,
      now: due,
    })!;
    expect(() =>
      releaseUnenteredApiWatchAttempt({
        state: claimed,
        runId: runB,
        now: at(61),
      }),
    ).toThrow("API_WATCH_RETRY_FENCE_STALE_OWNER");
    const released = releaseUnenteredApiWatchAttempt({
      state: claimed,
      runId: runA,
      now: at(61),
    });
    expect(released.claimStage).toBe("IDLE");
    expect(released.outcomeUnknown).toBe(false);
    expect(
      claimDueApiWatchAttempt({
        state: released,
        nextRetryAt: due,
        lease: { runId: runB, leaseExpiresAt: at(1200) },
        now: at(62),
      })?.claimStage,
    ).toBe("CLAIMED");
  });

  it("expires a pre-egress claim safely but quarantines an entered request", () => {
    const claimed = claimDueApiWatchAttempt({
      state: emptyApiWatchAttemptFence("WILDBERRIES", t0),
      nextRetryAt: t0,
      lease,
      now: at(1),
    })!;
    expect(() =>
      expireApiWatchAttemptFence({
        state: claimed,
        priorRunId: runA,
        priorLeaseExpiresAt: at(900),
        now: at(899),
      }),
    ).toThrow("API_WATCH_RETRY_FENCE_NOT_EXPIRED");
    const recovered = expireApiWatchAttemptFence({
      state: claimed,
      priorRunId: runA,
      priorLeaseExpiresAt: at(900),
      now: at(900),
    });
    expect(recovered.outcomeUnknown).toBe(false);
    expect(recovered.claimStage).toBe("IDLE");
    const entered = enterClaimedApiWatchAttempt({
      state: claimed,
      lease,
      now: at(2),
    });
    const quarantined = expireApiWatchAttemptFence({
      state: entered,
      priorRunId: runA,
      priorLeaseExpiresAt: at(900),
      now: at(900),
    });
    expect(quarantined.claimStage).toBe("IDLE");
    expect(quarantined.outcomeUnknown).toBe(true);
    expect(() =>
      claimDueApiWatchAttempt({
        state: quarantined,
        nextRetryAt: t0,
        lease: { runId: runB, leaseExpiresAt: at(1800) },
        now: at(901),
      }),
    ).toThrow("API_WATCH_RETRY_OUTCOME_UNKNOWN_NO_RETRY");
    expect(() =>
      expireApiWatchAttemptFence({
        state: entered,
        priorRunId: runB,
        priorLeaseExpiresAt: at(900),
        now: at(901),
      }),
    ).toThrow("API_WATCH_RETRY_FENCE_STALE_OWNER");
  });

  it("never allows an entered attempt to be released as if unstarted", () => {
    const claimed = claimDueApiWatchAttempt({
      state: emptyApiWatchAttemptFence("OZON_SELLER", t0),
      nextRetryAt: t0,
      lease,
      now: at(1),
    })!;
    const entered = enterClaimedApiWatchAttempt({
      state: claimed,
      lease,
      now: at(2),
    });
    expect(() =>
      releaseUnenteredApiWatchAttempt({
        state: entered,
        runId: runA,
        now: at(3),
      }),
    ).toThrow("API_WATCH_RETRY_WAS_ENTERED_OR_NOT_CLAIMED");
  });

  it("rejects forged family values and a nonboolean UNKNOWN flag at runtime", () => {
    expect(() =>
      emptyApiWatchAttemptFence("UNAUTHORIZED_SOURCE" as never, t0),
    ).toThrow("API_WATCH_RETRY_FENCE_FAMILY_INVALID");
    expect(() =>
      claimDueApiWatchAttempt({
        state: {
          ...emptyApiWatchAttemptFence("OZON_SELLER", t0),
          sourceFamily: "OTHER_MARKETPLACE" as never,
        },
        nextRetryAt: t0,
        lease,
        now: at(1),
      }),
    ).toThrow("API_WATCH_RETRY_FENCE_FAMILY_INVALID");
    expect(() =>
      claimDueApiWatchAttempt({
        state: {
          ...emptyApiWatchAttemptFence("OZON_SELLER", t0),
          outcomeUnknown: "false" as never,
        },
        nextRetryAt: t0,
        lease,
        now: at(1),
      }),
    ).toThrow("API_WATCH_RETRY_FENCE_STATE_INVALID");
  });

  it("refuses invalid state and a reversed clock", () => {
    expect(() =>
      claimDueApiWatchAttempt({
        state: {
          ...emptyApiWatchAttemptFence("WILDBERRIES", t0),
          claimedRunId: runA,
        },
        nextRetryAt: t0,
        lease,
        now: at(1),
      }),
    ).toThrow("API_WATCH_RETRY_FENCE_STATE_INVALID");
    expect(() =>
      claimDueApiWatchAttempt({
        state: emptyApiWatchAttemptFence("WILDBERRIES", at(4)),
        nextRetryAt: t0,
        lease,
        now: at(3),
      }),
    ).toThrow("API_WATCH_RETRY_FENCE_TIME_REVERSED");
  });
});
