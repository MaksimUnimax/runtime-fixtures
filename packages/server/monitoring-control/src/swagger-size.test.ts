import { describe, expect, it } from "vitest";
import {
  createPostgresSwaggerSourceStore,
  MAX_SWAGGER_UPLOAD_BYTES,
  type SwaggerSourceSqlRuntime,
} from "./swagger-handoff.js";
function store(sizeBytes: unknown) {
  const row = {
    sourceFamily: "WILDBERRIES",
    status: "CANDIDATE_READY",
    parserResult: {},
    validationResult: {},
    receivedAt: new Date(),
    sizeBytes,
  };
  const runtime = {
    query: async () => ({ rows: [row] }),
    transaction: async () => {
      throw new Error("unused");
    },
  } as unknown as SwaggerSourceSqlRuntime;
  return createPostgresSwaggerSourceStore(runtime);
}
describe("review main109ce9df PostgreSQL bigint artifact size", () => {
  it("maps the native driver bigint string to a strict number", async () => {
    const [artifact] = await store("4494").listArtifacts("synthetic");
    expect(artifact?.sizeBytes).toBe(4494);
  });
  it.each([
    "-1",
    "1.5",
    "9007199254740992",
    "",
    "NaN",
    String(MAX_SWAGGER_UPLOAD_BYTES + 1),
  ])("fails closed for invalid persisted size %s", async (size) => {
    await expect(store(size).listArtifacts("synthetic")).rejects.toThrow(
      "SWAGGER_ARTIFACT_SIZE_INVALID",
    );
  });
});
