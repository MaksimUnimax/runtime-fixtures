# Q1-C One-Test-at-a-Time Owner Script

Work ID: `Q1-C0-20260921-OWNER-LIVE-ACCEPTANCE-PREPARATION`

The architect sends exactly one card below, waits for the owner's result, and
classifies it before sending another. Cards marked `ALREADY_ACCEPTED_AUTOMATED`
are not to be replayed manually unless a later safe live observation is
specifically requested. The script is preparation only; none of these cards
was executed while this file was created.

## Q1C-OTP-01 — real OTP, login, device, Bootstrap

- **PRECONDITION:** SMTP external gate is cleared; portal/API are healthy; the
  owner has one real mailbox.
- **ONE OWNER ACTION:** Complete the real portal OTP login flow: request the
  code, read it from the actual mailbox, enter it once, and continue through
  device activation and Bootstrap.
- **EXPECTED RESULT:** The real message arrives; login succeeds; one device is
  activated; signed Bootstrap succeeds.
- **EVIDENCE TO RETURN:** Destination domain, timestamps, remote acceptance,
  arrival latency/inbox-or-spam result, request IDs, safe account/device IDs;
  never the OTP.
- **PASS CONDITION:** All four outcomes above occur with no bypass.
- **FAIL CLASSIFICATION:** `FAIL_ENVIRONMENT`, `FAIL_PROVIDER`,
  `FAIL_PRODUCT`, or `FAIL_OWNER_DATA_UNAVAILABLE`.
- **SAFE NEXT STEP:** Stop and classify; do not request another OTP until the
  architect confirms cooldown/retry safety.

## Q1C-EXT-03 — extension authorization and device binding

- **PRECONDITION:** `Q1C-OTP-01` passed and the owner has the unchanged package.
- **ONE OWNER ACTION:** Open the owner extension and authorize it for the
  logged-in account.
- **EXPECTED RESULT:** The extension binds to the authenticated account/device
  without exposing a token or requiring a second auth system.
- **EVIDENCE TO RETURN:** Browser/version, package SHA, safe device ID, result
  class, timestamp.
- **PASS CONDITION:** Account binding succeeds and no secret is exposed.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` or `FAIL_BROWSER_ENVIRONMENT`.
- **SAFE NEXT STEP:** Reopen the extension once; do not reinstall blindly.

## Q1C-BS-04 — signed Bootstrap and reopen

- **PRECONDITION:** Extension authorization passed.
- **ONE OWNER ACTION:** Reopen the popup/dialogue and let it perform the normal
  Bootstrap check.
- **EXPECTED RESULT:** The current preprod trust identity is accepted and the
  account/device permissions are displayed without a payment prompt.
- **EVIDENCE TO RETURN:** Browser, safe trust key ID/fingerprint suffix if
  already displayed, safe capability/result class.
- **PASS CONDITION:** Bootstrap succeeds and free-beta permissions are intact.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` or `FAIL_ENVIRONMENT`.
- **SAFE NEXT STEP:** Stop before marketplace credentials if Bootstrap fails.

## Q1C-AUTH-02 — logout and re-login

- **PRECONDITION:** Bootstrap passed.
- **ONE OWNER ACTION:** Use the product Logout control, then sign in again via
  the already-proven real mailbox flow.
- **EXPECTED RESULT:** The old session is invalidated; re-login creates a valid
  session and does not create an unintended second device.
- **EVIDENCE TO RETURN:** Timestamp, browser, safe session/result class, safe
  device ID.
