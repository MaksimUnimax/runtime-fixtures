import { describe, expect, it } from "vitest";
import { BillingReconciliationRunner } from "./billing-reconciliation-runner.js";
import { SubscriptionLifecycleRunner } from "./subscription-lifecycle-runner.js";
import type { JobRunner } from "./lifecycle.js";
const claim = {
  paymentId: "11111111-1111-4111-8111-111111111111",
  provider: "simulator",
  providerPaymentId: "p",
  accountId: "22222222-2222-4222-8222-222222222222",
  priceRevisionId: "33333333-3333-4333-8333-333333333333",
  amountMinor: 1,
  currency: "RUB",
  paymentState: "PENDING" as const,
  createdAt: new Date("2026-09-07T11:00:00Z"),
  attemptCount: 1,
  leaseToken: "44444444-4444-4444-8444-444444444444",
};
describe("P5.5 worker runners", () => {
  it("billing tick claims a bounded batch", async () => {
    let n = 0;
    const runner = new BillingReconciliationRunner({
      batchSize: 2,
      statusPort: {
        providerKey: "simulator",
        fetchPaymentStatus: async () => ({ kind: "NOT_FOUND" as const }),
      },
      repository: {
        claimDue: async (v) => {
          n = v.batchSize;
          return [];
        },
        reschedule: async () => ({
          kind: "RESCHEDULED",
          code: "PROVIDER_NOT_FOUND" as const,
        }),
        applyStatus: async () => ({
          kind: "APPLIED",
          paymentId: claim.paymentId,
        }),
        blockUnsupported: async () => ({
          kind: "BLOCKED",
          paymentId: claim.paymentId,
        }),
      },
    });
    expect(await runner.tick("c")).toEqual({ claimed: 0, completed: 0 });
    expect(n).toBe(2);
  });
  it("billing tick completes each claim", async () => {
    let completed = 0;
    const runner = new BillingReconciliationRunner({
      statusPort: {
        providerKey: "simulator",
        fetchPaymentStatus: async () => ({ kind: "NOT_FOUND" as const }),
      },
      repository: {
        claimDue: async () => [claim],
        reschedule: async () => {
          completed++;
          return { kind: "RESCHEDULED", code: "PROVIDER_NOT_FOUND" as const };
        },
        applyStatus: async () => ({
          kind: "APPLIED",
          paymentId: claim.paymentId,
        }),
        blockUnsupported: async () => ({
          kind: "BLOCKED",
          paymentId: claim.paymentId,
        }),
      },
    });
    expect(await runner.tick("c")).toEqual({ claimed: 1, completed: 1 });
    expect(completed).toBe(1);
  });
  it("billing runner start performs an initial tick", async () => {
    let ticks = 0;
    const runner = new BillingReconciliationRunner({
      intervalMs: 60_000,
      statusPort: {
        providerKey: "simulator",
        fetchPaymentStatus: async () => ({ kind: "NOT_FOUND" as const }),
      },
      repository: {
        claimDue: async () => {
          ticks++;
          return [];
        },
        reschedule: async () => ({
          kind: "RESCHEDULED",
          code: "PROVIDER_NOT_FOUND" as const,
        }),
        applyStatus: async () => ({
          kind: "APPLIED",
          paymentId: claim.paymentId,
        }),
        blockUnsupported: async () => ({
          kind: "BLOCKED",
          paymentId: claim.paymentId,
        }),
      },
    });
    await runner.start();
    await runner.stop();
    expect(ticks).toBe(1);
  });
  it("billing runner stop is repeatable", async () => {
    const runner = new BillingReconciliationRunner({
      statusPort: {
        providerKey: "simulator",
        fetchPaymentStatus: async () => ({ kind: "NOT_FOUND" as const }),
      },
      repository: {
        claimDue: async () => [],
        reschedule: async () => ({
          kind: "RESCHEDULED",
          code: "PROVIDER_NOT_FOUND" as const,
        }),
        applyStatus: async () => ({
          kind: "APPLIED",
          paymentId: claim.paymentId,
        }),
        blockUnsupported: async () => ({
          kind: "BLOCKED",
          paymentId: claim.paymentId,
        }),
      },
    });
    const typedRunner: JobRunner = runner;
    await typedRunner.stop();
    await typedRunner.stop();
    await expect(runner.start()).rejects.toThrow("WORKER_STOPPING");
    await expect(runner.tick()).rejects.toThrow("WORKER_STOPPING");
  });
  it("lifecycle tick passes correlation and clock", async () => {
    let received = "";
    const runner = new SubscriptionLifecycleRunner(
      {
        processDue: async (v) => {
          received = v.correlationId;
          expect(v.now.toISOString()).toBe("2026-09-07T12:00:00.000Z");
          return { scanned: 0, transitioned: 0, corrupted: 0 };
        },
      },
      60_000,
      2,
      () => new Date("2026-09-07T12:00:00Z"),
    );
    expect(await runner.tick("corr")).toEqual({
      scanned: 0,
      transitioned: 0,
      corrupted: 0,
    });
    expect(received).toBe("corr");
  });
  it("lifecycle tick is separately callable", async () => {
    const runner = new SubscriptionLifecycleRunner({
      processDue: async () => ({ scanned: 1, transitioned: 1, corrupted: 0 }),
    });
    expect((await runner.tick("c")).transitioned).toBe(1);
  });
  it("lifecycle start performs an initial tick", async () => {
    let calls = 0;
    const runner = new SubscriptionLifecycleRunner(
      {
        processDue: async () => {
          calls++;
          return { scanned: 0, transitioned: 0, corrupted: 0 };
        },
      },
      60_000,
    );
    await runner.start();
    await runner.stop();
    expect(calls).toBe(1);
  });
  it("lifecycle stop is repeatable", async () => {
    const runner = new SubscriptionLifecycleRunner({
      processDue: async () => ({ scanned: 0, transitioned: 0, corrupted: 0 }),
    });
    await runner.stop();
    await runner.stop();
  });
});
