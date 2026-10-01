# C06 exact STORE 0.2.11 popup-control matrix — 2026-10-01

Status: **EXACT PACKAGE CONTROL INVENTORY COMPLETE / STATIC BINDING 30/30 PASS / EXISTING INSTALLED EVIDENCE RECONCILED / ORDINARY AUTHENTICATED ACTION MATRIX STILL OPEN**.

Task: `C06-STORE0211-EXACT-CONTROL-MATRIX`.

This receipt answers one narrow readiness question for the exact frozen STORE `0.2.11` package: which popup buttons physically exist and are bound in the immutable package, which already have exact installed action evidence, and which still require ordinary authenticated/live execution.

It does not inject authenticated state, rebuild the package, call a marketplace/provider, or promote source/static coverage into installed acceptance.

## Exact immutable package

Chromium STORE:

- source HEAD: `7353c996fb72b62196d57ef2dbcd5c8339057dba`;
- source tree: `a1f5b3616dba28473ce7275e5994af89001a4532`;
- version: `0.2.11`;
- ZIP SHA-256:
  `66c8b34e533f0e716cc3b7d214127a8443e89a241682d2307487c96a373f07c9`.

Firefox STORE:

- ZIP SHA-256:
  `f53340ccedec844041d57c0b3e37de0bd8acf234aacd4852ee2b5fe0c72926ca`.

Exact extracted popup bytes:

- `popup.html` SHA-256:
  `c8e366bb8ab11e65d5fd3bf8a9aac10b14bca260c5a36c6c21dee86eb91e5777`;
- `popup.js` SHA-256:
  `07b4cd251f339041c08afe99dae2871f199ad09149b5665cbbae22911beb58e7`.

No package byte was changed or rebuilt by this task.

## Static exact-package control binding

A bounded parser was run directly against the extracted exact STORE `popup.html` and `popup.js`.

Accepted superseding result:

`/root/octoport-control/logs/C/c06-store0211-control-matrix-20261001/static-control-map-r2.json`

SHA-256:

`465e8a92c740f6b5e0804540fd31474280ab183e59388bcbb1a76bcee0d11ae1`.

Result:

- HTML IDs: `80`;
- buttons: **30**;
- forms: `1`;
- selects: `1`;
- all 29 non-submit buttons have direct or bounded-loop click bindings;
- `save` is `type=submit` and is bound through `card.onsubmit`;
- `stores` select is bound through `onchange`;
- missing button bindings: `0`;
- bound target IDs missing from HTML: `0`;
- missing form submit bindings: `0`;
- missing select change bindings: `0`;
- status: **PASS**.

The first local parser attempt was over-greedy and produced a diagnostic false FAIL by matching arbitrary strings across source text. It is superseded by the bounded ID parser above and is not product evidence.

## Installed evidence sources used

Opera exact STORE changed-boundary run:

`/root/octoport-control/logs/A/store0211-installed-r1/installed-acceptance-summary.json`

SHA-256:

`f7503f0c9844216008f320a6238284a628ae208465d2fde0422e0a90810b8adc`.

Evidence level:
`INSTALLED_SYNTHETIC_EXACT_STORE`.

It proves on exact immutable `0.2.11` bytes:

- service worker and native popup load;
- native popup normal / edit-open / edit-closed layout boundary;
- Start UX states:
  `accepted-pending`, `accepted-active`, `rejected`, `malformed`;
- bounded tab-scoped/reopened Start diagnostics;
- package hash unchanged;
- zero provider requests;
- zero ChatGPT POST attempts;
- zero DB/catalog mutation.

It does **not** claim LIVE_OWNER, ordinary live ChatGPT login/answer, provider useful flow, store-catalog install or deployment.

Chrome signed-out exact STORE:

`/root/octoport-control/logs/A/store0211-browser-matrix-r1/chrome-signedout.json`

SHA-256:
`38fb4815dbb68e5c04e9fe1cd1eac5137f37c165f0d9e59defccfcf6ee9301da`.

Yandex signed-out exact STORE:

`/root/octoport-control/logs/A/store0211-browser-matrix-r1/yandex-signedout.json`

