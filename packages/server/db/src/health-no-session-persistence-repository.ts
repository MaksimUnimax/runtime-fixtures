import { createHash, randomUUID } from "node:crypto";
import {
  HealthStateSchema,
  NoSessionObservationResultSchema,
  type NoSessionObservationResult,
} from "@product/health";
import {
  AdapterKeySchema,
  ProfileKeySchema,
  SurfaceKeySchema,
} from "@product/adapter-registry";
import { canonicalizeJson } from "@product/remote-config";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

type NoSessionAuthorityKeys = Readonly<{
  adapterMachineKey: string;
  surfaceMachineKey: string;
  profileMachineKey: string;
}>;

type NoSessionPersistenceInput = Readonly<{
  scheduledRunId: string;
  observation: unknown;
  classifierVersion: string;
  startedAt: Date;
  completedAt: Date;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const target = [...expected].sort();
  return (
    actual.length === target.length &&
    actual.every((entry, index) => entry === target[index])
  );
}

function parseInput(raw: unknown): NoSessionPersistenceInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("NO_SESSION_PERSISTENCE_INPUT_INVALID");
  const value = raw as Record<string, unknown>;
  if (
    !exactObjectKeys(value, [
      "scheduledRunId",
      "observation",
      "classifierVersion",
      "startedAt",
      "completedAt",
    ])
  ) {
    throw new Error("NO_SESSION_PERSISTENCE_INPUT_INVALID");
  }
  if (
    typeof value.scheduledRunId !== "string" ||
    !UUID_PATTERN.test(value.scheduledRunId)
  ) {
    throw new Error("NO_SESSION_SCHEDULED_RUN_ID_INVALID");
  }
  if (
    typeof value.classifierVersion !== "string" ||
    value.classifierVersion.length < 1 ||
    value.classifierVersion.length > 64
  ) {
    throw new Error("NO_SESSION_CLASSIFIER_VERSION_INVALID");
  }
  if (
    !(value.startedAt instanceof Date) ||
    !(value.completedAt instanceof Date)
  )
    throw new Error("NO_SESSION_TIMESTAMP_TYPE_INVALID");
  return {
    scheduledRunId: value.scheduledRunId,
    observation: value.observation,
    classifierVersion: value.classifierVersion,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
  };
}

const hashJson = (value: unknown) =>
  createHash("sha256").update(canonicalizeJson(value)).digest("hex");

function httpOriginOnly(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("NO_SESSION_URL_ORIGIN_INVALID");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("NO_SESSION_URL_ORIGIN_INVALID");
  }
  return parsed.origin;
}

function nullableHttpOriginOnly(value: string | null): string | null {
  return value === null ? null : httpOriginOnly(value);
}

function sanitizeObservationForPersistence(
  observation: NoSessionObservationResult,
): NoSessionObservationResult {
  const requestedStartUrl = httpOriginOnly(
    observation.navigationEvidence.requestedStartUrl,
  );
  const finalUrl = nullableHttpOriginOnly(
    observation.navigationEvidence.finalUrl,
  );
  const navigationFinalOrigin = nullableHttpOriginOnly(
    observation.navigationEvidence.finalOrigin,
  );
  const finalOrigin = nullableHttpOriginOnly(observation.finalOrigin);
  const finalOrigins = [finalUrl, navigationFinalOrigin, finalOrigin].filter(
    (value): value is string => value !== null,
  );
  if (
    finalOrigins.length > 1 &&
    finalOrigins.some((value) => value !== finalOrigins[0])
  ) {
    throw new Error("NO_SESSION_FINAL_ORIGIN_MISMATCH");
  }
  return NoSessionObservationResultSchema.parse({
    ...observation,
    navigationEvidence: {
      ...observation.navigationEvidence,
      requestedStartUrl,
      finalUrl,
      finalOrigin: navigationFinalOrigin,
    },
    finalOrigin,
  }) as NoSessionObservationResult;
}

