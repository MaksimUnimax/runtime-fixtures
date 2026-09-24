# A03 store/release package mode — 2026-09-24

Role: A
Task: A03 / early STORE-1 package preparation
Evidence: SOURCE + PACKAGE PREVIEW
Installed/store/live acceptance: NOT CLAIMED

## Scope

This change adds one explicit store/release mode to the existing common extension builder; it does not create a second release architecture.
Development mode remains the default and keeps LOCAL DEVELOPMENT loopback behavior.
Store mode requires an external release-authority JSON, accepts only the PREPRODUCTION store-review lane, rejects non-HTTPS origins, requires control_plane_v2 and validates the public Ed25519 trust-bundle shape/fingerprints.
Duplicate trust key IDs and duplicate fingerprints are rejected before packaging.
The frozen imported Ozon donor remains unchanged.

The accepted integration base fa5687b32363ad55c52ca1d84aef8cd7569aa931 is an ancestor of the A working line.
Before this change A HEAD was 451d1f7dee5573c9040b1a361734e0d4d7c798fa.
The exact candidate commit is the commit containing this receipt; release authority is regenerated only after that commit so C01 can bind exact HEAD/tree.

## Store identity and icon

Owner preapproved a replaceable minimalist octopus icon in OWNER_ICON_APPROVAL_20260924.json.
The package contains transparent Octoport PNG icons at 16, 48 and 128 px and declares them in manifest.icons/action.default_icon.
Store package name/title are Octoport; development package branding remains Seller Agents Development.
Store-mode also changes only the visible popup/transfer/backup/delivery product label from Seller Agents to Octoport, with exact occurrence guards; internal protocol keys and backup format identifiers are unchanged.
Firefox store derivative uses stable extension id octoport@octoport.ru; development keeps seller-agents@example.test.

## Public endpoints and trust input

Fresh server probes returned HTTP 200 for:
- https://api.octoport.ru/health/ready
- https://app.octoport.ru/

Read-only current catalog evidence for control_plane_v2:
- signing key: octoport-preprod-2026-09-19
- lifecycle: REGISTERED -> ACTIVATED
- fingerprint SHA-256: edc47821df296868c7061069ed50fa742f70a75889bd010dadef5166fadc4645
- public SPKI only was used; no private signing material or credential was read or packaged.

Store package config uses PREPRODUCTION, https://api.octoport.ru, https://app.octoport.ru, control_plane_v2 and that public trust bundle.
No production mutation or DB mutation was performed.

## Verification before commit

Targeted store contract: PASS, including negative rejection for HTTP origins, PRODUCTION authority in this PREPRODUCTION lane, duplicate trust key IDs and duplicate trust fingerprints.
A bounded read-only Luna review found no current-candidate integration blocker after this hardening. Its remaining low cross-owner observation is that the shared C01 validator does not independently assert the Firefox stable add-on ID; A's Firefox builder/contract does assert octoport@octoport.ru, and C/controller should add the C01 identity assertion before relying on that shared gate for Firefox submission.
Development builder regression: PASS and deterministic.
Full extension_core via A heavy/build: PASS, 119 gate processes, Node v24.20.0; installed_acceptance=false and live_provider_calls=0.
Heavy-runner cgroup terminated; no A test unit remained.
git diff --check: PASS.

Pre-commit deterministic package preview:
- Chromium OCTOPORT_v0.2.4_CHROMIUM_STORE.zip: 2,109,608 bytes; SHA-256 4d87e730c378d942fc2ca70872b51a0b5afbf427269619a1a92e26f5af276665
- Firefox OCTOPORT_v0.2.4_FIREFOX_STORE.zip: 3,943,306 bytes; SHA-256 ef94a855e392a40b887434e887bb00d407c2b935b336ef0d7adfe3c9ee437f58

These hashes are package identities, not installed/store acceptance. Exact committed-head C01 validation is recorded out-of-tree under /root/octoport-control/logs/A/store-release-final/ after the final source commit, because embedding that final HEAD/tree back into this tracked receipt would itself create a new source identity. A state/inbox names the exact submitted candidate.

## Remaining gates

- C must repeat/rebind package authority to the resulting integrated C SHA before release use; A's C01 PASS does not transfer across a different source tree.
- Ordinary installed Opera authentication/import/use evidence is still required; fixture/load-unpacked evidence is not ordinary store installation.
- Supported owner marketplace backups remain private intake only; no tokens are copied to Git/logs/backend.
- Normal backend config-release/link/assignment operator path is B-owned and remains a separate gate.
- Public privacy/support/install and store listing/reviewer route are C/site/deploy work.
- No package has been submitted to a browser store by this receipt.
- Safari remains outside beta.
