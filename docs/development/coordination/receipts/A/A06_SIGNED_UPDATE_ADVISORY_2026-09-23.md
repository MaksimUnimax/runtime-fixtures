# A06 — signed update advisory and compatibility diagnostics

Status: **A-SIDE VERIFIED BLOCK / READY FOR C INTEGRATION REVIEW**  
Task: `A06`  
Role: `A`

This receipt covers one bounded A06 update/compatibility UX block. It does not claim that all installation/update UX is complete and does not claim installed-browser, LIVE_OWNER, deployment, store publication, or production acceptance.

## Exact change

Feature commit:
`d04828f923b9f836ed405b1581e03a5bd934816d`

Base before this bounded block:
`a281f1da3c53f9bd9791d1cc725587fd6e3b748c`

Fresh `origin/main` at verification:
`228bcbf21bf4ef812bdd70537a7a64f36e59cb42`

No merge was needed because main had not advanced and no A06 path overlap existed.

Changed A-owned surfaces:

- `SellerAgentsControlClient.status()` exposes only compatibility values from the already verified current signed authority;
- popup shows an advisory only when signed extension compatibility is `UPDATE_RECOMMENDED`;
- the advisory states that the current version remains allowed;
- a signed minimum extension version, when present, is described as the minimum allowed version rather than as the recommended target version;
- privacy-safe support snapshot includes bounded signed compatibility status/minimum-version metadata;
- source/package regression now proves the advisory path.

No server/shared contract, DB, migration, lockfile, authority criteria, browser-family contract, package publication flow, or release channel was changed.
## Trust and fail-closed boundary

The advisory is derived only from the current verified signed bootstrap authority already accepted by the control client.

`UPDATE_RECOMMENDED` remains an allowed signed state under the existing authority policy. The UX therefore may report it without creating a second trust channel.

`UPDATE_REQUIRED`, unsupported browser, incompatible profile, invalid signature and other rejected bootstrap states are **not** persisted as an accepted authority merely for UX. They remain fail closed through the existing bootstrap error path.

Observed browser family/version in the support snapshot remains labeled:
`OBSERVED_RUNTIME_ONLY`

That metadata is diagnostic only and is not an official support claim.

## Verification

Run root:
`/root/octoport-control/logs/A/A06_UPDATE_COMPATIBILITY_R1/`

Node:
`v24.20.0`

Fresh `python3 tooling/checks/extension_core.py` result:

- stage: `D2.4`;
- status: **PASS**;
- gate processes: **116**;
- live provider calls: `0`;
- installed acceptance: `false`;
- source support/update advisory regression: **PASS**;
- extracted support/update advisory regression: **PASS**;
- repeat archive identity: **PASS**;
- source↔extracted byte identity: **PASS**.

Package:
`SELLER_AGENTS_I1_C1_v0.2.4_LOCAL_DEVELOPMENT.zip`

Package SHA-256:
`c57a6297d6c92ab90e576c5e038a644717f897864e04d59dbd906068302ae7b2`

Support regression reports:

- scope: `A06_PRIVACY_SAFE_SUPPORT_AND_UPDATE_ADVISORY`;
- compatibility advisory: `UPDATE_RECOMMENDED`;
- browser evidence: `OBSERVED_RUNTIME_ONLY`;
- executionAuthority: `false`.
## Required-update negative control

The same acceptance run executes `client-offline-policy.mjs` against both source and extracted runtimes.

Results:

- source exit: `0`;
- extracted exit: `0`;
- Q1 through Q7: **PASS** in both;
- `Q1-C-extension-update-required`: **PASS** in both.

Therefore the new advisory does not weaken the existing `UPDATE_REQUIRED` fail-closed behavior.

## Remaining A06 boundary

This block closes signed update-recommended messaging and support visibility for the current verified authority. Broader installation/update walkthroughs, store-specific update behavior, and real beta feedback remain separate evidence-bearing work.

No production/package publication action was performed.
