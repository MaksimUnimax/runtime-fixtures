# Seller Agents free-beta installation guide

This guide is for the managed beta candidate only. Install the exact package
named in the RC manifest and verify its SHA-256 before loading it.

## Chromium-family browsers

For Chrome, Opera, and Yandex Browser, open the browser's extensions page,
enable Developer mode, choose **Load unpacked**, and select the extracted
Chromium RC directory. Keep the directory unchanged. The ZIP is the archival
candidate; the unpacked directory is the manual developer installation route.

Current truth: Opera has bounded automated evidence (24/24). Chrome requires
manual/browser follow-up. Yandex has a package but its UI runtime remains
environment-deferred. Package existence is not browser acceptance.

## Firefox

Open `about:debugging`, select **This Firefox**, choose **Load Temporary
Add-on**, and select `manifest.json` from the extracted Firefox RC directory.
Temporary add-ons are removed when Firefox restarts. Persistent distribution
requires the owner/publisher route and is not performed here.

Firefox runtime acceptance remains environment-deferred.

## First use

1. Open `https://app.octoport.ru`.
2. Enter a normal email address and request the login code.
3. Read the code in the real mailbox and enter it in the portal.
4. Complete device activation in the extension.
5. Open a supported ChatGPT or Alice conversation, select the intended store,
   and start a read-only operation.

The real external OTP mailbox step is still blocked by the separately tracked
SMTP infrastructure actions. Do not use a console, database, or test-mailbox
substitute.

## Update and removal

Before updating, record the current package SHA and keep the extension's local
profile. Replace the unpacked directory only after verifying the new SHA. The
accepted local account/store state is expected to remain local to the browser.
To remove the beta, disable and remove the extension from the browser's
extensions page. Do not send credentials or raw seller reports to support.

## Problem report

Report the safe error code, UTC timestamp, browser/OS version, extension
version, app version, request ID, and account/device IDs if shown as safe
identifiers. Never attach OTPs, cookies, storageState, marketplace tokens,
passwords, raw reports, AI conversation bodies, or transfer/backup material.
