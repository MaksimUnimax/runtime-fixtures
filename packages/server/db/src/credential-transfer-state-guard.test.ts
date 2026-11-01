import { describe, expect, it } from "vitest";
import type { TransferRequestV1 } from "@product/contracts";
import type { DatabaseQuery } from "./index.js";
import { createCredentialTransferRepository } from "./credential-transfer-repository.js";

const uuid = (n: number) =>
  `82000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = { accountId: uuid(1), deviceId: uuid(2), sessionId: uuid(3) };
const recipient = { accountId: uuid(1), deviceId: uuid(4), sessionId: uuid(5) };
const requestId = uuid(6),
  now = new Date("2026-10-28T00:00:00.000Z");
type State = TransferRequestV1["state"];

// Executes the real repository/transaction callback against synthetic SQL rows.
// This is not PostgreSQL or a substitute for its separately constrained proof.
function fixture(state: State) {
  const row = {
    request_id: requestId,
    account_id: source.accountId,
    source_device_id: source.deviceId,
    recipient_device_id: recipient.deviceId,
    recipient_public_key_spki: "A".repeat(128),
    selected_store_ids: ["synthetic"],
    state,
    revision: 4,
    created_at: now,
    expires_at: new Date(now.getTime() + 300_000),
  };
  const queries: string[] = [];
  let transactions = 0;
  const repository = createCredentialTransferRepository({
    async transaction<T>(
      action: (tx: DatabaseQuery) => Promise<T>,
    ): Promise<T> {
      transactions++;
      return action({
        async query<
          U extends Record<string, unknown> = Record<string, unknown>,
        >(text: string): Promise<{ rows: U[] }> {
          queries.push(text);
          if (text.startsWith("SELECT status FROM devices"))
            return { rows: [{ status: "ACTIVE" }] as unknown as U[] };
          if (text.startsWith("SELECT request_id,"))
            return { rows: [{ ...row }] as unknown as U[] };
          if (text.startsWith("UPDATE credential_transfer_requests SET")) {
            const match = /state='([A-Z_]+)'/.exec(text);
            if (!match) throw new Error("Unexpected synthetic UPDATE");
            row.state = match[1] as State;
            row.revision++;
            return { rows: [] };
          }
          throw new Error("Unexpected synthetic SQL");
        },
      });
    },
  });
  return { repository, row, queries, transactions: () => transactions };
}

const states: State[] = [
  "REQUESTED",
  "SOURCE_SEEN",
  "PACKET_AVAILABLE_EPHEMERAL",
  "DELIVERED_TO_RECIPIENT",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
];
describe("authoritative SQL repository transfer state guards", () => {
  for (const method of ["markSourceSeen", "markPacketAvailable"] as const) {
    it.each(states)(`${method} enforces the locked %s state`, async (state) => {
      const f = fixture(state),
        before = { ...f.row };
      const allowed =
        method === "markSourceSeen"
          ? ["REQUESTED", "SOURCE_SEEN", "PACKET_AVAILABLE_EPHEMERAL"]
          : ["SOURCE_SEEN", "PACKET_AVAILABLE_EPHEMERAL"];
      const action = f.repository[method]({
        principal: source,
        requestId,
        now,
      });
      if (allowed.includes(state)) {
        await expect(action).resolves.toMatchObject({
          state:
            method === "markSourceSeen"
              ? "SOURCE_SEEN"
              : "PACKET_AVAILABLE_EPHEMERAL",
        });
        expect(f.row.revision).toBe(before.revision + 1);
      } else {
        const code =
          state === "EXPIRED"
            ? "TRANSFER_EXPIRED"
            : ["COMPLETED", "CANCELLED"].includes(state)
              ? "TRANSFER_REPLAY"
              : "TRANSFER_CONFLICT";
        await expect(action).rejects.toMatchObject({ code });
        expect(f.row).toEqual(before);
        expect(f.queries.some((q) => q.startsWith("UPDATE "))).toBe(false);
      }
      expect(f.transactions()).toBe(1);
      expect(f.queries[0]).toContain("FOR UPDATE");
    });
  }
  it("keeps delivered metadata available to the original recipient ACK after both rejected source operations", async () => {
    const f = fixture("DELIVERED_TO_RECIPIENT"),
      before = { ...f.row };
    for (const method of ["markSourceSeen", "markPacketAvailable"] as const) {
      await expect(
        f.repository[method]({ principal: source, requestId, now }),
      ).rejects.toMatchObject({ code: "TRANSFER_CONFLICT" });
      expect(f.row).toEqual(before);
    }
    await expect(
      f.repository.acknowledge({
        principal: recipient,
        ack: { requestId, packetId: uuid(7), importDecision: "IMPORTED" },
        now,
      }),
    ).resolves.toMatchObject({
      state: "COMPLETED",
      revision: before.revision + 1,
    });
  });
});
