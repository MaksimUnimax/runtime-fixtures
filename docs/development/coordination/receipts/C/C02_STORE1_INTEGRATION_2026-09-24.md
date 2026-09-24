# C02 / STORE-1 integration receipt — 2026-09-24

Role: C
Evidence level: SOURCE + PACKAGE PREPARATION.
Installed browser / live deployment / store submission: NOT CLAIMED.

## Accepted baseline and exact intake

- accepted main baseline before this cycle: `7e3e781491d42e366d60d3b3976cdd5bf179f840`;
- A exact submitted candidate: `64aa249fdbc8fe27bc3c180be99c027e4cc2c92e` (supersedes `d12c8af...`);
- B exact submitted candidate: `da7e1238192b91bd4e331af525b00800da250db0`;
- A and B candidate path sets do not overlap and both merged cleanly on the accepted baseline; whole moving role branches were not merged.

A contributes the existing-builder explicit store mode, Octoport visible branding, owner-preapproved 16/48/128 PNG icons + SVG, deterministic Chromium/Firefox store package generation and package-contract checks.

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
- `tooling/b1/release-safety.test.mjs`: 32/32 PASS;
- `tests/regression/extension-core/store-package-contract.py`: PASS;
- supervised resource job `e38c0aab9c1647a68644118ccfe5047b`: exit 0, OOM 0, cleanup verified, peak 48 MiB.

Deterministic package bytes at this stage:
- Chromium `OCTOPORT_v0.2.4_CHROMIUM_STORE.zip`: SHA-256 `4d87e730c378d942fc2ca70872b51a0b5afbf427269619a1a92e26f5af276665`, 2,109,608 bytes;
- Firefox `OCTOPORT_v0.2.4_FIREFOX_STORE.zip`: SHA-256 `ef94a855e392a40b887434e887bb00d407c2b935b336ef0d7adfe3c9ee437f58`, 3,943,306 bytes.

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
