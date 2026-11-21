import { z } from "zod";

// A public account UUID is not a connection credential.
export const ConnectionCredentialSummaryV1Schema = z
  .object({
    credentialId: z.uuid(),
    generation: z.number().int().positive(),
    createdAt: z.string().datetime(),
    active: z.boolean(),
  })
  .strict();
export const ConnectionCodeStatusQueryV1Schema = z
  .object({ accountId: z.uuid() })
  .strict();
export const ConnectionCodeStatusV1Schema = z
  .object({
    credential: ConnectionCredentialSummaryV1Schema.nullable(),
  })
  .strict();
export const ConnectionCodeIssueBodyV1Schema = z
  .object({
    accountId: z.uuid(),
    expectedGeneration: z.number().int().nonnegative(),
    mode: z.enum(["CREATE", "REPLACE_KEEP_DEVICES", "REPLACE_REVOKE_DEVICES"]),
  })
  .strict();
export const ConnectionCodeIssueResponseV1Schema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("created"),
        code: z.string().regex(/^octo1_[A-Za-z0-9_-]{43}$/),
        credential: ConnectionCredentialSummaryV1Schema,
        revokedDevices: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        status: z.literal("already_issued"),
        credential: ConnectionCredentialSummaryV1Schema,
      })
      .strict(),
  ],
);
export const ConnectionCodeExchangeBodyV1Schema = z
  .object({
    code: z.string().regex(/^octo1_[A-Za-z0-9_-]{43}$/),
    deviceLabel: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[^\p{Cc}]+$/u)
      .optional(),
  })
  .strict();
export const ConnectionCodeExchangeResponseV1Schema = z
  .object({
    status: z.literal("activated"),
    authenticationMethod: z.literal("ACCOUNT_CONNECTION_CODE"),
    accountId: z.uuid(),
    deviceId: z.uuid(),
    sessionId: z.uuid(),
    tokenType: z.literal("Bearer"),
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.string().datetime(),
    refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    refreshTokenExpiresAt: z.string().datetime(),
  })
  .strict();
export const ConnectionTransferDevicesV1Schema = z
  .object({
    devices: z.array(
      z
        .object({
          deviceId: z.uuid(),
          label: z.string().nullable(),
          createdAt: z.string().datetime(),
          approvedAt: z.string().datetime().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export const ConnectionTransferApprovalBodyV1Schema = z
  .object({
    accountId: z.uuid(),
    deviceId: z.uuid(),
  })
  .strict();
export const ConnectionTransferApprovalResponseV1Schema = z
  .object({
    status: z.literal("approved"),
    deviceId: z.uuid(),
    approvedAt: z.string().datetime(),
  })
  .strict();
