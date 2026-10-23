import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";
import { diffInventories } from "./diff.js";

type MediaCase = {
  rootConsumes?: string[];
  rootProduces?: string[];
  operationConsumes?: string[];
  operationProduces?: string[];
  payload?: "body" | "formData" | "none";
  response?: "body" | "none" | "mixed";
};

function inventory(input: MediaCase) {
  const parameters =
    input.payload === "none"
      ? []
      : input.payload === "formData"
        ? [{ name: "value", in: "formData", type: "string", required: true }]
        : [
            {
              name: "value",
              in: "body",
              required: true,
              schema: { type: "string" },
            },
          ];
  const post: Record<string, unknown> = {
    operationId: "sample",
    parameters,
    responses:
      input.response === "none"
        ? { "204": { description: "No Content" } }
        : input.response === "mixed"
          ? {
              "200": { description: "ok", schema: { type: "string" } },
              "204": { description: "No Content" },
            }
          : { "200": { description: "ok", schema: { type: "string" } } },
    ...(input.operationConsumes === undefined
      ? {}
      : { consumes: input.operationConsumes }),
    ...(input.operationProduces === undefined
      ? {}
      : { produces: input.operationProduces }),
  };
  const document = {
    swagger: "2.0",
    info: { title: "Synthetic media contract", version: "1.0" },
    ...(input.rootConsumes === undefined
      ? {}
      : { consumes: input.rootConsumes }),
    ...(input.rootProduces === undefined
      ? {}
      : { produces: input.rootProduces }),
    paths: { "/sample": { post } },
  };
  return buildCompleteOperationInventory({
    sourceFamily: "OZON_SELLER",
    snapshotSha256: "a".repeat(64),
    filename: "swagger2-media.json",
    bytes: new TextEncoder().encode(JSON.stringify(document)),
  });
}

function compare(before: MediaCase, after: MediaCase) {
  const original = inventory(before);
  const modified = inventory(after);
  const diff = diffInventories({ base: original, target: modified });
  return {
    original: original.operations[0]!,
    modified: modified.operations[0]!,
    changed: diff.changedCount,
    state: diff.operations[0]!.state,
    fields: diff.operations[0]!.deltas.map((delta) => delta.field),
  };
}

