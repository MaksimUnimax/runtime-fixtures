import { describe, expect, it } from "vitest";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { createCredentialTransferEpochFence } from "./credential-transfer-epoch-fence.js";

const INSTANCE = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const queries: { text: string; args?: unknown[] }[] = [];
  const gates = new Map<
    string,
    {
      entered: ReturnType<typeof deferred>;
      release: ReturnType<typeof deferred>;
    }
  >();
  let claimRows: Record<string, unknown>[] | undefined;
  let guardRows: Record<string, unknown>[] | undefined;
  let guardError: Error | undefined;
  let schemaError: Error | undefined;
  let commitError: Error | undefined;
  async function pause(stage: string) {
    const gate = gates.get(stage);
    if (gate) {
      gates.delete(stage);
      gate.entered.resolve();
      await gate.release.promise;
    }
  }
  const runtime = {
    transaction: async <T>(
      action: (tx: DatabaseQuery) => Promise<T>,
    ): Promise<T> => {
      await pause("begin");
      const value = await action({
        query: async <
          U extends Record<string, unknown> = Record<string, unknown>,
        >(
          text: string,
          args?: unknown[],
        ): Promise<{ rows: U[] }> => {
          queries.push({ text, args });
          if (text.includes("credential_transfer_writer_epoch"))
            throw Object.assign(new Error("Direct epoch table access denied"), {
              code: "42501",
            });
          if (text === "SET LOCAL search_path=pg_catalog,public,pg_temp") {
            await pause("schema");
            if (schemaError) throw schemaError;
            return { rows: [] };
          }
          if (text.includes("claim_writer")) {
            await pause("claim");
            return {
              rows: (claimRows ?? [
                { epoch: "42", owner_instance_id: INSTANCE },
              ]) as U[],
            };
          }
          if (text.includes("authorize_writer")) {
            await pause("authorize");
            if (guardError) throw guardError;
            return {
              rows: (guardRows ?? [
                { epoch: "42", owner_instance_id: INSTANCE },
              ]) as U[],
            };
          }
          if (text === "SELECT synthetic_transfer_action") return { rows: [] };
          throw new Error("Unexpected test SQL");
        },
      });
      await pause("commit");
      if (commitError) throw commitError;
      return value;
    },
  } as unknown as DatabaseRuntime;
  return {
    runtime,
    queries,
    arm(stage: string) {
      const gate = { entered: deferred(), release: deferred() };
      gates.set(stage, gate);
      return gate;
    },
    setClaimRows(rows: Record<string, unknown>[]) {
      claimRows = rows;
    },
    setGuardRows(rows: Record<string, unknown>[]) {
      guardRows = rows;
    },
    setSchemaError(error: Error) {
      schemaError = error;
    },
    setGuardError(error: Error) {
      guardError = error;
    },
    setCommitError(error: Error) {
      commitError = error;
    },
  };
}
function settled<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({
      ok: false as const,
      error: error as Error & { code?: string },
    }),
  );
}

