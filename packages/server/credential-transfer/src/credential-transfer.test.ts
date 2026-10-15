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
    // Verify the failed admission preserved the old packet without marking
    // it delivered. Once delivered, packet identity is pinned through ACK.
    expect(
      service.relayForTests().get(id, new Date("2026-09-18T10:00:00.000Z")),
    ).toMatchObject({ packetId: idFor(7), envelope: "123456" });
    await service.submit(source, packet(id, "12345678", idFor(9)));
    expect(service.relayForTests().statsForTests()).toMatchObject({
      packets: 1,
      envelopeBytes: 8,
    });
    await expect(service.receive(recipient, id)).resolves.toMatchObject({
      packetId: idFor(9),
      envelope: "12345678",
    });
  });

  for (const quota of ["global", "per-account"] as const) {
    it(`retains the old byte charge through a failed smaller replacement (${quota})`, async () => {
      const backing = createMemoryTransferRepository();
      let marked = 0;
      let markStarted: () => void = () => {};
      let unblockMark: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const release = new Promise<void>((resolve) => {
        unblockMark = resolve;
      });
      const repository: TransferRepository = {
        ...backing,
        async markPacketAvailable(input) {
          if (input.requestId === idFor(1) && ++marked === 2) {
            markStarted();
            await release;
            throw new TransferError("TRANSFER_CONFLICT");
          }
          return backing.markPacketAvailable(input);
        },
      };
      const relay = new EphemeralTransferRelay(
        quota === "global"
          ? { maxEnvelopeBytes: 8 }
          : { maxEnvelopeBytesPerAccount: 8 },
      );
      const at = new Date("2026-09-18T10:00:00.000Z");
      const service = new CredentialTransferService(
        repository,
        relay,
        () => at,
      );
      const first = idFor(1);
      const second = idFor(2);
      await prepare(service, first);
      await prepare(service, second);
      await service.submit(source, packet(first, "123456", idFor(7)));
      await expect(
        service.submit(source, packet(second, "1234567", idFor(8))),
      ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });

      const replacing = service.submit(source, packet(first, "x", idFor(9)));
      await started;
      const during = relay.statsForTests(accountA);
      let competitorOutcome: "REJECTED" | "ACCEPTED";
      try {
        competitorOutcome = await service
          .submit(source, packet(second, "1234567", idFor(8)))
          .then(
            () => "ACCEPTED" as const,
            (error: unknown) => {
              if (
                error instanceof TransferError &&
                error.code === "TRANSFER_CONFLICT"
              )
                return "REJECTED" as const;
              throw error;
            },
          );
      } finally {
        unblockMark();
      }
      await expect(replacing).rejects.toMatchObject({
        code: "TRANSFER_CONFLICT",
      });
      expect(during).toMatchObject({
        packets: 1,
        envelopeBytes: 6,
        reserved: 1,
      });
      expect(competitorOutcome).toBe("REJECTED");
      expect(relay.statsForTests(accountA)).toMatchObject({
        packets: 1,
        envelopeBytes: 6,
        reserved: 0,
      });
      expect(relay.get(first, at)).toMatchObject({
        packetId: idFor(7),
        envelope: "123456",
      });
      expect(relay.get(second, at)).toBeUndefined();
      relay.clear();
    });
  }

  it("rejects direct activation that exceeds the reserved UTF-8 byte charge", () => {
    const relay = new EphemeralTransferRelay({
      maxEnvelopeBytes: 8,
      maxEnvelopeBytesPerAccount: 8,
    });
    const now = new Date("2026-09-18T10:00:00.000Z");
    const expiry = new Date(+now + 300000);
    const prepared = packet(idFor(1), "x", idFor(7));
    const reservationId = relay.reserve(
      prepared,
      accountA,
      source.deviceId,
      expiry,
      now,
    );
    expect(
      relay.activate(
        prepared.requestId,
        reservationId,
        {
          ...prepared,
          envelope: "123456789",
        },
        now,
      ),
    ).toBe(false);
    expect(relay.statsForTests(accountA)).toMatchObject({
      packets: 1,
      envelopeBytes: 1,
      reserved: 1,
    });
    expect(relay.get(prepared.requestId, now)).toBeUndefined();
    relay.release(prepared.requestId, reservationId, now);
    expect(relay.statsForTests()).toMatchObject({
      packets: 0,
      envelopeBytes: 0,
      reserved: 0,
    });
    relay.clear();
  });

  it("rejects direct activation that changes request or packet identity", () => {
    const relay = new EphemeralTransferRelay({ maxEnvelopeBytes: 8 });
    const now = new Date("2026-09-18T10:00:00.000Z");
    const expiry = new Date(+now + 300000);
    const prepared = packet(idFor(1), "x", idFor(7));
    const reservationId = relay.reserve(
      prepared,
      accountA,
      source.deviceId,
      expiry,
      now,
    );
    expect(
      relay.activate(
        prepared.requestId,
        reservationId,
        {
          ...prepared,
          requestId: idFor(2),
        },
        now,
      ),
    ).toBe(false);
    expect(
      relay.activate(
        prepared.requestId,
        reservationId,
        {
          ...prepared,
          packetId: idFor(8),
        },
        now,
      ),
    ).toBe(false);
    expect(relay.statsForTests()).toMatchObject({
      packets: 1,
      envelopeBytes: 1,
      reserved: 1,
    });
    expect(relay.get(prepared.requestId, now)).toBeUndefined();
    relay.release(prepared.requestId, reservationId, now);
    relay.clear();
  });

  it("rejects same-size ciphertext substitution after reservation and preserves quota/identity", () => {
    const relay = new EphemeralTransferRelay({ maxEnvelopeBytes: 8 });
    const now = new Date("2026-09-18T10:00:00.000Z");
    const expiry = new Date(+now + 300000);
    const prepared = packet(idFor(1), "good", idFor(7));
    const reservationId = relay.reserve(
      prepared,
      accountA,
      source.deviceId,
      expiry,
      now,
    );
    // Old code only compared UTF-8 byte length, so same-size different bytes
    // silently became the delivered packet despite a different reserve().
    expect(
      relay.activate(
        prepared.requestId,
        reservationId,
        { ...prepared, envelope: "evil" },
        now,
      ),
    ).toBe(false);
    expect(relay.get(prepared.requestId, now)).toBeUndefined();
    expect(relay.statsForTests(accountA)).toMatchObject({
      packets: 1,
      envelopeBytes: 4,
      reserved: 1,
    });
    expect(
      relay.activate(prepared.requestId, reservationId, prepared, now),
    ).toBe(true);
    expect(relay.get(prepared.requestId, now)).toMatchObject(prepared);
    expect(relay.statsForTests(accountA)).toMatchObject({
      packets: 1,
      envelopeBytes: 4,
      reserved: 0,
    });
    relay.clear();
  });

  it("keeps a prior active packet after a same-byte-length replacement is rejected", () => {
    const relay = new EphemeralTransferRelay({ maxEnvelopeBytes: 4 });
    const now = new Date("2026-09-18T10:00:00.000Z");
    const expiry = new Date(+now + 300000);
    const oldPacket = packet(idFor(1), "old", idFor(7));
    const originalId = relay.reserve(
      oldPacket,
      accountA,
      source.deviceId,
      expiry,
      now,
    );
    expect(
      relay.activate(oldPacket.requestId, originalId, oldPacket, now),
    ).toBe(true);

    const replacement = packet(oldPacket.requestId, "я", idFor(8));
    const replacementId = relay.reserve(
      replacement,
      accountA,
      source.deviceId,
      expiry,
      now,
    );
    // Both replacement strings are two UTF-8 bytes, but the ciphertext differs.
    expect(
      relay.activate(
        oldPacket.requestId,
        replacementId,
        { ...replacement, envelope: "é" },
        now,
      ),
    ).toBe(false);
    expect(relay.statsForTests(accountA)).toMatchObject({
      packets: 1,
      envelopeBytes: 3,
      reserved: 1,
    });
    expect(relay.get(oldPacket.requestId, now)).toBeUndefined();
    relay.release(oldPacket.requestId, replacementId, now);
    expect(relay.get(oldPacket.requestId, now)).toMatchObject(oldPacket);
    expect(relay.statsForTests(accountA)).toMatchObject({
      packets: 1,
      envelopeBytes: 3,
      reserved: 0,
    });
    relay.clear();
  });

  it("takes one immutable snapshot of a getter-backed packet at reservation", () => {
    const relay = new EphemeralTransferRelay({ maxEnvelopeBytes: 8 });
    const now = new Date("2026-09-18T10:00:00.000Z");
    const expiry = new Date(+now + 300000);
    const expected = packet(idFor(1), "good", idFor(7));
    const getterPacket = { ...expected };
    let envelopeReads = 0;
    Object.defineProperty(getterPacket, "envelope", {
      enumerable: true,
      get() {
        envelopeReads += 1;
        return envelopeReads === 1 ? "good" : "evil";
      },
    });
    const reservationId = relay.reserve(
      getterPacket,
      accountA,
      source.deviceId,
      expiry,
      now,
    );
    expect(envelopeReads).toBe(1);
    expect(
      relay.activate(expected.requestId, reservationId, expected, now),
    ).toBe(true);
    expect(relay.get(expected.requestId, now)).toMatchObject(expected);
    relay.clear();
  });

  it("stores only the verified request, packet and envelope snapshots from activation", () => {
    const relay = new EphemeralTransferRelay({ maxEnvelopeBytes: 8 });
    const now = new Date("2026-09-18T10:00:00.000Z");
    const expiry = new Date(+now + 300000);
    const expected = packet(idFor(1), "good", idFor(7));
    const reservationId = relay.reserve(
      expected,
      accountA,
      source.deviceId,
      expiry,
      now,
    );
    const getterPacket = { ...expected };
    let requestReads = 0,
      packetReads = 0,
      envelopeReads = 0;
    Object.defineProperties(getterPacket, {
      requestId: {
        enumerable: true,
        get() {
          requestReads += 1;
          return requestReads === 1 ? expected.requestId : idFor(2);
        },
      },
      packetId: {
        enumerable: true,
        get() {
          packetReads += 1;
          return packetReads === 1 ? expected.packetId : idFor(8);
        },
      },
      envelope: {
        enumerable: true,
        get() {
          envelopeReads += 1;
          return envelopeReads <= 2 ? "good" : "evil";
        },
      },
    });
    expect(
      relay.activate(expected.requestId, reservationId, getterPacket, now),
    ).toBe(true);
    expect(relay.get(expected.requestId, now)).toMatchObject(expected);
    expect([requestReads, packetReads, envelopeReads]).toEqual([1, 1, 1]);
    relay.clear();
  });

  it("activates exactly reserved multibyte contents and accounts actual bytes", () => {
    const relay = new EphemeralTransferRelay({ maxEnvelopeBytes: 2 });
    const now = new Date("2026-09-18T10:00:00.000Z");
    const expiry = new Date(+now + 300000);
    const prepared = packet(idFor(1), "я", idFor(7));
    const reservationId = relay.reserve(
      prepared,
      accountA,
      source.deviceId,
      expiry,
      now,
    );
    expect(
      relay.activate(prepared.requestId, reservationId, prepared, now),
    ).toBe(true);
    expect(relay.statsForTests()).toMatchObject({
      packets: 1,
      envelopeBytes: 2,
      reserved: 0,
    });
    expect(relay.get(prepared.requestId, now)).toMatchObject(prepared);
    relay.clear();
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

  it("pins the delivered packet through ACK while source replacement races", async () => {
    const repository = createMemoryTransferRepository();
    let startMark!: () => void;
    let finishMark!: () => void;
    const markStarted = new Promise<void>((resolve) => (startMark = resolve));
    const markGate = new Promise<void>((resolve) => (finishMark = resolve));
    const gated: TransferRepository = {
      ...repository,
      async markDelivered(input) {
        startMark();
        await markGate;
        return repository.markDelivered(input);
      },
    };
    const service = new CredentialTransferService(
      gated,
      new EphemeralTransferRelay(),
      () => new Date("2026-09-18T10:00:00.000Z"),
    );
    await prepare(service, id);
    await service.submit(source, packet(id, "original", idFor(7)));
    const receiving = service.receive(recipient, id);
    await markStarted;
    let replacementOutcome = "ACCEPTED";
    try {
      await service.submit(source, packet(id, "replaced", idFor(8)));
    } catch (error) {
      replacementOutcome = (error as TransferError).code;
    }
    // A blocked request must not serialize unrelated transfer IDs.
    await prepare(service, idFor(3));
    await service.submit(source, packet(idFor(3), "unrelated"));
    finishMark();
    const delivered = await receiving;
    expect(replacementOutcome).toBe("TRANSFER_CONFLICT");
    expect(delivered).toMatchObject({
      packetId: idFor(7),
      envelope: "original",
    });
    await expect(service.sourceSeen(source, id)).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    await expect(service.sourceSeen(other, id)).rejects.toMatchObject({
      code: "TRANSFER_ACCOUNT_MISMATCH",
    });
    await expect(
      service.acknowledge(other, {
        requestId: id,
        packetId: idFor(7),
        importDecision: "IMPORTED",
      }),
    ).rejects.toMatchObject({ code: "TRANSFER_ACCOUNT_MISMATCH" });
    await expect(service.receive(recipient, id)).resolves.toMatchObject({
      packetId: idFor(7),
      envelope: "original",
    });
    expect(
      await service.acknowledge(recipient, {
        requestId: id,
        packetId: idFor(7),
        importDecision: "IMPORTED",
      }),
    ).toMatchObject({ state: "COMPLETED" });
    await expect(service.receive(recipient, id)).rejects.toMatchObject({
      code: "SOURCE_OFFLINE",
    });
    await expect(service.receive(recipient, idFor(3))).resolves.toMatchObject({
      envelope: "unrelated",
    });
  });

  it("unlocks a failed delivery attempt so the source can safely replace its packet", async () => {
    const repository = createMemoryTransferRepository();
    let rejectOnce = true;
    const failingDelivery: TransferRepository = {
      ...repository,
      async markDelivered(input) {
        if (rejectOnce) {
          rejectOnce = false;
          throw new TransferError("TRANSFER_CONFLICT");
        }
        return repository.markDelivered(input);
      },
    };
    const service = new CredentialTransferService(
      failingDelivery,
      new EphemeralTransferRelay(),
      () => new Date("2026-09-18T10:00:00.000Z"),
    );
    await prepare(service, id);
    await service.submit(source, packet(id, "original", idFor(7)));
    await expect(service.receive(recipient, id)).rejects.toMatchObject({
      code: "TRANSFER_CONFLICT",
    });
    await service.submit(source, packet(id, "recovered", idFor(8)));
    await expect(service.receive(recipient, id)).resolves.toMatchObject({
      packetId: idFor(8),
      envelope: "recovered",
    });
    expect(
      await service.acknowledge(recipient, {
        requestId: id,
        packetId: idFor(8),
        importDecision: "IMPORTED",
      }),
    ).toMatchObject({ state: "COMPLETED" });
  });

  it("allows resubmission after process loss of a delivered but unacknowledged packet", async () => {
    const repository = createMemoryTransferRepository();
    const now = () => new Date("2026-09-18T10:00:00.000Z");
    const first = new CredentialTransferService(
      repository,
      new EphemeralTransferRelay(),
      now,
    );
    await prepare(first, id);
    await first.submit(source, packet(id, "original", idFor(7)));
    await expect(first.receive(recipient, id)).resolves.toMatchObject({
      packetId: idFor(7),
    });
    const restarted = new CredentialTransferService(
      repository,
      new EphemeralTransferRelay(),
      now,
    );
    await expect(restarted.receive(recipient, id)).rejects.toMatchObject({
      code: "SOURCE_OFFLINE",
    });
    await restarted.sourceSeen(source, id);
    await restarted.submit(source, packet(id, "recovered", idFor(8)));
    await expect(restarted.receive(recipient, id)).resolves.toMatchObject({
      packetId: idFor(8),
      envelope: "recovered",
    });
    expect(
      await restarted.acknowledge(recipient, {
        requestId: id,
        packetId: idFor(8),
        importDecision: "IMPORTED",
      }),
    ).toMatchObject({ state: "COMPLETED" });
  });

  it("expires a delivered but unacknowledged packet without retaining relay memory", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T10:00:00.000Z"));
    const service = new CredentialTransferService(
      createMemoryTransferRepository(),
      new EphemeralTransferRelay(),
      () => new Date(),
    );
    await prepare(service, id);
    await service.submit(source, packet(id, "delivered", idFor(7)));
    await expect(service.receive(recipient, id)).resolves.toMatchObject({
      packetId: idFor(7),
    });
    expect(service.relayForTests().statsForTests().packets).toBe(1);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(service.relayForTests().statsForTests()).toMatchObject({
      packets: 0,
      envelopeBytes: 0,
      reserved: 0,
    });
    await expect(
      service.acknowledge(recipient, {
        requestId: id,
        packetId: idFor(7),
        importDecision: "IMPORTED",
      }),
    ).rejects.toMatchObject({ code: "TRANSFER_REPLAY" });
    await expect(service.sourceSeen(source, id)).rejects.toMatchObject({
      code: "TRANSFER_EXPIRED",
    });
  });

  it.each([
    { name: "invalid Date", now: new Date(Number.NaN) },
    {
      name: "unbranded Date proxy",
      now: new Proxy(new Date("2026-09-18T10:00:00.000Z"), {}),
    },
  ])("rejects $name in activate before mutating reserved packet", ({ now }) => {
    vi.useFakeTimers();
    const at = new Date("2026-09-18T10:00:00.000Z");
    vi.setSystemTime(at);
    const spy = vi.spyOn(globalThis, "setTimeout");
    const relay = new EphemeralTransferRelay();
    const prepared = packet(idFor(1), "clock-activation");
    try {
      const reservation = relay.reserve(
        prepared,
        accountA,
        source.deviceId,
        new Date(at.getTime() + 60_000),
        at,
      );
      const beforeTimers = spy.mock.calls.length;
      expect(() =>
        relay.activate(prepared.requestId, reservation, prepared, now),
      ).toThrowError("TRANSFER_INVALID");
      expect(spy).toHaveBeenCalledTimes(beforeTimers);
      expect(relay.statsForTests()).toMatchObject({ packets: 1, reserved: 1 });
      expect(relay.get(prepared.requestId, at)).toBeUndefined();
      expect(
        relay.activate(prepared.requestId, reservation, prepared, at),
      ).toBe(true);
      expect(relay.get(prepared.requestId, at)).toMatchObject(prepared);
    } finally {
      relay.clear();
    }
  });

  it("rejects invalid release time while preserving a reservation", () => {
    vi.useFakeTimers();
    const at = new Date("2026-09-18T10:00:00.000Z");
    vi.setSystemTime(at);
    const relay = new EphemeralTransferRelay();
    const prepared = packet(idFor(2), "clock-release");
    try {
      const reservation = relay.reserve(
        prepared,
        accountA,
        source.deviceId,
        new Date(at.getTime() + 60_000),
        at,
      );
      expect(() =>
        relay.release(prepared.requestId, reservation, new Date(Number.NaN)),
      ).toThrowError("TRANSFER_INVALID");
      expect(relay.statsForTests().reserved).toBe(1);
      relay.release(prepared.requestId, reservation, at);
      expect(relay.statsForTests().reserved).toBe(0);
    } finally {
      relay.clear();
    }
  });

  it("rejects invalid delete time without destroying an active packet", () => {
    vi.useFakeTimers();
    const at = new Date("2026-09-18T10:00:00.000Z");
    vi.setSystemTime(at);
    const relay = new EphemeralTransferRelay();
    const prepared = packet(idFor(3), "clock-delete");
    try {
      const reservation = relay.reserve(
        prepared,
        accountA,
        source.deviceId,
        new Date(at.getTime() + 60_000),
        at,
      );
      expect(
        relay.activate(prepared.requestId, reservation, prepared, at),
      ).toBe(true);
      const invalid = new Proxy(at, {});
      expect(() => relay.delete(prepared.requestId, invalid)).toThrowError(
        "TRANSFER_INVALID",
      );
      expect(relay.has(prepared.requestId, at)).toBe(true);
      relay.delete(prepared.requestId, at);
      expect(relay.has(prepared.requestId, at)).toBe(false);
    } finally {
      relay.clear();
    }
  });

  it.each([
    {
      name: "get",
      call: (relay: EphemeralTransferRelay, requestId: string, bad: Date) =>
        relay.get(requestId, bad),
    },
    {
      name: "has",
      call: (relay: EphemeralTransferRelay, requestId: string, bad: Date) =>
        relay.has(requestId, bad),
    },
    {
      name: "isDelivered",
      call: (relay: EphemeralTransferRelay, requestId: string, bad: Date) =>
        relay.isDelivered(requestId, bad),
    },
    {
      name: "pinDelivered",
      call: (relay: EphemeralTransferRelay, requestId: string, bad: Date) =>
        relay.pinDelivered(requestId, idFor(7), bad),
    },
    {
      name: "prune",
      call: (relay: EphemeralTransferRelay, _requestId: string, bad: Date) =>
        relay.prune(bad),
    },
  ])(
    "rejects invalid $name clock without changing live packet state",
    ({ call }) => {
      vi.useFakeTimers();
      const at = new Date("2026-09-18T10:00:00.000Z");
      vi.setSystemTime(at);
      const relay = new EphemeralTransferRelay();
      const prepared = packet(idFor(4), "clock-read", idFor(7));
      try {
        const reservation = relay.reserve(
          prepared,
          accountA,
          source.deviceId,
          new Date(at.getTime() + 60_000),
          at,
        );
        expect(
          relay.activate(prepared.requestId, reservation, prepared, at),
        ).toBe(true);
        expect(() =>
          call(relay, prepared.requestId, new Date(Number.NaN)),
        ).toThrowError("TRANSFER_INVALID");
        expect(relay.statsForTests()).toMatchObject({
          packets: 1,
          reserved: 0,
        });
        expect(relay.isDelivered(prepared.requestId, at)).toBe(false);
        expect(relay.has(prepared.requestId, at)).toBe(true);
      } finally {
        relay.clear();
      }
    },
  );

  it.each([
    {
      name: "invalid expiry date",
      expiresAt: new Date(Number.NaN),
      now: new Date("2026-09-18T10:00:00.000Z"),
      code: "TRANSFER_INVALID",
    },
    {
      name: "invalid current clock",
      expiresAt: new Date("2026-09-18T10:01:00.000Z"),
      now: new Date(Number.NaN),
      code: "TRANSFER_INVALID",
    },
    {
      name: "already-expired reservation",
      expiresAt: new Date("2026-09-18T10:00:00.000Z"),
      now: new Date("2026-09-18T10:00:00.000Z"),
      code: "TRANSFER_EXPIRED",
    },
    {
      name: "unbranded Date proxy",
      expiresAt: new Proxy(new Date("2026-09-18T10:01:00.000Z"), {}),
      now: new Date("2026-09-18T10:00:00.000Z"),
      code: "TRANSFER_INVALID",
    },
  ])("rejects non-finite relay timestamps or expired TTL ($name)", (case_) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T10:00:00.000Z"));
    const relay = new EphemeralTransferRelay();
    try {
      expect(() =>
        relay.reserve(
          packet(id, "synthetic"),
          accountA,
          source.deviceId,
          case_.expiresAt,
          case_.now,
        ),
      ).toThrowError(case_.code);
      expect(relay.statsForTests()).toMatchObject({
        packets: 0,
        reserved: 0,
        envelopeBytes: 0,
      });
    } finally {
      relay.clear();
    }
  });

  it("bounds long native relay timeout delays and keeps the TTL scheduled", async () => {
    vi.useFakeTimers();
    const at = new Date("2026-09-18T10:00:00.000Z");
    vi.setSystemTime(at);
    const expiry = new Date(at.getTime() + 0x7fffffff + 60_000);
    const timer = vi.spyOn(globalThis, "setTimeout");
    const relay = new EphemeralTransferRelay();
    try {
      const reservation = relay.reserve(
        packet(id, "synthetic"),
        accountA,
        source.deviceId,
        expiry,
        at,
      );
      expect(reservation).toBeGreaterThan(0);
      expect(timer).toHaveBeenCalledWith(expect.any(Function), 0x7fffffff);
      expect(relay.statsForTests().reserved).toBe(1);
      await vi.advanceTimersByTimeAsync(0x7fffffff);
      expect(relay.statsForTests().reserved).toBe(1);
      await vi.advanceTimersByTimeAsync(60_001);
      expect(relay.statsForTests().reserved).toBe(0);
    } finally {
      relay.clear();
    }
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

  it("does not roll back a committed packet when sourceSeen races the in-flight submit", async () => {
    const repository = createMemoryTransferRepository();
    let releaseMark!: () => void;
    let announceMark!: () => void;
    const gate = new Promise<void>((resolve) => (releaseMark = resolve));
    const committed = new Promise<void>((resolve) => (announceMark = resolve));
    const gated: TransferRepository = {
      ...repository,
      async markPacketAvailable(input) {
        const committedRow = await repository.markPacketAvailable(input);
        announceMark();
        await gate;
        return committedRow;
      },
    };
    const service = new CredentialTransferService(
      gated,
      new EphemeralTransferRelay(),
      () => new Date("2026-09-18T10:00:00.000Z"),
    );
    await prepare(service, id);
    const submitting = service.submit(source, packet(id, "first-packet"));
    await committed;
    let sourceRetryError: unknown = null;
    try {
      await service.sourceSeen(source, id);
    } catch (error) {
      sourceRetryError = error;
    } finally {
      releaseMark();
    }
    const sent = await submitting;
    expect(sourceRetryError).toMatchObject({ code: "TRANSFER_CONFLICT" });
    expect(sent.request).toMatchObject({ state: "PACKET_AVAILABLE_EPHEMERAL" });
    await expect(service.receive(recipient, id)).resolves.toMatchObject({
      envelope: "first-packet",
    });
  });

  it("fences submit while sourceSeen is committing without blocking a different request", async () => {
    const repository = createMemoryTransferRepository();
    let delayNextSourceSeen = false;
    let enterSourceSeen!: () => void;
    let releaseSourceSeen!: () => void;
    const seen = new Promise<void>((resolve) => (enterSourceSeen = resolve));
    const gate = new Promise<void>((resolve) => (releaseSourceSeen = resolve));
    const gated: TransferRepository = {
      ...repository,
      async markSourceSeen(input) {
        if (delayNextSourceSeen) {
          enterSourceSeen();
          await gate;
        }
        return repository.markSourceSeen(input);
      },
    };
    const service = new CredentialTransferService(
      gated,
      new EphemeralTransferRelay(),
      () => new Date("2026-09-18T10:00:00.000Z"),
    );
    const independent = idFor(3);
    await prepare(service, id);
    await prepare(service, independent);
    delayNextSourceSeen = true;
    const retryingSource = service.sourceSeen(source, id);
    await seen;
    try {
      await expect(
        service.submit(source, packet(id, "must-not-overlap")),
      ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });
      await service.submit(source, packet(independent, "other-request"));
      await expect(
        service.receive(recipient, independent),
      ).resolves.toMatchObject({
        envelope: "other-request",
      });
    } finally {
      releaseSourceSeen();
    }
    await retryingSource;
    await service.submit(source, packet(id, "after-source-seen"));
    await expect(service.receive(recipient, id)).resolves.toMatchObject({
      envelope: "after-source-seen",
    });
  });

  it("keeps a prepared packet available on a sequential sourceSeen retry", async () => {
    const { service } = setup();
    await prepare(service, id);
    await service.submit(source, packet(id, "available-packet"));
    const retried = await service.sourceSeen(source, id);
    expect(retried.state).toBe("PACKET_AVAILABLE_EPHEMERAL");
    expect((await service.read(recipient, id))?.state).toBe(
      "PACKET_AVAILABLE_EPHEMERAL",
    );
    await expect(service.receive(recipient, id)).resolves.toMatchObject({
      envelope: "available-packet",
    });
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
    // A source is actively committing this request: fail as a concurrent
    // mutation, not as a misleading durable SOURCE_OFFLINE result.
    await expect(service.receive(recipient, id)).rejects.toThrow(
      "TRANSFER_CONFLICT",
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

describe("unassigned source participant visibility", () => {
  it("keeps ordinary reads private while allowing the same-account source to accept", async () => {
    const { service } = setup();
    await service.create(recipient, createInput());
    expect(await service.read(source, id)).toBeUndefined();
    expect(await service.read(other, id)).toBeUndefined();
    expect((await service.read(recipient, id))?.state).toBe("REQUESTED");
    expect(
      (await service.listForSource(source)).map((row) => row.requestId),
    ).toContain(id);
    expect((await service.sourceSeen(source, id)).sourceDeviceId).toBe(
      source.deviceId,
    );
    expect((await service.read(source, id))?.state).toBe("SOURCE_SEEN");
  });
});

describe("source eligibility rejects the recipient", () => {
  it("rejects recipient self-assignment before any state change in memory", async () => {
    const repository = createMemoryTransferRepository();
    const { service } = setup({}, repository);
    const before = await service.create(recipient, createInput());
    await expect(service.sourceSeen(recipient, id)).rejects.toMatchObject({
      code: "TRANSFER_ACCOUNT_MISMATCH",
    });
    await expect(
      repository.markSourceSeen({
        principal: recipient,
        requestId: id,
        now: new Date("2026-09-18T10:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "TRANSFER_ACCOUNT_MISMATCH" });
    expect(await service.read(recipient, id)).toEqual(before);
    expect((await service.sourceSeen(source, id)).sourceDeviceId).toBe(
      source.deviceId,
    );
  });
});
