import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, rename, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";

export type TelegramInboundJournal = {
  open(): Promise<number>;
  begin(updateId: number): Promise<void>;
  complete(updateId: number): Promise<void>;
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
  private opening = false;
  private directory: FileHandle | undefined;
  private lockIdentity: { dev: number; ino: number } | undefined;
  private readonly parent: string;
  private readonly lockPath: string;
  private readonly filename: string;

  constructor(filename: string) {
    this.filename = filename;
    if (
      !path.isAbsolute(filename) ||
      path.normalize(filename) !== filename ||
      path.dirname(filename) === path.parse(filename).root ||
      path.basename(filename) !== "telegram-inbound-journal.json"
    ) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_PATH_INVALID");
    }
    this.parent = path.dirname(filename);
    this.lockPath = filename + ".lock";
  }

  // Node.js does not offer an openat-style relative rename. We therefore
  // require trusted same-uid ownership and reject any symlink component,
  // unsafe writable intermediate directory, or changed pinned directory.
  // Another hostile process running as the SAME uid is outside this threat
  // model. This code is not a substitute for a separately authorized cutover.
  private async assertSafeParent(): Promise<void> {
    const root = path.parse(this.parent).root;
    let component = root;
    for (const name of this.parent
      .slice(root.length)
      .split(path.sep)
      .filter(Boolean)) {
      component = path.join(component, name);
      let info;
      try {
        info = await lstat(component);
      } catch {
        throw new Error("TELEGRAM_INBOUND_JOURNAL_DIRECTORY_UNAVAILABLE");
      }
      const final = component === this.parent;
      const uid = process.getuid?.();
      const trustedOwner =
        info.uid === 0 || (uid !== undefined && info.uid === uid);
      const stickyRoot = !final && info.uid === 0 && (info.mode & 0o1000) !== 0;
      if (
        !info.isDirectory() ||
        !trustedOwner ||
        ((info.mode & 0o022) !== 0 && !stickyRoot) ||
        (final && uid !== undefined && info.uid !== uid)
      ) {
        throw new Error("TELEGRAM_INBOUND_JOURNAL_DIRECTORY_UNSAFE");
      }
    }
    if (this.directory) {
      const pinned = await this.directory.stat();
      const present = await lstat(this.parent);
      if (
        !present.isDirectory() ||
        pinned.ino !== present.ino ||
        pinned.dev !== present.dev
      ) {
        throw new Error("TELEGRAM_INBOUND_JOURNAL_DIRECTORY_CHANGED");
      }
    }
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
      // readFile() is not bounded if another writer grows the inode after
      // fstat. Read at most the configured cap + one byte, then recheck.
      const bounded = Buffer.alloc(MAX_RECORD_BYTES + 1);
      let used = 0;
      while (used < bounded.length) {
        const { bytesRead } = await handle.read(
          bounded,
          used,
          bounded.length - used,
          used,
        );
        if (bytesRead === 0) break;
        used += bytesRead;
      }
      const after = await handle.stat();
      const current = await lstat(this.filename);
      if (
        used > MAX_RECORD_BYTES ||
        used !== stat.size ||
        !after.isFile() ||
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs ||
        !current.isFile() ||
        current.ino !== stat.ino ||
        current.dev !== stat.dev ||
        after.ino !== stat.ino ||
        after.dev !== stat.dev
      ) {
        throw new Error("TELEGRAM_INBOUND_JOURNAL_CHANGED");
      }
      return bounded.subarray(0, used);
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
    if (this.opening || this.lockToken || this.record) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_ALREADY_OPEN");
    }
    // Synchronous fence before the first await: close() cannot unlink this
    // lock while initial state/ownership is still being established.
    this.opening = true;
    let lock: FileHandle | undefined;
    try {
      await this.assertSafeParent();
      this.directory = await open(
        this.parent,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      await this.assertSafeParent();
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
        // A crash leaves this lock deliberately sticky. An operator, not a
        // reused PID, determines when recovery is safe.
        throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCKED");
      }
      const lockInfo = await lock.stat();
      this.lockIdentity = { dev: lockInfo.dev, ino: lockInfo.ino };
      this.lockToken = token;
      await lock.writeFile(JSON.stringify({ pid: process.pid, token }) + "\n");
      await lock.sync();
      const bytes = await this.readPinned();
      const record = decodeRecord(bytes);
      if (record.inFlightUpdateId !== null) {
        throw new Error("TELEGRAM_INBOUND_OUTCOME_UNKNOWN");
      }
      await this.assertSafeParent();
      this.record = record;
      this.recordDigest = digest(bytes);
      this.poisoned = false;
      return record.nextOffset;
    } catch (error) {
      // Release only a fully verified *own* lock. If creation was disrupted,
      // leave it sticky instead of deleting an unknown person's lock.
      if (lock) {
        await lock.close();
        lock = undefined;
      }
      if (this.lockToken) {
        try {
          await this.releaseOwnLock();
        } catch {
          this.poisoned = true;
          throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCK_CHANGED");
        }
      }
      this.record = undefined;
      this.recordDigest = undefined;
      throw error;
    } finally {
      await lock?.close();
      if (!this.record && this.directory) {
        await this.directory.close();
        this.directory = undefined;
      }
      this.opening = false;
    }
  }

  private async persist(next: TelegramInboundJournalRecord): Promise<void> {
    if (this.writing)
      throw new Error("TELEGRAM_INBOUND_JOURNAL_CONCURRENT_MUTATION");
    if (
      !this.record ||
      !this.recordDigest ||
      this.poisoned ||
      !this.directory
    ) {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_NOT_READY");
    }
    this.writing = true;
    const bytes = Buffer.from(JSON.stringify(next) + "\n", "utf8");
    const temp = this.filename + ".tmp-" + randomUUID();
    let handle;
    try {
      await this.assertSafeParent();
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
      await this.assertSafeParent();
      await rename(temp, this.filename);
      // fsync the already pinned directory, not a newly resolved pathname.
      // If its pathname was replaced, fail closed rather than dispatch.
      await this.directory.sync();
      await this.assertSafeParent();
      this.record = next;
      this.recordDigest = digest(bytes);
    } catch {
      this.poisoned = true;
      throw new Error("TELEGRAM_INBOUND_JOURNAL_WRITE_UNKNOWN");
    } finally {
      try {
        await handle?.close();
        // Do not clean a temp path in a substituted directory.
        try {
          await this.assertSafeParent();
          await unlink(temp).catch(() => {});
        } catch {
          // Preserve uncertain files for authorized manual recovery.
        }
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
    // This source-only journal cannot prove that skipped IDs were observed by
    // Telegram getUpdates. Only the exact next expected ID may dispatch.
    // Any legitimate raw-page gap needs a separately reviewed source proof;
    // accepting an arbitrary larger ID here would silently skip commands.
    if (updateId !== this.record.nextOffset) {
      throw new Error("TELEGRAM_INBOUND_UPDATE_GAP_UNVERIFIED");
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

  // An inbound update can move progress only through begin()+complete().
  // There is deliberately no raw-page cursor advance API: a future migration
  // or unsupported-update policy needs separate source/owner acceptance.
  private async releaseOwnLock(): Promise<void> {
    const token = this.lockToken;
    if (!token) return;
    if (!this.lockIdentity || !this.directory)
      throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCK_CHANGED");
    let handle: FileHandle | undefined;
    try {
      await this.assertSafeParent();
      handle = await open(
        this.lockPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const info = await handle.stat();
      const current = await lstat(this.lockPath);
      if (
        !info.isFile() ||
        !current.isFile() ||
        (info.mode & 0o077) !== 0 ||
        (process.getuid && info.uid !== process.getuid()) ||
        info.ino !== current.ino ||
        info.dev !== current.dev ||
        info.ino !== this.lockIdentity.ino ||
        info.dev !== this.lockIdentity.dev ||
        info.size > 512
      ) {
        throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCK_CHANGED");
      }
      const bounded = Buffer.alloc(513);
      const { bytesRead } = await handle.read(bounded, 0, bounded.length, 0);
      if (bytesRead > 512)
        throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCK_CHANGED");
      const actual = JSON.parse(
        bounded.subarray(0, bytesRead).toString("utf8"),
      ) as {
        token?: unknown;
      };
      if (actual.token !== token)
        throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCK_CHANGED");
      await this.assertSafeParent();
      await unlink(this.lockPath);
      await this.directory.sync();
      this.lockToken = undefined;
      this.lockIdentity = undefined;
    } catch {
      throw new Error("TELEGRAM_INBOUND_JOURNAL_LOCK_CHANGED");
    } finally {
      await handle?.close();
    }
  }

  async close(): Promise<void> {
    if (this.opening)
      throw new Error("TELEGRAM_INBOUND_JOURNAL_OPEN_IN_PROGRESS");
    if (this.writing)
      throw new Error("TELEGRAM_INBOUND_JOURNAL_CONCURRENT_MUTATION");
    await this.releaseOwnLock();
    this.record = undefined;
    this.recordDigest = undefined;
    this.poisoned = false;
    if (this.directory) {
      await this.directory.close();
      this.directory = undefined;
    }
  }
}
