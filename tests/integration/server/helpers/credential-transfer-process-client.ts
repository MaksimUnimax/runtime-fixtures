import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  RecipientRelayApi,
  RecipientRelayApiContext,
} from "./credential-transfer-recipient-relay.js";
import type {
  ProcessInit,
  ProcessReady,
  ProcessReply,
  ProcessRequest,
} from "./credential-transfer-process.js";

// One owned fixture process; no global runner, polling daemon or arbitrary RPC.
export async function startTransferProcess(
  context: RecipientRelayApiContext,
  accountId: string,
  connectionString: string,
) {
  const child = fork(
    fileURLToPath(new URL("./credential-transfer-process.ts", import.meta.url)),
    [],
    {
      execArgv: ["--max-old-space-size=512", "--import", "tsx"],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DATABASE_URL: connectionString,
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let sequence = 0;
  let ended = false;
  let closePromise: Promise<void> | undefined;
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => {
      ended = true;
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("TRANSFER_PROCESS_EXITED_DURING_REQUEST"));
      }
      pending.clear();
      resolve({ code, signal });
    });
    child.once("error", () => {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("TRANSFER_PROCESS_SPAWN_FAILED"));
      }
      pending.clear();
    });
  });
  child.on("message", (message: ProcessReply) => {
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.ok) item.resolve(message.value);
    else item.reject(new Error(message.code));
  });
  async function boundedExit(timeout: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        exit,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("TRANSFER_PROCESS_EXIT_TIMEOUT")),
            timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function call<T>(
    kind: ProcessRequest["kind"],
    payload?: unknown,
    timeout = 8_000,
  ): Promise<T> {
    if (ended || !child.connected)
      return Promise.reject(new Error("TRANSFER_PROCESS_NOT_CONNECTED"));
    const id = ++sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("TRANSFER_PROCESS_REQUEST_TIMEOUT"));
      }, timeout);
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      child.send({ id, kind, payload } satisfies ProcessRequest, (error) => {
        if (!error) return;
        const item = pending.get(id);
        if (!item) return;
        clearTimeout(item.timer);
        pending.delete(id);
        item.reject(new Error("TRANSFER_PROCESS_SEND_FAILED"));
      });
    });
  }
  function close(): Promise<void> {
    closePromise ??= (async () => {
      try {
        if (!ended) await call("close", undefined, 12_000);
        const result = await boundedExit(3_000);
        if (result.code !== 0 || result.signal !== null)
          throw new Error("TRANSFER_PROCESS_UNCLEAN_EXIT");
      } catch (error) {
        if (!ended) {
          child.kill("SIGTERM");
          try {
            await boundedExit(3_000);
          } catch {
            if (!ended) child.kill("SIGKILL");
            await boundedExit(3_000);
          }
        }
        throw error;
      }
    })();
    return closePromise;
  }
  try {
    const init: ProcessInit = {
      accountId,
      now: context.now,
      keyId: context.signing.keyId,
      signingKey: context.signing.privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
    };
    // Ephemeral fixture key travels only through this child's private IPC.
    init.signingKey = Buffer.from(init.signingKey).toString("base64");
    const ready = await call<ProcessReady>("init", init);
    if (!child.pid || ready.pid !== child.pid || ready.pid === process.pid)
      throw new Error("TRANSFER_PROCESS_IDENTITY_MISMATCH");
    let stopped: Promise<void> | undefined;
    const api: RecipientRelayApi = {
      inject: async (input) => {
        const result = await call<{ statusCode: number; body: string }>(
          "inject",
          input,
        );
        return { ...result, json: () => JSON.parse(result.body) as unknown };
      },
      setTime: async (now) => {
        await call("time", now);
      },
      readState: async (requestId, principal, now) =>
        (await call<string | null>("state", { requestId, principal, now })) ??
        undefined,
      stop: () => {
        stopped ??= call<void>("stop");
        return stopped;
      },
    };
    return { api, ready, close, cleanupTransfers: () => call<void>("cleanup") };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "TRANSFER_PROCESS_SETUP_AND_CLEANUP_FAILED",
      );
    }
    throw error;
  }
}