describe("Swagger 2.0 effective MIME contracts and stable unrelated hashes", () => {
  it("detects a root consumes change for a request body without changing the response fingerprint", () => {
    const result = compare(
      { rootConsumes: ["application/json"] },
      { rootConsumes: ["text/plain"] },
    );
    expect(result.state).toBe("CHANGED");
    expect(result.changed).toBe(1);
    expect(result.fields).toContain("requestSchemaSha256");
    expect(result.fields).not.toContain("responseSchemaSha256");
    expect(result.original.requestSchemaSha256).not.toBe(
      result.modified.requestSchemaSha256,
    );
  });

  it("detects a root produces change independently of the request contract", () => {
    const result = compare(
      { rootProduces: ["application/json"] },
      { rootProduces: ["text/plain"] },
    );
    expect(result.state).toBe("CHANGED");
    expect(result.fields).toContain("responseSchemaSha256");
    expect(result.fields).not.toContain("requestSchemaSha256");
    expect(result.original.responseSchemaSha256).not.toBe(
      result.modified.responseSchemaSha256,
    );
  });

  it("ignores produces changes when every response has no body (204 No Content)", () => {
    const result = compare(
      { rootProduces: ["application/json"], response: "none" },
      { rootProduces: ["text/plain"], response: "none" },
    );
    expect(result.state).toBe("UNCHANGED");
    expect(result.changed).toBe(0);
    expect(result.original.responseSchemaSha256).toBe(
      result.modified.responseSchemaSha256,
    );
  });

  it("still detects a produces change when another response has a schema", () => {
    const result = compare(
      { rootProduces: ["application/json"], response: "mixed" },
      { rootProduces: ["text/plain"], response: "mixed" },
    );
    expect(result.state).toBe("CHANGED");
    expect(result.fields).toContain("responseSchemaSha256");
  });

  it("ignores changed root MIME types when both are overridden on the operation", () => {
    const result = compare(
      {
        rootConsumes: ["application/json"],
        rootProduces: ["application/json"],
        operationConsumes: ["text/plain"],
        operationProduces: ["application/xml"],
      },
      {
        rootConsumes: ["application/x-www-form-urlencoded"],
        rootProduces: ["image/png"],
        operationConsumes: ["text/plain"],
        operationProduces: ["application/xml"],
      },
    );
    expect(result.state).toBe("UNCHANGED");
  });

  it("keeps absent and explicitly empty MIME declarations equivalent with no inherited MIME types", () => {
    // Both yield the same effective empty MIME set. With a nonempty
    // inherited set, an explicit [] still clears it (covered below).
    const operation = compare(
      {},
      { operationConsumes: [], operationProduces: [] },
    );
    expect(operation.state).toBe("UNCHANGED");
    expect(operation.fields).toEqual([]);

    const root = compare({}, { rootConsumes: [], rootProduces: [] });
    expect(root.state).toBe("UNCHANGED");
    expect(root.fields).toEqual([]);
  });

  it("treats an explicit empty operation consumes list as clearing inherited root consumes", () => {
    expect(
      compare(
        { rootConsumes: ["application/json"] },
        { rootConsumes: ["application/json"], operationConsumes: [] },
      ).fields,
    ).toContain("requestSchemaSha256");
    expect(
      compare(
        { rootConsumes: ["application/json"], operationConsumes: [] },
        { rootConsumes: ["text/plain"], operationConsumes: [] },
      ).state,
    ).toBe("UNCHANGED");
  });

  it("treats an explicit empty operation produces list as clearing inherited root produces", () => {
    expect(
      compare(
        { rootProduces: ["application/json"] },
        { rootProduces: ["application/json"], operationProduces: [] },
      ).fields,
    ).toContain("responseSchemaSha256");
    expect(
      compare(
        { rootProduces: ["application/json"], operationProduces: [] },
        { rootProduces: ["text/plain"], operationProduces: [] },
      ).state,
    ).toBe("UNCHANGED");
  });

  it("does not fingerprint consumes for a request with no body or form fields", () => {
    const result = compare(
      { rootConsumes: ["application/json"], payload: "none" },
      { rootConsumes: ["text/plain"], payload: "none" },
    );
    expect(result.state).toBe("UNCHANGED");
    expect(result.original.requestSchemaSha256).toBeNull();
    expect(result.modified.requestSchemaSha256).toBeNull();
  });

  it("detects consumes for Swagger 2.0 formData request parameters", () => {
    const result = compare(
      {
        rootConsumes: ["application/x-www-form-urlencoded"],
        payload: "formData",
      },
      { rootConsumes: ["multipart/form-data"], payload: "formData" },
    );
    expect(result.state).toBe("CHANGED");
    expect(result.fields).toContain("requestSchemaSha256");
  });

  it("marks Swagger 2.0 formData as a request payload in inventory metadata", () => {
    const form = inventory({
      rootConsumes: ["multipart/form-data"],
      payload: "formData",
    }).operations[0]!;
    const body = inventory({ payload: "body" }).operations[0]!;
    const empty = inventory({ payload: "none" }).operations[0]!;
    expect(form.requestBodyPresent).toBe(true);
    expect(body.requestBodyPresent).toBe(true);
    expect(empty.requestBodyPresent).toBe(false);
  });

  it("ignores Swagger 2 MIME type/subtype letter case in consumes and produces", () => {
    const result = compare(
      {
        rootConsumes: ["application/json"],
        rootProduces: ["application/json"],
      },
      {
        rootConsumes: ["APPLICATION/JSON"],
        rootProduces: ["Application/Json"],
      },
    );
    expect(result.state).toBe("UNCHANGED");
    expect(result.fields).toEqual([]);

    const duplicateCaseVariants = compare(
      {
        rootConsumes: ["application/json"],
        rootProduces: ["image/png"],
      },
      {
        rootConsumes: ["APPLICATION/JSON", "application/json"],
        rootProduces: ["image/png", "IMAGE/PNG"],
      },
    );
    expect(duplicateCaseVariants.state).toBe("UNCHANGED");
  });

  it("preserves case-sensitive MIME parameter values while normalizing type/subtype", () => {
    const sameParameters = compare(
      {
        operationConsumes: ["multipart/form-data; boundary=CaseSensitiveABC"],
        operationProduces: [
          "application/vnd.example+json; profile=CaseSensitiveABC",
        ],
      },
      {
        operationConsumes: ["MULTIPART/FORM-DATA; boundary=CaseSensitiveABC"],
        operationProduces: [
          "APPLICATION/VND.EXAMPLE+JSON; profile=CaseSensitiveABC",
        ],
      },
    );
    expect(sameParameters.state).toBe("UNCHANGED");

    const changedParameters = compare(
      {
        rootConsumes: ["multipart/form-data; boundary=CaseSensitiveABC"],
        rootProduces: ["application/json; profile=CaseSensitiveABC"],
      },
      {
        rootConsumes: ["multipart/form-data; boundary=casesensitiveabc"],
        rootProduces: ["application/json; profile=casesensitiveabc"],
      },
    );
    expect(changedParameters.state).toBe("CHANGED");
    expect(changedParameters.fields).toContain("requestSchemaSha256");
    expect(changedParameters.fields).toContain("responseSchemaSha256");
  });

  it("normalizes Swagger 2 MIME parameter names, whitespace, order, and equivalent quotes", () => {
    const a = compare(
      {
        rootConsumes: [
          "application/json; charset=utf-8; boundary=CaseSensitiveABC",
        ],
        rootProduces: [
          "application/json; CHARSET=utf-8; profile=CaseSensitiveABC",
        ],
      },
      {
        rootConsumes: [
          'APPLICATION/JSON; BOUNDARY="CaseSensitiveABC"; CHARSET="utf-8"',
        ],
        rootProduces: [
          'application/json; profile="CaseSensitiveABC" ; charset="utf-8"',
        ],
      },
    );
    expect(a.state).toBe("UNCHANGED");

    const quotedSemicolon = compare(
      { rootConsumes: ['multipart/form-data; boundary="semi;CaseABC"'] },
      { rootConsumes: ['MULTIPART/FORM-DATA; BOUNDARY="semi;CaseABC"'] },
    );
    expect(quotedSemicolon.state).toBe("UNCHANGED");
  });

  it("accepts ASCII spaces and tabs around MIME separators, not around equals", () => {
    const a = compare(
      {
        rootConsumes: [
          ' \tapplication/json \t; CHARSET="utf-8" \t; profile=CaseSensitiveABC',
        ],
      },
      {
        rootConsumes: [
          "application/json;profile=CaseSensitiveABC;charset=utf-8",
        ],
      },
    );
    expect(a.state).toBe("UNCHANGED");
  });

  it("preserves valid escaped quotes, tab and Latin-1 characters in MIME parameters", () => {
    const result = compare(
      { rootConsumes: ['application/json; profile="a\\"b\t\u00e9"'] },
      { rootConsumes: ['APPLICATION/JSON; PROFILE="a\\"b\t\u00e9"'] },
    );
    expect(result.state).toBe("UNCHANGED");
  });

  it("treats MIME lists as order-insensitive sets, including duplicate entries", () => {
    const result = compare(
      {
        rootConsumes: ["application/json", "text/plain"],
        rootProduces: ["application/xml", "application/json"],
      },
      {
        rootConsumes: ["text/plain", "application/json", "text/plain"],
        rootProduces: [
          "application/json",
          "application/xml",
          "application/xml",
        ],
      },
    );
    expect(result.state).toBe("UNCHANGED");
  });

  it("preserves fingerprint identity for unchanged Swagger 2.0 documents without MIME declarations", () => {
    const result = compare({}, {});
    expect(result.state).toBe("UNCHANGED");
    expect(result.original.requestSchemaSha256).toEqual(
      result.modified.requestSchemaSha256,
    );
    expect(result.original.responseSchemaSha256).toEqual(
      result.modified.responseSchemaSha256,
    );
    // Existing no-media inventory hashes must remain byte-exact.
    expect(result.original.requestSchemaSha256).toBe(
      "8f3d8a04fb57ffc6582404bfdfe718211c734ce25664bbebea59091e8afb6d8a",
    );
    expect(result.original.responseSchemaSha256).toBe(
      "fba3b301e3f02920a4d49df5d5b6a89db15a83aec204850f8d93291985aadb27",
    );
  });
});

