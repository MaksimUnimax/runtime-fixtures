import { randomUUID } from "node:crypto";
import type { DeviceClientMetadata } from "@product/device-auth";
import type { DeviceLimitResolver } from "@product/device-management";
import { decideSellerAgentsDeviceAdmission } from "@product/entitlements";
import type { DatabaseQuery } from "./index.js";

export interface DeviceEnrollmentInput {
  accountId: string;
  ownerUserId: string;
  clientMetadata: DeviceClientMetadata;
  deviceLabel: string | null;
  refreshTokenHash: string;
  refreshTokenExpiresAt: Date;
  now: Date;
  correlationId: string;
  source: {
    kind: "DEVICE_AUTHORIZATION" | "CONNECTION_CREDENTIAL";
    id: string;
  };
  resolveLimit: DeviceLimitResolver["resolve"];
}

/** Shared by legacy device approval and direct-code enrollment, in caller's transaction. */
export async function enrollDeviceInTransaction(
  tx: DatabaseQuery,
  input: DeviceEnrollmentInput,
) {
  // Same account lock as existing device admission and subscription mutations.
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    "p5-subscription-account:" + input.accountId,
  ]);
  const eligible = await tx.query<{ id: string }>(
    "SELECT a.id FROM accounts a JOIN users u ON u.id=$2 " +
      "JOIN account_memberships m ON m.account_id=a.id AND m.user_id=u.id AND m.role='OWNER' " +
      "WHERE a.id=$1 AND a.status='ACTIVE' AND u.status='ACTIVE' FOR UPDATE OF a",
    [input.accountId, input.ownerUserId],
  );
  if (!eligible.rows[0]) return { kind: "closed" as const };
  let resolved;
  try {
    resolved = await input.resolveLimit(input.accountId, input.now);
  } catch {
    return { kind: "invalid-limit" as const };
  }
  const unlimited =
    "kind" in resolved &&
    resolved.kind === "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT";
  if (!unlimited) {
    if ("kind" in resolved) {
      if (resolved.kind === "INELIGIBLE")
        return { kind: "subscription-required" as const };
      if (resolved.kind === "ACCOUNT_NOT_FOUND")
        return { kind: "closed" as const };
      if (resolved.kind !== "ELIGIBLE")
        return { kind: "invalid-limit" as const };
    }
    const limit = resolved as { maxActive: number; source: string };
    if (
      !Number.isInteger(limit.maxActive) ||
      limit.maxActive < 0 ||
      limit.maxActive > 10_000
    )
      return { kind: "invalid-limit" as const };
    const count = await tx.query<{ count: string }>(
      "SELECT count(*) count FROM devices WHERE account_id=$1 AND status='ACTIVE'",
      [input.accountId],
    );
    const activeDeviceCount = Number(count.rows[0]?.count);
    const decision =
      limit.maxActive === 0
        ? { kind: "DENY" as const, reason: "DEVICE_LIMIT_REACHED" as const }
        : decideSellerAgentsDeviceAdmission({
            limit: { kind: "FINITE", value: limit.maxActive },
            activeDeviceCount,
            alreadyAdmitted: false,
          });
    if (decision.kind === "DENY") {
      await tx.query(
        "INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id) " +
          "VALUES('SYSTEM','DEVICE_ACTIVATION_LIMIT_REACHED',$1,$2,$3)",
        [input.source.kind, input.source.id, input.correlationId],
      );
      return { kind: "limit" as const };
    }
  }
  const deviceId = randomUUID(),
    sessionId = randomUUID();
  const metadata =
    input.clientMetadata.state === "PRESENT" ? input.clientMetadata : null;
  await tx.query(
    "INSERT INTO devices(id,account_id,created_by_user_id,status,label,browser_family," +
      "browser_version_last_seen,extension_version_last_seen,created_at,activated_at,last_seen_at," +
      "connection_credential_id) VALUES($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$8,$8,$8,$9)",
    [
      deviceId,
      input.accountId,
      input.ownerUserId,
      input.deviceLabel,
      metadata?.browserFamily ?? null,
      metadata?.browserVersion ?? null,
      metadata?.extensionVersion ?? null,
      input.now,
      input.source.kind === "CONNECTION_CREDENTIAL" ? input.source.id : null,
    ],
  );
  await tx.query(
    "INSERT INTO sessions(id,device_id,account_id,status,token_family_id,created_at) " +
      "VALUES($1,$2,$3,'ACTIVE',$4,$5)",
    [sessionId, deviceId, input.accountId, randomUUID(), input.now],
  );
  await tx.query(
    "INSERT INTO refresh_tokens(id,session_id,token_hash,generation,issued_at,expires_at) " +
      "VALUES($1,$2,$3,0,$4,$5)",
    [
      randomUUID(),
      sessionId,
      input.refreshTokenHash,
      input.now,
      input.refreshTokenExpiresAt,
    ],
  );
  for (const [action, target, id] of [
    ["DEVICE_ACTIVATED", "DEVICE", deviceId],
    ["EXTENSION_SESSION_CREATED", "SESSION", sessionId],
    ["EXTENSION_REFRESH_ISSUED", "REFRESH_TOKEN", sessionId],
  ])
    await tx.query(
      "INSERT INTO audit_events(actor_type,action,target_type,target_id,correlation_id) " +
        "VALUES('SYSTEM',$1,$2,$3,$4)",
      [action, target, id, input.correlationId],
    );
  return {
    kind: "activated" as const,
    accountId: input.accountId,
    deviceId,
    sessionId,
    refreshTokenExpiresAt: input.refreshTokenExpiresAt,
  };
}
