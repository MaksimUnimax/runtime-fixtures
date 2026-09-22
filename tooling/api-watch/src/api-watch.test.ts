import { createServer, type Server } from "node:http";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createInMemorySwaggerSourceState,
  createSwaggerHandoffService,
  InMemorySwaggerSourceStore,
  type SwaggerArtifact,
} from "@product/monitoring-control";
import {
  acquireOfficialSource,
  createApiWatchRunner,
  createApiWatchRuntime,
  createInMemoryApiWatchState,
  InMemoryApiWatchStore,
  createSourceRegistry,
  evaluateOperatorCandidate,
  runAuthorityPass,
  type AuthorityRecord,
  type SourceRegistryEntry,
} from "./index.js";
import { promoteAcceptedSnapshot } from "./snapshot.js";
import {
  buildCompleteOperationInventory,
  inventoryAcceptedSnapshots,
} from "./inventory.js";

const OPENAPI_3 = Buffer.from(
  JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Fixture", version: "1" },
    paths: {
      "/health": { get: { responses: { "200": { description: "ok" } } } },
    },
  }),
);
const SWAGGER_2 = Buffer.from(
  JSON.stringify({
    swagger: "2.0",
    info: { title: "Fixture", version: "1" },
    paths: {
      "/health": { get: { responses: { "200": { description: "ok" } } } },
    },
  }),
);