function validateSurfacePair(observation: NoSessionObservationResult) {
  const expected =
    observation.surfaceId === "CHATGPT_STANDARD" ||
    observation.surfaceId === "CHATGPT_WORK"
      ? {
          provider: "chatgpt",
          surface:
            observation.surfaceId === "CHATGPT_STANDARD" ? "standard" : "work",
        }
      : {
          provider: observation.surfaceId.toLowerCase(),
          surface: observation.surfaceId.toLowerCase(),
        };
  if (observation.providerId !== expected.provider)
    throw new Error("NO_SESSION_PROVIDER_SURFACE_MISMATCH");
  return expected;
}

type Authority = {
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  variantKey: string;
  profileId: string;
  profileRevisionId: string;
  profileRevision: number;
};

type NoSessionRunRow = {
  id: string;
  runKind: "BASELINE_CONTOUR" | "NO_SESSION_OBSERVATION";
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  profileId: string;
  profileRevisionId: string;
  profileRevision: number;
  browserFamily: string;
  healthState: string;
  scopeSha256: string;
} & Record<string, unknown>;

type ExistingNoSessionRunRow = NoSessionRunRow & {
  resultSha256: string;
};

function authorityKeysFor(
  observation: NoSessionObservationResult,
): NoSessionAuthorityKeys {
  const expected = validateSurfacePair(observation);
  return {
    adapterMachineKey: AdapterKeySchema.parse(expected.provider),
    surfaceMachineKey: SurfaceKeySchema.parse(expected.surface),
    profileMachineKey: ProfileKeySchema.parse(observation.strategyId),
  };
}

async function resolveAuthority(
  q: DatabaseQuery,
  observation: NoSessionObservationResult,
): Promise<Authority & NoSessionAuthorityKeys> {
  const authorityKeys = authorityKeysFor(observation);
  const adapter = await q.query<{ id: string; status: string }>(
    `SELECT id,status FROM ai_adapters WHERE machine_key=$1`,
    [authorityKeys.adapterMachineKey],
  );
  const adapterRow = adapter.rows[0];
  if (!adapterRow) throw new Error("NO_SESSION_PROVIDER_AUTHORITY_NOT_FOUND");
  if (adapterRow.status !== "ACTIVE")
    throw new Error("NO_SESSION_PROVIDER_AUTHORITY_INACTIVE");
  const surface = await q.query<{ id: string; status: string }>(
    `SELECT id,status FROM ai_surfaces WHERE adapter_id=$1 AND machine_key=$2`,
    [adapterRow.id, authorityKeys.surfaceMachineKey],
  );
  const surfaceRow = surface.rows[0];
  if (!surfaceRow) throw new Error("NO_SESSION_SURFACE_AUTHORITY_NOT_FOUND");
  if (surfaceRow.status !== "ACTIVE")
    throw new Error("NO_SESSION_SURFACE_AUTHORITY_INACTIVE");
  const profile = await q.query<{
    id: string;
    variantId: string | null;
    variantKey: string | null;
    profileStatus: string;
    variantStatus: string | null;
  }>(
    `SELECT p.id,p.variant_id AS "variantId",v.machine_key AS "variantKey",p.status AS "profileStatus",v.status AS "variantStatus"
       FROM adapter_profiles p LEFT JOIN ai_variants v ON v.id=p.variant_id AND v.surface_id=p.surface_id
      WHERE p.adapter_id=$1 AND p.surface_id=$2 AND p.machine_key=$3`,
    [adapterRow.id, surfaceRow.id, authorityKeys.profileMachineKey],
  );
  const profileRow = profile.rows[0];
  if (!profileRow) throw new Error("NO_SESSION_PROFILE_AUTHORITY_NOT_FOUND");
  if (profileRow.profileStatus !== "ACTIVE")
    throw new Error("NO_SESSION_PROFILE_AUTHORITY_INACTIVE");
  if (profileRow.variantId && profileRow.variantStatus !== "ACTIVE")
    throw new Error("NO_SESSION_VARIANT_AUTHORITY_INACTIVE");
  const revisions = await q.query<{ id: string; revision: number }>(
    `SELECT r.id,r.revision FROM adapter_profile_revisions r
      WHERE r.profile_id=$1 AND r.adapter_id=$2 AND r.surface_id=$3
        AND r.variant_id IS NOT DISTINCT FROM $4::uuid
        AND r.state='PUBLISHED'
        AND r.compatibility_constraints->'browserFamilies' ? $5
      ORDER BY r.revision`,
    [
      profileRow.id,
      adapterRow.id,
      surfaceRow.id,
      profileRow.variantId,
      observation.browserRuntime.family,
    ],
  );
  if (revisions.rows.length === 0)
    throw new Error("NO_SESSION_PROFILE_REVISION_AUTHORITY_NOT_FOUND");
  if (revisions.rows.length > 1)
    throw new Error("NO_SESSION_PROFILE_REVISION_AUTHORITY_AMBIGUOUS");
  const revision = revisions.rows[0]!;
  return {
    ...authorityKeys,
    adapterId: adapterRow.id,
    surfaceId: surfaceRow.id,
    variantId: profileRow.variantId,
    variantKey: profileRow.variantKey ?? "default",
    profileId: profileRow.id,
    profileRevisionId: revision.id,
    profileRevision: revision.revision,
  };
}

