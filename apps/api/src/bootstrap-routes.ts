import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { Logger } from "pino";
import {
  ApiErrorEnvelopeV1Schema,
  BootstrapRequestSchema,
  SignedBootstrapEnvelopeSchema,
  HealthAuthorityRequestV1Schema,
  SignedHealthEnvelopeV1Schema,
} from "@product/contracts";
import type { BootstrapService } from "@product/bootstrap";
import type {
  ExtensionAuthService,
  ExtensionPrincipal,
} from "@product/extension-auth";
import { authenticateExtensionBearer } from "./extension-access-auth.js";
import { BootstrapError } from "@product/bootstrap";
import { ControlledError } from "./app.js";

declare module "fastify" {
  interface FastifyRequest {
    extensionPrincipal?: ExtensionPrincipal;
  }
}
export function registerBootstrapRoutes(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression<RawServerDefault>,
    RawReplyDefaultExpression<RawServerDefault>,
    Logger
  >,
  service: BootstrapService,
  auth: ExtensionAuthService,
): void {
  app.post(
    "/v1/bootstrap",
    {
      schema: {
        body: BootstrapRequestSchema,
        response: {
          200: SignedBootstrapEnvelopeSchema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
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
      const parsed = BootstrapRequestSchema.safeParse(request.body);
      if (!parsed.success)
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      try {
        return parsed.data.contractVersion === "control_plane_v2"
          ? await service.issueV2(request.extensionPrincipal!, parsed.data)
          : await service.issue(request.extensionPrincipal!, parsed.data);
      } catch (error) {
        if (error instanceof BootstrapError && error.code === "DEVICE_MISMATCH")
          throw new ControlledError("DEVICE_MISMATCH", "Device mismatch", 403);
        if (error instanceof BootstrapError)
          throw new ControlledError(
            "BOOTSTRAP_UNAVAILABLE",
            "Bootstrap unavailable",
            503,
          );
        throw error;
      }
    },
  );
  app.post(
    "/v1/health-authority",
    {
      schema: {
        body: HealthAuthorityRequestV1Schema,
        response: {
          200: SignedHealthEnvelopeV1Schema,
          400: ApiErrorEnvelopeV1Schema,
          401: ApiErrorEnvelopeV1Schema,
          403: ApiErrorEnvelopeV1Schema,
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
      const parsed = HealthAuthorityRequestV1Schema.safeParse(request.body);
      if (!parsed.success)
        throw new ControlledError("INVALID_REQUEST", "Invalid request", 400);
      try {
        return await service.issueHealth(
          request.extensionPrincipal!,
          parsed.data,
        );
      } catch (error) {
        if (error instanceof BootstrapError && error.code === "DEVICE_MISMATCH")
          throw new ControlledError("DEVICE_MISMATCH", "Device mismatch", 403);
        if (error instanceof BootstrapError)
          throw new ControlledError(
            "BOOTSTRAP_UNAVAILABLE",
            "Health authority unavailable",
            503,
          );
        throw error;
      }
    },
  );
}
