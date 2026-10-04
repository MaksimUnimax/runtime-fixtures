import { constants, type Stats } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export interface ServerMaintenanceCredential {
  token: string;
  expiresAt: string;
  rotatedAt: string;
}
export interface MaintenanceCredentialReservation {
  publish(credential: ServerMaintenanceCredential): Promise<void>;
  abort(): Promise<void>;
}
export interface MaintenanceCredentialStore {
  reserve(): Promise<MaintenanceCredentialReservation>;
}

// This is an operator-configured destination, never a path supplied by HTTP.
// The pending file also excludes concurrent issuances. A crash leaves it private
// for explicit recovery; it is never silently reused or overwritten.
export function createMaintenanceCredentialFileStore(
  destination: string,
): MaintenanceCredentialStore {
  if (!isAbsolute(destination) || resolve(destination) !== destination) {
    throw new Error("Maintenance credential destination must be absolute");
  }
  const parent = dirname(destination);
  const pending = destination + ".pending";
  return {
    async reserve() {
      const uid = process.getuid?.();
      const directory = await lstat(parent);
      if (
        uid === undefined ||
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        directory.uid !== uid ||
        (directory.mode & 0o077) !== 0 ||
        (await realpath(parent)) !== parent
      ) {
        throw new Error("Maintenance credential directory is not private");
      }
      try {
        await lstat(destination);
        throw new Error("Maintenance credential already exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const handle = await open(
        pending,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      let identity: Stats;
      try {
        identity = await handle.stat();
      } catch (error) {
        // No grant exists yet. Release an incomplete reservation on setup error.
        try {
          await handle.close();
        } catch {
          /* Continue cleanup. */
        }
        try {
          await unlink(pending);
        } catch {
          /* Preserve the original failure. */
        }
        throw error;
      }
      let closed = false;
      let published = false;
      let attempted = false;
      async function close() {
        if (!closed) {
          await handle.close();
          closed = true;
        }
      }
      async function syncDirectory() {
        const directoryHandle = await open(parent, constants.O_RDONLY);
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
      async function removeOwned(path: string) {
        let current;
        try {
          current = await lstat(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
          throw error;
        }
        if (
          !current.isFile() ||
          current.isSymbolicLink() ||
          current.dev !== identity.dev ||
          current.ino !== identity.ino
        ) {
          throw new Error("Maintenance credential file changed");
        }
        await unlink(path);
      }
      return {
        async publish(credential) {
          if (attempted || closed) {
            throw new Error("Maintenance credential reservation already used");
          }
          attempted = true;
          await handle.writeFile(
            JSON.stringify({
              version: 1,
              origin: "https://api.octoport.ru",
              ...credential,
            }) + "\n",
            "utf8",
          );
          await handle.sync();
          await close();
          // link is atomic and refuses an existing destination, unlike rename.
          await link(pending, destination);
          published = true;
          await syncDirectory();
          await removeOwned(pending);
          await syncDirectory();
        },
        async abort() {
          await close();
          if (published) await removeOwned(destination);
          await removeOwned(pending);
          await syncDirectory();
        },
      };
    },
  };
}
