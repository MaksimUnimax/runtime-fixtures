import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileTelegramInboundJournal } from "./inbound-journal.js";

const dirs: string[] = [];
async function fixture(initial = 0, pending: number | null = null) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "octo-tg-inbound-"));
  dirs.push(dir);
  const filename = path.join(dir, "telegram-inbound-journal.json");
  if (initial !== -1) {
    await fs.writeFile(
      filename,
      JSON.stringify({
        schemaVersion: 1,
        nextOffset: initial,
        inFlightUpdateId: pending,
      }) + "\n",
      { mode: 0o600 },
    );
  }
  return { dir, filename };
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("durable inbound Telegram dispatch fence (no network)", () => {
  it("requires an explicitly migrated cursor and never silently initializes at zero", async () => {
    const { filename } = await fixture(-1);
    const journal = new FileTelegramInboundJournal(filename);
    await expect(journal.open()).rejects.toThrow(
      "TELEGRAM_INBOUND_JOURNAL_UNAVAILABLE",
    );
    await expect(fs.stat(filename)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(filename + ".lock")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("syncs UNKNOWN before dispatch and completed cursor before the next update", async () => {
    const { filename } = await fixture(4);
    const journal = new FileTelegramInboundJournal(filename);
    expect(await journal.open()).toBe(4);
    await journal.begin(5);
    const inFlight = JSON.parse(await fs.readFile(filename, "utf8"));
    expect(inFlight).toEqual({
      schemaVersion: 1,
      nextOffset: 6,
      inFlightUpdateId: 5,
    });
    await journal.complete(5);
    await journal.advance(9);
    expect(JSON.parse(await fs.readFile(filename, "utf8"))).toEqual({
      schemaVersion: 1,
      nextOffset: 9,
      inFlightUpdateId: null,
    });
    await journal.close();

    const restarted = new FileTelegramInboundJournal(filename);
    expect(await restarted.open()).toBe(9);
    await expect(restarted.begin(5)).rejects.toThrow("TELEGRAM_INBOUND_REPLAY");
    await restarted.begin(9);
    await restarted.complete(9);
    await restarted.close();
  });

  it("retains an uncertain in-flight result and refuses replay after restart", async () => {
    const { filename } = await fixture(2);
    const original = new FileTelegramInboundJournal(filename);
    await original.open();
    await original.begin(2);
    await original.close();
    const restarted = new FileTelegramInboundJournal(filename);
    await expect(restarted.open()).rejects.toThrow(
      "TELEGRAM_INBOUND_OUTCOME_UNKNOWN",
    );
    expect(
      JSON.parse(await fs.readFile(filename, "utf8")).inFlightUpdateId,
    ).toBe(2);
    await expect(fs.stat(filename + ".lock")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not let simultaneous in-process writers claim two dispatches", async () => {
    const { filename } = await fixture(6);
    const journal = new FileTelegramInboundJournal(filename);
    await journal.open();
    const [first, second] = await Promise.allSettled([
      journal.begin(6),
      journal.begin(7),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    if (second.status === "rejected") {
      expect(String(second.reason)).toContain(
        "TELEGRAM_INBOUND_JOURNAL_CONCURRENT_MUTATION",
      );
    }
    expect(JSON.parse(await fs.readFile(filename, "utf8"))).toMatchObject({
      nextOffset: 7,
      inFlightUpdateId: 6,
    });
    await journal.complete(6);
    await journal.close();
  });

  it("rejects a second process/session while the first owns the lock", async () => {
    const { filename } = await fixture(10);
    const first = new FileTelegramInboundJournal(filename);
    const second = new FileTelegramInboundJournal(filename);
    await first.open();
    await expect(second.open()).rejects.toThrow(
      "TELEGRAM_INBOUND_JOURNAL_LOCKED",
    );
    await first.close();
    expect(await second.open()).toBe(10);
    await second.close();
  });

  it("prevents stale PID takeover after a real abrupt child-process termination", async () => {
    const { filename } = await fixture(10);
    const moduleUrl = new URL("./inbound-journal.ts", import.meta.url).href;
    const script = [
      "import {FileTelegramInboundJournal} from " +
        JSON.stringify(moduleUrl) +
        ";",
      "const journal=new FileTelegramInboundJournal(" +
        JSON.stringify(filename) +
        ");",
      "await journal.open();",
      "process.stdout.write('READY\\n');",
      "setInterval(()=>{},1000);",
    ].join("\n");
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", script],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let observed = "";
    let failure = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      observed += data;
    });
    child.stderr.on("data", (data: string) => {
      failure += data;
    });
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          const poll = setInterval(() => {
            if (observed.includes("READY")) {
              clearInterval(poll);
              resolve();
            } else if (child.exitCode !== null) {
              clearInterval(poll);
              reject(
                new Error("child exited before lock: " + failure.slice(0, 300)),
              );
            }
          }, 10);
          poll.unref();
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("fixture child did not acquire lock")),
            2000,
          ),
        ),
      ]);
      await expect(
        new FileTelegramInboundJournal(filename).open(),
      ).rejects.toThrow("TELEGRAM_INBOUND_JOURNAL_LOCKED");
    } finally {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => {});
    }
    await expect(
      new FileTelegramInboundJournal(filename).open(),
    ).rejects.toThrow("TELEGRAM_INBOUND_JOURNAL_LOCKED");
  });

  it("refuses invalid state, symlinks, unsafe permissions and unexpected path", async () => {
    const { filename, dir } = await fixture(0);
    await fs.writeFile(
      filename,
      '{"schemaVersion":1,"nextOffset":0,"inFlightUpdateId":0}\n',
    );
    await expect(
      new FileTelegramInboundJournal(filename).open(),
    ).rejects.toThrow("TELEGRAM_INBOUND_JOURNAL_INVALID");
    await fs.writeFile(filename, "INVALID JSON\n");
    await expect(
      new FileTelegramInboundJournal(filename).open(),
    ).rejects.toThrow("TELEGRAM_INBOUND_JOURNAL_INVALID");
    await fs.writeFile(
      filename,
      '{"schemaVersion":1,"nextOffset":0,"inFlightUpdateId":null}\n',
    );
    await fs.chmod(filename, 0o644);
    await expect(
      new FileTelegramInboundJournal(filename).open(),
    ).rejects.toThrow("TELEGRAM_INBOUND_JOURNAL_UNSAFE");
    await fs.chmod(filename, 0o600);
    await fs.rename(filename, filename + ".source");
    await fs.symlink(filename + ".source", filename);
    await expect(
      new FileTelegramInboundJournal(filename).open(),
    ).rejects.toThrow("TELEGRAM_INBOUND_JOURNAL_UNAVAILABLE");
    expect(
      () => new FileTelegramInboundJournal(path.join(dir, "wrong.json")),
    ).toThrow("TELEGRAM_INBOUND_JOURNAL_PATH_INVALID");
  });

  it("notices unexpected record replacement before writing a new dispatch fence", async () => {
    const { filename } = await fixture(5);
    const journal = new FileTelegramInboundJournal(filename);
    await journal.open();
    await fs.writeFile(
      filename,
      '{"schemaVersion":1,"nextOffset":999,"inFlightUpdateId":null}\n',
    );
    await expect(journal.begin(5)).rejects.toThrow(
      "TELEGRAM_INBOUND_JOURNAL_WRITE_UNKNOWN",
    );
    expect(JSON.parse(await fs.readFile(filename, "utf8")).nextOffset).toBe(
      999,
    );
    await journal.close();
  });
});
