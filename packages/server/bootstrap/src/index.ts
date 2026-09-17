import type {
  BootstrapRequestV1,
  BootstrapRequestV2,
  BootstrapSnapshotPayloadV1,
  BootstrapSnapshotPayloadV2,
  SignedBootstrapEnvelopeV1,
  SignedBootstrapEnvelopeV2,
  HealthAuthorityRequestV1,
  HealthClaimV1,
  HealthContextBindingV1,
  SignedHealthEnvelopeV1,
} from "@product/contracts";
import type { CommercialAccessResolution } from "@product/commercial-access";
import { getSellerAgentsFreeBetaCapabilityPermissions } from "@product/entitlements/seller-agents-beta-capability-policy";
import {
  isSellerAgentsCapabilityPermissionKey,
  SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS,
} from "@product/entitlements/seller-agents-capability-permissions";
import type { SafeEntitlementMap } from "@product/commercial-access";
import {
  type ResolveP3BootstrapPolicyInput,
  type ResolveP3BootstrapPolicyResult,
} from "@product/remote-config";
import {
  BootstrapSnapshotPayloadV1Schema,
  BootstrapSnapshotPayloadV2Schema,
  BootstrapRequestV2Schema,
  HealthClaimV1Schema,
} from "@product/contracts";
import { BootstrapAiResolutionService } from "./ai-resolution.js";
import type { BetaAccessResolution } from "@product/beta-access";

export * from "./ai-resolution.js";

export type BootstrapSubject = { accountId: string; deviceId: string };
export type BootstrapPolicyResolver = {
  resolve(
    input: ResolveP3BootstrapPolicyInput,
  ): Promise<ResolveP3BootstrapPolicyResult | { failure: string }>;
};
export type BootstrapSnapshotSigningService = {
  sign(
    keyId: string,
    payload: BootstrapSnapshotPayloadV1,
  ): Promise<SignedBootstrapEnvelopeV1>;
  signV2?(
    keyId: string,
    payload: BootstrapSnapshotPayloadV2,
  ): Promise<SignedBootstrapEnvelopeV2>;
  signHealth?(
    keyId: string,
    claim: HealthClaimV1,
  ): Promise<SignedHealthEnvelopeV1>;
};
export type BootstrapHealthDecision =
  | { status: "PASS" }
  | {
      status: "DENY";
      reason:
        | "PRODUCER_DENIED"
        | "PROVENANCE_MISSING"
        | "STALE_OBSERVATION"
        | "INVALID_CONTEXT";
    }
  | {
      status: "UNAVAILABLE";
      reason:
        | "PRODUCER_UNAVAILABLE"
        | "PROVENANCE_MISSING"
        | "AI_UNAVAILABLE"
        | "INVALID_CONTEXT";
    };
export type BootstrapHealthAuthorityResolver = {
  resolve(input: {
    accountId: string;
    deviceId: string;
    configVersion: number;
    ai: HealthContextBindingV1["ai"];
    observedAt: Date;
  }): Promise<BootstrapHealthDecision>;
};
export type BootstrapClock = { now(): Date };
export type BootstrapCommercialAccessResolver = {
  resolve(accountId: string, at: Date): Promise<CommercialAccessResolution>;
};
export type BootstrapBetaAccessResolver = {
  resolve(accountId: string): Promise<BetaAccessResolution>;
};
export type BootstrapBetaCapabilityPermissionResolver = {
  resolve(): unknown;
};

type SignedEntitlementCompositionInput = {
  betaEligible: boolean;
  commercialEligible: boolean;
  commercialEntitlements: SafeEntitlementMap | undefined;
};

