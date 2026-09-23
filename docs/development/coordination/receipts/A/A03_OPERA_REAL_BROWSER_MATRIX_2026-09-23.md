# A03 — real Opera browser matrix checkpoint — 2026-09-23

Status: `PARTIAL_BROWSER_MATRIX / OPERA_INSTALLED_SYNTHETIC_PASS / A03_NOT_COMPLETE`

This is a bounded A03 checkpoint for Opera only. It does not claim Chrome, Yandex, Firefox, Safari, LIVE_OWNER, deployment, store publication, or full product release acceptance.

## Identity

- Stream: `A`; task: `A03`.
- A01 product commit: `5f2c8d97b9c68930f1b38b229c7efb7e9adca6b8`.
- Main synchronized by merge at: `c0ac93f11fe9340fbaf9a45f47e3591b56defef4`.
- Merge parent from current main: `de45ce6c6b9dc99c79c4140e28043e17f10fdda5`.
- A01 candidate package SHA-256: `b34511e7eec358fb398d304d5274fed788824438193ee5412b44d8b451f33017`.
- Package runtime files: 39; repeat archive identity: PASS; source↔extracted bytes: PASS.
- Diff from A01 commit to merged HEAD changed zero of the 103 package composition inputs, so this exact Opera evidence remains bound to unchanged product/package inputs after the main merge.

## Real Opera environment

- Browser: Opera Stable `136.0.6008.22`.
- Executable: `/usr/bin/opera`.
- Clean persistent profile per shard; synthetic control/provider fixtures only.
- Browser identity sent by the installed runtime is `opera`, not Chrome aliasing.

## Method correction

One long source+extracted Opera context had previously accumulated Playwright/browser instability: intermittent BR-C1-24/28 outcomes and later popup/driver crashes. That run is retained as failure-batch evidence but is not release acceptance.

A03 therefore reran the exact same BR-C1-01..38 scenarios in ten bounded shards, each with a fresh browser profile. Criteria were not weakened and no case was omitted:

- `01..04`
- `05..08`
- `09..12`
- `13..16`
- `17..20`
- `21..24`
- `25..28`
- `29..32`
- `33..36`
- `37..38`

## Result

- Source runtime: **38/38 PASS**.
- Extracted runtime: **38/38 PASS**.
- Combined scenario executions: **76/76 PASS**.
- Shard failures: **0/10**.
- Previously timing-sensitive A01 case BR-C1-19: source PASS, extracted PASS.
- Earlier readiness-risk BR-C1-21: source PASS, extracted PASS.
- Earlier long-context flaps BR-C1-24 and BR-C1-28: source PASS, extracted PASS in fresh shards.
- Earlier long-context popup crash area BR-C1-35..38: source PASS, extracted PASS in fresh shards.

Evidence directory:
`/root/octoport-control/logs/A/A03_OPERA_SHARDED_b34511e7_R1`

Summary SHA-256:
`7d469a49f5a7efd42b06a271d2fb7c370f2ceb7b36aab5bf44a6017ae41cd27d`

Per-shard log hashes are stored locally in:
`/root/octoport-control/logs/A/A03_OPERA_SHARDED_b34511e7_R1/evidence-sha256.txt`

## Boundaries and next work

- Opera receives its own real-browser installed-synthetic PASS for this C1 matrix; this is not transferred to any other browser family.
- Google Chrome 147 still requires its own legitimate install route; branded Chrome 137+ rejects the old `--load-extension` automation path, so Chromium evidence is not relabeled as Chrome.
- Yandex Browser is locally installed and must receive its own clean-profile/package proof.
- Real vendor Firefox is not currently installed; its deterministic Firefox package exists, but engine-only evidence is not Firefox acceptance.
- Safari requires a real macOS/Xcode/Safari environment; Linux absence remains an open release gate, not PASS.
- A03 remains active until each target has its own evidence or an explicit environment-deferred release gate.
