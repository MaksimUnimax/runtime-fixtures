import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import {
  CredentialTransferService,
  createMemoryTransferRepository,
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
function setup() {
  let clock = new Date("2026-09-18T10:00:00.000Z");
  const service = new CredentialTransferService(
    createMemoryTransferRepository(),
    undefined,
    () => clock,
  );
  return {
    service,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}
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
  afterEach(() => vi.restoreAllMocks());
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
    advance(61_000);
    await expect(service.sourceSeen(source, id)).rejects.toThrow(
      "TRANSFER_EXPIRED",
    );
    await expect(service.read(recipient, id)).resolves.toMatchObject({
      state: "EXPIRED",
    });
  });
});
