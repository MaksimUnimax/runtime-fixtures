import { describe, expect, it, vi } from "vitest";
import { CompositeJobRunner } from "./composite-runner.js";
import { OtpEmailRunner } from "./otp-runner.js";
import { DeviceAuthorizationExpiryRunner } from "./device-authorization-expiry-runner.js";
import { SubscriptionLifecycleRunner } from "./subscription-lifecycle-runner.js";
import { startWorker } from "./lifecycle.js";

describe("CompositeJobRunner", () => {
  it("T1-COMPOSITE-01..04 starts OTP then expiry and stops in reverse", async () => {
    const events: string[] = [];
    const otp = {
      start: vi.fn(async () => void events.push("otp:start")),
      stop: vi.fn(async () => void events.push("otp:stop")),
    };
    const expiry = {
      start: vi.fn(async () => void events.push("expiry:start")),
      stop: vi.fn(async () => void events.push("expiry:stop")),
    };
    const runner = new CompositeJobRunner([otp, expiry]);
    await runner.start();
    await runner.stop();
    await runner.stop();
    expect(events).toEqual([
      "otp:start",
      "expiry:start",
      "expiry:stop",
      "otp:stop",
    ]);
  });

  it("T1-COMPOSITE-05..07 unwinds first child and preserves the startup error", async () => {
    const failure = new Error("expiry unavailable");
    const otp = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const expiry = {
      start: vi.fn().mockRejectedValue(failure),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new CompositeJobRunner([otp, expiry]);
    await expect(runner.start()).rejects.toBe(failure);
    expect(otp.stop).toHaveBeenCalledOnce();
    expect(expiry.stop).toHaveBeenCalledOnce();
    await runner.stop();
    expect(otp.stop).toHaveBeenCalledOnce();
  });

  it("unwinds partial start before earlier jobs and does not leave its timer armed", async () => {
    const events: string[] = [];
    const startupError = new Error("synthetic partially started job failure");
    let timerArmed = false;
    const earlier = {
      start: vi.fn(async () => {
        events.push("earlier:start");
      }),
      stop: vi.fn(async () => {
        events.push("earlier:stop");
      }),
    };
    const partial = {
      start: vi.fn(async () => {
        events.push("partial:start");
        timerArmed = true;
        throw startupError;
      }),
      stop: vi.fn(async () => {
        events.push("partial:stop");
        timerArmed = false;
      }),
    };
    const runner = new CompositeJobRunner([earlier, partial]);
    await expect(runner.start()).rejects.toBe(startupError);
    expect(timerArmed).toBe(false);
    expect(events).toEqual([
      "earlier:start",
      "partial:start",
      "partial:stop",
      "earlier:stop",
    ]);
    await runner.stop();
    expect(partial.stop).toHaveBeenCalledOnce();
    expect(earlier.stop).toHaveBeenCalledOnce();
  });

  it("attempts all reverse-order stops even if the first throws and reports that error", async () => {
    const events: string[] = [];
    const failure = new Error("synthetic stop failure");
    const earlier = {
      start: vi.fn(async () => {
        events.push("earlier:start");
      }),
      stop: vi.fn(async () => {
        events.push("earlier:stop");
      }),
    };
    const later = {
      start: vi.fn(async () => {
        events.push("later:start");
      }),
      stop: vi.fn(async () => {
        events.push("later:stop");
        throw failure;
      }),
    };
    const runner = new CompositeJobRunner([earlier, later]);
    await runner.start();
    await expect(runner.stop()).rejects.toBe(failure);
    expect(events).toEqual([
      "earlier:start",
      "later:start",
      "later:stop",
      "earlier:stop",
    ]);
    await runner.stop();
    expect(earlier.stop).toHaveBeenCalledOnce();
    expect(later.stop).toHaveBeenCalledOnce();
  });

  it("preserves original startup error even if cleanup rejects and still unwinds earlier jobs", async () => {
    const startupError = new Error("synthetic startup failure");
    const cleanupError = new Error("synthetic cleanup failure");
    const events: string[] = [];
    const earlier = {
      start: vi.fn(async () => {
        events.push("earlier:start");
      }),
      stop: vi.fn(async () => {
        events.push("earlier:stop");
      }),
    };
    const partial = {
      start: vi.fn(async () => {
        events.push("partial:start");
        throw startupError;
      }),
      stop: vi.fn(async () => {
        events.push("partial:stop");
        throw cleanupError;
      }),
    };
    const runner = new CompositeJobRunner([earlier, partial]);
    await expect(runner.start()).rejects.toBe(startupError);
    expect(events).toEqual([
      "earlier:start",
      "partial:start",
      "partial:stop",
      "earlier:stop",
    ]);
    await runner.stop();
    expect(earlier.stop).toHaveBeenCalledOnce();
    expect(partial.stop).toHaveBeenCalledOnce();
  });

  it("unwinds attempted partially started child before database close in the real worker lifecycle", async () => {
    const events: string[] = [];
    const startupError = new Error("synthetic OTP initial tick failed");
    let timerArmed = false;
    const otp = {
      start: vi.fn(async () => {
        events.push("otp:start");
        timerArmed = true;
        throw startupError;
      }),
      stop: vi.fn(async () => {
        events.push("otp:stop");
        timerArmed = false;
      }),
    };
    const db = {
      ready: vi.fn(async () => {
        events.push("database:ready");
      }),
      close: vi.fn(async () => {
        events.push("database:close");
      }),
    };
    await expect(
      startWorker(db as never, new CompositeJobRunner([otp]), {
        info: vi.fn(),
      }),
    ).rejects.toBe(startupError);
    expect(timerArmed).toBe(false);
    expect(otp.stop).toHaveBeenCalledOnce();
    expect(db.close).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "database:ready",
      "otp:start",
      "otp:stop",
      "database:close",
    ]);
  });
});

const scenarios = [
  {
    name: "OTP email",
    create: (failure: Error) =>
      new OtpEmailRunner(
        {
          query: vi.fn(async () => {
            throw failure;
          }),
        } as never,
        {} as never,
        {} as never,
      ),
  },
  {
    name: "device authorization expiry",
    create: (failure: Error) =>
      new DeviceAuthorizationExpiryRunner({
        expireDue: vi.fn(async () => {
          throw failure;
        }),
      } as never),
  },
  {
    name: "subscription lifecycle",
    create: (failure: Error) =>
      new SubscriptionLifecycleRunner({
        processDue: vi.fn(async () => {
          throw failure;
        }),
      } as never),
  },
];

describe("worker runner initial-start failure cancels their intervals", () => {
  it.each(scenarios)(
    "$name arms an interval before initial tick rejection and CompositeJobRunner clears it",
    async ({ name, create }) => {
      vi.useFakeTimers();
      try {
        const failure = new Error(
          "synthetic initial database operation failure for " + name,
        );
        const child = create(failure);
        const composite = new CompositeJobRunner([child]);
        await expect(composite.start()).rejects.toBe(failure);
        expect(vi.getTimerCount()).toBe(0);
        await composite.stop();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
