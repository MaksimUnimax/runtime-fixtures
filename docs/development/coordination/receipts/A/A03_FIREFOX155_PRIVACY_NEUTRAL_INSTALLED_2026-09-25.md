# A03 — Firefox 155 privacy-neutral installed evidence — 2026-09-25

Status: **REAL FIREFOX CONSENT + INSTALLED-SYNTHETIC WIRE PASS / NOT RELEASE ACCEPTANCE**
Role: A
Exact tested product code HEAD: `174d8d0386f963ab6796a7ca4e2a05f802f69521`

## Exact carrier and browser

- Firefox carrier: `SELLER_AGENTS_I1_C1_v0.2.4_FIREFOX_LOCAL_DEVELOPMENT.zip`.
- Carrier SHA-256: `3c7e5339622c1da8b455611791569164e8988f453121465179f24fd8d5dd702e`.
- Browser: official Mozilla Firefox `155.0.1` already retained under the isolated A browser area.
- Installed temporary add-on ID: `seller-agents@example.test`.
- Selenium: 4.49.0; GeckoDriver 0.37.1; Firefox system-access requirement respected.
- No production/live service, marketplace provider, credentials, owner session, raw marketplace payload or external AI was used.

## Real Firefox built-in consent

Fresh-profile initial `browser.permissions.getAll().data_collection` contained only the seven required categories and did **not** contain `technicalAndInteraction`.

The real Firefox chrome doorhanger displayed:
- requested collection: **technical and interaction data**;
- primary action: **Allow**;
- secondary action: **Deny**.

Observed state transitions in the exact installed carrier:
1. initial: optional technical permission absent; popup shows grant action;
2. Deny: optional permission remains absent; popup still states core operation remains available;
3. Allow: `technicalAndInteraction` appears in Firefox permission state; popup switches to revoke action;
4. Revoke: `technicalAndInteraction` disappears again; popup returns to grant action.

Evidence:
- `/root/octoport-control/logs/A/A03_FIREFOX_PRIVACY_NEUTRAL_INSTALLED_R1/installed-consent-flow-result.json`
  SHA-256 `5ce7b38c69af9388237c8ae82d6e1d0bf439375357a5a910de6513f1f6c0a57c`.
- doorhanger probe SHA-256 `6828686d82b70ef457377ab63b6555f561d380729da8e9b904339be72215ab17`.
- successful browser resource receipt: `/root/octoport-control/resource-jobs/189afee3fb8d43f392eaab39b8065882/receipt.json`; exit 0, cleanup verified.

## Installed-synthetic wire proof

A local synthetic control/portal pair bound only to `127.0.0.1:43100/43101`; it captured request bodies and never contacted live/preproduction.

Real Firefox produced this device-auth sequence:
1. opt-out: `{"clientType":"browser_extension"}`;
2. after Allow: `{"clientType":"browser_extension","browserFamily":"firefox","browserVersion":"155.0","extensionVersion":"0.2.4"}`;
3. after Revoke while identified authorization was pending: a **new** `{"clientType":"browser_extension"}` attempt.

Firefox capability reported `155.0.1`; its real extension-page UA reports `Firefox/155.0`, which is the product browser-identity value and therefore the exact identified wire value.

Token polling device-code sequence was neutral attempt 1 → identified attempt 2 → neutral attempt 3, with only attempt 3 repeated after withdrawal. This confirms the installed runtime abandoned the identified pending authorization and restarted privacy-neutral rather than silently continuing metadata-bearing authorization.

Wire evidence:
- `installed-wire-flow-result.json` SHA-256 `ae0a342fc4aabc54e3eeb7e465e371b8d9c8419f5bcf0d1aaeebd0f2e0246680`.
- successful browser resource receipt: `/root/octoport-control/resource-jobs/4d885f8bc6a84673aa1ad914253d9ea8/receipt.json`; exit 0, cleanup verified.

## Firefox packaging lint

`web-ext 10.5.0 lint`: 0 errors, 0 notices, 1 retained desktop-only Android minimum-version warning.
Lint log SHA-256: `c0be94cdd59d3944a81d12a614c74283016b8950472ad381bb3366cb65701e6b`.

## Limits

This is real-browser consent evidence and installed-synthetic wire evidence only. It is not LIVE_OWNER, compatible-backend deployment, full Firefox Work/Ozon/WB acceptance, AMO submission, AMO approval or production readiness.

Verdict: **REAL_FIREFOX_CONSENT_AND_PRIVACY_NEUTRAL_WIRE_PASS / INSTALLED_ACCEPTANCE STILL PARTIAL**.
