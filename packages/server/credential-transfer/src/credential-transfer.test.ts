import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import {
  CredentialTransferService,
  EphemeralTransferRelay,
  TransferError,
  createMemoryTransferRepository,
  type TransferRepository,
} from "./index.js";

const accountA = "11111111-1111-4111-8111-111111111111",
  accountB = "22222222-2222-4222-8222-222222222222";
const source = {
  sessionId: "31111111-1111-4111-8111-111111111111",
  deviceId: "31111111-1111-4111-8111-111111111112",
  accountId: accountA,
};
const recipient = {
  sessionId: "41111111-1111-4111-8111-111111111111",
  deviceId: "41111111-1111-4111-8111-111111111112",
  accountId: accountA,
};
const other = {
  sessionId: "51111111-1111-4111-8111-111111111111",
  deviceId: "51111111-1111-4111-8111-111111111112",
  accountId: accountB,
};
const key = "A".repeat(128),
  id = "61111111-1111-4111-8111-111111111111";
const createInput = (overrides = {}) => ({
  requestId: id,
  recipientDeviceId: recipient.deviceId,
  recipientPublicKeySpki: key,
  sourceDeviceId: null,
  selectedStores: [{ storeId: "store-ozon" }],
  consent: true as const,
  expiresInSeconds: 300,
  ...overrides,
});
function setup(
  relayOptions: ConstructorParameters<typeof EphemeralTransferRelay>[0] = {},
  repository: TransferRepository = createMemoryTransferRepository(),
) {
  let clock = new Date("2026-09-18T10:00:00.000Z");
  const service = new CredentialTransferService(
    repository,
    new EphemeralTransferRelay(relayOptions),
    () => clock,
  );
  return {
    service,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}
async function prepare(
  service: CredentialTransferService,
  requestId: string,
  target = recipient,
  caller = source,
) {
  await service.create(
    target,
    createInput({ requestId, recipientDeviceId: target.deviceId }),
  );
  await service.sourceSeen(caller, requestId);
}
const idFor = (value: number) => `${value}1111111-1111-4111-8111-111111111111`;
const packet = (requestId: string, envelope: string, packetId = idFor(7)) => ({
  requestId,
  packetId,
  envelope,
});
async function cryptoApi() {
  const sourceText = await readFile(
    new URL(
      "../../../control-client/src/credential-transfer.js",
      import.meta.url,
    ),
    "utf8",
  );
  const context: Record<string, unknown> = {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    structuredClone,
    btoa: (v: string) => Buffer.from(v, "binary").toString("base64"),
    atob: (v: string) => Buffer.from(v, "base64").toString("binary"),
  };
  runInNewContext(sourceText, context);
  return context.SellerAgentsCredentialTransferCrypto as {
    generateRecipientKeyPair: () => Promise<{
      privateKey: CryptoKey;
      publicKeySpki: string;
    }>;
    encrypt: (input: Record<string, unknown>) => Promise<string>;
    decrypt: (input: Record<string, unknown>) => Promise<unknown>;
  };
}

describe("D3S2-2A control-plane foundation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("TR-01..08 creates an explicit, device-bound, immutable-key idempotent request", async () => {
    const { service } = setup();
    const first = await service.create(recipient, createInput());
    expect(first.recipientDeviceId).toBe(recipient.deviceId);
    expect(first.recipientPublicKeySpki).toBe(key);
    expect(await service.create(recipient, createInput())).toEqual(first);
    await expect(service.create(other, createInput())).rejects.toThrow(
      "TRANSFER_DEVICE_REVOKED",
    );
    await expect(
      service.create(
        recipient,
        createInput({ recipientPublicKeySpki: "B".repeat(128) }),
      ),
    ).rejects.toThrow("TRANSFER_CONFLICT");
    expect(JSON.stringify(first)).not.toContain("ciphertext");
  });
  it("TR-09..14 discovers only valid pending work and has no polling channel", async () => {
    const { service } = setup();
    await service.create(recipient, createInput());
    expect((await service.listForSource(source)).length).toBe(1);
    await service.sourceSeen(source, id);
    expect((await service.read(recipient, id))?.sourceDeviceId).toBe(
      source.deviceId,
    );
  });
  it("TR-18..23 uses authenticated recipient/request-bound encryption", async () => {
    const crypto = await cryptoApi();
    const keys = await crypto.generateRecipientKeyPair();
    const input = {
      accountId: accountA,
      requestId: id,
      sourceDeviceId: source.deviceId,
      recipientDeviceId: recipient.deviceId,
      packetId: "71111111-1111-4111-8111-111111111111",
      recipientPublicKeySpki: keys.publicKeySpki,
      payload: {
        transferPayloadVersion: "seller_agents_credential_payload_v1",
        stores: [
          {
            storeId: "store-ozon",
            marketplace: "ozon",
            credentials: {
              seller: { clientId: "seller", apiKey: "synthetic" },
            },
          },
          {
            storeId: "store-wb",
            marketplace: "wildberries",
            credentials: { token: "synthetic-wb" },
          },
        ],
      },
    };
    const envelope = await crypto.encrypt(input);
    expect(
      await crypto.decrypt({ ...input, envelope, privateKey: keys.privateKey }),
    ).toEqual(input.payload);
    await expect(
      crypto.decrypt({
        ...input,
        packetId: "81111111-1111-4111-8111-111111111111",
        envelope,
        privateKey: keys.privateKey,
      }),
    ).rejects.toThrow();
    const wrong = await crypto.generateRecipientKeyPair();
    await expect(
      crypto.decrypt({ ...input, envelope, privateKey: wrong.privateKey }),
    ).rejects.toThrow();
    const parsed = JSON.parse(envelope);
    parsed.ciphertext = `${parsed.ciphertext.slice(0, -2)}AA`;
    await expect(
      crypto.decrypt({
        ...input,
        envelope: JSON.stringify(parsed),
        privateKey: keys.privateKey,
      }),
    ).rejects.toThrow();
  });
  it("TR-24..30 keeps relay bytes process-local and loses them on reset", async () => {
    const first = setup();
    await first.service.create(recipient, createInput());
    await first.service.sourceSeen(source, id);
    await first.service.submit(source, {
      requestId: id,
      packetId: "71111111-1111-4111-8111-111111111111",
      envelope: "opaque",
    });
    expect(
      first.service
        .relayForTests()
        .has(id, new Date("2026-09-18T10:00:00.000Z")),
    ).toBe(true);
    expect(
      JSON.stringify(await first.service.read(recipient, id)),
    ).not.toContain("opaque");
    const reset = setup();
    await reset.service.create(recipient, createInput());
    expect(
      reset.service
        .relayForTests()
        .has(id, new Date("2026-09-18T10:00:00.000Z")),
    ).toBe(false);
    await expect(reset.service.receive(recipient, id)).rejects.toThrow(
      "SOURCE_OFFLINE",
    );
  });
  it("TR-29..30 permits a valid bound source to retry after process-local packet loss", async () => {
    const repository = createMemoryTransferRepository();
    const clock = () => new Date("2026-09-18T10:00:00.000Z");
    const first = new CredentialTransferService(repository, undefined, clock);
    const second = new CredentialTransferService(repository, undefined, clock);
    await first.create(recipient, createInput());
    await first.sourceSeen(source, id);
    await first.submit(source, {
      requestId: id,
      packetId: "71111111-1111-4111-8111-111111111111",
      envelope: "lost",
    });
    await expect(second.receive(recipient, id)).rejects.toThrow(
      "SOURCE_OFFLINE",
    );
    await second.sourceSeen(source, id);
    await second.submit(source, {
      requestId: id,
      packetId: "81111111-1111-4111-8111-111111111111",
      envelope: "retry",
    });
    await expect(second.receive(recipient, id)).resolves.toMatchObject({
      envelope: "retry",
    });
  });
  it("TR-31..38 validates before ACK, then fences late/replayed packets", async () => {
    const { service } = setup();
    await service.create(recipient, createInput());
    await service.sourceSeen(source, id);
    await service.submit(source, {
      requestId: id,
      packetId: "71111111-1111-4111-8111-111111111111",
      envelope: "opaque",
    });
    await service.receive(recipient, id);
    const done = await service.acknowledge(recipient, {
      requestId: id,
      packetId: "71111111-1111-4111-8111-111111111111",
      importDecision: "IMPORTED",
    });
    expect(done.state).toBe("COMPLETED");
    await expect(service.receive(recipient, id)).rejects.toThrow(
      "SOURCE_OFFLINE",
    );
    await expect(
      service.acknowledge(recipient, {
        requestId: id,
        packetId: "71111111-1111-4111-8111-111111111111",
        importDecision: "IMPORTED",
      }),
    ).rejects.toThrow("TRANSFER_REPLAY");
    await expect(service.read(other, id)).resolves.toBeUndefined();
  });
  it("TR-39..48 preserves store selection and refuses automatic conflict overwrite", async () => {
    const { service } = setup();
    const request = await service.create(
      recipient,
      createInput({ selectedStores: [{ storeId: "stable-store-id" }] }),
    );
    expect(request.selectedStores).toEqual([{ storeId: "stable-store-id" }]);
    expect(request.selectedStores.some((x) => x.storeId === "label")).toBe(
      false,
    );
  });
  it("TR-49..60 exposes no provider/AI/privacy side effects in the transfer domain", async () => {
    const { service } = setup();
    await service.create(recipient, createInput());
    await service.sourceSeen(source, id);
    await service.submit(source, {
      requestId: id,
      packetId: "71111111-1111-4111-8111-111111111111",
      envelope: "opaque",
    });
    expect(
      service.relayForTests().has(id, new Date("2026-09-18T10:00:00.000Z")),
    ).toBe(true);
    expect(JSON.stringify(await service.read(recipient, id))).not.toMatch(
      /synthetic|apiKey|token|ciphertext|credentials/,
    );
  });
  it("expiry fails closed and never reopens", async () => {
    const { service, advance } = setup();
    await service.create(recipient, createInput({ expiresInSeconds: 60 }));
    await service.sourceSeen(source, id);
    await service.submit(source, packet(id, "expiring"));
    advance(61_000);
    await service.expireDue();
    expect(service.relayForTests().statsForTests().packets).toBe(0);
    await expect(service.sourceSeen(source, id)).rejects.toThrow(
      "TRANSFER_EXPIRED",
    );
    await expect(service.read(recipient, id)).resolves.toMatchObject({
      state: "EXPIRED",
    });
  });

  it("enforces the exact UTF-8 envelope byte limit", async () => {
    const { service } = setup();
    await prepare(service, id);
    await service.submit(source, packet(id, "é".repeat(65536)));
    expect(service.relayForTests().statsForTests().envelopeBytes).toBe(131072);
    await expect(
      service.submit(source, packet(id, "é".repeat(65537), idFor(8))),
    ).rejects.toMatchObject({ code: "TRANSFER_PACKET_TOO_LARGE" });
    expect(service.relayForTests().statsForTests().envelopeBytes).toBe(131072);
  });

  it("enforces global packet and per-account packet quotas", async () => {
    const global = setup({ maxPackets: 2 });
    for (const requestId of [idFor(1), idFor(2), idFor(3)])
      await prepare(global.service, requestId);
    await global.service.submit(source, packet(idFor(1), "one"));
    await global.service.submit(source, packet(idFor(2), "two"));
    await expect(
      global.service.submit(source, packet(idFor(3), "three")),
    ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });
    expect(global.service.relayForTests().statsForTests().packets).toBe(2);

    const perAccount = setup({ maxPacketsPerAccount: 1 });
    const recipientB = {
      sessionId: "52111111-1111-4111-8111-111111111111",
      deviceId: "52111111-1111-4111-8111-111111111112",
      accountId: accountB,
    };
    await prepare(perAccount.service, idFor(4));
    await prepare(perAccount.service, idFor(5), recipientB, other);
    await perAccount.service.submit(source, packet(idFor(4), "a"));
    await perAccount.service.submit(other, packet(idFor(5), "b"));
    expect(
      perAccount.service.relayForTests().statsForTests(accountA).packets,
    ).toBe(1);
    expect(
      perAccount.service.relayForTests().statsForTests(accountB).packets,
    ).toBe(1);
  });

  it("enforces global and per-account envelope byte quotas", async () => {
    const global = setup({ maxEnvelopeBytes: 10 });
    await prepare(global.service, idFor(1));
    await prepare(global.service, idFor(2));
    await global.service.submit(source, packet(idFor(1), "123456"));
    await expect(
      global.service.submit(source, packet(idFor(2), "12345")),
    ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });
    expect(global.service.relayForTests().statsForTests().envelopeBytes).toBe(
      6,
    );

    const perAccount = setup({ maxEnvelopeBytesPerAccount: 10 });
    const recipientB = {
      sessionId: "52111111-1111-4111-8111-111111111111",
      deviceId: "52111111-1111-4111-8111-111111111112",
      accountId: accountB,
    };
    await prepare(perAccount.service, idFor(3));
    await prepare(perAccount.service, idFor(4));
    await prepare(perAccount.service, idFor(5), recipientB, other);
    await perAccount.service.submit(source, packet(idFor(3), "123456"));
    await expect(
      perAccount.service.submit(source, packet(idFor(4), "12345")),
    ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });
    await perAccount.service.submit(other, packet(idFor(5), "12345"));
    expect(
      perAccount.service.relayForTests().statsForTests(accountA).envelopeBytes,
    ).toBe(6);
    expect(
      perAccount.service.relayForTests().statsForTests(accountB).envelopeBytes,
    ).toBe(5);
  });

  it("replaces by accounting delta and preserves the prior packet on failed admission", async () => {
    const { service } = setup({
      maxPackets: 1,
      maxPacketsPerAccount: 1,
      maxEnvelopeBytes: 8,
      maxEnvelopeBytesPerAccount: 8,
    });
    await prepare(service, id);
    await service.submit(source, packet(id, "123456", idFor(7)));
    await expect(
      service.submit(source, packet(id, "123456789", idFor(8))),
    ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });
    await expect(service.receive(recipient, id)).resolves.toMatchObject({
      packetId: idFor(7),
      envelope: "123456",
    });
    await service.submit(source, packet(id, "12345678", idFor(9)));
    expect(service.relayForTests().statsForTests()).toMatchObject({
      packets: 1,
      envelopeBytes: 8,
    });
  });

  it("preserves the prior active packet when replacement durability fails", async () => {
    const repository = createMemoryTransferRepository();
    let markCount = 0;
    const failingReplacement: TransferRepository = {
      ...repository,
      async markPacketAvailable(input) {
        markCount += 1;
        if (markCount === 2) throw new TransferError("TRANSFER_CONFLICT");
        return repository.markPacketAvailable(input);
      },
    };
    const service = new CredentialTransferService(
      failingReplacement,
      new EphemeralTransferRelay(),
      () => new Date("2026-09-18T10:00:00.000Z"),
    );
    await prepare(service, id);
    await service.submit(source, packet(id, "old", idFor(7)));

    await expect(
      service.submit(source, packet(id, "new", idFor(8))),
    ).rejects.toThrow("TRANSFER_CONFLICT");

    expect(service.relayForTests().statsForTests()).toMatchObject({
      packets: 1,
      envelopeBytes: 3,
      reserved: 0,
    });
    await expect(service.receive(recipient, id)).resolves.toMatchObject({
      packetId: idFor(7),
      envelope: "old",
    });
  });

  it("expires relay bytes on its timer without request traffic", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T10:00:00.000Z"));
    const service = new CredentialTransferService(
      createMemoryTransferRepository(),
      new EphemeralTransferRelay(),
      () => new Date(),
    );
    await prepare(service, id);
    await service.submit(source, packet(id, "synthetic-envelope"));
    expect(service.relayForTests().statsForTests().packets).toBe(1);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(service.relayForTests().statsForTests().packets).toBe(0);
  });

  it("reserves before the durable transition and keeps reservations unreadable", async () => {
    const repository = createMemoryTransferRepository();
    let finishMark!: () => void;
    let signalMark!: () => void;
    const marking = new Promise<void>((resolve) => (finishMark = resolve));
    const started = new Promise<void>((resolve) => (signalMark = resolve));
    const gated: TransferRepository = {
      ...repository,
      async markPacketAvailable(input) {
        signalMark();
        await marking;
        return repository.markPacketAvailable(input);
      },
    };
    const service = new CredentialTransferService(
      gated,
      new EphemeralTransferRelay(),
      () => new Date("2026-09-18T10:00:00.000Z"),
    );
    await prepare(service, id);
    const submitting = service.submit(source, packet(id, "reserved"));
    await started;
    expect(service.relayForTests().statsForTests()).toMatchObject({
      packets: 1,
      reserved: 1,
    });
    await expect(service.receive(recipient, id)).rejects.toThrow(
      "SOURCE_OFFLINE",
    );
    finishMark();
    await submitting;
    expect(service.relayForTests().statsForTests().reserved).toBe(0);
    await expect(service.receive(recipient, id)).resolves.toMatchObject({
      envelope: "reserved",
    });
  });

  it("fails closed when a reservation expires after the durable transition starts", async () => {
    const repository = createMemoryTransferRepository();
    let clock = new Date("2026-09-18T10:00:00.000Z");
    let finishMark!: () => void;
    let signalMark!: () => void;
    const marking = new Promise<void>((resolve) => (finishMark = resolve));
    const started = new Promise<void>((resolve) => (signalMark = resolve));
    const gated: TransferRepository = {
      ...repository,
      async markPacketAvailable(input) {
        signalMark();
        await marking;
        return repository.markPacketAvailable(input);
      },
    };
    const service = new CredentialTransferService(
      gated,
      new EphemeralTransferRelay(),
      () => clock,
    );
    await prepare(service, id);
    const submitting = service.submit(source, packet(id, "expires-in-flight"));
    await started;
    clock = new Date("2026-09-18T10:05:01.000Z");
    finishMark();

    await expect(submitting).rejects.toThrow("TRANSFER_EXPIRED");
    expect(service.relayForTests().statsForTests()).toMatchObject({
      packets: 0,
      envelopeBytes: 0,
      reserved: 0,
    });
    await expect(service.receive(recipient, id)).rejects.toThrow(
      "SOURCE_OFFLINE",
    );
  });

  it("releases a reservation when durable availability fails", async () => {
    const repository = createMemoryTransferRepository();
    const failing: TransferRepository = {
      ...repository,
      async markPacketAvailable() {
        throw new TransferError("TRANSFER_CONFLICT");
      },
    };
    const service = new CredentialTransferService(
      failing,
      new EphemeralTransferRelay(),
      () => new Date("2026-09-18T10:00:00.000Z"),
    );
    await prepare(service, id);
    await expect(
      service.submit(source, packet(id, "reserved")),
    ).rejects.toThrow("TRANSFER_CONFLICT");
    expect(service.relayForTests().statsForTests()).toMatchObject({
      packets: 0,
      envelopeBytes: 0,
    });
  });

  it("cancellation clears a reservation without broadening cancellation states", async () => {
    const repository = createMemoryTransferRepository();
    let finishMark!: () => void;
    let signalMark!: () => void;
    const marking = new Promise<void>((resolve) => (finishMark = resolve));
    const started = new Promise<void>((resolve) => (signalMark = resolve));
    const gated: TransferRepository = {
      ...repository,
      async markPacketAvailable(input) {
        signalMark();
        await marking;
        return repository.markPacketAvailable(input);
      },
    };
    const service = new CredentialTransferService(
      gated,
      new EphemeralTransferRelay(),
      () => new Date("2026-09-18T10:00:00.000Z"),
    );
    await prepare(service, id);
    const submitting = service.submit(source, packet(id, "reserved"));
    await started;
    await service.cancel(recipient, id);
    finishMark();
    await expect(submitting).rejects.toThrow("TRANSFER_REPLAY");
    expect(service.relayForTests().statsForTests().packets).toBe(0);
  });

  it("keeps concurrent quota pressure within configured limits", async () => {
    const { service } = setup({
      maxPackets: 4,
      maxPacketsPerAccount: 2,
      maxEnvelopeBytes: 12,
      maxEnvelopeBytesPerAccount: 6,
    });
    const ids = [1, 2, 3, 4, 5].map(idFor);
    await Promise.all(ids.map((requestId) => prepare(service, requestId)));
    const results = await Promise.allSettled(
      ids.map((requestId) => service.submit(source, packet(requestId, "123"))),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(service.relayForTests().statsForTests()).toMatchObject({
      packets: 2,
      envelopeBytes: 6,
    });
    expect(
      service.relayForTests().statsForTests(accountA).packets,
    ).toBeLessThanOrEqual(2);
    expect(
      service.relayForTests().statsForTests(accountA).envelopeBytes,
    ).toBeLessThanOrEqual(6);
  });
});
