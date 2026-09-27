# A03 / STORE-1 — useful reviewer scenario preparation — 2026-09-27

Status: **EXACT STORE LOGGED-OUT PACKAGE PASS + REAL OPERA SYNTHETIC USEFUL SCENARIO PASS / PRE-SUBMISSION PORTAL AUTH + REAL REVIEWER E2E OPEN / POST-PUBLICATION STORE INSTALL OPEN**

Role: A
Current A HEAD before this receipt: `d1bf6af5249e43ddf2fe74cdbfb1bf700b7bb363`
Observed accepted main for this boundary: `6a0149c958423082a62d5cb84ac757eed2e785a2`

## Purpose

Prepare the A-owned part of the narrow STORE-1 reviewer path without bypassing store trust, authentication, catalog activation or live provider boundaries.

The intended first reviewer scenario is deliberately small:

1. ordinary Octoport login;
2. add one dedicated reviewer Wildberries store with a reviewer/test Personal token through the normal popup;
3. open one supported ChatGPT dialogue;
4. choose that WB store and press Start;
5. execute one bounded read-only seller-information request;
6. receive the result in the dialogue;
7. press explicit Finish.

This proves the basic user promise “AI dialogue ↔ selected store ↔ read-only provider result” without claiming editing, price/card/ad mutation, broad business coverage or owner data.

## Exact STORE package remains authoritative and unchanged

Authoritative repaired STORE runtime source:
`e7d66152bdb77918b65115486c9829ef7a634e69`

Authoritative Opera/Chromium STORE ZIP:
`/root/octoport-control/logs/C/store-release-e7d66152/candidate/OCTOPORT_v0.2.4_CHROMIUM_STORE.zip`

Observed SHA-256:
`0c1fb4c9c81c600332dfb6dc2dcfb9c3221dafe9940eab3811112a4e9fc5d71c`

Observed size:
`2174363` bytes.

A compared the current working line to `e7d66152...` across package-input paths:

- `apps/extension/**`
- `packages/bridge-core/**`
- `packages/ai-adapters/**`
- `packages/browser-platform/**`
- `packages/control-client/**`
- `packages/marketplaces/**`
- `tooling/build/extension_composed.py`
- `tooling/build/extension_firefox.py`

Result: **no package-input diff** through A HEAD `d1bf6af...`.

Therefore A did not rebuild or silently replace the STORE candidate merely because later A commits added tests, field-schema fixtures and receipts.

Existing exact-package Opera evidence remains:
`/root/octoport-control/logs/C/opera-submission-images-e7d66152/summary.json`

It proves the exact STORE ZIP renders the signed-out Octoport popup in real Opera with no page errors or external requests before login. It remains `INSTALLED_SYNTHETIC_EXACT_PACKAGE_UI`, not catalog installation or authenticated reviewer acceptance.

## Why the useful scenario uses a separate fixture-trust package

The exact STORE package pins the accepted public PREPRODUCTION Ed25519 trust key. A synthetic signed bootstrap cannot be produced for that immutable package without the corresponding protected signing key.

A deliberately did **not**:
- replace the STORE trust bundle;
- monkey-patch bootstrap verification;
- inject an alternate fixture key into the STORE archive;
- use SQL/auth bypass;
- use owner/reviewer credentials;
- call live marketplace or AI services.

Doing any of those would make the result misleading as evidence for the exact STORE package.

Instead A built a LOCAL DEVELOPMENT fixture-trust derivative from the **same current package-input source bytes** and exercised the complete useful local lifecycle in real Opera. This is runtime-equivalent synthetic evidence only; the STORE trust/config bytes remain separate and immutable.

## Real Opera synthetic useful-scenario rehearsal

Evidence directory:
`/root/octoport-control/logs/A/STORE1_USEFUL_REHEARSAL_D1BF6AF_R1`

Persistent machine-readable summary:
`summary.json`

Summary SHA-256:
`bb110b3046437939baa315f77f710a6b6599d2e68dc3bc7562723f85b323773b`

Browser executable:
`/usr/bin/opera`

Opera product version reported by the binary:
`136.0.6008.22`

Playwright browser-engine version reported by the context:
`152.0.7977.120`

Fixture-trust local package SHA-256:
`e31a146592b927f2cdf8aa927ef1e2d1f984d6d1bba27c1dff3610636e97d90e`

Source runtime result SHA-256:
`bf2897b7e7ece645ab890bf50eefe8aa05d0c4cc27cbc54e3f57016c55e366a5`

Extracted runtime result SHA-256:
`bf2897b7e7ece645ab890bf50eefe8aa05d0c4cc27cbc54e3f57016c55e366a5`

Both source and ZIP-extracted runtimes: **PASS**.

The existing production application harness exercised:
- popup create/edit;
- real Work prompt and binding;
- one WB `seller_info` provider dispatch through a synthetic provider transport;
- result delivery back to the synthetic ChatGPT page;
- no replay of the same completed command;
- Show/Hide;
- native binary File/IndexedDB/port delivery path;
- explicit Finish;
- 320/380 px popup and enlarged typography.

