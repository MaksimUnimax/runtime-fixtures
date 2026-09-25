# A04 WB Personal-token policy regression — 2026-09-25

Status: **SOURCE/PACKAGE REGRESSION COMPLETE; NO LIVE_OWNER/PROVIDER/DEPLOYMENT ACCEPTANCE CLAIMED.**

## Trigger

C residual readiness work rechecked current Wildberries token policy. The directly retrievable official WB seller token-creation guide, rechecked on 2026-09-25, distinguishes Personal tokens for own/local/on-premise integrations, Service tokens for official-catalog cloud services, Base tokens for real-data testing/other applicable cases, and Test tokens for sandbox, and states a 180-day token lifetime. The current Octoport beta remains the direct-local Personal-token path; Service/Base/Test/OAuth are not treated as equivalent credentials by this evidence or runtime.

Official primary source checked and directly retrievable in independent review:
- https://seller.wildberries.ru/instructions/ru/ru/material/how-to-create-update-or-delete-a-wb-api-token

The readiness conclusion intentionally does not rely on developer-site pages that were not independently retrievable during C review.

## Current runtime boundary

No runtime change was required.

Current composed WB credential code already:
- normalizes the supported token type to `personal`;
- rejects any non-`personal` `tokenType` with `UNSUPPORTED_TOKEN_TYPE`;
- rejects `clientSecret` / `X-Client-Secret` inputs with `CLIENT_SECRET_UNSUPPORTED_PERSONAL_BUILD`;
- emits `Authorization: Bearer <token>` and never emits `X-Client-Secret` for the current beta path.

## Regression added

`tests/regression/extension-core/application.mjs` now includes `APP-01b-WB-personal-token-policy-fails-closed`.

It proves, on the actual composed runtime used by the canonical core gate:
1. Personal token normalization succeeds.
2. Provider headers are Bearer-only and contain no `X-Client-Secret`.
3. `tokenType: service` fails closed as `UNSUPPORTED_TOKEN_TYPE`.
4. A supplied client secret fails closed as `CLIENT_SECRET_UNSUPPORTED_PERSONAL_BUILD`.
5. These policy checks cause zero provider calls.

The same application gate runs against source-composed and extracted/package runtimes.

## Verification

Command:

`python3 tooling/coordination/control.py A heavy -- env PATH=/root/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin python3 tooling/checks/extension_core.py --output /root/octoport-control/logs/A/wb-token-policy-20260925-r1-core`

Result:
- stage: `D2.4`
- status: `PASS`
- gate processes: `131`
- Node: `v24.20.0`
- source `application.mjs`: `PASS`
- extracted/package `application.mjs`: `PASS`
- live provider calls: `0`
- installed acceptance: `false`
- resource job exit: `0`
- peak memory: `176 MiB`
- cleanup verified: `true`
- the canonical `middle-failure` negative control remains the expected intentional failure and is not a product failure.

Evidence directory:
`/root/octoport-control/logs/A/wb-token-policy-20260925-r1-core`

## Boundary

This closes only a regression/evidence gap around the already-existing direct-local WB Personal-token implementation. It does not claim live WB credential validity, owner onboarding, Service/Base/OAuth support, cloud/catalog registration, cross-install credential-relay policy acceptance, store submission, deployment, or production acceptance.
