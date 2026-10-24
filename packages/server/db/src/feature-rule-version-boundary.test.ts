import { describe, expect, it, vi } from "vitest";
import {
  P3FeatureRuleSchema,
  PublishFeatureRuleRevisionCommandSchema,
  resolveP3BootstrapPolicy,
} from "@product/remote-config";
import type { ContractVersion } from "@product/compatibility";
import type { DatabaseQuery, DatabaseRuntime } from "./index.js";
import { createP3BootstrapPolicyCatalogRepository } from "./p3-bootstrap-policy-catalog-repository.js";
import { createP3PolicyPublicationRepository } from "./p3-policy-publication-repository.js";

const ruleId = "11111111-1111-4111-8111-111111111111";
const candidateId = "22222222-2222-4222-8222-222222222222";
const releaseId = "33333333-3333-4333-8333-333333333333";
const rolloutId = "44444444-4444-4444-8444-444444444444";
const revisionId = "55555555-5555-4555-8555-555555555555";
const now = new Date("2026-10-24T00:00:00.000Z");
const contracts = ["control_plane_v1", "control_plane_v2"] as const;

function rule(contractVersion: ContractVersion, minimum: string | null) {
  return {
    id: ruleId,
    featureKey: "fixture.minimum",
    revision: 1,
    contractVersion,
    enabled: true,
    browserFamily: null,
    minimumExtensionVersion: minimum,
  };
}

function command(contractVersion: ContractVersion, minimum: string | null) {
  const { id, revision, ...body } = rule(contractVersion, minimum);
  void id;
  void revision;
  return { ...body, publishedAt: now };
}

// Only the query port is synthetic. The production publication adapter,
// persisted-row reader and policy resolver below are exercised unchanged.
function syntheticDatabase(
  handler: (sql: string, values: unknown[]) => Record<string, unknown>[],
) {
  const calls = vi.fn(handler);
  const database: DatabaseQuery = {
    async query<T extends Record<string, unknown>>(sql: string, values = []) {
      return { rows: calls(sql, values) as T[] };
    },
  };
  return { database, calls };
}

function resolverFixture(
  contractVersion: ContractVersion,
  minimum: string | null,
  placement: "ordinary" | "rollout-candidate",
) {
  const ordinary = rule(
    contractVersion,
    placement === "ordinary" ? minimum : null,
  );
  const candidate = {
    ...rule(contractVersion, minimum),
    id: candidateId,
    revision: 2,
  };
  const config = {
    configVersion: 7,
    contractVersion,
    snapshotVersion:
      contractVersion === "control_plane_v1"
        ? "bootstrap_snapshot_v1"
        : "bootstrap_snapshot_v2",
    envelopeVersion:
      contractVersion === "control_plane_v1"
        ? "bootstrap_envelope_v1"
        : "bootstrap_envelope_v2",
    contentHashSha256: "a".repeat(64),
    sourceFingerprintSha256: "b".repeat(64),
    signingKeyId: "fixture-key",
    publishedAt: now,
    createdAt: now,
  };
  const { database, calls } = syntheticDatabase((sql, values) => {
    if (sql.includes("FROM config_releases")) return [config];
    if (sql.includes("FROM config_release_feature_rules")) return [ordinary];
    if (sql.includes("FROM config_release_compatibility_policies")) return [];
    if (sql.includes("FROM config_release_rollout_revisions")) {
      return placement === "ordinary"
        ? []
        : [
            {
              id: revisionId,
              rolloutId,
              targetKind: "FEATURE_RULE",
              revision: 1,
              state: "ACTIVE",
              percentageBps: 10000,
              baselineConfigVersion: null,
              candidateConfigVersion: null,
              baselineFeatureRuleRevisionId: ruleId,
              candidateFeatureRuleRevisionId: candidateId,
            },
          ];
    }
    if (sql.includes("FROM rollouts WHERE rollout_key")) return [];
    if (sql.includes("FROM rollouts WHERE id"))
      return [
        {
          id: rolloutId,
          rolloutKey: "fixture.minimum.rollout",
          targetKind: "FEATURE_RULE",
          subjectKind: "ACCOUNT",
          cohortSeed: Buffer.alloc(32, 7),
        },
      ];
    if (sql.includes("FROM feature_rule_revisions WHERE id")) {
      return values[0] === ruleId
        ? [ordinary]
        : values[0] === candidateId
          ? [candidate]
          : [];
    }
    if (sql.includes("FROM extension_releases"))
      return [
        {
          id: releaseId,
          version: "1.2.3",
          releaseChannel: "fixture",
          artifactSha256: null,
          releasedAt: now,
          createdAt: now,
        },
      ];
    if (sql.includes("FROM extension_release_contracts"))
      return [{ releaseId, contractVersion }];
    if (sql.includes("FROM extension_release_browsers"))
      return [{ releaseId, browserFamily: "chrome" }];
    throw new Error(`Unexpected synthetic query: ${sql}`);
  });
  return {
    catalog: createP3BootstrapPolicyCatalogRepository(database),
    calls,
    input: {
      contractVersion,
      extensionVersion: "1.2.3",
      browser: { family: "chrome" as const, version: "120" },
      accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    },
  };
}

