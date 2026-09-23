import {
  BrowserFamilies,
  compareSemVerV1,
  SemVerV1Schema,
  StableMachineIdentifierV1Schema,
  type BrowserFamily,
} from "@product/shared";
import { z } from "zod";

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const BrowserFamilySchema = z.enum(BrowserFamilies);
const TimestampSchema = z.date();
export const ReleaseChannelSchema = StableMachineIdentifierV1Schema;
export const ContractVersionSchema = z.enum([
  "control_plane_v1",
  "control_plane_v2",
]);
export type ContractVersion = z.infer<typeof ContractVersionSchema>;
export type { BrowserFamily };
export const ExtensionReleaseSchema = z
  .object({
    id: z.uuid(),
    version: SemVerV1Schema,
    releaseChannel: ReleaseChannelSchema,
    artifactSha256: HashSchema.nullable(),
    releasedAt: TimestampSchema,
    createdAt: TimestampSchema,
  })
  .strict();
export const ReleaseContractSupportSchema = z
  .object({ releaseId: z.uuid(), contractVersion: ContractVersionSchema })
  .strict();
export const ReleaseBrowserSupportSchema = z
  .object({ releaseId: z.uuid(), browserFamily: BrowserFamilySchema })
  .strict();
export const CompatibilityPolicyRevisionSchema = z
  .object({
    id: z.uuid(),
    policyKey: StableMachineIdentifierV1Schema,
    revision: z.number().int().positive(),
    contractVersion: ContractVersionSchema,
    browserFamily: BrowserFamilySchema.nullable(),
    minimumExtensionVersion: SemVerV1Schema.nullable(),
    recommendedExtensionVersion: SemVerV1Schema.nullable(),
    minimumBrowserVersion: z.string().min(1).max(64).nullable(),
    maintenanceMode: z.boolean(),
    maintenanceCode: StableMachineIdentifierV1Schema.nullable(),
    publishedAt: TimestampSchema,
    createdAt: TimestampSchema,
  })
  .strict();
export const BlockedExtensionVersionSchema = z
  .object({ policyRevisionId: z.uuid(), extensionVersion: SemVerV1Schema })
  .strict();
export type ExtensionRelease = z.infer<typeof ExtensionReleaseSchema>;
export type ReleaseContractSupport = z.infer<
  typeof ReleaseContractSupportSchema
>;
export type ReleaseBrowserSupport = z.infer<typeof ReleaseBrowserSupportSchema>;
export type CompatibilityPolicyRevision = z.infer<
  typeof CompatibilityPolicyRevisionSchema
>;
export type BlockedExtensionVersion = z.infer<
  typeof BlockedExtensionVersionSchema
>;
export interface CompatibilityCatalogRepository {
  findExtensionRelease(version: string): Promise<ExtensionRelease | undefined>;
  listReleaseContracts(releaseId: string): Promise<ReleaseContractSupport[]>;
  listReleaseBrowsers(releaseId: string): Promise<ReleaseBrowserSupport[]>;
  listCompatibilityPolicyRevisions(
    contractVersion: ContractVersion,
  ): Promise<CompatibilityPolicyRevision[]>;
  listBlockedVersions(
    policyRevisionId: string,
  ): Promise<BlockedExtensionVersion[]>;
}

/** P3.3 internal-only command context.  It deliberately is not an RBAC model. */
export const P3MutationContextSchema = z
  .object({
    correlationId: z.string().min(1).max(128),
    actorType: z.literal("SYSTEM"),
    actorId: z.uuid().optional(),
    reason: z.string().min(1).max(512).optional(),
  })
  .strict();
export type P3MutationContext = z.infer<typeof P3MutationContextSchema>;
export const CompatibilityMutationContextSchema = z.discriminatedUnion(
  "actorType",
  [
    P3MutationContextSchema,
    z
      .object({
        actorType: z.literal("ADMIN"),
        actorId: z.uuid(),
        correlationId: z.string().min(1).max(128),
        reason: z.string().min(1).max(512),
      })
      .strict(),
  ],
);
export type CompatibilityMutationContext = z.infer<
  typeof CompatibilityMutationContextSchema
>;
export const PublishExtensionReleaseCommandSchema = z
  .object({
    version: SemVerV1Schema,
    releaseChannel: ReleaseChannelSchema,
    artifactSha256: HashSchema.optional(),
    releasedAt: TimestampSchema,
    supportedContracts: z.array(ContractVersionSchema).min(1),
    supportedBrowsers: z.array(BrowserFamilySchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.supportedContracts).size !== value.supportedContracts.length
    )
      ctx.addIssue({ code: "custom", message: "duplicate contract" });
    if (
      new Set(value.supportedBrowsers).size !== value.supportedBrowsers.length
    )
      ctx.addIssue({ code: "custom", message: "duplicate browser" });
  });
export type PublishExtensionReleaseCommand = z.infer<
  typeof PublishExtensionReleaseCommandSchema
