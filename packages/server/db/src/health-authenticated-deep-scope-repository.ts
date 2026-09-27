import {
  ProfileCompatibilityConstraintsV1Schema,
  validateProfileContent,
} from "@product/adapter-registry";
import { HealthScopeSchema, type HealthScope } from "@product/health";
import { compareSemVerV1 } from "@product/shared";
import type { DatabaseRuntime } from "./index.js";

export const AUTHENTICATED_DEEP_HEALTH_CATALOG_AUTHORITY = Object.freeze({
  CHATGPT_STANDARD: Object.freeze({
    targetKey: "chatgpt_standard_health",
    adapterMachineKey: "chatgpt",
    surfaceMachineKey: "standard",
    profileMachineKey: "standard-h3",
    packagedProfileId: "CHATGPT_STANDARD_H3_V2",
    packagedProfileRevision: 2,
  }),
  CHATGPT_WORK: Object.freeze({
    targetKey: "chatgpt_work_health",
    adapterMachineKey: "chatgpt",
    surfaceMachineKey: "work",
    profileMachineKey: "work-h3",
    packagedProfileId: "CHATGPT_WORK_H3_V1",
    packagedProfileRevision: 1,
  }),
});

export type AuthenticatedDeepHealthSurface =
  keyof typeof AUTHENTICATED_DEEP_HEALTH_CATALOG_AUTHORITY;

export type AuthenticatedDeepHealthScopeResolutionInput = Readonly<
  Pick<
    HealthScope,
    | "browserFamily"
    | "browserVersion"
    | "extensionVersion"
    | "adapterEngineVersion"
    | "healthSuite"
  > & {
    surface: AuthenticatedDeepHealthSurface;
  }
>;

type IdentityRow = {
  id: string;
  status: string;
};

type ProfileRow = IdentityRow & {
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
};

type RevisionRow = {
  id: string;
  revision: number;
  state: string;
  content: unknown;
  compatibility: unknown;
  contentSha256: string;
};

function exactIdentity<T>(
  rows: readonly T[],
  missingCode: string,
  ambiguousCode: string,
): T {
  if (rows.length === 0) throw new Error(missingCode);
  if (rows.length !== 1) throw new Error(ambiguousCode);
  return rows[0]!;
}