function resultShape(row: NoSessionRunRow, scheduledRunId: string) {
  return {
    healthRunId: row.id,
    healthState: HealthStateSchema.parse(row.healthState),
    scopeSha256: row.scopeSha256,
    adapterId: row.adapterId,
    surfaceId: row.surfaceId,
    variantId: row.variantId,
    profileId: row.profileId,
    profileRevisionId: row.profileRevisionId,
    profileRevision: row.profileRevision,
    browserFamily: row.browserFamily,
    scheduledRunId,
  };
}

const runProjection = `id,run_kind AS "runKind",adapter_id AS "adapterId",surface_id AS "surfaceId",variant_id AS "variantId",profile_id AS "profileId",profile_revision_id AS "profileRevisionId",profile_revision AS "profileRevision",browser_family AS "browserFamily",health_state AS "healthState",scope_sha256 AS "scopeSha256"`;

export function createHealthNoSessionPersistenceRepository(
  runtime: DatabaseRuntime,
) {
  return {
    async persistCompletedNoSessionHealthRun(raw: unknown) {
      const input = parseInput(raw);
      const parsedObservation = NoSessionObservationResultSchema.parse(
        input.observation,
      ) as NoSessionObservationResult;
      const observation = sanitizeObservationForPersistence(parsedObservation);
      const evidenceIds = new Set<string>();
      for (const reference of observation.evidence) {
        if (evidenceIds.has(reference.evidenceId))
          throw new Error("NO_SESSION_DUPLICATE_EVIDENCE_REFERENCE");
        evidenceIds.add(reference.evidenceId);
      }
      const startedMs = input.startedAt.getTime();
      const completedMs = input.completedAt.getTime();
      const observedMs = Date.parse(observation.observedAt);
      if (
        ![startedMs, completedMs, observedMs].every(Number.isFinite) ||
        completedMs < startedMs ||
        observedMs < startedMs ||
        observedMs > completedMs
      ) {
        throw new Error("NO_SESSION_TIMESTAMP_RANGE_INVALID");
      }
      validateSurfacePair(observation);
      const startedAt = input.startedAt.toISOString();
      const completedAt = input.completedAt.toISOString();
      const resultSha256 = hashJson({
        observation,
        classifierVersion: input.classifierVersion,
        startedAt,
        completedAt,
      });
      return runtime.transaction(async (q) => {
        const scheduled = await q.query<{
          id: string;
          probeLayer: string;
          monitorTarget: string;
          provider: string;
          surface: string;
          state: string;
        }>(
          `SELECT id,probe_layer AS "probeLayer",monitor_target AS "monitorTarget",provider,surface,state
             FROM health_scheduled_runs WHERE id=$1 FOR UPDATE`,
          [input.scheduledRunId],
        );
        const scheduledRun = scheduled.rows[0];
        if (!scheduledRun)
          throw new Error("NO_SESSION_SCHEDULED_RUN_NOT_FOUND");
        if (
          scheduledRun.probeLayer !== "NO_SESSION" ||
          scheduledRun.monitorTarget !== observation.targetKey ||
          scheduledRun.provider !== observation.providerId ||
          scheduledRun.surface !== observation.surfaceId
        ) {
          throw new Error("NO_SESSION_SCHEDULE_SCOPE_MISMATCH");
        }

        const existing = await q.query<ExistingNoSessionRunRow>(
          `SELECT r.${runProjection},o.result_sha256 AS "resultSha256"
             FROM health_runs r
             JOIN health_no_session_observations o ON o.run_id=r.id
            WHERE r.scheduled_run_id=$1
            FOR SHARE OF r,o`,
          [input.scheduledRunId],
        );
        const previous = existing.rows[0];
        if (previous) {
          if (
            previous.runKind !== "NO_SESSION_OBSERVATION" ||
            previous.resultSha256 !== resultSha256
          ) {
            throw new Error("NO_SESSION_SCHEDULED_RUN_CONFLICT");
          }
          return resultShape(previous, input.scheduledRunId);
        }
        if (scheduledRun.state !== "RUNNING")
          throw new Error("NO_SESSION_SCHEDULE_NOT_RUNNING");

        const authority = await resolveAuthority(q, observation);
        const scope = {
          schemaVersion: "health_no_session_scope_v1",
          monitoringLayer: "NO_SESSION",
          provider: observation.providerId,
          adapterMachineKey: authority.adapterMachineKey,
          surface: observation.surfaceId,
          surfaceMachineKey: authority.surfaceMachineKey,
          variant: authority.variantKey,
          adapterId: authority.adapterId,
          surfaceId: authority.surfaceId,
          variantId: authority.variantId,
          profileId: authority.profileId,
          profileMachineKey: authority.profileMachineKey,
          profileRevisionId: authority.profileRevisionId,
          profileRevision: authority.profileRevision,
          browserFamily: observation.browserRuntime.family,
          browserVersion: observation.browserRuntime.browserVersion,
          targetKey: observation.targetKey,
          strategyId: observation.strategyId,
          strategyRevision: observation.strategyRevision,
        };
        const scopeSha256 = hashJson(scope);
        const inserted = await q.query<NoSessionRunRow>(
          `INSERT INTO health_runs(id,run_kind,suite_revision_id,adapter_id,surface_id,variant_id,profile_id,profile_revision_id,profile_revision,browser_family,browser_version,extension_version,adapter_engine_version,scheduled_run_id,health_level,health_state,classifier_version,scope,scope_sha256,operator_maintenance,started_at,completed_at)
           VALUES($1,'NO_SESSION_OBSERVATION',NULL,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,$10,'H2',$11,$12,$13::jsonb,$14,false,$15,$16)
           RETURNING ${runProjection}`,
          [
            randomUUID(),
            authority.adapterId,
            authority.surfaceId,
            authority.variantId,
            authority.profileId,
            authority.profileRevisionId,
            authority.profileRevision,
            observation.browserRuntime.family,
            observation.browserRuntime.browserVersion,
            input.scheduledRunId,
            observation.classification,
            input.classifierVersion,
            JSON.stringify(scope),
            scopeSha256,
            startedAt,
            completedAt,
          ],
        );
        const run = inserted.rows[0];
        if (!run) throw new Error("NO_SESSION_HEALTH_RUN_PERSIST_FAILED");
        await q.query(
          `INSERT INTO health_no_session_observations(run_id,provider_id,observation_surface_id,target_key,strategy_id,strategy_revision,classification,classification_basis,surface_outcome,blocker,observed_at,result_sha256,observation)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
          [
            run.id,
            observation.providerId,
            observation.surfaceId,
            observation.targetKey,
            observation.strategyId,
            observation.strategyRevision,
            observation.classification,
            observation.classificationBasis,
            observation.surfaceOutcome,
            observation.blocker,
            observation.observedAt,
            resultSha256,
            JSON.stringify(observation),
          ],
        );
        for (const reference of observation.evidence) {
          await q.query(
            `INSERT INTO health_no_session_evidence_references(evidence_id,run_id,rule_id,classification,sha256,size_bytes) VALUES($1,$2,$3,$4,$5,$6)`,
            [
              reference.evidenceId,
              run.id,
              reference.ruleId,
              reference.classification,
              reference.sha256,
              reference.sizeBytes,
            ],
          );
        }
        return resultShape(run, input.scheduledRunId);
      });
    },
  };
}
