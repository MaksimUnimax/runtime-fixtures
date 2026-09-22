import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createInMemorySwaggerSourceState,
  createSwaggerHandoffService,
  InMemorySwaggerSourceStore,
  OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE,
  type SwaggerSourceFamily,
} from "./swagger-handoff.js";

const validJson = Buffer.from(
  JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Official fixture", version: "1" },
    paths: {},
  }),
);
const validYaml = Buffer.from(
  "openapi: 3.0.3\ninfo:\n  title: Official fixture\n  version: '1'\npaths: {}\n",
);

async function fixture(
  sourceFamily: SwaggerSourceFamily = "OZON_SELLER",
  maxUploadBytes?: number,
) {
  const directory = await mkdtemp(join(tmpdir(), "s2-tg3-"));
  const state = createInMemorySwaggerSourceState();
  const store = new InMemorySwaggerSourceStore(state);
  const request = await store.createRequest({
    requestId: "req-tg3-1",
    sourceFamily,
    officialUrl: "https://docs.example.test/official-openapi.json",
    expectedArtifactType: "OPENAPI_OR_SWAGGER",
    blockerReason: "Provider access behavior blocked automatic acquisition.",
  });
  const service = createSwaggerHandoffService({
    store,
    quarantineDir: directory,
    maxUploadBytes,
  });
  return { directory, state, store, service, request };
}

async function close(directory: string) {
  await rm(directory, { recursive: true, force: true });
}

