import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import { createApiApp } from "../../../apps/api/src/app.js";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
} from "../../../packages/server/credential-transfer/src/index.js";
import {
  createDatabaseRuntime,
  createExtensionAuthRepository,
} from "../../../packages/server/db/src/index.js";
import {
  ExtensionAuthService,
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
} from "../../../packages/server/extension-auth/src/index.js";
import { createCredentialTransferTestAuthority } from "./helpers/credential-transfer-test-authority.js";
import { requireI1DisposableDatabase } from "../../regression/extension-core/client-i1/transfer-fixture-lifecycle.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), 7_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
type Wire = { kind: "response" | "disconnected"; status: number; body: string };
/** One real loopback request, no retrying client or reusable connection pool. */
function exchange(url: string, body: string, token?: string) {
  const closed = deferred();
  let abort!: () => void;
  let headersSeen = false;
  let isClosed = false;
  const result = new Promise<Wire>((resolve) => {
    let settled = false;
    const finish = (value: Wire) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const req = httpRequest(
      url,
      {
        method: "POST",
        agent: false,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
      },
      (response) => {
        headersSeen = true;
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
          if (text.length > 4096) req.destroy(new Error("R15_RESPONSE_LIMIT"));
        });
        response.once("end", () =>
          finish({
            kind: "response",
            status: response.statusCode ?? 0,
            body: text,
          }),
        );
        response.once("error", () =>
          finish({ kind: "disconnected", status: 0, body: "" }),
        );
        response.once("aborted", () =>
          finish({ kind: "disconnected", status: 0, body: "" }),
        );
      },
    );
    req.setTimeout(6_000, () => req.destroy(new Error("R15_HTTP_TIMEOUT")));
    req.once("error", () =>
      finish({ kind: "disconnected", status: 0, body: "" }),
    );
    req.once("close", () => {
      isClosed = true;
      closed.resolve();
    });
    abort = () => req.destroy(new Error("R15_EXPLICIT_CLIENT_DISCONNECT"));
    req.end(body);
  });
  return {
    result,
    closed: closed.promise,
    abort: () => abort(),
    headersSeen: () => headersSeen,
    isClosed: () => isClosed,
  };
}
async function listenerClosed(origin: string): Promise<boolean> {
  const url = new URL(origin);
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({
      host: "127.0.0.1",
      port: Number(url.port),
    });
    let done = false;
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.once("connect", () => finish(false));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish(error.code === "ECONNREFUSED"),
    );
    socket.setTimeout(1_000, () => finish(false));
  });
}

