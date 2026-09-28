# A — owner-test exact STORE 0.2.6 control matrix — 2026-09-28

Status: **FINITE MATRIX COMPLETE / SIGNED-OUT EXACT STORE PASS / AUTHENTICATED EXACT STORE GATES OPEN**

Task: `A_OWNER_TEST_EXACT_PACKAGE_CONTROL_MATRIX`.
Controller notice: `OWNER-TEST-ROADMAP-20260928-0430`.

## Exact hand-test candidate

Chromium/Opera:
- `OCTOPORT_v0.2.6_CHROMIUM_STORE.zip`;
- SHA-256 `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`.

Firefox:
- `OCTOPORT_v0.2.6_FIREFOX_STORE.zip`;
- SHA-256 `b5de9b4f0773c08a705fbad050e77d382f265aa34fd2ca8d3657553bad577305`.

Frozen release source:
`028d5dd56341719e2061a47b5e82e216256619f7`,
tree `99e12233864a592510032e30bb96668b41682204`.

Old STORE 0.2.5 `33cbf1ad...` remains historical HOLD and is not used below.

## Evidence classes used in this matrix

- **EXACT_STORE_INSTALLED_SYNTHETIC** — the frozen STORE ZIP itself was loaded into a real browser; no owner credentials/live provider.
- **CURRENT_026_SOURCE_PACKAGE_PASS** — current 0.2.6 source and generated/extracted package behavior is executable and green, but not authenticated STORE installation.
- **HISTORICAL_INSTALLED_SYNTHETIC_UNCHANGED_LOGIC** — older installed-synthetic proof may be reused only where current bytes/behavioral source are unchanged; it is not relabeled exact-STORE acceptance.
- **NOT_VERIFIED_EXACT_STORE_AUTH** — control is behind signed authentication and has not been exercised in the frozen STORE ZIP with ordinary auth.
- **NOT_VERIFIED_LIVE** — requires real owner/reviewer/provider/store channel evidence.

Current 0.2.6 accepted automation:
- C-integrated core: D2.4 PASS, 131 gates;
- C-integrated I1: PASS, 160 gates;
- WB exact current boundary: source/package PASS;
- profile→DOM proof: current signed-profile consumer SOURCE/EXTRACTED + controlled real-MV3 `WIRED` PASS; installed STORE/LIVE remains open.

For the exact Chromium STORE signed-out browser boundary A adds:
`tests/regression/extension-core/client-i1/exact-store-signedout-controls.py`.

## Exact STORE signed-out Opera result

Repository gate result:
- status: PASS;
- evidence: `INSTALLED_SYNTHETIC_EXACT_STORE_SIGNED_OUT`;
- Opera product: `136.0.6008.22`;
- Chromium engine reported by Playwright: `152.0.7977.120`;
- manifest version: `0.2.6`;
- external HTTP(S) requests: 0;
- page errors: 0.

Result:
`/tmp/a-owner-control-opera026-repo-r1.json`
SHA-256 `d9ebf55e27fd3da0286c32991c4f493e92295cd9074189c30baa5ded0782f073`.

Test SHA-256:
`c8feb058fea809584b334c8ebb730a69267fbf4d95bb3bae1b7ffee4e4ebd7e5`.

Resource receipt:
`/root/octoport-control/resource-jobs/d0aa25243f794d6a9fa9c7e1fcdc7dbe/receipt.json`.
Exit 0, OOM 0, cleanup verified, peak 473956352 bytes.

Observed signed-out exact STORE state:
- visible/enabled: `auth-start`, `support-generate`;
- `auth-start` visibility/enabled state is **not** functional auth acceptance; no auth action was executed;
- hidden because no signed auth: marketplace/store CRUD, credential checks, Work, transfer, backup and confirmation controls;
- `auth-open`, `auth-cancel`, `auth-reset` are not applicable until a pending/authenticated state exists;
- Firefox technical consent is correctly not visible in Opera.

`support-generate` was clicked on exact STORE bytes and produced
`seller_agents_support_snapshot_v1` with version `0.2.6`,
PREPRODUCTION, observed Opera identity, unauthenticated/workAllowed=false,
zero stores and all privacy-included flags false.

`auth-start` was intentionally not clicked: that would create a live auth intent and
does not belong to the signed-out synthetic boundary.

## Control matrix

| Group | Controls / behavior | Current evidence | R1 disposition |
|---|---|---|---|
| Auth | auth-start | Exact STORE Opera visible/enabled; action was intentionally not clicked | **VISIBLE_ENABLED_ONLY / ACTION_NOT_VERIFIED** |
| Auth | auth-open, auth-cancel, auth-reset | Existing synthetic auth flows only; require pending/auth state | **NOT_VERIFIED_EXACT_STORE_AUTH** |
| Diagnostics | support-generate / support-snapshot | Exact STORE Opera click; privacy-safe result; network0/errors0 | **EXACT_STORE_INSTALLED_SYNTHETIC PASS** |

