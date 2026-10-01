import { createHash } from "node:crypto";

export const BETA_MODES = ["CLOSED", "OPEN", "PAUSED"] as const;
export type BetaMode = (typeof BETA_MODES)[number];
export const BETA_IDENTITY_INVITATION_TTL_MS = 24 * 60 * 60_000;

export type BetaAdmissionState = {
  mode: BetaMode;
  capacity: number;
  admitted: number;
  remaining: number;
  revision: number;
  updatedAt: Date;
};

export type BetaDeviceAdmission = {
  kind: "BETA_UNLIMITED_FOR_COMMERCIAL_COUNT";
};
export type BetaAccessResolution = { kind: "BETA" } | { kind: "NONE" };

export type BetaIdentityInvitationStatus =
  | "PENDING"
  | "CONSUMED"
  | "REVOKED"
  | "EXPIRED";
export type BetaIdentityInvitation = {
  id: string;
  status: BetaIdentityInvitationStatus;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
};

export type BetaAdminAction =
  | "OPEN"
  | "PAUSE"
  | "CLOSE"
  | "ADD_CAPACITY"
  | "SET_CAPACITY";

export type BetaMutationResult =
  | { kind: "APPLIED"; state: BetaAdmissionState; replay: boolean }
  | { kind: "STALE" | "CONFLICT" | "FORBIDDEN" };

export type BetaIdentityInvitationMutationResult =
  | { kind: "APPLIED"; invitation: BetaIdentityInvitation; replay: boolean }
  | {
      kind:
        | "STALE"
        | "CONFLICT"
        | "FORBIDDEN"
        | "CAPACITY_REACHED"
        | "NOT_FOUND";
    };

export type BetaAdmissionRepository = {
  resolve(accountId: string): Promise<BetaAccessResolution>;
  read(): Promise<BetaAdmissionState>;
  mutate(input: {
    actorPrincipalId: string;
    requestIdHash: string;
    payloadHash: string;
    correlationId: string;
    expectedRevision: number;
    action: BetaAdminAction;
    amount?: number;
    capacity?: number;
    reason: string;
  }): Promise<BetaMutationResult>;
  readIdentityInvitation(
    invitationId: string,
  ): Promise<BetaIdentityInvitation | null>;
  inviteIdentity(input: {
    actorPrincipalId: string;
    requestIdHash: string;
    payloadHash: string;
    correlationId: string;
    expectedRevision: number;
    normalizedIdentityTarget: string;
    expiresAt: Date;
    reason: string;
  }): Promise<BetaIdentityInvitationMutationResult>;
  revokeIdentityInvitation(input: {
    actorPrincipalId: string;
    invitationId: string;
    requestIdHash: string;
    payloadHash: string;
    correlationId: string;
    reason: string;
  }): Promise<BetaIdentityInvitationMutationResult>;
};

export type BetaAdminInput = {
  actorPrincipalId: string;
  requestId: string;
  correlationId: string;
  expectedRevision: number;
  action: BetaAdminAction;
  amount?: number;
  capacity?: number;
  reason: string;
};

export type BetaIdentityInvitationCreateInput = {
  actorPrincipalId: string;
  requestId: string;
  correlationId: string;
  expectedRevision: number;
  normalizedIdentityTarget: string;
  reason: string;
};

export type BetaIdentityInvitationRevokeInput = {
  actorPrincipalId: string;
  invitationId: string;
  requestId: string;
  correlationId: string;
  reason: string;
};

export function safeBetaInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
}

function digest(label: string, value: string): string {
  return `v1:${createHash("sha256").update(`${label}:${value}`, "utf8").digest("base64url")}`;
}

export function betaRequestIdHash(value: string): string {
  return digest("beta-admin-request-id", value);
}

export function betaPayloadHash(
  input: Omit<BetaAdminInput, "actorPrincipalId" | "correlationId">,
): string {
  return digest(
    "beta-admin-payload",
    JSON.stringify({
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      action: input.action,
      amount: input.amount ?? null,
      capacity: input.capacity ?? null,
      reason: input.reason,
    }),
  );
}

export function betaInvitationRequestIdHash(value: string): string {
  return digest("beta-invitation-request-id", value);
}

export function betaInvitationCreatePayloadHash(
  input: Omit<
    BetaIdentityInvitationCreateInput,
    "actorPrincipalId" | "correlationId"
  >,
): string {
  return digest(
    "beta-invitation-create-payload",
    JSON.stringify({
      requestId: input.requestId,
      expectedRevision: input.expectedRevision,
      normalizedIdentityTarget: input.normalizedIdentityTarget,
      reason: input.reason,
    }),
  );
}

export function betaInvitationRevokePayloadHash(
  input: Omit<
    BetaIdentityInvitationRevokeInput,
    "actorPrincipalId" | "correlationId"
  >,
): string {
  return digest(
    "beta-invitation-revoke-payload",
    JSON.stringify({
      invitationId: input.invitationId,
      requestId: input.requestId,
      reason: input.reason,
    }),
  );
}

function validNormalizedEmail(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 320 &&
    value === value.trim().normalize("NFC").toLowerCase() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
  );
}

export class BetaAdmissionService {
  public constructor(
    private readonly repository: BetaAdmissionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  resolve(accountId: string): Promise<BetaAccessResolution> {
    return this.repository.resolve(accountId);
  }

  read(): Promise<BetaAdmissionState> {
    return this.repository.read();
  }

  readIdentityInvitation(invitationId: string) {
    return this.repository.readIdentityInvitation(invitationId);
  }

  mutate(input: BetaAdminInput) {
    if (!safeBetaInteger(input.expectedRevision) || input.expectedRevision < 1)
      return Promise.resolve({ kind: "CONFLICT" as const });
    if (
      input.action === "ADD_CAPACITY" &&
      (input.amount === undefined ||
        !safeBetaInteger(input.amount) ||
        input.amount < 1)
    )
      return Promise.resolve({ kind: "CONFLICT" as const });
    if (
      input.action === "SET_CAPACITY" &&
      (input.capacity === undefined || !safeBetaInteger(input.capacity))
    )
      return Promise.resolve({ kind: "CONFLICT" as const });
    return this.repository.mutate({
      ...input,
      requestIdHash: betaRequestIdHash(input.requestId),
      payloadHash: betaPayloadHash(input),
    });
  }

  createIdentityInvitation(input: BetaIdentityInvitationCreateInput) {
    if (
      !safeBetaInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      !validNormalizedEmail(input.normalizedIdentityTarget)
    )
      return Promise.resolve({ kind: "CONFLICT" as const });
    return this.repository.inviteIdentity({
      ...input,
      requestIdHash: betaInvitationRequestIdHash(input.requestId),
      payloadHash: betaInvitationCreatePayloadHash(input),
      expiresAt: new Date(
        this.now().getTime() + BETA_IDENTITY_INVITATION_TTL_MS,
      ),
    });
  }

  revokeIdentityInvitation(input: BetaIdentityInvitationRevokeInput) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.invitationId,
      )
    )
      return Promise.resolve({ kind: "NOT_FOUND" as const });
    return this.repository.revokeIdentityInvitation({
      ...input,
      requestIdHash: betaInvitationRequestIdHash(input.requestId),
      payloadHash: betaInvitationRevokePayloadHash(input),
    });
  }
}
