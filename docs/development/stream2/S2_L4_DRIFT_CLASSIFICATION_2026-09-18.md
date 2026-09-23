# S2-L4 drift classification hardening

Work ID: `S2_L4_LLM_DRIFT_CLASSIFICATION_HARDENING_2026-09-18_R1`

This is a non-live, classifier-only candidate. It does not establish live ChatGPT Standard, ChatGPT Work, or Alice health.

## Lineage and authority

- Accepted local parent: `5e1488475328d3675adf861cf6f6ba662f8dc666`
- Accepted parent tree: `9ca9d8594e6bee6bb5bdb95bf145e8a2b120c85e`
- Re-fetched live integration ref: `origin/integration/i1-c1-srv5-2026-09-16` at `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- Historical Health ref: `d4bae8752c304cd49ef5c0f4ef2b5d44281d0f95`
- Worktree: `/root/worktrees/stream2-health-l4-classification-2026-09-18`
- Branch: `feature/stream2-health-l4-classification-2026-09-18`

The source repository worktree was occupied by unrelated dirty Stream-1 work. This task used a clean isolated worktree from the exact accepted parent and did not modify the Stream-1 worktree.

## Existing classifier and observation audit

Before implementation, `packages/server/health/src/classifier.ts` validated the suite and results, returned `MAINTENANCE`, then returned `UNKNOWN` if any result had `environmentStatus=UNCERTAIN`, otherwise evaluated product findings. Thus a valid C05/C03/C09 failure could be hidden by an unrelated C13 uncertainty marker. It had no detailed bounded explanation API.

The audit covered H2 mapping, H3 engine mapping, H3 persistence, all three accepted H3 strategies, C13, browser-driver errors, and evidence sanitization:

- H2 maps browser-driver `CONTROLLED_BROWSER_UNAVAILABLE`, navigation failure, and observation timeout to bounded environment reasons. H2 observations can carry uncertainty per contour, and the H2 runner stops the probe after uncertainty. H2 is not directly converted to `HealthContourResult` by this classifier.
- Standard and Work surface strategies emit provider blocker reasons only from their surface-identification environment precondition. The accepted reasons are login expiry, verification, CAPTCHA, account block, network-before-identity, and controlled-browser unavailable.
- Alice currently emits only controlled-browser-unavailable and network-before-page-identity uncertainty; it has no invented provider-specific blocker selectors.
- Accepted uncertain H3 execution is persisted through C13 when no C13 observation was emitted. The mapper uses `PRESENT`, `UNCERTAIN`, no selected strategy, no fallback, `NOT_RUN`/`UNCERTAIN` assertion semantics as appropriate, `NOT_APPLICABLE` fallback quality, and the bounded reason. Non-C13 product observations remain independently mapped.
- H3 event observations are sanitized to Health-owned contour/finding vocabulary and bounded safe evidence references. No prompt, response, DOM, route, conversation, project, cookie, storage, or arbitrary error text enters classification.
- Browser-driver and H3 failures do not add raw error payloads to Health results.

The current accepted runner behavior means a legitimate pre-identity H3 uncertainty is represented by a C13 blocker plus other contours that are absent/not observed. Independently present product contour results are distinct evidence. The classifier therefore does not infer causality from raw DOM or provider text.

## Decision matrix

| Observation shape | Coherence decision | Classification basis/state |
| --- | --- | --- |
| No uncertainty; all required primary observations pass | Coherent | `HEALTHY_PRIMARY` / `HEALTHY` |
| No finding; explicitly permitted optional contour absent | Coherent | `HEALTHY_ALLOWED_OPTIONAL_ABSENCE` / `HEALTHY` |
| Primary fails; selected fallback passes with approved equivalent quality | Coherent | `DRIFT_APPROVED_FALLBACK` / `DRIFT` |
| Materially degraded fallback or important non-core failure | Coherent | `DEGRADED_MATERIAL_FALLBACK` or `DEGRADED_NON_CORE_FAILURE` / `DEGRADED` |
| Required CORE contour independently fails | Coherent | `BROKEN_REQUIRED_CORE_FAILURE` / `BROKEN` |
| One present C13 blocker, pre-identity reason, no confident C01 and no independently present product failure | Coherent | `UNKNOWN_PRE_IDENTITY_ENVIRONMENT` / `UNKNOWN` |
| One present C13 auth/security blocker with no independently present product failure | Coherent | `UNKNOWN_AUTH_OR_SECURITY_BLOCKER` / `UNKNOWN` |
| C01 is confident and a pre-identity marker coexists with an independent present product failure | Product evidence wins | `BROKEN`, `DEGRADED`, or `DRIFT`; the bounded uncertainty reason is retained |
| C01 is confident with a pre-identity marker but no independent product finding | Incoherent | throw `INCOHERENT_ENVIRONMENT_OBSERVATION` |
| More than one uncertainty result/reason, non-C13 uncertainty, malformed C13 blocker shape, or product evidence after an unresolved pre-identity blocker | Incoherent | throw `INCOHERENT_ENVIRONMENT_OBSERVATION` |

The C01 boundary is not a blanket override. A confident C01 allows later independent product findings to retain precedence; a pre-identity reason without a supported independent finding remains either legitimate `UNKNOWN` before identity or a fail-closed incoherence after identity.

## Detailed classification API

`classifyHealthDetailed(input)` is the classification authority. `classifyHealth(input)` is a thin state-only wrapper over it.

The immutable result is:

```ts
{
  state: HealthState;
  basis: HealthClassificationBasis;
  findingContourKeys: BaselineContourKey[]; // suite order, max 13
  productFindings: { contourKey: BaselineContourKey; finding: "BROKEN" | "DEGRADED" | "DRIFT" }[]; // max 13
  environmentUncertaintyReasons: EnvironmentUncertaintyReason[]; // max 6, unique
  operatorMaintenance: boolean;
}
```

The basis vocabulary is bounded and stable: `HEALTHY_PRIMARY`, `HEALTHY_ALLOWED_OPTIONAL_ABSENCE`, `DRIFT_APPROVED_FALLBACK`, `DEGRADED_NON_CORE_FAILURE`, `DEGRADED_MATERIAL_FALLBACK`, `BROKEN_REQUIRED_CORE_FAILURE`, `UNKNOWN_PRE_IDENTITY_ENVIRONMENT`, `UNKNOWN_AUTH_OR_SECURITY_BLOCKER`, `MAINTENANCE_OPERATOR`, and `INCOHERENT_ENVIRONMENT_OBSERVATION`.

The result contains only contour keys, state/finding enums, environment reason enums, and the maintenance flag. Arrays are bounded, suite-ordered, unique where applicable, and frozen. No raw evidence is copied.

## Precedence and validation

Input schema validation, duplicate/missing contour checks, definition matching, fallback declaration checks, and environment coherence checks occur before maintenance is returned. The effective order is:

1. Reject invalid or incoherent input.
2. Return `MAINTENANCE` for valid explicit operator maintenance.
3. Return coherent environment `UNKNOWN` when no trustworthy product assessment exists.
4. Apply product precedence `BROKEN > DEGRADED > DRIFT`.
5. Return `HEALTHY` with the appropriate healthy basis.

An uncertain C13 result is never counted as a product failure. A pre-identity environment result suppresses only absent/not-observed work that it legitimately explains. Present, independently established product contours remain visible.

## Deterministic matrix coverage

The focused Health tests cover L4-01 through L4-30:

- L4-01, L4-02, L4-03, L4-04, L4-05, L4-06, L4-07, and L4-08 cover primary health, permitted optional absence, approved fallback drift, material fallback degradation, non-core failure, core failure, product precedence, and maintenance.
- L4-09 through L4-14 cover controlled-browser, network-before-identity, login, verification, CAPTCHA, and account-blocked uncertainty.
- L4-15 through L4-17 cover independent composer, Send, and command-surface failures beside uncertainty.
- L4-18 and L4-19 cover contradictory post-identity/pre-identity and conflicting uncertainty observations.
- L4-20 and L4-21 cover the schema coupling between `environmentStatus` and `uncertaintyReason`.
- L4-22, L4-23, and L4-24 retain duplicate, missing, and undeclared fallback rejection.
- L4-25 retains the failing-fallback/approved-quality guard.
- L4-26 through L4-30 cover simple/detailed equivalence, stable ordering, bounded privacy output, byte-equivalent repetition, and no clock/random/network dependency.

The same shared classifier is exercised with synthetic `standard`, `work`, and `alice` scope identities. No target-specific classifier branch was added.

## Privacy, persistence, and live boundary

No database schema, migration, persistence column, product adapter, auth/bootstrap/session code, Stream-1 path, or provider call changed. Existing persistence remains final-state/current-results compatible. Detailed explanations remain in-memory for future incident generation.

No Chromium regression was run because no browser-side strategy or result-mapping code changed. The accepted H2/H3 browser authority was audited but left unchanged.

Unresolved source-authority limitation: this R1 can prove deterministic non-live classification and accepted runner-result semantics only. It cannot prove live provider availability or current provider DOM behavior. Deferred live ledger entries remain `S2-L2-CHATGPT-STANDARD-LIVE-001`, `S2-L2-CHATGPT-WORK-LIVE-001`, and `S2-L3-ALICE-LIVE-001`.

## Validation record

Focused Health tests: green (57 tests).

Health-runner tests: green (171 tests).

Node 24.21.0 and pnpm 10.34.5 were supplied through the local toolchain; no provider calls were made.

Final commit and tree are recorded in the terminal report after finalization.
