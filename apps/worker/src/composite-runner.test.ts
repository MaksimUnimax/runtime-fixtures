import { describe, expect, it, vi } from "vitest";
import { CompositeJobRunner } from "./composite-runner.js";
import { OtpEmailRunner } from "./otp-runner.js";
import { DeviceAuthorizationExpiryRunner } from "./device-authorization-expiry-runner.js";
import { SubscriptionLifecycleRunner } from "./subscription-lifecycle-runner.js";
import { startWorker } from "./lifecycle.js";
import { deriveAuthKeys } from "@product/auth";

const testAuthKeys = deriveAuthKeys(Buffer.alloc(32, 7));

describe("CompositeJobRunner", () => {
  it("T1-COMPOSITE-01..04 starts OTP then expiry and stops in reverse", async () => {
    const events: string[] = [];
    const otp = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(async () => void events.push("otp:start")),
      stop: vi.fn(async () => void events.push("otp:stop")),
    };
    const expiry = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
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
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const expiry = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
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
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(async () => {
        events.push("earlier:start");
      }),
      stop: vi.fn(async () => {
        events.push("earlier:stop");
      }),
    };
    const partial = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
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
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(async () => {
        events.push("earlier:start");
      }),
      stop: vi.fn(async () => {
        events.push("earlier:stop");
      }),
    };
    const later = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
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
    await expect(runner.stop()).rejects.toThrow("WORKER_DRAIN_UNPROVEN");
    expect(events).toEqual([
      "earlier:start",
      "later:start",
      "later:stop",
      "earlier:stop",
    ]);
    await expect(runner.stop()).rejects.toThrow("WORKER_DRAIN_UNPROVEN");
    expect(earlier.stop).toHaveBeenCalledOnce();
    expect(later.stop).toHaveBeenCalledOnce();
  });

  it("preserves original startup error even if cleanup rejects and still unwinds earlier jobs", async () => {
    const startupError = new Error("synthetic startup failure");
    const cleanupError = new Error("synthetic cleanup failure");
    const events: string[] = [];
    const earlier = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(async () => {
        events.push("earlier:start");
      }),
      stop: vi.fn(async () => {
        events.push("earlier:stop");
      }),
    };
    const partial = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
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
    // Repeated stop observes the same unsuccessful drain, never false success.
    await expect(runner.stop()).rejects.toThrow("WORKER_DRAIN_UNPROVEN");
    expect(earlier.stop).toHaveBeenCalledOnce();
    expect(partial.stop).toHaveBeenCalledOnce();
  });

  it("unwinds attempted partially started child before database close in the real worker lifecycle", async () => {
    const events: string[] = [];
    const startupError = new Error("synthetic OTP initial tick failed");
    let timerArmed = false;
    const otp = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
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
      startWorker(db, new CompositeJobRunner([otp]), {
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

  it("quiesces every attempted child before the first slow drain and shares stop", async () => {
    const events: string[] = [];
    let release!: () => void;
    const slow = {
      quiesce: vi.fn(() => {
        events.push("slow:quiesce");
      }),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        events.push("slow:stop");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }),
    };
    const fast = {
      quiesce: vi.fn(() => {
        events.push("fast:quiesce");
      }),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        events.push("fast:stop");
      }),
    };
    const runner = new CompositeJobRunner([fast, slow]);
    await runner.start();
    const first = runner.stop();
    const second = runner.stop();
    expect(second).toBe(first);
    expect(events).toEqual(["fast:quiesce", "slow:quiesce"]);
    await vi.waitFor(() => expect(events.slice(2)).toEqual(["slow:stop"]));
    release();
    await first;
    expect(events).toEqual([
      "fast:quiesce",
      "slow:quiesce",
      "slow:stop",
      "fast:stop",
    ]);
  });

  it("does not admit a later child while an earlier start barrier is pending", async () => {
    let release!: () => void;
    const first = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
      stop: vi.fn(async () => undefined),
    };
    const later = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const runner = new CompositeJobRunner([first, later]);
    const starting = runner.start();
    await Promise.resolve();
    runner.quiesce();
    release();
    await starting;
    expect(later.start).not.toHaveBeenCalled();
    await runner.stop();
  });

  it("drains nested composites through the same reverse-order shutdown", async () => {
    const events: string[] = [];
    const makeChild = (name: string) => ({
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(async () => {
        events.push(`${name}:start`);
      }),
      stop: vi.fn(async () => {
        events.push(`${name}:stop`);
      }),
    });
    const inner = new CompositeJobRunner([
      makeChild("inner-a"),
      makeChild("inner-b"),
    ]);
    const outer = new CompositeJobRunner([inner, makeChild("outer")]);
    await outer.start();
    await outer.stop();
    expect(events).toEqual([
      "inner-a:start",
      "inner-b:start",
      "outer:start",
      "outer:stop",
      "inner-b:stop",
      "inner-a:stop",
    ]);
  });

  it("attempts every quiesce even when one throws and accepts successful defensive stops", async () => {
    const first = {
      quiesce: vi.fn(() => {
        throw new Error("private quiesce detail");
      }),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const second = {
      quiesce: vi.fn(),
      onFailure: vi.fn(() => () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const runner = new CompositeJobRunner([first, second]);
    await runner.start();
    runner.quiesce();
    expect(first.quiesce).toHaveBeenCalledOnce();
    expect(second.quiesce).toHaveBeenCalledOnce();
    await runner.stop();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });
});

const scenarios = [
  {
    name: "OTP email",
    create: (failure: Error) =>
      new OtpEmailRunner(
        {
          query: vi.fn(async (): Promise<never> => {
            throw failure;
          }),
        },
        testAuthKeys,
        { sendLoginOtp: vi.fn(async () => ({})) },
      ),
  },
  {
    name: "device authorization expiry",
    create: (failure: Error) =>
      new DeviceAuthorizationExpiryRunner({
        expireDue: vi.fn(async () => {
          throw failure;
        }),
      }),
  },
  {
    name: "subscription lifecycle",
    create: (failure: Error) =>
      new SubscriptionLifecycleRunner({
        processDue: vi.fn(async () => {
          throw failure;
        }),
      }),
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