function materializeBetaCapabilityPermissions(
  value: unknown,
): SafeEntitlementMap {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error("SELLER_AGENTS_BETA_CAPABILITY_POLICY_INVALID");

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS.length ||
    !ownKeys.every(
      (key) =>
        typeof key === "string" && isSellerAgentsCapabilityPermissionKey(key),
    )
  )
    throw new Error("SELLER_AGENTS_BETA_CAPABILITY_POLICY_INVALID");

  const materialized: SafeEntitlementMap = {};
  for (const entitlementKey of SELLER_AGENTS_CAPABILITY_PERMISSION_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, entitlementKey);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      descriptor.value !== true
    )
      throw new Error("SELLER_AGENTS_BETA_CAPABILITY_POLICY_INVALID");
    materialized[entitlementKey] = true;
  }
  return materialized;
}

function composeSignedEntitlements(
  input: SignedEntitlementCompositionInput,
  betaCapabilityPermissions: BootstrapBetaCapabilityPermissionResolver,
): SafeEntitlementMap {
  const entitlements: SafeEntitlementMap = input.commercialEligible
    ? { ...input.commercialEntitlements }
    : {};
  if (!input.betaEligible) return entitlements;

  const betaPermissions = materializeBetaCapabilityPermissions(
    betaCapabilityPermissions.resolve(),
  );
  return { ...entitlements, ...betaPermissions };
}

export class BootstrapError extends Error {
  constructor(public readonly code: "DEVICE_MISMATCH" | "UNAVAILABLE") {
    super(code);
  }
}
export class BootstrapService {
  constructor(
    private readonly policy: BootstrapPolicyResolver,
    private readonly signer: BootstrapSnapshotSigningService,
    private readonly clock: BootstrapClock = { now: () => new Date() },
    private readonly commercialAccess?: BootstrapCommercialAccessResolver,
    private readonly aiResolution?: BootstrapAiResolutionService,
    private readonly betaAccess?: BootstrapBetaAccessResolver,
    private readonly betaCapabilityPermissions: BootstrapBetaCapabilityPermissionResolver = {
      resolve: getSellerAgentsFreeBetaCapabilityPermissions,
    },
    private readonly healthResolver?: BootstrapHealthAuthorityResolver,
  ) {}

