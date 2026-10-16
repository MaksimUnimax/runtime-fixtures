-- Mandatory credential-transfer fencing. This migration does not provision
-- application logins or grant runtime authority. The deployment owner must
-- use a separate nonowner runtime role and grant only the two entry functions.
-- Pre-epoch binaries will fail transfer DML after this migration. No rolling
-- mixed-version deployment or live downgrade is authorized by this source.
-- The epoch is never reset by application code; backup/downgrade needs a
-- separately verified no-old-writers protocol.
CREATE SCHEMA octoport_transfer_fence;
REVOKE ALL ON SCHEMA octoport_transfer_fence FROM PUBLIC;
CREATE TABLE octoport_transfer_fence.writer_epoch (
 singleton_id smallint PRIMARY KEY CHECK(singleton_id=1),
 epoch bigint NOT NULL CHECK(epoch>0), owner_instance_id uuid NOT NULL
);
INSERT INTO octoport_transfer_fence.writer_epoch
 VALUES(1,1,'00000000-0000-0000-0000-000000000000');
-- Protected per-transaction context, never a caller-controlled GUC. Contains
-- only technical IDs; a deferred trigger deletes it before COMMIT. Rollback
-- also removes it. No timer or external cleanup executor is required.
CREATE TABLE octoport_transfer_fence.authorized_transactions (
 transaction_id xid8 PRIMARY KEY,
 backend_pid integer NOT NULL,
 epoch bigint NOT NULL,
 owner_instance_id uuid NOT NULL
);
CREATE FUNCTION octoport_transfer_fence.clear_transaction_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $clear$
BEGIN
 DELETE FROM octoport_transfer_fence.authorized_transactions
 WHERE transaction_id=NEW.transaction_id AND backend_pid=NEW.backend_pid;
 RETURN NULL;
END $clear$;
CREATE CONSTRAINT TRIGGER clear_transaction_authorization
 AFTER INSERT ON octoport_transfer_fence.authorized_transactions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 EXECUTE FUNCTION octoport_transfer_fence.clear_transaction_authorization();
ALTER TABLE octoport_transfer_fence.authorized_transactions
 ENABLE ALWAYS TRIGGER clear_transaction_authorization;
REVOKE ALL ON octoport_transfer_fence.authorized_transactions FROM PUBLIC;
REVOKE ALL ON FUNCTION octoport_transfer_fence.clear_transaction_authorization() FROM PUBLIC;
CREATE FUNCTION octoport_transfer_fence.claim_writer(p_instance_id uuid)
RETURNS TABLE(epoch bigint,owner_instance_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $claim$
DECLARE previous_epoch bigint;
BEGIN
 IF p_instance_id IS NULL OR p_instance_id='00000000-0000-0000-0000-000000000000' THEN
  RAISE EXCEPTION USING ERRCODE='PTF03',MESSAGE='TRANSFER_EPOCH_ID_INVALID';
 END IF;
 SELECT w.epoch INTO previous_epoch FROM octoport_transfer_fence.writer_epoch w
  WHERE w.singleton_id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PTF04',MESSAGE='TRANSFER_EPOCH_ROW_UNAVAILABLE'; END IF;
 IF previous_epoch>=9223372036854775807 THEN
  RAISE EXCEPTION USING ERRCODE='PTF05',MESSAGE='TRANSFER_EPOCH_OVERFLOW';
 END IF;
 UPDATE octoport_transfer_fence.writer_epoch w
  SET epoch=previous_epoch+1,owner_instance_id=p_instance_id WHERE w.singleton_id=1
  RETURNING w.epoch,w.owner_instance_id INTO epoch,owner_instance_id;
 RETURN NEXT;
END $claim$;
CREATE FUNCTION octoport_transfer_fence.authorize_writer(p_epoch bigint,p_instance_id uuid)
RETURNS TABLE(epoch bigint,owner_instance_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $authorize$
BEGIN
 -- The zero UUID identifies initialization, never an elected writer.
 IF p_epoch IS NULL OR p_epoch<=0 OR p_instance_id IS NULL
    OR p_instance_id='00000000-0000-0000-0000-000000000000' THEN
  RAISE EXCEPTION USING ERRCODE='PTF03',MESSAGE='TRANSFER_EPOCH_ID_INVALID';
 END IF;
 SELECT w.epoch,w.owner_instance_id INTO epoch,owner_instance_id
 FROM octoport_transfer_fence.writer_epoch w
 WHERE w.singleton_id=1 AND w.epoch=p_epoch AND w.owner_instance_id=p_instance_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PTF01',MESSAGE='TRANSFER_EPOCH_STALE'; END IF;
 INSERT INTO octoport_transfer_fence.authorized_transactions
   (transaction_id,backend_pid,epoch,owner_instance_id)
 VALUES(pg_catalog.pg_current_xact_id(),pg_catalog.pg_backend_pid(),p_epoch,p_instance_id)
 ON CONFLICT(transaction_id) DO UPDATE
 SET backend_pid=EXCLUDED.backend_pid,epoch=EXCLUDED.epoch,
     owner_instance_id=EXCLUDED.owner_instance_id;
 RETURN NEXT;
END $authorize$;
CREATE FUNCTION octoport_transfer_fence.guard_transfer_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $guard$
DECLARE e bigint; i uuid;
BEGIN
 SELECT a.epoch,a.owner_instance_id INTO e,i
 FROM octoport_transfer_fence.authorized_transactions a
 WHERE a.transaction_id=pg_catalog.pg_current_xact_id()
   AND a.backend_pid=pg_catalog.pg_backend_pid();
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='PTF02',MESSAGE='TRANSFER_EPOCH_CONTEXT_MISSING';
 END IF;
 PERFORM 1 FROM octoport_transfer_fence.writer_epoch w
 WHERE w.singleton_id=1 AND w.epoch=e AND w.owner_instance_id=i FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='PTF01',MESSAGE='TRANSFER_EPOCH_STALE';
 END IF;
 RETURN NULL;
END $guard$;
REVOKE ALL ON octoport_transfer_fence.writer_epoch FROM PUBLIC;
REVOKE ALL ON FUNCTION octoport_transfer_fence.claim_writer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION octoport_transfer_fence.authorize_writer(bigint,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION octoport_transfer_fence.guard_transfer_statement() FROM PUBLIC;
CREATE TRIGGER credential_transfer_epoch_guard
 BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.credential_transfer_requests
 FOR EACH STATEMENT EXECUTE FUNCTION octoport_transfer_fence.guard_transfer_statement();
ALTER TABLE public.credential_transfer_requests ENABLE ALWAYS TRIGGER credential_transfer_epoch_guard;