- **PASS CONDITION:** Stale privileged/auth state is not usable after logout.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` or `FAIL_ENVIRONMENT`.
- **SAFE NEXT STEP:** Keep the same profile; do not delete local state.

## Q1C-BETA-05 — free-beta UX

- **PRECONDITION:** A valid authenticated session.
- **ONE OWNER ACTION:** Open the normal account/extension screens and inspect
  the available access controls.
- **EXPECTED RESULT:** Free beta is active, with no checkout, payment request,
  commercial device denial, or unexpected plan UI.
- **EVIDENCE TO RETURN:** Redacted screenshot or safe result class only.
- **PASS CONDITION:** Current beta UX is unchanged.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Stop and report the exact unexpected control.

## Q1C-OZON-06 — Ozon store add

- **PRECONDITION:** Owner has a legitimate Ozon credential and safe label.
- **ONE OWNER ACTION:** Add and validate one Ozon store in the product UI.
- **EXPECTED RESULT:** Credential validation succeeds or the real provider
  returns an honest classified failure; the store label/binding is visible.
- **EVIDENCE TO RETURN:** Marketplace, safe label/store ID if allowed, result
  class, timestamp; no credential/token.
- **PASS CONDITION:** Store is added without credential leakage.
- **FAIL CLASSIFICATION:** `FAIL_PROVIDER`, `FAIL_PRODUCT`, or
  `FAIL_OWNER_DATA_UNAVAILABLE`.
- **SAFE NEXT STEP:** Do not retry ambiguous provider submission.

## Q1C-OZON-07 — Ozon read-only Work

- **PRECONDITION:** Ozon store add passed.
- **ONE OWNER ACTION:** Start one Ozon Work and run one simple read-only command.
- **EXPECTED RESULT:** The command runs under the correct store/dialogue and
  returns a safe result class without editing marketplace state.
- **EVIDENCE TO RETURN:** Marketplace, safe command/result class, request ID,
  timestamp; no report body.
- **PASS CONDITION:** Correct binding and one successful or honestly classified
  provider result.
- **FAIL CLASSIFICATION:** `FAIL_PROVIDER`, `FAIL_PRODUCT`, or `FAIL_ENVIRONMENT`.
- **SAFE NEXT STEP:** Do not repeat on UNKNOWN until classified.

## Q1C-OZON-08 — Ozon report/file result

- **PRECONDITION:** Ozon read-only Work passed.
- **ONE OWNER ACTION:** Request one available report or file result from that
  same dialogue.
- **EXPECTED RESULT:** Result/file delivery stays in the same dialogue and no
  raw report is durably stored by the server.
- **EVIDENCE TO RETURN:** Result class, file/attachment presence, timestamp;
  not the content.
- **PASS CONDITION:** Same-dialogue delivery is correct and privacy-safe.
- **FAIL CLASSIFICATION:** `FAIL_PROVIDER`, `FAIL_PRODUCT`, or `FAIL_ENVIRONMENT`.
- **SAFE NEXT STEP:** Redact/delete the local downloaded artifact after review.

## Q1C-WB-09 — Wildberries store add

- **PRECONDITION:** Owner has a legitimate Wildberries credential and safe label.
- **ONE OWNER ACTION:** Add and validate one Wildberries store in the product UI.
- **EXPECTED RESULT:** The store is bound or the provider failure is classified.
- **EVIDENCE TO RETURN:** Marketplace, safe label/store ID if allowed, result
  class; no token.
- **PASS CONDITION:** Correct store binding without secret exposure.
- **FAIL CLASSIFICATION:** `FAIL_PROVIDER`, `FAIL_PRODUCT`, or
  `FAIL_OWNER_DATA_UNAVAILABLE`.
- **SAFE NEXT STEP:** Do not retry ambiguous provider submission.

## Q1C-WB-10 — Wildberries read-only Work

- **PRECONDITION:** Wildberries store add passed.
- **ONE OWNER ACTION:** Start one Wildberries Work and run one simple read-only
  command.
- **EXPECTED RESULT:** Correct marketplace/store binding and safe result class.
- **EVIDENCE TO RETURN:** Marketplace, safe result class, request ID, timestamp.
- **PASS CONDITION:** Read-only Work completes or provider failure is honest.
- **FAIL CLASSIFICATION:** `FAIL_PROVIDER`, `FAIL_PRODUCT`, or `FAIL_ENVIRONMENT`.
- **SAFE NEXT STEP:** Stop on UNKNOWN; do not hammer the provider.

## Q1C-WB-11 — Wildberries result/reopen

- **PRECONDITION:** Wildberries read-only Work passed.
- **ONE OWNER ACTION:** Reopen the dialogue/browser and inspect the resulting
  report/result.
- **EXPECTED RESULT:** The same valid dialogue/store binding is restored and
  the result is not cross-delivered.
- **EVIDENCE TO RETURN:** Browser/version, safe result class, timestamp.
- **PASS CONDITION:** Reopen preserves only accepted durable state.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` or `FAIL_BROWSER_ENVIRONMENT`.
- **SAFE NEXT STEP:** Continue only after classifying any stale delivery.