`live_provider_calls=0`.
`installed_acceptance=false`.

The temporary Ed25519 fixture private key existed only in the supervised temporary directory and was removed by the run cleanup. No private DER remains in the persistent evidence directory.

Supervisor:
`octoport-test-a-3a247d1dea51441c8a7697f33cba1214.service`

Final state:
- `Result=success`
- `ExecMainStatus=0`
- `ActiveState=inactive`
- `SubState=dead`

## Reviewer instructions: pre-submission proof and later catalogue installation

These steps are for C/reviewer once the current B/C prerequisites are genuinely populated. They do not authorize a live mutation by A.

Before the first Submit, a published Opera Add-ons item may not exist. Use the legitimate pre-submission developer/review installation route for the exact STORE archive, preserving its bytes, trust bundle and normal authentication. This is pre-submission evidence, not catalogue-install evidence. Do not require publication before submission. After approval/distribution, separately prove ordinary Add-ons installation with Developer Mode off and the same-item N-to-N+1 update under STORE-3.

1. Verify the candidate is the exact Opera STORE package for version `0.2.4`, with expected package digest `0c1fb4c9...`. Record a store item ID only if the publisher workflow has actually assigned one.
2. For pre-submission verification, install the exact extracted candidate through the browser's legitimate developer/review route. Record archive digest, installed version, actual extension identity and installation provenance; verify supported normal auth/origin handling without forged identity, relaxed trust or bypass. If an approved catalogue item already exists, its ordinary installation can be checked separately. A developer installation never counts as catalogue installation.
3. Open the popup. Expected initial state: Octoport, signed out, no marketplace data, normal “Войти через портал” action.
4. Click the normal portal-login action. Authenticate only on the public portal. Password/OTP must never be supplied to the extension or copied into evidence.
5. Require normal signed `control_plane_v2` bootstrap/compatibility success for the same reviewer account/device/current Opera version. Do not continue if the profile/config is absent, invalid or incompatible.
6. Add only a dedicated reviewer/test Wildberries Personal token through the normal store UI. Run the normal provider verification. Never use owner marketplace credentials or a reviewer-only credential injection.
7. In one supported ChatGPT dialogue choose Wildberries + that reviewer store and press Start.
8. Ask for a bounded read-only connection/usefulness check equivalent to “show information about the connected Wildberries seller”. The AI-produced command must go through the normal Octoport command/action path and the normal provider route. Do not use a developer console or hidden test RPC.
9. Confirm exactly one requested provider result is delivered to that dialogue; no unrelated store/dialogue data appears.
10. Press explicit Finish and confirm the Work session ends.
11. Capture only sanitized evidence: browser/item/version, expected UI states, result class and Finish state. Never capture the reviewer token, OTP, cookies, authorization headers, raw private seller payload or owner sessions.

A stronger stock/sales scenario can replace step 8 after the reviewer account is populated, but it must use a field/unit definition already proven for the published slice and must not silently turn preliminary operational sales into final “revenue”.

## Current external gates — not A workarounds

The automated A boundary is now prepared. Ordinary reviewer acceptance still requires:
- B/C normal reviewer identity/admission under the closed-beta policy;
- a valid signed v2 config/release/browser/compatibility assignment;
- the intended reachable reviewer backend/deployment;
- a legitimate pre-submission installation of the exact candidate with unchanged trust and normal authentication;
- dedicated reviewer marketplace credentials;
- the real reviewer run above.

These are not reasons to weaken trust or auth. Ordinary Opera Add-ons installation and same-item update remain POST-SUBMISSION/POST-APPROVAL checks; they are not prerequisites for the first Submit.

No owner action is requested by this receipt. Ask the owner only when C has staged a concrete publisher-dashboard/login/OTP or short Windows verification step that cannot be performed by the team.

## Current Opera guidance checked

Checked 2026-09-27:
- https://help.opera.com/en/extensions/acceptance-criteria/
- https://help.opera.com/en/extensions/publishing-guidelines/
- https://help.opera.com/en/extensions/basics/

The tracked store policy remains consistent with the current public guidance: the submitted extension must have a clear purpose, sound manifest/permissions, no obvious bugs, reviewable code, relevant screenshots/details, and a genuinely working function. Developer Mode / load-unpacked is a development mechanism and is not treated here as proof of catalog installation.

## Evidence boundary

This receipt adds:
- exact STORE package identity re-verification;
- proof that current A product package inputs are unchanged from the authoritative repaired candidate;
- real-Opera synthetic useful-scenario proof on runtime-equivalent bytes;
- an executable ordinary reviewer sequence for C.

It does **not** claim:
- Opera Add-ons installation, upload, Submit, approval or publication;
- ordinary portal/reviewer authentication on the STORE package;
- live WB or owner data;
- deployment/catalog activation;
- LIVE_OWNER or production acceptance.
