# C STORE 0.2.11 source/package binding — 2026-09-30

Status: **SOURCE + PACKAGE BINDING ACCEPTED / NOT INSTALLED / NOT LIVE / NOT SUBMITTED**

## Exact immutable release candidate

- Product version: `0.2.11`
- Contract: `control_plane_v2`
- Migration level: `55`
- Package source HEAD: `7353c996fb72b62196d57ef2dbcd5c8339057dba`
- Package source tree: `a1f5b3616dba28473ce7275e5994af89001a4532`
- Chromium/Opera ZIP SHA-256: `66c8b34e533f0e716cc3b7d214127a8443e89a241682d2307487c96a373f07c9`
- Firefox ZIP SHA-256: `f53340ccedec844041d57c0b3e37de0bd8acf234aacd4852ee2b5fe0c72926ca`
- Release authority SHA-256: `50d62b8b697b2abcd20d42d18a97ce15c0f20fbcc7ba516e57ac639dd9824f24`
- Candidate manifest: `/root/octoport-control/logs/C/store-release-0211-7353c996/candidate/B1_RC_MANIFEST.json`

Both candidate ZIPs are byte-identical to their deterministic build outputs. Chromium static audit: exact SHA match, 43 entries, no duplicate or unsafe paths, no missing declared resources, no external HTTP refs. Static reachability: 43/43 entries reached. B1 preflight: `PASS`, `productionMutation=NOT_PERFORMED`, `externalAcceptance=NOT_CLAIMED`.

## Delta from frozen 0.2.10

Chromium package has 43 common entries: 32 byte-identical and 11 changed. Eight changes are version-only. Functional package changes are limited to:

- `popup.css` — accepted native popup width correction;
- `popup.js` — accepted Start pending/failure feedback;
- `shared/application.js` — accepted tab-scoped bounded Start diagnostic/support state.

No package files were added or removed.

## STORE-1 transition boundary

`STORE1_VERSION` advances to `0.2.11` and exact source/tree/artifact authority is rebound to this immutable candidate.

`STORE1_PREVIOUS_VERSION` intentionally remains `0.2.9`: this constant represents the accepted **live catalog predecessor**, not merely the immediately preceding frozen ZIP. 0.2.10 was never activated in the owner-test catalog and current live readback remains 0.2.9. Requiring 0.2.10 as predecessor would create the explicitly avoided intermediate catalog churn.

The existing profile authority remains unchanged: Opera minimum browser `136`, profile minimum extension `0.2.7`, profile content SHA unchanged.

## Verification

- `git rev-parse 7353c996...^{tree}` = `a1f5b361...`
- Re-hashed candidate Chromium and Firefox ZIPs match the manifest/receipts.
- Production `readStore1PackageAuthority()` accepts the actual candidate manifest + Chromium ZIP and returns the exact source/tree/version/hash above.
- Focused source suite: `71/71 PASS` across:
  - `store1-opera-admin-activation.test.ts`
  - `store1-v2-signature-preflight.test.ts`
  - `store1-preflight-cli.test.ts`
  - `store-release-transition-preflight.test.ts`
- Focused supervisor: `octoport-test-c-3fe7f643664d40429d84a2431f09f420.service`, exit 0, peak 495 MiB, cleanup verified.

## Explicit limits

No live catalog POST, fresh device issuance, DB mutation, C07 retry, store upload/Submit, owner/live ChatGPT acceptance, or installed 0.2.11 acceptance is claimed by this receipt. Frozen 0.2.9 and 0.2.10 package bytes remain unchanged.