## Q1C-AI-12 — owner AI session and composer

- **PRECONDITION:** Owner has authorized real ChatGPT/Alice sessions and has
  chosen a safe non-sensitive test prompt/file.
- **ONE OWNER ACTION:** Use the approved AI composer once with the owner’s live
  session, including one permitted attachment variant if applicable.
- **EXPECTED RESULT:** Correct session/provenance is used; no private AI body is
  placed in evidence or server diagnostics.
- **EVIDENCE TO RETURN:** AI family, safe result class, timestamp, no content.
- **PASS CONDITION:** Live owner session behavior is observed without secret
  or conversation capture.
- **FAIL CLASSIFICATION:** `FAIL_PROVIDER`, `FAIL_PRODUCT`,
  `FAIL_OWNER_DATA_UNAVAILABLE`, or `FAIL_ENVIRONMENT`.
- **SAFE NEXT STEP:** Stop on auth/uncertainty; do not retry a provider action.

## Q1C-RESTART-13 — close/reopen and service-worker loss

- **PRECONDITION:** One valid store and completed safe Work exists.
- **ONE OWNER ACTION:** Close and reopen the browser/dialogue once.
- **EXPECTED RESULT:** Durable account/store context is restored; ephemeral
  execution state is not falsely resumed or duplicated.
- **EVIDENCE TO RETURN:** Browser/version, safe state/result class.
- **PASS CONDITION:** Accepted durable/ephemeral boundary holds.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` or `FAIL_BROWSER_ENVIRONMENT`.
- **SAFE NEXT STEP:** Do not clear the profile unless requested by the architect.

## Q1C-REBIND-14 — explicit store rebind

- **PRECONDITION:** Two legitimate stores are available, or classify unavailable.
- **ONE OWNER ACTION:** Initiate a store change and acknowledge the explicit
  warning, then perform a new Start.
- **EXPECTED RESULT:** New binding is authoritative; old commands do not
  autorun and no silent cross-store reuse occurs.
- **EVIDENCE TO RETURN:** Safe store labels/IDs, warning observed, result class.
- **PASS CONDITION:** Correct rebind and new Start semantics.
- **FAIL CLASSIFICATION:** `FAIL_OWNER_DATA_UNAVAILABLE` or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Keep the old binding untouched if warning is absent.

## Q1C-MSTORE-15 — two stores same marketplace

- **PRECONDITION:** Two legitimate stores in one marketplace.
- **ONE OWNER ACTION:** Run one bounded read-only check against each labeled store.
- **EXPECTED RESULT:** Store labels and results remain isolated.
- **EVIDENCE TO RETURN:** Safe labels/IDs, marketplace, result classes.
- **PASS CONDITION:** No command/result leakage across stores.
- **FAIL CLASSIFICATION:** `FAIL_OWNER_DATA_UNAVAILABLE` or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Stop on any cross-store result.

## Q1C-SWITCH-16 — marketplace switch

- **PRECONDITION:** Valid Ozon and Wildberries stores.
- **ONE OWNER ACTION:** Switch the current dialogue marketplace, acknowledge
  the warning, and perform a new Start.
- **EXPECTED RESULT:** New marketplace binding is authoritative; prior commands
  do not autorun.
- **EVIDENCE TO RETURN:** Marketplace/store labels, warning, result class.
- **PASS CONDITION:** Explicit safe switch with no silent reuse.
- **FAIL CLASSIFICATION:** `FAIL_OWNER_DATA_UNAVAILABLE` or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Do not run another command if the binding is ambiguous.

## Q1C-DIALOGUE-17 — parallel dialogues

- **PRECONDITION:** Two safe dialogues and, where needed, two valid stores.
- **ONE OWNER ACTION:** Start one bounded read-only action in each dialogue.
- **EXPECTED RESULT:** Each dialogue has one executor and receives only its own
  result.
- **EVIDENCE TO RETURN:** Safe dialogue labels, marketplace/store labels,
  result classes.
- **PASS CONDITION:** No cross-dialogue delivery or executor collision.
- **FAIL CLASSIFICATION:** `FAIL_OWNER_DATA_UNAVAILABLE` or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Finish both dialogues before changing bindings.

## Q1C-MBROWSER-18 — two installations

- **PRECONDITION:** Second legitimate browser/profile/device and a valid account.
- **ONE OWNER ACTION:** Sign in the second installation and run one independent
  bounded read-only action while the first remains open.
- **EXPECTED RESULT:** Both installations operate independently; no exclusive
  central lease or cross-delivery is observed.
- **EVIDENCE TO RETURN:** Browser/version, safe device IDs, result classes.
- **PASS CONDITION:** Multi-browser independence within accepted guarantees.
- **FAIL CLASSIFICATION:** `FAIL_BROWSER_ENVIRONMENT`,
  `FAIL_OWNER_DATA_UNAVAILABLE`, or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Do not infer exactly-once across browsers.

## Q1C-OFFLINE-19 — offline authority/grace

- **PRECONDITION:** A valid signed authority/grace state and a controlled safe
  server-unavailable condition.
- **ONE OWNER ACTION:** With the server unavailable, perform one allowed Start
  or Resume on an already-bound store.
- **EXPECTED RESULT:** FRESH or grace-eligible authority permits the operation;
  Health freshness is not substituted for Work permission.
- **EVIDENCE TO RETURN:** Safe authority class, operation/result class,
  timestamp; no token.
- **PASS CONDITION:** Accepted autonomy behavior is preserved.
- **FAIL CLASSIFICATION:** `FAIL_ENVIRONMENT` or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Restore connectivity before any dependent card.

## Q1C-CACHE-20 — cache-expiry denial

- **PRECONDITION:** Accepted automated deterministic time-state fixture exists.
- **ONE OWNER ACTION:** None; do not reproduce by waiting or manipulating a
  live owner profile.
- **EXPECTED RESULT:** Automated evidence covers valid/grace/expired states.
- **EVIDENCE TO RETURN:** Automated evidence ID only if requested.
- **PASS CONDITION:** `ALREADY_ACCEPTED_AUTOMATED`.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` only if automated evidence regresses.
- **SAFE NEXT STEP:** Continue to the next live card.

