CREATE TABLE "api_watch_retry_state" (
  "source_family" varchar(32) PRIMARY KEY NOT NULL,
  "failure_episode_id" varchar(160) NOT NULL,
  "failure_class" varchar(16) NOT NULL,
  "retry_count" integer NOT NULL,
  "next_retry_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone NOT NULL,
  "last_result" varchar(80) NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "api_watch_retry_family_check" CHECK ("source_family" IN ('OZON_SELLER','OZON_PERFORMANCE','WILDBERRIES')),
  CONSTRAINT "api_watch_retry_class_check" CHECK ("failure_class" IN ('NETWORK','TIMEOUT','HTTP_5XX','HTTP_429')),
  CONSTRAINT "api_watch_retry_count_check" CHECK ("retry_count" >= 0 AND "retry_count" <= 2)
);