for (const contract of contracts) {
  describe(`feature minimum version boundary ${contract}`, () => {
    it.each([true, false])(
      "rejects an empty publication/row minimum with enabled=%s",
      (enabled) => {
        expect(
          PublishFeatureRuleRevisionCommandSchema.safeParse({
            ...command(contract, ""),
            enabled,
          }).success,
        ).toBe(false);
        expect(
          P3FeatureRuleSchema.safeParse({ ...rule(contract, ""), enabled })
            .success,
        ).toBe(false);
      },
    );

    it.each([
      " ",
      "\t",
      "1",
      "01.2.3",
      "1.2.3-01",
      "1.2.3+",
      "1.2.3+" + "x".repeat(59),
    ])("keeps rejecting malformed or oversized minimum %j", (minimum) => {
      expect(
        PublishFeatureRuleRevisionCommandSchema.safeParse(
          command(contract, minimum),
        ).success,
      ).toBe(false);
      expect(
        P3FeatureRuleSchema.safeParse(rule(contract, minimum)).success,
      ).toBe(false);
    });

    it.each([
      null,
      "0.0.0",
      "1.2.3",
      "1.2.3-rc.1",
      "1.2.3+build.5",
      "1.2.3+" + "x".repeat(58),
    ])("preserves the exact valid minimum %j", (minimum) => {
      expect(
        PublishFeatureRuleRevisionCommandSchema.parse(
          command(contract, minimum),
        ).minimumExtensionVersion,
      ).toBe(minimum);
      expect(
        P3FeatureRuleSchema.parse(rule(contract, minimum))
          .minimumExtensionVersion,
      ).toBe(minimum);
    });

    it("rejects the empty command before entering a transaction", async () => {
      const transaction = vi.fn(async () => {
        throw new Error("UNEXPECTED_TRANSACTION");
      });
      const runtime = { transaction } as unknown as DatabaseRuntime;
      const publication = createP3PolicyPublicationRepository(runtime);
      await expect(
        publication.publishFeatureRuleRevision(command(contract, ""), {
          actorType: "SYSTEM",
          correlationId: "fixture-minimum",
        }),
      ).rejects.toMatchObject({ name: "ZodError" });
      expect(transaction).not.toHaveBeenCalled();
    });

    it.each([null, "1.2.3-rc.1+build.5"])(
      "preserves valid publication and audit with minimum %j",
      async (minimum) => {
        const { database, calls } = syntheticDatabase((sql) => {
          if (sql.startsWith("SELECT pg_advisory_xact_lock")) return [];
          if (sql.startsWith("SELECT COALESCE(MAX(revision)"))
            return [{ revision: 1 }];
          if (sql.startsWith("INSERT INTO feature_rule_revisions"))
            return [{ id: ruleId, revision: 1 }];
          if (sql.startsWith("INSERT INTO audit_events")) return [];
          throw new Error(`Unexpected synthetic query: ${sql}`);
        });
        const transaction = vi.fn(
          async (operation: (db: DatabaseQuery) => Promise<unknown>) =>
            operation(database),
        );
        const publication = createP3PolicyPublicationRepository({
          transaction,
        } as unknown as DatabaseRuntime);
        await expect(
          publication.publishFeatureRuleRevision(command(contract, minimum), {
            actorType: "SYSTEM",
            correlationId: "fixture-minimum",
          }),
        ).resolves.toEqual({ id: ruleId, revision: 1 });
        expect(transaction).toHaveBeenCalledTimes(1);
        const insert = calls.mock.calls.find(([sql]) =>
          sql.startsWith("INSERT INTO feature_rule_revisions"),
        );
        expect(insert?.[1][5]).toBe(minimum);
        expect(
          calls.mock.calls.filter(([sql]) =>
            sql.startsWith("INSERT INTO audit_events"),
          ),
        ).toHaveLength(1);
      },
    );

    it.each(["lookup", "config-list"] as const)(
      "rejects a persisted empty minimum through %s",
      async (method) => {
        const { database } = syntheticDatabase(() => [rule(contract, "")]);
        const catalog = createP3BootstrapPolicyCatalogRepository(database);
        await expect(
          method === "lookup"
            ? catalog.findFeatureRuleRevision(ruleId)
            : catalog.listConfigFeatureRules(7),
        ).rejects.toMatchObject({ name: "ZodError" });
      },
    );

    for (const placement of ["ordinary", "rollout-candidate"] as const) {
      it(`fails closed on an empty ${placement} minimum in the actual catalog/resolver chain`, async () => {
        const fixture = resolverFixture(contract, "", placement);
        await expect(
          resolveP3BootstrapPolicy(fixture.input, fixture.catalog),
        ).resolves.toEqual({ failure: "CONFIG_SOURCE_INVALID" });
      });
      it.each([
        [null, true],
        ["1.2.3", true],
        ["1.2.3-rc.1", true],
        ["1.2.3+build.5", true],
        ["2.0.0", false],
      ] as const)(
        `preserves ${placement} selection for minimum %j => %s`,
        async (minimum, enabled) => {
          const fixture = resolverFixture(contract, minimum, placement);
          const result = await resolveP3BootstrapPolicy(
            fixture.input,
            fixture.catalog,
          );
          expect(result).toMatchObject({
            configVersion: 7,
            features: { "fixture.minimum": enabled },
          });
          expect(result).not.toHaveProperty("failure");
        },
      );
    }
  });
}
