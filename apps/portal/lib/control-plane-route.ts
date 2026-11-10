import {
  acw1HttpBoundary,
  type Acw1HttpReadIntent,
} from "@product/contracts/account-code-http";

const allowed = new Set([
  "POST /v1/auth/otp/request",
  "POST /v1/auth/otp/verify",
  "POST /v1/auth/logout",
  "GET /v1/accounts",
  "GET /v1/device-authorizations/:id",
  "POST /v1/device-authorizations/:id/approve",
  "POST /v1/device-authorizations/:id/deny",
  "GET /v1/devices",
  "POST /v1/devices/:id/revoke",
  "GET /v1/subscription",
  "GET /v1/billing/payments",
  "GET /v1/support/cases",
  "GET /v1/support/cases/:id",
  "POST /v1/support/cases",
]);

/** Framework params/search describe the forwarded target, not original HTTP bytes. */
export function accountCodeReadIntent(
  method: string,
  path: string,
  search: string,
): Acw1HttpReadIntent | undefined {
  const result = acw1HttpBoundary(method, path + search);
  return result.kind === "METADATA_READ" ? result.read : undefined;
}

export function allowedRoute(method: string, path: string, search = ""): string | undefined {
  if (accountCodeReadIntent(method, path, search))
    return "/v1/accounts/:id/connection-code";
  const normalized = path.replace(/\/[0-9a-f-]{36}(?=\/|$)/gi, "/:id");
  return allowed.has(`${method} ${normalized}`) ? normalized : undefined;
}

export function controlPlaneOrigin(
  raw = process.env.CONTROL_PLANE_API_ORIGIN,
): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}
