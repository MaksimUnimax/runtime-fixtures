# C04 no-session URL privacy repair — B handoff — 2026-09-24

Status: SOURCE + DISPOSABLE POSTGRESQL CANDIDATE. No live DB mutation, migration activation, production deployment, browser execution, or LIVE_OWNER acceptance is claimed.

## Trigger

Controller notice `ACTIVE-STREAM-AUDIT-20260924-0944` confirmed that the C04 persistence boundary could durably store and fingerprint raw navigation URLs from an otherwise valid no-session observation.

C handoff:
`/root/octoport-control/logs/C/B_C04_NO_SESSION_URL_PRIVACY_REPAIR_2026-09-24.md`

## Repair boundary

B-owned source/test paths only:
- `packages/server/db/src/health-no-session-persistence-repository.ts`
- `packages/server/db/src/health-no-session-persistence.integration.test.ts`

No C-owned shared schema/runtime file was changed. Migration `0049_s2_l5_no_session_persistence.sql` was not edited.

After the existing shared `NoSessionObservationResultSchema` parse, the B repository derives a persistence-only sanitized observation. These fields are reduced with the platform URL parser to canonical HTTP(S) `URL.origin`:
- `navigationEvidence.requestedStartUrl`
- `navigationEvidence.finalUrl`
- `navigationEvidence.finalOrigin`
- top-level `finalOrigin`

Non-HTTP(S) origins fail closed with the stable code `NO_SESSION_URL_ORIGIN_INVALID`.

Every non-null final URL/origin identity must canonicalize to the same origin. A mismatch fails closed with `NO_SESSION_FINAL_ORIGIN_MISMATCH`. The requested start origin is intentionally not required to equal the final origin, preserving legitimate redirects.

`resultSha256` is computed from the sanitized observation shape and the repository writes that same sanitized shape. Raw userinfo/path/query/fragment data therefore does not enter the durable observation JSON or the persistence fingerprint. Existing classification, provider/surface, schedule, authority, timestamp and evidence-reference semantics remain unchanged.

Equivalent observations that differ only in userinfo/path/query/fragment content — including host-case/default-port spelling differences — replay against the same safe persistence fingerprint.

## Focused privacy coverage

Disposable PostgreSQL acceptance proves:
- synthetic userinfo/path/query/fragment values are absent from persisted observation JSON;
- requested/final URL identities persist as origin-only values;
- final-origin disagreement is rejected;
- non-HTTP navigation origin is rejected;
- equivalent secret-bearing URLs on the same canonical origin replay the same health run and stored result hash;
- URL host case and explicit default HTTPS port canonicalize to the same origin;
- evidence-reference identity/hash/size fields remain unchanged;
- existing provider/surface/authority/timestamp/incident/admin behavior remains intact.

Migration 0049 inspection:
- `health_no_session_observations` backfill INSERT count: 0;
- observation JSON DEFAULT count: 0.

## Verification

Toolchain: Node 24.20.0, pnpm 10.34.5.

Static final:
- focused Prettier: PASS / unchanged;
- focused ESLint: PASS;
- `git diff --check`: PASS;
- changed paths are B-owned DB repository/test/receipt only; no shared/C-owned runtime path touched.

Typecheck:
- first attempt under the too-small `focused` resource profile is NOT acceptance evidence: V8 heap OOM, exit 134, resource job `0e0193aeea644a679f6384e356829200`;
- final `pnpm --filter @product/db typecheck` under documented `build` profile: PASS, exit 0, OOM 0, resource job `9f6ee9ca004445d68124a1ef38ddd180`, peak 806354944 bytes.

Disposable PostgreSQL:
- final C04 no-session persistence acceptance: 2/2 PASS, resource job `49c589d0789c46a0a61de73ef26ab063`, OOM 0;
- health incidents regression: 7/7 PASS;
- health admin-read regression: 2/2 PASS;
- PostgreSQL migration smoke: 3/3 PASS;
- those three sequential regressions ran in resource job `c51ab0f7ae114534b2246ea8989192f0`, exit 0, OOM 0, peak about 547 MiB.

Independent bounded review:
- B Luna read-only task `c04-url-privacy-review-r1`;
- exit 0;
- conclusion PASS;
- one low-severity coverage suggestion for canonical host/default-port spelling was addressed in the parent test before final C04 acceptance;
- result: `/root/octoport-control/logs/B/c04-url-privacy-review-r1-result.md`.

## Constraints / next boundary

This candidate repairs persistence privacy only. It does not:
- change the C-owned shared observation/evidence schema;
- activate migration 0049 on any live database;
- change monitoring/browser behavior;
- implement N2 read/snapshot wire support;
- perform S2/0050 consolidation;
- duplicate the controller-owned standalone portal fix.

C must integrate and validate the exact submitted B repair SHA before any claim of integrated acceptance.
