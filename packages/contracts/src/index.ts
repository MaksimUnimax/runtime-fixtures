import { z } from "zod";
import {
  SemVerV1Schema,
  StableMachineIdentifierV1Schema,
} from "@product/shared";

/** Public contract convention: names use a V1 suffix until a breaking version is introduced. */
export const CorrelationIdV1Schema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export type CorrelationIdV1 = z.infer<typeof CorrelationIdV1Schema>;

export const ApiErrorCodeV1Schema = z.enum([
  "INTERNAL_ERROR",
  "INVALID_REQUEST",
  "SERVICE_UNAVAILABLE",
  "AUTH_RATE_LIMITED",
  "AUTH_OTP_INVALID",
  "AUTH_LOGIN_DENIED",
  "AUTH_SESSION_INVALID",
  "AUTH_CSRF_INVALID",
  "BETA_CLOSED",
  "BETA_CAPACITY_REACHED",
  "AUTH_REFRESH_INVALID",
  "DEVICE_AUTH_RATE_LIMITED",
  "DEVICE_AUTH_INVALID",
  "DEVICE_AUTH_FORBIDDEN",
  "DEVICE_AUTH_STATE_CONFLICT",
  "DEVICE_AUTH_IDEMPOTENCY_CONFLICT",
  "DEVICE_AUTH_CLOSED",
  "DEVICE_AUTH_PENDING",
  "DEVICE_LIMIT_REACHED",
  "DEVICE_FORBIDDEN",
  "DEVICE_NOT_FOUND",
  "UNAUTHORIZED",
  "DEVICE_MISMATCH",
  "BOOTSTRAP_UNAVAILABLE",
  "SUBSCRIPTION_REQUIRED",
  "ACCOUNT_FORBIDDEN",
  "ADMIN_UNAUTHORIZED",
  "ADMIN_FORBIDDEN",
  "ADMIN_REAUTH_REQUIRED",
  "ADMIN_CSRF_INVALID",
  "ADMIN_RESOURCE_NOT_FOUND",
  "ADMIN_CONFLICT",
  "ADMIN_STATE_STALE",
  "ADMIN_LAST_OWNER_REQUIRED",
  "ADMIN_INVALID_LIFECYCLE",
  "ADMIN_ASSIGNMENT_TARGET_INELIGIBLE",
  "ADMIN_INVALID_HIERARCHY_BINDING",
  "SUBSCRIPTION_ALREADY_EXISTS",
  "PLAN_REVISION_NOT_PUBLISHED",
  "SUBSCRIPTION_PERIOD_INVALID",
  "SUBSCRIPTION_PERIOD_NOT_EXTENDED",
  "SUBSCRIPTION_GRACE_WINDOW_CONFLICT",
  "SUBSCRIPTION_STATE_TRANSITION_INVALID",
  "SUBSCRIPTION_ALREADY_SUSPENDED",
  "SUBSCRIPTION_NOT_SUSPENDED",
  "SUBSCRIPTION_RESTORE_ORIGIN_NOT_FOUND",
  "SUBSCRIPTION_PERIOD_ENDED",
  "SUBSCRIPTION_GRACE_ENDED",
  "SUBSCRIPTION_CORRUPTED",
]);
export type ApiErrorCodeV1 = z.infer<typeof ApiErrorCodeV1Schema>;

export const ApiErrorEnvelopeV1Schema = z.object({
  error: z.object({
    code: ApiErrorCodeV1Schema,
    message: z.string().min(1),
    correlationId: CorrelationIdV1Schema,
  }),
});
export type ApiErrorEnvelopeV1 = z.infer<typeof ApiErrorEnvelopeV1Schema>;

