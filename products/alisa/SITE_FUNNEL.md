# AL-S01 · closed synthetic site/funnel

This builds on the independently accepted S00 package. It does not enable registration, stores, matrix/request execution, access grants, payments or production contact collection.

Public routes: `/`, `/examples`, `/how-it-works`, `/pricing`, `/faq`, `/help`, `/contacts`, `/privacy`, `/terms`, `/consents`, `/join`, `/join/confirm`, `/login`, `/auth/start`; `/app/**` explains that the future private feature is unavailable. Unknown routes remain 404. CLOSED pages are noindex. Canonicals/sitemap use the configured own origin.

The UI BFF accepts only same-Origin/Host bounded JSON and calls the loopback platform with its own service bearer. Platform routes are `/api/v1/leads`, `/api/v1/leads/confirm`, `/api/v1/funnel/events`. There is no anonymous contact lookup. A request UUID cannot be rebound to another contact; contact dedupe suppresses repeat mail and server effects. Reopening an expired challenge after its 15-minute cooldown reuses the same lead. Confirmation is single-use, at most five failed checks, and grants no session/access.

Only synthetic `example.invalid` contacts are admitted; platform and BFF intake both default off and are always off in production. `ALISA_LANDING_MODE` currently admits only CLOSED. The later INTERNAL/PILOT/PAID transitions remain gated by their roadmap steps.

Stage configuration **proposal, not applied**:

```text
ALISA_LEAD_INTAKE_ENABLED=1
ALISA_LANDING_MODE=CLOSED
ALISA_PUBLIC_BASE_URL=https://alisa-stage.octoport.ru
ALISA_SMTP_HOST=127.0.0.1
ALISA_SMTP_PORT=18225
```

Add the first three names to web and platform; SMTP belongs only to platform. A separately approved private synthetic SMTP sink must listen on the specified loopback port. No existing lab mail credentials are reused. `leads_deliver` is a finite batch, also available through the proposed `alisa-lead-mail@stage` service/timer; it never requires enabling the technical foundation worker. The outbox is private, has at most three attempts, clears payloads after SMTP acceptance and removes expired payloads. A crash after SMTP acceptance but before committing delivery state can cause a repeated mail: SMTP has no exactly-once transaction with PostgreSQL. Submit retries themselves do not create new messages. Leads expire after 90 days; expired buckets are pruned by the finite batch.

Do not install the new business migrations, mail timer/configuration or safe nginx access-log example without their specific live/DB/security authorization. The source example logs `$uri`, never `$request`, `$request_uri` or `$args`; applying that own-vhost change is required before testing attribution containing private raw input through a real ingress. Existing protected/lab vhosts are not changed. Public collection requires later legal/operator admission; the synthetic-only code deliberately cannot enable it.

Validation uses the existing immutable package pipeline, new guarded disposable PostgreSQL cases, a loopback SMTP fixture and the actual packaged browser. No live DB is a test target. Local compilation can reuse pinned installed dependencies; the release package must come from the clean CI installation, not a local workspace with external dependency symlinks.

Next: finish exact-source CI and independent review, then present the qualified package and a concrete stage rollout request. AL-S01 stays SOURCE_ONLY until authorized installed tests (including restart and own ingress log privacy) pass.
