import { describe, expect, it, vi } from "vitest";
import { createCredentialTransferApiAdmission } from "./credential-transfer-admission.js";
import type { DatabaseQuery, CredentialTransferEpochFence } from "@product/db";

const checks = [
  "direct_session_identity",
  "restricted_role",
  "expected_relations",
  "epoch_structure",
  "transaction_context_structure",
  "safe_functions",
  "cannot_assume_owner",
  "private_schema_usage_only",
  "can_call_entry_functions",
  "no_direct_epoch_mutation",
  "cannot_truncate_requests",
  "functions_not_public",
  "mandatory_statement_trigger",
];
function fixture(overrides: Record<string, unknown> = {}) {
  let active = false;
  const query = vi.fn(async () => ({
    rows: [
      { ...Object.fromEntries(checks.map((key) => [key, true])), ...overrides },
    ],
  }));
  const claim = vi.fn(async () => {
    active = true;
    return { epoch: "2", instanceId: "11111111-1111-4111-8111-111111111111" };
  });
  const deactivate = vi.fn(() => {
    active = false;
  });
  const fence: CredentialTransferEpochFence = {
    claim,
    deactivate,
    isActive: () => active,
    fencedTransaction: async () => {
      throw new Error("NOT_USED");
    },
  };
  const database = { query } as unknown as DatabaseQuery;
  return {
    admission: createCredentialTransferApiAdmission(database, fence),
    query,
    claim,
    deactivate,
    fence,
  };
}
function signal<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("credential transfer API pre-listen admission", () => {
  it("checks database privileges before election and is ready only after both", async () => {
    const f = fixture();
    expect(f.admission.isReady()).toBe(false);
    await f.admission.start();
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.claim).toHaveBeenCalledTimes(1);
    expect(f.query.mock.invocationCallOrder[0]).toBeLessThan(
      f.claim.mock.invocationCallOrder[0]!,
    );
    expect(f.admission.isReady()).toBe(true);
    f.admission.stop();
    expect(f.admission.isReady()).toBe(false);
    await expect(f.admission.start()).rejects.toThrow("NOT_RESTARTABLE");
  });
  it.each(checks)(
    "refuses unsafe database prerequisite %s without election",
    async (key) => {
      const f = fixture({ [key]: false });
      await expect(f.admission.start()).rejects.toThrow(
        "UNSAFE_OR_UNPROVISIONED",
      );
      expect(f.claim).not.toHaveBeenCalled();
      expect(f.admission.isReady()).toBe(false);
      await expect(f.admission.start()).rejects.toThrow("NOT_RESTARTABLE");
    },
  );
  it("does not claim after stop during privilege query", async () => {
    const f = fixture();
    const held = signal<Awaited<ReturnType<typeof f.query>>>();
    f.query.mockImplementation(() => held.promise);
    const started = f.admission.start();
    f.admission.stop();
    held.resolve({
      rows: [Object.fromEntries(checks.map((key) => [key, true]))],
    });
    await expect(started).rejects.toThrow("STOPPED");
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.admission.isReady()).toBe(false);
  });
  it("does not become ready after stop during election", async () => {
    const f = fixture();
    const held = signal<Awaited<ReturnType<typeof f.claim>>>();
    const entered = signal<void>();
    f.claim.mockImplementation(() => {
      entered.resolve();
      return held.promise;
    });
    const started = f.admission.start();
    await entered.promise;
    f.admission.stop();
    held.resolve({
      epoch: "2",
      instanceId: "11111111-1111-4111-8111-111111111111",
    });
    await expect(started).rejects.toThrow("STOPPED");
    expect(f.admission.isReady()).toBe(false);
  });
  it("unknown COMMIT stops admission and is not retried", async () => {
    const f = fixture();
    const error = new Error("UNKNOWN_COMMIT");
    f.claim.mockRejectedValue(error);
    await expect(f.admission.start()).rejects.toBe(error);
    await expect(f.admission.start()).rejects.toThrow("NOT_RESTARTABLE");
    expect(f.claim).toHaveBeenCalledTimes(1);
    expect(f.deactivate).toHaveBeenCalledTimes(1);
  });
  it("reflects subsequent stale-epoch loss without continuing readiness", async () => {
    const f = fixture();
    await f.admission.start();
    f.fence.deactivate();
    expect(f.admission.isReady()).toBe(false);
  });
  it("rejects a malformed database proof instead of trusting a truthy value", async () => {
    const f = fixture({ mandatory_statement_trigger: "true" });
    await expect(f.admission.start()).rejects.toThrow(
      "UNSAFE_OR_UNPROVISIONED",
    );
    expect(f.claim).not.toHaveBeenCalled();
  });
  it.each(["42501", "3F000", "42P01", "42883"])(
    "classifies missing migration/grants %s without a claim",
    async (code) => {
      const f = fixture();
      f.query.mockRejectedValue(
        Object.assign(new Error("SQL_DIAGNOSTIC"), { code }),
      );
      await expect(f.admission.start()).rejects.toThrow(
        "UNSAFE_OR_UNPROVISIONED",
      );
      expect(f.claim).not.toHaveBeenCalled();
    },
  );
  it.each(["08006", "40001", "57014"])(
    "preserves non-authority SQLSTATE %s with no retry",
    async (code) => {
      const f = fixture();
      const error = Object.assign(new Error("TRANSPORT_OR_CONFLICT"), { code });
      f.query.mockRejectedValue(error);
      await expect(f.admission.start()).rejects.toBe(error);
      await expect(f.admission.start()).rejects.toThrow("NOT_RESTARTABLE");
      expect(f.query).toHaveBeenCalledTimes(1);
      expect(f.claim).not.toHaveBeenCalled();
    },
  );
});
