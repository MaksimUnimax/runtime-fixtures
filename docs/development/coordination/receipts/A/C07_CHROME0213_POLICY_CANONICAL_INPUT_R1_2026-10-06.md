# C07 — Chrome 0.2.13 policy canonical input R1 — 2026-10-06

## Scope

Source-only binding for the repaired Chrome `0.2.13` artifact
`7d12ddcbd82e18e26885c94f6a02e512dbade2c57b7e89ac9444dcbe0cac8cf4`.
No live catalog, DB, service, browser, authentication, deployment or production
mutation is performed by this result.

## Accepted browser minimum input

The predecessor decision task
`C07-CHROME0213-POLICY-MINIMUM-DECISION-R1-20261006` is strict-DONE after an
independent `gpt-6-luna` review returned PASS with P0/P1/P2 empty. The accepted
Chrome-only source floor is major version `147`, based on exact installed Chrome
`147.0.7727.116` evidence for the repaired package. It does not claim empirical
support for every future Chrome version.

The Chrome canonical policy input is therefore:

- policy key `store1.chrome.v2`;
- contract `control_plane_v2`;
- browser family `chrome`;
- minimum/recommended extension `0.2.13`;
- minimum browser `147`;
- maintenance disabled;
- no blocked extension versions.

Persisted revision/id/timestamp/admin/signing authority remains dynamic and is
explicitly excluded. Catalog mutation and live publication remain unauthorized.

## Profile/preflight binding

The historical multibrowser successor target remains unchanged for Chrome: it
still points at the historical `8d0664dd...` Chromium carrier and therefore keeps
Chrome minimum authority undecided. This prevents repaired-package authority from
being cross-bound to historical bytes.

The repaired-7d12 canonical target alone consumes the Chrome canonical minimum.
Its `chromeProfile` carries exactly `chrome >= 147` and
`browserMinimumDecisionRequired=false`, after verifying that the policy exact
artifact SHA matches the repaired Chrome artifact. Opera remains on its separately
accepted minimum `136`; Yandex Chromium and Firefox remain undecided.

The existing profile validator hashes both profile content and compatibility.
Therefore the Chrome profile fingerprint is recomputed from the existing
accepted DOM content plus Chrome-specific compatibility and remains distinct
from the Opera fingerprint. Artifact identities are unchanged: repaired Chrome
keeps `7d12ddcb...`, Opera/Yandex keep `8d0664dd...`, Firefox keeps
`b987ce3a...`.

## Focused verification

On exact base `c8dd58f3ee6cfb0ccef2841e9be47e7f8c17b7a7`:

- Chrome canonical-input tests: 4/4 PASS;
- multibrowser successor preflight tests: 20/20 PASS;
- combined focused total: 24/24 PASS;
- Prettier exact changed files: PASS;
- ESLint exact changed files: PASS;
- `tsc --noEmit -p packages/server/compatibility/tsconfig.json`: PASS;
- `git diff --check`: PASS.

The first focused attempts exposed implementation gaps rather than product evidence
failures. Independent peer review then found a P1 cross-binding risk: Chrome `147`
had been injected into the historical multibrowser target that still carried the
old Chrome `8d0664dd...` artifact. R2 keeps that historical target undecided and
binds `147` only inside the repaired-`7d12` path, with an exact policy/artifact SHA
identity guard and a distinct Chrome profile fingerprint. The regression suite now
proves historical `8d` remains undecided while repaired `7d12` carries `147`.

## Remaining gates

This result is SOURCE only. It does not satisfy migration58-compatible deployed
runtime, live exact-7d12 release/catalog/policy/profile publication/readback,
ordinary exact-ZIP authentication/workAllowed, LIVE_OWNER useful flow, browser
store moderation, deployment or production acceptance.