| Stores | ozon, wildberries, stores, add, save | Current synthetic browser paths create Ozon/WB stores; STORE popup handlers unchanged 0.2.5→0.2.6 | **FUNCTIONAL_SYNTHETIC PASS / EXACT_STORE_AUTH OPEN** |
| Stores | edit, remove, cancel, secret-preserving edit, confirmation | Catalog/storage invariants and delete fences exist; exact authenticated UI not exercised | **NOT_VERIFIED_EXACT_STORE_AUTH** |
| Credentials | seller/performance/token fields and clear-performance/personal | Current catalog metadata/credential-revision tests PASS | **CURRENT_026_SOURCE_PACKAGE_PASS** |
| Checks | check-seller, check-performance, check-token | Private provider credentials were independently format/auth checked, but no direct exact STORE popup-button execution evidence exists | **NOT_VERIFIED_EXACT_STORE_AUTH + NOT_VERIFIED_LIVE_UI** |
| Work | start | BR-C1 signed PASS, denial/tamper/network/drift, double-click single-flight; current 0.2.6 core/I1 PASS | **CURRENT_026_SOURCE_PACKAGE_PASS / EXACT_STORE_AUTH OPEN** |
| Work | work-resume | BR-C1-03, BR-C1-17 plus raw external Resume disabled | **CURRENT_026_SOURCE_PACKAGE_PASS / EXACT_STORE_AUTH OPEN** |
| Work | visibility, finish | Current browser/application lifecycle tests cover hide/show, no-replay and Finish; exact STORE hidden pre-auth | **CURRENT_026_SOURCE_PACKAGE_PASS / EXACT_STORE_AUTH OPEN** |
| Work | quota resume | Runtime/source contract covered; exact authenticated STORE quota-wait button not exercised | **NOT_VERIFIED_EXACT_STORE_AUTH** |
| Confirmation | confirm, reject | BR-C1-20..25: visible warning, reject preserves source, confirm rebind order, denied target preserves source | **HISTORICAL_INSTALLED_SYNTHETIC_UNCHANGED_LOGIC / EXACT_STORE_AUTH OPEN** |
| Work safety | repeated click / delayed Health / drift / Finish race | BR-C1-12..17, 26..38 PASS; current core/I1 also green | **CURRENT_026_SOURCE_PACKAGE_PASS** |

| Transfer | transfer-consent/create/discover/receive | Two real browser workers + real local HTTP relay; recipient restart/key recovery/exact-once ACK/replay fences PASS; provider0/AI0 | **HISTORICAL INSTALLED_SYNTHETIC PASS / EXACT_STORE_AUTH OPEN** |
| Backup | export/preview/import/password/file fields | Current exact 0.2.6 I1 source+package A24: EX-01..74 PASS including wrong password/tamper/conflict/non-overwrite/privacy | **CURRENT_026_SOURCE_PACKAGE_PASS / EXACT_STORE_AUTH OPEN** |
| Firefox | consent section initial neutral state | Exact STORE Firefox 155.0.1 temporary install on ZIP `b5de9b4f…`: initial permission set excludes `technicalAndInteraction`; fresh support snapshot withholds optional technical metadata; signed-out UI/auth/work state enforced | **INSTALLED_SYNTHETIC EXACT STORE PASS** |
| Firefox | grant/revoke technicalAndInteraction | Controller `f448e058…` + independent A rerun `c88da8e1…`: real visible Firefox browser-chrome Deny/Allow; extension Revoke; only `technicalAndInteraction` added/removed; fresh diagnostics include technical metadata only while consent is granted | **INSTALLED_SYNTHETIC EXACT STORE PASS** |
| Dialog | owned code-block action | Current 0.2.6 content_script.js is byte-identical between exact STORE and accepted I1 extracted package; current browser regressions PASS | **CURRENT_026 PACKAGE CODE PASS / AUTHENTICATED INSTALLED OPEN** |
| Dialog | Response-actions Copy exclusion | Current regressions explicitly reject response-level Copy, misleading data-code-copy-state, user/editor/ambiguous/unrelated blocks | **CURRENT_026 PACKAGE CODE PASS / AUTHENTICATED INSTALLED OPEN** |
| Dialog | composer/send/Work Start readiness | Current tests cover Standard send, Work submit, microphone/stop/disabled ambiguity, delayed composer and bounded fail-closed wait | **CURRENT_026 PACKAGE CODE PASS / AUTHENTICATED INSTALLED OPEN** |
| Profile | signed P7 selector content | Exact `c683a0d3…` acceptance: strict signed consumer SOURCE/EXTRACTED PASS plus controlled real-MV3 WIRED behavior; profile identity fenced before Start/Resume; provider0 | **CURRENT SOURCE_PACKAGE_MV3 WIRED PASS / INSTALLED_STORE_LIVE OPEN** |
| Portal | login/approve/cancel/expiry/logout/errors | C-owned backend/portal boundary | **NOT_VERIFIED BY A / C+OWNER** |