function compareDottedNumericVersion(left: string, right: string): number {
  const l = left.split(".").map(Number);
  const r = right.split(".").map(Number);
  for (let index = 0; index < Math.max(l.length, r.length); index += 1) {
    const delta = (l[index] ?? 0) - (r[index] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

function revisionIsCompatible(
  row: RevisionRow,
  input: AuthenticatedDeepHealthScopeResolutionInput,
): boolean {
  let validated: ReturnType<typeof validateProfileContent>;
  try {
    validated = validateProfileContent({
      content: row.content,
      compatibility: row.compatibility,
    });
  } catch {
    throw new Error("AUTHENTICATED_DEEP_PROFILE_REVISION_CONTENT_INVALID");
  }
  if (validated.contentSha256 !== row.contentSha256)
    throw new Error("AUTHENTICATED_DEEP_PROFILE_REVISION_CHECKSUM_MISMATCH");

  const compatibility = ProfileCompatibilityConstraintsV1Schema.parse(
    validated.compatibility,
  );
  if (!compatibility.browserFamilies.includes(input.browserFamily))
    return false;

  const minimumBrowser = compatibility.minimumBrowserVersions.find(
    (candidate) => candidate.browserFamily === input.browserFamily,
  );
  if (
    minimumBrowser &&
    compareDottedNumericVersion(
      input.browserVersion,
      minimumBrowser.minimumVersion,
    ) < 0
  ) {
    return false;
  }
  if (
    compatibility.minimumExtensionVersion &&
    compareSemVerV1(
      input.extensionVersion,
      compatibility.minimumExtensionVersion,
    ) < 0
  ) {
    return false;
  }
  return true;
}

export function createHealthAuthenticatedDeepScopeRepository(
  runtime: Pick<DatabaseRuntime, "query">,
) {
  return {
    async resolveAuthenticatedDeepHealthScope(
      input: AuthenticatedDeepHealthScopeResolutionInput,
    ): Promise<HealthScope> {
      const authority =
        AUTHENTICATED_DEEP_HEALTH_CATALOG_AUTHORITY[input.surface];
      if (!authority)
        throw new Error("AUTHENTICATED_DEEP_SURFACE_AUTHORITY_UNSUPPORTED");

      const adapters = await runtime.query<IdentityRow>(
        "SELECT id,status FROM ai_adapters WHERE machine_key=$1",
        [authority.adapterMachineKey],
      );
      const adapter = exactIdentity(
        adapters.rows,
        "AUTHENTICATED_DEEP_PROVIDER_AUTHORITY_NOT_FOUND",
        "AUTHENTICATED_DEEP_PROVIDER_AUTHORITY_AMBIGUOUS",
      );
      if (adapter.status !== "ACTIVE")
        throw new Error("AUTHENTICATED_DEEP_PROVIDER_AUTHORITY_INACTIVE");

      const surfaces = await runtime.query<IdentityRow>(
        "SELECT id,status FROM ai_surfaces WHERE adapter_id=$1 AND machine_key=$2",
        [adapter.id, authority.surfaceMachineKey],
      );
      const surface = exactIdentity(
        surfaces.rows,
        "AUTHENTICATED_DEEP_SURFACE_AUTHORITY_NOT_FOUND",
        "AUTHENTICATED_DEEP_SURFACE_AUTHORITY_AMBIGUOUS",
      );
      if (surface.status !== "ACTIVE")
        throw new Error("AUTHENTICATED_DEEP_SURFACE_AUTHORITY_INACTIVE");

      const profiles = await runtime.query<ProfileRow>(
        'SELECT id,status,adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId" FROM adapter_profiles WHERE machine_key=$1',
        [authority.profileMachineKey],
      );
      const profile = exactIdentity(
        profiles.rows,
        "AUTHENTICATED_DEEP_PROFILE_AUTHORITY_NOT_FOUND",
        "AUTHENTICATED_DEEP_PROFILE_AUTHORITY_AMBIGUOUS",
      );
      if (
        profile.adapterId !== adapter.id ||
        profile.surfaceId !== surface.id ||
        profile.variantId !== null
      ) {
        throw new Error("AUTHENTICATED_DEEP_PROFILE_AUTHORITY_CONFLICT");
      }
      if (profile.status !== "ACTIVE")
        throw new Error("AUTHENTICATED_DEEP_PROFILE_AUTHORITY_INACTIVE");

      const revisions = await runtime.query<RevisionRow>(
        "SELECT id,revision,state,content,compatibility_constraints AS compatibility,content_sha256 AS \"contentSha256\" FROM adapter_profile_revisions WHERE profile_id=$1 AND adapter_id=$2 AND surface_id=$3 AND variant_id IS NULL AND state='PUBLISHED' ORDER BY revision",
        [profile.id, adapter.id, surface.id],
      );
      const compatible = revisions.rows.filter((row) =>
        revisionIsCompatible(row, input),
      );
      const revision = exactIdentity(
        compatible,
        "AUTHENTICATED_DEEP_PROFILE_REVISION_AUTHORITY_NOT_FOUND",
        "AUTHENTICATED_DEEP_PROFILE_REVISION_AUTHORITY_AMBIGUOUS",
      );
      if (revision.revision !== authority.packagedProfileRevision) {
        throw new Error(
          "AUTHENTICATED_DEEP_PACKAGED_PROFILE_REVISION_MISMATCH",
        );
      }

      return HealthScopeSchema.parse({
        adapterFamilyId: adapter.id,
        adapterFamilyKey: authority.adapterMachineKey,
        surfaceId: surface.id,
        surfaceKey: authority.surfaceMachineKey,
        variant: null,
        browserFamily: input.browserFamily,
        browserVersion: input.browserVersion,
        extensionVersion: input.extensionVersion,
        adapterEngineVersion: input.adapterEngineVersion,
        profile: { id: profile.id, revision: revision.revision },
        healthSuite: input.healthSuite,
      });
    },
  };
}
