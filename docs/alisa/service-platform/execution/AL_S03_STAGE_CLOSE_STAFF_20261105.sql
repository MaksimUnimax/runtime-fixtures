-- AL-S03: run only after staff ingress is closed and old requests drained.
-- Own stage database, or the explicitly owned disposable qualification database.
-- Use the matching runtime role; never the migration owner or a foreign DB.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';
DO $guard$
BEGIN
    IF current_database() NOT IN ('alisa_stage_platform', 'alisa_s03_core_platform')
       OR current_user <> current_database() || '_runtime' THEN
        RAISE EXCEPTION 'Owned stage/disposable runtime database required';
    END IF;
END;
$guard$;
SELECT pg_advisory_xact_lock(5845751591832267489);
UPDATE staff_staffsession
   SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), encrypted_payload = ''
 WHERE product_id = 'alisa_market';
UPDATE staff_staffauthflow
   SET consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP), encrypted_payload = ''
 WHERE product_id = 'alisa_market';
INSERT INTO staff_staffauditevent
    (id, product_id, actor_id, action, target_id, reason, outcome, before, after, created_at)
VALUES
    (gen_random_uuid(), 'alisa_market', NULL, 'staff.rollback_closed', NULL,
     'STAFF_REVOCATION', 'APPLIED', '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP);
DO $verify$
BEGIN
    IF EXISTS (SELECT 1 FROM staff_staffsession WHERE product_id='alisa_market' AND (revoked_at IS NULL OR encrypted_payload<>''))
       OR EXISTS (SELECT 1 FROM staff_staffauthflow WHERE product_id='alisa_market' AND (consumed_at IS NULL OR encrypted_payload<>'')) THEN
        RAISE EXCEPTION 'Owned staff rollback postcondition not met';
    END IF;
END;
$verify$;
SELECT
    (SELECT count(*) FROM staff_staffsession WHERE product_id='alisa_market' AND revoked_at IS NULL) AS active_staff_sessions,
    (SELECT count(*) FROM staff_staffsession WHERE product_id='alisa_market' AND encrypted_payload<>'') AS staff_session_payloads,
    (SELECT count(*) FROM staff_staffauthflow WHERE product_id='alisa_market' AND (consumed_at IS NULL OR encrypted_payload<>'')) AS open_staff_flows;
COMMIT;
