import { describe, expect, it } from "vitest";
import { buildCompleteOperationInventory } from "./inventory.js";

function makeContract(unicode = true, reversed = false) {
  const first = unicode ? "ä" : "alpha";
  const second = unicode ? "z" : "zeta";
  const security = [{ [first]: [] }, { [second]: [] }];
  const parameters = [
    { name: first, in: "query", schema: { type: "string" } },
    { name: second, in: "query", schema: { type: "integer" } },
  ];
  const values = [first, second];
  if (reversed) {
    security.reverse();
    parameters.reverse();
    values.reverse();
  }
  return {
    openapi: "3.0.3",
    info: { title: "locale synthetic", version: "1" },
    components: {
      securitySchemes: {
        [first]: { type: "apiKey", in: "header", name: "X-" + first },
        [second]: { type: "apiKey", in: "header", name: "X-" + second },
      },
    },
    security,
    paths: {
      "/items": {
        post: {
          parameters,
          requestBody: {
            content: {
              "application/json": {
                schema: { type: "string", enum: values },
              },
            },
          },
          responses: {
            "200": {
              description: "ok",
              headers: {
                ["X-" + first]: { schema: { type: "integer" } },
                ["X-" + second]: { schema: { type: "string" } },
              },
            },
          },
        },
      },
    },
  };
}

function fingerprints(input: ReturnType<typeof makeContract>) {
  const inventory = buildCompleteOperationInventory({
    sourceFamily: "WILDBERRIES",
    snapshotSha256: "a".repeat(64),
    filename: "locale-contract.json",
    bytes: Buffer.from(JSON.stringify(input)),
  });
  const operation = inventory.operations[0];
  expect(inventory.operationCount).toBe(1);
  expect(operation?.identity).toBe("WILDBERRIES:POST:/items");
  return {
    security: operation!.securityRequirementsSha256,
    parameters: operation!.parameterSchemaSha256,
    request: operation!.requestSchemaSha256,
    response: operation!.responseSchemaSha256,
  };
}

describe("C03 inventory fingerprint is independent of host locale", () => {
  it("stably fingerprints Unicode security, parameters and request enum", () => {
    expect(fingerprints(makeContract(true))).toEqual({
      security:
        "8717627b00d05e9cda9954001a96625c4b3c4c274dacfe3e2bc33ef88d04577a",
      parameters:
        "61c194c69d19476665c3c59566e8b16e42467ce18b07021213e00ae1a22bcd78",
      request:
        "a209ecc407210a65ddd57de5d78baf399eb8b341bc28c96328fd6910065f9283",
      response:
        "3f0888dc0160073448f32e37ed6d435d015ded505af3451647a790eaca643cfd",
    });
  });

  it("ignores permutations of unordered security/parameter/enum collections", () => {
    expect(fingerprints(makeContract(true, true))).toEqual(
      fingerprints(makeContract(true)),
    );
  });

  it("retains ordinary ASCII fixture fingerprints", () => {
    expect(fingerprints(makeContract(false))).toEqual({
      security:
        "de2d5c227641d300d9782d47b14ef2c00e14f13bbcbc8996fcbe5087bd929c93",
      parameters:
        "eadc548a1b3b6c52083947742b4691ddf1f181030ac6e567cc1493f39eb7b586",
      request:
        "22ae3e541d09e29d1ecea7fe30a971fd7161f2282e1a1afadc3610c9fefc4cb4",
      response:
        "61e29d11db65063d8913716fd10d4f80683a7c7b3c94c3fa89bd2d7cbfa760bf",
    });
  });

  it("still detects genuine changes to the security definition", () => {
    const original = makeContract(true);
    const changed = makeContract(true);
    changed.components.securitySchemes.z!.name = "X-z-modified";
    expect(fingerprints(changed).security).not.toBe(
      fingerprints(original).security,
    );
  });
});
