import { describe, expect, it, vi } from "vitest";
import {
  attemptProofCleanup,
  combineProofFailures,
  reconcileReservedProofResource,
  waitForProofEntry,
} from "./credential-transfer-proof-lifecycle.js";

describe("owned proof failure lifecycle without database access", () => {
  it("observes rejection before entry instead of waiting for an unreachable callback", async () => {
    const failure = new Error("inert setup rejected");
    const neverEntered = new Promise<void>(() => {});
    await expect(
      waitForProofEntry(neverEntered, Promise.reject(failure)),
    ).rejects.toBe(failure);
  });

  it("rejects settlement without an entry acknowledgement", async () => {
    await expect(
      waitForProofEntry(new Promise<void>(() => {}), Promise.resolve()),
    ).rejects.toThrow("PROOF_OPERATION_SETTLED_BEFORE_ENTRY");
  });

  it("entry does not require the held operation to finish", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await waitForProofEntry(Promise.resolve(), held);
    release();
    await held;
  });

  it("attempts role disposal, residue verification and close after earlier cleanup fails", async () => {
    const failure = new Error("inert request cleanup failed");
    const events: string[] = [];
    const errors = await attemptProofCleanup([
      () => {
        events.push("requests");
        throw failure;
      },
      async () => {
        events.push("authority-one");
        throw new TypeError("inert role cleanup failed");
      },
      () => {
        events.push("authority-two");
      },
      () => {
        events.push("verify-residue");
      },
      () => {
        events.push("close");
      },
    ]);
    expect(events).toEqual([
      "requests",
      "authority-one",
      "authority-two",
      "verify-residue",
      "close",
    ]);
    expect(errors[0]).toBe(failure);
    expect(errors[1]).toBeInstanceOf(TypeError);
  });

  it("preserves the original failure and deduplicates an owned pending rejection", () => {
    const primary = new Error("original proof failure");
    const cleanup = new Error("secondary cleanup failure");
    const combined = combineProofFailures(
      primary,
      [primary, cleanup],
      "proof failed",
    ) as AggregateError;
    expect(combined.errors).toEqual([primary, cleanup]);
    expect(combined.cause).toBe(primary);
    expect(combineProofFailures(primary, [], "unused")).toBe(primary);
    expect(combineProofFailures(undefined, [], "unused")).toBeUndefined();
  });

  it("keeps a cleanup that throws undefined as a failure", async () => {
    const errors = await attemptProofCleanup([
      () => {
        throw undefined;
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(
      combineProofFailures(undefined, errors, "cleanup failed"),
    ).toBeInstanceOf(AggregateError);
  });

  it("reconciles an owned creation even when its acknowledgement was lost", async () => {
    const original = new Error("inert creation acknowledgement lost");
    let state: "absent" | "owned" | "foreign" = "owned";
    const remove = vi.fn(async () => {
      state = "absent";
    });
    const absent = await reconcileReservedProofResource({
      previouslyAbsent: true,
      creationAttempted: true,
      inspect: async () => state,
      removeOwned: remove,
    });
    expect(absent).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
    expect(combineProofFailures(original, [], "unused")).toBe(original);
  });

  it("never removes an identity that was not reserved absent", async () => {
    const inspect = vi.fn(async () => "owned" as const);
    const remove = vi.fn(async () => {});
    await expect(
      reconcileReservedProofResource({
        previouslyAbsent: false,
        creationAttempted: true,
        inspect,
        removeOwned: remove,
      }),
    ).rejects.toThrow("PROOF_RESOURCE_NOT_RESERVED_ABSENT");
    expect(inspect).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not touch an unowned replacement", async () => {
    const remove = vi.fn(async () => {});
    await expect(
      reconcileReservedProofResource({
        previouslyAbsent: true,
        creationAttempted: true,
        inspect: async () => "foreign",
        removeOwned: remove,
      }),
    ).rejects.toThrow("PROOF_RESOURCE_OWNERSHIP_MISMATCH");
    expect(remove).not.toHaveBeenCalled();
  });

  it("verifies residue even when removal rejects", async () => {
    const failure = new Error("inert removal acknowledgement lost");
    const inspect = vi
      .fn()
      .mockResolvedValueOnce("owned")
      .mockResolvedValueOnce("absent");
    let caught: unknown;
    try {
      await reconcileReservedProofResource({
        previouslyAbsent: true,
        creationAttempted: true,
        inspect,
        removeOwned: async () => {
          throw failure;
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toContain(failure);
  });

  it("returns false if removal leaves owned residue", async () => {
    expect(
      await reconcileReservedProofResource({
        previouslyAbsent: true,
        creationAttempted: true,
        inspect: async () => "owned",
        removeOwned: async () => {},
      }),
    ).toBe(false);
  });

  it("does not remove absent or unattempted resources", async () => {
    const remove = vi.fn(async () => {});
    const inspect = vi.fn(async () => "absent" as const);
    expect(
      await reconcileReservedProofResource({
        previouslyAbsent: false,
        creationAttempted: false,
        inspect,
        removeOwned: remove,
      }),
    ).toBe(true);
    expect(inspect).not.toHaveBeenCalled();
    expect(
      await reconcileReservedProofResource({
        previouslyAbsent: true,
        creationAttempted: true,
        inspect,
        removeOwned: remove,
      }),
    ).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });
});
