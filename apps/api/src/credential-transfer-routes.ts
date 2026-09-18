import type {
  FastifyInstance,
  FastifyRequest,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import {
  ApiErrorEnvelopeV1Schema,
  TransferAckV1Schema,
  TransferCreateRequestV1Schema,
  TransferPacketV1Schema,
  TransferRequestV1Schema,
  TransferSubmitPacketV1Schema,
  type ApiErrorCodeV1,
} from "@product/contracts";
import type { CredentialTransferService } from "@product/credential-transfer";
import type {
  ExtensionAuthService,
  ExtensionPrincipal,
} from "@product/extension-auth";
import { authenticateExtensionBearer } from "./extension-access-auth.js";
import { ControlledError } from "./app.js";

type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;

function principal(request: FastifyRequest): ExtensionPrincipal {
  return request.extensionPrincipal as ExtensionPrincipal;
}

export function registerCredentialTransferRoutes(
  app: App,
  service: CredentialTransferService,
  auth: ExtensionAuthService,
): void {
  const guarded = {
    preHandler: async (request: FastifyRequest) => {
      const result = await authenticateExtensionBearer(
        request.headers.authorization,
        auth,
      );
      if (!result.ok)
        throw new ControlledError("UNAUTHORIZED", "Unauthorized", 401);
      request.extensionPrincipal = result.value;
    },
  };
  const handle = async (fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "TRANSFER_INVALID";
      const known = [
        "SOURCE_OFFLINE",
        "TRANSFER_EXPIRED",
        "TRANSFER_INVALID",
        "TRANSFER_REPLAY",
        "TRANSFER_CONFLICT",
        "TRANSFER_DEVICE_REVOKED",
        "TRANSFER_ACCOUNT_MISMATCH",
      ];
      if (known.includes(code))
        throw new ControlledError(
          code as ApiErrorCodeV1,
          code,
          code === "SOURCE_OFFLINE"
            ? 409
            : code === "TRANSFER_EXPIRED"
              ? 410
              : 409,
        );
      throw error;
    }
  };
  app.post(
    "/v1/credential-transfers",
    {
      ...guarded,
      schema: {
        body: TransferCreateRequestV1Schema,
        response: {
          201: TransferRequestV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request, reply) =>
      handle(() => service.create(principal(request), request.body)).then(
        (value) => reply.status(201).send(value),
      ),
  );
  app.get(
    "/v1/credential-transfers/pending/source",
    {
      ...guarded,
      schema: {
        response: {
          200: TransferRequestV1Schema.array(),
          401: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request) => service.listForSource(principal(request)),
  );
  app.get(
    "/v1/credential-transfers/:requestId",
    {
      ...guarded,
      schema: {
        response: {
          200: TransferRequestV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          404: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request) => {
      const { requestId } = request.params as { requestId: string };
      const value = await service.read(principal(request), requestId);
      if (!value)
        throw new ControlledError(
          "TRANSFER_ACCOUNT_MISMATCH",
          "Transfer request not found",
          404,
        );
      return value;
    },
  );
  app.post(
    "/v1/credential-transfers/:requestId/source-seen",
    {
      ...guarded,
      schema: {
        response: {
          200: TransferRequestV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request) =>
      handle(() =>
        service.sourceSeen(
          principal(request),
          (request.params as { requestId: string }).requestId,
        ),
      ),
  );
  app.post(
    "/v1/credential-transfers/:requestId/packet",
    {
      ...guarded,
      schema: {
        body: TransferSubmitPacketV1Schema,
        response: {
          200: TransferRequestV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request) => {
      const result = (await handle(() =>
        service.submit(principal(request), request.body),
      )) as { request: unknown };
      return result.request;
    },
  );
  app.get(
    "/v1/credential-transfers/:requestId/packet",
    {
      ...guarded,
      schema: {
        response: {
          200: TransferPacketV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          410: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request) =>
      handle(() =>
        service.receive(
          principal(request),
          (request.params as { requestId: string }).requestId,
        ),
      ),
  );
  app.post(
    "/v1/credential-transfers/:requestId/ack",
    {
      ...guarded,
      schema: {
        body: TransferAckV1Schema,
        response: {
          200: TransferRequestV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          410: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request) =>
      handle(() => service.acknowledge(principal(request), request.body)),
  );
  app.post(
    "/v1/credential-transfers/:requestId/cancel",
    {
      ...guarded,
      schema: {
        response: {
          200: TransferRequestV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
        },
      },
    },
    async (request) =>
      handle(() =>
        service.cancel(
          principal(request),
          (request.params as { requestId: string }).requestId,
        ),
      ),
  );
}
