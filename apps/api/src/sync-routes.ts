import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import {
  ApiErrorEnvelopeV1Schema,
  SellerAgentsSyncRequestV1Schema,
  SellerAgentsSyncResponseV1Schema,
} from "@product/contracts";
import type {
  ExtensionAuthService,
  ExtensionPrincipal,
} from "@product/extension-auth";
import { SyncSnapshotReadError, type SyncService } from "@product/sync";
import { authenticateExtensionBearer } from "./extension-access-auth.js";
import { ControlledError } from "./app.js";

export function registerSyncRoutes(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression<RawServerDefault>,
    RawReplyDefaultExpression<RawServerDefault>,
    Logger
  >,
  service: SyncService,
  auth: ExtensionAuthService,
): void {
  app.post(
    "/v1/sync",
    {
      schema: {
        body: SellerAgentsSyncRequestV1Schema,
        response: {
          200: SellerAgentsSyncResponseV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
          409: ApiErrorEnvelopeV1Schema,
          503: ApiErrorEnvelopeV1Schema,
        },
      },
      preHandler: async (request) => {
        const result = await authenticateExtensionBearer(
          request.headers.authorization,
          auth,
        );
        if (!result.ok)
          throw new ControlledError("UNAUTHORIZED", "Unauthorized", 401);
        request.extensionPrincipal = result.value;
      },
    },
    async (request) => {
      try {
        return await service.apply(
          request.extensionPrincipal as ExtensionPrincipal,
          request.body,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "EXTENSION_AUTH_UNAUTHORIZED"
        )
          throw new ControlledError("UNAUTHORIZED", "Unauthorized", 401);
        if (
          error instanceof Error &&
          error.message === "ACCOUNT_IDENTITY_MISMATCH"
        )
          throw new ControlledError(
            "ACCOUNT_IDENTITY_MISMATCH",
            "Installation identity mismatch",
            403,
          );
        if (
          error instanceof Error &&
          error.message === "SYNC_REQUEST_ID_CONFLICT"
        )
          throw new ControlledError(
            "SYNC_REQUEST_ID_CONFLICT",
            "Request identity conflict",
            409,
          );
        if (
          error instanceof Error &&
          error.message === "SYNC_CANONICAL_ENTITY_MISMATCH"
        )
          throw new ControlledError(
            "SYNC_CONFLICT",
            "Binding entity identity mismatch",
            409,
          );
        if (
          error instanceof Error &&
          error.message === "SYNC_CANONICAL_ENTITY_COLLISION"
        )
          throw new ControlledError(
            "SYNC_CONFLICT",
            "Binding entity state is ambiguous",
            409,
          );
        if (error instanceof SyncSnapshotReadError) {
          if (error.code === "SYNC_SNAPSHOT_ENTITY_IDS_INVALID")
            throw new ControlledError(
              "SYNC_REQUEST_INVALID",
              "Invalid sync snapshot request",
              400,
            );
          throw new ControlledError(
            "SYNC_CONFLICT",
            "Sync snapshot state exceeds durable bounds",
            409,
          );
        }
        throw error;
      }
    },
  );
}
