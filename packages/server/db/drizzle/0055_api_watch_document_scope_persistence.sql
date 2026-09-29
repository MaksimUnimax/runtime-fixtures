ALTER TABLE "api_watch_product_crosswalk"
  ADD COLUMN "document_key" varchar(128);
--> statement-breakpoint
ALTER TABLE "api_watch_product_crosswalk"
  ADD CONSTRAINT "api_watch_product_crosswalk_document_key_nonempty"
  CHECK ("document_key" IS NULL OR length(btrim("document_key")) > 0);
--> statement-breakpoint
ALTER TABLE "api_watch_incidents"
  ADD COLUMN "document_key" varchar(128);
--> statement-breakpoint
ALTER TABLE "api_watch_incidents"
  ADD CONSTRAINT "api_watch_incidents_document_key_nonempty"
  CHECK ("document_key" IS NULL OR length(btrim("document_key")) > 0);
