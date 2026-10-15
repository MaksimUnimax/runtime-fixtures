import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExtensionAuthService,
  ExtensionPrincipal,
} from "@product/extension-auth";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
  createMemoryTransferRepository,
} from "@product/credential-transfer";
import { createApiApp } from "./app.js";

// Actual Fastify validation/pre-handler and transfer service; synthetic auth and
// in-memory repository only. No database, browser, migration, or owner session.
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const SOURCE: ExtensionPrincipal = {
  accountId: ACCOUNT,
  deviceId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
};
const RECIPIENT: ExtensionPrincipal = {
  accountId: ACCOUNT,
  deviceId: "44444444-4444-4444-8444-444444444444",
  sessionId: "55555555-5555-4555-8555-555555555555",
};
const FIRST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SECOND = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const PACKET = "66666666-6666-4666-8666-666666666666";
const pendingCleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of pendingCleanup.splice(0)) await close();
});

async function fixture() {
  const relay = new EphemeralTransferRelay();
  const service = new CredentialTransferService(
    createMemoryTransferRepository(),
    relay,
    () => new Date("2026-10-13T00:00:00.000Z"),
  );
  const authenticateAccess = vi.fn(async (token: string) => {
    if (token === "route-source-test")
      return { ok: true as const, value: SOURCE };
    if (token === "route-recipient-test")
      return { ok: true as const, value: RECIPIENT };
    return { ok: false as const, code: "ACCESS_TOKEN_INVALID" as const };
  });
  const app = createApiApp({
    config: {
      environment: "test",
      databaseUrl: "postgres://example.invalid/unused",
      logLevel: "warn",
      apiPort: 0,
      workerReadyDelayMs: 0,
    },
    isInfrastructureReady: async () => true,
    extensionAuthService: {
      authenticateAccess,
    } as unknown as ExtensionAuthService,
    credentialTransferService: service,
  });
  pendingCleanup.push(async () => {
    relay.delete(FIRST);
    relay.delete(SECOND);
    await app.close();
  });
  await app.ready();
  for (const requestId of [FIRST, SECOND]) {
    await service.create(RECIPIENT, {
      requestId,
      recipientDeviceId: RECIPIENT.deviceId,
      sourceDeviceId: SOURCE.deviceId,
      recipientPublicKeySpki: "A".repeat(128),
      selectedStores: [{ storeId: "synthetic-route-store" }],
      consent: true,
      expiresInSeconds: 300,
    });
    await service.sourceSeen(SOURCE, requestId);
  }
  const snapshot = () =>
    Promise.all([FIRST, SECOND].map((id) => service.read(RECIPIENT, id)));
  const deliverSecond = async () => {
    await service.submit(SOURCE, {
      requestId: SECOND,
      packetId: PACKET,
      envelope: "synthetic-envelope",
    });
    await service.receive(RECIPIENT, SECOND);
  };
  return { app, relay, service, authenticateAccess, snapshot, deliverSecond };
}

const headers = (kind: "packet" | "ack") => ({
  authorization:
    "Bearer " +
    (kind === "packet" ? "route-source-test" : "route-recipient-test"),
});
const payload = (kind: "packet" | "ack", requestId: string = SECOND) =>
  kind === "packet"
    ? { requestId, packetId: PACKET, envelope: "synthetic-envelope" }
    : { requestId, packetId: PACKET, importDecision: "IMPORTED" };

describe("credential transfer request identity at HTTP ingress", () => {
  it.each(["packet", "ack"] as const)(
    "rejects mismatched %s URL/body before changing either transfer",
    async (kind) => {
      const f = await fixture();
      if (kind === "ack") await f.deliverSecond();
      const before = await f.snapshot();
      const spy = vi.spyOn(
        f.service,
        kind === "packet" ? "submit" : "acknowledge",
      );
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/credential-transfers/${FIRST}/${kind}`,
        headers: headers(kind),
        payload: payload(kind),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "TRANSFER_INVALID" },
      });
      expect(spy).not.toHaveBeenCalled();
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it.each(["packet", "ack"] as const)(
    "does not treat nonexistent %s path as a request alias",
    async (kind) => {
      const f = await fixture();
      if (kind === "ack") await f.deliverSecond();
      const before = await f.snapshot();
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/credential-transfers/77777777-7777-4777-8777-777777777777/${kind}`,
        headers: headers(kind),
        payload: payload(kind),
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "TRANSFER_INVALID" },
      });
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it.each(["packet", "ack"] as const)(
    "retains authentication on mismatched %s requests",
    async (kind) => {
      const f = await fixture();
      if (kind === "ack") await f.deliverSecond();
      const before = await f.snapshot();
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/credential-transfers/${FIRST}/${kind}`,
        payload: payload(kind),
      });
      expect(response.statusCode).toBe(401);
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it.each(["packet", "ack"] as const)(
    "keeps body schema validation for %s",
    async (kind) => {
      const f = await fixture();
      const before = await f.snapshot();
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/credential-transfers/${SECOND}/${kind}`,
        headers: headers(kind),
        payload: payload(kind, "not-a-uuid"),
      });
      expect(response.statusCode).toBe(400);
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it.each(["packet", "ack"] as const)(
    "allows matching %s identity and changes only that transfer",
    async (kind) => {
      const f = await fixture();
      if (kind === "ack") await f.deliverSecond();
      const before = await f.snapshot();
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/credential-transfers/${SECOND}/${kind}`,
        headers: headers(kind),
        payload: payload(kind),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        requestId: SECOND,
        state: kind === "packet" ? "PACKET_AVAILABLE_EPHEMERAL" : "COMPLETED",
      });
      const after = await f.snapshot();
      expect(after[0]).toEqual(before[0]);
      expect(after[1]?.revision).toBe((before[1]?.revision ?? 0) + 1);
    },
  );

  it.each(["packet", "ack"] as const)(
    "treats uppercase UUID path as the same %s identity",
    async (kind) => {
      const f = await fixture();
      if (kind === "ack") await f.deliverSecond();
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/credential-transfers/${SECOND.toUpperCase()}/${kind}`,
        headers: headers(kind),
        payload: payload(kind),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ requestId: SECOND });
    },
  );

  it.each(["packet", "ack"] as const)(
    "normalizes uppercase UUID body for %s service lookup",
    async (kind) => {
      const f = await fixture();
      if (kind === "ack") await f.deliverSecond();
      const before = await f.snapshot();
      const spy = vi.spyOn(
        f.service,
        kind === "packet" ? "submit" : "acknowledge",
      );
      const response = await f.app.inject({
        method: "POST",
        url: `/v1/credential-transfers/${SECOND}/${kind}`,
        headers: headers(kind),
        payload: payload(kind, SECOND.toUpperCase()),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        requestId: SECOND,
        state: kind === "packet" ? "PACKET_AVAILABLE_EPHEMERAL" : "COMPLETED",
      });
      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ requestId: SECOND }),
      );
      const after = await f.snapshot();
      expect(after[0]).toEqual(before[0]);
      expect(after[1]?.revision).toBe((before[1]?.revision ?? 0) + 1);
    },
  );
});
