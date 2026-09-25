DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "device_authorizations"
    WHERE ("browser_family" IS NULL AND ("browser_version" IS NOT NULL OR "extension_version" IS NOT NULL))
       OR ("browser_family" IS NOT NULL AND "extension_version" IS NULL)
  ) THEN
    RAISE EXCEPTION 'device_authorizations client metadata shape invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "devices"
    WHERE ("browser_family" IS NULL AND ("browser_version_last_seen" IS NOT NULL OR "extension_version_last_seen" IS NOT NULL))
       OR ("browser_family" IS NOT NULL AND "extension_version_last_seen" IS NULL)
  ) THEN
    RAISE EXCEPTION 'devices client metadata shape invalid';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "device_authorizations" ALTER COLUMN "browser_family" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "browser_family" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "device_authorizations"
  ADD CONSTRAINT "device_authorizations_client_metadata_shape"
  CHECK (
    ("browser_family" IS NULL AND "browser_version" IS NULL AND "extension_version" IS NULL)
    OR
    ("browser_family" IS NOT NULL AND "extension_version" IS NOT NULL)
  );
--> statement-breakpoint
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_client_metadata_shape"
  CHECK (
    ("browser_family" IS NULL AND "browser_version_last_seen" IS NULL AND "extension_version_last_seen" IS NULL)
    OR
    ("browser_family" IS NOT NULL AND "extension_version_last_seen" IS NOT NULL)
  );
