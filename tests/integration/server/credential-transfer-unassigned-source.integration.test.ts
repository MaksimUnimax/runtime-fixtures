import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
} from "../../../packages/server/credential-transfer/src/index.js";
import {
  createCredentialTransferRepository,
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "../../../packages/server/db/src/index.js";
import { runMigrations } from "../../../packages/server/db/src/migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required for real PostgreSQL tests");
let db: DatabaseRuntime;
const ownedAccounts: string[] = [];
const ownedUsers: string[] = [];

async function fixture(assigned = false) {
  const accountId = randomUUID(),
    userId = randomUUID();
  await db.query("INSERT INTO users(id) VALUES($1)", [userId]);
  ownedUsers.push(userId);
  await db.query("INSERT INTO accounts(id) VALUES($1)", [accountId]);
  ownedAccounts.push(accountId);
  const principals = [];
  for (let i = 0; i < 3; i++) {
    const deviceId = randomUUID();
    await db.query(
      "INSERT INTO devices(id,account_id,created_by_user_id,browser_family,extension_version_last_seen) VALUES($1,$2,$3,'chrome','0.2.13')",
      [deviceId, accountId, userId],
    );
    principals.push({ accountId, deviceId, sessionId: randomUUID() });
  }
  const [recipient, source, alternate] = principals as [
    (typeof principals)[number],
    (typeof principals)[number],
    (typeof principals)[number],
  ];
  const repository = createCredentialTransferRepository(db);
  let clock = new Date("2026-10-08T00:00:00.000Z");
  const service = new CredentialTransferService(
    repository,
    new EphemeralTransferRelay(),
    () => clock,
  );
  const requestId = randomUUID();
  await service.create(recipient, {
    requestId,
    recipientDeviceId: recipient.deviceId,
    sourceDeviceId: assigned ? source.deviceId : null,
    recipientPublicKeySpki: "A".repeat(128),
    selectedStores: [{ storeId: "store-ozon" }],
    consent: true,
    expiresInSeconds: 300,
  });
  return {
    service,
    repository,
    recipient,
    source,
    alternate,
    requestId,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe.sequential(
  "credential transfer with the production PostgreSQL repository",
  () => {
    beforeAll(async () => {
      db = createDatabaseRuntime(connectionString!);
      await db.ready();
      await runMigrations({ connectionString: connectionString! });
    });
    afterAll(async () => {
      try {
        await db.query(
          "DELETE FROM credential_transfer_requests WHERE account_id=ANY($1::uuid[])",
          [ownedAccounts],
        );
        await db.query("DELETE FROM devices WHERE account_id=ANY($1::uuid[])", [
          ownedAccounts,
        ]);
        await db.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [
          ownedAccounts,
        ]);
        await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
          ownedUsers,
        ]);
      } finally {
        await db.close();
      }
    });

    it.each([false, true])(
      "completes a transfer and preserves the delivered packet (assigned=%s)",
      async (assigned) => {
        const { service, source, recipient, requestId } =
          await fixture(assigned);
        if (!assigned)
          expect(await service.read(source, requestId)).toBeUndefined();
        expect(
          (await service.listForSource(source)).some(
            (row) => row.requestId === requestId,
          ),
        ).toBe(true);
        const seen = await service.sourceSeen(source, requestId);
        expect(seen.state).toBe("SOURCE_SEEN");
        expect(seen.sourceDeviceId).toBe(source.deviceId);
        const packet = {
          requestId,
          packetId: randomUUID(),
          envelope: "A".repeat(64),
        };
        await service.submit(source, packet);
        expect(await service.receive(recipient, requestId)).toEqual(packet);
        const delivered = await service.read(recipient, requestId);
        await expect(
          service.sourceSeen(source, requestId),
        ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });
        await expect(
          service.submit(source, { ...packet, packetId: randomUUID() }),
        ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });
        expect(await service.read(recipient, requestId)).toEqual(delivered);
        expect(await service.receive(recipient, requestId)).toEqual(packet);
        const done = await service.acknowledge(recipient, {
          requestId,
          packetId: packet.packetId,
          importDecision: "IMPORTED",
        });
        expect(done.state).toBe("COMPLETED");
        await expect(
          service.receive(recipient, requestId),
        ).rejects.toMatchObject({ code: "SOURCE_OFFLINE" });
      },
    );

    it("commits ACK durably when the HTTP response is lost after commit", async () => {
      const f = await fixture(true);
      await f.service.sourceSeen(f.source, f.requestId);
      const packet = {
        requestId: f.requestId,
        packetId: randomUUID(),
        envelope: "A".repeat(64),
      };
      await f.service.submit(f.source, packet);
      await f.service.receive(f.recipient, f.requestId);
      expect((await f.service.read(f.recipient, f.requestId))?.state).toBe(
        "DELIVERED_TO_RECIPIENT",
      );

      // A test-only loopback HTTP adapter discards the successful response
      // AFTER production service + PostgreSQL have committed the ACK.
      // This is not a test of the real API auth/route composition.
      let responseDrops = 0;
      const server = createServer(async (request, reply) => {
        try {
          if (request.method === "POST" && request.url === "/test-only/ack") {
            const result = await f.service.acknowledge(f.recipient, {
              requestId: f.requestId,
              packetId: packet.packetId,
              importDecision: "IMPORTED",
            });
            if (result.state !== "COMPLETED")
              throw new Error("ACK did not commit before socket loss");
            responseDrops += 1;
            reply.destroy();
            return;
          }
          if (request.method === "GET" && request.url === "/test-only/state") {
            const restarted = new CredentialTransferService(
              createCredentialTransferRepository(db),
              new EphemeralTransferRelay(),
              () => new Date("2026-10-08T00:00:00.000Z"),
            );
            const row = await restarted.read(f.recipient, f.requestId);
            reply.setHeader("content-type", "application/json");
            reply.end(
              JSON.stringify({
                state: row?.state,
                revision: row?.revision,
              }),
            );
            return;
          }
          reply.statusCode = 404;
          reply.end();
        } catch {
          reply.statusCode = 500;
          reply.end();
        }
      });
      const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (address && typeof address !== "string") resolve(address.port);
          else reject(new Error("No loopback test port"));
        });
      });
      const origin = `http://127.0.0.1:${port}`;
      try {
        await expect(
          fetch(`${origin}/test-only/ack`, {
            method: "POST",
            signal: AbortSignal.timeout(5_000),
          }),
        ).rejects.toThrow();
        expect(responseDrops).toBe(1);

        // A new in-memory relay cannot invent a second packet or ACK.
        const state = await fetch(`${origin}/test-only/state`, {
          signal: AbortSignal.timeout(5_000),
        });
        expect(state.status).toBe(200);
        const recovered = (await state.json()) as {
          state: string;
          revision: number;
        };
        expect(recovered.state).toBe("COMPLETED");
        const stored = await db.query<{ state: string; revision: number }>(
          "SELECT state,revision FROM credential_transfer_requests WHERE request_id=$1",
          [f.requestId],
        );
        expect(stored.rows).toHaveLength(1);
        expect(stored.rows[0]).toEqual(recovered);
        await expect(
          f.service.acknowledge(f.recipient, {
            requestId: f.requestId,
            packetId: packet.packetId,
            importDecision: "IMPORTED",
          }),
        ).rejects.toMatchObject({ code: "TRANSFER_REPLAY" });

        // Bypass the in-memory relay in this TEST ONLY to verify that the
        // production PostgreSQL transaction itself rejects a repeated ACK.
        await expect(
          f.repository.acknowledge({
            principal: f.recipient,
            ack: {
              requestId: f.requestId,
              packetId: packet.packetId,
              importDecision: "IMPORTED",
            },
            now: new Date("2026-10-08T00:00:00.000Z"),
          }),
        ).rejects.toMatchObject({ code: "TRANSFER_REPLAY" });
        const afterDbReplay = await db.query<{
          state: string;
          revision: number;
        }>(
          "SELECT state,revision FROM credential_transfer_requests WHERE request_id=$1",
          [f.requestId],
        );
        expect(afterDbReplay.rows).toEqual(stored.rows);
        expect((await f.service.read(f.recipient, f.requestId))?.revision).toBe(
          recovered.revision,
        );
        expect(responseDrops).toBe(1);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((failure) => (failure ? reject(failure) : resolve()));
        });
      }
    });

    it("rejects recipient self-assignment under the PostgreSQL transition lock", async () => {
      const f = await fixture();
      const before = await f.service.read(f.recipient, f.requestId);
      await expect(
        f.service.sourceSeen(f.recipient, f.requestId),
      ).rejects.toMatchObject({ code: "TRANSFER_ACCOUNT_MISMATCH" });
      await expect(
        f.repository.markSourceSeen({
          principal: f.recipient,
          requestId: f.requestId,
          now: new Date("2026-10-08T00:00:00.000Z"),
        }),
      ).rejects.toMatchObject({ code: "TRANSFER_ACCOUNT_MISMATCH" });
      expect(await f.service.read(f.recipient, f.requestId)).toEqual(before);
      expect(
        (await f.service.sourceSeen(f.source, f.requestId)).sourceDeviceId,
      ).toBe(f.source.deviceId);
    });

    it("keeps an unassigned request inaccessible to a different account", async () => {
      const f = await fixture();
      const other = await fixture();
      expect(
        (await f.service.listForSource(other.source)).some(
          (row) => row.requestId === f.requestId,
        ),
      ).toBe(false);
      await expect(
        f.service.sourceSeen(other.source, f.requestId),
      ).rejects.toMatchObject({ code: "TRANSFER_ACCOUNT_MISMATCH" });
      expect(
        (await f.service.read(f.recipient, f.requestId))?.sourceDeviceId,
      ).toBeNull();
    });

    it("rejects another source after explicit assignment", async () => {
      const f = await fixture(true);
      await expect(
        f.service.sourceSeen(f.alternate, f.requestId),
      ).rejects.toMatchObject({ code: "TRANSFER_ACCOUNT_MISMATCH" });
      expect(
        (await f.service.read(f.recipient, f.requestId))?.sourceDeviceId,
      ).toBe(f.source.deviceId);
    });

    it.each([false, true])(
      "rejects a revoked source without changing durable state (assigned=%s)",
      async (assigned) => {
        const f = await fixture(assigned);
        const before = await f.service.read(f.recipient, f.requestId);
        await db.query(
          "UPDATE devices SET status='REVOKED',revoked_at=now() WHERE id=$1",
          [f.source.deviceId],
        );
        await expect(
          f.service.sourceSeen(f.source, f.requestId),
        ).rejects.toMatchObject({ code: "TRANSFER_DEVICE_REVOKED" });
        expect(await f.service.read(f.recipient, f.requestId)).toEqual(before);
      },
    );

    it("does not revive an expired assigned request", async () => {
      const f = await fixture(true);
      f.advance(301_000);
      await expect(
        f.service.sourceSeen(f.source, f.requestId),
      ).rejects.toMatchObject({ code: "TRANSFER_EXPIRED" });
      expect((await f.service.read(f.recipient, f.requestId))?.state).toBe(
        "EXPIRED",
      );
    });
  },
);
