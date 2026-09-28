DROP INDEX "api_watch_snapshots_family_sha_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "api_watch_snapshots_family_sha_family_scope_unique"
  ON "api_watch_snapshots" ("source_family","sha256")
  WHERE "document_key" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "api_watch_snapshots_family_sha_document_scope_unique"
  ON "api_watch_snapshots" ("source_family","sha256","document_key")
  WHERE "document_key" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_watch_report_sources" ADD COLUMN "document_key" varchar(128);
--> statement-breakpoint
ALTER TABLE "api_watch_report_sources" DROP CONSTRAINT "api_watch_report_sources_pk";
--> statement-breakpoint
ALTER TABLE "api_watch_report_sources"
  ADD CONSTRAINT "api_watch_report_sources_document_key_nonempty"
  CHECK ("document_key" IS NULL OR length(btrim("document_key")) > 0);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_watch_report_sources_family_scope_unique"
  ON "api_watch_report_sources" ("report_id","source_family")
  WHERE "document_key" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "api_watch_report_sources_document_scope_unique"
  ON "api_watch_report_sources" ("report_id","source_family","document_key")
  WHERE "document_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "api_watch_report_sources_scope_index"
  ON "api_watch_report_sources" ("report_id","source_family","document_key");
--> statement-breakpoint
CREATE TABLE "api_watch_product_baselines" (
  "baseline_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_family" varchar(32) NOT NULL,
  "document_key" varchar(128),
  "snapshot_id" varchar(160) NOT NULL,
  "revision" integer NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  "accepted_by" varchar(128) NOT NULL,
  "acceptance_reference" varchar(256) NOT NULL,
  CONSTRAINT "api_watch_product_baselines_snapshot_fk" FOREIGN KEY ("snapshot_id") REFERENCES "api_watch_snapshots"("snapshot_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "api_watch_product_baselines_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_product_baselines_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "api_watch_product_baselines_document_key_nonempty" CHECK ("document_key" IS NULL OR length(btrim("document_key")) > 0),
  CONSTRAINT "api_watch_product_baselines_accepted_by_nonempty" CHECK (length(btrim("accepted_by")) > 0),
  CONSTRAINT "api_watch_product_baselines_acceptance_reference_nonempty" CHECK (length(btrim("acceptance_reference")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "api_watch_product_baselines_family_scope_unique"
  ON "api_watch_product_baselines" ("source_family")
  WHERE "document_key" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "api_watch_product_baselines_document_scope_unique"
  ON "api_watch_product_baselines" ("source_family","document_key")
  WHERE "document_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "api_watch_product_baselines_snapshot_index"
  ON "api_watch_product_baselines" ("snapshot_id");
--> statement-breakpoint
CREATE FUNCTION api_watch_product_baseline_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot_family varchar(32);
DECLARE snapshot_document_key varchar(128);
BEGIN
  IF TG_OP='INSERT' AND NEW.revision<>1 THEN
    RAISE EXCEPTION 'api watch product baseline must start at revision 1' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.source_family IS DISTINCT FROM NEW.source_family
       OR OLD.document_key IS DISTINCT FROM NEW.document_key
    THEN
      RAISE EXCEPTION 'api watch product baseline scope is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.revision<>OLD.revision+1 THEN
      RAISE EXCEPTION 'api watch product baseline revision must advance by one' USING ERRCODE='23514';
    END IF;
  END IF;

  SELECT source_family,document_key
    INTO snapshot_family,snapshot_document_key
    FROM api_watch_snapshots
   WHERE snapshot_id=NEW.snapshot_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api watch product baseline snapshot not found' USING ERRCODE='23503';
  END IF;
  IF snapshot_family IS DISTINCT FROM NEW.source_family
     OR snapshot_document_key IS DISTINCT FROM NEW.document_key
  THEN
    RAISE EXCEPTION 'api watch product baseline snapshot scope mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER api_watch_product_baseline_scope_guard
BEFORE INSERT OR UPDATE ON "api_watch_product_baselines"
FOR EACH ROW EXECUTE FUNCTION api_watch_product_baseline_scope_guard();
--> statement-breakpoint
CREATE TABLE "api_watch_product_baseline_revisions" (
  "baseline_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "source_family" varchar(32) NOT NULL,
  "document_key" varchar(128),
  "previous_snapshot_id" varchar(160),
  "snapshot_id" varchar(160) NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  "accepted_by" varchar(128) NOT NULL,
  "acceptance_reference" varchar(256) NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "api_watch_product_baseline_revisions_pk" PRIMARY KEY ("baseline_id","revision"),
  CONSTRAINT "api_watch_product_baseline_revisions_baseline_fk" FOREIGN KEY ("baseline_id") REFERENCES "api_watch_product_baselines"("baseline_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "api_watch_product_baseline_revisions_previous_snapshot_fk" FOREIGN KEY ("previous_snapshot_id") REFERENCES "api_watch_snapshots"("snapshot_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "api_watch_product_baseline_revisions_snapshot_fk" FOREIGN KEY ("snapshot_id") REFERENCES "api_watch_snapshots"("snapshot_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "api_watch_product_baseline_revisions_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_product_baseline_revisions_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "api_watch_product_baseline_revisions_transition_check" CHECK (
    ("revision" = 1 AND "previous_snapshot_id" IS NULL)
    OR ("revision" > 1 AND "previous_snapshot_id" IS NOT NULL)
  ),
  CONSTRAINT "api_watch_product_baseline_revisions_document_key_nonempty" CHECK ("document_key" IS NULL OR length(btrim("document_key")) > 0),
  CONSTRAINT "api_watch_product_baseline_revisions_accepted_by_nonempty" CHECK (length(btrim("accepted_by")) > 0),
  CONSTRAINT "api_watch_product_baseline_revisions_acceptance_reference_nonempty" CHECK (length(btrim("acceptance_reference")) > 0)
);
--> statement-breakpoint
CREATE INDEX "api_watch_product_baseline_revisions_scope_index"
  ON "api_watch_product_baseline_revisions" ("source_family","document_key","revision" DESC);
--> statement-breakpoint
CREATE INDEX "api_watch_product_baseline_revisions_snapshot_index"
  ON "api_watch_product_baseline_revisions" ("snapshot_id");
--> statement-breakpoint
CREATE FUNCTION api_watch_product_baseline_revision_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE baseline_family varchar(32);
DECLARE baseline_document_key varchar(128);
DECLARE baseline_snapshot_id varchar(160);
DECLARE baseline_revision integer;
DECLARE snapshot_family varchar(32);
DECLARE snapshot_document_key varchar(128);
DECLARE previous_family varchar(32);
DECLARE previous_document_key varchar(128);
DECLARE prior_revision_snapshot_id varchar(160);
BEGIN
  SELECT source_family,document_key,snapshot_id,revision
    INTO baseline_family,baseline_document_key,baseline_snapshot_id,baseline_revision
    FROM api_watch_product_baselines
   WHERE baseline_id=NEW.baseline_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api watch product baseline revision baseline not found' USING ERRCODE='23503';
  END IF;
  IF baseline_family IS DISTINCT FROM NEW.source_family
     OR baseline_document_key IS DISTINCT FROM NEW.document_key
     OR baseline_snapshot_id IS DISTINCT FROM NEW.snapshot_id
     OR baseline_revision IS DISTINCT FROM NEW.revision
  THEN
    RAISE EXCEPTION 'api watch product baseline revision does not match current pointer' USING ERRCODE='23514';
  END IF;

  SELECT source_family,document_key
    INTO snapshot_family,snapshot_document_key
    FROM api_watch_snapshots
   WHERE snapshot_id=NEW.snapshot_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api watch product baseline revision snapshot not found' USING ERRCODE='23503';
  END IF;
  IF snapshot_family IS DISTINCT FROM NEW.source_family
     OR snapshot_document_key IS DISTINCT FROM NEW.document_key
  THEN
    RAISE EXCEPTION 'api watch product baseline revision snapshot scope mismatch' USING ERRCODE='23514';
  END IF;

  IF NEW.revision>1 THEN
    SELECT snapshot_id
      INTO prior_revision_snapshot_id
      FROM api_watch_product_baseline_revisions
     WHERE baseline_id=NEW.baseline_id
       AND revision=NEW.revision-1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'api watch product baseline prior revision missing' USING ERRCODE='23514';
    END IF;
    IF prior_revision_snapshot_id IS DISTINCT FROM NEW.previous_snapshot_id THEN
      RAISE EXCEPTION 'api watch product baseline previous snapshot does not match prior revision' USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.previous_snapshot_id IS NOT NULL THEN
    SELECT source_family,document_key
      INTO previous_family,previous_document_key
      FROM api_watch_snapshots
     WHERE snapshot_id=NEW.previous_snapshot_id
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'api watch product baseline previous snapshot not found' USING ERRCODE='23503';
    END IF;
    IF previous_family IS DISTINCT FROM NEW.source_family
       OR previous_document_key IS DISTINCT FROM NEW.document_key
    THEN
      RAISE EXCEPTION 'api watch product baseline previous snapshot scope mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER api_watch_product_baseline_revision_scope_guard
BEFORE INSERT ON "api_watch_product_baseline_revisions"
FOR EACH ROW EXECUTE FUNCTION api_watch_product_baseline_revision_scope_guard();
--> statement-breakpoint
CREATE FUNCTION api_watch_product_baseline_history_consistency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM api_watch_product_baseline_revisions revision_row
     WHERE revision_row.baseline_id=NEW.baseline_id
       AND revision_row.revision=NEW.revision
       AND revision_row.source_family IS NOT DISTINCT FROM NEW.source_family
       AND revision_row.document_key IS NOT DISTINCT FROM NEW.document_key
       AND revision_row.snapshot_id=NEW.snapshot_id
       AND revision_row.accepted_at=NEW.accepted_at
       AND revision_row.accepted_by=NEW.accepted_by
       AND revision_row.acceptance_reference=NEW.acceptance_reference
  ) THEN
    RAISE EXCEPTION 'api watch product baseline requires matching audit history' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER api_watch_product_baseline_history_consistency_guard
AFTER INSERT OR UPDATE ON "api_watch_product_baselines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION api_watch_product_baseline_history_consistency_guard();
--> statement-breakpoint
CREATE FUNCTION api_watch_product_baseline_revision_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'api watch product baseline revisions are append-only' USING ERRCODE='55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER api_watch_product_baseline_revision_guard
BEFORE UPDATE OR DELETE ON "api_watch_product_baseline_revisions"
FOR EACH ROW EXECUTE FUNCTION api_watch_product_baseline_revision_immutable_guard();
--> statement-breakpoint
CREATE TRIGGER api_watch_product_baseline_revision_truncate_guard
BEFORE TRUNCATE ON "api_watch_product_baseline_revisions"
FOR EACH STATEMENT EXECUTE FUNCTION api_watch_product_baseline_revision_immutable_guard();
--> statement-breakpoint
CREATE FUNCTION api_watch_product_baseline_snapshot_scope_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_family IS NOT DISTINCT FROM NEW.source_family
     AND OLD.document_key IS NOT DISTINCT FROM NEW.document_key
  THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM api_watch_product_baselines baseline
     WHERE baseline.snapshot_id=OLD.snapshot_id
  ) OR EXISTS (
    SELECT 1
      FROM api_watch_product_baseline_revisions revision_row
     WHERE revision_row.snapshot_id=OLD.snapshot_id
        OR revision_row.previous_snapshot_id=OLD.snapshot_id
  ) THEN
    RAISE EXCEPTION 'accepted api watch product baseline snapshot scope is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER api_watch_product_baseline_snapshot_scope_immutable_guard
BEFORE UPDATE OF source_family,document_key ON "api_watch_snapshots"
FOR EACH ROW EXECUTE FUNCTION api_watch_product_baseline_snapshot_scope_immutable_guard();