SHA-256:
`77687be756777e8d62efcb6dd9b8dc3a137ecbb55d617facff2d5e2d6805c91b`.

Both exact Chromium-store signed-out snapshots enumerate the popup controls and prove that ordinary auth-dependent catalog/work/transfer/backup controls remain hidden while signed out. They do not prove those hidden actions.

Firefox exact STORE consent:

`/root/octoport-control/logs/A/store0211-browser-matrix-r1/firefox-consent.json`

SHA-256:
`f5aa5e3afd19a72150531d3478d93b2ab9debe0031cdfb8c0460297d1b72cfdf`.

Evidence level:
`INSTALLED_SYNTHETIC_EXACT_FIREFOX_STORE_SIGNED_OUT`.

It proves real visible Firefox permission UI Deny/Allow plus extension Revoke for the technical-data consent boundary, with permission-state injection excluded.

Combined browser-matrix summary:

`/root/octoport-control/logs/A/store0211-browser-matrix-r1/browser-matrix-summary.json`

SHA-256:
`e22a0ab0e54a819a39f8d2cab6bc9cee2f129ddfc84cf5f761006a5d252a0f0b`.

## Exact 30-button disposition

The machine-readable full row set is:

`/root/octoport-control/logs/C/c06-store0211-control-matrix-20261001/control-matrix.json`

SHA-256:

`39e3da463d2298df5e8811d5821660680ee3ccb80e8f31403cfdca0122620865`.

All 30 buttons are structurally present and bound in exact STORE bytes.

### Auth

| Buttons | Exact installed evidence | Disposition |
| --- | --- | --- |
| `auth-start` | Chrome/Yandex exact STORE signed-out: visible/enabled. Existing evidence explicitly does not click it. | **EXACT VISIBILITY PASS / ORDINARY AUTH ACTION OPEN** |
| `auth-open`, `auth-cancel`, `auth-reset` | Exact STORE signed-out state proves these are gated by pending/auth state; handlers exist in frozen bytes. | **STATIC + INSTALLED STATE PASS / ACTION OPEN** |

### Firefox technical consent

| Buttons | Exact installed evidence | Disposition |
| --- | --- | --- |
| `firefox-technical-grant`, `firefox-technical-revoke` | Exact Firefox `0.2.11`, Firefox 155: real visible Deny/Allow and extension Revoke, privacy-safe support evidence. | **EXACT INSTALLED ACTION PASS at signed-out consent boundary** |

Authenticated Firefox catalog/work actions remain a separate open gate.

### Marketplace and store CRUD

| Buttons | Exact installed evidence | Disposition |
| --- | --- | --- |
| `ozon`, `wildberries` | Exact handlers; signed-out Chrome/Yandex state keeps catalog hidden. | **STATIC + GATING PASS / AUTHENTICATED ACTION OPEN** |
| `add`, `edit`, `remove`, `save`, `cancel` | Exact handlers/form binding; Opera native popup has exact edit-open/edit-closed layout evidence, but this is not a store CRUD functional result. | **EXACT STRUCTURE/LAYOUT PASS / AUTHENTICATED CRUD ACTION OPEN** |

The exact STORE package contains the expected store fields and `stores` select binding, but field presence is not a successful CRUD action.

### Credential checks

| Buttons | Exact installed evidence | Disposition |
| --- | --- | --- |
| `check-seller`, `check-performance`, `check-token` | Frozen handlers exist; exact signed-out snapshots keep them behind ordinary auth/store state. | **STATIC + GATING PASS / REAL READ-ONLY BUTTON EXECUTION OPEN** |

Historical/direct provider authorization checks do not substitute for clicking these exact installed popup buttons.

### Work

| Buttons | Exact installed evidence | Disposition |
| --- | --- | --- |
| `start` | Exact Opera STORE installed-synthetic Start UX/diagnostic run proves accepted-pending, accepted-active, rejected and malformed response handling with one Start call per case and zero external/provider attempts. | **EXACT INSTALLED SYNTHETIC ACTION PASS for Start UX/diagnostics / ORDINARY AUTHENTICATED USEFUL START OPEN** |
| `work-resume`, `visibility`, `finish`, `resume` | Frozen handlers exist; signed-out exact STORE snapshots keep them unavailable. Other source/local-development/historical regressions remain separate evidence. | **STATIC + GATING PASS / EXACT AUTHENTICATED ACTION OPEN** |

