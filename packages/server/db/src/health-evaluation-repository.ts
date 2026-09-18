import {
  EvaluationIdentitySchema,
  H4EvaluationResultSchema,
  H5EvaluationResultSchema,
  type EvaluationIdentity,
  type H4EvaluationResult,
  type H5EvaluationResult,
} from "@product/health";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";

export type PersistedHealthProfileEvaluation = {
  id: string;
  evaluationKey: string;
  identity: EvaluationIdentity;
  status: "ACTIVE" | "COMPLETED";
  outcome: string;
  recommendation: string | null;
  result: H4EvaluationResult | H5EvaluationResult;
  firstExecutionId: string;
  latestExecutionId: string;
  firstEvaluatedAt: Date;
  latestEvaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertHealthProfileEvaluationResult = {
  record: PersistedHealthProfileEvaluation;
  applied: boolean;
};

type EvaluationRow = {
  id: string;
  evaluationKey: string;
  phase: EvaluationIdentity["phase"];
  provider: string;
  surface: string;
  target: string;
  variant: string | null;
  probeLayer: EvaluationIdentity["monitoringLayer"];
  baselineProfileRevisionId: string;
  candidateProfileRevisionId: string;
  suiteMachineKey: string;
  suiteRevision: number;
  browserFamily: EvaluationIdentity["browserFamily"];
  browserVersion: string;
  environmentClass: string;
  status: "ACTIVE" | "COMPLETED";
  outcome: string;
  recommendation: string | null;
  result: unknown;
  firstExecutionId: string;
  latestExecutionId: string;
  firstEvaluatedAt: Date;
  latestEvaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function projection(): string {
  return `SELECT id,evaluation_key_sha256 AS "evaluationKey",phase,provider,surface,target,variant,probe_layer AS "probeLayer",baseline_profile_revision_id AS "baselineProfileRevisionId",candidate_profile_revision_id AS "candidateProfileRevisionId",suite_machine_key AS "suiteMachineKey",suite_revision AS "suiteRevision",browser_family AS "browserFamily",browser_version AS "browserVersion",environment_class AS "environmentClass",status,outcome,recommendation,result,first_execution_id AS "firstExecutionId",latest_execution_id AS "latestExecutionId",first_evaluated_at AS "firstEvaluatedAt",latest_evaluated_at AS "latestEvaluatedAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM health_profile_evaluations`;
}

function parseResult(value: unknown): H4EvaluationResult | H5EvaluationResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("HEALTH_EVALUATION_RESULT_CORRUPT");
  const hydrated = { ...(value as Record<string, unknown>) };
  if (typeof hydrated.evaluatedAt === "string")
    hydrated.evaluatedAt = new Date(hydrated.evaluatedAt);
  if (
    "baseline" in hydrated &&
    hydrated.baseline &&
    typeof hydrated.baseline === "object"
  )
    hydrated.baseline = {
      ...(hydrated.baseline as Record<string, unknown>),
      evaluatedAt: new Date(
        String((hydrated.baseline as Record<string, unknown>).evaluatedAt),
      ),
    };
  if (
    "candidate" in hydrated &&
    hydrated.candidate &&
    typeof hydrated.candidate === "object"
  )
    hydrated.candidate = {
      ...(hydrated.candidate as Record<string, unknown>),
      evaluatedAt: new Date(
        String((hydrated.candidate as Record<string, unknown>).evaluatedAt),
      ),
    };
  const h4 = H4EvaluationResultSchema.safeParse(hydrated);
  if (h4.success) return h4.data;
  return H5EvaluationResultSchema.parse(hydrated);
}

function mapRow(row: EvaluationRow): PersistedHealthProfileEvaluation {
  const result = parseResult(row.result);
  const identity = EvaluationIdentitySchema.parse({
    ...result.identity,
    phase: row.phase,
  });
  if (
    result.evaluationKey !== row.evaluationKey ||
    result.identity.phase !== row.phase ||
    result.identity.provider !== row.provider ||
    result.identity.surface !== row.surface ||
    result.identity.target !== row.target ||
    result.identity.variant !== row.variant ||
    result.identity.monitoringLayer !== row.probeLayer ||
    result.identity.baselineProfileRevisionId !==
      row.baselineProfileRevisionId ||
    result.identity.candidateProfileRevisionId !==
      row.candidateProfileRevisionId ||
    result.identity.healthSuiteMachineKey !== row.suiteMachineKey ||
    result.identity.healthSuiteRevision !== row.suiteRevision ||
    result.identity.browserFamily !== row.browserFamily ||
    result.identity.browserVersion !== row.browserVersion ||
    result.identity.environmentClass !== row.environmentClass
  )
    throw new Error("HEALTH_EVALUATION_IDENTITY_CORRUPT");
  return {
    id: row.id,
    evaluationKey: row.evaluationKey,
    identity,
    status: row.status,
    outcome: row.outcome,
    recommendation: row.recommendation,
    result,
    firstExecutionId: row.firstExecutionId,
    latestExecutionId: row.latestExecutionId,
    firstEvaluatedAt: row.firstEvaluatedAt,
    latestEvaluatedAt: row.latestEvaluatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function valueFromResult(result: H4EvaluationResult | H5EvaluationResult) {
  return {
    identity: EvaluationIdentitySchema.parse(result.identity),
    recommendation: "recommendation" in result ? result.recommendation : null,
    executionIds: result.executionIds,
    evaluatedAt: result.evaluatedAt,
  };
}

async function findByKey(q: DatabaseQuery, key: string, lock = false) {
  const result = await q.query<EvaluationRow>(
    `${projection()} WHERE evaluation_key_sha256=$1${lock ? " FOR SHARE" : ""}`,
    [key],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : undefined;
}

export function createHealthEvaluationRepository(runtime: DatabaseRuntime) {
  return {
    async upsertEvaluationResult(
      rawResult: unknown,
    ): Promise<UpsertHealthProfileEvaluationResult> {
      const parsed = H4EvaluationResultSchema.safeParse(rawResult);
      const result = parsed.success
        ? parsed.data
        : H5EvaluationResultSchema.parse(rawResult);
      const value = valueFromResult(result);
      const latestExecutionId =
        value.executionIds[value.executionIds.length - 1];
      if (!latestExecutionId)
        throw new Error("HEALTH_EVALUATION_EXECUTION_REQUIRED");
      return runtime.transaction(async (q) => {
        const inserted = await q.query<EvaluationRow>(
          `INSERT INTO health_profile_evaluations(evaluation_key_sha256,phase,provider,surface,target,variant,probe_layer,baseline_profile_revision_id,candidate_profile_revision_id,suite_machine_key,suite_revision,browser_family,browser_version,environment_class,status,outcome,recommendation,result,first_execution_id,latest_execution_id,first_evaluated_at,latest_evaluated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'COMPLETED',$15,$16,$17::jsonb,$18,$18,$19,$19) ON CONFLICT (evaluation_key_sha256) DO NOTHING RETURNING ${projection()
            .replace(/^SELECT /, "")
            .replace(/ FROM health_profile_evaluations$/, "")}`,
          [
            result.evaluationKey,
            value.identity.phase,
            value.identity.provider,
            value.identity.surface,
            value.identity.target,
            value.identity.variant,
            value.identity.monitoringLayer,
            value.identity.baselineProfileRevisionId,
            value.identity.candidateProfileRevisionId,
            value.identity.healthSuiteMachineKey,
            value.identity.healthSuiteRevision,
            value.identity.browserFamily,
            value.identity.browserVersion,
            value.identity.environmentClass,
            result.outcome,
            value.recommendation,
            JSON.stringify(result),
            latestExecutionId,
            value.evaluatedAt,
          ],
        );
        if (inserted.rows[0])
          return { record: mapRow(inserted.rows[0]), applied: true };
        const existing = await findByKey(q, result.evaluationKey, true);
        if (!existing) throw new Error("HEALTH_EVALUATION_PERSIST_FAILED");
        const newer =
          value.evaluatedAt > existing.latestEvaluatedAt ||
          (value.evaluatedAt.valueOf() ===
            existing.latestEvaluatedAt.valueOf() &&
            latestExecutionId > existing.latestExecutionId);
        if (!newer) return { record: existing, applied: false };
        const updateResult = await q.query<EvaluationRow>(
          `UPDATE health_profile_evaluations SET phase=$1,provider=$2,surface=$3,target=$4,variant=$5,probe_layer=$6,baseline_profile_revision_id=$7,candidate_profile_revision_id=$8,suite_machine_key=$9,suite_revision=$10,browser_family=$11,browser_version=$12,environment_class=$13,status='COMPLETED',outcome=$14,recommendation=$15,result=$16::jsonb,latest_execution_id=$17,latest_evaluated_at=$18,updated_at=now() WHERE evaluation_key_sha256=$19 AND (latest_evaluated_at < $18 OR (latest_evaluated_at = $18 AND latest_execution_id < $17)) RETURNING ${projection()
            .replace(/^SELECT /, "")
            .replace(/ FROM health_profile_evaluations$/, "")}`,
          [
            value.identity.phase,
            value.identity.provider,
            value.identity.surface,
            value.identity.target,
            value.identity.variant,
            value.identity.monitoringLayer,
            value.identity.baselineProfileRevisionId,
            value.identity.candidateProfileRevisionId,
            value.identity.healthSuiteMachineKey,
            value.identity.healthSuiteRevision,
            value.identity.browserFamily,
            value.identity.browserVersion,
            value.identity.environmentClass,
            result.outcome,
            value.recommendation,
            JSON.stringify(result),
            latestExecutionId,
            value.evaluatedAt,
            result.evaluationKey,
          ],
        );
        if (!updateResult.rows[0]) {
          const current = await findByKey(q, result.evaluationKey, true);
          if (!current) throw new Error("HEALTH_EVALUATION_PERSIST_FAILED");
          return { record: current, applied: false };
        }
        return { record: mapRow(updateResult.rows[0]), applied: true };
      });
    },
    async getEvaluation(
      evaluationKey: string,
    ): Promise<PersistedHealthProfileEvaluation | undefined> {
      if (!/^[0-9a-f]{64}$/.test(evaluationKey))
        throw new Error("INVALID_HEALTH_EVALUATION_KEY");
      return findByKey(runtime, evaluationKey);
    },
  };
}
