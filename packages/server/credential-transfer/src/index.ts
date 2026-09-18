import {
  TransferAckV1Schema,
  TransferCreateRequestV1Schema,
  TransferPacketV1Schema,
  TransferSubmitPacketV1Schema,
  type TransferAckV1,
  type TransferCreateRequestV1,
  type TransferPacketV1,
  type TransferRequestV1,
} from "@product/contracts";
import type { ExtensionPrincipal } from "@product/extension-auth";

export type TransferFailure =
  | "TRANSFER_INVALID"
  | "TRANSFER_EXPIRED"
  | "TRANSFER_REPLAY"
  | "TRANSFER_CONFLICT"
  | "TRANSFER_DEVICE_REVOKED"
  | "TRANSFER_ACCOUNT_MISMATCH"
  | "SOURCE_OFFLINE";

export class TransferError extends Error {
  public constructor(public readonly code: TransferFailure) {
    super(code);
  }
}

export interface TransferRepository {
  create(input: {
    principal: ExtensionPrincipal;
    request: TransferCreateRequestV1;
    now: Date;
  }): Promise<TransferRequestV1>;
  read(input: {
    principal: ExtensionPrincipal;
    requestId: string;
    now: Date;
  }): Promise<TransferRequestV1 | undefined>;
  listForSource(input: {
    principal: ExtensionPrincipal;
    now: Date;
  }): Promise<TransferRequestV1[]>;
  markSourceSeen(input: {
    principal: ExtensionPrincipal;
    requestId: string;
    now: Date;
  }): Promise<TransferRequestV1>;
  markPacketAvailable(input: {
    principal: ExtensionPrincipal;
    requestId: string;
    now: Date;
  }): Promise<TransferRequestV1>;
  markDelivered(input: {
    principal: ExtensionPrincipal;
    requestId: string;
    now: Date;
  }): Promise<TransferRequestV1>;
  acknowledge(input: {
    principal: ExtensionPrincipal;
    ack: TransferAckV1;
    now: Date;
  }): Promise<TransferRequestV1>;
  cancel(input: {
    principal: ExtensionPrincipal;
    requestId: string;
    now: Date;
  }): Promise<TransferRequestV1>;
  expireDue(now: Date): Promise<number>;
}

type RelayPacket = TransferPacketV1 & {
  sourceDeviceId: string;
  expiresAt: number;
};

/** Process-memory-only relay. It deliberately has no serialization, queue, cache, or logging hook. */
export class EphemeralTransferRelay {
  private readonly packets = new Map<string, RelayPacket>();

  put(packet: TransferPacketV1, sourceDeviceId: string, expiresAt: Date): void {
    this.packets.set(packet.requestId, {
      ...packet,
      sourceDeviceId,
      expiresAt: expiresAt.getTime(),
    });
  }

  get(requestId: string, now: Date): RelayPacket | undefined {
    const packet = this.packets.get(requestId);
    if (!packet) return undefined;
    if (packet.expiresAt <= now.getTime()) {
      this.packets.delete(requestId);
      return undefined;
    }
    return { ...packet };
  }

  delete(requestId: string): void {
    this.packets.delete(requestId);
  }

  clear(): void {
    this.packets.clear();
  }

  /** Test/operations hook exposes only packet presence, never bytes. */
  has(requestId: string, now = new Date()): boolean {
    return this.get(requestId, now) !== undefined;
  }
}

