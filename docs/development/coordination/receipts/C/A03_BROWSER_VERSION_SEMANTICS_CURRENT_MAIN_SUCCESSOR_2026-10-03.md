# A03 — browser runtime-version semantics successor

Date: 2026-10-03
Task: `A03-BROWSER-VERSION-SEMANTICS-CURRENT-MAIN-SUCCESSOR-20261003`

## Result

This source-only successor keeps three browser-version concepts separate:

- **observed/product version** — browser binary/product evidence;
- **runtime compatibility version** — the value emitted by Octoport browser identity and used by compatibility logic;
- **approved minimum version** — explicit policy authority, never inferred from either observation.

| Browser family | Product/binary evidence | Runtime compatibility evidence | Approved profile/server minimum |
|---|---|---|---|
| Opera | `136.0.6008.22` | `136.0.0.0` | `136` |
| Chrome | `147.0.7727.116` | `147.0.0.0` | **unset / decision required** |
| Yandex Chromium | `26.8.1.1111` | `26.8.0.0` | **unset / decision required** |
| Firefox | `155.0.1` | `155.0` | **unset / decision required** |

Firefox `strict_min_version=140.0` remains only the exact carrier installation floor. It is not promoted into server/profile minimum-version authority.

## Evidence bindings

- Opera/Chrome/Yandex decision input:
  `/root/octoport-control/logs/A/a03-browser-minimum-decision-input-20261002.json`
- Firefox exact installed runtime identity:
  `/root/octoport-control/logs/A/a03-firefox-runtime-compat-evidence-final-20261002.json`
- Firefox independent evidence review:
  `/root/octoport-control/logs/A/A03-FIREFOX-RUNTIME-COMPAT-REVIEW-20261002-result.md`
- Historical blocked task:
  `/root/octoport-control/logs/A/a03-browser-version-semantics-gate-platform-blocked-20261002.json`

The later Firefox evidence supersedes only the earlier `compatibilityRuntimeObserved=null` observation. It does **not** approve a Firefox minimum.

## Fail-closed behavior

`SuccessorProfileTarget` now carries `runtimeCompatibilityVersion` separately from `observedBrowserVersion`.

The preflight:

- requires every exact target to match its reviewed runtime compatibility value;
- validates an already-approved minimum against runtime compatibility, not the product/binary version;
- rejects missing or malformed runtime evidence;
- rejects runtime evidence below an approved minimum;
- continues to reject unauthorized Chrome/Yandex/Firefox minimums;
- preserves the existing Opera minimum `136`;
- does not authorize package build, catalog mutation, DB/service mutation, browser-minimum expansion, authentication, store publication or live acceptance.

## Verification

Standalone bounded RED/GREEN fixture:

- old source: `RED_RUNTIME_VERSION_MISSING:opera:undefined`;
- current source: PASS;
- product/binary substitution for Chrome runtime evidence is rejected;
- missing or below-minimum Opera runtime evidence is rejected.

Focused current source test:

`store-multibrowser-successor-preflight.test.ts`: **16/16 PASS** under Node `24.20.0` / Vitest `3.2.6`.

The focused test used only temporary task-local links to already-installed repository dependencies; no install or download occurred, and the links were removed after the run.

Evidence level: **SOURCE / PREFLIGHT** only.

Not established: live catalog/profile compatibility, authenticated Work, browser-minimum approval for Chrome/Yandex/Firefox, `READY_FOR_OPERATOR`, browser-store acceptance, `LIVE_OWNER`, deployment or production.
