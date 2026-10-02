# A04 Alice signed-profile consumer — 2026-10-01

Status: **SOURCE + EXTRACTED PACKAGE PASS / INSTALLED + LIVE ALICE OPEN / INDEPENDENT REVIEW PENDING**.

Task: `A04-ALICE-SIGNED-PROFILE-CONSUMER`.

Base before implementation: `961d4ed1e157b751017d9c6bfeffc52726856f05`.
Implementation commit before this receipt: `0dadc85d956a1f7f00e76b2d59eb93b300a72529`.

## Why this task exists

The accepted signed-profile consumer intentionally left Alice at
`PROFILE_UNSUPPORTED` until a separate behavioral acceptance even though:

- the packaged extension already contains the Alice web adapter;
- `ai.alice.web.adapter` is a packaged capability;
- the shared `signed_ai_profile_consumer_v1` schema already accepts
  `alice/web/null`;
- product architecture names ChatGPT and Alice as the initial packaged consumers.

The missing boundary was in extension behavior, not in the profile schema:
trusted profile origins/request admission were ChatGPT-only, profile refresh
broadcast reached only ChatGPT tabs, content application rejected every
non-ChatGPT AVAILABLE response, and irreversible Start/Resume skipped the
exact-profile ensure for every non-ChatGPT family.

## Product change

The existing signed-profile contract and profile content format are unchanged.

Worker behavior now:

- maps `chatgpt` only to `https://chatgpt.com` and
  `https://chat.openai.com`;
- maps `alice` only to `https://alice.yandex.ru`;
- validates sender extension/frame/document identity before using the
  family-specific browser-provided origin;
- requires tab identity, requested AI, detected AI and message scope to agree
  exactly on the same family/web/null tuple;
- uses the same verified authority, `canWork`, signed profile material,
  snapshot-current and receipt fences for Alice and ChatGPT;
- broadcasts profile refresh only to packaged ChatGPT/Alice web origins;
- requires exact applied signed-profile authority/profile before irreversible
  Start/Resume for both supported families;
- fails closed for an unknown future family rather than silently skipping the
  profile fence.

Content behavior now allows a valid Alice response through the same
apply/defer/fresh-revalidate/rollback/clear lifecycle already accepted for
ChatGPT. The signed profile still selects only packaged symbolic behavior.
Alice composer/send/attachment/message behavior remains the existing packaged
Alice adapter; this task does not introduce remote selectors, URLs,
JavaScript, executable text or new provider behavior.

## Test-only fixture extension

`tests/regression/extension-core/worker-harness.mjs` gained an opt-in
`aiFamily` fixture selector. The default remains `chatgpt`.

For Alice, the fixture generates a genuinely signed authority whose:

- `requestedAi`;
- signed payload `ai.detected`;
- cache binding;
- tab identity/origin/conversation identity

all say Alice consistently before signing. No test mutates signed fields after
signature creation to fake an Alice success.

A test hook for `chrome.tabs.query` proves the bounded profile-refresh target
set without browser/provider network access.

## Focused SOURCE / EXTRACTED behavior

The exact implementation bytes were composed once and the same two focused
gates ran on SOURCE and EXTRACTED package paths.

For each path:

- signed-profile worker contract: **9/9 PASS**;
- signed-profile content lifecycle: **11/11 PASS**;
- live provider calls: **0**;
- installed acceptance: **false**.

Added behavioral proof includes:

- Alice current-authority request returns AVAILABLE from the Alice origin;
- APPLIED receipt is accepted under the same current authority/profile fence;
- ChatGPT-origin Alice requests and Alice-origin ChatGPT requests are rejected;
- signed Alice authority presented under ChatGPT scope returns
  `AI_SCOPE_MISMATCH`;
- refresh broadcast includes only ChatGPT/ChatGPT-legacy/Alice packaged origins;
- failed exact-profile ensure blocks both Start and Resume for Alice exactly as
  for ChatGPT before legacy irreversible actions;
- content runtime applies a valid Alice profile;
- same-generation update, Work-in-flight defer, post-Finish fresh application,
  verified lower-revision rollback and authority revoke/clear work for Alice;
- no profile lifecycle case emits provider/work execution by itself.

## Full extension-core acceptance

Supervised result:

`/root/octoport-control/logs/A/a04-alice-signed-profile-consumer-20261001/extension-core-r1/summary.json`

Summary SHA-256:

`250c7f950608ba8e54ac667dead66adde9cec7534eb03b8f621205a3f16b174f`.

Resource receipt:

`/root/octoport-control/resource-jobs/914292c2402c42e4a7a257a4ce30cc0a/receipt.json`

Resource receipt SHA-256:

`c469c003ca83310a9e7f8e8f56d87aeceba0e4f3f316c162a7f065377c33683a`.

Result:

- stage `D2.4`;
- status **PASS**;
- Node `v24.20.0`;
- gate processes: **142**;
- SOURCE signed-profile consumer/runtime: PASS;
- EXTRACTED signed-profile consumer/runtime: PASS;
- live provider calls: **0**;
- installed acceptance: **false**;
- repeat archive identity: PASS;
- SOURCE/EXTRACTED byte identity: PASS;
- LOCAL DEVELOPMENT package SHA-256:
  `427f4a83db366064ef8abd05453711a4f6db991bccbd845a7fc682041f35c5cb`;
- supervisor exit 0;
- OOM kills 0;
- cleanup verified;
- peak supervised memory about 175 MiB.

The harness's `middle-failure` line is the expected negative control; the
overall run exited 0/PASS.

## Exact source identities

At the full-suite boundary:

- `apps/extension/src/application/runtime.js`:
  `ca86d2b77b1de21c9edd0481cfa066116704220faa525e27841c5d7cc6536195`;
- `apps/extension/src/content/signed-profile-runtime.js`:
  `b54eb9b217af10a13a512a11ef9cf82ecb9c13a8be355992cb53f5ebf7b13d25`;
- `signed-profile-consumer.mjs`:
  `4795e34db14a574ba17ac26c8d5cd326c0503cc1677682858d6e9af9d8c07d55`;
- `signed-profile-runtime.mjs`:
  `714edc71810f5584e77d0382f3528c50f55a02251a6a388abb13908817c1ffe2`;
- `worker-harness.mjs`:
  `789d33b102201c8d1bfb658e5a48d936e6a4322042130d9afe47fbd466c2dd3f`;
- architecture document:
  `3f864bd6d900421df8c371f8759aeda5a4a51c69897e3aa9beb3c69b683322d5`.

## Evidence boundary

This closes the deliberately deferred **SOURCE + EXTRACTED PACKAGE behavioral
consumer boundary for Alice**.

It does **not** establish:

- a published/assigned Alice profile revision in the server catalog;
- installed persistent-browser Alice acceptance;
- live `alice.yandex.ru` authenticated behavior;
- LIVE_OWNER semantic usefulness;
- provider/marketplace business execution;
- STORE/AMO publication or reviewer approval;
- live deployment or PRODUCTION assignment.

Those remain separate gates. Independent read-only `gpt-6-luna` review and
the normal governed publication route/exact-five-CI gates remain required
before this candidate can enter common `main`.
