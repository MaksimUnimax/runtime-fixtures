import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  createCredentialTransferRepository,
  createDatabaseRuntime,
  createExtensionAuthRepository,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for real PostgreSQL tests");

type Principal = {
  accountId: string;
  deviceId: string;
  sessionId: string;
};
let db: DatabaseRuntime;
const allocated: Array<{
  userId: string;
  accountId: string;
  deviceIds: string[];
  sessionIds: string[];
}> = [];

async function activePair(): Promise<{
  source: Principal;
  recipient: Principal;
}> {
  const userId = randomUUID();
  const accountId = randomUUID();
  const deviceIds = [randomUUID(), randomUUID()];
  const sessionIds = [randomUUID(), randomUUID()];
  allocated.push({ userId, accountId, deviceIds, sessionIds });

  await db.query("INSERT INTO users(id) VALUES($1)", [userId]);
  await db.query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
  for (let i = 0; i < 2; i += 1) {
    await db.query(
      "INSERT INTO devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$2,$3,'chrome','0.2.15')",
      [deviceIds[i], accountId, userId],
    );
    await db.query(
      "INSERT INTO sessions(id,device_id,account_id,token_family_id) VALUES($1,$2,$3,$4)",
      [sessionIds[i], deviceIds[i], accountId, randomUUID()],
    );
  }
  return {
    source: { accountId, deviceId: deviceIds[0]!, sessionId: sessionIds[0]! },
    recipient: {
      accountId,
      deviceId: deviceIds[1]!,
      sessionId: sessionIds[1]!,
    },
  };
}

describe.sequential("B03 signed access through real ACK route", () => {
  beforeAll(async () => {
    db = createDatabaseRuntime(connectionString!);
    await db.ready();
    await runMigrations({ connectionString: connectionString! });
  });

  afterAll(async () => {
    try {
      for (const row of allocated) {
        await db.query(
          "DELETE FROM refresh_tokens WHERE session_id=ANY($1::uuid[])",
          [row.sessionIds],
        );
        await db.query(
          "DELETE FROM credential_transfer_requests WHERE account_id=$1",
          [row.accountId],
        );
        await db.query("DELETE FROM sessions WHERE id=ANY($1::uuid[])", [
          row.sessionIds,
        ]);
        await db.query("DELETE FROM devices WHERE id=ANY($1::uuid[])", [
          row.deviceIds,
        ]);
        await db.query("DELETE FROM accounts WHERE id=$1", [row.accountId]);
        await db.query("DELETE FROM users WHERE id=$1", [row.userId]);
      }
    } finally {
      await db.close();
    }
  });

  it("recovers a committed ACK after losing its response with a real signed bearer", async () => {
    const { source, recipient } = await activePair();
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
    expect(await auth.authenticateAccess(issued.value.accessToken)).toEqual({
      ok: true,
      value: recipient,
    });

    const service = new CredentialTransferService(
      createCredentialTransferRepository(db),
      new EphemeralTransferRelay(),
    );
    const requestId = randomUUID();
    const packetId = randomUUID();
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
    expect(delivered?.state).toBe("DELIVERED_TO_RECIPIENT");

    const app = createApiApp({
      config: {
        environment: "test",
        databaseUrl: connectionString!,
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
    try {
      await expect(
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
      ).rejects.toThrow();
      expect(droppedReplies).toBe(1);

      const read = await fetch(
        origin + "/v1/credential-transfers/" + requestId,
        { headers, signal: AbortSignal.timeout(5_000) },
      );
      expect(read.status).toBe(200);
      const state = (await read.json()) as {
        state: string;
        revision: number;
      };
      expect(state.state).toBe("COMPLETED");
      expect(state.revision).toBe((delivered?.revision ?? 0) + 1);
      const stored = await db.query<{ state: string; revision: number }>(
        "SELECT state,revision FROM credential_transfer_requests WHERE request_id=$1",
        [requestId],
      );
      expect(stored.rows).toEqual([
        { state: state.state, revision: state.revision },
      ]);
      expect(droppedReplies).toBe(1);
    } finally {
      await app.close();
    }
  });
});
