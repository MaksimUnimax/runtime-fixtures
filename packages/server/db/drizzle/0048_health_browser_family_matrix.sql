ALTER TABLE "health_profile_evaluations" DROP CONSTRAINT "health_profile_evaluations_browser_family";
--> statement-breakpoint
ALTER TABLE "health_profile_evaluations" ADD CONSTRAINT "health_profile_evaluations_browser_family" CHECK ("browser_family" IN ('chrome', 'yandex_chromium', 'opera', 'firefox', 'safari'));