/** Real signed HTTP ACK plus Fastify close, after durable COMMIT. No process restart. */
export async function proveCredentialTransferHttpStop(
  connectionString: string,
) {
  const expectedDatabase = requireI1DisposableDatabase(connectionString);
  const db = createDatabaseRuntime(connectionString);
  const observer = createDatabaseRuntime(connectionString);
  const userId = randomUUID(),
    accountId = randomUUID();
  const deviceIds = [randomUUID(), randomUUID()] as const;
  const sessionIds = [randomUUID(), randomUUID()] as const;
  const source = {
    accountId,
    deviceId: deviceIds[0],
    sessionId: sessionIds[0],
  };
  const recipient = {
    accountId,
    deviceId: deviceIds[1],
    sessionId: sessionIds[1],
  };
  const requestIds: string[] = [];
  const checks: { name: string; passed: boolean }[] = [];
  const cleanup: Record<string, boolean> = {};
  const failures: string[] = [];
  const closeApps: (() => Promise<void>)[] = [];
  const serverWork: Promise<void>[] = [];
  const services: CredentialTransferService[] = [];
  const releases: (() => void)[] = [];
  const requests: ReturnType<typeof exchange>[] = [];
  const closing: Promise<unknown>[] = [];
  let authority:
    | Awaited<ReturnType<typeof createCredentialTransferTestAuthority>>
    | undefined;
  function check(name: string, ok: boolean) {
    checks.push({ name, passed: ok });
    assert.equal(ok, true, name);
  }
  // Capture only our labels or error types, never token/connection material.
  function capture(error: unknown) {
    failures.push(
      error instanceof assert.AssertionError
        ? String(error.message).slice(0, 160)
        : error instanceof Error
          ? error.name
          : typeof error,
    );
  }
  async function cleanupStep(name: string, action: () => Promise<boolean>) {
    try {
      cleanup[name] = await action();
    } catch (error) {
      cleanup[name] = false;
      capture(error);
    }
  }
  async function state(id: string) {
    const rows = await observer.query<{ state: string; revision: number }>(
      "SELECT state,revision FROM public.credential_transfer_requests WHERE request_id=$1",
      [id],
    );
    assert.equal(rows.rows.length, 1);
    return rows.rows[0]!;
  }
  try {
    await db.ready();
    await observer.ready();
    const journal = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations",
    );
    check("migrated52_required", journal.rows[0]?.n === "52");
    authority = await createCredentialTransferTestAuthority(
      db,
      expectedDatabase,
    );
    const current = authority;
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO public.users(id) VALUES($1)", [userId]);
      await tx.query("INSERT INTO public.accounts(id) VALUES($1)", [accountId]);
      for (let i = 0; i < 2; i++) {
        await tx.query(
          "INSERT INTO public.devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$2,$3,'chrome','0.2.21')",
          [deviceIds[i], accountId, userId],
        );
        await tx.query(
          "INSERT INTO public.sessions(id,device_id,account_id,token_family_id) VALUES($1,$2,$3,$4)",
          [sessionIds[i], deviceIds[i], accountId, randomUUID()],
        );
      }
    });
    const auth = new ExtensionAuthService(
      createExtensionAuthRepository(db),
      deriveExtensionAuthKeys(Buffer.alloc(32, 73)),
      undefined,
      createEphemeralAccessTokenSigningKey("c-r15-disposable"),
    );
    const issued = await auth.issue(recipient.sessionId);
    assert.ok(issued.ok);
    const sourceIssued = await auth.issue(source.sessionId);
    assert.ok(sourceIssued.ok);
    const verified = await auth.authenticateAccess(issued.value.accessToken);
    check(
      "genuine_signed_access_validation_for_synthetic_identity",
      verified.ok && verified.value.sessionId === recipient.sessionId,
    );
    for (const scenario of [
      "normal",
      "stop_after_commit",
      "disconnect_then_stop",
    ] as const) {
      const id = randomUUID(),
        packetId = randomUUID();
      requestIds.push(id);
      const committed = deferred(),
        release = deferred();
      releases.push(release.resolve);
      let acknowledgements = 0;
      let trackExpected = false,
        servicePending = true,
        serverObservedClose = false;
      let trackedRequest: object | undefined;
      let trackedRequests = 0,
        trackedReplies = 0;
      const serviceSettled = deferred(),
        responsePrepared = deferred(),
        serverDisconnected = deferred();
      const milestones: string[] = [];
      const relay = new EphemeralTransferRelay();
      const service = new CredentialTransferService(
        {
          ...current.repository,
          async acknowledge(input) {
            acknowledgements++;
            const value = await current.repository.acknowledge(input);
            committed.resolve();
            await release.promise;
            return value;
          },
        },
        relay,
        () => new Date(),
        () => current.isActive(),
      );
      services.push(service);
      const actualAcknowledge = service.acknowledge.bind(service);
      service.acknowledge = async (
        ...input: Parameters<CredentialTransferService["acknowledge"]>
      ) => {
        try {
          return await actualAcknowledge(...input);
        } finally {
          if (trackExpected) {
            servicePending = false;
            milestones.push("service-settled");
            serviceSettled.resolve();
          }
        }
      };
      await service.create(recipient, {
        requestId: id,
        recipientDeviceId: recipient.deviceId,
        sourceDeviceId: source.deviceId,
        recipientPublicKeySpki: "A".repeat(128),
        selectedStores: [{ storeId: "synthetic-r15" }],
        consent: true,
        expiresInSeconds: 300,
      });
      await service.sourceSeen(source, id);
      await service.submit(source, {
        requestId: id,
        packetId,
        envelope: "opaque-synthetic-r15-never-in-report",
      });
      await service.receive(recipient, id);
      const delivered = await state(id);
      const app = createApiApp({
        config: {
          environment: "test",
          databaseUrl: connectionString,
          logLevel: "warn",
          apiPort: 0,
          workerReadyDelayMs: 0,
        },
        isInfrastructureReady: async () => true,
        extensionAuthService: auth,
        credentialTransferService: service,
      });
      let closePromise: Promise<void> | undefined;
      const closeApp = () => {
        if (!closePromise)
          closePromise = Promise.resolve().then(() => app.close());
        return closePromise;
      };
      closeApps.push(closeApp);
      app.addHook("onClose", async () => {
        service.stop();
      });
      const sentStatus: number[] = [];
      const ackPath = `/v1/credential-transfers/${id}/ack`;
      app.addHook("onRequest", (request, _reply, done) => {
        if (trackExpected && request.url === ackPath) {
          trackedRequest = request.raw;
          trackedRequests++;
          request.raw.socket.once("close", () => {
            serverObservedClose = true;
            serverDisconnected.resolve();
          });
        }
        done();
      });
      app.addHook("onSend", (request, reply, payload, done) => {
        if (request.url === ackPath) sentStatus.push(reply.statusCode);
        if (request.raw === trackedRequest) {
          trackedReplies++;
          milestones.push("response-prepared");
          responsePrepared.resolve();
        }
        done(null, payload);
      });
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      const body = JSON.stringify({
        requestId: id,
        packetId,
        importDecision: "IMPORTED",
      });
      const unauthorized = exchange(origin + ackPath, body);
      requests.push(unauthorized);
      const denied = await bounded(
        unauthorized.result,
        "UNAUTHORIZED_HTTP_TIMEOUT",
      );
      check(
        scenario + "_unsigned_HTTP_stays_401_without_ACK",
        denied.kind === "response" &&
          denied.status === 401 &&
          acknowledgements === 0,
      );
      await bounded(unauthorized.closed, "UNAUTHORIZED_SOCKET_CLOSE_TIMEOUT");
      const sourceAttempt = exchange(
        origin + ackPath,
        body,
        sourceIssued.value.accessToken,
      );
      requests.push(sourceAttempt);
      const wrongPrincipal = await bounded(
        sourceAttempt.result,
        "SOURCE_HTTP_TIMEOUT",
      );
      await bounded(sourceAttempt.closed, "SOURCE_SOCKET_CLOSE_TIMEOUT");
      const sourceError = JSON.parse(wrongPrincipal.body) as {
        error?: { code?: string };
      };
      check(
        scenario + "_source_device_cannot_ACK",
        wrongPrincipal.status === 409 &&
          sourceError.error?.code === "TRANSFER_ACCOUNT_MISMATCH" &&
          acknowledgements === 0,
      );
      const packetAttempt = exchange(
        origin + ackPath,
        JSON.stringify({
          requestId: id,
          packetId: randomUUID(),
          importDecision: "IMPORTED",
        }),
        issued.value.accessToken,
      );
      requests.push(packetAttempt);
      const wrongPacket = await bounded(
        packetAttempt.result,
        "PACKET_HTTP_TIMEOUT",
      );
      await bounded(packetAttempt.closed, "PACKET_SOCKET_CLOSE_TIMEOUT");
      const packetError = JSON.parse(wrongPacket.body) as {
        error?: { code?: string };
      };
      check(
        scenario + "_wrong_packet_cannot_ACK",
        wrongPacket.status === 409 &&
          packetError.error?.code === "TRANSFER_REPLAY" &&
          acknowledgements === 0,
      );
      trackExpected = true;
      serverWork.push(serviceSettled.promise, responsePrepared.promise);
      const client = exchange(origin + ackPath, body, issued.value.accessToken);
      requests.push(client);
      await bounded(
        Promise.race([
          committed.promise,
          client.result.then(() => {
            throw new Error("ACK_COMMIT_GATE_NOT_REACHED");
          }),
        ]),
        "ACK_COMMIT_TIMEOUT",
      );
      const durable = await state(id);
      check(
        scenario + "_ACK_visible_in_separate_PG_pool",
        durable.state === "COMPLETED" &&
          durable.revision === delivered.revision + 1,
      );
      check(
        scenario + "_no_response_headers_before_COMMIT_gate_release",
        !client.headersSeen(),
      );
      let shutdown: Promise<void> | undefined;
      if (scenario === "disconnect_then_stop") {
        client.abort();
        const disconnected = await bounded(
          client.result,
          "CLIENT_DISCONNECT_TIMEOUT",
        );
        await bounded(client.closed, "CLIENT_SOCKET_CLOSE_TIMEOUT");
        await bounded(
          serverDisconnected.promise,
          "SERVER_DISCONNECT_OBSERVATION_TIMEOUT",
        );
        check(
          scenario + "_server_observed_disconnect_while_ACK_pending",
          serverObservedClose &&
            servicePending &&
            trackedRequests === 1 &&
            trackedReplies === 0,
        );
        check(
          scenario + "_client_socket_closed_without_response",
          disconnected.kind === "disconnected" && !client.headersSeen(),
        );
      }
      if (scenario !== "normal") {
        service.stop();
        check(
          scenario + "_relay_erased_before_draining",
          relay.statsForTests().packets === 0 &&
            relay.statsForTests().reserved === 0,
        );
        let drained = false;
        shutdown = closeApp().then(() => {
          drained = true;
        });
        closing.push(shutdown);
        // Observe the promise on creation even when a later assertion fails.
        void shutdown.catch(() => {});
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (scenario === "stop_after_commit")
          check(scenario + "_close_waits_for_active_HTTP_handler", !drained);
      }
      release.resolve();
      const wire = await bounded(client.result, "ACK_HTTP_SETTLEMENT_TIMEOUT");
      await bounded(
        Promise.all([serviceSettled.promise, responsePrepared.promise]),
        "SERVER_HANDLER_SETTLEMENT_TIMEOUT",
      );
      await bounded(client.closed, "FINAL_CLIENT_SOCKET_CLOSE_TIMEOUT");
      check(
        scenario + "_handler_settled_before_reply_serialization",
        !servicePending &&
          milestones.indexOf("service-settled") >= 0 &&
          milestones.indexOf("response-prepared") >
            milestones.indexOf("service-settled"),
      );
      check(
        scenario + "_exactly_one_tracked_server_request_and_reply",
        trackedRequests === 1 && trackedReplies === 1,
      );
      if (scenario === "normal") {
        const parsed = JSON.parse(wire.body) as {
          state?: string;
          revision?: number;
        };
        check(
          scenario + "_control_ACK_200_matches_commit",
          wire.kind === "response" &&
            wire.status === 200 &&
            parsed.state === "COMPLETED" &&
            parsed.revision === durable.revision,
        );
        service.stop();
        shutdown = closeApp();
        closing.push(shutdown);
        void shutdown.catch(() => {});
      } else if (scenario === "stop_after_commit") {
        const parsed = JSON.parse(wire.body) as { error?: { code?: string } };
        check(
          scenario + "_late_ACK_is_HTTP409_not_false_success",
          wire.kind === "response" &&
            wire.status === 409 &&
            parsed.error?.code === "TRANSFER_CONFLICT",
        );
        check(
          scenario + "_wire_contains_no_packet_or_success_state",
          !/opaque-synthetic|COMPLETED|"envelope"/.test(wire.body),
        );
      } else {
        check(
          scenario + "_no_success_received",
          wire.kind === "disconnected" && !client.headersSeen(),
        );
      }
      assert.ok(shutdown);
      await bounded(shutdown, "REAL_FASTIFY_DRAIN_TIMEOUT");
      check(
        scenario + "_owned_HTTP_listener_closed",
        await listenerClosed(origin),
      );
      check(
        scenario + "_one_ACK_no_hidden_post_or_SQL_retry",
        acknowledgements === 1,
      );
      check(
        scenario + "_durable_ACK_not_reverted_by_stop",
        JSON.stringify(await state(id)) === JSON.stringify(durable),
      );
      check(
        scenario + "_relay_stays_empty_after_completion",
        relay.statsForTests().packets === 0 &&
          relay.statsForTests().reserved === 0,
      );
      if (scenario !== "normal")
        check(
          scenario + "_no_success_response_serialized",
          !sentStatus.includes(200),
        );
    }
  } catch (error) {
    capture(error);
  } finally {
    for (const release of releases) release();
    for (const service of services) service.stop();
    let forcedClientAborts = 0;
    for (const req of requests)
      if (!req.isClosed()) {
        forcedClientAborts++;
        req.abort();
      }
    cleanup.no_emergency_client_aborts_required = forcedClientAborts === 0;
    await cleanupStep("all_owned_HTTP_work_closed", async () => {
      const settled = await bounded(
        Promise.allSettled([
          ...closing,
          ...closeApps.map((close) => close()),
          ...serverWork,
          ...requests.map((req) => req.result),
        ]),
        "R15_HTTP_CLEANUP_TIMEOUT",
      );
      return settled.every((x) => x.status === "fulfilled");
    });
    await cleanupStep("own_requests_removed", async () => {
      if (authority?.isActive())
        await authority.transaction((tx) =>
          tx.query(
            "DELETE FROM public.credential_transfer_requests WHERE request_id=ANY($1::uuid[])",
            [requestIds],
          ),
        );
      const rows = await observer.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.credential_transfer_requests WHERE request_id=ANY($1::uuid[])",
        [requestIds],
      );
      return rows.rows[0]?.n === "0";
    });
    await cleanupStep("own_identity_and_refresh_rows_removed", async () => {
      if (cleanup.own_requests_removed)
        await db.transaction(async (tx) => {
          await tx.query(
            "DELETE FROM public.refresh_tokens WHERE session_id=ANY($1::uuid[])",
            [sessionIds],
          );
          await tx.query(
            "DELETE FROM public.sessions WHERE id=ANY($1::uuid[])",
            [sessionIds],
          );
          await tx.query(
            "DELETE FROM public.devices WHERE id=ANY($1::uuid[])",
            [deviceIds],
          );
          await tx.query("DELETE FROM public.accounts WHERE id=$1", [
            accountId,
          ]);
          await tx.query("DELETE FROM public.users WHERE id=$1", [userId]);
        });
      const rows = await observer.query<{ n: string }>(
        `SELECT ((SELECT count(*) FROM public.users WHERE id=$1)+(SELECT count(*) FROM public.accounts WHERE id=$2)+(SELECT count(*) FROM public.devices WHERE id=ANY($3::uuid[]))+(SELECT count(*) FROM public.sessions WHERE id=ANY($4::uuid[]))+(SELECT count(*) FROM public.refresh_tokens WHERE session_id=ANY($4::uuid[])))::text AS n`,
        [userId, accountId, deviceIds, sessionIds],
      );
      return rows.rows[0]?.n === "0";
    });
    await cleanupStep("own_temporary_role_removed", async () => {
      try {
        await authority?.dispose();
      } catch (error) {
        // Preserve the failed first cleanup; only cleanup, never business, may retry.
        capture(error);
        await authority?.dispose();
      }
      const rows = await observer.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_roles WHERE rolname=$1",
        [authority?.role ?? ""],
      );
      return rows.rows[0]?.n === "0";
    });
    await cleanupStep("context_empty_and_journal52_preserved", async () => {
      const rows = await observer.query<{ n: string; m: string }>(
        "SELECT (SELECT count(*)::text FROM octoport_transfer_fence.authorized_transactions) AS n,(SELECT count(*)::text FROM drizzle.__drizzle_migrations) AS m",
      );
      return rows.rows[0]?.n === "0" && rows.rows[0]?.m === "52";
    });
    await cleanupStep("application_pool_closed", async () => {
      await db.close();
      return true;
    });
    await cleanupStep("observer_pool_closed", async () => {
      await observer.close();
      return true;
    });
  }
  return {
    kind: "C06_R15_REAL_HTTP_ACK_STOP",
    verdict:
      failures.length === 0 &&
      checks.length === 46 &&
      checks.every((x) => x.passed) &&
      Object.values(cleanup).every(Boolean)
        ? "PASS_SCOPED_REAL_HTTP_ACK_STOP"
        : "FAIL_OR_INCONCLUSIVE",
    total: checks.length,
    passed: checks.filter((x) => x.passed).length,
    checks,
    cleanup,
    failureTypes: failures,
    limits: [
      "Actual signed loopback HTTP, Fastify drain and PostgreSQL COMMIT; held application continuation is not delayed TCP from PostgreSQL",
      "Test-only SESSION AUTHORIZATION; no restricted runtime LOGIN, password or HBA change",
      "No OS signal or full main.ts process acceptance; no process restart or pre-ACK restart test",
      "No old binary, network partition/pooler/restore or complete four-P1 acceptance",
      "Synthetic account/device/token in memory, no owner credentials or browser",
    ],
  };
}
