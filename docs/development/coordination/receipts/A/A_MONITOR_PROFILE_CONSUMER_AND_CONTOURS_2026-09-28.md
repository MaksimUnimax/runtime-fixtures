# A — signed profile consumer and ChatGPT contour mapping — 2026-09-28

Status: **P7 SIGNED PROFILE DOM CONSUMER = NOT_WIRED / SOURCE+EXTRACTED PROOF PASS**

Task: `A_MONITOR_PROFILE_CONSUMER_AND_CONTOURS`.

Authority:
- controller notice `A-MONITORING-REPAIR-ARCHITECTURE-20260928-0407`;
- architecture commit `15ca964e56dba9230f520e67a919d5b1136bb847`;
- `MONITORING_REPAIR_ARCHITECTURE_2026-09-28.md`.

This receipt does not redesign P7 or create a second patch system. It determines the
actual current client path and the smallest missing consumer boundary.

## Exact controlled package used for executable proof

Source commit: `57c696003f9e603628fc16eecd5f34c6ef73b5bc`.
Source tree: `b318b1871ecaf8ae8aa7a8ffc03226f47f977c51`.

A built one local-development package from those exact tracked source bytes with an
ephemeral test trust bundle only.

Package:
- version `0.2.6`;
- archive `SELLER_AGENTS_I1_C1_v0.2.6_LOCAL_DEVELOPMENT.zip`;
- SHA-256 `6f4c0e75641d497367adf7d726afdb0064c9bbf90636d4bbb7ed640c80f060fa`;
- repeat archive identity PASS;
- source/extracted byte identity PASS.

The temporary fixture private key existed only under `/tmp`, was never written to Git
or evidence, and was removed after the browser proof.

## Static data-flow result

`packages/control-client/src/client.js` already validates the full
`adapter_profile_v1`:
- exact profile/content/compatibility shape;
- bounded selector primitive vocabulary;
- browser/extension compatibility;
- SHA-256 fingerprint over `{content, compatibility}`;
- signed bootstrap envelope.

Therefore P7 storage/signature/schema validation already exists.

The consumer path stops there.

`apps/extension/src/application/runtime.js` reads only:
- profileKey;
- revision;
- scopeVariant;
- contentSha256.

Those identity fields are pinned into admission/rebind/dispatch fences and provenance.
No `profile.content` or selector primitive is applied to page DOM.

A product-code search found no P7 `profile.content` read in the extension DOM runtime.
There is also no content-script message carrying signed P7 selector content.

Current ChatGPT DOM behavior instead comes from packaged functions in:
- `shared/ai_adapters.js`;
- `content_script.js`;
- build-time `application-patches.json`.

These use packaged/hard-coded ChatGPT DOM knowledge.

The existing `OZ_SET_SEND_BUTTON_PROFILE`, `OZ_SET_MICROPHONE_BUTTON_PROFILE` and
`OZ_SET_COPY_BUTTON_PROFILES` path is a separate local/manual learned-fingerprint
mechanism:
- records are written by the extension itself;
- worker broadcasts them to content scripts;
- they are not P7 `adapter_profile_v1` content;
- they do not prove signed remote-profile application.

`application-patches.json` remains build-time input only and is not a remote patch
channel.

## Executable NOT_WIRED proof

A added a focused real-MV3 content-script regression:
`tests/regression/extension-core/client-i1/profile-dom-consumer.py`.

It reuses the existing signed-authority fixture helper and does not create a second
signing or selector architecture.

For each candidate runtime the test starts two independent fresh browser profiles.

Baseline signed profile:
- revision `1`;
- composer primary reference `composer-root`;
- content SHA-256
  `a6f8c8b7b2f8811f33b334343a66ac3d924d0759225ed718d6bffbf6788b7155`.

Changed signed profile:
- revision `2`;
- composer primary reference `page-root`;
- content SHA-256
  `d752a52a068aab1988fbd693a6608d594eb8f02c5a9b624b0dc0564e4cbc7caa`.

Both envelopes verify with the packaged fixture trust bundle.
After a browser restart, `SellerAgentsControlClient` reports both profiles authenticated
and work-allowed and returns the expected signed revision/hash/reference.

The observable DOM operation is the real content-script
`OZ_START_SEND_BUTTON_PICKER` path:
- it resolves `primaryComposerContext()`;
- writes the non-sending `BRIDGE_BUTTON_TEST` marker into the detected composer;
- sends no chat message.