export const AdminSessionResponseV1Schema = z.object({
  status: z.literal("authenticated"),
  expiresAt: z.string().datetime({ offset: true }),
});
export const AdminMeResponseV1Schema = z
  .object({
    status: z.literal("authenticated"),
    principalId: z.uuid(),
    roles: z.array(
      z.enum([
        "ADMIN_OWNER",
        "ADMIN_OPS",
        "ADMIN_SUPPORT",
        "ADMIN_BILLING_READONLY",
        "ADMIN_BETA_OPERATOR",
      ]),
    ),
    permissions: z.array(z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/)),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

/** P4.5 public commercial catalog wire contract. */
export const PublicCommercialCatalogVersionV1Schema = z.literal(
  "public_commercial_catalog_v1",
);
export const PublicCommercialIdentifierV1Schema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
export const PublicCommercialCatalogQueryV1Schema = z
  .object({
    marketKey: PublicCommercialIdentifierV1Schema,
    channelKey: PublicCommercialIdentifierV1Schema,
  })
  .strict();
export type PublicCommercialCatalogQueryV1 = z.infer<
  typeof PublicCommercialCatalogQueryV1Schema
>;

export const PublicCommercialMoneyV1Schema = z
  .object({
    amountMinor: z.number().int().safe().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export const PublicCommercialBillingIntervalV1Schema = z
  .object({
    unit: z.enum(["DAY", "MONTH", "YEAR"]),
    count: z.number().int().min(1).max(1200),
  })
  .strict();
export const PublicCommercialOfferV1Schema = z
  .object({
    plan: z
      .object({
        planId: z.uuid(),
        planCode: z.string().min(1),
        planRevisionId: z.uuid(),
        planRevision: z.number().int().positive(),
        displayName: z.string(),
        description: z.string(),
      })
      .strict(),
    price: z
      .object({
        priceId: z.uuid(),
        priceCode: z.string().min(1),
        priceRevisionId: z.uuid(),
        priceRevision: z.number().int().positive(),
        amount: PublicCommercialMoneyV1Schema,
        billingInterval: PublicCommercialBillingIntervalV1Schema,
        effectiveFrom: z.string().datetime({ offset: true }),
        effectiveTo: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
  })
  .strict();
export const PublicCommercialCatalogResponseV1Schema = z
  .object({
    catalogVersion: PublicCommercialCatalogVersionV1Schema,
    generatedAt: z.string().datetime({ offset: true }),
    marketKey: PublicCommercialIdentifierV1Schema,
    channelKey: PublicCommercialIdentifierV1Schema,
    offers: z.array(PublicCommercialOfferV1Schema),
  })
  .strict();
export type PublicCommercialMoneyV1 = z.infer<
  typeof PublicCommercialMoneyV1Schema
>;
export type PublicCommercialBillingIntervalV1 = z.infer<
  typeof PublicCommercialBillingIntervalV1Schema
>;
export type PublicCommercialOfferV1 = z.infer<
  typeof PublicCommercialOfferV1Schema
>;
export type PublicCommercialCatalogResponseV1 = z.infer<
  typeof PublicCommercialCatalogResponseV1Schema
>;

/** Public health responses exposed by the P1 API foundation. */
export const HealthLiveResponseV1Schema = z.object({
  status: z.literal("live"),
});
export type HealthLiveResponseV1 = z.infer<typeof HealthLiveResponseV1Schema>;

export const HealthReadyResponseV1Schema = z.object({
  status: z.literal("ready"),
});
export type HealthReadyResponseV1 = z.infer<typeof HealthReadyResponseV1Schema>;

export const OtpRequestBodyV1Schema = z.object({
  email: z.string().min(1).max(320),
});
export const OtpRequestResponseV1Schema = z.object({
  status: z.literal("accepted"),
  challengeId: z.uuid(),
  expiresAt: z.string().datetime(),
});
export const OtpVerifyBodyV1Schema = z.object({
  challengeId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
});
export const OtpVerifyResponseV1Schema = z.object({
  status: z.literal("authenticated"),
  expiresAt: z.string().datetime(),
});
const BetaActionV1Schema = z.enum([
  "OPEN",
  "PAUSE",
  "CLOSE",
  "ADD_CAPACITY",
  "SET_CAPACITY",
]);
export const BetaAdmissionMutationBodyV1Schema = z
  .object({
    requestId: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    expectedRevision: z.number().int().positive().safe(),
    action: BetaActionV1Schema,
    amount: z.number().int().positive().safe().optional(),
    capacity: z.number().int().nonnegative().safe().optional(),
    reason: z
      .string()
      .min(1)
      .max(256)
      .refine((value) =>
        [...value].every((character) => {
          const code = character.charCodeAt(0);
          return code > 0x1f && code !== 0x7f;
        }),
      )
      .transform((value) => value.trim())
      .pipe(z.string().min(1).max(256)),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "ADD_CAPACITY" && value.amount === undefined)
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "amount is required",
      });
    if (value.action === "SET_CAPACITY" && value.capacity === undefined)
      context.addIssue({
        code: "custom",
        path: ["capacity"],
        message: "capacity is required",
      });
    if (value.action !== "ADD_CAPACITY" && value.amount !== undefined)
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "amount is not allowed",
      });
    if (value.action !== "SET_CAPACITY" && value.capacity !== undefined)
      context.addIssue({
        code: "custom",
        path: ["capacity"],
        message: "capacity is not allowed",
      });
  });