>;
export const PublishCompatibilityPolicyRevisionCommandSchema = z
  .object({
    policyKey: StableMachineIdentifierV1Schema,
    contractVersion: ContractVersionSchema,
    browserFamily: BrowserFamilySchema.nullable(),
    minimumExtensionVersion: SemVerV1Schema.nullable(),
    recommendedExtensionVersion: SemVerV1Schema.nullable(),
    minimumBrowserVersion: z.string().min(1).max(64).nullable(),
    maintenanceMode: z.boolean(),
    maintenanceCode: StableMachineIdentifierV1Schema.nullable(),
    blockedVersions: z.array(SemVerV1Schema),
    publishedAt: TimestampSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.browserFamily === null && v.minimumBrowserVersion !== null)
      ctx.addIssue({ code: "custom", message: "global browser minimum" });
    if (v.maintenanceMode !== (v.maintenanceCode !== null))
      ctx.addIssue({ code: "custom", message: "maintenance code invariant" });
    if (
      v.minimumExtensionVersion &&
      v.recommendedExtensionVersion &&
      compareSemVerV1(
        v.recommendedExtensionVersion,
        v.minimumExtensionVersion,
      ) < 0
    )
      ctx.addIssue({ code: "custom", message: "recommended before minimum" });
    if (new Set(v.blockedVersions).size !== v.blockedVersions.length)
      ctx.addIssue({ code: "custom", message: "duplicate blocked version" });
    if (
      v.minimumBrowserVersion &&
      compareBrowserVersionV1(
        v.minimumBrowserVersion,
        v.minimumBrowserVersion,
      ) === undefined
    )
      ctx.addIssue({ code: "custom", message: "invalid browser version" });
  });
export type PublishCompatibilityPolicyRevisionCommand = z.infer<
  typeof PublishCompatibilityPolicyRevisionCommandSchema
>;
export interface CompatibilityPublicationPort {
  publishExtensionRelease(
    command: PublishExtensionReleaseCommand,
    context: CompatibilityMutationContext,
  ): Promise<ExtensionRelease>;
  publishCompatibilityPolicyRevision(
    command: PublishCompatibilityPolicyRevisionCommand,
    context: CompatibilityMutationContext,
  ): Promise<CompatibilityPolicyRevision>;
}

export function compareBrowserVersionV1(
  a: string,
  b: string,
): -1 | 0 | 1 | undefined {
  const parse = (value: string): number[] | undefined => {
    const parts = value.split(".");
    if (
      parts.length < 1 ||
      parts.length > 4 ||
      parts.some((part) => !/^(?:0|[1-9]\d*)$/.test(part))
    )
      return undefined;
    const numbers = parts.map(Number);
    return numbers.some((n) => n > 2147483647)
      ? undefined
      : [...numbers, ...Array(4 - numbers.length).fill(0)];
  };
  const x = parse(a),
    y = parse(b);
  if (!x || !y) return undefined;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

export type CompatibilityResolution = {
  extension: "SUPPORTED" | "UPDATE_RECOMMENDED" | "UPDATE_REQUIRED";
  browser: "SUPPORTED" | "UNSUPPORTED_BROWSER" | "MAINTENANCE";
  minimumVersion: string | null;
};
export type CompatibilityResolverInput = {
  contractVersion: ContractVersion;
  extensionVersion: string;
  browserFamily: BrowserFamily;
  browserVersion: string;
  release?: ExtensionRelease;
  releaseContracts: ReleaseContractSupport[];
  releaseBrowsers: ReleaseBrowserSupport[];
  policies: CompatibilityPolicyRevision[];
  blockedVersions: ReadonlyMap<string, readonly BlockedExtensionVersion[]>;
};
/** Pure, pinned-source resolver. Duplicate scope or corrupt source has no winner. */
export function resolveCompatibility(
  input: CompatibilityResolverInput,
): CompatibilityResolution | undefined {
  const applicable = input.policies.filter(
    (p) =>
      p.contractVersion === input.contractVersion &&
      (p.browserFamily === null || p.browserFamily === input.browserFamily),
  );
  const globals = applicable.filter((p) => p.browserFamily === null),
    exact = applicable.filter((p) => p.browserFamily === input.browserFamily);
  if (
    globals.length > 1 ||
    exact.length > 1 ||
    globals.some((p) => p.minimumBrowserVersion !== null)
  )
    return undefined;
  const all = [...globals, ...exact];
  if (
    all.some(
      (p) =>
        (p.maintenanceMode && !p.maintenanceCode) ||
        (!p.maintenanceMode && p.maintenanceCode),
    )
  )
    return undefined;
  const max = (values: (string | null)[]) =>
    values.reduce<string | null>(
      (result, value) =>
        !value || (result && compareSemVerV1(value, result) <= 0)
          ? result
          : value,
      null,
    );
  const minimum = max(all.map((p) => p.minimumExtensionVersion));
  const recommended = max(all.map((p) => p.recommendedExtensionVersion));
  if (minimum && recommended && compareSemVerV1(recommended, minimum) < 0)
    return undefined;
  const blocked = new Set(
    all
      .flatMap((p) => input.blockedVersions.get(p.id) ?? [])
      .map((v) => v.extensionVersion),
  );
  let extension: CompatibilityResolution["extension"] = "SUPPORTED";
  if (
    !input.release ||
    !input.releaseContracts.some(
      (x) => x.contractVersion === input.contractVersion,
    ) ||
    blocked.has(input.extensionVersion) ||
    (minimum && compareSemVerV1(input.extensionVersion, minimum) < 0)
  )
    extension = "UPDATE_REQUIRED";
  else if (
    recommended &&
    compareSemVerV1(input.extensionVersion, recommended) < 0
  )
    extension = "UPDATE_RECOMMENDED";
  const exactPolicy = exact[0];
  let browser: CompatibilityResolution["browser"] = "SUPPORTED";
  if (all.some((p) => p.maintenanceMode)) browser = "MAINTENANCE";
  else if (
    !input.release ||
    !input.releaseBrowsers.some((x) => x.browserFamily === input.browserFamily)
  )
    browser = "UNSUPPORTED_BROWSER";
  else if (
    exactPolicy?.minimumBrowserVersion &&
    (compareBrowserVersionV1(
      input.browserVersion,
      exactPolicy.minimumBrowserVersion,
    ) ?? -1) < 0
  )
    browser = "UNSUPPORTED_BROWSER";
  return { extension, browser, minimumVersion: minimum };
}
