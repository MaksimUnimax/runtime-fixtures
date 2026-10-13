import type { DatabaseQuery } from "./index.js";

/** No schema changes, grants or credentials are produced by this admission check. */
export const TRANSFER_FENCE_RUNTIME_CHECK_SQL = `
WITH caller AS (
  SELECT oid,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
  FROM pg_catalog.pg_roles WHERE rolname=current_user
), relations AS (
  SELECT oid,relowner,relnamespace,relkind,relpersistence,relhasrules,relhassubclass,relispartition,relrowsecurity FROM pg_catalog.pg_class
  WHERE oid IN (pg_catalog.to_regclass('public.credential_transfer_requests'),
                pg_catalog.to_regclass('octoport_transfer_fence.writer_epoch'),
                pg_catalog.to_regclass('octoport_transfer_fence.authorized_transactions'))
), routines AS (
  SELECT oid,proowner,prosecdef,proconfig,proacl FROM pg_catalog.pg_proc
  WHERE oid IN (pg_catalog.to_regprocedure('octoport_transfer_fence.claim_writer(uuid)'),
                pg_catalog.to_regprocedure('octoport_transfer_fence.authorize_writer(bigint,uuid)'),
                pg_catalog.to_regprocedure('octoport_transfer_fence.guard_transfer_statement()'),
                pg_catalog.to_regprocedure('octoport_transfer_fence.clear_transaction_authorization()'))
), owners AS (
  SELECT relowner AS owner FROM relations
  UNION SELECT proowner FROM routines
  UNION SELECT nspowner FROM pg_catalog.pg_namespace
    WHERE oid IN (SELECT relnamespace FROM relations)
       OR oid=pg_catalog.to_regnamespace('octoport_transfer_fence')
)
SELECT
  current_user=session_user AS direct_session_identity,
  (SELECT count(*)=1 AND bool_and(NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) FROM caller) AS restricted_role,
  (SELECT count(*)=3 AND bool_and(relkind='r' AND relpersistence='p' AND NOT relhasrules AND NOT relhassubclass AND NOT relispartition AND NOT relrowsecurity) FROM relations) AS expected_relations,
  (SELECT count(*)=4 AND bool_and(prosecdef AND coalesce(proconfig @> ARRAY['search_path=pg_catalog, pg_temp'],false)) FROM routines) AS safe_functions,
  NOT EXISTS(SELECT 1 FROM owners WHERE pg_catalog.pg_has_role(current_user,owner,'MEMBER')) AS cannot_assume_owner,
  coalesce(pg_catalog.has_schema_privilege(current_user,pg_catalog.to_regnamespace('octoport_transfer_fence'),'USAGE'),false)
    AND NOT coalesce(pg_catalog.has_schema_privilege(current_user,pg_catalog.to_regnamespace('octoport_transfer_fence'),'CREATE'),true) AS private_schema_usage_only,
  coalesce(pg_catalog.has_function_privilege(current_user,pg_catalog.to_regprocedure('octoport_transfer_fence.claim_writer(uuid)'),'EXECUTE'),false)
    AND coalesce(pg_catalog.has_function_privilege(current_user,pg_catalog.to_regprocedure('octoport_transfer_fence.authorize_writer(bigint,uuid)'),'EXECUTE'),false) AS can_call_entry_functions,
  NOT coalesce(pg_catalog.has_table_privilege(current_user,pg_catalog.to_regclass('octoport_transfer_fence.writer_epoch'),'INSERT,UPDATE,DELETE,TRUNCATE'),true)
    AND NOT coalesce(pg_catalog.has_any_column_privilege(current_user,pg_catalog.to_regclass('octoport_transfer_fence.writer_epoch'),'INSERT,UPDATE'),true)
    AND NOT coalesce(pg_catalog.has_table_privilege(current_user,pg_catalog.to_regclass('octoport_transfer_fence.authorized_transactions'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),true)
    AND NOT coalesce(pg_catalog.has_any_column_privilege(current_user,pg_catalog.to_regclass('octoport_transfer_fence.authorized_transactions'),'SELECT,INSERT,UPDATE,REFERENCES'),true) AS no_direct_epoch_mutation,
  NOT coalesce(pg_catalog.has_table_privilege(current_user,pg_catalog.to_regclass('public.credential_transfer_requests'),'TRUNCATE'),true) AS cannot_truncate_requests,
  NOT EXISTS(SELECT 1 FROM routines p,
    LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS functions_not_public,
  (SELECT count(*)=1 AND bool_and(tgname='credential_transfer_epoch_guard'
      AND tgtype=62 AND tgenabled='A'
      AND tgfoid=pg_catalog.to_regprocedure('octoport_transfer_fence.guard_transfer_statement()'))
    FROM pg_catalog.pg_trigger
    WHERE tgrelid=pg_catalog.to_regclass('public.credential_transfer_requests') AND NOT tgisinternal) AS mandatory_statement_trigger,
  (SELECT count(*)=3 AND bool_and(attnotnull AND
      ((attname='singleton_id' AND atttypid='smallint'::regtype)
       OR (attname='epoch' AND atttypid='bigint'::regtype)
       OR (attname='owner_instance_id' AND atttypid='uuid'::regtype)))
    FROM pg_catalog.pg_attribute WHERE attrelid=pg_catalog.to_regclass('octoport_transfer_fence.writer_epoch') AND attnum>0 AND NOT attisdropped)
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('octoport_transfer_fence.writer_epoch') AND contype='p' AND conkey=ARRAY[1]::smallint[] AND convalidated)
    AND (SELECT count(DISTINCT pg_catalog.pg_get_expr(conbin,conrelid))=2
      FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('octoport_transfer_fence.writer_epoch') AND contype='c' AND convalidated
      AND pg_catalog.pg_get_expr(conbin,conrelid) IN ('(singleton_id = 1)','(epoch > 0)')) AS epoch_structure,
  (SELECT count(*)=4 AND bool_and(attnotnull AND
      ((attname='transaction_id' AND atttypid='xid8'::regtype)
       OR (attname='backend_pid' AND atttypid='integer'::regtype)
       OR (attname='epoch' AND atttypid='bigint'::regtype)
       OR (attname='owner_instance_id' AND atttypid='uuid'::regtype)))
    FROM pg_catalog.pg_attribute WHERE attrelid=pg_catalog.to_regclass('octoport_transfer_fence.authorized_transactions') AND attnum>0 AND NOT attisdropped)
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('octoport_transfer_fence.authorized_transactions') AND contype='p' AND conkey=ARRAY[1]::smallint[] AND convalidated)
    AND (SELECT count(*)=1 AND bool_and(tgname='clear_transaction_authorization' AND tgtype=5 AND tgenabled='A' AND tgdeferrable AND tginitdeferred
      AND tgfoid=pg_catalog.to_regprocedure('octoport_transfer_fence.clear_transaction_authorization()'))
      FROM pg_catalog.pg_trigger WHERE tgrelid=pg_catalog.to_regclass('octoport_transfer_fence.authorized_transactions') AND NOT tgisinternal) AS transaction_context_structure
`;

