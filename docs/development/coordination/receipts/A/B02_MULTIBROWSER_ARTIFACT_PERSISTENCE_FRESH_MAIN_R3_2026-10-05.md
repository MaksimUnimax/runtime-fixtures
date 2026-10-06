# B02 multibrowser artifact persistence — fresh-main R3

Status: **SOURCE CANDIDATE / FOCUSED VERIFICATION PASS / INDEPENDENT REVIEW PENDING**
Task: `B02-MULTIBROWSER-ARTIFACT-PERSISTENCE-FRESH-MAIN-R3-20261005`

This receipt records the fresh-main reconstruction and focused verification of the
reviewed multibrowser extension-release artifact persistence boundary. It does
not claim main publication, live catalog mutation, installed acceptance,
ordinary authentication, LIVE_OWNER, deployment, or production acceptance.

## Exact source lineage

- Fresh base: `d7f26119d4e1e73d6f45ea6127951583a1ae28e0`.
- Accepted predecessor: `730932a2128bd1844884f64382ce27e357b9a0d4`.
- Reconstructed R3 source: `c2825db5b36457a877c5edb47fb515c11975dd00`.
- R3 tree: `23c3fdcf9b9653be7dfe75fa927baaad35a07757`.
- R3 parent: exact fresh base `d7f26119…`.
- Recovery patch SHA-256:
  `e9dc309a1a335e2219d83fe125e187075269bd40141c7e79d013ec187e7323f0`.

Fresh-to-R3 changes stay inside the claimed B02 boundary. Fourteen changed paths
reuse the reviewed predecessor bytes. The one semantic merge is
`packages/server/compatibility/src/index.ts`: R3 preserves the reviewed
browser-artifact schema/refinement logic and also preserves the fresh-main
`beta-opera-policy-canonical-inputs` export.

Machine evidence:
`/root/octoport-control/logs/A/b02-multibrowser-artifact-persistence-fresh-main-r3-20261005/SOURCE_RECONCILIATION_C282_R1.json`.

## Product boundary

The source adds an explicit browser-specific artifact integrity representation
for one immutable extension release without changing ordinary bootstrap wire
shape or authorizing live publication.

The verified boundary is:

- release commands may carry an exact `browserArtifacts` mapping;
- duplicate supported browser identities fail closed;
- duplicate artifact browser identities fail closed;
- the artifact browser set must equal the supported browser set;
- release-level `artifactSha256` and `browserArtifacts` cannot be mixed;
- ADMIN publication requires exactly one integrity mode;
- SYSTEM/internal historical compatibility can remain unbound where the
  existing contract already permits it;
- browser release rows persist only their matching browser digest;
- transition classification rejects unavailable, duplicate-set, mixed,
  invalid-digest, unbound, and partial browser-artifact state;
- the multibrowser successor preflight remains read-only and binds the exact
  canonical Chromium/Firefox artifact identities to their browser/profile
  targets.

Migration `0058_extension_release_browser_artifacts` is additive. It adds the
nullable browser artifact digest and its validation constraint; it contains no
data backfill `UPDATE` and no trigger removal.

## Fresh focused verification

Node: `v24.20.0`.
pnpm: `10.34.5`.
Network install: **not performed**.

A task-local dependency-link view reused the existing frozen dependency bytes.
Workspace `@product/*` links resolved into this exact R3 worktree; external npm
dependencies resolved into the already-existing pnpm virtual store. No package
installation or network access occurred.

Results:

- `@product/compatibility` tests: **18/18 PASS**;
- release-transition + multibrowser-successor preflight suites:
  **28/28 PASS**;
- compatibility TypeScript check: **PASS**;
- DB TypeScript check: **PASS**;
- Prettier on all 14 changed TypeScript/JSON paths: **PASS**;
- `git diff --check`: **PASS**;
- migration static invariants: **PASS**.

The first combined DB typecheck attempt exposed only an incomplete task-local
dependency-link view for transitive app consumers. After adding the existing
read-only app/tooling dependency links, the isolated DB typecheck passed. No
product source was changed to obtain that pass.

The saved execution plan expected migration journal index 45. Fresh main already
contains `0057_admin_maintenance_access` at index 45, while both the accepted
predecessor and this R3 source contain `0058` at index 46. The stale plan
number was corrected as evidence only; source was not changed.

Canonical focused summary:
`/root/octoport-control/logs/A/b02-multibrowser-artifact-persistence-fresh-main-r3-20261005/FOCUSED_ACCEPTANCE_R2.json`
SHA-256:
`42c09147c851b58e0d9a995ef32d2f790b9c203d6ef90ce7eb957104315edb9c`.

## PostgreSQL evidence reuse

The previously supervised disposable PostgreSQL job
`e41f15fbcff84b6bbca7f460a383c1f4` remains reusable for pre-review
reconciliation because every bound DB/repository/integration blob is
byte-identical between the accepted predecessor and R3.

Preserved results:

- P3.3 publication integration: **5/5 PASS**;
- P3.4 bootstrap integration: **21/21 PASS**;
- release-transition integration: **4/4 PASS**;
- cleanup verified, OOM kill count 0.

This reuse does not replace exact-candidate Server CI. A fresh Server CI run
remains mandatory before main publication.

Evidence:
`/root/octoport-control/logs/A/b02-multibrowser-artifact-persistence-fresh-main-r3-20261005/POSTGRES_EVIDENCE_REUSE_PREFLIGHT_R1.json`.

## Resource/lifecycle recovery

The earlier R3 worktree became unregistered during a coordination race and was
then held by two process-lifetime read-only Desktop Commander descriptors. The
WIP was preserved as an exact commit/ref and binary patch before cleanup.

A bounded one-shot Remote Device restart removed the old server process and
descriptors. Desktop Commander automatically respawned the same persisted
device; the maintenance helper correctly refused to start a duplicate process.
The clean unregistered worktree was then removed normally, without
`--force`, and the disk guard returned to an empty unmanaged-root set.

After stale allocation reconciliation, fresh allocation
`9646309b1aca4daf8da424d58712ddcb` registered the reconstructed R3
worktree. The reconstructed HEAD/tree/parent match the preserved source exactly.

No reset, forced worktree removal, registry edit, baseline reseed, alternate
publication channel, package rebuild, DB mutation, or live catalog mutation was
used.

## Remaining mandatory gates

Before this source can reach main:

1. remove the task-local dependency/temp view and require a clean exact
   candidate;
2. obtain one fresh independent `gpt-6-luna` read-only review of the exact
   candidate, receipt, and evidence;
3. refresh `origin/main` and repeat the same-path drift guard;
4. use a **new** governed task-publication registration; do not reuse or mutate
   the old blocked predecessor registration;
5. require all five mandatory CI workflows to succeed for the exact candidate;
6. perform non-force main publication and readback;
7. delete the temporary task ref, close publication/disk lifecycle, and perform
   strict work-board completion.

## Explicit non-claims

- Independent R3 review: **PENDING**.
- Exact-candidate five-CI acceptance: **PENDING**.
- Main publication: **NOT PERFORMED**.
- Live compatibility/catalog mutation: **NOT PERFORMED**.
- Browser/package installed acceptance: **NOT CLAIMED**.
- Ordinary auth / LIVE_OWNER useful flow: **NOT CLAIMED**.
- Deployment / production: **NOT CLAIMED**.