export const BetaAdmissionResponseV1Schema = z
  .object({
    mode: z.enum(["CLOSED", "OPEN", "PAUSED"]),
    capacity: z.number().int().nonnegative().safe(),
    admitted: z.number().int().nonnegative().safe(),
    remaining: z.number().int().nonnegative().safe(),
    revision: z.number().int().positive().safe(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const RefreshRequestBodyV1Schema = z
  .object({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const RefreshResponseV1Schema = z.object({
  tokenType: z.literal("Bearer"),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  refreshTokenExpiresAt: z.string().datetime(),
});
const SafeVersion = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._+-]+$/);
export const DeviceAuthorizationStartBodyV1Schema = z
  .object({
    clientType: z.literal("browser_extension"),
    browserFamily: z.enum(["chrome", "yandex_chromium"]),
    browserVersion: SafeVersion.optional(),
    extensionVersion: SafeVersion,
    deviceLabel: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[^<>]*$/u)
      .optional(),
  })
  .strict();
export const DeviceAuthorizationStartResponseV1Schema = z.object({
  status: z.literal("pending"),
  authorizationId: z.uuid(),
  deviceCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  userCode: z
    .string()
    .regex(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/,
    ),
  expiresAt: z.string().datetime(),
});
export const DeviceAuthorizationApproveBodyV1Schema = z
  .object({
    accountId: z.uuid(),
    userCode: z
      .string()
      .regex(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-?[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/i,
      ),
  })
  .strict();
export const DeviceAuthorizationDenyBodyV1Schema = z
  .object({
    userCode: z
      .string()
      .regex(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-?[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/i,
      ),
  })
  .strict();
export const DeviceAuthorizationParamsV1Schema = z
  .object({ id: z.uuid() })
  .strict();
export const OwnedAccountV1Schema = z
  .object({
    id: z.uuid(),
    displayName: z.string().nullable(),
    status: z.enum(["ACTIVE", "SUSPENDED"]),
  })
  .strict();
export const OwnedAccountsResponseV1Schema = z
  .object({ accounts: z.array(OwnedAccountV1Schema) })
  .strict();
export const DeviceAuthorizationPreviewParamsV1Schema = z
  .object({ id: z.uuid() })
  .strict();
export const DeviceAuthorizationPreviewResponseV1Schema = z
  .object({
    status: z.literal("pending"),
    authorizationId: z.uuid(),
    clientType: z.literal("browser_extension"),
    browserFamily: z.enum(["chrome", "yandex_chromium"]),
    browserVersion: z.string().nullable(),
    extensionVersion: z.string(),
    deviceLabel: z.string().nullable(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export const DeviceAuthorizationApprovedResponseV1Schema = z.object({
  status: z.literal("approved"),
  authorizationId: z.uuid(),
  expiresAt: z.string().datetime(),
});
export const DeviceAuthorizationDeniedResponseV1Schema = z.object({
  status: z.literal("denied"),
  authorizationId: z.uuid(),
});
export const DeviceAuthorizationExchangeBodyV1Schema = z
  .object({ deviceCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const DeviceAuthorizationExchangeResponseV1Schema = z.object({
  status: z.literal("activated"),
  deviceId: z.uuid(),
  sessionId: z.uuid(),
  tokenType: z.literal("Bearer"),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  refreshTokenExpiresAt: z.string().datetime(),
});
export const DeviceListQueryV1Schema = z
  .object({
    accountId: z.uuid(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.uuid().optional(),
  })
  .strict();
export const DeviceListItemV1Schema = z.object({
  id: z.uuid(),
  status: z.enum(["ACTIVE", "REVOKED"]),
  label: z.string().nullable(),
  browserFamily: z.enum(["chrome", "yandex_chromium"]),
  browserVersionLastSeen: z.string().nullable(),
  extensionVersionLastSeen: z.string().nullable(),
  createdAt: z.string().datetime(),
  activatedAt: z.string().datetime().nullable(),
  lastSeenAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export const DeviceListResponseV1Schema = z.object({
  devices: z.array(DeviceListItemV1Schema),
  nextCursor: z.uuid().nullable(),
});
export const DeviceRevokeParamsV1Schema = z
  .object({ device_id: z.uuid() })
  .strict();
export const DeviceRevokeResponseV1Schema = z.object({
  status: z.literal("revoked"),
  deviceId: z.uuid(),
});

/** P5.6 read-only commercial portal contracts. */
export const AccessBasisV1Schema = z.enum(["BETA", "COMMERCIAL", "NONE"]);
export type AccessBasisV1 = z.infer<typeof AccessBasisV1Schema>;
export const SubscriptionAccessReasonV1Schema = z.enum([
  "ACCOUNT_SUSPENDED",
  "NO_CURRENT_SUBSCRIPTION",
  "PERIOD_ENDED",
  "GRACE_ENDED",
  "PAST_DUE",
  "CANCELED",
  "SUBSCRIPTION_SUSPENDED",
  "SUBSCRIPTION_EXPIRED",
  "SUBSCRIPTION_CORRUPTED",
]);
export const SubscriptionQueryV1Schema = z
  .object({ accountId: z.uuid() })
  .strict();
export const SubscriptionResponseV1Schema = z
  .object({
    accountId: z.uuid(),
    accessBasis: AccessBasisV1Schema.optional(),
    access: z
      .object({
        status: z.enum(["ELIGIBLE", "INELIGIBLE"]),
        reason: SubscriptionAccessReasonV1Schema.nullable(),
      })
      .strict(),
    subscription: z
      .object({
        id: z.uuid(),
        state: z.enum([
          "TRIAL",
          "ACTIVE",
          "GRACE",
          "PAST_DUE",
          "CANCELED",
          "EXPIRED",
          "SUSPENDED",
        ]),
        stateRevision: z.number().int().positive().safe(),
        plan: z
          .object({
            planRevisionId: z.uuid(),
            planCode: z.string().min(1),
            planRevision: z.number().int().positive().safe(),
            displayName: z.string(),
          })
          .strict(),
        price: z
          .object({
            priceRevisionId: z.uuid(),
            amountMinor: z.number().int().nonnegative().safe(),
            currency: z.string().regex(/^[A-Z]{3}$/),
            billingInterval: PublicCommercialBillingIntervalV1Schema,
          })
          .strict()
          .nullable(),
        currentPeriodStart: z.string().datetime({ offset: true }),
        currentPeriodEnd: z.string().datetime({ offset: true }),
        graceUntil: z.string().datetime({ offset: true }).nullable(),
        cancelAtPeriodEnd: z.boolean(),
      })
      .strict()
      .nullable(),
    deviceAllowance: z
      .object({
        maxActive: z.number().int().nonnegative().safe().nullable(),
        activeCount: z.number().int().nonnegative().safe(),
        remaining: z.number().int().nonnegative().safe().nullable(),
        overLimit: z.boolean(),
      })
      .strict(),
    billing: z
      .object({
        purchaseStatus: z.literal("UNAVAILABLE"),
        reason: z.literal("PAYMENT_GO_LIVE_DEFERRED"),
      })
      .strict(),
  })
  .strict();
export const PaymentHistoryQueryV1Schema = z
  .object({
    accountId: z.uuid(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.uuid().optional(),
  })
  .strict();
export const PaymentHistoryItemV1Schema = z
  .object({
    id: z.uuid(),
    state: z.enum([
      "PENDING",
      "SUCCEEDED",
      "FAILED",
      "CANCELED",
      "REFUNDED",
      "CHARGEBACK",
    ]),
    amountMinor: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    priceRevisionId: z.uuid(),
    plan: z
      .object({
        planCode: z.string().min(1),
        planRevision: z.number().int().positive().safe(),
        displayName: z.string(),
      })
      .strict()
      .nullable(),
    billingInterval: PublicCommercialBillingIntervalV1Schema.nullable(),
    createdAt: z.string().datetime({ offset: true }),
    confirmedAt: z.string().datetime({ offset: true }).nullable(),
    subscriptionLinked: z.boolean(),
  })
  .strict();
export const PaymentHistoryResponseV1Schema = z
  .object({
    payments: z.array(PaymentHistoryItemV1Schema),
    nextCursor: z.uuid().nullable(),
  })
  .strict();

/** Frozen P3.1 control-plane bootstrap wire-contract identifiers. */
export const ControlPlaneContractVersionV1Schema =
  z.literal("control_plane_v1");
/** I1-SRV.1 is a breaking signed-payload change and uses an explicit v2. */
export const ControlPlaneContractVersionV2Schema =
  z.literal("control_plane_v2");
export const ControlPlaneContractVersionSchema = z.union([
  ControlPlaneContractVersionV1Schema,
  ControlPlaneContractVersionV2Schema,
]);
export const BootstrapSnapshotVersionV1Schema = z.literal(
  "bootstrap_snapshot_v1",
);
export const BootstrapSnapshotVersionV2Schema = z.literal(
  "bootstrap_snapshot_v2",
);
export const BootstrapEnvelopeVersionV1Schema = z.literal(
  "bootstrap_envelope_v1",
);
export const BootstrapEnvelopeVersionV2Schema = z.literal(
  "bootstrap_envelope_v2",
);

const IsoTimestampV1Schema = z.string().datetime({ offset: true });

const BootstrapRequestShape = {
  extensionVersion: SemVerV1Schema,
  browser: z
    .object({
      family: z.enum(["chrome", "yandex_chromium"]),
      version: z.string().min(1).max(64),
    })
    .strict(),
  deviceId: z.uuid(),
  lastConfigVersion: z.number().int().min(0).nullable(),
  detectedAi: z
    .object({
      family: StableMachineIdentifierV1Schema,
      surface: StableMachineIdentifierV1Schema,
      variant: StableMachineIdentifierV1Schema.nullable().optional(),
    })
    .strict()
    .optional(),
};
export const BootstrapRequestV1Schema = z
  .object({
    contractVersion: ControlPlaneContractVersionV1Schema,
    ...BootstrapRequestShape,
  })
  .strict();
export type BootstrapRequestV1 = z.infer<typeof BootstrapRequestV1Schema>;
export const BootstrapRequestV2Schema = z
  .object({
    contractVersion: ControlPlaneContractVersionV2Schema,
    ...BootstrapRequestShape,
  })
  .strict();
export type BootstrapRequestV2 = z.infer<typeof BootstrapRequestV2Schema>;
export const BootstrapRequestSchema = z.discriminatedUnion("contractVersion", [
  BootstrapRequestV1Schema,
  BootstrapRequestV2Schema,
]);
export type BootstrapRequest = z.infer<typeof BootstrapRequestSchema>;

const EntitlementValueV1Schema = z.union([
  z.boolean(),
  z.number().int().safe(),
  StableMachineIdentifierV1Schema,
]);
const BoundedEntitlementMapV1Schema = z
  .record(StableMachineIdentifierV1Schema, EntitlementValueV1Schema)
  .refine((value) => Object.keys(value).length <= 128, "too many entitlements");
const BoundedFeatureMapV1Schema = z
  .record(StableMachineIdentifierV1Schema, z.boolean())
  .refine((value) => Object.keys(value).length <= 128, "too many features");

/**
 * P7.3 keeps the outer signed wire contract independent from the adapter
 * registry package. The registry applies detailed adapter_profile_v1 schemas
 * after envelope verification.
 */
const BootstrapAiJsonObjectV1Schema = z
  .record(z.string().min(1).max(128), z.json())
  .refine(
    (value) => Object.keys(value).length <= 128,
    "too many profile fields",
  );
export const BootstrapDetectedAiV1Schema = z
  .object({
    family: StableMachineIdentifierV1Schema,
    surface: StableMachineIdentifierV1Schema,
    variant: StableMachineIdentifierV1Schema.nullable(),
  })
  .strict();
const BootstrapAiUnavailableReasonV1Schema = z.enum([
  "UNSUPPORTED_DETECTED_AI",
  "AI_DISABLED",
  "NO_PROFILE",
  "PROFILE_INCOMPATIBLE",
]);
const BootstrapAiProfileV1Schema = z
  .object({
    profileKey: StableMachineIdentifierV1Schema,
    revision: z.number().int().positive(),
    scopeVariant: StableMachineIdentifierV1Schema.nullable(),
    schemaVersion: z.literal("adapter_profile_v1"),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    content: BootstrapAiJsonObjectV1Schema,
    compatibility: BootstrapAiJsonObjectV1Schema,
  })
  .strict();
export const BootstrapAiResolutionV1Schema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("UNCONFIGURED") }).strict(),
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      detected: BootstrapDetectedAiV1Schema,
      reason: BootstrapAiUnavailableReasonV1Schema,
    })
    .strict(),
  z
    .object({
      status: z.literal("RESOLVED"),
      detected: BootstrapDetectedAiV1Schema,
      profile: BootstrapAiProfileV1Schema,
    })
    .strict(),
]);
export type BootstrapDetectedAiV1 = z.infer<typeof BootstrapDetectedAiV1Schema>;
export type BootstrapAiUnavailableReasonV1 = z.infer<
  typeof BootstrapAiUnavailableReasonV1Schema
>;
export type BootstrapAiResolutionV1 = z.infer<
  typeof BootstrapAiResolutionV1Schema
>;
const SubscriptionV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("NONE"), planRevision: z.null() }).strict(),
  z
    .object({
      state: z.enum([
        "TRIAL",
        "ACTIVE",
        "GRACE",
        "PAST_DUE",
        "CANCELED",
        "EXPIRED",
        "SUSPENDED",
      ]),
      planRevision: StableMachineIdentifierV1Schema,
    })
    .strict(),
]);

const BootstrapSnapshotPayloadShape = {
  configVersion: z.number().int().positive(),
  issuedAt: IsoTimestampV1Schema,
  expiresAt: IsoTimestampV1Schema,
  offlineGraceUntil: IsoTimestampV1Schema,
  serverTime: IsoTimestampV1Schema,
  accessBasis: AccessBasisV1Schema.optional(),
  subscription: SubscriptionV1Schema,
  // The pre-P4 device limit is an internal device-management rule.  It is
  // deliberately not part of the frozen bootstrap snapshot wire format.
  devicePolicy: z.object({ status: z.literal("ACTIVE") }).strict(),
  compatibility: z
    .object({
      extension: z
        .object({
          status: z.enum([
            "SUPPORTED",
            "UPDATE_RECOMMENDED",
            "UPDATE_REQUIRED",
          ]),
          minimumVersion: SemVerV1Schema.nullable(),
        })
        .strict(),
      browser: z
        .object({
          status: z.enum(["SUPPORTED", "UNSUPPORTED_BROWSER", "MAINTENANCE"]),
        })
        .strict(),
    })
    .strict(),
  entitlements: BoundedEntitlementMapV1Schema,
  features: BoundedFeatureMapV1Schema,
  ai: BootstrapAiResolutionV1Schema,
};
const validateBootstrapSnapshotTimes = (
  value: {
    issuedAt: string;
    expiresAt: string;
    offlineGraceUntil: string;
    serverTime: string;
  },
  context: z.RefinementCtx,
) => {
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const offlineGraceUntil = Date.parse(value.offlineGraceUntil);
  const serverTime = Date.parse(value.serverTime);
  if (issuedAt > serverTime)
    context.addIssue({
      code: "custom",
      path: ["serverTime"],
      message: "issuedAt must be at or before serverTime",
    });
  if (issuedAt >= expiresAt)
    context.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "expiresAt must be after issuedAt",
    });
  if (expiresAt >= offlineGraceUntil)
    context.addIssue({
      code: "custom",
      path: ["offlineGraceUntil"],
      message: "offlineGraceUntil must be after expiresAt",
    });
};
export const BootstrapSnapshotPayloadV1Schema = z
  .object({
    snapshotVersion: BootstrapSnapshotVersionV1Schema,
    contractVersion: ControlPlaneContractVersionV1Schema,
    account: z.object({ status: z.literal("ACTIVE") }).strict(),
    ...BootstrapSnapshotPayloadShape,
  })
  .strict()
  .superRefine(validateBootstrapSnapshotTimes);
export type BootstrapSnapshotPayloadV1 = z.infer<
  typeof BootstrapSnapshotPayloadV1Schema
>;
export const BootstrapSnapshotPayloadV2Schema = z
  .object({
    snapshotVersion: BootstrapSnapshotVersionV2Schema,
    contractVersion: ControlPlaneContractVersionV2Schema,
    account: z.object({ id: z.uuid(), status: z.literal("ACTIVE") }).strict(),
    ...BootstrapSnapshotPayloadShape,
  })
  .strict()
  .superRefine(validateBootstrapSnapshotTimes);
export type BootstrapSnapshotPayloadV2 = z.infer<
  typeof BootstrapSnapshotPayloadV2Schema
>;
export const BootstrapSnapshotPayloadSchema = z.union([
  BootstrapSnapshotPayloadV1Schema,
  BootstrapSnapshotPayloadV2Schema,
]);
export type BootstrapSnapshotPayload = z.infer<
  typeof BootstrapSnapshotPayloadSchema
>;

export const SignedBootstrapEnvelopeV1Schema = z
  .object({
    envelopeVersion: BootstrapEnvelopeVersionV1Schema,
    algorithm: z.literal("Ed25519"),
    keyId: StableMachineIdentifierV1Schema,
    payload: z
      .string()
      .min(1)
      .max(32_768)
      .regex(/^[A-Za-z0-9_-]+$/),
    signature: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict()
  .describe(
    "Ed25519-signed bootstrap snapshot; the verified canonical payload carries the P7.3 AI union.",
  );
export type SignedBootstrapEnvelopeV1 = z.infer<
  typeof SignedBootstrapEnvelopeV1Schema
>;
export const SignedBootstrapEnvelopeV2Schema = z
  .object({
    envelopeVersion: BootstrapEnvelopeVersionV2Schema,
    algorithm: z.literal("Ed25519"),
    keyId: StableMachineIdentifierV1Schema,
    payload: z
      .string()
      .min(1)
      .max(32_768)
      .regex(/^[A-Za-z0-9_-]+$/),
    signature: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export type SignedBootstrapEnvelopeV2 = z.infer<
  typeof SignedBootstrapEnvelopeV2Schema
>;
export const SignedBootstrapEnvelopeSchema = z.union([
  SignedBootstrapEnvelopeV1Schema,
  SignedBootstrapEnvelopeV2Schema,
]);
export type SignedBootstrapEnvelope = z.infer<
  typeof SignedBootstrapEnvelopeSchema
>;

/**
 * B1 is a separate signed read-only transport. It intentionally does not
 * extend either strict Bootstrap snapshot; old V1/V2 clients therefore keep
 * receiving and parsing their original byte shapes.
 */
export const HealthTransportVersionV1Schema = z.literal("health_transport_v1");
export const HealthEnvelopeVersionV1Schema = z.literal("health_envelope_v1");
export const HealthClaimVersionV1Schema = z.literal("health_claim_v1");
export const HealthTargetV1Schema = z.literal("WORK");
export const HealthDecisionReasonV1Schema = z.enum([
  "PRODUCER_UNAVAILABLE",
  "PRODUCER_DENIED",
  "PROVENANCE_MISSING",
  "STALE_OBSERVATION",
  "INVALID_CONTEXT",
  "AI_UNAVAILABLE",
]);
const HealthAiBindingV1Schema = z
  .object({
    family: StableMachineIdentifierV1Schema,
    surface: StableMachineIdentifierV1Schema,
    variant: StableMachineIdentifierV1Schema.nullable(),
    profileKey: StableMachineIdentifierV1Schema,
    revision: z.number().int().positive().safe(),
    scopeVariant: StableMachineIdentifierV1Schema.nullable(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export const HealthContextBindingV1Schema = z
  .object({
    accountId: z.uuid(),
    contractVersion: ControlPlaneContractVersionV2Schema,
    configVersion: z.number().int().positive().safe(),
    ai: HealthAiBindingV1Schema,
  })
  .strict();
export type HealthContextBindingV1 = z.infer<
  typeof HealthContextBindingV1Schema
>;
const HealthPassClaimV1Schema = z
  .object({
    healthClaimVersion: HealthClaimVersionV1Schema,
    status: z.literal("PASS"),
    target: HealthTargetV1Schema,
    context: HealthContextBindingV1Schema,
    observedAt: IsoTimestampV1Schema,
    expiresAt: IsoTimestampV1Schema,
    executionAuthority: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.observedAt) >= Date.parse(value.expiresAt))
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Health PASS must expire after observation",
      });
  });
const HealthNegativeClaimV1Schema = z.discriminatedUnion("status", [
  z
    .object({
      healthClaimVersion: HealthClaimVersionV1Schema,
      status: z.literal("DENY"),
      target: HealthTargetV1Schema,
      reason: HealthDecisionReasonV1Schema,
      observedAt: IsoTimestampV1Schema,
      executionAuthority: z.literal(false),
    })
    .strict(),
  z
    .object({
      healthClaimVersion: HealthClaimVersionV1Schema,
      status: z.literal("UNAVAILABLE"),
      target: HealthTargetV1Schema,
      reason: HealthDecisionReasonV1Schema,
      observedAt: IsoTimestampV1Schema,
      executionAuthority: z.literal(false),
    })
    .strict(),
]);
export const HealthClaimV1Schema = z.union([
  HealthPassClaimV1Schema,
  HealthNegativeClaimV1Schema,
]);
export type HealthClaimV1 = z.infer<typeof HealthClaimV1Schema>;
export const HealthAuthorityRequestV1Schema = z
  .object({
    healthTransportVersion: HealthTransportVersionV1Schema,
    bootstrap: BootstrapRequestV2Schema,
  })
  .strict();
export type HealthAuthorityRequestV1 = z.infer<
  typeof HealthAuthorityRequestV1Schema
>;
export const SignedHealthEnvelopeV1Schema = z
  .object({
    healthEnvelopeVersion: HealthEnvelopeVersionV1Schema,
    algorithm: z.literal("Ed25519"),
    keyId: StableMachineIdentifierV1Schema,
    payload: z
      .string()
      .min(1)
      .max(32_768)
      .regex(/^[A-Za-z0-9_-]+$/),
    signature: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
export type SignedHealthEnvelopeV1 = z.infer<
  typeof SignedHealthEnvelopeV1Schema
>;

/** P6.2 admin read/support/principal-management contracts. */
const AdminUuid = z.uuid();
const AdminLimit = z.coerce.number().int().min(1).max(100).optional();
const AdminCursor = AdminUuid.optional();
const AdminStatus = z.enum(["ACTIVE", "SUSPENDED"]);
const AdminRoleV1Schema = z.enum([
  "ADMIN_OWNER",
  "ADMIN_OPS",
  "ADMIN_SUPPORT",
  "ADMIN_BILLING_READONLY",
]);
const AdminBoundedMachineString = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
export const AdminReasonV1Schema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) =>
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    }),
  )
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(256));
export const AdminAccountsQueryV1Schema = z
  .object({
    accountId: AdminUuid.optional(),
    ownerUserId: AdminUuid.optional(),
    ownerEmail: z.string().min(1).max(320).optional(),
    status: AdminStatus.optional(),
    limit: AdminLimit,
    cursor: AdminCursor,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      [value.accountId, value.ownerUserId, value.ownerEmail].filter(Boolean)
        .length > 1
    )
      context.addIssue({
        code: "custom",
        message: "account filters are mutually exclusive",
      });
  });
