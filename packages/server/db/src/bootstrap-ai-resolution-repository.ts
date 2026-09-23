import type { BrowserFamily } from "@product/shared";
import type { DatabaseRuntime } from "./index.js";

type JsonRecord = Record<string, unknown>;

type BootstrapAiAssignmentRevisionSnapshot = {
  revision: number;
  mode: string;
  baselineProfileRevisionId: string;
  candidateProfileRevisionId: string | null;
  percentageBps: number;
};

type BootstrapAiAssignmentSnapshot = {
  id: string;
  variantId: string | null;
  browserFamily: string;
  subjectKind: string;
  cohortSeed: Buffer;
  latest: BootstrapAiAssignmentRevisionSnapshot | null;
};

type BootstrapAiProfileSnapshot = {
  revisionId: string;
  profileId: string;
  profileKey: string;
  profileStatus: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  revision: number;
  schemaVersion: string;
  state: string;
  content: unknown;
  compatibility: unknown;
  contentSha256: string;
};

type BootstrapAiResolutionSnapshot = {
  hierarchy: {
    adapterId: string;
    adapterKey: string;
    adapterStatus: string;
    surfaceId: string;
    surfaceKey: string;
    surfaceStatus: string;
    variantId: string | null;
    variantKey: string | null;
    variantStatus: string | null;
  } | null;
  exactAssignment: BootstrapAiAssignmentSnapshot | null;
  defaultAssignment: BootstrapAiAssignmentSnapshot | null;
  profiles: BootstrapAiProfileSnapshot[];
};

interface BootstrapAiResolutionRepository {
  resolve(input: {
    family: string;
    surface: string;
    variant: string | null;
    browserFamily: BrowserFamily;
  }): Promise<BootstrapAiResolutionSnapshot>;
}

