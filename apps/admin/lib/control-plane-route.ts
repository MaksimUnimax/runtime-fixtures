const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const KEY = "[A-Za-z0-9._:-]+";

export const ADMIN_ALLOWED_TUPLES = [
  "DELETE /v1/admin/session",
  "GET /v1/admin/accounts",
  "GET /v1/admin/accounts/{account_id}/billing/events",
  "GET /v1/admin/accounts/{account_id}/billing/payments",
  "GET /v1/admin/accounts/{account_id}/billing/reconciliation-jobs",
  "GET /v1/admin/accounts/{account_id}/devices",
  "GET /v1/admin/accounts/{account_id}/entitlement-overrides",
  "GET /v1/admin/accounts/{account_id}/entitlements/{entitlement_key}",
  "GET /v1/admin/accounts/{account_id}/subscription",
  "GET /v1/admin/audit-events",
  "GET /v1/admin/commercial/entitlements/definitions",
  "GET /v1/admin/commercial/plans",
  "GET /v1/admin/commercial/plans/{plan_id}",
  "GET /v1/admin/commercial/prices",
  "GET /v1/admin/commercial/prices/{price_id}",
  "GET /v1/admin/compatibility/policies",
  "GET /v1/admin/me",
  "GET /v1/admin/principals",
  "GET /v1/admin/users",
  "POST /v1/admin/accounts/{account_id}/devices/{device_id}/revoke",
  "POST /v1/admin/accounts/{account_id}/entitlement-overrides/{entitlement_key}/clear",
  "POST /v1/admin/accounts/{account_id}/entitlement-overrides/{entitlement_key}/set",
  "POST /v1/admin/accounts/{account_id}/subscription/grant",
  "POST /v1/admin/accounts/{account_id}/subscription/{subscription_id}/extend",
  "POST /v1/admin/accounts/{account_id}/subscription/{subscription_id}/restore",
  "POST /v1/admin/accounts/{account_id}/subscription/{subscription_id}/suspend",
  "POST /v1/admin/commercial/entitlements/definitions",
  "POST /v1/admin/commercial/entitlements/definitions/{entitlement_key}/deprecate",
  "POST /v1/admin/commercial/entitlements/definitions/{entitlement_key}/description",
  "POST /v1/admin/commercial/plans",
  "POST /v1/admin/commercial/plans/{plan_id}/revisions",
  "POST /v1/admin/commercial/plans/{plan_id}/revisions/{plan_revision_id}/entitlements/{entitlement_key}/remove",
  "POST /v1/admin/commercial/plans/{plan_id}/revisions/{plan_revision_id}/entitlements/{entitlement_key}/set",
  "POST /v1/admin/commercial/plans/{plan_id}/revisions/{plan_revision_id}/publish",
  "POST /v1/admin/commercial/plans/{plan_id}/revisions/{plan_revision_id}/update",
  "POST /v1/admin/commercial/plans/{plan_id}/status",
  "POST /v1/admin/commercial/prices",
  "POST /v1/admin/commercial/prices/{price_id}/revisions",
  "POST /v1/admin/commercial/prices/{price_id}/revisions/{price_revision_id}/publish",
  "POST /v1/admin/commercial/prices/{price_id}/revisions/{price_revision_id}/update",
  "POST /v1/admin/commercial/prices/{price_id}/sale-assignments",
  "POST /v1/admin/commercial/prices/{price_id}/status",
  "POST /v1/admin/compatibility/policies/{policy_key}/publish",
  "POST /v1/admin/compatibility/releases/{version}/publish",
  "POST /v1/admin/principals",
  "POST /v1/admin/principals/{principal_id}/restore",
  "POST /v1/admin/principals/{principal_id}/roles/{role}/grant",
  "POST /v1/admin/principals/{principal_id}/roles/{role}/revoke",
  "POST /v1/admin/principals/{principal_id}/suspend",
  "POST /v1/admin/session",
  "GET /v1/admin/ai/registry/adapters",
  "GET /v1/admin/ai/registry/adapters/{adapter_id}/surfaces",
  "GET /v1/admin/ai/registry/surfaces/{surface_id}/variants",
  "GET /v1/admin/ai/profiles",
  "GET /v1/admin/ai/profiles/{profile_id}",
  "GET /v1/admin/ai/profiles/{profile_id}/revisions",
  "GET /v1/admin/ai/profiles/{profile_id}/revisions/{revision}",
  "GET /v1/admin/ai/assignments",
  "GET /v1/admin/ai/assignments/{assignment_id}",
  "GET /v1/admin/ai/assignments/{assignment_id}/revisions",
  "POST /v1/admin/ai/registry/adapters",
  "POST /v1/admin/ai/registry/surfaces",
  "POST /v1/admin/ai/registry/variants",
  "POST /v1/admin/ai/profiles",
  "POST /v1/admin/ai/registry/adapters/{adapter_id}/metadata",
  "POST /v1/admin/ai/registry/adapters/{adapter_id}/status",
  "POST /v1/admin/ai/registry/surfaces/{surface_id}/metadata",
  "POST /v1/admin/ai/registry/surfaces/{surface_id}/status",
  "POST /v1/admin/ai/registry/variants/{variant_id}/metadata",
  "POST /v1/admin/ai/registry/variants/{variant_id}/status",
  "POST /v1/admin/ai/profiles/{profile_id}/metadata",
  "POST /v1/admin/ai/profiles/{profile_id}/status",
  "POST /v1/admin/ai/profiles/{profile_id}/revisions",
  "POST /v1/admin/ai/profiles/{profile_id}/revisions/{revision}/replace",
  "POST /v1/admin/ai/profiles/{profile_id}/revisions/{revision}/candidate",
  "POST /v1/admin/ai/profiles/{profile_id}/revisions/{revision}/publish",
  "POST /v1/admin/ai/profiles/{profile_id}/revisions/{revision}/retire",
  "POST /v1/admin/ai/assignments",
  "POST /v1/admin/ai/assignments/{assignment_id}/direct",
  "POST /v1/admin/ai/assignments/{assignment_id}/rollout",
  "POST /v1/admin/ai/assignments/{assignment_id}/percentage",
  "POST /v1/admin/ai/assignments/{assignment_id}/pause",
  "POST /v1/admin/ai/assignments/{assignment_id}/resume",
  "POST /v1/admin/ai/assignments/{assignment_id}/complete",
  "POST /v1/admin/ai/assignments/{assignment_id}/rollback",
] as const;