const REQUIRED = [
  "direct_session_identity",
  "restricted_role",
  "expected_relations",
  "epoch_structure",
  "transaction_context_structure",
  "safe_functions",
  "cannot_assume_owner",
  "private_schema_usage_only",
  "can_call_entry_functions",
  "no_direct_epoch_mutation",
  "cannot_truncate_requests",
  "functions_not_public",
  "mandatory_statement_trigger",
] as const;

/**
 * The API must call this with its actual database role before election/listen.
 * An unsafe deployment is refused; the application never grants itself access.
 * This validates database admission prerequisites, not replica topology,
 * old-process absence, snapshot epoch monotonicity or a compromised runtime role.
 */
export async function assertCredentialTransferFenceRuntime(
  database: DatabaseQuery,
): Promise<void> {
  let result: Awaited<ReturnType<DatabaseQuery["query"]>>;
  try {
    result = await database.query(TRANSFER_FENCE_RUNTIME_CHECK_SQL);
  } catch (error) {
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    // Restricted roles may be refused even while resolving catalog OIDs.
    // Missing migration/grants remain a denial, never a fallback or self-grant.
    if (
      code === "42501" ||
      code === "3F000" ||
      code === "42P01" ||
      code === "42883"
    )
      throw new Error("TRANSFER_FENCE_RUNTIME_UNSAFE_OR_UNPROVISIONED");
    throw error;
  }
  const row = result.rows[0];
  if (result.rows.length !== 1 || REQUIRED.some((key) => row?.[key] !== true))
    throw new Error("TRANSFER_FENCE_RUNTIME_UNSAFE_OR_UNPROVISIONED");
}
