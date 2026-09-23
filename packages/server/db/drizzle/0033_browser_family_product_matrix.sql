ALTER TYPE "public"."browser_family" ADD VALUE IF NOT EXISTS 'opera';--> statement-breakpoint
ALTER TYPE "public"."browser_family" ADD VALUE IF NOT EXISTS 'firefox';--> statement-breakpoint
ALTER TYPE "public"."browser_family" ADD VALUE IF NOT EXISTS 'safari';--> statement-breakpoint
ALTER TABLE "adapter_profile_assignments" DROP CONSTRAINT IF EXISTS "adapter_profile_assignments_browser_family";--> statement-breakpoint
ALTER TABLE "adapter_profile_assignments" ADD CONSTRAINT "adapter_profile_assignments_browser_family" CHECK ("browser_family"::text IN ('chrome', 'opera', 'yandex_chromium', 'firefox', 'safari'));--> statement-breakpoint
ALTER TABLE "health_runs" DROP CONSTRAINT IF EXISTS "health_runs_browser_family";--> statement-breakpoint
ALTER TABLE "health_runs" ADD CONSTRAINT "health_runs_browser_family" CHECK ("browser_family"::text IN ('chrome', 'opera', 'yandex_chromium', 'firefox', 'safari'));