  async issueHealth(
    subject: BootstrapSubject,
    request: HealthAuthorityRequestV1,
  ): Promise<SignedHealthEnvelopeV1> {
    if (request.healthTransportVersion !== "health_transport_v1")
      throw new BootstrapError("UNAVAILABLE");
    const bootstrapRequest = BootstrapRequestV2Schema.parse(request.bootstrap);
    if (bootstrapRequest.deviceId !== subject.deviceId)
      throw new BootstrapError("DEVICE_MISMATCH");
    if (!this.signer.signHealth) throw new BootstrapError("UNAVAILABLE");
    const now = new Date(this.clock.now().getTime());
    const result = await this.policy.resolve({
      contractVersion: bootstrapRequest.contractVersion,
      extensionVersion: bootstrapRequest.extensionVersion,
      browser: bootstrapRequest.browser,
      accountId: subject.accountId,
      deviceId: subject.deviceId,
    });
    if ("failure" in result) throw new BootstrapError("UNAVAILABLE");

    let eligible = !this.commercialAccess && !this.betaAccess;
    let commercialDeadline: Date | null = null;
    if (this.commercialAccess) {
      const commercial = await this.commercialAccess.resolve(
        subject.accountId,
        now,
      );
      if (commercial.kind !== "OK") throw new BootstrapError("UNAVAILABLE");
      eligible = commercial.value.access.kind === "ELIGIBLE";
      commercialDeadline = commercial.value.accessUntil;
    }
    if (this.betaAccess) {
      const beta = await this.betaAccess.resolve(subject.accountId);
      eligible = eligible || beta.kind === "BETA";
    }
    let ai: BootstrapSnapshotPayloadV2["ai"] = { status: "UNCONFIGURED" };
    if (eligible && bootstrapRequest.detectedAi && this.aiResolution) {
      try {
        ai = await this.aiResolution.resolve({
          detected: {
            family: bootstrapRequest.detectedAi.family,
            surface: bootstrapRequest.detectedAi.surface,
            variant: bootstrapRequest.detectedAi.variant ?? null,
          },
          contractVersion: bootstrapRequest.contractVersion,
          extensionVersion: bootstrapRequest.extensionVersion,
          browser: bootstrapRequest.browser,
          accountId: subject.accountId,
          deviceId: subject.deviceId,
        });
      } catch {
        ai = {
          status: "UNAVAILABLE",
          detected: {
            family: bootstrapRequest.detectedAi.family,
            surface: bootstrapRequest.detectedAi.surface,
            variant: bootstrapRequest.detectedAi.variant ?? null,
          },
          reason: "NO_PROFILE",
        };
      }
    }
    const decision: BootstrapHealthDecision =
      ai.status !== "RESOLVED"
        ? { status: "UNAVAILABLE" as const, reason: "AI_UNAVAILABLE" as const }
        : this.healthResolver
          ? await this.healthResolver.resolve({
              accountId: subject.accountId,
              deviceId: subject.deviceId,
              configVersion: result.configVersion,
              ai: {
                family: ai.detected.family,
                surface: ai.detected.surface,
                variant: ai.detected.variant,
                profileKey: ai.profile.profileKey,
                revision: ai.profile.revision,
                scopeVariant: ai.profile.scopeVariant,
                contentSha256: ai.profile.contentSha256,
              },
              observedAt: now,
            })
          : {
              status: "UNAVAILABLE" as const,
              reason: "PRODUCER_UNAVAILABLE" as const,
            };
    let claim: HealthClaimV1;
    if (decision.status === "PASS") {
      if (ai.status !== "RESOLVED") throw new BootstrapError("UNAVAILABLE");
      const observedAt = now.toISOString();
      const baseExpiry = now.getTime() + 15 * 60_000;
      const authorityExpiry = commercialDeadline
        ? Math.min(baseExpiry, commercialDeadline.getTime() - 1)
        : baseExpiry;
      if (!(now.getTime() < authorityExpiry))
        throw new BootstrapError("UNAVAILABLE");
      claim = HealthClaimV1Schema.parse({
        healthClaimVersion: "health_claim_v1",
        status: "PASS",
        target: "WORK",
        context: {
          accountId: subject.accountId,
          contractVersion: "control_plane_v2",
          configVersion: result.configVersion,
          ai: {
            family: ai.detected.family,
            surface: ai.detected.surface,
            variant: ai.detected.variant,
            profileKey: ai.profile.profileKey,
            revision: ai.profile.revision,
            scopeVariant: ai.profile.scopeVariant,
            contentSha256: ai.profile.contentSha256,
          },
        },
        observedAt,
        expiresAt: new Date(authorityExpiry).toISOString(),
        executionAuthority: false,
      });
    } else {
      claim = HealthClaimV1Schema.parse({
        healthClaimVersion: "health_claim_v1",
        status: decision.status,
        target: "WORK",
        reason: decision.reason,
        observedAt: now.toISOString(),
        executionAuthority: false,
      });
    }
    try {
      const envelope = await this.signer.signHealth(result.signingKeyId, claim);
      if (envelope.keyId !== result.signingKeyId)
        throw new Error("signing key mismatch");
      return envelope;
    } catch {
      throw new BootstrapError("UNAVAILABLE");
    }
  }

  private signedEntitlements(
    input: SignedEntitlementCompositionInput,
  ): SafeEntitlementMap {
    try {
      return composeSignedEntitlements(input, this.betaCapabilityPermissions);
    } catch {
      throw new BootstrapError("UNAVAILABLE");
    }
  }

