import type { DatabaseRuntime } from "./index.js";
import { authorizeAdminMutationInTransaction } from "./admin-mutation-authorization.js";
import { createP4PlanCommandRepository } from "./p4-plan-command-repository.js";
import { createP4PriceCommandRepository } from "./p4-price-command-repository.js";
import { createP4EntitlementRepository } from "./p4-entitlement-repository.js";
import { createP3PolicyPublicationRepository } from "./p3-policy-publication-repository.js";
import type { PlanEntitlementCommandRepository } from "@product/plans";
import type { PriceCommandRepository } from "@product/pricing";
import type { AccountEntitlementOverrideMutationPort } from "@product/entitlements";
import type { CompatibilityPublicationPort } from "@product/compatibility";

export function createP6AdminPlanCommandAdapter(
  runtime: DatabaseRuntime,
): PlanEntitlementCommandRepository {
  return new Proxy({} as PlanEntitlementCommandRepository, {
    get:
      (_target, property: keyof PlanEntitlementCommandRepository) =>
      (...args: unknown[]) => {
        const context = args[1] as { actorId: string };
        const repo = createP4PlanCommandRepository(runtime, {
          beforeMutation: (tx) =>
            authorizeAdminMutationInTransaction(
              tx,
              context.actorId,
              "plan.manage",
            ),
        });
        return (repo[property] as (...a: unknown[]) => unknown)(...args);
      },
  });
}
export function createP6AdminPriceCommandAdapter(
  runtime: DatabaseRuntime,
): PriceCommandRepository {
  return new Proxy({} as PriceCommandRepository, {
    get:
      (_target, property: keyof PriceCommandRepository) =>
      (...args: unknown[]) => {
        const context = args[1] as { actorId: string };
        const repo = createP4PriceCommandRepository(runtime, {
          beforeMutation: (tx) =>
            authorizeAdminMutationInTransaction(
              tx,
              context.actorId,
              "price.manage",
            ),
        });
        return (repo[property] as (...a: unknown[]) => unknown)(...args);
      },
  });
}
export function createP6AdminEntitlementCommandAdapter(
  runtime: DatabaseRuntime,
): AccountEntitlementOverrideMutationPort {
  return new Proxy({} as AccountEntitlementOverrideMutationPort, {
    get:
      (_target, property: keyof AccountEntitlementOverrideMutationPort) =>
      (...args: unknown[]) => {
        const context = args[1] as { actorId: string };
        const repo = createP4EntitlementRepository(runtime, {
          beforeMutation: (tx) =>
            authorizeAdminMutationInTransaction(
              tx,
              context.actorId,
              "entitlement.override",
            ),
        });
        return (repo[property] as (...a: unknown[]) => unknown)(...args);
      },
  });
}
export function createP6AdminCompatibilityCommandAdapter(
  runtime: DatabaseRuntime,
): CompatibilityPublicationPort {
  return {
    publishExtensionRelease: (command, context) => {
      if (context.actorType !== "ADMIN")
        throw new Error("ADMIN_EXTENSION_RELEASE_CONTEXT_REQUIRED");
      return createP3PolicyPublicationRepository(runtime, {
        beforeExtensionReleasePublication: (tx) =>
          authorizeAdminMutationInTransaction(
            tx,
            context.actorId,
            "compatibility.manage",
          ),
      }).publishExtensionRelease(command, context);
    },
    publishCompatibilityPolicyRevision: (command, context) =>
      createP3PolicyPublicationRepository(runtime, {
        beforeCompatibilityPublication:
          context.actorType === "ADMIN"
            ? (tx) =>
                authorizeAdminMutationInTransaction(
                  tx,
                  context.actorId,
                  "compatibility.manage",
                )
            : undefined,
      }).publishCompatibilityPolicyRevision(command, context),
  };
}
