# Publisher submission preparation — not submitted

No store account was created, no agreement was accepted, and no package was
uploaded.

## Common metadata

- Title: Seller Agents
- Version: `0.2.4`
- Short description: Read-only Ozon and Wildberries seller reports in your
  supported AI workspace.
- Support URL: `https://app.octoport.ru/`
- Privacy URL: owner must provide the accepted public privacy-policy URL before
  submission; no unverified URL is invented here.
- Candidate package: see `B1_RC_MANIFEST_2026-09-21.json`.

## Permission explanation

`storage`, `unlimitedStorage`, `alarms`, and `tabs` support local account/store
state, bounded local recovery, scheduled local work, and the active AI tab.
Host permissions cover the supported AI surfaces, Ozon/Wildberries read APIs,
and the Octoport API/portal for authentication and signed Bootstrap. The
extension does not send marketplace credentials to Octoport as a durable
server archive and does not use a hidden mandatory control-plane proxy for
ordinary provider work.

## Store-specific preparation

- Chrome Web Store: MV3 package, permission justification, privacy text,
  screenshots, support contact, and manual branded-Chrome follow-up required.
- Opera: Chromium MV3 package, same permission/privacy explanation, and the
  bounded Opera evidence reference.
- Firefox AMO: Firefox package with `background.scripts` and Gecko metadata;
  runtime acceptance and AMO account review remain pending.
- Yandex: Chromium package notes; runtime/UI evidence remains deferred.
- Safari: future macOS/Xcode packaging only; no submission artifact prepared.

## Screenshot checklist

Capture only after legitimate owner/live testing: login, store selection,
read-only command confirmation, safe result delivery, diagnostics with secrets
absent, and browser-specific install/update state. Do not capture OTPs,
marketplace credentials, seller reports, AI conversation bodies, or private
configuration.