## Q1C-UNKNOWN-21 — provider UNKNOWN replay safety

- **PRECONDITION:** Accepted provider-unknown fixtures.
- **ONE OWNER ACTION:** None; never manufacture an ambiguous real provider send.
- **EXPECTED RESULT:** No automatic replay or uncontrolled duplicate.
- **EVIDENCE TO RETURN:** Automated evidence ID only.
- **PASS CONDITION:** `ALREADY_ACCEPTED_AUTOMATED`.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` on regression.
- **SAFE NEXT STEP:** Continue.

## Q1C-429-22 — rate-limit safety

- **PRECONDITION:** Accepted 429 fixture.
- **ONE OWNER ACTION:** None; do not intentionally abuse Ozon/WB.
- **EXPECTED RESULT:** Retry-After/429 policy is covered by automation.
- **EVIDENCE TO RETURN:** Automated evidence ID only.
- **PASS CONDITION:** `ALREADY_ACCEPTED_AUTOMATED`.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` on regression.
- **SAFE NEXT STEP:** Continue.

## Q1C-FINISH-23 — Finish abort semantics

- **PRECONDITION:** One active safe Work.
- **ONE OWNER ACTION:** Select Finish once.
- **EXPECTED RESULT:** Work closes/aborts according to accepted semantics and
  no queued stale command executes later.
- **EVIDENCE TO RETURN:** Safe state/result class and timestamp.
- **PASS CONDITION:** Finish is termination, not hide.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Start a fresh dialogue only after closure is confirmed.

## Q1C-TRANSFER-24 — transfer UX

- **PRECONDITION:** Two legitimate owner installations/devices.
- **ONE OWNER ACTION:** Initiate one safe transfer through the product UI and
  confirm it on the intended device.
