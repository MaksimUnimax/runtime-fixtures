import { createHash } from "node:crypto";
import {
  SellerAgentsSyncEntryV1Schema,
  SellerAgentsSyncRequestV1Schema,
  SellerAgentsSyncResponseV1Schema,
  type SellerAgentsSyncEntryV1,
  type SellerAgentsSyncResponseV1,
} from "@product/contracts";
import type { ExtensionPrincipal } from "@product/extension-auth";
export {
  applyReconciliationEntry,
  compareDeliveryMarkers,
  RECONCILIATION_CLASSES,
  STORE_RECONCILIATION_CLASSES,
  applyStoreMetadataEntry,
  sameEffectiveBinding,
} from "./reconciliation.js";

export interface SyncRepositoryResult {
  readonly outcome: "ACK" | "CONFLICT" | "RETRY";
  readonly serverRevision: number;
  readonly serverState: SellerAgentsSyncEntryV1["payload"] | null;
  readonly code: string | null;
}
export interface SyncRepository {
  apply(input: {
    principal: ExtensionPrincipal;
    entry: SellerAgentsSyncEntryV1;
    fingerprint: string;
  }): Promise<SyncRepositoryResult>;
}
export class SyncRequestError extends Error {
  public constructor(
    public readonly code:
      | "SYNC_REQUEST_ID_CONFLICT"
      | "ACCOUNT_IDENTITY_MISMATCH"
      | "SYNC_CANONICAL_ENTITY_MISMATCH"
      | "SYNC_CANONICAL_ENTITY_COLLISION",
  ) {
    super(code);
  }
}
function fingerprint(entry: SellerAgentsSyncEntryV1): string {
  return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}
export class SyncService {
  public constructor(private readonly repository: SyncRepository) {}
  public async apply(
    principal: ExtensionPrincipal,
    body: unknown,
  ): Promise<SellerAgentsSyncResponseV1> {
    const request = SellerAgentsSyncRequestV1Schema.parse(body);
    if (request.installationId !== principal.deviceId)
      throw new SyncRequestError("ACCOUNT_IDENTITY_MISMATCH");
    const results = [];
    for (const entry of request.entries) {
      const parsed = SellerAgentsSyncEntryV1Schema.parse(entry);
      const result = await this.repository.apply({
        principal,
        entry: parsed,
        fingerprint: fingerprint(parsed),
      });
      if (result.outcome === "CONFLICT" && !result.serverState) {
        results.push({
          requestId: parsed.requestId,
          mutationId: parsed.mutationId,
          entityId: parsed.entityId,
          outcome: result.outcome,
          serverRevision: result.serverRevision,
          serverState: null,
          code: result.code || "SYNC_CONFLICT",
        });
      } else {
        results.push({
          requestId: parsed.requestId,
          mutationId: parsed.mutationId,
          entityId: parsed.entityId,
          outcome: result.outcome,
          serverRevision: result.serverRevision,
          serverState: result.serverState,
          code: result.code,
        });
      }
    }
    return SellerAgentsSyncResponseV1Schema.parse({
      syncVersion: request.syncVersion,
      results,
    });
  }
}