describe("C06 epoch function boundary and terminal local deactivation", () => {
  it("works without direct epoch UPDATE grants, before the business SQL", async () => {
    const x = fixture();
    const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
    const identity = await f.claim();
    expect(identity).toEqual({ epoch: "42", instanceId: INSTANCE });
    expect(Object.isFrozen(identity)).toBe(true);
    let calls = 0;
    await expect(
      f.fencedTransaction(async (tx) => {
        calls++;
        await tx.query("SELECT synthetic_transfer_action");
        return "done";
      }),
    ).resolves.toBe("done");
    expect(calls).toBe(1);
    expect(x.queries).toHaveLength(4);
    expect(x.queries[0]?.text).toContain("claim_writer");
    expect(x.queries[1]?.text).toBe(
      "SET LOCAL search_path=pg_catalog,public,pg_temp",
    );
    expect(x.queries[2]?.text).toContain("authorize_writer");
    expect(x.queries[2]?.args).toEqual(["42", INSTANCE]);
    expect(x.queries[3]?.text).toBe("SELECT synthetic_transfer_action");
    await expect(f.claim()).rejects.toThrow("CLAIM_RETRY_FORBIDDEN");
    expect(x.queries).toHaveLength(4);
  });
  it("rejects work before claim and after deactivation without SQL", async () => {
    const x = fixture();
    const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
    await expect(f.fencedTransaction(async () => true)).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    expect(x.queries).toHaveLength(0);
    await f.claim();
    f.deactivate();
    await expect(f.fencedTransaction(async () => true)).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    expect(x.queries).toHaveLength(1);
  });
  it("never retries an ambiguous election COMMIT", async () => {
    const x = fixture();
    const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
    x.setCommitError(new Error("UNKNOWN_COMMIT"));
    await expect(f.claim()).rejects.toThrow("UNKNOWN_COMMIT");
    await expect(f.claim()).rejects.toThrow("CLAIM_RETRY_FORBIDDEN");
    await expect(f.fencedTransaction(async () => true)).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    expect(x.queries).toHaveLength(1);
  });
  it.each(["begin", "claim", "commit"])(
    "claim waiting at %s cannot undo deactivation",
    async (stage) => {
      const x = fixture();
      const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
      const g = x.arm(stage);
      const pending = settled(f.claim());
      await g.entered.promise;
      f.deactivate();
      g.release.resolve();
      expect(await pending).toMatchObject({
        ok: false,
        error: { code: "TRANSFER_CONFLICT" },
      });
      let calls = 0;
      await expect(
        f.fencedTransaction(async () => ++calls),
      ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });
      expect(calls).toBe(0);
    },
  );
  it.each(["begin", "schema", "authorize"])(
    "transfer waiting at %s cannot start work after deactivation",
    async (stage) => {
      const x = fixture();
      const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
      await f.claim();
      const g = x.arm(stage);
      let calls = 0;
      const pending = settled(f.fencedTransaction(async () => ++calls));
      await g.entered.promise;
      f.deactivate();
      g.release.resolve();
      expect(await pending).toMatchObject({
        ok: false,
        error: { code: "TRANSFER_CONFLICT" },
      });
      expect(calls).toBe(0);
    },
  );
  it("deactivation before claim is terminal", async () => {
    const x = fixture();
    const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
    f.deactivate();
    await expect(f.claim()).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    expect(x.queries).toHaveLength(0);
  });
  it.each(["PTF01", "PTF02"])(
    "maps only known fence code %s and invalidates local admission",
    async (code) => {
      const x = fixture();
      const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
      await f.claim();
      x.setGuardError(Object.assign(new Error("fenced"), { code }));
      await expect(f.fencedTransaction(async () => true)).rejects.toMatchObject(
        { code: "TRANSFER_CONFLICT" },
      );
      await expect(f.fencedTransaction(async () => true)).rejects.toMatchObject(
        { code: "TRANSFER_CONFLICT" },
      );
      expect(x.queries).toHaveLength(3);
    },
  );
  it.each(["42501", "08006", "40P01"])(
    "preserves %s without a hidden retry",
    async (code) => {
      const x = fixture();
      const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
      await f.claim();
      const error = Object.assign(new Error("original"), { code });
      x.setGuardError(error);
      await expect(f.fencedTransaction(async () => true)).rejects.toBe(error);
      expect(x.queries).toHaveLength(3);
    },
  );
  it.each([
    [],
    [{ epoch: "0", owner_instance_id: INSTANCE }],
    [{ epoch: "9223372036854775808", owner_instance_id: INSTANCE }],
    [{ epoch: "42", owner_instance_id: FOREIGN }],
    [
      { epoch: "42", owner_instance_id: INSTANCE },
      { epoch: "42", owner_instance_id: INSTANCE },
    ],
  ])("rejects an unverified election result %#", async (...rows) => {
    const x = fixture();
    const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
    x.setClaimRows(rows);
    await expect(f.claim()).rejects.toThrow("ELECTION_UNVERIFIED");
    await expect(f.claim()).rejects.toThrow("CLAIM_RETRY_FORBIDDEN");
    expect(x.queries).toHaveLength(1);
  });
  it("rejects a stale guard readback before the business callback", async () => {
    const x = fixture();
    const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
    await f.claim();
    x.setGuardRows([{ epoch: "43", owner_instance_id: FOREIGN }]);
    let calls = 0;
    await expect(
      f.fencedTransaction(async () => ++calls),
    ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });
    expect(calls).toBe(0);
  });
});

it("cannot reach authorization or business SQL when schema pinning fails", async () => {
  const x = fixture();
  const f = createCredentialTransferEpochFence(x.runtime, INSTANCE);
  await f.claim();
  const error = Object.assign(new Error("SCHEMA_SETUP_FAILED"), {
    code: "08006",
  });
  x.setSchemaError(error);
  let calls = 0;
  await expect(f.fencedTransaction(async () => ++calls)).rejects.toBe(error);
  expect(calls).toBe(0);
  expect(x.queries).toHaveLength(2);
  expect(
    x.queries.some((query) => query.text.includes("authorize_writer")),
  ).toBe(false);
});
