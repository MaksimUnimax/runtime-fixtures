# C STORE1 packaged AI scope correction — 2026-09-28

Status: SOURCE CANDIDATE / NO LIVE CATALOG MUTATION.

Base: `f6bcd1ce99740b67a2e17056e9350131b624f725`.

Observed real boundary:
- STORE0.2.6 normal technical auth and signed bootstrap succeeded;
- compatibility was SUPPORTED, but server returned `aiStatus=UNAVAILABLE` and no profile;
- actual packaged detector scope was `chatgpt / web / null`.

Contract evidence:
- signed profile consumer schema requires surface `web`, variant `null`;
- packaged control-client `LOCAL_AI.chatgpt` is `chatgpt/web`;
- current STORE1 planner incorrectly provisioned `standard/standard_composer_v1`.

Correction:
- planner targets `chatgpt/web/null`;
- new immutable profile identity is `chatgpt-web-opera-v1`;
- legacy Standard/variant catalog history is neither deleted nor repurposed;
- profile and assignment selection explicitly require `variantId=null`.

Validation:
- STORE1 activation/preflight/signature suites: 53/53 PASS;
- root workspace typecheck PASS;
- targeted Prettier, ESLint and diff-check PASS.

Boundary: frozen STORE0.2.6 bytes unchanged. No SQL, catalog POST, auth bypass, live apply, provider call or store submission.
