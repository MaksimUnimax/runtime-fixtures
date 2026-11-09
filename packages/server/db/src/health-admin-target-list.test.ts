import { describe, expect, it, vi } from "vitest";
import type { DatabaseRuntime } from "./index.js";
import { createHealthAdminReadRepository } from "./health-admin-read-repository.js";

const revision = "00000000-0000-4000-8000-000000000002";
const candidate = "00000000-0000-4000-8000-000000000003";
const at = "2030-01-01T00:00:00.000Z";
const targetId = "a".repeat(64);

function identity(overrides: Record<string, unknown> = {}) {
  return {
    provider: "chatgpt",
    surface: "CHATGPT_WORK",
    target: "work",
    variant: "work",
    monitoringLayer: "NO_SESSION",
    baselineProfileRevisionId: revision,
    candidateProfileRevisionId: revision,
    healthSuiteMachineKey: "baseline-contract",
    healthSuiteRevision: 1,
    phase: "H5_CANARY",
    browserFamily: "chrome",
    browserVersion: "120.0.0.0",
    environmentClass: "ci",
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    target_id: targetId,
    provider: "chatgpt",
    surface: "CHATGPT_WORK",
    variant: "work",
    monitoring_layer: "NO_SESSION",
    browser_family: "chrome",
    browser_version: "120.0.0.0",
    health_state: "UNKNOWN",
    completed_at: at,
    latest_successful_run_at: null,
    scheduler_state: "FAILED_RETRYABLE",
    profile_revision_id: revision,
    baseline_profile_revision_id: revision,
    candidate_profile_revision_id: null,
    h5_recommendation: "CONTINUE",
    h5_outcome: "PASS",
    h5_result: { identity: identity(), outcome: "CANARY_ASSESSMENT" },
    ...overrides,
  };
}

function fixture(rows: ReturnType<typeof row>[]) {
  // Readonly query-port stub, not a PostgreSQL instance or SQL execution.
  const query = vi.fn(
    async (_text: string, _parameters?: readonly unknown[]) => ({ rows }),
  );
  return {
    query,
    repository: createHealthAdminReadRepository({
      query,
    } as unknown as DatabaseRuntime),
  };
}

async function first(value: ReturnType<typeof row>) {
  const { repository, query } = fixture([value]);
  const result = await repository.listTargets({ limit: 2, activeOnly: false });
  expect(query).toHaveBeenCalledTimes(1);
  return result.items[0]!;
}

describe("Health list target recommendation scope", () => {
  it.each([
    ["CONTINUE", "NO_RESTRICTION_SIGNAL"],
    ["HOLD", "ADVISORY_HOLD"],
    ["RESTRICT", "SCOPED_RESTRICTION_RECOMMENDED"],
    ["ROLLBACK_RECOMMENDED", "ROLLBACK_RECOMMENDED"],
    ["INCONCLUSIVE", "INCONCLUSIVE"],
  ])(
    "preserves exact-scope H5 %s without inventing HEALTHY",
    async (source, view) => {
      const value = await first(row({ h5_recommendation: source }));
      expect(value.recommendation).toBe(view);
      expect(value.latestHealthState).toBe("UNKNOWN");
      expect(value.latestSchedulerState).toBe("FAILED_RETRYABLE");
      expect(value.latestSuccessfulRunAt).toBeNull();
      expect(value.latestH5Result).toBe("CANARY_ASSESSMENT");
    },
  );

  it.each([
    ["provider", "alice"],
    ["surface", "ALICE"],
    ["variant", "standard"],
    ["candidateProfileRevisionId", candidate],
    ["browserFamily", "yandex_chromium"],
    ["browserVersion", "121.0.0.0"],
    ["monitoringLayer", "AUTHENTICATED_DEEP"],
  ])(
    "marks a selected evaluation with mismatched %s stale",
    async (field, value) => {
      const current = await first(
        row({
          h5_result: {
            identity: identity({ [field]: value }),
            outcome: "CANARY_ASSESSMENT",
          },
        }),
      );
      expect(current.recommendation).toBe("STALE");
      expect(current.latestHealthState).toBe("UNKNOWN");
    },
  );

  it.each([[undefined], [null], [{}], [[]]])(
    "does not trust an absent or incomplete identity: %j",
    async (value) => {
      const current = await first(row({ h5_result: { identity: value } }));
      expect(current.recommendation).toBe("STALE");
    },
  );

  it("requires the browser-version field even when the remaining identity matches", async () => {
    const { browserVersion: _browserVersion, ...partial } = identity();
    const current = await first(row({ h5_result: { identity: partial } }));
    expect(current.recommendation).toBe("STALE");
  });

  it("normalizes a persisted null variant for the default target", async () => {
    const current = await first(
      row({
        variant: "default",
        h5_result: { identity: identity({ variant: null, target: "default" }) },
      }),
    );
    expect(current.recommendation).toBe("NO_RESTRICTION_SIGNAL");
  });

  it("uses the current baseline rather than the old run profile", async () => {
    const current = await first(row({ profile_revision_id: candidate }));
    expect(current.recommendation).toBe("NO_RESTRICTION_SIGNAL");
  });

  it("uses a current candidate over the baseline", async () => {
    const current = await first(
      row({
        candidate_profile_revision_id: candidate,
        h5_result: { identity: identity({ candidateProfileRevisionId: candidate }) },
      }),
    );
    expect(current.recommendation).toBe("NO_RESTRICTION_SIGNAL");
  });

  it("keeps a selected old baseline stale when a candidate is current", async () => {
    const current = await first(row({ candidate_profile_revision_id: candidate }));
    expect(current.recommendation).toBe("STALE");
  });

  it("keeps missing H5 data missing", async () => {
    const current = await first(
      row({ h5_result: null, h5_recommendation: null, h5_outcome: null }),
    );
    expect(current.recommendation).toBeNull();
    expect(current.latestH5Result).toBeNull();
    expect(current.latestHealthState).toBe("UNKNOWN");
  });

  it("does not invent a known recommendation from an unsupported value", async () => {
    const current = await first(row({ h5_recommendation: "UNSUPPORTED" }));
    expect(current.recommendation).toBeNull();
  });

  it("preserves a same-scope post-rollout result", async () => {
    const current = await first(
      row({
        h5_recommendation: "RESTRICT",
        h5_result: {
          identity: identity({ phase: "H5_POST_ROLLOUT" }),
          outcome: "REGRESSION",
        },
      }),
    );
    expect(current.recommendation).toBe("SCOPED_RESTRICTION_RECOMMENDED");
    expect(current.latestH5Result).toBe("REGRESSION");
  });

  it("preserves bounded page order, cursor and one read without hydration", async () => {
    const { repository, query } = fixture([
      row(),
      row({ target_id: "b".repeat(64) }),
    ]);
    const result = await repository.listTargets({ limit: 2, activeOnly: false });
    expect(result.items.map((value) => value.targetId)).toEqual([
      targetId,
      "b".repeat(64),
    ]);
    expect(result.nextCursor).toBe("b".repeat(64));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([null, null, null, null, false, null, 2]);
  });

  it("keeps an empty page empty", async () => {
    const { repository, query } = fixture([]);
    await expect(
      repository.listTargets({ limit: 2, activeOnly: false }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("propagates the original read failure", async () => {
    const { repository, query } = fixture([]);
    query.mockRejectedValueOnce(new Error("READ_INPUT_FAILED"));
    await expect(
      repository.listTargets({ limit: 2, activeOnly: false }),
    ).rejects.toThrow("READ_INPUT_FAILED");
  });
});