export class CredentialTransferService {
  public constructor(
    private readonly repository: TransferRepository,
    private readonly relay = new EphemeralTransferRelay(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async create(
    principal: ExtensionPrincipal,
    input: unknown,
  ): Promise<TransferRequestV1> {
    const request = TransferCreateRequestV1Schema.parse(input);
    if (request.recipientDeviceId !== principal.deviceId)
      throw new TransferError("TRANSFER_DEVICE_REVOKED");
    return this.repository.create({ principal, request, now: this.now() });
  }

  public read(principal: ExtensionPrincipal, requestId: string) {
    return this.repository.read({ principal, requestId, now: this.now() });
  }

  public listForSource(principal: ExtensionPrincipal) {
    return this.repository.listForSource({ principal, now: this.now() });
  }

  public async sourceSeen(principal: ExtensionPrincipal, requestId: string) {
    return this.repository.markSourceSeen({
      principal,
      requestId,
      now: this.now(),
    });
  }

  public async submit(principal: ExtensionPrincipal, input: unknown) {
    const packet = TransferSubmitPacketV1Schema.parse(input);
    const request = await this.repository.markPacketAvailable({
      principal,
      requestId: packet.requestId,
      now: this.now(),
    });
    this.relay.put(
      TransferPacketV1Schema.parse(packet),
      principal.deviceId,
      new Date(request.expiresAt),
    );
    return {
      request: await this.repository.read({
        principal,
        requestId: packet.requestId,
        now: this.now(),
      }),
    };
  }

  public async receive(principal: ExtensionPrincipal, requestId: string) {
    const request = await this.repository.read({
      principal,
      requestId,
      now: this.now(),
    });
    if (!request) throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
    const packet = this.relay.get(requestId, this.now());
    if (!packet) throw new TransferError("SOURCE_OFFLINE");
    if (
      packet.sourceDeviceId !== request.sourceDeviceId &&
      request.sourceDeviceId
    )
      throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
    await this.repository.markDelivered({
      principal,
      requestId,
      now: this.now(),
    });
    return TransferPacketV1Schema.parse({
      requestId: packet.requestId,
      packetId: packet.packetId,
      envelope: packet.envelope,
    });
  }

  public async acknowledge(principal: ExtensionPrincipal, input: unknown) {
    const ack = TransferAckV1Schema.parse(input);
    const packet = this.relay.get(ack.requestId, this.now());
    if (!packet || packet.packetId !== ack.packetId)
      throw new TransferError("TRANSFER_REPLAY");
    const result = await this.repository.acknowledge({
      principal,
      ack,
      now: this.now(),
    });
    this.relay.delete(ack.requestId);
    return result;
  }

  public async cancel(principal: ExtensionPrincipal, requestId: string) {
    const result = await this.repository.cancel({
      principal,
      requestId,
      now: this.now(),
    });
    this.relay.delete(requestId);
    return result;
  }

  public expireDue() {
    return this.repository.expireDue(this.now());
  }

  public relayForTests() {
    return this.relay;
  }
}

export function validTransition(
  from: TransferRequestV1["state"],
  to: TransferRequestV1["state"],
): boolean {
  return (
    (from === "REQUESTED" && to === "SOURCE_SEEN") ||
    (from === "SOURCE_SEEN" && to === "PACKET_AVAILABLE_EPHEMERAL") ||
    (from === "PACKET_AVAILABLE_EPHEMERAL" &&
      to === "DELIVERED_TO_RECIPIENT") ||
    (from === "DELIVERED_TO_RECIPIENT" && to === "COMPLETED") ||
    (from === "REQUESTED" && to === "EXPIRED") ||
    (from === "SOURCE_SEEN" && to === "EXPIRED") ||
    (from === "PACKET_AVAILABLE_EPHEMERAL" && to === "EXPIRED") ||
    (from === "DELIVERED_TO_RECIPIENT" && to === "EXPIRED") ||
    (from === "REQUESTED" && to === "CANCELLED") ||
    (from === "SOURCE_SEEN" && to === "CANCELLED")
  );
}

/** Deterministic test/OpenAPI repository; production uses the PostgreSQL implementation. */
export function createMemoryTransferRepository(): TransferRepository {
  const rows = new Map<string, TransferRequestV1>();
  const clone = (row: TransferRequestV1): TransferRequestV1 =>
    structuredClone(row);
  const find = (principal: ExtensionPrincipal, id: string, now: Date) => {
    const row = rows.get(id);
    if (
      !row ||
      row.accountId !== principal.accountId ||
      (row.recipientDeviceId !== principal.deviceId &&
        row.sourceDeviceId !== principal.deviceId &&
        row.sourceDeviceId !== null)
    )
      return undefined;
    if (
      new Date(row.expiresAt) <= now &&
      !["COMPLETED", "CANCELLED", "EXPIRED"].includes(row.state)
    )
      row.state = "EXPIRED";
    return row;
  };
  const transition = (
    row: TransferRequestV1,
    states: TransferRequestV1["state"][],
    state: TransferRequestV1["state"],
  ) => {
    if (row.state === "EXPIRED") throw new TransferError("TRANSFER_EXPIRED");
    if (["COMPLETED", "CANCELLED"].includes(row.state))
      throw new TransferError("TRANSFER_REPLAY");
    if (!states.includes(row.state))
      throw new TransferError("TRANSFER_CONFLICT");
    row.state = state;
    row.revision += 1;
  };
  return {
    async create({ principal, request, now }) {
      if (request.recipientDeviceId !== principal.deviceId)
        throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
      const current = rows.get(request.requestId);
      if (current) {
        if (
          current.accountId !== principal.accountId ||
          current.recipientPublicKeySpki !== request.recipientPublicKeySpki ||
          current.sourceDeviceId !== request.sourceDeviceId ||
          JSON.stringify(current.selectedStores) !==
            JSON.stringify(request.selectedStores)
        )
          throw new TransferError("TRANSFER_CONFLICT");
        return clone(current);
      }
      const row: TransferRequestV1 = {
        requestId: request.requestId,
        accountId: principal.accountId,
        recipientDeviceId: principal.deviceId,
        sourceDeviceId: request.sourceDeviceId,
        recipientPublicKeySpki: request.recipientPublicKeySpki,
        createdAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + request.expiresInSeconds * 1000,
        ).toISOString(),
        state: "REQUESTED",
        selectedStores: structuredClone(request.selectedStores),
        revision: 1,
      };
      rows.set(row.requestId, row);
      return clone(row);
    },
    async read({ principal, requestId, now }) {
      const row = find(principal, requestId, now);
      return row ? clone(row) : undefined;
    },
    async listForSource({ principal, now }) {
      return [...rows.values()]
        .filter(
          (row) =>
            row.accountId === principal.accountId &&
            row.recipientDeviceId !== principal.deviceId &&
            (!row.sourceDeviceId ||
              row.sourceDeviceId === principal.deviceId) &&
            new Date(row.expiresAt) > now &&
            !["COMPLETED", "CANCELLED", "EXPIRED"].includes(row.state),
        )
        .map(clone);
    },
    async markSourceSeen({ principal, requestId, now }) {
      const row = find(principal, requestId, now);
      if (!row) throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
      if (row.sourceDeviceId && row.sourceDeviceId !== principal.deviceId)
        throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
      if (!row.sourceDeviceId) row.sourceDeviceId = principal.deviceId;
      transition(
        row,
        [
          "REQUESTED",
          "SOURCE_SEEN",
          "PACKET_AVAILABLE_EPHEMERAL",
          "DELIVERED_TO_RECIPIENT",
        ],
        "SOURCE_SEEN",
      );
      return clone(row);
    },
    async markPacketAvailable({ principal, requestId, now }) {
      const row = find(principal, requestId, now);
      if (!row) throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
      if (row.sourceDeviceId !== principal.deviceId)
        throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
      transition(
        row,
        ["SOURCE_SEEN", "PACKET_AVAILABLE_EPHEMERAL", "DELIVERED_TO_RECIPIENT"],
        "PACKET_AVAILABLE_EPHEMERAL",
      );
      return clone(row);
    },
    async markDelivered({ principal, requestId, now }) {
      const row = find(principal, requestId, now);
      if (!row || row.recipientDeviceId !== principal.deviceId)
        throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
      transition(
        row,
        ["PACKET_AVAILABLE_EPHEMERAL", "DELIVERED_TO_RECIPIENT"],
        "DELIVERED_TO_RECIPIENT",
      );
      return clone(row);
    },
    async acknowledge({ principal, ack, now }) {
      const row = find(principal, ack.requestId, now);
      if (!row || row.recipientDeviceId !== principal.deviceId)
        throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
      transition(row, ["DELIVERED_TO_RECIPIENT"], "COMPLETED");
      return clone(row);
    },
    async cancel({ principal, requestId, now }) {
      const row = find(principal, requestId, now);
      if (!row || row.recipientDeviceId !== principal.deviceId)
        throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
      transition(row, ["REQUESTED", "SOURCE_SEEN"], "CANCELLED");
      return clone(row);
    },
    async expireDue(now) {
      let count = 0;
      for (const row of rows.values())
        if (
          new Date(row.expiresAt) <= now &&
          !["COMPLETED", "CANCELLED", "EXPIRED"].includes(row.state)
        ) {
          row.state = "EXPIRED";
          row.revision += 1;
          count += 1;
        }
      return count;
    },
  };
}