export const AdminUsersQueryV1Schema = z
  .object({
    userId: AdminUuid.optional(),
    email: z.string().min(1).max(320).optional(),
    status: AdminStatus.optional(),
    limit: AdminLimit,
    cursor: AdminCursor,
  })
  .strict()
  .refine(
    (value) => !(value.userId && value.email),
    "user filters are mutually exclusive",
  );
export const AdminAccountParamsV1Schema = z
  .object({ account_id: AdminUuid })
  .strict();
export const AdminDeviceParamsV1Schema = z
  .object({ account_id: AdminUuid, device_id: AdminUuid })
  .strict();
export const AdminDeviceQueryV1Schema = z
  .object({
    status: z.enum(["ACTIVE", "REVOKED"]).optional(),
    limit: AdminLimit,
    cursor: AdminCursor,
  })
  .strict();
export const AdminAuditEventsQueryV1Schema = z
  .object({
    action: AdminBoundedMachineString.optional(),
    targetType: AdminBoundedMachineString.optional(),
    targetId: AdminUuid.optional(),
    actorType: AdminBoundedMachineString.optional(),
    actorId: AdminUuid.optional(),
    correlationId: AdminBoundedMachineString.optional(),
    limit: AdminLimit,
    cursor: AdminCursor,
  })
  .strict();