## Reused evidence without relabeling

Current 0.2.6 I1 backup evidence:
`/tmp/a-c-final-026-i1-git-cb6d0e8e/logs/i1-{source,package}-i1-d3s2-a24-export-import.txt`.
Both report all A24 groups PASS.

Historical transfer evidence:
`A02_JOINT_RESTART_PREPARATION_2026-09-26.md`.
It proves installed-synthetic transport/restart behavior, not the exact authenticated STORE 0.2.6 UI.

Historical real Firefox functional evidence:
`A03_FIREFOX155_FUNCTIONAL_MATRIX_R2_2026-09-27.md`.
It proves Firefox 155 local-development Work/WB/Ozon/no-replay/Finish, not AMO or exact STORE auth.

Current dialog/package evidence:
- `A_STORE_0_2_6_C_INTEGRATED_FULL_ACCEPTANCE_2026-09-28.md`;
- `A_STORE_0_2_6_C_INTEGRATED_I1_ACCEPTANCE_2026-09-28.md`;
- `A_MONITOR_PROFILE_CONSUMER_AND_CONTOURS_2026-09-28.md`.

The exact STORE and accepted 0.2.6 I1 package have identical bytes for
`content_script.js`, `shared/manual_controls.js`, `shared/ai_adapters.js`,
`shared/composer_send.js`, `shared/conversation_identity.js`,
`shared/work_session_model.js` and `shared/wb_adapter.js`.
This supports package-code reuse only; it does not manufacture authenticated installed evidence.

## Finite remaining R1 gaps

1. **Ordinary exact-STORE authentication** — owner/C dependency.
   C must first provide the intended owner-test backend/portal path for 0.2.6. The owner then performs only ordinary login/OTP; A does not need passwords or codes in chat.

2. **Authenticated exact-STORE popup matrix in Opera** — A immediately after gap 1.
   Exercise marketplace switch, add/edit/remove/cancel, confirm/reject, Start/Resume/visibility/Finish/quota-resume, transfer UI, backup UI and diagnostics on the frozen `579dc15a...` bytes.

3. **Credential-check buttons with real read-only provider responses** — A + owner inputs after gap 1.
   Check Seller, Performance and WB token through the installed UI; verify success and safe 401/403/network presentation. Existing direct auth checks do not substitute for these buttons.

4. **Exact installed useful flow** — A after gap 1 and C owner-test compatibility.
   One bounded read-only Ozon flow and one WB flow in real supported AI context; require one provider request, one result, no replay, visibility and explicit Finish.

5. **Firefox exact STORE technical consent — CLOSED at INSTALLED_SYNTHETIC.**
   Exact Firefox 155.0.1 on frozen ZIP `b5de9b4f…` now has controller-captured real visible permission UI Deny/Allow plus extension Revoke and an independent A rerun with identical result SHA `a46cc5c6…`. AMO/catalog installation, ordinary login/authenticated actions and backend/live acceptance remain separate.

6. **Same-item signed N→N+1 and Windows UX/preservation** — owner/store environment.
   Linux development-flag installation does not prove store update identity or Windows UX.

7. **Store catalog/reviewer/publication** — C/store channel.
   Exact package upload/Submit/moderation/catalog installation are separate from this A matrix.

## Hand-test readiness verdict

The frozen 0.2.6 ZIP is a valid exact package candidate and has real signed-out
installed-synthetic Opera evidence. It is **not yet honest to say that all owner-visible
buttons have been tested on that exact installed package**.

The blocking distinction is ordinary signed authentication, not missing generic test
coverage. Before auth, the product intentionally hides the catalog/Work/transfer/backup
controls, so clicking them through injected state would be test-only admission and would
not satisfy R1.

The next owner action should therefore not be requested until C has prepared the exact
0.2.6-compatible owner-test backend/portal path and A/C have the installed matrix ready
to continue immediately after login.

Once that prerequisite exists, one ordinary authenticated session can close most Opera
R1 rows in a single bounded run. Marketplace secrets/OTP remain outside chat/evidence.

Firefox exact STORE signed-out technical consent is now closed at INSTALLED_SYNTHETIC.
AMO/catalog installation, ordinary authenticated Firefox actions and backend/live
acceptance remain separate and do not block the Opera-first hand-test sequence.

No production deployment, live DB mutation, provider request, auth intent, catalog
mutation, store upload or Submit was performed in this A block.

