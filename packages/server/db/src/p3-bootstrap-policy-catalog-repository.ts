import { createCompatibilityCatalogRepository } from "./compatibility-catalog-repository.js";
import { createRemoteConfigCatalogRepository } from "./remote-config-catalog-repository.js";
import {
  P3FeatureRuleSchema,
  P3RolloutRevisionSchema,
  P3RolloutSchema,
  type P3BootstrapPolicyCatalog,
} from "@product/remote-config";
import {
  BrowserFamilySchema,
  CompatibilityPolicyRevisionSchema,
  ContractVersionSchema,
  ExtensionReleaseSchema,
} from "@product/compatibility";
import type { DatabaseQuery } from "./index.js";

/** Exact, validated persisted graph reader used solely by P3.3 resolution. */
export function createP3BootstrapPolicyCatalogRepository(
  db: DatabaseQuery,
): P3BootstrapPolicyCatalog {
  const compatibility = createCompatibilityCatalogRepository(db);
  const remote = createRemoteConfigCatalogRepository(db);
  const ruleColumns =
    'id,feature_key AS "featureKey",revision,contract_version AS "contractVersion",enabled,browser_family AS "browserFamily",minimum_extension_version AS "minimumExtensionVersion"';
  const revisionColumns =
    'id,rollout_id AS "rolloutId",target_kind AS "targetKind",revision,state,percentage_bps AS "percentageBps",baseline_config_version AS "baselineConfigVersion",candidate_config_version AS "candidateConfigVersion",baseline_feature_rule_revision_id AS "baselineFeatureRuleRevisionId",candidate_feature_rule_revision_id AS "candidateFeatureRuleRevisionId"';
  return {
    ...compatibility,
    ...remote,
    async listLatestExtensionReleaseSupports(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 64)
        throw new Error("invalid extension release limit");
      const r = await db.query(
        'SELECT e.id,e.version,e.release_channel AS "releaseChannel",e.artifact_sha256 AS "artifactSha256",e.released_at AS "releasedAt",e.created_at AS "createdAt",COALESCE(c.versions,ARRAY[]::text[]) AS "contractVersions",COALESCE(b.families,ARRAY[]::text[]) AS "browserFamilies" FROM extension_releases e LEFT JOIN LATERAL (SELECT array_agg(contract_version::text ORDER BY contract_version::text) AS versions FROM extension_release_contracts WHERE release_id=e.id) c ON TRUE LEFT JOIN LATERAL (SELECT array_agg(browser_family::text ORDER BY browser_family::text) AS families FROM extension_release_browsers WHERE release_id=e.id) b ON TRUE ORDER BY e.released_at DESC,e.id DESC LIMIT $1',
        [limit],
      );
      return r.rows.map((row) => {
        const { contractVersions, browserFamilies, ...release } = row;
        return {
          ...ExtensionReleaseSchema.parse(release),
          contractVersions:
            ContractVersionSchema.array().parse(contractVersions),
          browserFamilies: BrowserFamilySchema.array().parse(browserFamilies),
        };
      });
    },
    async findFeatureDefinition(featureKey) {
      const r = await db.query(
        'SELECT feature_key AS "featureKey" FROM feature_definitions WHERE feature_key=$1',
        [featureKey],
      );
      return r.rows[0]
        ? { featureKey: String(r.rows[0].featureKey) }
        : undefined;
    },
    async findRolloutByKey(rolloutKey) {
      const r = await db.query(
        'SELECT id,rollout_key AS "rolloutKey",target_kind AS "targetKind",subject_kind AS "subjectKind",cohort_seed AS "cohortSeed" FROM rollouts WHERE rollout_key=$1',
        [rolloutKey],
      );
      return r.rows[0] ? P3RolloutSchema.parse(r.rows[0]) : undefined;
    },
    async findRolloutById(id) {
      const r = await db.query(
        'SELECT id,rollout_key AS "rolloutKey",target_kind AS "targetKind",subject_kind AS "subjectKind",cohort_seed AS "cohortSeed" FROM rollouts WHERE id=$1',
        [id],
      );
      return r.rows[0] ? P3RolloutSchema.parse(r.rows[0]) : undefined;
    },
    async findLatestRolloutRevision(rolloutId) {
      const r = await db.query(
        `SELECT ${revisionColumns} FROM rollout_revisions WHERE rollout_id=$1 ORDER BY revision DESC LIMIT 1`,
        [rolloutId],
      );
      return r.rows[0] ? P3RolloutRevisionSchema.parse(r.rows[0]) : undefined;
    },
    async findFeatureRuleRevision(id) {
      const r = await db.query(
        `SELECT ${ruleColumns} FROM feature_rule_revisions WHERE id=$1`,
        [id],
      );
      return r.rows[0] ? P3FeatureRuleSchema.parse(r.rows[0]) : undefined;
    },
    async listConfigFeatureRules(configVersion) {
      const r = await db.query(
        `SELECT ${ruleColumns} FROM config_release_feature_rules l JOIN feature_rule_revisions r ON r.id=l.feature_rule_revision_id WHERE l.config_version=$1 ORDER BY r.feature_key,r.revision`,
        [configVersion],
      );
      return r.rows.map((row) => P3FeatureRuleSchema.parse(row));
    },
    async listConfigFeatureRolloutRevisions(configVersion) {
      const r = await db.query(
        `SELECT r.id,r.rollout_id AS "rolloutId",r.target_kind AS "targetKind",r.revision,r.state,r.percentage_bps AS "percentageBps",r.baseline_config_version AS "baselineConfigVersion",r.candidate_config_version AS "candidateConfigVersion",r.baseline_feature_rule_revision_id AS "baselineFeatureRuleRevisionId",r.candidate_feature_rule_revision_id AS "candidateFeatureRuleRevisionId" FROM config_release_rollout_revisions l JOIN rollout_revisions r ON r.id=l.rollout_revision_id WHERE l.config_version=$1 ORDER BY r.rollout_id,r.revision`,
        [configVersion],
      );
      return r.rows.map((row) => P3RolloutRevisionSchema.parse(row));
    },
    async listConfigCompatibilityPolicyRevisions(configVersion) {
      const r = await db.query(
        'SELECT p.id,p.policy_key AS "policyKey",p.revision,p.contract_version AS "contractVersion",p.browser_family AS "browserFamily",p.minimum_extension_version AS "minimumExtensionVersion",p.recommended_extension_version AS "recommendedExtensionVersion",p.minimum_browser_version AS "minimumBrowserVersion",p.maintenance_mode AS "maintenanceMode",p.maintenance_code AS "maintenanceCode",p.published_at AS "publishedAt",p.created_at AS "createdAt" FROM config_release_compatibility_policies l JOIN compatibility_policy_revisions p ON p.id=l.policy_revision_id WHERE l.config_version=$1 ORDER BY p.policy_key,p.revision',
        [configVersion],
      );
      return r.rows.map((row) => CompatibilityPolicyRevisionSchema.parse(row));
    },
  };
}
