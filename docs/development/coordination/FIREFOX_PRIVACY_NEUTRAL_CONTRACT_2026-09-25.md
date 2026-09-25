# Firefox privacy-neutral client metadata contract — 2026-09-25

Role: C shared-contract authority.
Status: CONTRACT / IMPLEMENTATION ASSIGNMENT; no Firefox AMO readiness claim.
Baseline: `c520015cfa2a4630d06b3013b9cd78aafde352da`.
Accepted prerequisites: N2 server-first SOURCE and C04 SOURCE are already in `main`.

Policy basis checked 2026-09-25:
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/add-on-policies/

Mozilla classifies device/browser information and extension usage/settings as `technicalAndInteraction`; that permission is optional. When technical/user-interaction transmission is declined, add-on functionality must not be restricted merely because that data is unavailable.

## 1. Scope and invariant

This contract removes Firefox optional technical metadata from the required path without weakening auth, signed configuration, profile integrity, device revocation, account isolation, or the read-only marketplace boundary.

`client software metadata` means exactly:
- extension version;
- browser family;
- browser version.

When Firefox `technicalAndInteraction` permission is not granted, none of those three values may be transmitted to Octoport, directly or through a sentinel, derived alias, URL/query choice, header, diagnostic payload, or fabricated value.

Local use of those values is allowed. The extension already knows its own version and browser locally; privacy-neutral operation evaluates signed server policy against those local values without sending them.

The following are not reclassified by this contract: authenticated account/device/session identifiers, `detectedAi`, marketplace/account/store identifiers already covered by the required Firefox declarations, and content explicitly delivered to the selected AI under the product data gates.
## 2. Device authorization request

`POST /v1/device-authorizations` accepts two strict shapes.

Legacy identified shape remains byte-compatible:
```text
clientType = "browser_extension"
browserFamily = BrowserFamily                required
browserVersion = SafeVersion                 optional
extensionVersion = SafeVersion               required
deviceLabel = string                         optional
```

Privacy-neutral shape:
```text
clientType = "browser_extension"
deviceLabel = string                         optional
```

Rules:
- `browserFamily` and `extensionVersion` either both exist or both do not exist.
- `browserVersion` is forbidden when the pair is absent.
- no `unknown`, `withheld`, Firefox default version, copied server version, or other placeholder is accepted as browser/version data.
- in privacy-neutral mode `deviceLabel` may only be an explicit user label; A must not derive it from browser/version/platform data.
- idempotency and request fingerprinting include the exact request shape; replay cannot switch between identified and privacy-neutral metadata modes.

The existing start response, portal approval, exchange token semantics, account authority and device/session identifiers do not change.
## 3. Auth/device persistence

B makes `device_authorizations.browser_family` and `devices.browser_family` nullable. The existing version columns remain nullable.

The database must enforce:
```text
WITHHELD:
  browser_family IS NULL
  browser_version IS NULL
  extension_version IS NULL

PRESENT:
  browser_family IS NOT NULL
  extension_version IS NOT NULL
  browser_version may be NULL or non-NULL
```

There is no sentinel browser enum and no fabricated value. Authorization exchange copies NULLs as NULLs. Authentication, refresh, revocation, rate limiting, account ownership and device admission continue to key only on the existing security identities; none may depend on client software metadata.

Portal preview/device-list contracts gain an authoritative `clientMetadata` union:
```text
{ state: "WITHHELD" }
{ state: "PRESENT", browserFamily, browserVersion|null, extensionVersion }
```
Legacy top-level metadata fields remain populated for PRESENT rows during the compatibility period and are omitted for WITHHELD rows. The server/portal release that understands the union must precede the privacy-neutral client. Extension clients do not consume these portal list/preview representations.

For an already active device, B exposes `POST /v1/devices/current/client-metadata/forget`. It requires the normal extension bearer principal, accepts no request body, is idempotent, and returns `{ status: "cleared", deviceId }`. The device ID comes only from the authenticated principal; callers cannot name another device. The operation clears exactly the three persisted metadata columns and must not clear or rotate device/session authority.
## 4. Bootstrap request