  async issue(
    subject: BootstrapSubject,
    request: BootstrapRequestV1,
  ): Promise<SignedBootstrapEnvelopeV1> {
    if (request.deviceId !== subject.deviceId)
      throw new BootstrapError("DEVICE_MISMATCH");
    const now = new Date(this.clock.now().getTime());
    const result = await this.policy.resolve({
      contractVersion: request.contractVersion,
      extensionVersion: request.extensionVersion,
      browser: request.browser,
      accountId: subject.accountId,
      deviceId: subject.deviceId,
    });
    if ("failure" in result) throw new BootstrapError("UNAVAILABLE");
    const commercial = this.commercialAccess
      ? await this.commercialAccess.resolve(subject.accountId, now)
      : undefined;
    if (commercial && commercial.kind !== "OK")
      throw new BootstrapError("UNAVAILABLE");
    const currentSubscription = commercial?.value.currentSubscription ?? null;
    const commercialEligible = commercial?.value.access.kind === "ELIGIBLE";
    const beta = this.betaAccess
      ? await this.betaAccess.resolve(subject.accountId)
      : { kind: "NONE" as const };
    const betaEligible = beta.kind === "BETA";
    const eligible = betaEligible || commercialEligible;
    const accessBasis = betaEligible
      ? "BETA"
      : commercialEligible
        ? "COMMERCIAL"
        : "NONE";
    let ai: BootstrapSnapshotPayloadV1["ai"] = { status: "UNCONFIGURED" };
    if (request.detectedAi) {
      const detected = {
        family: request.detectedAi.family,
        surface: request.detectedAi.surface,
        variant: request.detectedAi.variant ?? null,
      };
      if (!eligible) {
        ai = { status: "UNAVAILABLE", detected, reason: "NO_PROFILE" };
      } else if (this.aiResolution) {
        try {
          ai = await this.aiResolution.resolve({
            detected,
            contractVersion: request.contractVersion,
            extensionVersion: request.extensionVersion,
            browser: request.browser,
            accountId: subject.accountId,
            deviceId: subject.deviceId,
          });
        } catch {
          throw new BootstrapError("UNAVAILABLE");
        }
      } else {
        ai = { status: "UNAVAILABLE", detected, reason: "NO_PROFILE" };
      }
    }
    const issuedAt = now.toISOString();
    let expiresAt = new Date(now.getTime() + 15 * 60_000);
    let offlineGraceUntil = new Date(expiresAt.getTime() + 24 * 60 * 60_000);
    if (accessBasis === "COMMERCIAL") {
      const deadline = commercial!.value.accessUntil!;
      offlineGraceUntil = new Date(
        Math.min(offlineGraceUntil.getTime(), deadline.getTime()),
      );
      expiresAt = new Date(
        Math.min(expiresAt.getTime(), offlineGraceUntil.getTime() - 1),
      );
      if (!(now < expiresAt && expiresAt < offlineGraceUntil))
        throw new BootstrapError("UNAVAILABLE");
    }
    const entitlements = this.signedEntitlements({
      betaEligible,
      commercialEligible,
      commercialEntitlements: commercial?.value.entitlements,
    });
    const payload = BootstrapSnapshotPayloadV1Schema.parse({
      snapshotVersion: "bootstrap_snapshot_v1",
      contractVersion: "control_plane_v1",
      configVersion: result.configVersion,
      serverTime: issuedAt,
      issuedAt,
      expiresAt: expiresAt.toISOString(),
      offlineGraceUntil: offlineGraceUntil.toISOString(),
      account: { status: "ACTIVE" },
      accessBasis,
      subscription: currentSubscription
        ? {
            state: currentSubscription.state,
            planRevision: currentSubscription.currentPlanRevisionId,
          }
        : { state: "NONE", planRevision: null },
      devicePolicy: { status: "ACTIVE" },
      compatibility: result.compatibility,
      entitlements,
      features: result.features,
      ai,
    });
    try {
      const envelope = await this.signer.sign(result.signingKeyId, payload);
      if (envelope.keyId !== result.signingKeyId)
        throw new Error("signing key mismatch");
      return envelope;
    } catch {
      throw new BootstrapError("UNAVAILABLE");
    }
  }

