import type { TransferRequestV1 } from "@product/contracts";
import {
  TransferError,
  type TransferRepository,
} from "@product/credential-transfer";
import type { ExtensionPrincipal } from "@product/extension-auth";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

type Row = {
  request_id: string;
  account_id: string;
  recipient_device_id: string;
  source_device_id: string | null;
  recipient_public_key_spki: string;
  selected_store_ids: string[];
  state: TransferRequestV1["state"];
  revision: number;
  created_at: Date | string;
  expires_at: Date | string;
};

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}
function map(row: Row): TransferRequestV1 {
  return {
    requestId: row.request_id,
    accountId: row.account_id,
    recipientDeviceId: row.recipient_device_id,
    sourceDeviceId: row.source_device_id,
    recipientPublicKeySpki: row.recipient_public_key_spki,
    selectedStores: row.selected_store_ids.map((storeId) => ({ storeId })),
    state: row.state,
    revision: Number(row.revision),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
}
function fail(code: TransferError["code"]): never {
  throw new TransferError(code);
}
async function load(
  tx: DatabaseQuery,
  requestId: string,
  now: Date,
  lock = false,
): Promise<Row | undefined> {
  const result = await tx.query<Row>(
    `SELECT request_id,account_id,recipient_device_id,source_device_id,recipient_public_key_spki,selected_store_ids,state,revision,created_at,expires_at FROM credential_transfer_requests WHERE request_id=$1${lock ? " FOR UPDATE" : ""}`,
    [requestId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  if (
    new Date(row.expires_at).getTime() <= now.getTime() &&
    !["EXPIRED", "COMPLETED", "CANCELLED"].includes(row.state)
  ) {
    await tx.query(
      `UPDATE credential_transfer_requests SET state='EXPIRED',revision=revision+1 WHERE request_id=$1 AND state NOT IN ('COMPLETED','CANCELLED','EXPIRED')`,
      [requestId],
    );
    return { ...row, state: "EXPIRED" };
  }
  return row;
}
function assertPrincipal(
  row: Row,
  principal: ExtensionPrincipal,
  role: "recipient" | "source",
): void {
  if (row.account_id !== principal.accountId) fail("TRANSFER_ACCOUNT_MISMATCH");
  if (role === "recipient" && row.recipient_device_id !== principal.deviceId)
    fail("TRANSFER_ACCOUNT_MISMATCH");
  if (
    role === "source" &&
    row.source_device_id &&
    row.source_device_id !== principal.deviceId
  )
    fail("TRANSFER_ACCOUNT_MISMATCH");
}
function assertActiveDevice(row: { status: string } | undefined): void {
  if (!row || row.status !== "ACTIVE") fail("TRANSFER_DEVICE_REVOKED");
}
async function activeDevice(
  tx: DatabaseQuery,
  accountId: string,
  deviceId: string,
) {
  const result = await tx.query<{ status: string }>(
    `SELECT status FROM devices WHERE account_id=$1 AND id=$2`,
    [accountId, deviceId],
  );
  return result.rows[0];
}
function writable(row: Row): void {
  if (["COMPLETED", "CANCELLED"].includes(row.state)) fail("TRANSFER_REPLAY");
  if (row.state === "EXPIRED") fail("TRANSFER_EXPIRED");
}

export function createCredentialTransferRepository(
  runtime: DatabaseRuntime,
): TransferRepository {
  return {
    async create({ principal, request, now }) {
      return runtime.transaction(async (tx) => {
        assertActiveDevice(
          await activeDevice(tx, principal.accountId, principal.deviceId),
        );
        if (request.recipientDeviceId !== principal.deviceId)
          fail("TRANSFER_ACCOUNT_MISMATCH");
        assertActiveDevice(
          await activeDevice(
            tx,
            principal.accountId,
            request.recipientDeviceId,
          ),
        );
        const existing = await load(tx, request.requestId, now);
        if (existing) {
          if (
            existing.account_id !== principal.accountId ||
            existing.recipient_device_id !== principal.deviceId ||
            existing.recipient_public_key_spki !==
              request.recipientPublicKeySpki ||
            existing.source_device_id !== request.sourceDeviceId ||
            JSON.stringify(existing.selected_store_ids) !==
              JSON.stringify(request.selectedStores.map((x) => x.storeId))
          )
            fail("TRANSFER_CONFLICT");
          return map(existing);
        }
        const expiresAt = new Date(
          now.getTime() + request.expiresInSeconds * 1000,
        );
        await tx.query(
          `INSERT INTO credential_transfer_requests(request_id,account_id,recipient_device_id,source_device_id,recipient_public_key_spki,selected_store_ids,state,revision,created_at,expires_at) SELECT $1,$2,$3,$4,$5,$6,'REQUESTED',1,$7,$8 FROM devices d WHERE d.id=$3 AND d.account_id=$2 AND d.status='ACTIVE'`,
          [
            request.requestId,
            principal.accountId,
            request.recipientDeviceId,
            request.sourceDeviceId,
            request.recipientPublicKeySpki,
            request.selectedStores.map((x) => x.storeId),
            now,
            expiresAt,
          ],
        );
        const created = await load(tx, request.requestId, now);
        if (!created) fail("TRANSFER_DEVICE_REVOKED");
        return map(created);
      });
    },
    async read({ principal, requestId, now }) {
      return runtime.transaction(async (tx) => {
        const row = await load(tx, requestId, now);
        if (!row) return undefined;
        if (row.account_id !== principal.accountId) return undefined;
        if (
          row.recipient_device_id !== principal.deviceId &&
          row.source_device_id !== principal.deviceId
        )
          return undefined;
        return map(row);
      });
    },
    async listForSource({ principal, now }) {
      return runtime.transaction(async (tx) => {
        const rows = await tx.query<Row>(
          `SELECT request_id,account_id,recipient_device_id,source_device_id,recipient_public_key_spki,selected_store_ids,state,revision,created_at,expires_at FROM credential_transfer_requests WHERE account_id=$1 AND expires_at>$2 AND state IN ('REQUESTED','SOURCE_SEEN','PACKET_AVAILABLE_EPHEMERAL','DELIVERED_TO_RECIPIENT') AND (source_device_id IS NULL OR source_device_id=$3) AND recipient_device_id<>$3 ORDER BY created_at ASC LIMIT 16`,
          [principal.accountId, now, principal.deviceId],
        );
        return rows.rows
          .filter(
            (row) =>
              row.source_device_id === null ||
              row.source_device_id === principal.deviceId,
          )
          .map(map);
      });
    },
    async markSourceSeen({ principal, requestId, now }) {
      return transition(
        runtime,
        requestId,
        principal,
        now,
        "source",
        [
          "REQUESTED",
          "SOURCE_SEEN",
          "PACKET_AVAILABLE_EPHEMERAL",
          "DELIVERED_TO_RECIPIENT",
        ],
        async (tx, row) => {
          if (!row.source_device_id)
            await tx.query(
              `UPDATE credential_transfer_requests SET source_device_id=$2,revision=revision+1,state='SOURCE_SEEN' WHERE request_id=$1`,
              [requestId, principal.deviceId],
            );
          else
            await tx.query(
              `UPDATE credential_transfer_requests SET revision=revision+1,state='SOURCE_SEEN' WHERE request_id=$1`,
              [requestId],
            );
        },
      );
    },
    async markPacketAvailable({ principal, requestId, now }) {
      return transition(
        runtime,
        requestId,
        principal,
        now,
        "source",
        ["SOURCE_SEEN", "PACKET_AVAILABLE_EPHEMERAL", "DELIVERED_TO_RECIPIENT"],
        async (tx) => {
          await tx.query(
            `UPDATE credential_transfer_requests SET state='PACKET_AVAILABLE_EPHEMERAL',revision=revision+1 WHERE request_id=$1`,
            [requestId],
          );
        },
      );
    },
    async markDelivered({ principal, requestId, now }) {
      return transition(
        runtime,
        requestId,
        principal,
        now,
        "recipient",
        ["PACKET_AVAILABLE_EPHEMERAL", "DELIVERED_TO_RECIPIENT"],
        async (tx) => {
          await tx.query(
            `UPDATE credential_transfer_requests SET state='DELIVERED_TO_RECIPIENT',revision=revision+1 WHERE request_id=$1`,
            [requestId],
          );
        },
      );
    },
    async acknowledge({ principal, ack, now }) {
      return transition(
        runtime,
        ack.requestId,
        principal,
        now,
        "recipient",
        ["DELIVERED_TO_RECIPIENT"],
        async (tx) => {
          await tx.query(
            `UPDATE credential_transfer_requests SET state='COMPLETED',revision=revision+1 WHERE request_id=$1`,
            [ack.requestId],
          );
        },
      );
    },
    async cancel({ principal, requestId, now }) {
      return transition(
        runtime,
        requestId,
        principal,
        now,
        "recipient",
        ["REQUESTED", "SOURCE_SEEN"],
        async (tx) => {
          await tx.query(
            `UPDATE credential_transfer_requests SET state='CANCELLED',revision=revision+1 WHERE request_id=$1`,
            [requestId],
          );
        },
      );
    },
    async expireDue(now) {
      const result = await runtime.query(
        `UPDATE credential_transfer_requests SET state='EXPIRED',revision=revision+1 WHERE expires_at<=$1 AND state NOT IN ('COMPLETED','CANCELLED','EXPIRED') RETURNING request_id`,
        [now],
      );
      return result.rows.length;
    },
  };
}

async function transition(
  runtime: DatabaseRuntime,
  requestId: string,
  principal: ExtensionPrincipal,
  now: Date,
  role: "recipient" | "source",
  allowed: Row["state"][],
  update: (tx: DatabaseQuery, row: Row) => Promise<void>,
): Promise<TransferRequestV1> {
  return runtime.transaction(async (tx) => {
    const row = await load(tx, requestId, now, true);
    if (!row) fail("TRANSFER_ACCOUNT_MISMATCH");
    assertPrincipal(row, principal, role);
    assertActiveDevice(
      await activeDevice(tx, principal.accountId, principal.deviceId),
    );
    writable(row);
    if (!allowed.includes(row.state)) fail("TRANSFER_CONFLICT");
    await update(tx, row);
    const next = await load(tx, requestId, now);
    if (!next) fail("TRANSFER_INVALID");
    return map(next);
  });
}
