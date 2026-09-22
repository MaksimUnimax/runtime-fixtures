ALTER TABLE "signing_key_events"
  ADD CONSTRAINT "signing_key_events_reason_code_contract"
  CHECK (
    "reason_code" IS NULL
    OR "reason_code" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ) NOT VALID;