  async issueV2(
    subject: BootstrapSubject,
    request: BootstrapRequestV2,
  ): Promise<SignedBootstrapEnvelopeV2> {
    if (request.deviceId !== subject.deviceId)
      throw new BootstrapError("DEVICE_MISMATCH");
    if (!this.signer.signV2) throw new BootstrapError("UNAVAILABLE");
    const now = new Date(this.clock.now().getTime());
    const result = await this.policy.resolve({
      contractVersion: request.contractVersion,
      extensionVersion: request.extensionVersion,
      browser: request.browser,
      accountId: subject.accountId,
      deviceId: subject.deviceId,
    });
    if ("failure" in result) throw new BootstrapError("UNAVAILABLE");
    const commercial = this.commercialAccess
      ? await this.commercialAccess.resolve(subject.accountId, now)
      : undefined;
    if (commercial && commercial.kind !== "OK")
      throw new BootstrapError("UNAVAILABLE");
    const currentSubscription = commercial?.value.currentSubscription ?? null;
    const commercialEligible = commercial?.value.access.kind === "ELIGIBLE";
    const beta = this.betaAccess
      ? await this.betaAccess.resolve(subject.accountId)
      : { kind: "NONE" as const };
    const betaEligible = beta.kind === "BETA";
    const eligible = betaEligible || commercialEligible;
    const accessBasis = betaEligible
      ? "BETA"
      : commercialEligible
        ? "COMMERCIAL"
        : "NONE";
    let ai: BootstrapSnapshotPayloadV2["ai"] = { status: "UNCONFIGURED" };
    if (request.detectedAi) {
      const detected = {
        family: request.detectedAi.family,
        surface: request.detectedAi.surface,
        variant: request.detectedAi.variant ?? null,
      };
      if (!eligible)
        ai = { status: "UNAVAILABLE", detected, reason: "NO_PROFILE" };
      else if (this.aiResolution) {
        try {
          ai = await this.aiResolution.resolve({
            detected,
            contractVersion: request.contractVersion,
            extensionVersion: request.extensionVersion,
            browser: request.browser,
            accountId: subject.accountId,
            deviceId: subject.deviceId,
          });
        } catch {
          throw new BootstrapError("UNAVAILABLE");
        }
      } else ai = { status: "UNAVAILABLE", detected, reason: "NO_PROFILE" };
    }
    const issuedAt = now.toISOString();
    let expiresAt = new Date(now.getTime() + 15 * 60_000);
    let offlineGraceUntil = new Date(expiresAt.getTime() + 24 * 60 * 60_000);
    if (accessBasis === "COMMERCIAL") {
      const deadline = commercial!.value.accessUntil!;
      offlineGraceUntil = new Date(
        Math.min(offlineGraceUntil.getTime(), deadline.getTime()),
      );
      expiresAt = new Date(
        Math.min(expiresAt.getTime(), offlineGraceUntil.getTime() - 1),
      );
      if (!(now < expiresAt && expiresAt < offlineGraceUntil))
        throw new BootstrapError("UNAVAILABLE");
    }
    const entitlements = this.signedEntitlements({
      betaEligible,
      commercialEligible,
      commercialEntitlements: commercial?.value.entitlements,
    });
    const payload = BootstrapSnapshotPayloadV2Schema.parse({
      snapshotVersion: "bootstrap_snapshot_v2",
      contractVersion: "control_plane_v2",
      configVersion: result.configVersion,
      serverTime: issuedAt,
      issuedAt,
      expiresAt: expiresAt.toISOString(),
      offlineGraceUntil: offlineGraceUntil.toISOString(),
      account: { id: subject.accountId, status: "ACTIVE" },
      accessBasis,
      subscription: currentSubscription
        ? {
            state: currentSubscription.state,
            planRevision: currentSubscription.currentPlanRevisionId,
          }
        : { state: "NONE", planRevision: null },
      devicePolicy: { status: "ACTIVE" },
      compatibility: result.compatibility,
      entitlements,
      features: result.features,
      ai,
    });
    try {
      const envelope = await this.signer.signV2(result.signingKeyId, payload);
      if (envelope.keyId !== result.signingKeyId)
        throw new Error("signing key mismatch");
      return envelope;
    } catch {
      throw new BootstrapError("UNAVAILABLE");
    }
  }
}
