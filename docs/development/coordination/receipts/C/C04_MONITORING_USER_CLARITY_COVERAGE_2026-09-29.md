# C04 monitoring user clarity with structured coverage — 2026-09-29

Status: SOURCE CANDIDATE / NO TELEGRAM SEND / NO DEPLOYMENT.

Base: 45a08032de750798180de63c8e6fa6a15583be5f.

Scope:
- consume only validated MonitoringRunResult.coverage in the existing Russian monitoring explanation layer;
- show observation time in the owner-facing +05 timezone;
- show compact tested and unverified provider/source labels;
- distinguish PUBLIC_NO_SESSION, SCHEDULED_EXECUTION, API_SOURCE_ACQUISITION and API_DOCUMENT_COMPARISON;
- distinguish NOT_RUN/PARTIAL/COMPLETED comparison state;
- render safe change severity without inferring installed-extension or authenticated acceptance;
- map the current producer acquisition codes to bounded Russian explanations;
- continue ignoring upstream summary text for cause inference.

Safety boundaries:
- acquisition is never described as version comparison;
- public no-session checks never imply authenticated or extension-button acceptance;
- API comparison results never imply the extension itself is verified;
- missing structured coverage remains explicit uncertainty;
- target lists are based only on schema-validated coverage targets and are compacted;
- no raw upstream summary, token, URL, run id, cookie or credential is reproduced.

Validation:
- targeted formatter + runner tests: 34/34 PASS;
- full @product/telegram-operator suite: 7 files / 103 tests PASS;
- post-format formatter tests: 29/29 PASS;
- @product/telegram-operator typecheck PASS;
- targeted Prettier PASS;
- targeted ESLint PASS;
- git diff --check PASS.

No service restart, Telegram send, live provider call, database mutation or deployment was performed.