const resolutionSql = `
WITH hierarchy AS (
  SELECT
    a.id AS adapter_id,
    a.machine_key AS adapter_key,
    a.status AS adapter_status,
    s.id AS surface_id,
    s.machine_key AS surface_key,
    s.status AS surface_status,
    v.id AS variant_id,
    v.machine_key AS variant_key,
    v.status AS variant_status
  FROM ai_adapters a
  JOIN ai_surfaces s
    ON s.adapter_id = a.id AND s.machine_key = $2
  LEFT JOIN ai_variants v
    ON v.surface_id = s.id AND v.machine_key = $3
  WHERE a.machine_key = $1
), scopes AS (
  SELECT 'EXACT'::text AS scope_kind, a.*
  FROM adapter_profile_assignments a
  JOIN hierarchy h
    ON h.adapter_id = a.adapter_id
   AND h.surface_id = a.surface_id
   AND h.variant_id = a.variant_id
  WHERE $3::text IS NOT NULL
    AND a.browser_family = $4
  UNION ALL
  SELECT 'DEFAULT'::text AS scope_kind, a.*
  FROM adapter_profile_assignments a
  JOIN hierarchy h
    ON h.adapter_id = a.adapter_id
   AND h.surface_id = a.surface_id
  WHERE a.variant_id IS NULL
    AND a.browser_family = $4
), scope_latest AS (
  SELECT
    s.scope_kind,
    s.id,
    s.variant_id,
    s.browser_family,
    s.subject_kind,
    encode(s.cohort_seed, 'base64') AS cohort_seed,
    latest.revision AS latest_revision,
    latest.mode AS latest_mode,
    latest.baseline_profile_revision_id AS latest_baseline_profile_revision_id,
    latest.candidate_profile_revision_id AS latest_candidate_profile_revision_id,
    latest.percentage_bps AS latest_percentage_bps
  FROM scopes s
  LEFT JOIN LATERAL (
    SELECT
      r.revision,
      r.mode,
      r.baseline_profile_revision_id,
      r.candidate_profile_revision_id,
      r.percentage_bps
    FROM adapter_profile_assignment_revisions r
    WHERE r.assignment_id = s.id
    ORDER BY r.revision DESC
    LIMIT 1
  ) latest ON TRUE
), target_ids AS (
  SELECT DISTINCT target_id
  FROM (
    SELECT latest_baseline_profile_revision_id AS target_id FROM scope_latest
    UNION ALL
    SELECT latest_candidate_profile_revision_id AS target_id FROM scope_latest
  ) targets
  WHERE target_id IS NOT NULL
), profiles AS (
  SELECT
    r.id AS revision_id,
    r.profile_id,
    p.machine_key AS profile_key,
    p.status AS profile_status,
    r.adapter_id,
    r.surface_id,
    r.variant_id,
    r.revision,
    r.schema_version,
    r.state,
    r.content,
    r.compatibility_constraints AS compatibility,
    r.content_sha256
  FROM adapter_profile_revisions r
  JOIN target_ids t ON t.target_id = r.id
  JOIN adapter_profiles p ON p.id = r.profile_id
)
SELECT
  (
    SELECT json_build_object(
      'adapterId', adapter_id,
      'adapterKey', adapter_key,
      'adapterStatus', adapter_status,
      'surfaceId', surface_id,
      'surfaceKey', surface_key,
      'surfaceStatus', surface_status,
      'variantId', variant_id,
      'variantKey', variant_key,
      'variantStatus', variant_status
    )
    FROM hierarchy
  ) AS hierarchy,
  COALESCE(
    (
      SELECT json_agg(json_build_object(
        'scopeKind', scope_kind,
        'id', id,
        'variantId', variant_id,
        'browserFamily', browser_family,
        'subjectKind', subject_kind,
        'cohortSeed', cohort_seed,
        'latest', CASE WHEN latest_revision IS NULL THEN NULL ELSE json_build_object(
          'revision', latest_revision,
          'mode', latest_mode,
          'baselineProfileRevisionId', latest_baseline_profile_revision_id,
          'candidateProfileRevisionId', latest_candidate_profile_revision_id,
          'percentageBps', latest_percentage_bps
        ) END
      ))
      FROM scope_latest
    ),
    '[]'::json
  ) AS scopes,
  COALESCE(
    (
      SELECT json_agg(json_build_object(
        'revisionId', revision_id,
        'profileId', profile_id,
        'profileKey', profile_key,
        'profileStatus', profile_status,
        'adapterId', adapter_id,
        'surfaceId', surface_id,
        'variantId', variant_id,
        'revision', revision,
        'schemaVersion', schema_version,
        'state', state,
        'content', content,
        'compatibility', compatibility,
        'contentSha256', content_sha256
      ))
      FROM profiles
    ),
    '[]'::json
  ) AS profiles
`;

function record(value: unknown, name: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`P7_AI_INVALID_${name}`);
  return value as JsonRecord;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`P7_AI_INVALID_${name}`);
  return value;
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  return requiredString(value, name);
}

function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error(`P7_AI_INVALID_${name}`);
  return value;
}

function nullableRecord(value: unknown, name: string): JsonRecord | null {
  return value === null ? null : record(value, name);
}

function mapLatest(value: unknown) {
  const latest = nullableRecord(value, "LATEST");
  if (!latest) return null;
  return {
    revision: requiredInteger(latest.revision, "REVISION"),
    mode: requiredString(latest.mode, "MODE"),
    baselineProfileRevisionId: requiredString(
      latest.baselineProfileRevisionId,
      "BASELINE",
    ),
    candidateProfileRevisionId: nullableString(
      latest.candidateProfileRevisionId,
      "CANDIDATE",
    ),
    percentageBps: requiredInteger(latest.percentageBps, "PERCENTAGE"),
  };
}