- **EXPECTED RESULT:** Transfer UX completes without exposing the secret or
  changing unrelated account data.
- **EVIDENCE TO RETURN:** Safe transfer result class, device IDs, timestamp;
  no transfer secret.
- **PASS CONDITION:** Owner UX and confirmation path work.
- **FAIL CLASSIFICATION:** `FAIL_OWNER_DATA_UNAVAILABLE`,
  `FAIL_BROWSER_ENVIRONMENT`, or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Do not reuse an ambiguous transfer.

## Q1C-EXPORT-25 — export/import UX

- **PRECONDITION:** Owner has safe local data and understands the local-only
  export boundary.
- **ONE OWNER ACTION:** Initiate export, then import it into the intended same
  browser/profile path.
- **EXPECTED RESULT:** Local state restores with account/conflict safeguards;
  no cloud backup or server report storage is implied.
- **EVIDENCE TO RETURN:** Safe success/failure class only; delete local artifact
  after review.
- **PASS CONDITION:** Owner UX completes without evidence containing the file.
- **FAIL CLASSIFICATION:** `FAIL_OWNER_DATA_UNAVAILABLE`,
  `FAIL_BROWSER_ENVIRONMENT`, or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Do not upload the export to chat.

## Q1C-B2-26 — feedback/support UX

- **PRECONDITION:** Authenticated owner session.
- **ONE OWNER ACTION:** Submit one synthetic, non-sensitive feedback case with
  the safe diagnostics option enabled.
- **EXPECTED RESULT:** Case ID is returned; only allowlisted diagnostics are
  visible; own case is readable.
- **EVIDENCE TO RETURN:** Case ID, category, safe status, redacted screenshot.
- **PASS CONDITION:** No secret/raw report/AI body is collected.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` or `FAIL_ENVIRONMENT`.
- **SAFE NEXT STEP:** Do not put real marketplace content in the case.

## Q1C-HEALTH-27 — live Work Health provenance

- **PRECONDITION:** Owner-authenticated live Work and the accepted Stream-2
  integration boundary available.
- **ONE OWNER ACTION:** Observe the product's live Work Health result once.
- **EXPECTED RESULT:** Passive provenance is attributable to the authoritative
  current provider/session without changing Work authority.
- **EVIDENCE TO RETURN:** Safe health/result class and timestamp only.
- **PASS CONDITION:** Owner/live evidence is recorded by the Stream-2 owner.
- **FAIL CLASSIFICATION:** `STREAM2_DEPENDENCY`, `FAIL_PROVIDER`, or
  `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Do not implement a duplicate Stream-1 monitor.

## Q1C-CHROME-28 — real Chrome smoke

- **PRECONDITION:** Legitimate Chrome environment and compatible install route.
- **ONE OWNER ACTION:** Perform the minimum install, popup open, auth-state
  read, and one harmless UI smoke.
- **EXPECTED RESULT:** Chrome behavior is observed directly or the known
  branded-runtime installation limitation is classified.
- **EVIDENCE TO RETURN:** Chrome version, package SHA, safe result class.
- **PASS CONDITION:** Direct evidence only; Chromium reference is not reused.
- **FAIL CLASSIFICATION:** `FAIL_BROWSER_ENVIRONMENT` or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Do not change server behavior for a branded Chrome CLI
  restriction.

## Q1C-OPERA-29 — Opera smoke

- **PRECONDITION:** Real Opera 136 and the unchanged Chromium-family package.
- **ONE OWNER ACTION:** Perform one focused install/popup/auth-state smoke.
- **EXPECTED RESULT:** Existing branded Opera 24/24 automation remains
  consistent with the observed package behavior.
- **EVIDENCE TO RETURN:** Opera version, package SHA, safe result class.
- **PASS CONDITION:** `ALREADY_ACCEPTED_AUTOMATED` remains the bounded truth;
  optional owner smoke is additive.
- **FAIL CLASSIFICATION:** `FAIL_BROWSER_ENVIRONMENT` or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Do not reopen the 24/24 matrix without contradiction.

## Q1C-YANDEX-30 — Yandex smoke

