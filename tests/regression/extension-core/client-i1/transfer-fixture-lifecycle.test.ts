import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  DatabaseRuntime,
  DatabaseQuery,
} from "../../../../packages/server/db/src/index.js";
import { createCredentialTransferTestAuthority } from "../../../integration/server/helpers/credential-transfer-test-authority.js";
import {
  createI1TransferFixtureLifecycle,
  createI1SignalCleanup,
  requireI1DisposableDatabase,
} from "./transfer-fixture-lifecycle.js";

type Authority = Awaited<
  ReturnType<typeof createCredentialTransferTestAuthority>
>;
const database = {} as DatabaseRuntime;
function authority() {
  const query = vi.fn(async () => ({ rows: [] }));
  const transaction = vi.fn(
    async <T>(action: (tx: DatabaseQuery) => Promise<T>) => action({ query }),
  );
  const dispose = vi.fn(async () => {});
  const value = {
    role: "c06_test_fixture",
    isActive: () => true,
    transaction,
    dispose,
  } as unknown as Authority;
  return { value, transaction, dispose };
}

describe("I1 explicit disposable database boundary", () => {
  it("accepts the exact disposable database declared by the unchanged I1 workflow", () => {
    const workflow = readFileSync(
      new URL(
        "../../../../.github/workflows/extension-i1-ci.yml",
        import.meta.url,
      ),
      "utf8",
    );
    const declared = [
      ...workflow.matchAll(/^\s*POSTGRES_DB:\s*([a-z0-9_]+)\s*$/gm),
    ].map((item) => item[1]);
    expect(declared).toContain("seller_agents_i1_client");
    expect(
      requireI1DisposableDatabase(
        "postgres://test@127.0.0.1:45432/seller_agents_i1_client",
      ),
    ).toBe("seller_agents_i1_client");
  });
  it.each([
    "postgres://test@external.invalid/seller_agents_i1_client",
    "postgres://test@localhost/seller_agents_i1_client?host=external.invalid",
    "postgres://test@localhost/seller_agents_i1_client?hostaddr=1.2.3.4",
    "postgres://test@localhost/seller_agents_i1_client_production",
  ])("does not broaden CI identity into arbitrary destinations: %s", (url) => {
    expect(() => requireI1DisposableDatabase(url)).toThrow(
      "I1_DISPOSABLE_DATABASE_REQUIRED",
    );
  });

  it.each([
    "octoport_a_test",
    "octoport_b_test",
    "octoport_c_test",
    "product_control_plane_test",
  ])("allows declared local %s", (name) => {
    expect(
      requireI1DisposableDatabase(`postgres://test@127.0.0.1/${name}`),
    ).toBe(name);
  });
  it("accepts the existing C local PostgreSQL socket", () => {
    expect(
      requireI1DisposableDatabase(
        "postgres://test@localhost/octoport_c_test?host=/var/run/postgresql",
      ),
    ).toBe("octoport_c_test");
  });
  it.each([
    undefined,
    "not-a-url",
    "https://localhost/octoport_c_test",
    "postgres://test@external.invalid/octoport_c_test",
    "postgres://test@localhost/production",
    "postgres://test@localhost/octoport_c_test?host=external.invalid",
    "postgres://test@localhost/octoport_c_test?hostaddr=1.2.3.4",
    "postgres://test@localhost/octoport_c_test?host=localhost&host=localhost",
  ])(
    "rejects undeclared destination without echoing credentials: %s",
    (url) => {
      expect(() => requireI1DisposableDatabase(url)).toThrow(
        "I1_DISPOSABLE_DATABASE_REQUIRED",
      );
    },
  );
});

