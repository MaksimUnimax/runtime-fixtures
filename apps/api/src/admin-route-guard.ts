import type { FastifyRequest } from "fastify";
import {
  AdminAuthService,
  type AdminPermission,
  type AdminSubject,
} from "@product/admin-auth";
import { ControlledError } from "./app.js";

export const ADMIN_SESSION_COOKIE = "pcp_admin_session";
export const ADMIN_CSRF_COOKIE = "pcp_admin_csrf";

type GuardRequest = Pick<FastifyRequest, "cookies" | "headers">;

function error(
  code:
    | "ADMIN_UNAUTHORIZED"
    | "ADMIN_FORBIDDEN"
    | "ADMIN_CSRF_INVALID"
    | "SERVICE_UNAVAILABLE",
) {
  return new ControlledError(
    code,
    code === "SERVICE_UNAVAILABLE"
      ? "Required service is unavailable"
      : "Admin authentication failed",
    code === "ADMIN_UNAUTHORIZED"
      ? 401
      : code === "SERVICE_UNAVAILABLE"
        ? 503
        : 403,
  );
}

export function createAdminRouteGuard(adminAuth: AdminAuthService) {
  async function requireAdminSubject(
    request: GuardRequest,
  ): Promise<{ token: string; subject: AdminSubject }> {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      if (
        request.cookies[ADMIN_SESSION_COOKIE] ||
        !authorization.startsWith("Bearer octm_") ||
        !adminAuth.maintenance
      )
        throw error("ADMIN_UNAUTHORIZED");
      const token = authorization.slice(7);
      const result = await adminAuth.maintenance.authenticate(token);
      if (!result.ok)
        throw error(
          result.code === "SERVICE_UNAVAILABLE"
            ? result.code
            : "ADMIN_UNAUTHORIZED",
        );
      return { token, subject: result.value };
    }
    const token = request.cookies[ADMIN_SESSION_COOKIE];
    if (!token) throw error("ADMIN_UNAUTHORIZED");
    const result = await adminAuth.authenticateAdminSession(token);
    if (!result.ok) {
      if (result.code === "SERVICE_UNAVAILABLE") throw error(result.code);
      throw error("ADMIN_UNAUTHORIZED");
    }
    return { token, subject: result.value };
  }

  async function requireAdminPermission(
    request: GuardRequest,
    permission: AdminPermission,
  ) {
    const authenticated = await requireAdminSubject(request);
    const result = adminAuth.authorize(authenticated.subject, permission);
    if (!result.ok) throw error("ADMIN_FORBIDDEN");
    return authenticated;
  }

  async function requireAdminMutation(
    request: GuardRequest,
    permission?: AdminPermission,
  ) {
    const authenticated = permission
      ? await requireAdminPermission(request, permission)
      : await requireAdminSubject(request);
    if (authenticated.subject.maintenanceGrantId) {
      if (!permission) throw error("ADMIN_FORBIDDEN");
      return authenticated;
    }
    const header = request.headers["x-csrf-token"];
    const csrf = typeof header === "string" ? header : undefined;
    if (
      !adminAuth.csrfValid(
        authenticated.token,
        csrf,
        request.cookies[ADMIN_CSRF_COOKIE],
      )
    )
      throw error("ADMIN_CSRF_INVALID");
    return authenticated;
  }

  return { requireAdminSubject, requireAdminPermission, requireAdminMutation };
}

export type AdminRouteGuard = ReturnType<typeof createAdminRouteGuard>;
