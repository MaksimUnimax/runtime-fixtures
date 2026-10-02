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
  "POST /v1/support/cases",
]);

export function allowedRoute(method: string, path: string): string | undefined {
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
