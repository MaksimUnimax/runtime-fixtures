import { describe, expect, it } from "vitest";
import { ADMIN_ROLES } from "../../../packages/server/admin-auth/src/index";
import {
  AdminPrincipalCreateBodyV1Schema,
  AdminPrincipalRoleParamsV1Schema,
} from "../../../packages/contracts/src/index";
import {
  ADMIN_PRINCIPAL_ROLES,
  isAdminPrincipalRole,
} from "./admin-principal-roles";

describe("principal role choices", () => {
  it("matches the roles accepted by the real create and grant/revoke APIs", () => {
    const choices = [...ADMIN_PRINCIPAL_ROLES].sort();
    expect(choices).toEqual(
      [...AdminPrincipalCreateBodyV1Schema.shape.initialRole.options].sort(),
    );
    expect(choices).toEqual(
      [...AdminPrincipalRoleParamsV1Schema.shape.role.options].sort(),
    );
    expect(new Set(choices).size).toBe(choices.length);
    for (const role of ADMIN_PRINCIPAL_ROLES)
      expect(ADMIN_ROLES).toContain(role);
  });

  it("accepts server roles but leaves empty or unsupported selections invalid", () => {
    for (const role of AdminPrincipalRoleParamsV1Schema.shape.role.options)
      expect(isAdminPrincipalRole(role)).toBe(true);
    for (const role of ["", "ADMIN", "ADMIN_SUPERUSER", "ADMIN_OWNER/grant"])
      expect(isAdminPrincipalRole(role)).toBe(false);
  });
});