`POST /v1/bootstrap` keeps `control_plane_v2` and accepts two strict request variants.

Legacy identified variant is unchanged:
```text
contractVersion = "control_plane_v2"
extensionVersion
browser = { family, version }
deviceId
lastConfigVersion
detectedAi?
```

Privacy-neutral variant:
```text
contractVersion = "control_plane_v2"
deviceId
lastConfigVersion
detectedAi?
```

`extensionVersion` and `browser` must co-occur. There is no fallback that sends either field after a privacy-neutral request fails.

Config-release selection remains account/device scoped exactly as today. The absence of client software metadata must not alter signature verification, access basis, account/device/session authority, config version selection, TTLs, offline grace, or revocation semantics.
## 5. Signed privacy-neutral bootstrap authority

The Ed25519 `bootstrap_envelope_v2` stays unchanged. Its decoded `bootstrap_snapshot_v2` becomes a strict union selected by request shape.

Identified requests receive the existing payload shape, unchanged.

Privacy-neutral requests receive the common signed fields already used for account/access/time/device authority plus:
```text
localClientAuthority = {
  schemaVersion: "local_client_authority_v1",
  contractVersion: "control_plane_v2",
  compatibility: {
    releases: ReleaseSupport[],
    policies: CompatibilityPolicy[]
  },
  featureRules: FeatureRule[],
  ai: LocalAiAuthority
}
```

A privacy-neutral payload does not contain the legacy server-evaluated `compatibility`, `features`, or resolved `ai` fields. The local authority is inside the signed canonical payload; unsigned headers, query parameters, portal state or local storage can never substitute for it.

The existing envelope bound remains exactly the current `payload.max(32768)` base64url-character limit. The server must fail closed rather than truncate an authority bundle.
### 5.1 Compatibility bundle

`ReleaseSupport` contains only server-published release facts needed by the current resolver:
```text
extensionVersion
contractVersions[]
browserFamilies[]
```

The privacy bundle contains at most the newest 64 published release rows, deterministically ordered by `releasedAt DESC, id DESC`. Absence of the local extension version from that signed window is locally treated as UPDATE_REQUIRED.

Each `CompatibilityPolicy` contains:
```text
policyKey, revision, contractVersion,
browserFamily|null,
minimumExtensionVersion|null,
recommendedExtensionVersion|null,
minimumBrowserVersion|null,
maintenanceMode, maintenanceCode|null,
blockedVersions[]
```

Only policies linked to the selected config release are included. More than 32 linked policy revisions or more than 128 blocked versions in one revision is source-invalid for privacy-neutral bootstrap; no partial list is signed.

Local evaluation uses the same comparison rules as the existing server resolver: exact release and contract support, global plus exact-family policy uniqueness, the existing `maintenanceMode`/`maintenanceCode` consistency check, maintenance, blocked version, minimum/recommended extension version, release browser support, then exact-family minimum browser version.
### 5.2 Feature rules

The server performs account/device rollout selection first because that selection does not require client software metadata. It then signs one selected rule per feature:
```text
featureKey, revision, contractVersion,
enabled, browserFamily|null,
minimumExtensionVersion|null
```

The existing maximum of 128 feature keys remains. Duplicate feature keys, wrong contract versions or corrupt rollout sources fail closed.

The client materializes the feature map locally:
```text
enabled
AND (browserFamily is null OR browserFamily == local browser)
AND (minimumExtensionVersion is null OR local extension >= minimum)
```

The derived feature map is local state. It is not sent back to the server merely to prove which browser/version selected it.
### 5.3 AI/profile authority