The current Start PASS must not be read as proof of a real ChatGPT answer, real marketplace result, LIVE_OWNER usefulness or full Work lifecycle.

### Transfer

| Buttons | Exact installed evidence | Disposition |
| --- | --- | --- |
| `transfer-create`, `transfer-discover`, `transfer-receive` | Frozen handlers exist; exact signed-out STORE snapshots keep transfer gated. Earlier installed-synthetic transfer/restart evidence belongs to other exact artifacts/test boundaries. | **STATIC + GATING PASS / EXACT AUTHENTICATED STORE ACTION OPEN** |

### Backup

| Buttons | Exact installed evidence | Disposition |
| --- | --- | --- |
| `backup-export`, `backup-preview`, `backup-import` | Frozen handlers exist; exact signed-out STORE snapshots keep backup gated. Source/package backup regressions exist, but exact authenticated installed 0.2.11 actions are not established. | **STATIC + GATING PASS / EXACT AUTHENTICATED STORE ACTION OPEN** |

### Diagnostics

| Button | Exact installed evidence | Disposition |
| --- | --- | --- |
| `support-generate` | Exact signed-out Chromium STORE support snapshots in Chrome/Yandex; privacy flags false, external requests empty. | **EXACT INSTALLED SIGNED-OUT ACTION PASS** |

### Confirmation

| Buttons | Exact installed evidence | Disposition |
| --- | --- | --- |
| `confirm`, `reject` | Exact frozen handlers exist; signed-out exact STORE states keep the relevant catalog/work transition unavailable. | **STATIC + GATING PASS / EXACT AUTHENTICATED REBIND ACTION OPEN** |

## Current count and interpretation

The exact package contains **30/30 structurally bound buttons**.

Buttons with some exact installed **action** evidence:

1. `support-generate` — signed-out exact Chromium STORE;
2. `firefox-technical-grant` — exact Firefox signed-out consent boundary;
3. `firefox-technical-revoke` — exact Firefox signed-out consent boundary;
4. `start` — exact Opera installed-synthetic Start UX/diagnostic boundary.

This count is deliberately not called “4 buttons fully accepted” because the boundaries differ.

For the ordinary signed-auth / live owner matrix, **27 buttons still have an action gate open**. This set includes `start`: its narrower synthetic UX/diagnostic action PASS does not replace an ordinary authenticated useful-flow Start.

The three buttons not requiring that ordinary authenticated/live action gate for their already-tested purpose are:

- `support-generate`;
- `firefox-technical-grant`;
- `firefox-technical-revoke`.

## What one ordinary owner/reviewer run can close

After a legitimate ordinary signed login and compatible backend/profile state, the remaining exact Opera control matrix can be exercised in one bounded sequence without changing package bytes:

1. auth transition and pending controls where applicable;
2. Ozon/WB marketplace switch;
3. store add/edit/cancel/save/remove;
4. Seller/Performance/WB read-only credential-check buttons;
5. Start, Resume, visibility, Finish and quota-resume states that become applicable;
6. transfer UI;
7. backup export/preview/import;
8. confirmation/reject rebind path;
9. one bounded useful read-only provider flow followed by explicit Finish.

The exact action sequence must still obey existing safety rules: no provider retry after unknown/ambiguous outcome, no secret values in evidence, and no hidden-state injection to manufacture availability.

## Evidence boundaries

This reconciliation does not use the LOCAL DEVELOPMENT R15 package as exact STORE `0.2.11` action evidence.

It also does not relabel historical STORE `0.2.6` button evidence as `0.2.11`.

No auth intent, provider call, marketplace mutation, DB/catalog mutation, package rebuild, store upload or deployment was performed by this task.

Overall result:

**Exact STORE 0.2.11 popup structure is complete and internally bound; the remaining “all buttons tested” gap is now finite and explicit rather than generic. Ordinary authenticated/live execution remains required for the 27 action gates listed above.**
