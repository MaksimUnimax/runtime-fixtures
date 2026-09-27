# C06 WB token-policy reconciliation — 2026-09-25

Status: CANDIDATE / DOCUMENTATION-ONLY / NOT LIVE / NOT DEPLOYED

Accepted base:
`a7097321410921f2fffa54fc3ecf1bc17963c0c2`.

Purpose:
close the stale readiness statement that current official WB token applicability was unknown, without changing the accepted Personal-token runtime or claiming cloud/service authorization.

Official primary source re-checked 2026-09-25:
- seller token creation guide: https://seller.wildberries.ru/instructions/ru/ru/material/how-to-create-update-or-delete-a-wb-api-token

This readiness closure intentionally depends only on the seller guide that was directly retrievable in independent review. Developer-site details that the child sandbox could not retrieve are not required as normative evidence for this bounded conclusion.

## Current official boundary

- WB tokens expire after 180 days.
- Personal token is for seller-owned/self-developed or on-premise/local systems on the seller's own or rented infrastructure.
- Service token is for a specific cloud service from the official solutions catalog.
- Base token is for real-data testing or cases where Personal/Service do not fit.
- Test token is sandbox-only and has no real seller data.
- Read-only access should be selected when a scenario does not require writes.

Current beta direct-local scope therefore remains Personal-token-only. Service/Base/OAuth are not silently accepted as equivalent credentials.

## Source/runtime consistency

The accepted WB credential module:
- accepts `tokenType: personal`;
- emits `Authorization: Bearer <token>`;
- emits no `X-Client-Secret`;
- rejects `service`, `base` and `test` token types with `UNSUPPORTED_TOKEN_TYPE`.

The extension popup is explicitly labelled `Personal token`, and application runtime normalizes saved WB credentials as `tokenType: "personal"`.

Executable source assertions on current main: PASS.

No extension, marketplace runtime, package-builder, B1, server, DB, migration or live-service path changes in this reconciliation.

## Remaining boundary

This closes only the stale uncertainty about the direct-local beta token type.

It does not accept:
- Service/Base/OAuth cloud-service operation;
- service registration or service-secret provisioning;
- optional encrypted cross-install relay as a provider-policy-approved Personal-token use;
- owner WB credentials, live values, category completeness or business gold set.

Those remain separate architecture/policy/live evidence gates if selected later.

## Independent review trail

First Luna read-only review:
- verdict: `not READY_TO_APPLY`;
- one Medium only: child sandbox could not independently retrieve two dev.wildberries.ru pages and therefore could not corroborate all external provenance claims;
- no finding on product boundary, overclaim, Service/Base/Test/OAuth support, relay policy, live/store/deployment evidence or documentation-only scope.

Correction:
- bounded readiness conclusion now relies only on the directly retrievable official seller.wildberries.ru token-creation guide;
- developer-site-only Bearer/service-secret details are not used as normative evidence for this closure;
- product/runtime behavior remains unchanged.

Second Luna read-only review:
- verdict: `READY_TO_APPLY`;
- prior Medium provenance finding: resolved;
- High: none;
- Medium: none;
- Low: none.

The review confirmed direct-local Personal-token scope only, no equivalent support claim for Service/Base/Test/OAuth, no provider-policy approval for optional encrypted relay, and no owner/live/store/deployment/business-value acceptance.