`LocalAiAuthority` is exactly one of:
```text
{ status: "UNCONFIGURED" }
{
  status: "CANDIDATES",
  detected: { family, surface, variant|null },
  candidates: [
    {
      browserFamily,
      resolution:
        { status: "UNAVAILABLE", reason }
        | { status: "RESOLVED", profile }
    }
  ]
}
```

`reason` uses the existing `UNSUPPORTED_DETECTED_AI | AI_DISABLED | NO_PROFILE | PROFILE_INCOMPATIBLE` vocabulary. `profile` uses the existing signed bootstrap profile shape (`profileKey`, `revision`, `scopeVariant`, `schemaVersion`, `contentSha256`, `content`, `compatibility`).

If `detectedAi` is absent, `LocalAiAuthority` is `UNCONFIGURED`.

If it is present, the server resolves the existing hierarchy and account/device assignment rollout separately for every published browser-family assignment that can apply to that AI surface, without receiving the user's actual browser family. It signs at most one selected candidate per browser family, bounded by the repository BrowserFamilies set.

Each candidate carries the existing immutable profile identity/content/fingerprint and its existing `profile_compatibility_v1` object. Server-side hierarchy/status/assignment integrity checks remain mandatory. Browser/extension compatibility checks are intentionally deferred.

The client chooses only the candidate matching its local browser family and then enforces locally:
- contract version;
- profile browser-family allowlist;
- minimum browser version for that family;
- minimum extension version;
- profile content SHA-256.

No candidate or failed local check means AI profile unavailable. A client must never choose a profile for another family, ignore a minimum, accept an unsigned profile, or invent a family/version to make a candidate pass.
## 6. Local consent, refusal and withdrawal

A owns the Firefox permission state and client behavior.

When `technicalAndInteraction` is granted, the existing identified auth/bootstrap path may continue and optional technical Health/diagnostic metadata may be transmitted.

When it is absent or denied:
- use the privacy-neutral auth/bootstrap shapes;
- do not acquire signed Health authority from the user extension;
- omit browser/version/extension fields from feedback, diagnostics and other optional technical payloads;
- never retry an error by silently switching to the identified shape;
- keep local browser/version values only in local cache/binding checks.

Current application Health is already an optional online observation, not lifecycle authority. Skipping acquisition because technical permission is absent therefore must not disable command admission and is not treated as an implicit PASS. When Health is acquired, an authenticated and verified Health `DENY` remains an admission veto exactly as today. A verified auth/bootstrap denial, device revocation or signed compatibility failure also still applies normally.

On permission withdrawal:
- stop future technical transmissions immediately;
- if an identified authorization is still pending, abandon that attempt and start a new privacy-neutral attempt instead of exchanging it;
- for an active device, invoke the bodyless current-device metadata-forget operation;
- if that clearing call is offline/unavailable, keep a local pending-clear marker and retry later without blocking core work and without resending technical metadata.
## 7. Explicit AI/report delivery is unchanged

The technical opt-out does not authorize new content flows and does not disable the existing user-commanded read-only product flow.

Marketplace credentials remain local/provider-bound under the existing rules. Octoport server still does not receive raw marketplace credentials or wholesale raw seller reports.

Content explicitly selected for delivery to the chosen external AI remains governed by the Firefox required data declarations and the existing personal-data / command confirmation gates. This contract does not reclassify that content as `technicalAndInteraction`.

N2 `POST /v1/sync` also remains unchanged: no browser/version/extension fields are added to sync, and the accepted server-first snapshot/reconciliation semantics are not reopened.
## 8. Version negotiation and old clients

Old extension clients are preserved:
- they send the identified auth/bootstrap shapes;
- the new server recognizes those exact shapes;
- they receive the existing legacy signed bootstrap payload without `localClientAuthority`;
- existing signature, compatibility/profile evaluation and cache semantics remain byte-shape compatible.

New privacy-capable clients use the absence of the technical field group as the negotiation signal. A pre-change server will reject that strict request; the client must not fall back to transmitting denied metadata. Therefore the privacy-capable Firefox release is forbidden before the compatible server/database release is deployed.

