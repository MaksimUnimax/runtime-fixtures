# A03 multi-browser successor release preflight — 2026-10-01

Status: **SOURCE / PREFLIGHT PASS; NOT A PACKAGE OR CATALOG ACTIVATION**.

Task: `A03-MULTIBROWSER-SUCCESSOR-RELEASE-PREFLIGHT`.

## Why a successor release is required

The accepted STORE `0.2.11` release is intentionally bounded to Opera:

- the live release row was published with `supportedBrowsers=[opera]`;
- the accepted signed profile is `chatgpt-web-opera-v1`;
- the compatibility resolver returns `UNSUPPORTED_BROWSER` when the current browser family is absent from immutable release browser support;
- `extension_releases.version` is unique and publication appends a new release rather than mutating an existing version.

Therefore Chrome, Yandex and Firefox authenticated beta support must not be inferred from Opera/Chromium similarity or added by relabelling the already-delivered `0.2.11` candidate. The next bounded target is the exact patch successor `0.2.12`.

## New source preflight

`tooling/server/store-multibrowser-successor-preflight.ts` is read-only and has no execution authority.

It accepts a future `b1_release_candidate_v2` manifest and:

- requires exact successor version `0.2.12`; current `0.2.11`, older, skipped and malformed versions fail closed;
- requires both Chromium and Firefox package entries with exact version/browser/hash/byte metadata;
- optionally verifies supplied ZIP basename, byte length and SHA256;
- maps Chrome, Opera and Yandex to the Chromium artifact and Firefox to the Firefox artifact;
- declares one explicit browser/profile target for each beta browser:
  - Opera observed `136.0.6008.22`, reusing the immutable accepted `chatgpt-web-opera-v1` profile and its existing compatibility/hash;
  - Chrome observed `147.0.7727.116`, profile key `chatgpt-web-chrome-v1`;
  - Yandex observed `26.8.1.1111`, profile key `chatgpt-web-yandex-v1`;
  - Firefox observed `155.0.1`, profile key `chatgpt-web-firefox-v1`;
- keeps the observed Chrome/Yandex/Firefox versions as evidence only; their new profile `minimumBrowserVersions` remain empty until a separate approved compatibility requirement establishes a support floor;
- preserves the already-approved Opera profile minimum `136` unchanged;
- validates every profile material through the existing canonical `validateProfileContent`;
- requires unique profile keys and fingerprints and singleton browser compatibility;
- fails closed if a caller tries to turn an observed Chrome/Yandex/Firefox version into an unapproved profile minimum;
- returns `catalogMutationAuthorized=false` and `packageBuildAuthorized=false`.

The packaged ChatGPT `web/null` selector content is reused as source material. This preflight does **not** claim that those selectors have authenticated behavioral acceptance in Chrome, Yandex or Firefox.

## Verification

Node: `v24.20.0`.

Focused checks:

- ESLint, zero warnings: PASS;
- Prettier: PASS;
- `git diff --check`: PASS;
- `store-multibrowser-successor-preflight.test.ts`: **14/14 PASS** after review-driven rework.

The focused suite covers:

- exact successor PASS;
- refusal to widen current `0.2.11`;
- older/skipped/malformed version refusal;
- missing/wrong-version/wrong-kind package entries;
- ZIP basename/hash/byte mismatch;
- duplicate profile keys;
- browser/profile scope mismatch;
- refusal to promote observed browser versions into unapproved profile minimums;
- explicit no-mutation/no-build authority.

Workspace typecheck:

- command: `pnpm typecheck` (`pnpm -r typecheck`);
- supervised C resource job: `aa57b04fb4dc4833ac3bceb9d9abf8a2`;
- exit 0; OOM kills 0; cleanup verified;
- peak bytes: 2,061,500,416.

Diagnostic history retained:

- the first focused test invocation in the isolated worktree stopped before collection because workspace package links had not yet been installed;
- frozen offline `pnpm install --frozen-lockfile --offline` restored the exact workspace links;
- the first collected run was 12/13 because the test used an unsupported Chai matcher; only that matcher/fixture typing was corrected;
- pre-review focused run was 13/13;
- independent R1 review returned REWORK_REQUIRED because observed Chrome/Yandex/Firefox versions had been used as unsupported product minimums;
- R1 rework separates observation from policy: only the already-approved Opera minimum remains; new browser profile minimums are intentionally unset pending an approved compatibility requirement.
- post-rework targeted TypeScript check using the root ES2024/ESNext/bundler strict compiler options: PASS.

## Evidence limits

Evidence level is **SOURCE / PREFLIGHT** only.

This result does not:

- build or freeze `0.2.12` package bytes;
- publish an extension release, compatibility policy, config, profile or assignment;
- mutate any DB/live service;
- prove authenticated Chrome, Yandex or Firefox Work;
- prove real ChatGPT response behavior;
- prove marketplace business operations;
- submit any browser-store package;
- upgrade `0.2.11` beyond its accepted Opera scope.

The exact next package should be frozen only after the currently active common-main C05/A04 no-replay integration reaches its own accepted boundary, avoiding an immediate unnecessary rebuild/retest.