describe("Swagger 2.0 invalid MIME declarations fail closed", () => {
  it.each([
    ["root consumes string", "rootConsumes", "text/plain", "body"],
    ["root produces string", "rootProduces", "text/plain", "body"],
    ["operation consumes string", "operationConsumes", "text/plain", "body"],
    ["operation produces null", "operationProduces", null, "body"],
    [
      "root consumes mixed member types",
      "rootConsumes",
      ["application/json", 3],
      "body",
    ],
    [
      "operation produces blank media value",
      "operationProduces",
      ["   "],
      "body",
    ],
    [
      "root consumes unterminated quoted MIME parameter",
      "rootConsumes",
      ['application/json; profile="unterminated'],
      "body",
    ],
    [
      "root consumes NBSP before MIME type",
      "rootConsumes",
      ["\u00a0application/json"],
      "body",
    ],
    [
      "operation produces NBSP after MIME subtype",
      "operationProduces",
      ["application/json\u00a0"],
      "body",
    ],
    [
      "root consumes NBSP before MIME semicolon",
      "rootConsumes",
      ["application/json\u00a0; charset=utf-8"],
      "body",
    ],
    [
      "operation consumes NBSP before parameter name",
      "operationConsumes",
      ["application/json; \u00a0charset=utf-8"],
      "body",
    ],
    [
      "root consumes NBSP after equals",
      "rootConsumes",
      ["application/json; charset=\u00a0utf-8"],
      "body",
    ],
    [
      "operation produces ASCII space before equals",
      "operationProduces",
      ["application/json; charset =utf-8"],
      "body",
    ],
    [
      "root consumes ASCII space after equals",
      "rootConsumes",
      ["application/json; charset= utf-8"],
      "body",
    ],

    [
      "root consumes CRLF inside quoted MIME parameter",
      "rootConsumes",
      ['application/json; profile="line\r\nbreak"'],
      "body",
    ],
    [
      "operation produces escaped CR inside quoted MIME parameter",
      "operationProduces",
      ['application/json; profile="line\\\rbreak"'],
      "body",
    ],
    [
      "root consumes NUL inside quoted MIME parameter",
      "rootConsumes",
      ['application/json; profile="a\u0000b"'],
      "body",
    ],
    [
      "operation consumes escaped control byte in MIME parameter",
      "operationConsumes",
      ['application/json; profile="a\\\u001fb"'],
      "body",
    ],
    [
      "root consumes non Latin-1 codepoint in MIME parameter",
      "rootConsumes",
      ['application/json; profile="a\u0100b"'],
      "body",
    ],

    [
      "operation produces duplicate parameter name ignoring case",
      "operationProduces",
      ["application/json; charset=utf-8; CHARSET=utf-8"],
      "body",
    ],
    [
      "operation consumes missing media subtype",
      "operationConsumes",
      ["application"],
      "body",
    ],
    [
      "root consumes malformed on a bodyless request",
      "rootConsumes",
      "text/plain",
      "none",
    ],
  ] as const)(
    "rejects %s rather than silently treating it as undeclared",
    (_name, field, value, payload) => {
      const malformed = { [field]: value, payload } as unknown as MediaCase;
      expect(() => inventory(malformed)).toThrow(
        "APIWATCH_SWAGGER2_MEDIA_DECLARATION_INVALID",
      );
    },
  );

  it("rejects DEL in a MIME quoted value even if an earlier text guard detects it", () => {
    const malformed = {
      rootConsumes: ['application/json; profile="a\u007fb"'],
      payload: "body",
    } as MediaCase;
    expect(() => inventory(malformed)).toThrow();
  });

  it("rejects invalid produces even for an operation with only bodyless responses", () => {
    const invalid = {
      rootProduces: "text/plain",
      response: "none",
    } as unknown as MediaCase;
    expect(() => inventory(invalid)).toThrow(
      "APIWATCH_SWAGGER2_MEDIA_DECLARATION_INVALID",
    );
  });

  it("does not let a valid operation override conceal a malformed root declaration", () => {
    const malformed = {
      rootConsumes: "text/plain",
      operationConsumes: ["application/json"],
    } as unknown as MediaCase;
    expect(() => inventory(malformed)).toThrow(
      "APIWATCH_SWAGGER2_MEDIA_DECLARATION_INVALID",
    );
  });

  it("rejects malformed root consumes even when no operations are present", () => {
    const invalidRoot = {
      swagger: "2.0",
      info: { title: "empty", version: "1" },
      paths: {},
      consumes: "text/plain",
    };
    expect(() =>
      buildCompleteOperationInventory({
        sourceFamily: "OZON_SELLER",
        snapshotSha256: "a".repeat(64),
        filename: "invalid-root.json",
        bytes: new TextEncoder().encode(JSON.stringify(invalidRoot)),
      }),
    ).toThrow("APIWATCH_SWAGGER2_MEDIA_DECLARATION_INVALID");
  });
});
