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
  | "TRANSFER_PACKET_TOO_LARGE"
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
  accountId: string;
  sourceDeviceId: string;
  expiresAt: number;
  envelopeBytes: number;
};

type RelayReservation = {
  accountId: string;
  sourceDeviceId: string;
  expiresAt: number;
  envelopeBytes: number;
  reservationId: number;
};

export interface EphemeralTransferRelayOptions {
  maxPackets: number;
  maxPacketsPerAccount: number;
  maxEnvelopeBytes: number;
  maxEnvelopeBytesPerAccount: number;
}

const DEFAULT_RELAY_LIMITS: EphemeralTransferRelayOptions = {
  maxPackets: 64,
  maxPacketsPerAccount: 8,
  maxEnvelopeBytes: 8 * 1024 * 1024,
  maxEnvelopeBytesPerAccount: 1024 * 1024,
};

const MAX_PACKET_ENVELOPE_BYTES = 131072;

/** Process-memory-only relay. It deliberately has no serialization, queue, cache, or logging hook. */
export class EphemeralTransferRelay {
  private readonly packets = new Map<string, RelayPacket>();
  private readonly reservations = new Map<string, RelayReservation>();
  private readonly limits: EphemeralTransferRelayOptions;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextReservationId = 1;
  private clockOffsetMs = 0;

  public constructor(options: Partial<EphemeralTransferRelayOptions> = {}) {
    this.limits = { ...DEFAULT_RELAY_LIMITS, ...options };
  }

  reserve(
    packet: TransferPacketV1,
    accountId: string,
    sourceDeviceId: string,
    expiresAt: Date,
    now = new Date(),
  ): number {
    const envelopeBytes = new TextEncoder().encode(packet.envelope).byteLength;
    if (envelopeBytes > MAX_PACKET_ENVELOPE_BYTES)
      throw new TransferError("TRANSFER_PACKET_TOO_LARGE");
    this.prune(now);

    const existing = this.packets.get(packet.requestId);
    if (
      this.reservations.has(packet.requestId) ||
      (existing &&
        (existing.accountId !== accountId ||
          existing.sourceDeviceId !== sourceDeviceId))
    )
      throw new TransferError("TRANSFER_CONFLICT");

    const usage = this.usage(accountId, packet.requestId);
    if (
      usage.totalPackets + 1 > this.limits.maxPackets ||
      usage.accountPackets + 1 > this.limits.maxPacketsPerAccount ||
      usage.totalBytes + envelopeBytes > this.limits.maxEnvelopeBytes ||
      usage.accountBytes + envelopeBytes >
        this.limits.maxEnvelopeBytesPerAccount
    )
      throw new TransferError("TRANSFER_CONFLICT");

    const reservationId = this.nextReservationId++;
    this.reservations.set(packet.requestId, {
      accountId,
      sourceDeviceId,
      expiresAt: expiresAt.getTime(),
      envelopeBytes,
      reservationId,
    });
    this.scheduleExpiry(now);
    return reservationId;
  }

  activate(
    requestId: string,
    reservationId: number,
    packet: TransferPacketV1,
    now = new Date(),
  ): boolean {
    const reservation = this.reservations.get(requestId);
    if (!reservation || reservation.reservationId !== reservationId)
      return false;
    if (reservation.expiresAt <= now.getTime()) {
      this.reservations.delete(requestId);
      this.scheduleExpiry(now);
      return false;
    }
    this.reservations.delete(requestId);
    this.packets.set(requestId, {
      ...packet,
      accountId: reservation.accountId,
      sourceDeviceId: reservation.sourceDeviceId,
      expiresAt: reservation.expiresAt,
      envelopeBytes: reservation.envelopeBytes,
    });
    this.scheduleExpiry(now);
    return true;
  }

  release(requestId: string, reservationId: number, now = new Date()): void {
    const reservation = this.reservations.get(requestId);
    if (reservation?.reservationId === reservationId) {
      this.reservations.delete(requestId);
      this.scheduleExpiry(now);
    }
  }

  get(requestId: string, now: Date): RelayPacket | undefined {
    this.prune(now);
    if (this.reservations.has(requestId)) return undefined;
    const packet = this.packets.get(requestId);
    return packet ? { ...packet } : undefined;
  }

  delete(requestId: string, now = new Date()): void {
    const removedPacket = this.packets.delete(requestId);
    const removedReservation = this.reservations.delete(requestId);
    if (removedPacket || removedReservation) this.scheduleExpiry(now);
  }