Observed for **both** different signed profiles:
- adapter: `chatgpt`;
- picker: PASS;
- same composer selected;
- same exact marker inserted;
- `sentCount=0`.

Thus changing a valid signed selector reference and its signed hash/revision has no
observable effect on the current DOM consumer.

Disposition: **NOT_WIRED**.

Proof results:
- SOURCE runtime: PASS / `NOT_WIRED`;
- EXTRACTED package: PASS / `NOT_WIRED`;
- live provider calls: `0`;
- installed acceptance: `false`.

Source result SHA-256:
`8efaead99e78b4adfbd84a5ff3971d7abed5db6b1369abdfbbdb7c3da19344ba`.

Extracted result SHA-256:
`c5b0eabac7af048153da378d9d16a1f9da1d35c2a0d8b61bf20a333665a2d535`.

Resource receipt:
`/root/octoport-control/resource-jobs/dbc6f16debe44b759b0f29aa597c635b/receipt.json`.

Supervisor exit 0, OOM 0, cleanup verified, peak 326107136 bytes.

## Current ChatGPT Standard / Work contour map

### Page identity

Runtime:
- `conversationIdentity()`;
- `conversationKeyFromLocation()`;
- `BB2ConversationIdentity`.

Positive:
- supported ChatGPT origin + confirmed conversation path produces ChatGPT identity/key.

Negative:
- missing/changed conversation identity is rejected by Work/watch/recovery fences.

P7 status:
- packaged identity strategy only; no current remote DOM selector application.

### Conversation / assistant ownership

Runtime:
- `OzonAIAdapters.CHATGPT.assistantMessages()`;
- patched `chatgptMessages(role)`;
- `messageId()` / `messageText()`.

Positive:
- explicit assistant role markers;
- current unmarked assistant wrapper proven by one Response-actions group plus assistant content.

Negative:
- user turns;
- nested-user ambiguity;
- unrelated actions;
- multiple ambiguous Response-actions groups.

Existing evidence:
- `chatgpt-dom-compat.py`;
- native `browser_application.py`.

### Composer / input

Runtime:
- `primaryComposerContext()`;
- `chatgptPrimaryComposerContext()`;
- packaged adapter `chatgptComposerContext()`.

Positive:
- visible prompt textarea/contenteditable inside the current form.

Negative:
- assistant editor/writing-block context;
- missing composer;
- ambiguous/non-current surface.

Work-specific evidence:
- `BR-C1-37`: delayed composer becomes visible and Work Start waits correctly;
- `BR-C1-38`: never-ready composer fails closed within the bounded wait.

P7 status: selector slot exists, but it is currently **not consumed**.

### Send / ready control

Runtime:
- `chatgptWorkSubmitButton()`;
- `chatgptRecognizedSendControl()`;
- `chatgptSendButtonCandidates()`;
- `chatgptSendButton()`;
- `classifyChatgptComposerControl()`.

Work-specific positive:
- exact `button#composer-submit-button[data-testid="send-button"]` wins when present.

Standard/fallback positive:
- one unambiguous enabled send control by packaged testid/text/type scoring.

Negative:
- stop/cancel controls;
- microphone control;
- disabled or ambiguous controls.

P7 status: selector slot exists, but it is currently **not consumed**.

### Busy / stop / completion

Runtime:
- `chatgptStopButton()`;
- adapter `isGenerating()`;
- adapter `messageComplete()`;
- content `assistantTurnComplete()`.

Positive busy:
- recognized stop control or packaged `[aria-busy="true"]`.

Positive completion:
- connected assistant response with text and no generating state.

Negative:
- generating/busy response is not complete;
- missing/disconnected assistant is not complete.

P7 status:
- `busy_state` is an allowed contour key, but v1 has no dedicated busy selector slot.
- current behavior is packaged-only unless C versions/extends the shared profile contract.

### Command / code surface and owned Copy

Runtime:
- `chatgptCodeCopyButtons()`;
- `chatgptCopyOwnedBlock()`;
- adapter `findCodeBlocks()`;
- adapter `readCodeText()`;
- content block binding/extraction.

Positive:
- real code Copy + one owned code surface;
- fenced `pre > code` fallback;
- writing-block / CodeMirror / legacy viewer surfaces;
- localized Copy controls.

