# A04 CAP-24 platform-contribution currency binding — fresh-main successor — 2026-10-06

Task: `A04-CAP24-PLATFORM-CONTRIBUTION-CURRENCY-FRESH-MAIN-R1-20261006`

Evidence level: **SOURCE / LOCAL_CONTRACT only**.

## Fresh-main reconciliation

The task was first reconstructed and independently reviewed on `40c139fcb39733cdae6f4f57cad7239993c5e46f` as candidate `55fe610d8776df5c09c5d3b4fa29feb4bcfb4971`. Before publication registration, `origin/main` advanced normally to `d7303f29e6fbeefc8232ad0a912735484092c628` (tree `ad4abb7f418b1ad58a5403a226d027b5c92f9ead`).

The `40c139fc..d7303f29` delta changes B02/server migration and integration-test paths only. It changes none of this task's four paths. The stale `40c` route-source was removed and its disk allocation closed; no publication registration or remote mutation occurred from the stale candidate.

This successor therefore reconstructs the same accepted three source/fixture blobs on exact fresh base `d7303f29`, preserves all later main changes, and requires a new exact-SHA independent review plus the normal five-CI publication gates. The old platform-blocked `138c00db9b798ab9c965934af47cd47435677a1c` publication is not retried.

## Fail-closed contract

The arithmetic formula remains:

`revenue - fees - storage - logistics - ads`.

A result may be `COMPLETE` only when:
- `complete === true`;
- revenue, fees, storage, logistics and ads are finite JavaScript numbers;
- `currencyByComponent` is an object;
- each of `revenue`, `fees`, `storage`, `logistics`, `ads` has a non-empty, already-trimmed string currency code;
- all five currency strings are exactly equal.

Missing, malformed, incomplete, blank, whitespace-padded or mixed currency evidence returns `INCOMPLETE`, `amount: null`, `isNetProfit: false`.

No currency default, case normalization, FX conversion, missing-component derivation or net-profit claim is introduced.

## Deterministic evidence on d7303f29

The numeric fixture contains ten executable `platform_contribution` cases: the positive common-currency case plus incomplete/null-money and explicit negative currency/completeness cases. The gold protocol enumerates all ten cases and binds the deterministic definition.

Authoritative Node: `v24.20.0`.

Focused checks on this fresh-main reconstruction:
- `tests/regression/extension-core/business-scenario-coverage.mjs`: PASS, 45 scenarios / 69 numeric cases; CAP-24 remains `REOPENED` and CAP-25 remains `IN_PROGRESS`;
- `tests/regression/extension-core/business-scenario-gold-protocol.mjs`: PASS, 270 logical cards / 90 definition rows, definition index `42db216a18e971bf9f0407dd3745c4cbf6f660115c7c857c49455f645c0c7ec7`;
- `tests/regression/extension-core/wb-paid-storage-contribution-field-schema-slice.mjs`: PASS; storage exact-decimal evidence is preserved and platform contribution remains not source-ready without complete component policy/common-currency authority;
- both touched JSON fixtures parse;
- Prettier check on all three touched test/fixture files: PASS;
- `git diff --check`: PASS.

The only task paths are the deterministic calculator/tests/fixtures above plus this receipt. No extension runtime, server, provider registry, package, auth, browser, DB, service, deployment or production path is changed.

## Limits

CAP-24 remains `REOPENED`. This source contract does not choose or prove the actual store/account currency, prove live paid-storage/promotion/finance completeness, select final accounting buckets, or establish full net profit. COGS, taxes and external costs remain outside the contribution-only result. LIVE_WB/LIVE_OWNER, package, deployment, production and owner semantic acceptance are separate gates.

Independent review and exact-five CI/publication evidence are recorded outside this source receipt and remain mandatory for completion.
