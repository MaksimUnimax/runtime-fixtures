import {
  createEpochFencedCredentialTransferRepository,
  type DatabaseRuntime,
} from "../../../../packages/server/db/src/index.js";
import { TransferError } from "../../../../packages/server/credential-transfer/src/index.js";
import { createCredentialTransferTestAuthority } from "../../../integration/server/helpers/credential-transfer-test-authority.js";

const databases = [
  "octoport_a_test",
  "octoport_b_test",
  "octoport_c_test",
  "product_control_plane_test",
  // Existing installed-local GitHub Actions database; still loopback-only.
  "seller_agents_i1_client",
] as const;
const loopbacks = ["127.0.0.1", "localhost", "::1", "[::1]"];
export function requireI1DisposableDatabase(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    const database = databases.find(
      (name) => name === decodeURIComponent(url.pathname.slice(1)),
    );
    const hosts = url.searchParams.getAll("host");
    if (
      !database ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !loopbacks.includes(url.hostname) ||
      hosts.length > 1 ||
      [...url.searchParams.keys()].some((key) => key !== "host") ||
      hosts.some(
        (host) => !loopbacks.includes(host) && host !== "/var/run/postgresql",
      )
    ) {
      throw new Error("I1_DISPOSABLE_DATABASE_REQUIRED");
    }
    return database;
  } catch {
    // Do not echo a potentially credential-bearing connection string.
    throw new Error("I1_DISPOSABLE_DATABASE_REQUIRED");
  }
}

/** Test harness only; never a replacement for actual runtime LOGIN admission. */
export function createI1TransferFixtureLifecycle(
  administrator: DatabaseRuntime,
  database: ReturnType<typeof requireI1DisposableDatabase>,
  create = createCredentialTransferTestAuthority,
) {
  type Authority = Awaited<
    ReturnType<typeof createCredentialTransferTestAuthority>
  >;
  let attempted = false;
  let stopped = false;
  let current: Authority | undefined;
  let creating: Promise<Authority> | undefined;
  let closing: Promise<void> | undefined;

  function stop(): Promise<void> {
    stopped = true;
    if (closing) return closing;
    const attempt = (async () => {
      const authority = current ?? (await creating?.catch(() => undefined));
      if (authority) await authority.dispose();
      current = undefined;
    })();
    // Clear before exposing rejection to the caller: an inline catch can
    // explicitly retry cleanup, while concurrent pending stops still coalesce.
    closing = attempt.catch((error: unknown) => {
      closing = undefined;
      throw error;
    });
    return closing;
  }

  return {
    repository: createEpochFencedCredentialTransferRepository({
      async fencedTransaction(action) {
        if (stopped || !current?.isActive())
          throw new TransferError("TRANSFER_CONFLICT");
        return current.transaction(action);
      },
    }),
    async start(): Promise<void> {
      if (stopped || attempted)
        throw new Error("I1_TRANSFER_FIXTURE_NOT_RESTARTABLE");
      attempted = true;
      try {
        creating = create(administrator, database);
        current = await creating;
        if (stopped || !current.isActive())
          throw new Error("I1_TRANSFER_FIXTURE_STOPPED");
      } catch (error) {
        try {
          await stop();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "I1_TRANSFER_FIXTURE_SETUP_AND_CLEANUP_FAILED",
          );
        }
        throw error;
      }
    },
    isReady: () => !stopped && current?.isActive() === true,
    stop,
  };
}

/** Finite signal cleanup for this test process; never a background executor. */
export function createI1SignalCleanup(
  close: () => Promise<void>,
  finish: (code: 0 | 1, reason: "clean" | "cleanup-error" | "timeout") => void,
  timeoutMs = 12_000,
): () => void {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    let finished = false;
    const settle = (
      code: 0 | 1,
      reason: "clean" | "cleanup-error" | "timeout",
    ) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      finish(code, reason);
    };
    const timer = setTimeout(() => settle(1, "timeout"), timeoutMs);
    void Promise.resolve()
      .then(close)
      .then(
        () => settle(0, "clean"),
        () => settle(1, "cleanup-error"),
      );
  };
}
