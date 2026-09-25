# C02 Firefox privacy-neutral shared wire slice 1

Date: 2026-09-25
Role: C
Status: **SOURCE PASS / NOT DEPLOYABLE YET**

Authority:
- `docs/development/coordination/FIREFOX_PRIVACY_NEUTRAL_CONTRACT_2026-09-25.md`
- accepted main before this slice: `7945d62854e135421c3db003c603187b9f37866b`
- B slice-1 source: `7fc52da28791f191b7b03694bc79179d6e561597`

## Scope

This slice integrates the bounded B device-metadata persistence seam and adds the C-owned shared/public wire needed to consume it. It does not claim signed privacy-neutral bootstrap authority, Firefox client activation, actual-browser acceptance, live migration, deployment, or store submission.

B history was not merged. The exact 18-file tree delta from `7fc52da...` was applied content-only; all 18 local blob IDs were verified equal to the submitted candidate before commit.
## Public contract and HTTP behavior

- `POST /v1/device-authorizations` accepts either:
  - legacy/PRESENT client software metadata: browser family + extension version, optional browser version; or
  - WITHHELD metadata: all three software fields omitted.
- Partial software metadata is rejected fail-closed.
- Portal authorization preview and device list expose authoritative `clientMetadata`:
  - `{ state: "WITHHELD" }`; legacy software fields omitted.
  - `{ state: "PRESENT", ... }`; legacy software fields preserved and required to match the authoritative metadata during the compatibility period.
- `POST /v1/devices/current/client-metadata/forget`:
  - accepts no body;
  - authenticates only through the existing extension bearer path;
  - derives account/session/device solely from the bearer principal;
  - calls the B service's active-session/device/account-scoped clear operation;
  - returns `{status:"cleared",deviceId}` on success;
  - maps post-auth authority/revocation mismatch to 403 `DEVICE_MISMATCH`;
  - preserves no-store/no-cache semantics.
- OpenAPI was regenerated from the implemented route/schema surface.
## C verification

Node 24.20.0 / pnpm 10.34.5.

B slice-1 C revalidation:
- device-auth unit: 10/10 PASS.
- device-management unit: 5/5 PASS.
- device-auth/device-management/db/api typechecks: PASS after C integration.
- `openapi:check`: PASS after C integration.
- disposable PostgreSQL p2-3 + p2-5: 18/18 PASS.
- disposable PostgreSQL postgres/canonical-lineage/adapter-registry: 16/16 PASS.
- resource jobs completed without OOM and cleanup was verified.

C shared-wire focused regression:
- contracts browser/privacy start cases plus API authorization/device/portal/OpenAPI and portal metadata formatter: 30/30 PASS.
- full portal suite: 41/41 PASS.
- contracts typecheck: PASS.
- API typecheck: PASS.
- portal typecheck: PASS.
- tracked OpenAPI check: PASS.
- generated OpenAPI has explicit PRESENT/WITHHELD branches for start, preview and device list; partial metadata is not documented as valid.
- partial metadata, non-empty forget body, missing bearer and post-auth authority mismatch have explicit negative coverage.

Independent Luna read-only review:
- task: `c02-firefox-wire-review-r1`, exit 0.
- confirmed no separate auth/replay/session-clearing defect in the reviewed path.
- found an OpenAPI documentation defect caused by runtime-only refinements; corrected by structural union schemas plus OpenAPI regression.
- found portal PRESENT-only rendering; corrected through one shared formatter. WITHHELD renders as `Not shared`, with unit coverage.
- the then-open B admin projection blocker was independently confirmed.

Post-main verification of base `7945d628...`: all five required workflows PASS:
Server CI, Extension CI, Extension I1-C1 client, Documentation CI, Coordination and release safety.
## Follow-up status

The B-owned admin projection issue identified by this Slice1 receipt was closed later by bounded candidate `892596c58f47c4a7e7faea5967d3f9fbb1cb57fc` and C integration. The repository now preserves authoritative PRESENT/WITHHELD metadata and fails closed on partial tuples instead of fabricating `String(NULL)`.

This historical Slice1 receipt remains **NOT DEPLOYABLE BY ITSELF**. The combined signed-wire acceptance is recorded separately in `C02_FIREFOX_PRIVACY_NEUTRAL_SIGNED_WIRE_FINAL_2026-09-25.md`.

Remaining release gates after the combined source work are:
- exact-head five-workflow CI on the final C candidate;
- fresh C05 immutable-artifact rehearsal on the final Firefox server candidate;
- separate live migration/deploy authorization;
- backend/reviewer/store evidence at the appropriate acceptance level.

No live DB, production service, marketplace payload, owner secret, payment, or store dashboard was mutated by this slice.
