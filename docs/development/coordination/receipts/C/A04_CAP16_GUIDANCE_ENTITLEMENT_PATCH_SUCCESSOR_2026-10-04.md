# A04 CAP-16 guidance entitlement patch successor — 2026-10-04

## Scope

This successor fixes the reproduced CAP-16 Ozon guidance gap through the supported composed application-patch boundary. The frozen imported Ozon v0.1.22 source is not edited.

Exact candidate base: `e800013756d785d20c1d826c76e33659d1c4c766`. The implementation was first validated on `216799a730c5f327cc195b06ff789c56e82a3707`; the only intervening main change was a disjoint Firefox-140 evidence receipt, and the CAP-16 patch-id was preserved across the rebase.

The previous R1 attempt is retained as REWORK history because direct edits under `apps/extension/src/imported/ozon-v0.1.22` correctly failed `baseline.verify_import()`. Evidence: `/root/octoport-control/logs/C/a04-cap16-guidance-entitlement-r1-20261004/BLOCKED_IMPORTED_BASELINE.json`.

## Behavior

Guidance cards now expose a template-scoped `entitlement` object derived from the existing `OzonEntitlements.requirementFor` authority for the exact displayed guidance template:

- `REQUIRED_FOR_TEMPLATE` with authority-provided subscription types when the template is known to require a subscription.
- `NOT_REQUIRED_FOR_TEMPLATE` when the template is known not to require one.
- `UNKNOWN` when the entitlement rule is not established.
- `applies_to=GUIDANCE_TEMPLATE` and `runtime_preflight_authoritative=true` make the scope explicit.

Unknown extension-only aliases fail closed to `UNKNOWN`; no new entitlement rule is invented.

The change does not modify `OzonEntitlements`, subscription detection, runtime preflight, command templates, provider transport, privacy gates, or execution eligibility.

## Changed paths

- `apps/extension/application-patches.json`
- `tests/regression/extension-core/ozon-guidance-entitlement.mjs`
- `tooling/checks/extension_core.py`
- this receipt

Frozen imported runtime paths have zero Git diff.

## Verification

Pre-fix composed runtime reproduced the defect: the CAP-16 guidance card had no `entitlement` object. Evidence: `/root/octoport-control/logs/C/a04-cap16-guidance-entitlement-patch-successor-r1-20261004/RED_COMPOSED.log`.

Post-fix focused regression passes on both composed source runtime and extracted package. It verifies:

- `chat_history_v3`: `NOT_REQUIRED_FOR_TEMPLATE`;
- `review_list` and `review_count`: `UNKNOWN`, with no invented subscription;
- `question_list` and `question_count`: `REQUIRED_FOR_TEMPLATE` with `PREMIUM_PLUS`;
- existing CAP-16 personal-data flags;
- zero external/business provider requests.

Evidence:
- `FOCUSED_FINAL_SOURCE.log`
- `FOCUSED_FINAL_PACKAGE.log`
- `BASELINE_FINAL.json`

Full existing supervised `extension_core` validation passed for source and extracted package: 149 gate processes, exit 0, peak 178 MiB, OOM 0, cleanup verified, `live_provider_calls=0`. Resource job: `/root/octoport-control/resource-jobs/e760dc0206574422be37289bac5af186/receipt.json`. Compact result: `/root/octoport-control/logs/C/a04-cap16-guidance-entitlement-patch-successor-r1-20261004/EXTENSION_CORE_SUMMARY.json`.

## Evidence boundary

Evidence level is SOURCE / LOCAL COMPOSED PACKAGE regression only. This result does not claim provider execution, ordinary authentication, LIVE_OWNER acceptance, store submission, deployment, production readiness, or closure of unrelated CAP-18/CAP-21 guidance gaps.

Publication requires independent gpt-6-luna review, fresh-main compatibility, five exact-head CI workflows, ready-main, non-force publication and readback.
