import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
  createMemoryTransferRepository,
  type TransferRepository,
} from "./index.js";

const uuid = (n: number) =>
  `81000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = { accountId: uuid(1), deviceId: uuid(2), sessionId: uuid(3) };
const recipient = { accountId: uuid(1), deviceId: uuid(4), sessionId: uuid(5) };
const requestId = uuid(6);
const firstPacket = { requestId, packetId: uuid(7), envelope: "SYNTHETIC_P1" };
const secondPacket = { requestId, packetId: uuid(8), envelope: "SYNTHETIC_P2" };
const now = () => new Date("2026-10-28T00:00:00.000Z");
const services: CredentialTransferService[] = [];
afterEach(() => services.splice(0).forEach((service) => service.stop()));

function service(repository: TransferRepository) {
  const result = new CredentialTransferService(
    repository,
    new EphemeralTransferRelay(),
    now,
  );
  services.push(result);
  return result;
}
async function prepare(first: CredentialTransferService) {
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
  await first.submit(source, firstPacket);
}
function retry(
  second: CredentialTransferService,
  method: "sourceSeen" | "submit",
) {
  return method === "sourceSeen"
    ? second.sourceSeen(source, requestId)
    : second.submit(source, secondPacket);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function finishOriginal(first: CredentialTransferService) {
  await expect(first.receive(recipient, requestId)).resolves.toEqual(
    firstPacket,
  );
  await expect(
    first.acknowledge(recipient, {
      requestId,
      packetId: firstPacket.packetId,
      importDecision: "IMPORTED",
    }),
  ).resolves.toMatchObject({ state: "COMPLETED" });
}

describe("durable delivered state across independent relay instances", () => {
  it.each(["sourceSeen", "submit"] as const)(
    "rejects %s from an empty second relay without stranding P1 ACK",
    async (method) => {
      const repository = createMemoryTransferRepository();
      const first = service(repository),
        second = service(repository);
      await prepare(first);
      await first.receive(recipient, requestId);
      const before = await repository.read({
        principal: recipient,
        requestId,
        now: now(),
      });
      await expect(retry(second, method)).rejects.toMatchObject({
        code: "TRANSFER_CONFLICT",
      });
      expect(
        await repository.read({ principal: recipient, requestId, now: now() }),
      ).toEqual(before);
      expect(second.relayForTests().statsForTests()).toMatchObject({
        packets: 0,
        reserved: 0,
        envelopeBytes: 0,
      });
      await finishOriginal(first);
    },
  );

  it.each(["sourceSeen", "submit"] as const)(
    "checks the durable state after %s's stale read, at the mutation boundary",
    async (method) => {
      const repository = createMemoryTransferRepository();
      const entered = deferred(),
        release = deferred();
      const methodName =
        method === "sourceSeen" ? "markSourceSeen" : "markPacketAvailable";
      const delayed: TransferRepository = {
        ...repository,
        [methodName]: async (
          input: Parameters<TransferRepository[typeof methodName]>[0],
        ) => {
          entered.resolve();
          await release.promise;
          return repository[methodName](input);
        },
      };
      const first = service(repository),
        second = service(delayed);
      await prepare(first);
      const pending = retry(second, method);
      try {
        await entered.promise;
        await first.receive(recipient, requestId);
        const before = await repository.read({
          principal: recipient,
          requestId,
          now: now(),
        });
        release.resolve();
        await expect(pending).rejects.toMatchObject({
          code: "TRANSFER_CONFLICT",
        });
        expect(
          await repository.read({
            principal: recipient,
            requestId,
            now: now(),
          }),
        ).toEqual(before);
        expect(second.relayForTests().statsForTests()).toMatchObject({
          packets: 0,
          reserved: 0,
        });
        await finishOriginal(first);
      } finally {
        release.resolve();
        await pending.catch(() => undefined);
      }
    },
  );

  it.each(["sourceSeen", "submit"] as const)(
    "preserves %s retry after relay loss before delivery",
    async (method) => {
      const repository = createMemoryTransferRepository();
      const first = service(repository),
        second = service(repository);
      await prepare(first);
      first.stop();
      if (method === "sourceSeen") await second.sourceSeen(source, requestId);
      await second.submit(source, secondPacket);
      await expect(second.receive(recipient, requestId)).resolves.toEqual(
        secondPacket,
      );
      await expect(
        second.acknowledge(recipient, {
          requestId,
          packetId: secondPacket.packetId,
          importDecision: "IMPORTED",
        }),
      ).resolves.toMatchObject({ state: "COMPLETED" });
    },
  );
});
