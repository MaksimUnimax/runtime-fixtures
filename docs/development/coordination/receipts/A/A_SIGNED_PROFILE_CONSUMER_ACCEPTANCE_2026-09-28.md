# A — signed AI profile consumer acceptance — 2026-09-28

Status: **SOURCE + EXTRACTED PACKAGE PASS / CONTROLLED MV3 WIRED PASS / INSTALLED+LIVE OPEN**

Task: `A_SIGNED_PROFILE_CONSUMER`.

## Canonical contract authority

A implements the exact shared consumer contract chain authored by controller and
integrated by C:

- `62da3d71c6c378ed17314851036efb5d9f84fc0d` — signed profile request/response/receipt
  boundary and canonical `adapter_profile_v1` schemas;
- `555452f8fa59a0006c25d164afc779569ef93c46` — required semantic follow-up binding
  selector slot -> strategy/reference and contour key -> strategy.

C intake:
`docs/development/coordination/receipts/C/C_PROFILE_CONTRACT_HELPER_INTAKE_2026-09-28.md`.

A preflight:
`b844f3cd6c554d3a9df95e6a1f7b6c841c7e9b8d`.

The consumer does not add a bootstrap/signature format, server endpoint, remote executable
patch channel, CSS/XPath/URL selector language, DB change, provider call or deployment
authority.

## Implemented browser boundary

Worker side uses the existing verified `SellerAgentsControlClient` authority only.

The content request:
- uses `signed_ai_profile_consumer_v1`;
- carries a fresh UUID and detected AI scope;
- is accepted only from the extension itself, top frame, browser-provided document
  identity and supported ChatGPT origin;
- never trusts caller-supplied tab/origin identity.

Worker response:
- captures one current verified authority;
- requires current Work permission;
- requires exact ChatGPT/web/null scope for this first consumer;
- validates full signed profile material and canonical `{content, compatibility}`
  fingerprint;
- rechecks auth generation, authority identity and bootstrap snapshot after asynchronous
  validation immediately before AVAILABLE;
- returns bounded UNAVAILABLE rather than stale material.

Alice is intentionally `PROFILE_UNSUPPORTED` until a separate behavioral acceptance.

Content side stores applied profile state only in memory. It mirrors the strict shared
schema and resolves only packaged symbolic behavior:
- conversation-root;
- composer-root;
- send-control;
- assistant-response.

Busy and Copy remain packaged behavior as required by the shared contract. No signed
profile can introduce arbitrary CSS, JavaScript, URLs or executable text.

## Runtime lifecycle and no-replay fences

Starting a new profile request invalidates the previous pending request. Navigation/scope
change/teardown invalidates pending work and clears the old applied profile.

Same-generation signed profile changes are surfaced by the existing control client as
`profile_changed` without terminating already-authorized active Work.

Profile application is fail-closed:
- stale/out-of-order response cannot apply or clear a newer profile;
- asynchronous profile fingerprint validation is fenced by request epoch/scope;
- asynchronous receipt ACK is fenced by the same request instance;
- old `ensure()` completion cannot clear a newer applied profile;
- dispose/revocation while ACK is pending cannot resurrect old state;
- verified lower revision rollback is allowed only under a fresh current authority;
- UNAVAILABLE clears the current profile only when the corresponding request is still
  current.

Active Work never hot-switches profile configuration. A fresh signed candidate receives
`DEFERRED / WORK_IN_FLIGHT`. After Finish the content runtime obtains a fresh response
rather than activating a saved deferred candidate.

Before irreversible Work Start or Resume, the worker requires
`OZ_SIGNED_AI_PROFILE_ENSURE` to match the exact already-admitted:
- auth generation;
- bootstrap snapshot SHA;
- profile key;
- revision;
- scope variant;
- profile content SHA.

The worker then performs its existing admission-context recheck again before delegating
to legacy Start/Resume. A failed/mismatched ensure never reaches the legacy irreversible
action.

Pending Work-start provenance independently rechecks the same exact signed profile
identity before prompt dispatch.

Profile request/application/receipt handling itself does not initiate a provider request,
Work action, send, replay or marketplace operation.

## Conversation selector completion

Independent review identified that the initial candidate validated/exported the
`conversation` slot without consuming it.

The final consumer closes that gap without changing trusted URL/conversation identity:
the packaged bridge supplies the existing DOM conversation region
(`main`, then body/document fallback), and the signed conversation primitive may only
accept/reject that packaged root. Assistant and user message lists are scoped to that
root. A valid accessibility-role profile that does not match the packaged root produces
an empty message region rather than falling back to unrestricted DOM behavior.

## Focused contract/lifecycle validation

Final rework focused supervisor:
`/root/octoport-control/resource-jobs/774669b8ef3c4c7681613f1702acef1f/receipt.json`.

Result:
- SOURCE worker contract/lifecycle: 8/8 PASS;
- EXTRACTED worker contract/lifecycle: 8/8 PASS;
- SOURCE content lifecycle: 10/10 PASS;
- EXTRACTED content lifecycle: 10/10 PASS;
- live provider calls: 0;
- installed acceptance: false;
- supervisor exit 0;
- OOM 0;
- cleanup verified;
- peak 90,177,536 bytes.

Worker cases include:
- strict mirror/cross-field rejects;
- current-authority request/receipt and Alice hold;
- revoked/expired authority rejection;
- worker restart requires fresh request;
- authority loss during final request validation;
- pending Start provenance exact-profile recheck;
- authority loss during receipt validation;
- end-to-end failed profile ensure blocking both Start and Resume before legacy action.

