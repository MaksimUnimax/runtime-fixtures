import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInMemorySwaggerSourceState,
  createSwaggerHandoffService,
  InMemorySwaggerSourceStore,
} from "./swagger-handoff.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(
    join(tmpdir(), "octoport-quarantine-storage-"),
  );
  directories.push(directory);
  const store = new InMemorySwaggerSourceStore(
    createInMemorySwaggerSourceState(),
  );
  const request = await store.createRequest({
    requestId: "storage-request",
    sourceFamily: "OZON_SELLER",
    officialUrl: "https://example.test/source.json",
    expectedArtifactType: "OPENAPI_OR_SWAGGER",
    blockerReason: "test",
  });
  const service = () =>
    createSwaggerHandoffService({ store, quarantineDir: directory });
  const input = {
    requestId: request.requestId,
    operatorId: "fixture",
    originalFilename: "source.json",
    bytes: Buffer.from(
      '{"openapi":"3.0.3","info":{"title":"Fixture","version":"1"},"paths":{}}',
    ),
  };
  return { directory, store, service, input };
}
describe("quarantine retry and uncertain registration", () => {
  it("retains one retry payload through three rejected saves and service recreation", async () => {
    const f = await fixture();
    const save = vi
      .spyOn(f.store, "saveArtifact")
      .mockRejectedValue(new Error("DATABASE_SAVE_FAILED"));
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(f.service().upload(f.input)).rejects.toThrow(
        "DATABASE_SAVE_FAILED",
      );
      expect(await readdir(f.directory)).toHaveLength(1);
      expect((await readdir(f.directory))[0]).toMatch(
        /^request-[0-9a-f]{64}\.upload$/,
      );
    }
    expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(0);
    save.mockRestore();
    expect((await f.service().upload(f.input)).kind).toBe("CANDIDATE_READY");
    expect(await readdir(f.directory)).toHaveLength(1);
    expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(1);
  });
  it("reconciles commit followed by lost acknowledgement without removing registered bytes", async () => {
    const f = await fixture();
    const original = f.store.saveArtifact.bind(f.store);
    vi.spyOn(f.store, "saveArtifact").mockImplementation(async (artifact) => {
      await original(artifact);
      throw new Error("ACK_LOST");
    });
    const result = await f.service().upload(f.input);
    expect(result.kind).toBe("DUPLICATE");
    const [artifact] = await f.store.listArtifacts(f.input.requestId);
    expect(
      await readFile(join(f.directory, artifact!.quarantineFilename)),
    ).toEqual(f.input.bytes);
    expect((await f.store.getRequest(f.input.requestId))?.status).toBe(
      "CANDIDATE_READY",
    );
  });
  it("keeps bytes when both commit acknowledgement and reconciliation are unavailable", async () => {
    const f = await fixture();
    const original = f.store.saveArtifact.bind(f.store);
    const save = vi
      .spyOn(f.store, "saveArtifact")
      .mockImplementation(async (artifact) => {
        await original(artifact);
        vi.spyOn(f.store, "findArtifactByDigest").mockRejectedValue(
          new Error("LOOKUP_DOWN"),
        );
        throw new Error("ACK_LOST");
      });
    await expect(f.service().upload(f.input)).rejects.toThrow("ACK_LOST");
    expect(await readdir(f.directory)).toHaveLength(1);
    save.mockRestore();
    vi.restoreAllMocks();
    expect((await f.service().upload(f.input)).kind).toBe("DUPLICATE");
    const [artifact] = await f.store.listArtifacts(f.input.requestId);
    expect(
      await readFile(join(f.directory, artifact!.quarantineFilename)),
    ).toEqual(f.input.bytes);
  });
  it.each(["QUARANTINED", "CANDIDATE_READY"] as const)(
    "recovers after failed %s status update",
    async (status) => {
      const f = await fixture();
      const original = f.store.setRequestStatus.bind(f.store);
      const update = vi
        .spyOn(f.store, "setRequestStatus")
        .mockImplementation(async (id, next) => {
          if (next === status) throw new Error("STATUS_FAILED");
          await original(id, next);
        });
      for (let attempt = 0; attempt < 3; attempt++)
        await expect(f.service().upload(f.input)).rejects.toThrow(
          "STATUS_FAILED",
        );
      expect(await readdir(f.directory)).toHaveLength(1);
      update.mockRestore();
      await f.service().upload(f.input);
      expect((await f.store.getRequest(f.input.requestId))?.status).toBe(
        "CANDIDATE_READY",
      );
      expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(1);
    },
  );
  it("does not overwrite a pending upload with different bytes", async () => {
    const f = await fixture();
    vi.spyOn(f.store, "saveArtifact").mockRejectedValue(
      new Error("DATABASE_SAVE_FAILED"),
    );
    await expect(f.service().upload(f.input)).rejects.toThrow(
      "DATABASE_SAVE_FAILED",
    );
    await expect(
      f.service().upload({ ...f.input, bytes: Buffer.from("different") }),
    ).rejects.toThrow("QUARANTINE_PENDING_UPLOAD_MISMATCH");
    const [name] = await readdir(f.directory);
    expect(await readFile(join(f.directory, name!))).toEqual(f.input.bytes);
  });
  it("concurrent identical uploads share one complete payload and one registration", async () => {
    const f = await fixture();
    const results = await Promise.all([
      f.service().upload(f.input),
      f.service().upload(f.input),
    ]);
    expect(results.map((x) => x.kind).sort()).toEqual([
      "CANDIDATE_READY",
      "DUPLICATE",
    ]);
    expect(await readdir(f.directory)).toHaveLength(1);
    expect(await f.store.listArtifacts(f.input.requestId)).toHaveLength(1);
  });
});
