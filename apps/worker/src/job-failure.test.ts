import { describe, expect, it, vi } from "vitest";
import { JobFailureSignal } from "./job-failure.js";

describe("one-shot job failure notification", () => {
  it("latches only the first fixed event and prevents reentrant recursive delivery", () => {
    const signal = new JobFailureSignal("device-authorization-expiry");
    let calls = 0;
    const listener = vi.fn(() => {
      calls += 1;
      signal.subscribe(listener);
    });
    signal.subscribe(listener);
    expect(
      signal.emit("SCHEDULED_OPERATION_FAILED", new Error("private detail")),
    ).toBe(true);
    expect(signal.emit("STARTUP_FAILED", "arbitrary detail")).toBe(false);
    expect(calls).toBe(1);
    const late = vi.fn();
    signal.subscribe(late);
    expect(late).toHaveBeenCalledWith({
      runner: "device-authorization-expiry",
      code: "SCHEDULED_OPERATION_FAILED",
    });
  });

  it("observes sync throws and async rejection without awaiting a pending notifier", () => {
    const signal = new JobFailureSignal("otp-email");
    const syncThrow = vi.fn(() => {
      throw new Error("hidden reporting detail");
    });
    const asyncReject = vi.fn(() =>
      Promise.reject(new Error("hidden async detail")),
    );
    const pending = vi.fn(() => new Promise<void>(() => undefined));
    signal.subscribe(syncThrow);
    signal.subscribe(asyncReject);
    signal.subscribe(pending);
    expect(() =>
      signal.emit("SCHEDULED_OPERATION_FAILED", undefined),
    ).not.toThrow();
    expect(syncThrow).toHaveBeenCalledOnce();
    expect(asyncReject).toHaveBeenCalledOnce();
    expect(pending).toHaveBeenCalledOnce();
  });
});