## Final exact Opera gate identity

The reusable test was hardened after the first repository PASS so that it independently
reads the browser product version from the executable instead of trusting a caller label.
The final rerun supersedes the earlier R1 result identity above:

- result: `/tmp/a-owner-control-opera026-repo-r2.json`;
- result SHA-256:
  `1029ec73eee3a182a10fe290e751f3b804b7b8c25e812815106113a22d13a4c3`;
- final test SHA-256:
  `c8feb058fea809584b334c8ebb730a69267fbf4d95bb3bae1b7ffee4e4ebd7e5`;
- resource receipt:
  `/root/octoport-control/resource-jobs/bd5a552ddf4948129a19055dd70815e0/receipt.json`;
- exit 0, OOM 0, cleanup verified, peak 455081984 bytes.

The final test itself verifies exact ZIP SHA, actual Opera product version, manifest
version, signed-out visibility gates, privacy-safe support output, zero external
HTTP(S) request observation and zero popup page errors.

## Firefox exact-STORE consent diagnostic

A used the existing accepted test binaries:
Firefox `155.0.1` and geckodriver `0.37.1`, installing exact
`OCTOPORT_v0.2.6_FIREFOX_STORE.zip` temporarily with real add-on ID
`octoport@octoport.ru`.

The path reached the real browser permission doorhanger after the extension-side
`firefox-technical-grant` click. Two bounded interaction attempts then failed in
Marionette with `ElementNotInteractableException` while clicking browser-chrome UI.

Resource receipts:
- `b742f08c7e274623a4db09e94b09cfd0`;
- `57e26fb8a2d848dc831b32a51185cce7`.

Both cleaned up successfully with OOM 0. This is an automation limitation, not evidence
that the extension grant/revoke behavior is broken. Per retry policy A stopped this
method and records exact STORE grant/revoke as `NOT_VERIFIED`.

The 0.2.6 Firefox `popup.html` and `popup.js` bytes are identical to 0.2.5,
but that byte identity does not upgrade older non-STORE or neutral-permission evidence
into exact STORE doorhanger acceptance.

## Firefox exact-STORE consent final superseding evidence

The historical Marionette `ElementNotInteractableException` attempts above remain
preserved as evidence of the abandoned interaction method. They are superseded for this
specific signed-out consent boundary by a different browser-chrome UI method; they are
not deleted or relabelled as product failures.

Controller final candidate:
`f448e058db917c3f64e1a710066bd76f5b21deae`.

Controller evidence:
`/root/octoport-control/logs/controller/manual-firefox-consent-20260928/result-final.json`.

A independently reviewed the candidate test and reran the same exact boundary with:
- exact frozen package
  `OCTOPORT_v0.2.6_FIREFOX_STORE.zip`;
- SHA-256
  `b5de9b4f0773c08a705fbad050e77d382f265aa34fd2ca8d3657553bad577305`;
- Firefox `155.0.1`;
- geckodriver `0.37.1`;
- fresh disposable Firefox profile;
- temporary installation with real add-on ID `octoport@octoport.ru`;
- fresh network namespace containing loopback only;
- no ordinary login, backend/provider request, token/session seeding or permission-state
  injection.

A resource receipt:
`/root/octoport-control/resource-jobs/c88da8e1ce3f4959af19608d2850ead7/receipt.json`.

A rerun result:
`/tmp/a-firefox-consent-review/result.json`.

The A result SHA-256 is exactly the controller result SHA-256:
`a46cc5c6eea14a0921aa34a11a25d8f64a3624fc4bf834c8ecbeef114293d520`.

Observed exact permission/UI sequence:
1. Initial: `technicalAndInteraction` absent; optional technical metadata WITHHELD.
2. Real visible Firefox browser-chrome **Deny**: permission set unchanged; metadata remains
   WITHHELD.
3. Real visible Firefox browser-chrome **Allow**: exactly
   `technicalAndInteraction` is added; fresh support output includes the expected
   Firefox/extension technical metadata.
4. Extension **Revoke**: the original permission set is restored; fresh support output
   again withholds optional technical metadata.

Across all four support snapshots:
- `authenticated=false`;
- `workAllowed=false`;
- signed-out catalog remains hidden;
- ordinary login remains visible;
- all six sensitive-data privacy flags remain false.

Independent A supervisor:
- exit 0;
- OOM 0;
- cleanup verified;
- peak 531,628,032 bytes.

Evidence level:
**INSTALLED_SYNTHETIC_EXACT_FIREFOX_STORE_SIGNED_OUT PASS**.

This closes the exact STORE Firefox signed-out technical-consent Deny/Allow/Revoke gap.
It does not establish AMO installation/publication, ordinary authenticated Firefox
actions, owner/provider acceptance, deployed backend compatibility or LIVE_OWNER evidence.