describe("I1 transfer fixture lifecycle", () => {
  it("refuses operations before start and after stop; admits one factory only", async () => {
    const fake = authority();
    const create = vi.fn(async () => fake.value);
    const life = createI1TransferFixtureLifecycle(
      database,
      "octoport_c_test",
      create,
    );
    expect(life.isReady()).toBe(false);
    await expect(life.repository.expireDue(new Date())).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    await life.start();
    expect(life.isReady()).toBe(true);
    await expect(life.repository.expireDue(new Date())).resolves.toBe(0);
    await expect(life.start()).rejects.toThrow(
      "I1_TRANSFER_FIXTURE_NOT_RESTARTABLE",
    );
    await life.stop();
    expect(life.isReady()).toBe(false);
    await expect(life.repository.expireDue(new Date())).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    expect(fake.transaction).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });
  it("stop before start never creates a role", async () => {
    const create = vi.fn(async () => authority().value);
    const life = createI1TransferFixtureLifecycle(
      database,
      "octoport_c_test",
      create,
    );
    await life.stop();
    await expect(life.start()).rejects.toThrow(
      "I1_TRANSFER_FIXTURE_NOT_RESTARTABLE",
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("late setup after stop is disposed exactly once and never becomes ready", async () => {
    const fake = authority();
    let resolve!: (authority: Authority) => void;
    const pending = new Promise<Authority>((done) => {
      resolve = done;
    });
    const life = createI1TransferFixtureLifecycle(
      database,
      "octoport_c_test",
      vi.fn(() => pending),
    );
    const started = life.start().catch((error: unknown) => error);
    const first = life.stop();
    expect(life.stop()).toBe(first);
    resolve(fake.value);
    await first;
    expect(await started).toMatchObject({
      message: "I1_TRANSFER_FIXTURE_STOPPED",
    });
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(life.isReady()).toBe(false);
    await expect(life.repository.expireDue(new Date())).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    expect(fake.transaction).not.toHaveBeenCalled();
  });
  it("preserves setup failure and does not retry election", async () => {
    const failure = new Error("PRIMARY_SETUP_FAILURE");
    const create = vi.fn(async () => {
      throw failure;
    });
    const life = createI1TransferFixtureLifecycle(
      database,
      "octoport_c_test",
      create,
    );
    await expect(life.start()).rejects.toBe(failure);
    await life.stop();
    await expect(life.start()).rejects.toThrow(
      "I1_TRANSFER_FIXTURE_NOT_RESTARTABLE",
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("explicit cleanup retry never resumes business admission", async () => {
    const fake = authority();
    fake.dispose.mockRejectedValueOnce(new Error("DROP_FAILED"));
    const create = vi.fn(async () => fake.value);
    const life = createI1TransferFixtureLifecycle(
      database,
      "octoport_c_test",
      create,
    );
    await life.start();
    await expect(life.stop()).rejects.toThrow("DROP_FAILED");
    await expect(life.repository.expireDue(new Date())).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    await life.stop();
    expect(fake.dispose).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(life.isReady()).toBe(false);
  });
  it("an inactive returned authority is refused and cleaned up", async () => {
    const fake = authority();
    fake.value.isActive = () => false;
    const life = createI1TransferFixtureLifecycle(
      database,
      "octoport_c_test",
      async () => fake.value,
    );
    await expect(life.start()).rejects.toThrow("I1_TRANSFER_FIXTURE_STOPPED");
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(life.isReady()).toBe(false);
  });
});

describe("bounded I1 signal cleanup", () => {
  it("coalesces signals and completes successfully exactly once", async () => {
    const close = vi.fn(async () => {}),
      finish = vi.fn();
    const signal = createI1SignalCleanup(close, finish);
    signal();
    signal();
    await vi.waitFor(() => expect(finish).toHaveBeenCalledWith(0, "clean"));
    expect(close).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
  });
  it("reports cleanup errors instead of successful termination", async () => {
    const finish = vi.fn();
    const signal = createI1SignalCleanup(async () => {
      throw new Error("CLEANUP");
    }, finish);
    signal();
    await vi.waitFor(() =>
      expect(finish).toHaveBeenCalledWith(1, "cleanup-error"),
    );
    expect(finish).toHaveBeenCalledTimes(1);
  });
  it("terminates a pending cleanup at the finite deadline and ignores late success", async () => {
    vi.useFakeTimers();
    try {
      let done!: () => void;
      const pending = new Promise<void>((resolve) => {
        done = resolve;
      });
      const finish = vi.fn();
      const signal = createI1SignalCleanup(() => pending, finish, 12_000);
      signal();
      await vi.advanceTimersByTimeAsync(12_000);
      expect(finish).toHaveBeenCalledExactlyOnceWith(1, "timeout");
      done();
      await vi.advanceTimersByTimeAsync(1);
      expect(finish).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("handles a synchronous cleanup exception", async () => {
    const finish = vi.fn();
    const signal = createI1SignalCleanup(() => {
      throw new Error("SYNC");
    }, finish);
    signal();
    await vi.waitFor(() =>
      expect(finish).toHaveBeenCalledWith(1, "cleanup-error"),
    );
  });
  it("an inline rejected-stop handler can immediately retry cleanup", async () => {
    const fake = authority();
    fake.dispose.mockRejectedValueOnce(new Error("DROP_FAILED"));
    const life = createI1TransferFixtureLifecycle(
      database,
      "octoport_c_test",
      async () => fake.value,
    );
    await life.start();
    await life.stop().catch(() => life.stop());
    expect(fake.dispose).toHaveBeenCalledTimes(2);
    expect(life.isReady()).toBe(false);
    await expect(life.repository.expireDue(new Date())).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
  });
});
