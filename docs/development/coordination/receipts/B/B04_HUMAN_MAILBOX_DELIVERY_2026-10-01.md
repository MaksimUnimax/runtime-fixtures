# B04 ordinary human mailbox OTP delivery evidence — 2026-10-01

Status: **REAL_MAILBOX_DELIVERY PASS / HUMAN OTP ENTRY + LOGIN UX + DEVICE/REVIEWER ACCEPTANCE OPEN**.

Task: `B04-HUMAN-MAILBOX-DELIVERY-EVIDENCE`.

## Evidence

A read-only search of the project owner's already-connected Gmail mailbox found actual Octoport login verification messages from `no-reply@octoport.ru` with subject `login verification code`.

Privacy-safe observations only:

- three Octoport login-verification messages are present in the connected Gmail mailbox within the inspected recent period;
- observed delivery dates are 2026-09-23, 2026-09-24 and 2026-09-30 UTC;
- the most recent observed verification message is in Gmail Inbox and is marked important;
- the message states a 10-minute verification-code expiry window.

The recipient address, OTP digits, Gmail message identifiers and message body are intentionally not copied into Git, control logs or chat evidence.

No new OTP was requested for this evidence task. No email was sent, deleted, archived, labeled or otherwise mutated.

## What this closes

This is real external-mailbox evidence, not a test SMTP sink. It closes the narrow question whether the existing Octoport OTP mail path has actually delivered verification mail to the owner's normal Gmail inbox.

## What remains open

This evidence does **not** establish:

- a person manually reading and entering a fresh OTP;
- successful ordinary human portal login in the current acceptance run;
- reviewer usability or a separate reviewer identity;
- browser/device authorization after human login;
- LIVE_OWNER ChatGPT or marketplace useful-flow acceptance;
- store submission/moderation, deployment or production acceptance.

Those gates require their own exact flows and must not be inferred from mailbox delivery alone.

## Mutation boundary

Evidence acquisition was read-only. Product source/runtime, server, database, catalog, browser profile, provider, marketplace and store state were not changed.