export const AdminPrincipalsQueryV1Schema = z
  .object({
    principalId: AdminUuid.optional(),
    userId: AdminUuid.optional(),
    status: AdminStatus.optional(),
    role: AdminRoleV1Schema.optional(),
    limit: AdminLimit,
    cursor: AdminCursor,
  })
  .strict();
export const AdminPrincipalCreateBodyV1Schema = z
  .object({
    userId: AdminUuid,
    initialRole: AdminRoleV1Schema,
    reason: AdminReasonV1Schema,
  })
  .strict();
export const AdminPrincipalRoleParamsV1Schema = z
  .object({ principal_id: AdminUuid, role: AdminRoleV1Schema })
  .strict();
export const AdminPrincipalMutationParamsV1Schema = z
  .object({ principal_id: AdminUuid })
  .strict();
export const AdminPrincipalMutationBodyV1Schema = z
  .object({
    expectedRevision: z.number().int().positive().safe(),
    reason: AdminReasonV1Schema,
  })
  .strict();
export const AdminDeviceRevokeBodyV1Schema = z
  .object({ reason: AdminReasonV1Schema })
  .strict();

const AdminPage = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: AdminUuid.nullable() }).strict();
export const AdminAccountItemV1Schema = z
  .object({
    id: AdminUuid,
    status: AdminStatus,
    displayName: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const AdminAccountsResponseV1Schema = AdminPage(
  AdminAccountItemV1Schema,
);
export const AdminUserEmailV1Schema = z
  .object({
    email: z.string().email(),
    verifiedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export const AdminUserItemV1Schema = z
  .object({
    id: AdminUuid,
    status: AdminStatus,
    emails: z.array(AdminUserEmailV1Schema),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const AdminUsersResponseV1Schema = AdminPage(AdminUserItemV1Schema);
export const AdminDeviceItemV1Schema = DeviceListItemV1Schema.strict();
export const AdminDevicesResponseV1Schema = AdminPage(AdminDeviceItemV1Schema);
export const AdminSubscriptionResponseV1Schema = z
  .object({
    accountId: AdminUuid,
    accessBasis: AccessBasisV1Schema.optional(),
    access: z
      .object({
        status: z.enum(["ELIGIBLE", "INELIGIBLE"]),
        reason: SubscriptionAccessReasonV1Schema.nullable(),
      })
      .strict(),
    subscription: SubscriptionResponseV1Schema.shape.subscription,
    deviceAllowance: SubscriptionResponseV1Schema.shape.deviceAllowance,
  })
  .strict();
export const AdminDeviceRevokeResponseV1Schema = z
  .object({
    status: z.literal("revoked"),
    deviceId: AdminUuid,
    idempotent: z.boolean(),
  })
  .strict();
export const AdminAuditEventItemV1Schema = z
  .object({
    id: AdminUuid,
    actorType: z.string().min(1),
    actorId: AdminUuid.nullable(),
    action: z.string().min(1),
    targetType: z.string().min(1),
    targetId: AdminUuid.nullable(),
    correlationId: CorrelationIdV1Schema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const AdminAuditEventsResponseV1Schema = AdminPage(
  AdminAuditEventItemV1Schema,
);
export const AdminPrincipalItemV1Schema = z
  .object({
    principalId: AdminUuid,
    userId: AdminUuid,
    status: AdminStatus,
    revision: z.number().int().positive().safe(),
    roles: z.array(AdminRoleV1Schema),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const AdminPrincipalsResponseV1Schema = AdminPage(
  AdminPrincipalItemV1Schema,
);
export const AdminPrincipalMutationResponseV1Schema =
  AdminPrincipalItemV1Schema;
export const AdminPrincipalStatusResponseV1Schema = z
  .object({ changed: z.boolean(), principal: AdminPrincipalItemV1Schema })
  .strict();

/** P6.3 admin subscription operations and account-scoped billing reads. */
export const AdminBillingQueryV1Schema = z
  .object({ limit: AdminLimit, cursor: AdminCursor })
  .strict();
export const AdminSubscriptionResourceParamsV1Schema = z
  .object({ account_id: AdminUuid, subscription_id: AdminUuid })
  .strict();
export const AdminSubscriptionGrantBodyV1Schema = z
  .object({
    planRevisionId: AdminUuid,
    currentPeriodEnd: z.string().datetime({ offset: true }),
    reason: AdminReasonV1Schema,
  })
  .strict();
export const AdminSubscriptionMutationBodyV1Schema = z
  .object({
    expectedStateRevision: z.number().int().positive().safe(),
    reason: AdminReasonV1Schema,
  })
  .strict();
export const AdminSubscriptionExtendBodyV1Schema = z
  .object({
    expectedStateRevision: z.number().int().positive().safe(),
    newCurrentPeriodEnd: z.string().datetime({ offset: true }),
    reason: AdminReasonV1Schema,
  })
  .strict();
const AdminSubscriptionStateV1Schema = z.enum([
  "TRIAL",
  "ACTIVE",
  "GRACE",
  "PAST_DUE",
  "CANCELED",
  "EXPIRED",
  "SUSPENDED",
]);
export const AdminSubscriptionMutationResponseV1Schema = z
  .object({
    status: z.literal("applied"),
    changed: z.boolean(),
    subscription: z
      .object({
        id: AdminUuid,
        accountId: AdminUuid,
        state: AdminSubscriptionStateV1Schema,
        stateRevision: z.number().int().positive().safe(),
        planRevisionId: AdminUuid,
        boundPriceRevisionId: AdminUuid.nullable(),
        currentPeriodStart: z.string().datetime({ offset: true }),
        currentPeriodEnd: z.string().datetime({ offset: true }),
        graceUntil: z.string().datetime({ offset: true }).nullable(),
        cancelAtPeriodEnd: z.boolean(),
        suspendedAt: z.string().datetime({ offset: true }).nullable(),
        updatedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();
export const AdminPaymentItemV1Schema = z
  .object({
    id: AdminUuid,
    subscriptionId: AdminUuid.nullable(),
    state: z.enum([
      "PENDING",
      "SUCCEEDED",
      "FAILED",
      "CANCELED",
      "REFUNDED",
      "CHARGEBACK",
    ]),
    priceRevisionId: AdminUuid,
    amountMinor: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    plan: z
      .object({
        planRevisionId: AdminUuid,
        planCode: z.string().min(1),
        planRevision: z.number().int().positive().safe(),
        displayName: z.string(),
      })
      .strict()
      .nullable(),
    billingInterval: PublicCommercialBillingIntervalV1Schema.nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    confirmedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export const AdminPaymentsResponseV1Schema = AdminPage(
  AdminPaymentItemV1Schema,
);
export const AdminBillingEventItemV1Schema = z
  .object({
    id: AdminUuid,
    source: z.enum(["WEBHOOK", "RECONCILIATION"]),
    eventType: z.string().min(1),
    processingState: z.enum(["VERIFIED", "APPLIED", "IGNORED", "FAILED"]),
    paymentId: AdminUuid.nullable(),
    subscriptionId: AdminUuid.nullable(),
    failureCode: z.string().min(1).nullable(),
    receivedAt: z.string().datetime({ offset: true }),
    verifiedAt: z.string().datetime({ offset: true }),
    processedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const AdminBillingEventsResponseV1Schema = AdminPage(
  AdminBillingEventItemV1Schema,
);
export const AdminReconciliationJobItemV1Schema = z
  .object({
    paymentId: AdminUuid,
    state: z.enum(["READY", "LEASED", "SETTLED", "BLOCKED"]),
    nextAttemptAt: z.string().datetime({ offset: true }).nullable(),
    leaseUntil: z.string().datetime({ offset: true }).nullable(),
    attemptCount: z.number().int().nonnegative().safe(),
    lastResultCode: z.string().min(1).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const AdminReconciliationJobsResponseV1Schema = AdminPage(
  AdminReconciliationJobItemV1Schema,
);