Content lifecycle cases include:
- same-generation update, Work defer, rollback and clear;
- out-of-order reply;
- invalid profile and ensure mismatch;
- document reload;
- ChatGPT -> Alice scope change;
- newer request during delayed fingerprint validation;
- delayed old ensure ACK vs newer bootstrap/profile;
- dispose during ACK;
- revocation during old ACK;
- conversation-slot packaged DOM scoping.

Focused result SHA-256:
- worker SOURCE/EXTRACTED:
  `b6273f3bed2175da30b6f0631aa013ddd49c0a5ff8c76f188c3e84f6ff2ee421`;
- content SOURCE/EXTRACTED:
  `78a026fd8cd0f2dcb418c0aea54ea2c6386e17ea6780e3749d6278f7dd26d98e`.

## Controlled real MV3 behavior

Final controlled browser supervisor:
`/root/octoport-control/resource-jobs/4df07ad34535493999b7ee566a56196c/receipt.json`.

A fresh ephemeral Ed25519 test key was generated with the repository's
`make-browser-config.mjs`, included only in a LOCAL_DEVELOPMENT test build, and removed
by the supervised job cleanup.

SOURCE and EXTRACTED both report:
- `CONTROLLED_SYNTHETIC_REAL_MV3_CONTENT_SCRIPT`;
- disposition `WIRED`;
- signed authority verified;
- authenticated/workAllowed test authority true;
- profile ensure applied;
- baseline packaged composer profile allows the picker behavior;
- second valid accessibility-role profile changes packaged composer behavior and blocks
  that picker;
- sent count 0;
- live provider calls 0;
- installed acceptance false.

Result SHA-256:
- SOURCE:
  `f0e9e69933ba0982d9d26272bc17306a30b3ad57b47f4102dac17b58545d5789`;
- EXTRACTED:
  `9783aed1fd407111950c081d900b9bf185212127538daa1a3df39bd07827ccb5`.

Supervisor exit 0, OOM 0, cleanup verified, peak 334,495,744 bytes.

## Full extension-core acceptance

Final full supervisor:
`/root/octoport-control/resource-jobs/523abee6f8a14d748edea026b96bdd6b/receipt.json`.

Summary:
`/tmp/a-profile-consumer-full-reviewfix/summary.json`.

Summary SHA-256:
`e7168019d0a16a2bec45a7b04690dac4b0f99e267deb2216603174d7d69ff8de`.

Result:
- stage `D2.4`;
- status PASS;
- gate processes: **139**;
- Node `v24.20.0`;
- live provider calls: 0;
- installed acceptance: false;
- repeat archive identity: PASS;
- SOURCE/EXTRACTED byte identity: PASS;
- local-development package SHA-256:
  `d1fe63e67bc2c8c380c66a7739c9b35b45ff70933fa18dfbd12be02da0e8d58a`;
- supervisor exit 0;
- OOM 0;
- cleanup verified;
- peak 170,917,888 bytes.

The built profile runtime SHA-256 at this boundary is
`c65d119419f94c2a609f70c285d377bdf018dca644585bafe8ff2a5aca050540`.

## Independent reviews

First independent read-only Codex review used exact local checkpoint
`a79b57b2a41f9a24f9b20a646661b8fcd3993645`, model `gpt-6-luna`, and returned
`REWORK_REQUIRED` for two P2 findings:

1. conversation selector slot was validated/exported but not consumed;
2. failed profile ensure lacked an end-to-end Start/Resume negative test.

The review explicitly found no trust-boundary or no-replay defect.

A fixed both findings in local rework commit
`fa2b73c7f29a35a6eb0da31c462dbbc7f0c80404`.

A second independent read-only `gpt-6-luna` review on exact `fa2b73c7...`
returned **PASS**:
- both prior P2 findings closed;
- no new trust/no-replay blocker;
- no files changed by the reviewer.

Review artifacts:
- `/root/octoport-control/logs/A/profile-consumer-final-review-20260928-result.md`;
- `/root/octoport-control/logs/A/profile-consumer-p2-review-20260928-result.md`.

## Fresh-main reconciliation

After review, A fetched and merged accepted
`origin/main=c2e715501161d421b1641bb697c7ee7786d84960`
normally on a clean boundary.

Merge commit before this receipt:
`ea0a67f69f92a8f87c7d4ab9ee6e5531992dbc4b`.

The accepted main delta contains the integrated canonical shared contract chain,
controller owner-helper fix and monitoring/health work.

Exact tree comparison from `fa2b73c7...` to the merged tree shows **no change** in:
- `apps/extension/**`;
- `packages/control-client/**`;
- `packages/ai-adapters/**`;
- `packages/browser-platform/**`;
- `packages/marketplaces/**`;
- extension build scripts.

The only A-relevant main-only test boundary was the previously accepted owner helper
guard. A reran:
`python3 tests/regression/extension-core/client-i1/test-exact-store-helper-guards.py`
and obtained **12/12 PASS** plus Python compilation PASS.

Therefore the profile-consumer SOURCE/PACKAGE bytes accepted above are unchanged by the
fresh-main merge; repeating the 139-gate suite after that merge would not exercise
different profile-consumer product bytes.

## Evidence boundary / remaining work

This receipt establishes:
- SOURCE signed-profile consumer acceptance;
- EXTRACTED PACKAGE equivalence and acceptance;
- controlled synthetic real-MV3 content-script behavior.

It does **not** establish:
- installed STORE-channel profile behavior;
- LIVE_OWNER authenticated monitoring repair;
- live ChatGPT monitoring recovery;
- operator approval/deployment;
- production assignment;
- Alice profile consumer;
- store publication/reviewer approval.

Alice remains `PROFILE_UNSUPPORTED` by design for this boundary.
Installed owner/authenticated validation remains on the separate owner-test roadmap.