function mapScope(value: unknown): BootstrapAiAssignmentSnapshot & {
  scopeKind: string;
} {
  const scope = record(value, "SCOPE");
  const seedText = requiredString(scope.cohortSeed, "COHORT_SEED");
  const cohortSeed = Buffer.from(seedText, "base64");
  return {
    scopeKind: requiredString(scope.scopeKind, "SCOPE_KIND"),
    id: requiredString(scope.id, "ASSIGNMENT"),
    variantId: nullableString(scope.variantId, "VARIANT"),
    browserFamily: requiredString(scope.browserFamily, "BROWSER"),
    subjectKind: requiredString(scope.subjectKind, "SUBJECT"),
    cohortSeed,
    latest: mapLatest(scope.latest),
  };
}

function mapProfile(value: unknown): BootstrapAiProfileSnapshot {
  const profile = record(value, "PROFILE");
  return {
    revisionId: requiredString(profile.revisionId, "REVISION_ID"),
    profileId: requiredString(profile.profileId, "PROFILE_ID"),
    profileKey: requiredString(profile.profileKey, "PROFILE_KEY"),
    profileStatus: requiredString(profile.profileStatus, "PROFILE_STATUS"),
    adapterId: requiredString(profile.adapterId, "ADAPTER_ID"),
    surfaceId: requiredString(profile.surfaceId, "SURFACE_ID"),
    variantId: nullableString(profile.variantId, "PROFILE_VARIANT"),
    revision: requiredInteger(profile.revision, "PROFILE_REVISION"),
    schemaVersion: requiredString(profile.schemaVersion, "SCHEMA_VERSION"),
    state: requiredString(profile.state, "PROFILE_STATE"),
    content: profile.content,
    compatibility: profile.compatibility,
    contentSha256: requiredString(profile.contentSha256, "FINGERPRINT"),
  };
}

export function createBootstrapAiResolutionRepository(
  runtime: DatabaseRuntime,
): BootstrapAiResolutionRepository {
  return {
    async resolve(input) {
      const result = await runtime.query<{
        hierarchy: unknown;
        scopes: unknown;
        profiles: unknown;
      }>(resolutionSql, [
        input.family,
        input.surface,
        input.variant,
        input.browserFamily,
      ]);
      const row = result.rows[0];
      if (!row) throw new Error("P7_AI_EMPTY_SNAPSHOT");
      const hierarchyValue = nullableRecord(row.hierarchy, "HIERARCHY");
      const hierarchy = hierarchyValue
        ? {
            adapterId: requiredString(hierarchyValue.adapterId, "ADAPTER_ID"),
            adapterKey: requiredString(
              hierarchyValue.adapterKey,
              "ADAPTER_KEY",
            ),
            adapterStatus: requiredString(
              hierarchyValue.adapterStatus,
              "ADAPTER_STATUS",
            ),
            surfaceId: requiredString(hierarchyValue.surfaceId, "SURFACE_ID"),
            surfaceKey: requiredString(
              hierarchyValue.surfaceKey,
              "SURFACE_KEY",
            ),
            surfaceStatus: requiredString(
              hierarchyValue.surfaceStatus,
              "SURFACE_STATUS",
            ),
            variantId: nullableString(hierarchyValue.variantId, "VARIANT_ID"),
            variantKey: nullableString(
              hierarchyValue.variantKey,
              "VARIANT_KEY",
            ),
            variantStatus: nullableString(
              hierarchyValue.variantStatus,
              "VARIANT_STATUS",
            ),
          }
        : null;
      if (!Array.isArray(row.scopes) || !Array.isArray(row.profiles))
        throw new Error("P7_AI_INVALID_SNAPSHOT");
      const scopes = row.scopes.map(mapScope);
      return {
        hierarchy,
        exactAssignment:
          scopes.find((scope) => scope.scopeKind === "EXACT") ?? null,
        defaultAssignment:
          scopes.find((scope) => scope.scopeKind === "DEFAULT") ?? null,
        profiles: row.profiles.map(mapProfile),
      } satisfies BootstrapAiResolutionSnapshot;
    },
  };
}
