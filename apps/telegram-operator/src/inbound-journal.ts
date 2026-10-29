import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, rename, unlink } from "node:fs/promises";
import path from "node:path";

export type TelegramInboundJournal = {
  open(): Promise<number>;
  begin(updateId: number): Promise<void>;
  complete(updateId: number): Promise<void>;
  advance(nextOffset: number): Promise<void>;
  close(): Promise<void>;
};

export type TelegramInboundJournalRecord = {
  schemaVersion: 1;
  nextOffset: number;
  inFlightUpdateId: number | null;
};

const MAX_RECORD_BYTES = 4096;
const MAX_UPDATE_ID = Number.MAX_SAFE_INTEGER - 1;

function validOffset(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function decodeRecord(bytes: Buffer): TelegramInboundJournalRecord {
  if (bytes.length > MAX_RECORD_BYTES) {
    throw new Error("TELEGRAM_INBOUND_JOURNAL_INVALID");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("TELEGRAM_INBOUND_JOURNAL_INVALID");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      "inFlightUpdateId,nextOffset,schemaVersion"
  ) {
    throw new Error("TELEGRAM_INBOUND_JOURNAL_INVALID");
  }
  const record = value as Partial<TelegramInboundJournalRecord>;
  if (
    record.schemaVersion !== 1 ||
    !validOffset(record.nextOffset) ||
    (record.inFlightUpdateId !== null &&
      (!validOffset(record.inFlightUpdateId) ||
        record.inFlightUpdateId >= record.nextOffset))
  ) {
    throw new Error("TELEGRAM_INBOUND_JOURNAL_INVALID");
  }
  return record as TelegramInboundJournalRecord;
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// An externally approved migration must seed an existing bot's nextOffset
// before the new binary starts. Never auto-initialize a legacy cursor at zero.
// This class does not fetch updates, infer the backlog or mutate Telegram.
export class FileTelegramInboundJournal implements TelegramInboundJournal {
  private record: TelegramInboundJournalRecord | undefined;
  private recordDigest: string | undefined;
  private lockToken: string | undefined;
  private poisoned = false;
  private writing = false;
  private readonly parent: string;
  private readonly lockPath: string;
  private readonly filename: string;

  constructor(filename: string) {
    this.filename = filename;
    if (
      !path.isAbsolute(filename) ||
      path.basename(filename) !== "telegram-inbound-journal.json"
    ) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_PATH_INVALID");
    }
    this.parent = path.dirname(filename);
    this.lockPath = filename + ".lock";
  }

  private async readPinned(): Promise<Buffer> {
    let handle;
    try {
      handle = await open(
        this.filename,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.size < 2 ||
        stat.size > MAX_RECORD_BYTES ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
      ) {
        throw new Error("TELEGRAM_INBOUND_JOURNAL_UNSAFE");
      }
      const bytes = await handle.readFile();
      if (bytes.length !== stat.size)
        throw new Error("TELEGRAM_INBOUND_JOURNAL_CHANGED");
      const current = await lstat(this.filename);
      if (
        !current.isFile() ||
        current.ino !== stat.ino ||
        current.dev !== stat.dev
      ) {
        throw new Error("TELEGRAM_INBOUND_JOURNAL_CHANGED");
      }
      return bytes;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("TELEGRAM_INBOUND_")
      ) {
        throw error;
      }
      throw new Error("TELEGRAM_INBOUND_JOURNAL_UNAVAILABLE");
    } finally {
      await handle?.close();
    }
  }

  async open(): Promise<number> {
    if (this.lockToken || this.record) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_ALREADY_OPEN");
    }
    const parent = await lstat(this.parent).catch(() => {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_DIRECTORY_UNAVAILABLE");
    });
    if (
      !parent.isDirectory() ||
      (parent.mode & 0o022) !== 0 ||
      (process.getuid && parent.uid !== process.getuid())
    ) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_DIRECTORY_UNSAFE");
    }
    let lock;
    const token = randomUUID();
    try {
      lock = await open(
        this.lockPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
    } catch {
      // A crash leaves this lock deliberately sticky: no PID-based stale-lock
      // takeover, no second process and no accidental replay after restart.
      throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCKED");
    }
    this.lockToken = token;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, token }) + "\n");
      await lock.sync();
      const bytes = await this.readPinned();
      const record = decodeRecord(bytes);
      if (record.inFlightUpdateId !== null) {
        throw new Error("TELEGRAM_INBOUND_OUTCOME_UNKNOWN");
      }
      this.record = record;
      this.recordDigest = digest(bytes);
      this.poisoned = false;
      return record.nextOffset;
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      await lock.close();
    }
  }

  private async persist(next: TelegramInboundJournalRecord): Promise<void> {
    if (this.writing)
      throw new Error("TELEGRAM_INBOUND_JOURNAL_CONCURRENT_MUTATION");
    if (!this.record || !this.recordDigest || this.poisoned) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_NOT_READY");
    }
    this.writing = true;
    const bytes = Buffer.from(JSON.stringify(next) + "\n", "utf8");
    const temp = this.filename + ".tmp-" + randomUUID();
    let handle;
    try {
      const current = await this.readPinned();
      if (digest(current) !== this.recordDigest) {
        throw new Error("TELEGRAM_INBOUND_JOURNAL_CHANGED");
      }
      handle = await open(
        temp,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temp, this.filename);
      // fsync the containing directory: rename durability is part of the
      // pre-dispatch write barrier. An uncertain sync must stop the dispatcher.
      const directory = await open(
        this.parent,
        constants.O_RDONLY | constants.O_DIRECTORY,
      );
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      this.record = next;
      this.recordDigest = digest(bytes);
    } catch {
      this.poisoned = true;
      throw new Error("TELEGRAM_INBOUND_JOURNAL_WRITE_UNKNOWN");
    } finally {
      try {
        await handle?.close();
        await unlink(temp).catch(() => {});
      } finally {
        this.writing = false;
      }
    }
  }

  async begin(updateId: number): Promise<void> {
    if (!validOffset(updateId) || updateId > MAX_UPDATE_ID) {
      throw new Error("TELEGRAM_UPDATE_ID_INVALID");
    }
    if (!this.record || this.poisoned) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_NOT_READY");
    }
    if (this.record.inFlightUpdateId !== null) {
      throw new Error("TELEGRAM_INBOUND_OUTCOME_UNKNOWN");
    }
    if (updateId < this.record.nextOffset) {
      throw new Error("TELEGRAM_INBOUND_REPLAY");
    }
    await this.persist({
      schemaVersion: 1,
      nextOffset: updateId + 1,
      inFlightUpdateId: updateId,
    });
  }

  async complete(updateId: number): Promise<void> {
    if (
      !this.record ||
      this.poisoned ||
      this.record.inFlightUpdateId !== updateId
    ) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_NOT_READY");
    }
    await this.persist({
      schemaVersion: 1,
      nextOffset: this.record.nextOffset,
      inFlightUpdateId: null,
    });
  }

  async advance(nextOffset: number): Promise<void> {
    if (!validOffset(nextOffset)) {
      throw new Error("TELEGRAM_UPDATE_ID_INVALID");
    }
    if (
      !this.record ||
      this.poisoned ||
      this.record.inFlightUpdateId !== null
    ) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_NOT_READY");
    }
    if (nextOffset > this.record.nextOffset) {
      await this.persist({
        schemaVersion: 1,
        nextOffset,
        inFlightUpdateId: null,
      });
    }
  }

  async close(): Promise<void> {
    if (this.writing)
      throw new Error("TELEGRAM_INBOUND_JOURNAL_CONCURRENT_MUTATION");
    const token = this.lockToken;
    this.lockToken = undefined;
    this.record = undefined;
    this.recordDigest = undefined;
    if (!token) return;
    let actual: unknown;
    try {
      const info = await lstat(this.lockPath);
      if (!info.isFile() || (info.mode & 0o077) !== 0) {
        throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCK_CHANGED");
      }
      const handle = await open(
        this.lockPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        actual = JSON.parse(await handle.readFile("utf8"));
      } finally {
        await handle.close();
      }
    } catch {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCK_CHANGED");
    }
    if ((actual as { token?: unknown })?.token !== token) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCK_CHANGED");
    }
    await unlink(this.lockPath);
  }
}
