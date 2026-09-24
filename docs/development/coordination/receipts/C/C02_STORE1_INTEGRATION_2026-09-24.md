# C02 / STORE-1 integration receipt — 2026-09-24

Role: C
Evidence level: SOURCE + PACKAGE PREPARATION.
Installed browser / live deployment / store submission: NOT CLAIMED.

## Accepted baseline and exact intake

- accepted main baseline before this cycle: `7e3e781491d42e366d60d3b3976cdd5bf179f840`;
- A final exact submitted candidate: `144551fdb8d9d67b2988162592b27716b9c2e42d` (supersedes all earlier A03 store submissions, including `04d6fe6...`, `64aa249...` and `d12c8af...`);
- B exact submitted candidate: `da7e1238192b91bd4e331af525b00800da250db0`;
- A and B candidate path sets do not overlap and both merged cleanly on the accepted baseline; whole moving role branches were not merged.

A contributes the existing-builder explicit store mode, Octoport visible branding, owner-preapproved 16/48/128 PNG icons + SVG, deterministic Chromium/Firefox store package generation and package-contract checks. Its superseding hardening restricts this store-review lane to PREPRODUCTION authority, rejects duplicate trust key IDs/fingerprints, removes LOCAL DEVELOPMENT/loopback fallback from the packaged worker, and removes development-only popup labels before packaging.

B contributes the normal authenticated ADMIN HTTP config-release linking path, preserving the existing extension-release, compatibility-policy and P7 assignment paths. The new route is `POST /v1/admin/compatibility/config-releases/publish`, protected by the existing admin mutation/session/CSRF guard and transaction-time `compatibility.manage` authorization. It uses expected-latest CAS, preserves existing signing/feature/rollout links, requires a new compatibility policy link, and writes ADMIN audit attribution/reason/correlation.

## C-owned shared OpenAPI

B intentionally did not edit the C-owned tracked OpenAPI artifact. After exact A+B intake C regenerated it from the integrated source using Node 24.20.0 / pnpm 10.34.5.

- tracked artifact: `packages/contracts/openapi/openapi.json`;
- generated SHA-256: `0580dd1c31edd7f4624207a80c29a0bb929d7f2b8e710bbecfcb9d40487d9347`;
- byte-for-byte match with B handoff generated representation: PASS;
- `pnpm openapi:check`: PASS;
- `git diff --check`: PASS;
- artifact delta adds only the generated representation of the new config-release publish endpoint/schema.

## C01 package/release gate

The C01 release validator remains fail closed. External release authority binds exact Git HEAD/tree, product 0.2.4, `control_plane_v2`, migration level 48, PREPRODUCTION HTTPS origins and the accepted public Ed25519 trust bundle. Candidate manifest binds the exact authority bytes and package hashes.

Focused integrated-tree verification before this receipt commit:
- positive `release-preflight`: PASS on the then-current integrated source;
- stale A authority against the integrated source: expected FAIL `Authority source identity is stale`;
- C01 independently accepts only PREPRODUCTION release authority; PRODUCTION fails closed;
- C01 independently asserts the stable Firefox add-on ID `octoport@octoport.ru`; a different ID fails closed before release preparation;
- C01 rejects known development-only/loopback fallback markers in the reachable classic background runtime and in the declared popup plus its direct local `src`/`href` resources. Chromium module service workers are fail-closed until a dedicated ESM dependency validator exists. Classic background dependency traversal accepts only canonical static `importScripts(...);`; whitespace/no-semicolon/comment-obfuscated variants fail closed rather than escaping traversal; Unicode-escaped spellings that evaluate to `importScripts` and bracket-notation access through `globalThis` with the `importScripts` property is also rejected fail-closed;
- `tooling/b1/release-safety.test.mjs`: 42/42 PASS, including negative PREPRODUCTION, module-worker, canonical-import syntax, Unicode-escape, bracket-notation, background sanitation, popup-resource sanitation and Firefox stable-ID cases;
- `tests/regression/extension-core/store-package-contract.py`: PASS, including PREPRODUCTION-only, duplicate-trust and store sanitation checks;
- `pnpm openapi:check`: PASS; focused Prettier check: PASS;
- supervised resource job `1502921352c248678d0dd3563b2f4003`: exit 0, OOM 0, cleanup verified, peak 342 MiB;
- final read-only Luna R6 review on exact code diff SHA-256 `13df80e5bc111dc78cd52a06ce64a5f0c1997c6eb608f3d770e65a77d0a66210`: no blocker remains; the review specifically confirmed the Unicode-escaped identifier and bracket-notation fixtures exercise the stated bypasses and are rejected by package preparation.

Deterministic package bytes at this stage:
- Chromium `OCTOPORT_v0.2.4_CHROMIUM_STORE.zip`: SHA-256 `7f631db34ac7c7966b6e7cf1b8ea84864e6e5cafff3494827dc181fdc86478ef`, 2,108,729 bytes;
- Firefox `OCTOPORT_v0.2.4_FIREFOX_STORE.zip`: SHA-256 `ccdd95cee7c1b6e35369095b8ebd751a9c9572b686aed48ea917850b7f13363b`, 3,941,573 bytes.

This tracked receipt itself changes Git source identity. Therefore the pre-receipt authority is NOT the final release authority. Immediately after committing this receipt, C must regenerate the external authority for the final containing commit/tree and rerun prepare/preflight. The final authority/candidate evidence lives outside Git under `/root/octoport-control/logs/C/store-release-store1-final/` so recording it does not recursively change the source identity.

## Public/store readiness boundary

- `support@octoport.ru` is configured without publishing the owner personal destination. Live Exim route passes; external-client RCPT simulation returns 250 for support and 550 for an unknown localpart, so no catch-all is opened. End-to-end delivery from an arbitrary Internet sender remains a separate proof if a store requires it.
- `/privacy`, `/support`, `/install` source is accepted in main, but those URLs remain not-live until a separately authorized site deployment and live 200 verification.
- Opera is the nearest first submission; listing/reviewer draft exists out of tree. Real publisher dashboard fields/access remain UNKNOWN until checked in the actual account.
- ordinary Opera store-installed auth/import/read-only-use acceptance on the final exact package remains open;
- reviewer flow must use normal auth/config/assignment paths and dedicated safe test data; no owner marketplace credentials, SQL bypass or reviewer-only functional substitution;
- no live DB mutation, production deploy, beta opening or browser-store Submit was performed by this receipt;
- Safari remains outside beta.

Owner action now: NONE. Ask only for a concrete OTP/login/dashboard action after the exact installed/reviewer step that needs it is staged.