  clear(): void {
    this.packets.clear();
    this.reservations.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  prune(now: Date): number {
    let removed = 0;
    for (const [requestId, packet] of this.packets) {
      if (packet.expiresAt <= now.getTime()) {
        this.packets.delete(requestId);
        removed += 1;
      }
    }
    for (const [requestId, reservation] of this.reservations) {
      if (reservation.expiresAt <= now.getTime()) {
        this.reservations.delete(requestId);
        removed += 1;
      }
    }
    if (removed) this.scheduleExpiry(now);
    return removed;
  }

  /** Test hook exposes counters and limits only, never packet contents. */
  statsForTests(accountId?: string) {
    const usage = this.usage(accountId);
    const reservations = [...this.reservations.values()].filter(
      (reservation) => !accountId || reservation.accountId === accountId,
    );
    return {
      packets: accountId ? usage.accountPackets : usage.totalPackets,
      envelopeBytes: accountId ? usage.accountBytes : usage.totalBytes,
      reserved: reservations.length,
    };
  }

  private usage(accountId?: string, replacingRequestId?: string) {
    let totalPackets = 0;
    let accountPackets = 0;
    let totalBytes = 0;
    let accountBytes = 0;

    for (const [requestId, packet] of this.packets) {
      if (requestId === replacingRequestId || this.reservations.has(requestId))
        continue;
      totalPackets += 1;
      totalBytes += packet.envelopeBytes;
      if (!accountId || packet.accountId === accountId) {
        accountPackets += 1;
        accountBytes += packet.envelopeBytes;
      }
    }
    for (const reservation of this.reservations.values()) {
      totalPackets += 1;
      totalBytes += reservation.envelopeBytes;
      if (!accountId || reservation.accountId === accountId) {
        accountPackets += 1;
        accountBytes += reservation.envelopeBytes;
      }
    }
    return { totalPackets, accountPackets, totalBytes, accountBytes };
  }

  private scheduleExpiry(now = new Date()): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    let earliest = Number.POSITIVE_INFINITY;
    for (const packet of this.packets.values())
      earliest = Math.min(earliest, packet.expiresAt);
    for (const reservation of this.reservations.values())
      earliest = Math.min(earliest, reservation.expiresAt);
    if (!Number.isFinite(earliest)) return;
    this.clockOffsetMs = Date.now() - now.getTime();
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.prune(new Date(Date.now() - this.clockOffsetMs));
      },
      Math.max(0, earliest - now.getTime()),
    );
    this.timer.unref?.();
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
    if (
      typeof input === "object" &&
      input !== null &&
      "envelope" in input &&
      typeof input.envelope === "string" &&
      new TextEncoder().encode(input.envelope).byteLength >
        MAX_PACKET_ENVELOPE_BYTES
    )
      throw new TransferError("TRANSFER_PACKET_TOO_LARGE");
    const packet = TransferSubmitPacketV1Schema.parse(input);
    const now = this.now();
    const current = await this.repository.read({
      principal,
      requestId: packet.requestId,
      now,
    });
    if (!current) throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
    if (current.sourceDeviceId !== principal.deviceId)
      throw new TransferError("TRANSFER_ACCOUNT_MISMATCH");
    const parsedPacket = TransferPacketV1Schema.parse(packet);
    const reservationId = this.relay.reserve(
      parsedPacket,
      current.accountId,
      principal.deviceId,
      new Date(current.expiresAt),
      now,
    );
    try {
      await this.repository.markPacketAvailable({
        principal,
        requestId: packet.requestId,
        now: this.now(),
      });
    } catch (error) {
      this.relay.release(packet.requestId, reservationId, this.now());
      throw error;
    }
    if (
      !this.relay.activate(
        packet.requestId,
        reservationId,
        parsedPacket,
        this.now(),
      )
    )
      throw new TransferError("TRANSFER_EXPIRED");
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
      packet.accountId !== request.accountId ||
      (packet.sourceDeviceId !== request.sourceDeviceId &&
        request.sourceDeviceId)
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
    this.relay.delete(ack.requestId, this.now());
    return result;
  }

  public async cancel(principal: ExtensionPrincipal, requestId: string) {
    const result = await this.repository.cancel({
      principal,
      requestId,
      now: this.now(),
    });
    this.relay.delete(requestId, this.now());
    return result;
  }

  public expireDue() {
    const now = this.now();
    this.relay.prune(now);
    return this.repository.expireDue(now);
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