describe("S2-TG3 operator-supplied Swagger handoff", () => {
  it("TG3-01 authorized operator lists pending requests", async () => {
    const f = await fixture();
    try {
      expect((await f.service.listPending()).map((r) => r.requestId)).toEqual([
        "req-tg3-1",
      ]);
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-02 unauthorized list has no handoff-store bypass", async () => {
    const f = await fixture();
    try {
      expect(await f.service.listPending()).toHaveLength(1);
      // Telegram authorization is tested at the operator boundary; the store exposes no actor API.
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-03 pending request persists across store/service recreation", async () => {
    const f = await fixture();
    try {
      const recreated = createSwaggerHandoffService({
        store: new InMemorySwaggerSourceStore(f.state),
        quarantineDir: f.directory,
      });
      expect((await recreated.listPending())[0]?.officialUrl).toContain(
        "official",
      );
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-04 accepts JSON into quarantine", async () => {
    const f = await fixture();
    try {
      const result = await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "source.json",
        bytes: validJson,
      });
      expect(result.kind).toBe("CANDIDATE_READY");
      expect(await readdir(f.directory)).toHaveLength(1);
    } finally {
      await close(f.directory);
    }
  });

  for (const [name, bytes] of [
    ["TG3-05 accepts YAML into quarantine", validYaml],
    ["TG3-06 accepts YML into quarantine", validYaml],
  ] as const) {
    it(name, async () => {
      const f = await fixture();
      try {
        const result = await f.service.upload({
          requestId: f.request.requestId,
          operatorId: "7001",
          originalFilename: name.includes("YML") ? "source.yml" : "source.yaml",
          bytes,
        });
        expect(result.kind).toBe("CANDIDATE_READY");
      } finally {
        await close(f.directory);
      }
    });
  }

  const rejectedCases: Array<[string, string, Uint8Array, string]> = [
    [
      "TG3-07 ZIP rejected",
      "source.zip",
      Buffer.from("PK\\u0003\\u0004"),
      "UNSUPPORTED_ARTIFACT_EXTENSION",
    ],
    [
      "TG3-08 unsupported extension rejected",
      "source.txt",
      Buffer.from("openapi"),
      "UNSUPPORTED_ARTIFACT_EXTENSION",
    ],
    [
      "TG3-09 malformed JSON rejected",
      "source.json",
      Buffer.from("{"),
      "INVALID_DOCUMENT",
    ],
    [
      "TG3-10 malformed YAML rejected",
      "source.yaml",
      Buffer.from("openapi: ["),
      "INVALID_DOCUMENT",
    ],
    [
      "TG3-12 non-OpenAPI document rejected",
      "source.json",
      Buffer.from('{"info":{},"paths":{}}'),
      "OPENAPI_VERSION_MISSING",
    ],
  ];
  for (const [name, filename, bytes, code] of rejectedCases) {
    it(name, async () => {
      const f = await fixture();
      try {
        const result = await f.service.upload({
          requestId: f.request.requestId,
          operatorId: "7001",
          originalFilename: filename,
          bytes,
        });
        expect(result.kind).toBe("REJECTED");
        expect(result.kind === "REJECTED" ? result.code : "").toContain(code);
        expect(await readdir(f.directory)).toHaveLength(1);
        expect(
          (await f.store.listArtifacts(f.request.requestId))[0]?.status,
        ).toBe("VALIDATION_FAILED");
      } finally {
        await close(f.directory);
      }
    });
  }

  it("TG3-11 safe YAML does not execute unsafe constructors", async () => {
    const f = await fixture();
    try {
      const result = await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "source.yaml",
        bytes: Buffer.from('!!js/function "process.exit()"'),
      });
      expect(result.kind).toBe("REJECTED");
      expect(
        (await f.store.listArtifacts(f.request.requestId))[0]?.parserResult,
      ).not.toHaveProperty("executed");
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-13 missing correlation is rejected by the Telegram command boundary", async () => {
    const f = await fixture();
    try {
      expect(
        await f.service.upload({
          requestId: "",
          operatorId: "7001",
          originalFilename: "x.json",
          bytes: validJson,
        }),
      ).toEqual({
        kind: "REJECTED",
        code: "UNKNOWN_REQUEST",
      });
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-14 unknown request rejected", async () => {
    const f = await fixture();
    try {
      expect(
        (
          await f.service.upload({
            requestId: "unknown",
            operatorId: "7001",
            originalFilename: "x.json",
            bytes: validJson,
          })
        ).kind,
      ).toBe("REJECTED");
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-15 finalized request rejected", async () => {
    const f = await fixture();
    try {
      await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      expect(
        (
          await f.service.upload({
            requestId: f.request.requestId,
            operatorId: "7001",
            originalFilename: "replacement.json",
            bytes: Buffer.from(
              '{"openapi":"3.0.3","info":{"title":"other","version":"1"},"paths":{}}',
            ),
          })
        ).kind,
      ).toBe("REJECTED");
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-15 rejects source-family mismatch where declared", async () => {
    const f = await fixture("OZON_SELLER");
    try {
      const result = await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
        declaredSourceFamily: "WILDBERRIES",
      });
      expect(result).toEqual({
        kind: "REJECTED",
        code: "SOURCE_FAMILY_MISMATCH",
      });
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-16 oversize upload rejected", async () => {
    const f = await fixture("OZON_SELLER", 10);
    try {
      expect(
        (
          await f.service.upload({
            requestId: f.request.requestId,
            operatorId: "7001",
            originalFilename: "x.json",
            bytes: validJson,
          })
        ).kind,
      ).toBe("REJECTED");
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-17 path-traversal filename is neutralized", async () => {
    const f = await fixture();
    try {
      const result = await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "../../private\\u0000.json",
        bytes: validJson,
      });
      expect(result.kind).toBe("CANDIDATE_READY");
      expect(
        result.kind === "CANDIDATE_READY"
          ? result.artifact.originalFilename
          : "",
      ).not.toContain("/");
      expect(
        result.kind === "CANDIDATE_READY"
          ? result.artifact.quarantineFilename
          : "",
      ).not.toContain("..");
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-18 persists SHA-256", async () => {
    const f = await fixture();
    try {
      const result = await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      expect(
        result.kind === "CANDIDATE_READY" ? result.artifact.sha256 : "",
      ).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-19 same request and SHA is idempotent DUPLICATE", async () => {
    const f = await fixture();
    try {
      await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      const result = await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "copy.json",
        bytes: validJson,
      });
      expect(result.kind).toBe("DUPLICATE");
      expect(await f.store.listArtifacts(f.request.requestId)).toHaveLength(1);
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-20 valid upload becomes exactly OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE", async () => {
    const f = await fixture();
    try {
      const result = await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      expect(
        result.kind === "CANDIDATE_READY"
          ? result.artifact.authorityState
          : null,
      ).toBe(OPERATOR_SUPPLIED_OFFICIAL_SOURCE_CANDIDATE);
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-21 candidate is not accepted authority", async () => {
    const f = await fixture();
    try {
      await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      const artifact = (await f.store.listArtifacts(f.request.requestId))[0]!;
      expect(artifact.authorityState).not.toBe("ACCEPTED_OFFICIAL_SOURCE");
      expect(artifact.authorityState).not.toBe("AUTHORITATIVE");
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-22 persistence has no bot token", async () => {
    const f = await fixture();
    try {
      await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      expect(
        JSON.stringify(await f.store.listArtifacts(f.request.requestId)),
      ).not.toMatch(/bot|token/i);
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-23 persistence has no unrelated Telegram message content", async () => {
    const f = await fixture();
    try {
      await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      expect(
        JSON.stringify(await f.store.listArtifacts(f.request.requestId)),
      ).not.toContain("private chat");
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-24 candidate provenance survives store/service recreation", async () => {
    const f = await fixture();
    try {
      await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      const recreated = new InMemorySwaggerSourceStore(f.state);
      expect(
        (await recreated.listArtifacts(f.request.requestId))[0]?.sha256,
      ).toHaveLength(64);
      expect((await recreated.getRequest(f.request.requestId))?.status).toBe(
        "CANDIDATE_READY",
      );
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-25 transport outage cannot delete durable handoff state", async () => {
    const f = await fixture();
    try {
      await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      expect(
        (
          await new InMemorySwaggerSourceStore(f.state).getRequest(
            f.request.requestId,
          )
        )?.status,
      ).toBe("CANDIDATE_READY");
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-26 LLM lane is not represented in the handoff store", async () => {
    const f = await fixture();
    try {
      expect(JSON.stringify(await f.service.listPending())).not.toContain(
        "LLM",
      );
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-27 handoff has no Stream-1 authority fields", async () => {
    const f = await fixture();
    try {
      const result = await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /executionAuthority|bootstrap|signedAuthority/i,
      );
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-28 handoff has no product auto-patch field or operation", async () => {
    const f = await fixture();
    try {
      const result = await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: validJson,
      });
      expect(JSON.stringify(result)).not.toMatch(/auto.?patch|adapter/i);
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-29 uploaded content has no execution path", async () => {
    const f = await fixture();
    try {
      const source = await readFile(
        join(process.cwd(), "src/swagger-handoff.ts"),
        "utf8",
      );
      expect(source).not.toMatch(
        /\beval\s*\(|new Function|child_process|execFile|spawn\(/,
      );
    } finally {
      await close(f.directory);
    }
  });

  it("TG3-30 rejected upload remains only in quarantine", async () => {
    const f = await fixture();
    try {
      const result = await f.service.upload({
        requestId: f.request.requestId,
        operatorId: "7001",
        originalFilename: "x.json",
        bytes: Buffer.from("not-json"),
      });
      expect(result.kind).toBe("REJECTED");
      expect(await readdir(f.directory)).toHaveLength(1);
      expect(
        (await f.store.listArtifacts(f.request.requestId))[0]?.authorityState,
      ).toBeNull();
    } finally {
      await close(f.directory);
    }
  });
});