- **PRECONDITION:** Legitimate Yandex Browser Linux runtime.
- **ONE OWNER ACTION:** Install/load the package through the legitimate browser
  route and open the popup once.
- **EXPECTED RESULT:** Runtime/UI result is observed directly.
- **EVIDENCE TO RETURN:** Browser version, package SHA, safe result class.
- **PASS CONDITION:** Direct Yandex evidence or a precise environment defer.
- **FAIL CLASSIFICATION:** `FAIL_BROWSER_ENVIRONMENT` or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Do not infer Yandex from Chromium.

## Q1C-FIREFOX-31 — Firefox smoke

- **PRECONDITION:** Real Mozilla Firefox and the stated Firefox package.
- **ONE OWNER ACTION:** Load the package via the legitimate WebExtension
  developer route and open the popup once.
- **EXPECTED RESULT:** Firefox-specific runtime behavior is observed directly.
- **EVIDENCE TO RETURN:** Firefox version, package SHA, safe result class.
- **PASS CONDITION:** Direct Firefox evidence or precise privileged-page defer.
- **FAIL CLASSIFICATION:** `FAIL_BROWSER_ENVIRONMENT` or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Do not infer Firefox from Playwright Firefox.

## Q1C-SAFARI-32 — Safari/macOS smoke

- **PRECONDITION:** Real macOS/Xcode/Safari environment.
- **ONE OWNER ACTION:** Perform the minimum Safari install/open smoke.
- **EXPECTED RESULT:** Direct Safari result or no test due to absent macOS.
- **EVIDENCE TO RETURN:** macOS/Safari version, safe result class.
- **PASS CONDITION:** Direct evidence only.
- **FAIL CLASSIFICATION:** `FAIL_BROWSER_ENVIRONMENT`.
- **SAFE NEXT STEP:** Keep Safari environment-deferred; do not alter Linux code.

## Q1C-PRIVACY-33 — evidence privacy check

- **PRECONDITION:** Any completed owner card with screenshots/evidence.
- **ONE OWNER ACTION:** Review the evidence package and redact sensitive data
  before returning it.
- **EXPECTED RESULT:** Only safe IDs, timestamps, versions, result classes and
  redacted screenshots remain.
- **EVIDENCE TO RETURN:** Redaction confirmation.
- **PASS CONDITION:** No OTP, credential, token, cookie, report, AI body, or
  transfer secret is present.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` if the product collected it;
  `FAIL_ENVIRONMENT` if the evidence handling was external.
- **SAFE NEXT STEP:** Remove the unsafe artifact and stop sharing it.

## Q1C-ACCOUNT-34 — owner retain/delete UX

- **PRECONDITION:** Owner has reviewed the deletion consequence and has a safe
  non-production/preprod account state.
- **ONE OWNER ACTION:** Execute the currently accepted owner logout/retain/delete
  UX once, only if the owner explicitly chooses to do so.
- **EXPECTED RESULT:** Account/device state follows the accepted deletion and
  privacy contract without orphaned secrets.
- **EVIDENCE TO RETURN:** Safe result class and IDs; no account content.
- **PASS CONDITION:** Owner UX is clear and state boundary is correct.
- **FAIL CLASSIFICATION:** `FAIL_PRODUCT` or `FAIL_OWNER_DATA_UNAVAILABLE`.
- **SAFE NEXT STEP:** Do not delete the owner's only required test state.

## Q1C-APP-35 — operational restart (optional)

- **PRECONDITION:** Architect has approved a maintenance window; Business
  Bridge is excluded.
- **ONE OWNER ACTION:** Exercise only the already-supported Seller Agents
  service restart/reopen path if needed for a live gate.
- **EXPECTED RESULT:** API/portal/worker return healthy without changing trust
  identity or owner data.
- **EVIDENCE TO RETURN:** Timestamp, service health, safe revision identity.
- **PASS CONDITION:** Service recovery is clean.
- **FAIL CLASSIFICATION:** `FAIL_ENVIRONMENT` or `FAIL_PRODUCT`.
- **SAFE NEXT STEP:** Do not restart Business Bridge as part of this card.
