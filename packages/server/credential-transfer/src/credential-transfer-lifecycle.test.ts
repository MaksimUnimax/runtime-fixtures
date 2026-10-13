import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
  TransferError,
  createMemoryTransferRepository,
  type TransferRepository,
} from "./index.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const source = {
  accountId,
  deviceId: "21111111-1111-4111-8111-111111111111",
  sessionId: "31111111-1111-4111-8111-111111111111",
};
const recipient = {
  accountId,
  deviceId: "41111111-1111-4111-8111-111111111111",
  sessionId: "51111111-1111-4111-8111-111111111111",
};
const requestId = "61111111-1111-4111-8111-111111111111";
const packetId = "71111111-1111-4111-8111-111111111111";
const now = () => new Date("2026-10-13T20:00:00.000Z");
const createInput = {
  requestId,
  recipientDeviceId: recipient.deviceId,
  sourceDeviceId: source.deviceId,
  recipientPublicKeySpki: "A".repeat(128),
  selectedStores: [{ storeId: "synthetic" }],
  consent: true,
  expiresInSeconds: 300,
};
const packet = { requestId, packetId, envelope: "opaque-synthetic-packet" };
const ack = { requestId, packetId, importDecision: "IMPORTED" };
const relays: EphemeralTransferRelay[] = [];
afterEach(() => {
  for (const relay of relays.splice(0)) relay.clear();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const original = createMemoryTransferRepository();
  const calls: string[] = [];
  let allowed = true;
  let gate:
    | {
        name: keyof TransferRepository;
        entered: ReturnType<typeof deferred>;
        release: ReturnType<typeof deferred>;
        error?: unknown;
      }
    | undefined;
  const repository = new Proxy(original, {
    get(target, key: keyof TransferRepository) {
      const method = target[key];
      return async (...args: unknown[]) => {
        calls.push(key);
        if (!allowed) throw new TransferError("TRANSFER_CONFLICT");
        const value = await Reflect.apply(method, target, args);
        if (gate?.name === key) {
          const current = gate;
          gate = undefined;
          current.entered.resolve();
          await current.release.promise;
          if (current.error !== undefined) throw current.error;
        }
        return value;
      };
    },
  });
  const relay = new EphemeralTransferRelay();
  relays.push(relay);
  const service = new CredentialTransferService(
    repository,
    relay,
    now,
    () => allowed,
  );
  return {
    service,
    relay,
    original,
    calls,
    stop() {
      allowed = false;
      // Also runs against the exact pre-fix source as a negative control.
      // Before the fix shutdown only stopped DB admission, not this service.
      (service as CredentialTransferService & { stop?: () => void }).stop?.();
    },
    loseAdmission() {
      allowed = false;
    },
    arm(name: keyof TransferRepository, error?: unknown) {
      gate = { name, entered: deferred(), release: deferred(), error };
      return gate;
    },
    async prepare() {
      await service.create(recipient, createInput);
      await service.sourceSeen(source, requestId);
    },
  };
}
function settled<T>(value: Promise<T>) {
  return value.then(
    (result) => ({ result, error: undefined }),
    (error) => ({ result: undefined, error }),
  );
}

describe("terminal transfer service and late committed callbacks", () => {
  it("clears resident encrypted packets immediately when stopping", async () => {
    const f = fixture();
    await f.prepare();
    await f.service.submit(source, packet);
    expect(f.relay.statsForTests().packets).toBe(1);
    f.stop();
    f.stop();
    expect(f.relay.statsForTests()).toEqual({
      packets: 0,
      envelopeBytes: 0,
      reserved: 0,
    });
  });
  it("does not activate a packet after its durable mark completed before stop", async () => {
    const f = fixture();
    await f.prepare();
    const g = f.arm("markPacketAvailable");
    const pending = settled(f.service.submit(source, packet));
    await g.entered.promise;
    expect(f.relay.statsForTests().reserved).toBe(1);
    f.stop();
    g.release.resolve();
    expect((await pending).error).toMatchObject({ code: "TRANSFER_CONFLICT" });
    expect(f.relay.statsForTests()).toEqual({
      packets: 0,
      envelopeBytes: 0,
      reserved: 0,
    });
    expect(
      (await f.original.read({ principal: recipient, requestId, now: now() }))
        ?.state,
    ).toBe("PACKET_AVAILABLE_EPHEMERAL");
  });
  it("does not return packet bytes after a committed delivery completes late", async () => {
    const f = fixture();
    await f.prepare();
    await f.service.submit(source, packet);
    const g = f.arm("markDelivered");
    const pending = settled(f.service.receive(recipient, requestId));
    await g.entered.promise;
    f.stop();
    g.release.resolve();
    const result = await pending;
    expect(result.error).toMatchObject({ code: "TRANSFER_CONFLICT" });
    expect(result.result).toBeUndefined();
    expect(f.relay.statsForTests().packets).toBe(0);
    expect(
      (await f.original.read({ principal: recipient, requestId, now: now() }))
        ?.state,
    ).toBe("DELIVERED_TO_RECIPIENT");
  });
  it("does not invent rollback when a committed ACK resolves after stop", async () => {
    const f = fixture();
    await f.prepare();
    await f.service.submit(source, packet);
    await f.service.receive(recipient, requestId);
    const g = f.arm("acknowledge");
    const pending = settled(f.service.acknowledge(recipient, ack));
    await g.entered.promise;
    f.stop();
    g.release.resolve();
    expect((await pending).error).toMatchObject({ code: "TRANSFER_CONFLICT" });
    expect(
      (await f.original.read({ principal: recipient, requestId, now: now() }))
        ?.state,
    ).toBe("COMPLETED");
    expect(f.relay.statsForTests().packets).toBe(0);
  });
  it("rejects a late read without making another repository call", async () => {
    const f = fixture();
    await f.prepare();
    const g = f.arm("read");
    const before = f.calls.length;
    const pending = settled(f.service.read(recipient, requestId));
    await g.entered.promise;
    f.stop();
    g.release.resolve();
    expect((await pending).error).toMatchObject({ code: "TRANSFER_CONFLICT" });
    expect(f.calls.length - before).toBe(1);
  });
  it("clears local relay when its external admission becomes invalid", async () => {
    const f = fixture();
    await f.prepare();
    await f.service.submit(source, packet);
    const g = f.arm("markDelivered");
    const pending = settled(f.service.receive(recipient, requestId));
    await g.entered.promise;
    f.loseAdmission();
    g.release.resolve();
    expect((await pending).error).toMatchObject({ code: "TRANSFER_CONFLICT" });
    expect(f.relay.statsForTests().packets).toBe(0);
  });
  it("preserves an unknown database outcome without replay or false success", async () => {
    const f = fixture();
    await f.prepare();
    const failure = new Error("UNKNOWN_COMMIT");
    const g = f.arm("markPacketAvailable", failure);
    const pending = settled(f.service.submit(source, packet));
    await g.entered.promise;
    f.stop();
    g.release.resolve();
    expect((await pending).error).toBe(failure);
    expect(
      f.calls.filter((name) => name === "markPacketAvailable"),
    ).toHaveLength(1);
    expect(f.relay.statsForTests().packets).toBe(0);
  });
  it.each([
    "create",
    "read",
    "list",
    "sourceSeen",
    "submit",
    "receive",
    "acknowledge",
    "cancel",
    "expireDue",
  ])("blocks %s after stop before any database call", async (name) => {
    const f = fixture();
    await f.prepare();
    f.stop();
    const before = f.calls.length;
    const actions: Record<string, () => unknown> = {
      create: () => f.service.create(recipient, createInput),
      read: () => f.service.read(recipient, requestId),
      list: () => f.service.listForSource(source),
      sourceSeen: () => f.service.sourceSeen(source, requestId),
      submit: () => f.service.submit(source, packet),
      receive: () => f.service.receive(recipient, requestId),
      acknowledge: () => f.service.acknowledge(recipient, ack),
      cancel: () => f.service.cancel(recipient, requestId),
      expireDue: () => f.service.expireDue(),
    };
    await expect(Promise.resolve().then(actions[name]!)).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    expect(f.calls.length).toBe(before);
  });
  it("keeps another service's relay and admitted work independent", async () => {
    const a = fixture(),
      b = fixture();
    await a.prepare();
    await b.prepare();
    await a.service.submit(source, packet);
    await b.service.submit(source, packet);
    a.stop();
    expect(a.relay.statsForTests().packets).toBe(0);
    expect(b.relay.statsForTests().packets).toBe(1);
    await expect(
      b.service.receive(recipient, requestId),
    ).resolves.toMatchObject(packet);
  });
});
