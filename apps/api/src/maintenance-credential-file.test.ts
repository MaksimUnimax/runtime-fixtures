import { afterEach, describe, expect, it } from "vitest";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaintenanceCredentialFileStore } from "./maintenance-credential-file.js";

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "maintenance-file-"));
  directories.push(directory);
  const destination = join(directory, "credential.json");
  return {
    directory,
    destination,
    store: createMaintenanceCredentialFileStore(destination),
  };
}
const credential = {
  token: "synthetic-private-maintenance-credential",
  expiresAt: "2030-02-01T00:00:00.000Z",
  rotatedAt: "2030-01-01T00:00:00.000Z",
};
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});
describe("private server maintenance credential publication", () => {
  it("publishes one complete private file, never a partial final file", async () => {
    const f = await fixture();
    const reservation = await f.store.reserve();
    await expect(lstat(f.destination)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await reservation.publish(credential);
    expect(JSON.parse(await readFile(f.destination, "utf8"))).toEqual({
      version: 1,
      origin: "https://api.octoport.ru",
      ...credential,
    });
    const info = await lstat(f.destination);
    expect(info.mode & 0o777).toBe(0o600);
    expect(info.uid).toBe(process.getuid?.());
    expect(info.isFile()).toBe(true);
    await expect(lstat(f.destination + ".pending")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(f.store.reserve()).rejects.toThrow("already exists");
  });
  it("excludes concurrent issuance and releases a cancelled reservation", async () => {
    const f = await fixture();
    const first = await f.store.reserve();
    await expect(f.store.reserve()).rejects.toMatchObject({ code: "EEXIST" });
    await first.abort();
    const second = await f.store.reserve();
    await second.abort();
    await expect(lstat(f.destination + ".pending")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("rejects a public directory and destination symlink without changing its target", async () => {
    const f = await fixture();
    await chmod(f.directory, 0o755);
    await expect(f.store.reserve()).rejects.toThrow("not private");
    await chmod(f.directory, 0o700);
    const target = join(f.directory, "existing");
    await writeFile(target, "keep");
    await symlink(target, f.destination);
    await expect(f.store.reserve()).rejects.toThrow("already exists");
    expect(await readFile(target, "utf8")).toBe("keep");
  });
  it("does not overwrite or delete a destination appearing during issuance", async () => {
    const f = await fixture();
    const reservation = await f.store.reserve();
    await writeFile(f.destination, "existing-credential", { mode: 0o600 });
    await expect(reservation.publish(credential)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await reservation.abort();
    expect(await readFile(f.destination, "utf8")).toBe("existing-credential");
  });
});