Negative:
- Response-actions Copy is explicitly excluded before positive Copy matching;
- misleading `data-code-copy-state` inside Response actions remains excluded;
- user/editor/ambiguous/unrelated containers are rejected.

Existing source + native browser regression already covers these cases.

### Delivery insertion / irreversible send boundary

Runtime:
- `setComposerText()`;
- stable send-target resolution;
- `clickComposerUntilEmpty()`;
- Work Start commit/outcome handshake;
- attachment surface and binary delivery path.

Positive:
- exact text is inserted and one intended send is observed;
- native binary File/IndexedDB/port delivery remains one-shot.

Negative:
- other unsent composer text blocks insertion;
- context/identity drift fails closed;
- committed/unknown outcome forbids automatic replay;
- hidden/finished Work removes execution affordance.

Existing `browser_application.py`, BR-C1 and no-replay regressions cover this boundary.

## Minimal shared consumer contract required from C

A can implement the missing client consumer after C authors the shared contract.

Required source of truth:
1. only `SellerAgentsControlClient` verified authority;
2. exact current profile identity `profileKey/revision/scopeVariant/contentSha256`;
3. the already-validated `adapter_profile_v1.content`;
4. current auth generation / detected AI family+surface+variant.

Required worker→content boundary:
- one bounded profile-apply message owned by the shared contract;
- profile identity plus validated profile content;
- no raw CSS selectors, JavaScript, URLs, headers or executable text;
- stale generation/profile identity rejected;
- unknown keys/kinds/references rejected fail-closed.

A must not invent this as an extension-private wire format.

Required content-script semantics:
- map only the existing bounded primitive enums to packaged resolver functions;
- evaluate primary then bounded fallbacks in profile order;
- obey bounded timeout/observation values;
- keep profile identity pinned for an in-flight Work/send/delivery operation;
- do not hot-switch selector semantics across an irreversible click;
- a newer verified profile takes effect only at a defined safe boundary;
- rollback is another verified assignment to a known profile revision, not arbitrary script.

Existing `adapter_profile_v1` has exactly four selector slots:
- conversation;
- composer;
- send;
- assistantResponse.

It does **not** contain dedicated busy/copy selector slots.
Therefore A must not silently add remote busy/copy selectors under v1.
If C requires those to be remotely selectable, C must version/extend the shared schema
with both server/client compatibility tests. Otherwise busy/copy stay packaged contours.

Proposed payload shape for C to formalize (names/version are not authoritative until C):
```text
messageType: OZ_APPLY_SIGNED_AI_PROFILE   # proposed
authGeneration: positive integer
ai:
  family: chatgpt | alice
  surface: web
  variant: null
profile:
  profileKey: machine id
  revision: positive integer
  scopeVariant: null
  contentSha256: lowercase hex64
  content: exact existing adapter_profile_v1 content
```

The content-script acknowledgement must echo the applied profile identity, not the raw
profile bytes, so worker/application code can fence Work against the exact applied
revision/hash without persisting duplicated remote configuration.

## Acceptance required after C shared contract

A's smallest implementation boundary after C handoff is:
1. worker reads only current verified authority;
2. worker pushes the bounded profile contract to the matching AI tab;
3. content script resolves the four v1 selector slots through packaged primitives;
4. actual Standard/Work contour operations use that resolved profile;
5. safe profile replacement/rollback is fenced by generation + profile identity.

Required regression:
- valid signed profile change produces one specific DOM behavior change;
- stale/invalid/unknown profile fails closed;
- source and extracted package match;
- existing ChatGPT Copy/Response-actions, Work composer wait, no-replay and delivery tests stay green.

Only after that can profile-only compatibility delivery move beyond
`NOT_IMPLEMENTED_END_TO_END`.

## Evidence boundary

This task establishes:
- SOURCE mapping;
- controlled signed-bootstrap browser proof;
- extracted-package behavioral parity;
- precise current disposition `NOT_WIRED`.

It does **not** claim:
- installed-store profile application;
- authenticated ChatGPT Standard or Work live acceptance;
- live provider/marketplace behavior;
- production monitor repair;
- profile-only rollout/rollback acceptance.

No live AI send, marketplace request, deployment, DB mutation, store action or production
configuration change was performed.
