import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../drizzle/0032_s1_signing_reason_contract_guard.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("./schema/remote-config.ts", import.meta.url),
  "utf8",
);
const journal = readFileSync(
  new URL("../drizzle/meta/_journal.json", import.meta.url),
  "utf8",
);

it("defines the forward-only NOT VALID signing reason guard", () => {
  expect(migration).toContain(
    'CONSTRAINT "signing_key_events_reason_code_contract"',
  );
  expect(migration).toMatch(/reason_code.*\^\[a-z0-9\].*NOT VALID/s);
  expect(migration).not.toMatch(/\b(UPDATE|DELETE)\b.*signing_key_events/i);
  expect(schema).toContain("signing_key_events_reason_code_contract");
  expect(journal).toContain("0032_s1_signing_reason_contract_guard");
});