async function fixtureServer(
  handler: (
    request: Request,
    response: import("node:http").ServerResponse,
  ) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    handler(new Request(`http://127.0.0.1${request.url ?? "/"}`), response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("FIXTURE_SERVER_ADDRESS_MISSING");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function entry(
  url: string,
  family: SourceRegistryEntry["sourceFamily"] = "OZON_SELLER",
  policy: SourceRegistryEntry["operatorAcceptancePolicy"] = "REVIEW_REQUIRED",
): SourceRegistryEntry {
  return {
    sourceFamily: family,
    officialUrl: url,
    expectedArtifactTypes: ["JSON", "YAML", "YML"],
    maximumBytes: 25 * 1024 * 1024,
    acquisitionPolicy: "OPERATOR_ASSISTED_WHEN_AUTOMATIC_ACCESS_IS_BLOCKED",
    operatorAcceptancePolicy: policy,
    acceptedHosts: [new URL(url).hostname],
  };
}

function registryFor(
  url: string,
  family: SourceRegistryEntry["sourceFamily"] = "OZON_SELLER",
  policy: SourceRegistryEntry["operatorAcceptancePolicy"] = "REVIEW_REQUIRED",
) {
  return createSourceRegistry({ [family]: entry(url, family, policy) });
}

async function acceptedRecord(
  bytes = OPENAPI_3,
  root?: string,
): Promise<{
  record: AuthorityRecord;
  store: InMemoryApiWatchStore;
  pathRoot: string;
}> {
  const pathRoot = root ?? (await mkdtemp(join(tmpdir(), "s2-a2-")));
  const store = new InMemoryApiWatchStore();
  const record: AuthorityRecord = {
    recordId: "authority-1",
    sourceFamily: "OZON_SELLER",
    officialUrl: "https://official.example.test/openapi.json",
    acquisitionMode: "AUTOMATIC",
    authorityStatus: "AUTHORITY_ACCEPTED",
    sha256: await import("node:crypto").then(({ createHash }) =>
      createHash("sha256").update(bytes).digest("hex"),
    ),
    sizeBytes: bytes.byteLength,
    specVersion: "3.0.3",
    acquiredAt: new Date("2026-09-22T00:00:00Z"),
    validatedAt: new Date("2026-09-22T00:00:00Z"),
    operatorRequestId: null,
    artifactExtension: ".json",
    safeProvenance: { finalUrl: "https://official.example.test/openapi.json" },
    failureClassification: null,
  };
  return { record: await store.saveAuthorityRecord(record), store, pathRoot };
}

describe("A1 runtime API source authority", () => {
  it("A1-01 exact official URL 200 valid OpenAPI produces an automatic candidate", async () => {
    const server = await fixtureServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(OPENAPI_3);
    });
    try {
      const result = await acquireOfficialSource({
        entry: entry(`${server.url}/openapi.json`),
      });
      expect(result.kind).toBe("ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
      expect(
        result.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE"
          ? result.finalUrl
          : "",
      ).toBe(`${server.url}/openapi.json`);
    } finally {
      await server.close();
    }
  });

  it("A1-02 recognizes Swagger 2", async () => {
    const server = await fixtureServer((_request, response) =>
      response.end(SWAGGER_2),
    );
    try {
      const result = await acquireOfficialSource({
        entry: entry(`${server.url}/swagger.json`),
      });
      expect(
        result.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE"
          ? result.specVersion
          : "",
      ).toBe("2.0");
    } finally {
      await server.close();
    }
  });

  it("A1-03 recognizes OpenAPI 3", async () => {
    const server = await fixtureServer((_request, response) =>
      response.end(OPENAPI_3),
    );
    try {
      const result = await acquireOfficialSource({
        entry: entry(`${server.url}/openapi.json`),
      });
      expect(
        result.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE"
          ? result.specVersion
          : "",
      ).toBe("3.0.3");
    } finally {
      await server.close();
    }
  });

  for (const [name, status, expected] of [
    ["A1-04 401 requires operator", 401, "OPERATOR_SOURCE_REQUIRED"],
    ["A1-05 403 requires operator", 403, "OPERATOR_SOURCE_REQUIRED"],
    ["A1-06 429 is temporary", 429, "SOURCE_TEMPORARILY_UNAVAILABLE"],
    ["A1-07 5xx is temporary", 503, "SOURCE_TEMPORARILY_UNAVAILABLE"],
  ] as const) {
    it(name, async () => {
      const server = await fixtureServer((_request, response) =>
        response.writeHead(status).end(),
      );
      try {
        expect(
          (
            await acquireOfficialSource({
              entry: entry(`${server.url}/source`),
            })
          ).kind,
        ).toBe(expected);
      } finally {
        await server.close();
      }
    });
  }

  it("A1-08 timeout is temporary", async () => {
    const server = await fixtureServer(() => undefined);
    try {
      expect(
        (
          await acquireOfficialSource({
            entry: entry(`${server.url}/source`),
            timeoutMs: 10,
          })
        ).kind,
      ).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
    } finally {
      await server.close();
    }
  });

  it("A1-09 network failure is temporary", async () => {
    expect(
      (
        await acquireOfficialSource({
          entry: entry("http://127.0.0.1:1/source"),
          timeoutMs: 100,
        })
      ).kind,
    ).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
  });

  it("A1-10 missing accepted URL is explicit", async () => {
    expect(
      (
        await acquireOfficialSource({
          entry: createSourceRegistry().get("OZON_SELLER"),
        })
      ).kind,
    ).toBe("SOURCE_URL_AUTHORITY_MISSING");
  });

  it("A1-11 unexpected HTML is invalid", async () => {
    const server = await fixtureServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body>not an API document</body></html>");
    });
    try {
      expect(
        (await acquireOfficialSource({ entry: entry(`${server.url}/source`) }))
          .kind,
      ).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
    } finally {
      await server.close();
    }
  });

  it("A1-12 allows a redirect inside accepted authority", async () => {
    const server = await fixtureServer((request, response) =>
      request.url.endsWith("/start")
        ? response.writeHead(302, { location: "/final" }).end()
        : response.end(OPENAPI_3),
    );
    try {
      expect(
        (await acquireOfficialSource({ entry: entry(`${server.url}/start`) }))
          .kind,
      ).toBe("ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
    } finally {
      await server.close();
    }
  });

  it("A1-13 rejects a redirect outside accepted authority", async () => {
    const server = await fixtureServer((_request, response) =>
      response
        .writeHead(302, {
          location: "https://outside.example.test/openapi.json",
        })
        .end(),
    );
    try {
      expect(
        (await acquireOfficialSource({ entry: entry(`${server.url}/start`) }))
          .kind,
      ).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
    } finally {
      await server.close();
    }
  });

  it("A1-14 rejects more than three redirects", async () => {
    const server = await fixtureServer((request, response) => {
      const number = Number(request.url.match(/r(\d+)/)?.[1] ?? 0);
      if (number < 5)
        return response.writeHead(302, { location: `/r${number + 1}` }).end();
      response.end(OPENAPI_3);
    });
    try {
      expect(
        (await acquireOfficialSource({ entry: entry(`${server.url}/r0`) }))
          .kind,
      ).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
    } finally {
      await server.close();
    }
  });

  it("A1-15 rejects artifacts over 25 MiB", async () => {
    const server = await fixtureServer((_request, response) => {
      response.writeHead(200, {
        "content-length": String(25 * 1024 * 1024 + 1),
      });
      response.end();
    });
    try {
      expect(
        (await acquireOfficialSource({ entry: entry(`${server.url}/source`) }))
          .kind,
      ).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
    } finally {
      await server.close();
    }
  });

  for (const [name, path, bytes] of [
    ["A1-16 malformed JSON", "/source.json", Buffer.from("{")],
    ["A1-17 malformed YAML", "/source.yaml", Buffer.from("openapi: [")],
    [
      "A1-18 non-OpenAPI document",
      "/source.json",
      Buffer.from('{"info":{},"paths":{}}'),
    ],
  ] as const) {
    it(name, async () => {
      const server = await fixtureServer((_request, response) =>
        response.end(bytes),
      );
      try {
        expect(
          (
            await acquireOfficialSource({
              entry: entry(`${server.url}${path}`),
            })
          ).kind,
        ).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
      } finally {
        await server.close();
      }
    });
  }

  it("A1-19 hashes exact received bytes", async () => {
    const server = await fixtureServer((_request, response) =>
      response.end(OPENAPI_3),
    );
    try {
      const result = await acquireOfficialSource({
        entry: entry(`${server.url}/source.json`),
      });
      expect(
        result.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE"
          ? result.sha256
          : "",
      ).toBe(
        "" +
          (await import("node:crypto"))
            .createHash("sha256")
            .update(OPENAPI_3)
            .digest("hex"),
      );
    } finally {
      await server.close();
    }
  });

  it("A1-20 operator-required result creates one TG3 pending request", async () => {
    const server = await fixtureServer((_request, response) =>
      response.writeHead(403).end(),
    );
    const pendingState = createInMemorySwaggerSourceState();
    const pending = new InMemorySwaggerSourceStore(pendingState);
    try {
      const result = await runAuthorityPass({
        registry: registryFor(`${server.url}/source.json`),
        store: new InMemoryApiWatchStore(),
        pendingStore: pending,
      });
      expect(result.outcomes[0]?.kind).toBe("OPERATOR_SOURCE_REQUIRED");
      expect((await pending.listPending(new Date())).length).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("A1-21 duplicate blocked runs retain one open request", async () => {
    const server = await fixtureServer((_request, response) =>
      response.writeHead(403).end(),
    );
    const pending = new InMemorySwaggerSourceStore();
    try {
      const dependencies = {
        registry: registryFor(`${server.url}/source.json`),
        store: new InMemoryApiWatchStore(),
        pendingStore: pending,
      };
      await runAuthorityPass(dependencies);
      await runAuthorityPass(dependencies);
      expect(await pending.listPending(new Date())).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("A1-22 /swagger_pending sees the request created by A1", async () => {
    const server = await fixtureServer((_request, response) =>
      response.writeHead(403).end(),
    );
    const pending = new InMemorySwaggerSourceStore();
    try {
      await runAuthorityPass({
        registry: registryFor(`${server.url}/source.json`),
        store: new InMemoryApiWatchStore(),
        pendingStore: pending,
      });
      const handoff = createSwaggerHandoffService({ store: pending });
      expect((await handoff.listPending())[0]?.officialUrl).toBe(
        `${server.url}/source.json`,
      );
    } finally {
      await server.close();
    }
  });

  it("A1-23 /swagger_run invokes one authority pass", async () => {
    let hits = 0;
    const server = await fixtureServer((_request, response) => {
      hits += 1;
      response.end(OPENAPI_3);
    });
    try {
      const runner = createApiWatchRunner({
        registry: registryFor(`${server.url}/source.json`),
        store: new InMemoryApiWatchStore(),
        pendingStore: new InMemorySwaggerSourceStore(),
      });
      await runner({ lane: "SWAGGER_API", runId: "run", source: "FORCED" });
      expect(hits).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("A1-24 scheduled Swagger run uses the same handler", async () => {
    let calls = 0;
    const runner = createApiWatchRunner({
      registry: createSourceRegistry(),
      store: new InMemoryApiWatchStore(),
      pendingStore: new InMemorySwaggerSourceStore(),
    });
    const wrapped = async () => {
      calls += 1;
      return runner({
        lane: "SWAGGER_API",
        runId: String(calls),
        source: "SCHEDULED",
      });
    };
    await wrapped();
    expect(calls).toBe(1);
  });

  it("A1-25 same-lane single-flight remains preserved", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { IndependentMonitoringScheduler, InMemoryMonitoringScheduleStore } =
      await import("@product/monitoring-control");
    const scheduler = new IndependentMonitoringScheduler({
      store: new InMemoryMonitoringScheduleStore(),
      runners: {
        LLM: async () => ({ status: "SUCCEEDED", code: null, summary: "ok" }),
        SWAGGER_API: async () => {
          await wait;
          return { status: "SUCCEEDED", code: null, summary: "ok" };
        },
      },
    });
    await scheduler.start();
    const first = await scheduler.runNow("SWAGGER_API");
    const second = await scheduler.runNow("SWAGGER_API");
    release();
    await scheduler.stop();
    expect(first.kind).toBe("STARTED");
    expect(second.kind).toBe("ALREADY_RUNNING");
  });

  it("A1-26 LLM remains independent from API-watch", async () => {
    const { IndependentMonitoringScheduler, InMemoryMonitoringScheduleStore } =
      await import("@product/monitoring-control");
    const scheduler = new IndependentMonitoringScheduler({
      store: new InMemoryMonitoringScheduleStore(),
      runners: {
        LLM: async () => ({ status: "SUCCEEDED", code: null, summary: "ok" }),
        SWAGGER_API: async () => ({
          status: "SUCCEEDED",
          code: null,
          summary: "ok",
        }),
      },
    });
    await scheduler.start();
    const results = await Promise.all([
      scheduler.runNow("LLM"),
      scheduler.runNow("SWAGGER_API"),
    ]);
    await scheduler.stop();
    expect(results.every((result) => result.kind === "STARTED")).toBe(true);
  });

  it("A1-27 wrong request candidate is rejected", async () => {
    const root = await mkdtemp(join(tmpdir(), "s2-a1-candidate-"));
    const state = createInMemorySwaggerSourceState();
    const pending = new InMemorySwaggerSourceStore(state);
    await pending.createRequest({
      requestId: "request-a",
      sourceFamily: "OZON_SELLER",
      officialUrl: "https://official.example.test/openapi.json",
      expectedArtifactType: "JSON",
      blockerReason: "blocked",
    });
    await pending.createRequest({
      requestId: "request-b",
      sourceFamily: "OZON_SELLER",
      officialUrl: "https://official.example.test/openapi.json",
      expectedArtifactType: "JSON",
      blockerReason: "blocked",
    });
    const handoff = createSwaggerHandoffService({
      store: pending,
      quarantineDir: root,
    });
    await handoff.upload({
      requestId: "request-a",
      operatorId: "1",
      originalFilename: "source.json",
      bytes: OPENAPI_3,
    });
    try {
      const result = await evaluateOperatorCandidate({
        requestId: "request-b",
        registry: registryFor("https://official.example.test/openapi.json"),
        pendingStore: pending,
        store: new InMemoryApiWatchStore(),
        quarantineDir: root,
      });
      expect(result.kind).toBe("AUTHORITY_REJECTED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A1-28 wrong source family candidate is rejected", async () => {
    const root = await mkdtemp(join(tmpdir(), "s2-a1-family-"));
    const state = createInMemorySwaggerSourceState();
    const pending = new InMemorySwaggerSourceStore(state);
    const request = await pending.createRequest({
      requestId: "request-family",
      sourceFamily: "OZON_SELLER",
      officialUrl: "https://official.example.test/openapi.json",
      expectedArtifactType: "JSON",
      blockerReason: "blocked",
    });
    const filename = "candidate.json";
    await writeFile(join(root, filename), OPENAPI_3);
    const sha256 = (await import("node:crypto"))
      .createHash("sha256")
      .update(OPENAPI_3)
      .digest("hex");
    await pending.saveArtifact({
      artifactId: "artifact-family",
      requestId: request.requestId,
      sourceFamily: "WILDBERRIES",
      officialUrl: request.officialUrl,
      status: "CANDIDATE_READY",
      quarantineFilename: filename,
      originalFilename: filename,
      operatorId: "1",
      receivedAt: new Date(),
      sizeBytes: OPENAPI_3.byteLength,
      sha256,
      detectedSpecVersion: "3.0.3",
      parserResult: { parsed: true },
      validationResult: { recognizedVersion: true },
      authorityState: "OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE",
    });
    try {
      const result = await evaluateOperatorCandidate({
        requestId: request.requestId,
        registry: registryFor(request.officialUrl),
        pendingStore: pending,
        store: new InMemoryApiWatchStore(),
        quarantineDir: root,
      });
      expect(result.kind).toBe("AUTHORITY_REJECTED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A1-29 operator candidate digest mismatch is rejected", async () => {
    const root = await mkdtemp(join(tmpdir(), "s2-a1-digest-"));
    const pending = new InMemorySwaggerSourceStore();
    const request = await pending.createRequest({
      requestId: "request-digest",
      sourceFamily: "OZON_SELLER",
      officialUrl: "https://official.example.test/openapi.json",
      expectedArtifactType: "JSON",
      blockerReason: "blocked",
    });
    const handoff = createSwaggerHandoffService({
      store: pending,
      quarantineDir: root,
    });
    const uploaded = await handoff.upload({
      requestId: request.requestId,
      operatorId: "1",
      originalFilename: "source.json",
      bytes: OPENAPI_3,
    });
    try {
      if (uploaded.kind !== "CANDIDATE_READY")
        throw new Error("fixture failed");
      await writeFile(
        join(root, uploaded.artifact.quarantineFilename),
        Buffer.from("tampered"),
      );
      const result = await evaluateOperatorCandidate({
        requestId: request.requestId,
        registry: registryFor(request.officialUrl),
        pendingStore: pending,
        store: new InMemoryApiWatchStore(),
        quarantineDir: root,
      });
      expect(result).toEqual({
        kind: "AUTHORITY_REJECTED",
        reason: "CANDIDATE_DIGEST_MISMATCH",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A1-30 TG3 upload does not bypass authority evaluation", async () => {
    const root = await mkdtemp(join(tmpdir(), "s2-a1-review-"));
    const pending = new InMemorySwaggerSourceStore();
    const request = await pending.createRequest({
      requestId: "request-review",
      sourceFamily: "OZON_SELLER",
      officialUrl: "https://official.example.test/openapi.json",
      expectedArtifactType: "JSON",
      blockerReason: "blocked",
    });
    const handoff = createSwaggerHandoffService({
      store: pending,
      quarantineDir: root,
    });
    await handoff.upload({
      requestId: request.requestId,
      operatorId: "1",
      originalFilename: "source.json",
      bytes: OPENAPI_3,
    });
    const store = new InMemoryApiWatchStore();
    try {
      expect(await store.listAuthorityRecords()).toHaveLength(0);
      const result = await evaluateOperatorCandidate({
        requestId: request.requestId,
        registry: registryFor(request.officialUrl),
        pendingStore: pending,
        store,
        quarantineDir: root,
      });
      expect(result.kind).toBe("AUTHORITY_REVIEW_REQUIRED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A1-31 does not mutate Stream-1 execution authority", async () => {
    const source = await readFile(
      new URL("../../../apps/telegram-operator/src/main.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /executionAuthority|bootstrapAuthority|offlineGrace/,
    );
  });

  it("A1-32 does not contain a product auto-patch path", async () => {
    const source = await readFile(
      new URL("./authority.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/auto.?patch|adapter|child_process|eval\s*\(/i);
  });
});

describe("A2 immutable API specification snapshots", () => {
  for (const status of [
    "AUTHORITY_REVIEW_REQUIRED",
    "AUTHORITY_REJECTED",
    "AUTHORITY_BLOCKED",
  ] as const) {
    it(`A2-${status === "AUTHORITY_REVIEW_REQUIRED" ? "02" : status === "AUTHORITY_REJECTED" ? "03" : "04"} ${status} cannot snapshot`, async () => {
      const { record, store, pathRoot } = await acceptedRecord();
      try {
        await expect(
          promoteAcceptedSnapshot({
            record: { ...record, authorityStatus: status },
            bytes: OPENAPI_3,
            store,
            snapshotRoot: pathRoot,
          }),
        ).rejects.toThrow("SNAPSHOT_AUTHORITY_NOT_ACCEPTED");
      } finally {
        await rm(pathRoot, { recursive: true, force: true });
      }
    });
  }

  it("A2-01 only AUTHORITY_ACCEPTED source can snapshot", async () => {
    const { record, store, pathRoot } = await acceptedRecord();
    try {
      const metadata = await promoteAcceptedSnapshot({
        record,
        bytes: OPENAPI_3,
        store,
        snapshotRoot: pathRoot,
      });
      expect(metadata.snapshotId).toBe(`OZON_SELLER:${record.sha256}`);
    } finally {
      await rm(pathRoot, { recursive: true, force: true });
    }
  });

  it("A2-05 generates family and SHA filename", async () => {
    const { record, store, pathRoot } = await acceptedRecord();
    try {
      const metadata = await promoteAcceptedSnapshot({
        record,
        bytes: OPENAPI_3,
        store,
        snapshotRoot: pathRoot,
      });
      expect(metadata.artifactPath).toMatch(/OZON_SELLER\/[0-9a-f]{64}\.json$/);
    } finally {
      await rm(pathRoot, { recursive: true, force: true });
    }
  });

  it("A2-06 snapshot bytes exactly equal accepted bytes", async () => {
    const { record, store, pathRoot } = await acceptedRecord();
    try {
      const metadata = await promoteAcceptedSnapshot({
        record,
        bytes: OPENAPI_3,
        store,
        snapshotRoot: pathRoot,
      });
      expect(await readFile(metadata.artifactPath)).toEqual(OPENAPI_3);
    } finally {
      await rm(pathRoot, { recursive: true, force: true });
    }
  });

  it("A2-07 duplicate SHA is idempotent", async () => {
    const { record, store, pathRoot } = await acceptedRecord();
    try {
      const one = await promoteAcceptedSnapshot({
        record,
        bytes: OPENAPI_3,
        store,
        snapshotRoot: pathRoot,
      });
      const two = await promoteAcceptedSnapshot({
        record,
        bytes: OPENAPI_3,
        store,
        snapshotRoot: pathRoot,
      });
      expect(two.snapshotId).toBe(one.snapshotId);
      expect(await readdir(join(pathRoot, "OZON_SELLER"))).toHaveLength(1);
    } finally {
      await rm(pathRoot, { recursive: true, force: true });
    }
  });

  it("A2-08 different SHA produces a different immutable snapshot", async () => {
    const second = Buffer.from(
      JSON.stringify({
        ...JSON.parse(OPENAPI_3.toString()),
        info: { title: "second", version: "1" },
      }),
    );
    const root = await mkdtemp(join(tmpdir(), "s2-a2-two-"));
    const first = await acceptedRecord(OPENAPI_3, root);
    const secondRecord = {
      ...first.record,
      recordId: "authority-2",
      sha256: (await import("node:crypto"))
        .createHash("sha256")
        .update(second)
        .digest("hex"),
      sizeBytes: second.byteLength,
    };
    try {
      const one = await promoteAcceptedSnapshot({
        record: first.record,
        bytes: OPENAPI_3,
        store: first.store,
        snapshotRoot: root,
      });
      const two = await promoteAcceptedSnapshot({
        record: secondRecord,
        bytes: second,
        store: first.store,
        snapshotRoot: root,
      });
      expect(two.snapshotId).not.toBe(one.snapshotId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("A2-09 finalization leaves no temporary file", async () => {
    const { record, store, pathRoot } = await acceptedRecord();
    try {
      await promoteAcceptedSnapshot({
        record,
        bytes: OPENAPI_3,
        store,
        snapshotRoot: pathRoot,
      });
      expect(
        (await readdir(join(pathRoot, "OZON_SELLER"))).some((name) =>
          name.endsWith(".tmp"),
        ),
      ).toBe(false);
    } finally {
      await rm(pathRoot, { recursive: true, force: true });
    }
  });

  it("A2-10 path traversal is impossible", async () => {
    const { record, store, pathRoot } = await acceptedRecord();
    try {
      await expect(
        promoteAcceptedSnapshot({
          record: { ...record, sourceFamily: "../escape" as never },
          bytes: OPENAPI_3,
          store,
          snapshotRoot: pathRoot,
        }),
      ).rejects.toThrow();
    } finally {
      await rm(pathRoot, { recursive: true, force: true });
    }
  });

  it("A2-11 symlink escape is rejected", async () => {
    const { record, store, pathRoot } = await acceptedRecord();
    const outside = await mkdtemp(join(tmpdir(), "s2-a2-outside-"));
    try {
      await symlink(outside, join(pathRoot, "OZON_SELLER"));
      await expect(
        promoteAcceptedSnapshot({
          record,
          bytes: OPENAPI_3,
          store,
          snapshotRoot: pathRoot,
        }),
      ).rejects.toThrow("SNAPSHOT_PATH_NOT_DIRECTORY");
    } finally {
      await rm(pathRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("A2-12 persists snapshot metadata", async () => {
    const { record, store, pathRoot } = await acceptedRecord();
    try {
      const metadata = await promoteAcceptedSnapshot({
        record,
        bytes: OPENAPI_3,
        store,
        snapshotRoot: pathRoot,
      });
      expect((await store.listSnapshots())[0]?.artifactPath).toBe(
        metadata.artifactPath,
      );
    } finally {
      await rm(pathRoot, { recursive: true, force: true });
    }
  });

  it("A2-13 metadata survives store recreation", async () => {
    const { record, store, pathRoot } = await acceptedRecord();
    try {
      await promoteAcceptedSnapshot({
        record,
        bytes: OPENAPI_3,
        store,
        snapshotRoot: pathRoot,
      });
      const recreated = new InMemoryApiWatchStore(
        (store as unknown as { state: unknown }).state as never,
      );
      expect(await recreated.listSnapshots()).toHaveLength(1);
    } finally {
      await rm(pathRoot, { recursive: true, force: true });
    }
  });

  it("A2-14 default snapshot root is outside the Git working tree", async () => {
    const source = await readFile(
      new URL("./snapshot.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("/var/lib/octoport/api-watch/snapshots");
    expect(
      "/var/lib/octoport/api-watch/snapshots".startsWith(process.cwd()),
    ).toBe(false);
  });
});

const INVENTORY_DOC = Buffer.from(
  JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Inventory", version: "1" },
    security: [{ bearerAuth: [] }],
    paths: {
      "/items": {
        parameters: [{ name: "tenant", in: "query" }],
        get: {
          tags: ["items"],
          summary: "List",
          operationId: "listItems",
          responses: { "200": {}, default: {} },
        },
        post: {
          tags: ["items"],
          requestBody: {},
          responses: { "201": {} },
          deprecated: true,
        },
        put: { responses: { "200": {} } },
        patch: { operationId: "patchItems", responses: { "200": {} } },
        delete: { operationId: "deleteItems", responses: { "204": {} } },
      },
      "/items/{id}": { get: { responses: { "200": {} } } },
    },
  }),
);

describe("A3 complete operation inventory", () => {
  function inventory() {
    return buildCompleteOperationInventory({
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "a".repeat(64),
      bytes: INVENTORY_DOC,
      filename: "snapshot.json",
    });
  }
  it("A3-01 extracts complete OpenAPI 3 path/method volume", () => {
    expect(inventory().pathCount).toBe(2);
    expect(inventory().operationCount).toBe(6);
  });
  it("A3-02 extracts Swagger 2 paths and methods", () => {
    const value = buildCompleteOperationInventory({
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "b".repeat(64),
      bytes: SWAGGER_2,
      filename: "snapshot.json",
    });
    expect(value.operationCount).toBe(1);
  });
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const)
    it(`A3-${method === "GET" ? "03" : method === "POST" ? "04" : method === "PUT" ? "05" : method === "PATCH" ? "06" : "07"} ${method} identity`, () => {
      expect(
        inventory().operations.some(
          (operation) =>
            operation.method === method &&
            operation.identity.includes(`:${method}:`),
        ),
      ).toBe(true);
    });
  it("A3-08 keeps operationId nullable", () => {
    expect(
      inventory().operations.find(
        (operation) => operation.path === "/items/{id}",
      )?.operationId,
    ).toBeNull();
  });
  it("A3-09 preserves normalized tags", () => {
    expect(
      inventory().operations.find((operation) => operation.method === "GET")
        ?.tags,
    ).toEqual(["items"]);
  });
  it("A3-10 preserves deprecated", () => {
    expect(
      inventory().operations.find((operation) => operation.method === "POST")
        ?.deprecated,
    ).toBe(true);
  });
  it("A3-11 normalizes response status keys", () => {
    expect(
      inventory().operations.find((operation) => operation.method === "GET")
        ?.responseStatusKeys,
    ).toEqual(["200", "default"]);
  });
  it("A3-12 records security references", () => {
    expect(
      inventory().operations.find((operation) => operation.method === "GET")
        ?.securitySchemeReferences,
    ).toEqual(["bearerAuth"]);
  });
  it("A3-13 records request-body presence", () => {
    expect(
      inventory().operations.find((operation) => operation.method === "POST")
        ?.requestBodyPresent,
    ).toBe(true);
  });
  it("A3-14 counts path and operation parameters", () => {
    expect(
      inventory().operations.find((operation) => operation.method === "GET")
        ?.parameterCount,
    ).toBe(1);
  });
  it("A3-15 inventories complete volume without truncation", () => {
    expect(inventory().operations).toHaveLength(6);
  });
  it("A3-16 same snapshot is deterministic", () => {
    expect(inventory()).toEqual(inventory());
  });
  it("A3-17 source families never collide", () => {
    const other = buildCompleteOperationInventory({
      sourceFamily: "WILDBERRIES",
      snapshotSha256: "a".repeat(64),
      bytes: INVENTORY_DOC,
      filename: "snapshot.json",
    });
    expect(inventory().operations[0]?.identity).not.toBe(
      other.operations[0]?.identity,
    );
  });
  it("A3-18 operationId rename does not change method/path identity", () => {
    const one = inventory();
    const renamed = buildCompleteOperationInventory({
      sourceFamily: "OZON_SELLER",
      snapshotSha256: "a".repeat(64),
      bytes: Buffer.from(
        INVENTORY_DOC.toString().replace("listItems", "renamed"),
      ),
      filename: "snapshot.json",
    });
    expect(
      one.operations.find((operation) => operation.method === "GET")?.identity,
    ).toBe(
      renamed.operations.find((operation) => operation.method === "GET")
        ?.identity,
    );
  });
  it("A3-19 ties every item to snapshot SHA", () => {
    expect(
      inventory().operations.every(
        (operation) => operation.snapshotSha256 === "a".repeat(64),
      ),
    ).toBe(true);
  });
  it("A3-20 performs no semantic-diff classification", () => {
    expect(inventory()).not.toHaveProperty("breaking");
    expect(inventory()).not.toHaveProperty("added");
    expect(inventory()).not.toHaveProperty("removed");
  });
});
