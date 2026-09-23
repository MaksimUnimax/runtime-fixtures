import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(name: string): Promise<string> {
  return readFile(new URL(`./${name}`, import.meta.url), "utf8");
}

describe("TG4 Stream-2 upload security review", () => {
  it("has no executable upload path", async () => {
    const handoff = await source(
      "../../../packages/server/monitoring-control/src/swagger-handoff.ts",
    );
    expect(handoff).not.toMatch(
      /\beval\s*\(|new Function|child_process|execFile|spawn\(/,
    );
  });

  it("uses generated quarantine names and never shells out with filenames", async () => {
    const handoff = await source(
      "../../../packages/server/monitoring-control/src/swagger-handoff.ts",
    );
    expect(handoff).toContain("randomUUID()");
    expect(handoff).toContain("basename(value)");
    expect(handoff).not.toMatch(/exec\(|spawn\(|shell:/);
  });

  it("does not persist Telegram credentials or unrelated message bodies", async () => {
    const handoff = await source(
      "../../../packages/server/monitoring-control/src/swagger-handoff.ts",
    );
    expect(handoff).not.toMatch(
      /TELEGRAM_BOT_TOKEN|session_cookie|private_chat|mail_password/i,
    );
    expect(handoff).not.toMatch(/console\.(log|error).*token/i);
  });

  it("keeps the authority boundary explicit", async () => {
    const handoff = await source(
      "../../../packages/server/monitoring-control/src/swagger-handoff.ts",
    );
    expect(handoff).toContain("OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE");
    expect(handoff).not.toMatch(
      /ACCEPTED_OFFICIAL_SOURCE|AUTO_PATCH_APPROVED|AUTHORITATIVE\s*=\s*true/,
    );
  });

  it("does not add heartbeat or Stream-1 execution authority", async () => {
    const telegram = await source("telegram.ts");
    expect(telegram).not.toMatch(
      /heartbeat|executionAuthority|bootstrapAuthority/i,
    );
  });

  it("does not log the bot token while downloading Telegram files", async () => {
    const client = await source("telegram-client.ts");
    expect(client).not.toMatch(/console\.(log|info|warn|error).*token/i);
    expect(client).not.toMatch(/logger.*token/i);
  });
});
