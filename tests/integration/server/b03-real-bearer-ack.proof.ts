import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApiApp } from "../../../apps/api/src/app.js";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
} from "../../../packages/server/credential-transfer/src/index.js";
import {
  ExtensionAuthService,
  createEphemeralAccessTokenSigningKey,
  deriveExtensionAuthKeys,
} from "../../../packages/server/extension-auth/src/index.js";
import {
  createDatabaseRuntime,
  createExtensionAuthRepository,
} from "../../../packages/server/db/src/index.js";
import { createCredentialTransferTestAuthority } from "./helpers/credential-transfer-test-authority.js";

/** Existing PR50 signed-bearer ACK response-loss case, adapted to migration50.
 * No old/new process-restart or owner-login scenario is implemented here.
 */
export async function proveSignedBearerAckWithTransferAuthority(
  connectionString: string,
  expectedDatabase:
    | "octoport_a_test"
    | "octoport_b_test"
    | "octoport_c_test"
    | "product_control_plane_test",
) {
  const db = createDatabaseRuntime(connectionString);
  let authority:
    | Awaited<ReturnType<typeof createCredentialTransferTestAuthority>>
    | undefined;
  let app: ReturnType<typeof createApiApp> | undefined;
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
  const requestId = randomUUID(),
    packetId = randomUUID();
  const checks: string[] = [];
  let seedAttempted = false;
  const failures: unknown[] = [];
  let result:
    | { kind: string; verdict: string; checks: string[]; limits: string[] }
    | undefined;
  try {
    await db.ready();
    authority = await createCredentialTransferTestAuthority(
      db,
      expectedDatabase,
    );
    seedAttempted = true;
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO users(id) VALUES($1)", [userId]);
      await tx.query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
      for (let i = 0; i < 2; i += 1) {
        await tx.query(
          "INSERT INTO devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$2,$3,'chrome','0.2.15')",
          [deviceIds[i], accountId, userId],
        );
        await tx.query(
          "INSERT INTO sessions(id,device_id,account_id,token_family_id) VALUES($1,$2,$3,$4)",
          [sessionIds[i], deviceIds[i], accountId, randomUUID()],
        );
      }
    });
    const signingKey =
      createEphemeralAccessTokenSigningKey("b03-pg-integration");
    const auth = new ExtensionAuthService(
      createExtensionAuthRepository(db),
      deriveExtensionAuthKeys(Buffer.alloc(32, 67)),
      undefined,
      signingKey,
    );
    const issued = await auth.issue(recipient.sessionId);
    if (!issued.ok) throw new Error(issued.code);
    assert.deepEqual(await auth.authenticateAccess(issued.value.accessToken), {
      ok: true,
      value: recipient,
    });
    checks.push("actual_signed_bearer_issuance_and_validation");
    const service = new CredentialTransferService(
      authority.repository,
      new EphemeralTransferRelay(),
    );
    await service.create(recipient, {
      requestId,
      recipientDeviceId: recipient.deviceId,
      sourceDeviceId: source.deviceId,
      recipientPublicKeySpki: "A".repeat(128),
      selectedStores: [{ storeId: "synthetic-store" }],
      consent: true,
      expiresInSeconds: 300,
    });
    await service.sourceSeen(source, requestId);
    await service.submit(source, {
      requestId,
      packetId,
      envelope: "A".repeat(64),
    });
    await service.receive(recipient, requestId);
    const delivered = await service.read(recipient, requestId);
    assert.equal(delivered?.state, "DELIVERED_TO_RECIPIENT");
    checks.push("real_fenced_create_source_submit_receive");
    app = createApiApp({
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
    const ackPath = "/v1/credential-transfers/" + requestId + "/ack";
    let droppedReplies = 0;
    app.addHook("onSend", (request, reply, payload, done) => {
      if (
        request.url === ackPath &&
        request.method === "POST" &&
        reply.statusCode === 200
      ) {
        droppedReplies += 1;
        reply.raw.destroy();
      }
      done(null, payload);
    });
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const headers = {
      authorization: "Bearer " + issued.value.accessToken,
      "content-type": "application/json",
    };
    await assert.rejects(
      fetch(origin + ackPath, {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestId,
          packetId,
          importDecision: "IMPORTED",
        }),
        signal: AbortSignal.timeout(5_000),
      }),
    );
    assert.equal(droppedReplies, 1);
    checks.push("one_ack_response_lost_after_success_no_second_post");
    const read = await fetch(origin + "/v1/credential-transfers/" + requestId, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(read.status, 200);
    const state = (await read.json()) as { state: string; revision: number };
    assert.equal(state.state, "COMPLETED");
    assert.equal(state.revision, (delivered?.revision ?? 0) + 1);
    const stored = await db.query<{ state: string; revision: number }>(
      "SELECT state,revision FROM credential_transfer_requests WHERE request_id=$1",
      [requestId],
    );
    assert.deepEqual(stored.rows, [
      { state: state.state, revision: state.revision },
    ]);
    assert.equal(droppedReplies, 1);
    checks.push("http_readback_and_postgresql_match_committed_ack");
    assert.equal(authority.isActive(), true);
    const context = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM octoport_transfer_fence.authorized_transactions",
    );
    assert.equal(context.rows[0]?.n, "0");
    checks.push("mandatory_fence_admission_and_context_cleanup_preserved");
    result = {
      kind: "C06_R9_EXISTING_SIGNED_BEARER_CONSUMER",
      verdict: "PASS_SCOPED_EXISTING_HTTP_ACK_CONSUMER",
      checks,
      limits: [
        "Explicit test SESSION AUTHORIZATION is not actual runtime LOGIN",
        "Existing PR50 scenario, not forbidden pre-ACK process restart",
        "No ordinary owner login, two-profile installation, main publication or live deployment",
      ],
    };
  } catch (error) {
    failures.push(error);
  }
  async function cleanupStep(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  }
  await cleanupStep(async () => {
    await app?.close();
  });
  if (seedAttempted) {
    // Exact IDs were reserved before attempting the atomic seed. Cleanup also
    // covers a COMMIT whose response was lost; no seed/business retry occurs.
    await cleanupStep(() =>
      db.query("DELETE FROM refresh_tokens WHERE session_id=ANY($1::uuid[])", [
        sessionIds,
      ]),
    );
    await cleanupStep(async () => {
      const cleanupAuthority = authority;
      assert.ok(
        cleanupAuthority,
        "OWN_REQUEST_CLEANUP_REQUIRES_TEST_AUTHORITY",
      );
      assert.equal(
        cleanupAuthority.isActive(),
        true,
        "OWN_REQUEST_CLEANUP_REQUIRES_ACTIVE_TEST_AUTHORITY",
      );
      await cleanupAuthority.transaction((tx) =>
        tx.query(
          "DELETE FROM credential_transfer_requests WHERE account_id=$1",
          [accountId],
        ),
      );
    });
    await cleanupStep(() =>
      db.query("DELETE FROM sessions WHERE id=ANY($1::uuid[])", [sessionIds]),
    );
    await cleanupStep(() =>
      db.query("DELETE FROM devices WHERE id=ANY($1::uuid[])", [deviceIds]),
    );
    await cleanupStep(() =>
      db.query("DELETE FROM accounts WHERE id=$1", [accountId]),
    );
    await cleanupStep(() =>
      db.query("DELETE FROM users WHERE id=$1", [userId]),
    );
  }
  await cleanupStep(async () => {
    await authority?.dispose();
  });
  await cleanupStep(async () => {
    const counts = await db.query<Record<string, number>>(
      `SELECT
      (SELECT count(*)::int FROM users WHERE id=$1) AS users,
      (SELECT count(*)::int FROM accounts WHERE id=$2) AS accounts,
      (SELECT count(*)::int FROM devices WHERE id=ANY($3::uuid[])) AS devices,
      (SELECT count(*)::int FROM sessions WHERE id=ANY($4::uuid[])) AS sessions,
      (SELECT count(*)::int FROM refresh_tokens WHERE session_id=ANY($4::uuid[])) AS refresh_tokens,
      (SELECT count(*)::int FROM credential_transfer_requests WHERE account_id=$2) AS requests,
      (SELECT count(*)::int FROM pg_roles WHERE rolname=$5) AS roles,
      (SELECT count(*)::int FROM octoport_transfer_fence.authorized_transactions) AS private_context`,
      [
        userId,
        accountId,
        deviceIds,
        sessionIds,
        authority?.role ?? "c06_no_authority_returned",
      ],
    );
    assert.equal(counts.rows.length, 1);
    assert.deepEqual(Object.values(counts.rows[0]!), Array(8).fill(0));
    checks.push("own_rows_role_and_private_context_removed_readback");
  });
  await cleanupStep(() => db.close());
  if (failures.length)
    throw new AggregateError(failures, "SIGNED_BEARER_PROOF_OR_CLEANUP_FAILED");
  assert.ok(result);
  return result;
}
