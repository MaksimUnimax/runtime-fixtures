# A03 Firefox privacy-neutral client — 2026-09-25

Status: NOT_ACCEPTED checkpoint.
Role: A.
Source parent before fresh-main reconciliation: `239d4dc92c8564af6b9274a42833f36d35134dc7`.
Authoritative contract: `docs/development/coordination/FIREFOX_PRIVACY_NEUTRAL_CONTRACT_2026-09-25.md`.

## Implemented A-owned scope

- Firefox `technicalAndInteraction` is optional, not required.
- Permission source of truth is Firefox `browser.permissions.getAll().data_collection`; missing API/key/query failure is fail-closed.
- Popup grant calls `permissions.request({data_collection:["technicalAndInteraction"]})` directly from the click handler; it is not relayed through background messaging.
- Popup exposes direct revoke; permission onAdded/onRemoved updates UI.
- Denied/absent permission projects device auth exactly to `{clientType:"browser_extension"}` plus explicit existing `deviceLabel` only.
- Denied/absent permission projects bootstrap by omitting exactly `extensionVersion` and `browser`; identified Chromium/Opera/Yandex and Firefox-granted shapes remain unchanged.
- Pending identified Firefox authorization is abandoned on withdrawal; an in-flight token exchange is aborted and a fresh privacy-neutral authorization starts.
- Technical Health is not acquired/transmitted while permission is absent; no skipped Health is converted to PASS.
- Active-device withdrawal uses bodyless authenticated `POST /v1/devices/current/client-metadata/forget`.
- Offline/unavailable clear persists only `{version,deviceId}`; no browser family/version/extension version or secret is stored. Retry uses the normal authenticated refresh path and remains non-blocking.
- Explicit support snapshot omits Firefox browser family/version and extension version while technical permission is absent.
- Added strict signed `local_client_authority_v1` verification bounds and deterministic local compatibility/feature/AI candidate materialization.
- Local compatibility uses exact release+contract, global/exact-family policy uniqueness, maintenance invariant, maintenance, blocked/min/recommended extension, release browser support, then exact-family minimum browser version.
- Privacy-neutral profile validation requires the signed candidate's `profile_compatibility_v1.contractVersion=control_plane_v2`, local browser-family allowlist/minimums, extension minimum, and SHA-256.
- Materialized operational authority remains bound to the original signed privacy-neutral payload in `SellerAgentsAutonomousWorkAuthority`; valid resolved neutral authority reaches `allowed=true`.
- Existing sync/N2 wire semantics are untouched.

## Parent review corrections beyond the Luna draft

The child draft was not accepted verbatim. Parent review corrected:
1. `CompatibilityPolicy.minimumBrowserVersion` to the contract/server shape `string|null`, not an object.
2. Neutral profile contract checking to `control_plane_v2` without broadening the legacy identified v1 path.
3. Autonomous Work signed-envelope binding for locally materialized neutral authority.
4. metadata-forget retry through normal access-token refresh.
5. popup grant placement at the direct user-gesture boundary.
6. support/diagnostic snapshot removal of optional client-software metadata under opt-out.

## Focused verification — Node 24.20.0

Final runtime was rebuilt from the current working tree with:
- `python3 tooling/build/extension_composed.py --output /tmp/a03-final-runtime --mode development`
- `python3 tooling/build/extension_firefox.py --input-runtime /tmp/a03-final-runtime/runtime --output /tmp/a03-final-firefox`

PASS:
- `node tests/regression/extension-core/client-i1/firefox-technical-data-consent.mjs /tmp/a03-parent-runtime/runtime`
- `node tests/regression/extension-core/client-i1/firefox-popup-consent-source.mjs /tmp/a03-final-runtime/runtime`
- `node tests/regression/extension-core/client-i1/client-support-snapshot.mjs /tmp/a03-final-runtime/runtime`
- `node tests/regression/extension-core/client-i1/firefox-local-authority.mjs`
- `node tests/regression/extension-core/client-i1/firefox-privacy-neutral-client.mjs /tmp/a03-final-runtime/runtime`
- `node tests/regression/extension-core/firefox-package-contract.mjs /tmp/a03-final-firefox`
- JS syntax checks for client/crypto/local-authority/popup.
- `git diff --check`.

Focused privacy-neutral cases include exact neutral/identified auth+bootstrap shapes, Chromium unchanged, pending-auth withdrawal restart, signed-authority/malformed/size failures, profile contract v2 local check, autonomous Work allow from signed neutral authority, no Health transmission, bodyless forget, offline marker, restart retry, and auth refresh before retry.

Firefox development package manifest evidence:
- required categories: authenticationInfo, personallyIdentifyingInfo, browsingActivity, websiteContent, searchTerms, financialAndPaymentInfo, personalCommunications.
- optional category: technicalAndInteraction.
- installed_acceptance remains false.

## External platform basis rechecked

Mozilla Firefox built-in data-consent documentation and permissions API documentation were rechecked on 2026-09-25. The implementation follows the documented optional `data_collection` permission model and direct user-action requirement for permission requests.

## Full extension_core evidence

A clean-source merge rehearsal against fresh `origin/main=7945d62854e135421c3db003c603187b9f37866b` was resolved without changing accepted B05 content. The first heavy run correctly stopped on the stale store-package assertion that still required only the Firefox `required` disclosure object. The assertion was updated to require the exact new shape: unchanged required categories plus `optional: ["technicalAndInteraction"]`; the standalone store-package contract then PASSed.

The repeated full run used the required runtime and runner:
- `PATH=/root/.nvm/versions/node/v24.20.0/bin:$PATH`
- `python3 tooling/coordination/control.py A heavy --profile browser -- python3 tooling/checks/extension_core.py --output /root/octoport-control/logs/A/A03_FIREFOX_PRIVACY_NEUTRAL_FINAL_R2/core`

Merged-tree rehearsal result: `PASS`, 129/129 gates, Node `v24.20.0`, `live_provider_calls=0`, `installed_acceptance=false`.
Exact final A-only code HEAD `174d8d0386f963ab6796a7ca4e2a05f802f69521` was then rerun independently and also passed 129/129 gates under `/root/octoport-control/logs/A/A03_FIREFOX_PRIVACY_NEUTRAL_FINAL_R3/core/`.

The merge commit itself was not manufactured: `A guard --base origin/main` accepted only A-owned delta, but the repository pre-commit hook re-runs default `A guard` and therefore rejects already-accepted B05 files introduced by the upstream merge. Hooks were not disabled or bypassed. The merge rehearsal was aborted after evidence collection; the A-only checkpoint remained intact.

## Remaining gates

- Exact A-only code candidate `174d8d0386f963ab6796a7ca4e2a05f802f69521` includes the store-package assertion update, passed full `extension_core` 129/129 and was submitted to C.
- Compatible privacy-neutral server/database/shared-schema implementation is not deployed; no privacy-neutral request was sent to old live/preprod.
- Real Firefox 155.0.1 grant/deny/revoke and installed-synthetic neutral→identified→neutral wire proof is now PASS; see `A03_FIREFOX155_PRIVACY_NEUTRAL_INSTALLED_2026-09-25.md`.
- Compatible backend deployment and full Firefox Work/Ozon/WB acceptance remain open.
- No AMO submission/readiness claim.
- Coordination review is needed for the merge-aware pre-commit hook behavior; A will not bypass it.

Verdict: SOURCE/FOCUSED/PACKAGE/FULL_EXTENSION_CORE/REAL_FIREFOX_CONSENT_WIRE_PASS_NOT_ACCEPTED.
