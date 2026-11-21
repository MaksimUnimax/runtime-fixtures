// Keep the browser bundle separate from the server's authentication module.
// The contract test compares this list with the actual HTTP request schemas.
// ADMIN_BETA_OPERATOR exists internally but is not yet accepted by that API.
export const ADMIN_PRINCIPAL_ROLES = [
  "ADMIN_OWNER",
  "ADMIN_OPS",
  "ADMIN_SUPPORT",
  "ADMIN_BILLING_READONLY",
] as const;

export type AdminPrincipalRole = (typeof ADMIN_PRINCIPAL_ROLES)[number];

export function isAdminPrincipalRole(
  value: string,
): value is AdminPrincipalRole {
  return ADMIN_PRINCIPAL_ROLES.some((role) => role === value);
}
