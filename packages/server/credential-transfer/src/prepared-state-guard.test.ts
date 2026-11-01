import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
  createMemoryTransferRepository,
} from "./index.js";
const uuid = (n: number) =>
  `82000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = { accountId: uuid(1), deviceId: uuid(2), sessionId: uuid(3) };
const recipient = { accountId: uuid(1), deviceId: uuid(4), sessionId: uuid(5) };
const requestId = uuid(6);
const firstPacket = {
  requestId,
  packetId: uuid(7),
  envelope: "SYNTHETIC_PREPARED_P1",
};
const secondPacket = {
  requestId,
  packetId: uuid(8),
  envelope: "SYNTHETIC_PREPARED_P2",
};
const now = () => new Date("2026-11-01T00:00:00.000Z");
const live: CredentialTransferService[] = [];
afterEach(() => live.splice(0).forEach((x) => x.stop()));
async function fixture() {
  const repository = createMemoryTransferRepository();
  const create = () => {
    const service = new CredentialTransferService(
      repository,
      new EphemeralTransferRelay(),
      now,
    );
    live.push(service);
    return service;
  };
  const first = create(),
    second = create();
  await first.create(recipient, {
    requestId,
    recipientDeviceId: recipient.deviceId,
    sourceDeviceId: source.deviceId,
    recipientPublicKeySpki: "A".repeat(128),
    selectedStores: [{ storeId: "synthetic" }],
    consent: true,
    expiresInSeconds: 300,
  });
  await first.sourceSeen(source, requestId);
  const read = () =>
    repository.read({ principal: recipient, requestId, now: now() });
  return { first, second, repository, read };
}
async function finish(first: CredentialTransferService, packet = firstPacket) {
  await expect(first.receive(recipient, requestId)).resolves.toEqual(packet);
  await expect(
    first.acknowledge(recipient, {
      requestId,
      packetId: packet.packetId,
      importDecision: "IMPORTED",
    }),
  ).resolves.toMatchObject({ state: "COMPLETED" });
}
describe("whole B03 prepared ownership across process-local relays", () => {
  it("empty-relay discovery is idempotent and preserves a live P1 delivery/ACK", async () => {
    const f = await fixture();
    await f.first.submit(source, firstPacket);
    const before = await f.read();
    expect(await f.second.sourceSeen(source, requestId)).toEqual(before);
    expect(await f.read()).toEqual(before);
    await finish(f.first);
  });
  it("cannot silently replace live P1 from another empty relay", async () => {
    const f = await fixture();
    await f.first.submit(source, firstPacket);
    const before = await f.read();
    await expect(f.second.submit(source, secondPacket)).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    expect(await f.read()).toEqual(before);
    expect(f.second.relayForTests().statsForTests()).toMatchObject({
      packets: 0,
      reserved: 0,
    });
    await finish(f.first);
  });
  it("allows exactly one first prepare when two relays read the same source revision", async () => {
    const f = await fixture();
    const replies = await Promise.allSettled([
      f.first.submit(source, firstPacket),
      f.second.submit(source, secondPacket),
    ]);
    expect(replies.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const firstWon = replies[0]!.status === "fulfilled";
    await finish(
      firstWon ? f.first : f.second,
      firstWon ? firstPacket : secondPacket,
    );
  });
  it("keeps same-relay pre-delivery replacement and its original TTL", async () => {
    const f = await fixture();
    await f.first.submit(source, firstPacket);
    const expiry = (await f.read())!.expiresAt;
    await f.first.submit(source, secondPacket);
    expect((await f.read())!.expiresAt).toBe(expiry);
    await finish(f.first, secondPacket);
  });
  it("recovers only after a confirmed new relay epoch, preserving request expiry", async () => {
    const f = await fixture();
    await f.first.submit(source, firstPacket);
    const expiry = (await f.read())!.expiresAt;
    f.first.stop();
    await expect(f.second.submit(source, secondPacket)).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    f.repository.startNewRelayEpoch(now());
    await f.second.sourceSeen(source, requestId);
    await f.second.submit(source, secondPacket);
    expect((await f.read())!.expiresAt).toBe(expiry);
    await finish(f.second, secondPacket);
  });
  it("new epoch recovery never reopens an already delivered packet", async () => {
    const f = await fixture();
    await f.first.submit(source, firstPacket);
    await f.first.receive(recipient, requestId);
    const before = await f.read();
    f.repository.startNewRelayEpoch(now());
    expect(await f.read()).toEqual(before);
    await expect(f.second.submit(source, secondPacket)).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    await finish(f.first);
  });
});
