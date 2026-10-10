import { AiPromptTreeV1Schema, canonicalAiPromptTreeV1 } from "@product/contracts";
import { promptTreeDigest, publishablePromptTree, type PromptTreeRepository,
  type PromptTreeState, type PromptTreeActor } from "@product/admin-ai";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { authorizeAdminMutationInTransaction } from "./admin-mutation-authorization.js";
import { safeAuditReason } from "./safe-audit.js";

async function read(q: DatabaseQuery, target: string): Promise<PromptTreeState | null> {
  const result = await q.query(`SELECT h.*, COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'version',p.version,'sha256',p.content_sha256,'author',p.author_id,
    'publishedAt',p.published_at,'sourceVersion',p.source_version) ORDER BY p.version DESC)
    FROM (SELECT * FROM ai_prompt_tree_publications WHERE target=h.target ORDER BY version DESC LIMIT 256) p),'[]'::jsonb) AS history
    FROM ai_prompt_tree_heads h WHERE h.target=$1`, [target]);
  const row = result.rows[0];
  return row ? { target: String(row.target), draftRevision: Number(row.draft_revision),
    draft: AiPromptTreeV1Schema.parse(row.draft),
    templateRevision: row.template_revision === null ? null : Number(row.template_revision),
    publishedVersion: Number(row.published_version), history: row.history as PromptTreeState["history"] } : null;
}
async function locked(q: DatabaseQuery, target: string) {
  const result = await q.query("SELECT * FROM ai_prompt_tree_heads WHERE target=$1 FOR UPDATE", [target]);
  if (!result.rows[0]) throw new Error("P7_REGISTRY_PARENT_NOT_FOUND");
  return result.rows[0];
}
async function audit(q: DatabaseQuery, target: string, input: PromptTreeActor, action: string,
  metadata: Record<string, unknown>) {
  await q.query(`INSERT INTO audit_events(actor_type,actor_id,action,target_type,target_id,correlation_id,reason,safe_metadata)
    VALUES('ADMIN',$1,$2,'AI_PROMPT_TREE',$3,$4,$5,$6::jsonb)`,
  [input.actorId, action, target === "template" ? null : target, input.correlationId, safeAuditReason(input.reason),
    JSON.stringify({...metadata, treeTarget: target})]);
}

export function createAiPromptTreeRepository(runtime: DatabaseRuntime): PromptTreeRepository {
  return {
    get: target => read(runtime, target),
    save: (target, input) => runtime.transaction(async q => {
      await authorizeAdminMutationInTransaction(q, input.actorId, "ai.registry.manage");
      const head = await locked(q, target);
      if (Number(head.draft_revision) !== input.expectedDraftRevision) throw new Error("P7_STATE_STALE");
      const body = canonicalAiPromptTreeV1(input.body);
      await q.query("UPDATE ai_prompt_tree_heads SET draft=$2::jsonb,draft_revision=draft_revision+1 WHERE target=$1", [target,body]);
      await audit(q,target,input,"AI_TREE_DRAFT_SAVED",{draftRevision:input.expectedDraftRevision+1,sha256:promptTreeDigest(input.body)});
      return (await read(q,target))!;
    }),
    publish: (target, input) => runtime.transaction(async q => {
      await authorizeAdminMutationInTransaction(q, input.actorId, "ai.registry.manage");
      const head = await locked(q, target);
      if (Number(head.draft_revision) !== input.expectedDraftRevision || Number(head.published_version) !== input.expectedPublishedVersion)
        throw new Error("P7_STATE_STALE");
      let candidate = head.draft;
      if (input.sourceVersion !== undefined) {
        const previous = await q.query("SELECT body FROM ai_prompt_tree_publications WHERE target=$1 AND version=$2", [target,input.sourceVersion]);
        if (!previous.rows[0]) throw new Error("P7_REGISTRY_PARENT_NOT_FOUND");
        candidate = previous.rows[0].body;
      }
      const body = publishablePromptTree(candidate), digest = promptTreeDigest(body), version = input.expectedPublishedVersion+1;
      await q.query(`INSERT INTO ai_prompt_tree_publications(target,version,body,content_sha256,author_id,source_version)
        VALUES($1,$2,$3::jsonb,$4,$5,$6)`, [target,version,canonicalAiPromptTreeV1(body),digest,input.actorId,input.sourceVersion ?? null]);
      await q.query(`UPDATE ai_prompt_tree_heads SET published_version=$2,
        draft=CASE WHEN $3 THEN $4::jsonb ELSE draft END,
        draft_revision=draft_revision+CASE WHEN $3 THEN 1 ELSE 0 END WHERE target=$1`,
      [target,version,input.sourceVersion !== undefined,canonicalAiPromptTreeV1(body)]);
      await audit(q,target,input,input.sourceVersion === undefined ? "AI_TREE_PUBLISHED" : "AI_TREE_ROLLBACK_PUBLISHED",
        {version,sha256:digest,sourceVersion:input.sourceVersion ?? null});
      return (await read(q,target))!;
    }),
  };
}