A privacy-neutral bootstrap is valid only when its signed payload contains `localClientAuthority.schemaVersion = local_client_authority_v1`. Missing, malformed, oversized, unsigned or unsupported local authority fails closed for server-dependent work and never causes metadata fallback.

Granting technical permission later may switch subsequent requests back to the identified legacy path. Revoking it switches subsequent requests back to privacy-neutral immediately.
## 9. Rollout order

1. C publishes this shared contract.
2. B, after restoring its current disposable DB baseline, implements only the server/DB side in B-owned paths. No live migration is applied.
3. C integrates B, regenerates/owns shared contracts and OpenAPI, verifies old identified requests plus privacy-neutral requests on disposable PostgreSQL, publishes the server-first candidate, and obtains the five exact CI workflows.
4. Live migration/deploy remains a separate explicitly evidenced action.
5. Only after compatible backend availability is proven may A's privacy-capable Firefox package become a submission candidate.
6. Opera first-submission work remains independent and must not wait for Firefox.

No stage may infer AMO readiness from SOURCE/PACKAGE alone.
## 10. Assignment A — client/consent only

A may reuse the correct parts of candidate `50c252c`; do not mechanically merge unrelated tail.

A owns:
- corrected Firefox required disclosure categories from the actual outbound-data map;
- optional `technicalAndInteraction` declaration;
- `browser.permissions.getAll()` handling for grant, denial and later withdrawal;
- exact privacy-neutral auth/bootstrap construction;
- local evaluation of signed `local_client_authority_v1`;
- no-Health/no-optional-diagnostics behavior while permission is absent;
- pending-auth restart and active-device metadata-clear retry on withdrawal;
- focused source/package/vendor-Firefox tests and evidence.

A must not change shared schemas/OpenAPI, server, DB, migrations or C-owned release policy.
## 11. Assignment B — server/DB only

B continues its already assigned current-DB recovery in parallel. After that baseline is restored, B owns:
- a then-current forward migration making the two browser-family columns nullable and adding all-or-none metadata constraints; reserve the migration number at implementation time and do not pre-empt another accepted migration;
- repository/service support for NULL client metadata without weakening device/account/session checks;
- the authenticated idempotent current-device metadata-forget operation;
- privacy-neutral bootstrap policy materialization, including bounded release/policy/feature sources;
- per-browser AI candidate materialization with existing assignment rollout integrity;
- portal/API server support for the `clientMetadata` union;
- disposable PostgreSQL tests for PRESENT/WITHHELD, isolation, revocation, replay, clearing, source corruption and bounds.

B must not edit C-owned shared contracts/OpenAPI. No live DB mutation or deployment is part of this assignment.
## 12. Assignment C — integration and acceptance

C owns:
- shared Zod schemas, OpenAPI and architecture text implementing this contract;
- review of A/B candidates without duplicating their owned files;
- proof that legacy identified requests are unchanged;
- proof that privacy-neutral requests contain zero client software metadata;
- proof that the signed local algorithm matches the existing server compatibility/profile semantics for the same local inputs;
- exact five-workflow CI and sole main integration.

In parallel, C continues the ordinary Opera reviewer path and checks that the exact STORE package points at a backend/config/profile chain that includes accepted N2. PACKAGE PASS is not Submit readiness; reviewer login/data and one ordinary read-only request/result/Finish must be evidenced separately.

## 13. Acceptance prohibitions

A PASS is impossible if any of the following occurs:
- fake/placeholder browser or version data;
- metadata fallback after denial;
- technical Health/diagnostic transmission while denied;
- unsigned compatibility/config/profile acceptance;
- client selection of a policy/profile for the wrong browser family;
- weaker device revocation or account isolation;
- partial/truncated signed policy bundle;
- live migration/deploy claimed from disposable evidence;
- AMO/Opera publication readiness inferred only from source or package checks.
