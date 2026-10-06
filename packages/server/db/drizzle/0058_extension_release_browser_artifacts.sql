ALTER TABLE extension_release_browsers
  ADD COLUMN artifact_sha256 varchar(64);
--> statement-breakpoint
ALTER TABLE extension_release_browsers
  ADD CONSTRAINT extension_release_browsers_artifact_sha256_format
  CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-f]{64}$');
