-- Run after admin ingress, flags and S03 in-flight requests have been closed.
-- Only the dedicated new admin client is suspended; its identity/secret/subjects remain.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';
DO $guard$
BEGIN
    IF current_database() NOT IN ('alisa_stage_identity', 'alisa_s03_core_identity')
       OR current_user <> current_database() || '_runtime' THEN
        RAISE EXCEPTION 'Owned stage/disposable identity runtime database required';
    END IF;
END;
$guard$;
UPDATE allauth_idp_oidc_client
   SET grant_types = '', response_types = ''
 WHERE id = CASE current_database()
     WHEN 'alisa_stage_identity' THEN 'alisa_admin_stage'
     WHEN 'alisa_s03_core_identity' THEN 's03_admin' END;
DELETE FROM allauth_idp_oidc_token
 WHERE client_id = CASE current_database()
     WHEN 'alisa_stage_identity' THEN 'alisa_admin_stage'
     WHEN 'alisa_s03_core_identity' THEN 's03_admin' END;
DO $verify$
DECLARE
    admin_id text := CASE current_database()
        WHEN 'alisa_stage_identity' THEN 'alisa_admin_stage'
        WHEN 'alisa_s03_core_identity' THEN 's03_admin' END;
BEGIN
    IF (SELECT count(*) FROM allauth_idp_oidc_client WHERE id=admin_id) <> 1 THEN
        RAISE EXCEPTION 'Dedicated admin client must exist before suspension';
    END IF;
    IF EXISTS (SELECT 1 FROM allauth_idp_oidc_client WHERE id=admin_id AND (grant_types<>'' OR response_types<>''))
       OR EXISTS (SELECT 1 FROM allauth_idp_oidc_token WHERE client_id=admin_id) THEN
        RAISE EXCEPTION 'Admin client suspension postcondition not met';
    END IF;
END;
$verify$;
SELECT
    (SELECT count(*) FROM allauth_idp_oidc_client WHERE id=CASE current_database()
        WHEN 'alisa_stage_identity' THEN 'alisa_admin_stage'
        WHEN 'alisa_s03_core_identity' THEN 's03_admin' END) AS admin_client_rows,
    (SELECT count(*) FROM allauth_idp_oidc_client WHERE id=CASE current_database()
        WHEN 'alisa_stage_identity' THEN 'alisa_admin_stage'
        WHEN 'alisa_s03_core_identity' THEN 's03_admin' END
        AND (grant_types<>'' OR response_types<>'')) AS enabled_admin_clients,
    (SELECT count(*) FROM allauth_idp_oidc_token WHERE client_id=CASE current_database()
        WHEN 'alisa_stage_identity' THEN 'alisa_admin_stage'
        WHEN 'alisa_s03_core_identity' THEN 's03_admin' END) AS remaining_admin_tokens;
COMMIT;
