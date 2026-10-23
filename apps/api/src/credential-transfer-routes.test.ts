import { describe, expect, it, vi } from "vitest";
import { registerCredentialTransferRoutes } from "./credential-transfer-routes.js";

vi.mock("./app.js", () => ({
  ControlledError: class ControlledError extends Error {
    public constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  },
}));

describe("credential transfer route error mapping", () => {
  it("maps an oversized relay packet to the existing transfer-conflict status", async () => {
    type TestRequest = {
      extensionPrincipal: {
        sessionId: string;
        deviceId: string;
        accountId: string;
      };
      params: { requestId: string };
      body: { requestId: string; packetId: string; envelope: string };
    };
    type TestHandler = (request: TestRequest) => unknown;
    const handlers = new Map<string, TestHandler>();
    const app = {
      post(path: string, _options: unknown, handler: unknown) {
        handlers.set(`POST ${path}`, handler as TestHandler);
      },
      get(path: string, _options: unknown, handler: unknown) {
        handlers.set(`GET ${path}`, handler as TestHandler);
      },
    };
    const auth = {} as never;
    const service = {
      submit: async () => {
        throw Object.assign(new Error("TRANSFER_PACKET_TOO_LARGE"), {
          code: "TRANSFER_PACKET_TOO_LARGE",
        });
      },
    };
    registerCredentialTransferRoutes(app as never, service as never, auth);

    await expect(
      handlers.get("POST /v1/credential-transfers/:requestId/packet")!({
        extensionPrincipal: {
          sessionId: "31111111-1111-4111-8111-111111111111",
          deviceId: "31111111-1111-4111-8111-111111111112",
          accountId: "11111111-1111-4111-8111-111111111111",
        },
        params: { requestId: "61111111-1111-4111-8111-111111111111" },
        body: {
          requestId: "61111111-1111-4111-8111-111111111111",
          packetId: "71111111-1111-4111-8111-111111111111",
          envelope: "synthetic",
        },
      }),
    ).rejects.toMatchObject({
      code: "TRANSFER_PACKET_TOO_LARGE",
      statusCode: 409,
    });
  });
  it.each([
    "GET /v1/credential-transfers/pending/source",
    "GET /v1/credential-transfers/:requestId",
  ])(
    "maps an unavailable transfer writer into a bounded API conflict on %s",
    async (path) => {
      type TestRequest = {
        extensionPrincipal: {
          sessionId: string;
          deviceId: string;
          accountId: string;
        };
        params: { requestId: string };
      };
      type TestHandler = (request: TestRequest) => Promise<unknown>;
      const handlers = new Map<
        string,
        { options: unknown; handler: TestHandler }
      >();
      const app = {
        post() {},
        get(route: string, options: unknown, handler: unknown) {
          handlers.set(`GET ${route}`, {
            options,
            handler: handler as TestHandler,
          });
        },
      };
      const unavailable = async () => {
        throw Object.assign(new Error("TRANSFER_CONFLICT"), {
          code: "TRANSFER_CONFLICT",
        });
      };
      registerCredentialTransferRoutes(
        app as never,
        {
          listForSource: unavailable,
          read: unavailable,
        } as never,
        {} as never,
      );

      const route = handlers.get(path)!;
      const responses = (
        route.options as {
          schema: { response: Record<number, unknown> };
        }
      ).schema.response;
      expect(responses[409]).toBeDefined();
      await expect(
        route.handler({
          extensionPrincipal: {
            sessionId: "31111111-1111-4111-8111-111111111111",
            deviceId: "31111111-1111-4111-8111-111111111112",
            accountId: "11111111-1111-4111-8111-111111111111",
          },
          params: { requestId: "61111111-1111-4111-8111-111111111111" },
        }),
      ).rejects.toMatchObject({
        code: "TRANSFER_CONFLICT",
        statusCode: 409,
      });
    },
  );
});