export const OTP_ALLOWED_TUPLES = [
  "POST /v1/auth/otp/request",
  "POST /v1/auth/otp/verify",
] as const;

const templates = new Map<string, RegExp>();
const segmentPattern = (segment: string): string => {
  if (
    segment === "{account_id}" ||
    segment === "{device_id}" ||
    segment === "{subscription_id}" ||
    segment === "{plan_id}" ||
    segment === "{plan_revision_id}" ||
    segment === "{price_id}" ||
    segment === "{price_revision_id}" ||
    segment === "{principal_id}"
  )
    return UUID;
  if (
    segment === "{adapter_id}" ||
    segment === "{surface_id}" ||
    segment === "{variant_id}" ||
    segment === "{profile_id}" ||
    segment === "{assignment_id}"
  )
    return UUID;
  if (segment === "{version}") return "[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}";
  if (segment === "{revision}") return "[1-9][0-9]*";
  if (
    segment === "{entitlement_key}" ||
    segment === "{policy_key}" ||
    segment === "{role}"
  )
    return KEY;
  return segment;
};
for (const tuple of [...ADMIN_ALLOWED_TUPLES, ...OTP_ALLOWED_TUPLES]) {
  const separator = tuple.indexOf(" ");
  const method = tuple.slice(0, separator);
  const path = tuple.slice(separator + 1);
  const regex = path.split("/").map(segmentPattern).join("\\/");
  templates.set(
    tuple,
    new RegExp(`^${method}\\/${regex.replace(/^\\\//, "")}$`),
  );
}

export function allowedRoute(method: string, path: string): string | undefined {
  if (
    !path.startsWith("/") ||
    path.includes("%") ||
    path.includes("\\") ||
    path
      .split("/")
      .slice(1)
      .some((part) => part === "" || part === "." || part === "..")
  )
    return undefined;
  for (const tuple of [...ADMIN_ALLOWED_TUPLES, ...OTP_ALLOWED_TUPLES]) {
    const separator = tuple.indexOf(" ");
    const verb = tuple.slice(0, separator);
    const template = tuple.slice(separator + 1);
    const pattern = `^${template.split("/").map(segmentPattern).join("\\/")}$`;
    if (verb === method && new RegExp(pattern).test(path)) return template;
  }
  return undefined;
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

export const BFF_ALLOWED_TUPLE_COUNT =
  ADMIN_ALLOWED_TUPLES.length + OTP_ALLOWED_TUPLES.length;
