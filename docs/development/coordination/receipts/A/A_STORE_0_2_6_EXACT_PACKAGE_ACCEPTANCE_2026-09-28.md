# A — exact STORE 0.2.6 package acceptance — 2026-09-28

Status: **PACKAGE + REAL OPERA INSTALLED_SYNTHETIC UI PASS / STORE CATALOG + LIVE REVIEWER OPEN**

Task: follow-up to `A_WB_RETIRED_ALIAS_CHANGED_BOUNDARY_ACCEPTANCE`.
Controller notice: `STREAMS-AUDIT-20260928-0309`.

C release source:
- HEAD `028d5dd56341719e2061a47b5e82e216256619f7`;
- tree `99e12233864a592510032e30bb96668b41682204`;
- version `0.2.6`;
- contract `control_plane_v2`;
- migration level `51`.

Relative to accepted main `4f3aa29b8954eff19b20df2930524be805b3c882`,
the release-source package changes are only:
- `apps/extension/composition.json`: version `0.2.5 -> 0.2.6`;
- `tooling/build/extension_composed.py`: exact build guard `0.2.5 -> 0.2.6`.

The accepted WB retirement overlay was already in main; no new product feature is introduced.

## Exact release artifacts

Chromium/Opera:
- file: `OCTOPORT_v0.2.6_CHROMIUM_STORE.zip`;
- SHA-256: `579dc15aaf692fc9e96ad650e660ac0190bb7e136c949b7ad401e5bc82a909b5`;
- bytes: 2218547;
- inventory: 42 files.

Firefox:
- file: `OCTOPORT_v0.2.6_FIREFOX_STORE.zip`;
- SHA-256: `b5de9b4f0773c08a705fbad050e77d382f265aa34fd2ca8d3657553bad577305`;
- bytes: 4133655;
- inventory: 43 files.

C release preflight reports PACKAGE PASS with no production mutation.
A independently reran `unzip -t` on both archives.

A also independently unpacked both candidate ZIPs and compared them recursively:
- Chromium candidate vs C `chromium/extracted`: no differences;
- Firefox candidate vs C `firefox-runtime`: no differences.

Therefore the bytes tested below are the exact candidate ZIP contents.

## WB changed-boundary verification on exact 0.2.6 bytes

A ran the current focused WB regression directly against:
- C source runtime: `store-release-028d5dd5/chromium/runtime`;
- exact Chromium ZIP extracted runtime: `store-release-028d5dd5/chromium/extracted`.

Results:
- SOURCE runtime: 24/24 scenarios PASS;
- EXTRACTED package: 24/24 scenarios PASS;
- retired `banned_products_shadowed` → `UNSUPPORTED_OPERATION`, zero provider fetch;
- retired `analytics_item_rating_v1` → `UNSUPPORTED_OPERATION`, zero provider fetch;
- both retired aliases absent from legacy describe and WB_HELP_V2 analytics guidance;
- `banned_products_blocked` and `analytics_item_rating_v2` remain present;
- supported `seller_info` useful flow executes one expected synthetic provider request;
- live provider calls: 0;
- installed acceptance: false for this regression.

Source and extracted result SHA-256 are identical:
`92d7ef12f17ae50e2788a2346f164dd7ab68ed7c34479305c5b7c28cff54d11e`.

## Real Opera exact-package UI smoke

A loaded the exact extracted Chromium/Opera 0.2.6 candidate in real Opera using
the ordinary development extension flags and a fresh temporary profile.

Observed:
- Opera product binary: `136.0.6008.22`;
- Playwright-reported Chromium engine: `152.0.7977.120`;
- manifest name: `Octoport — Ozon + Wildberries`;
- manifest version: `0.2.6`;
- manifest v3;
- popup `document.readyState=complete`;
- visible signed-out markers all present:
  `Octoport`, `Вход не выполнен`, `Войти через портал`,
  `Расширение не получает пароль или OTP.`, `Первый запуск`;
- page errors: 0;
- external HTTP(S) requests observed while loading the signed-out popup: 0.

Evidence level:
`INSTALLED_SYNTHETIC_EXACT_PACKAGE_UI`.

This is development-flag loading of the exact STORE ZIP contents.
It is not Opera Add-ons catalog installation, reviewer authentication, LIVE_OWNER,
provider acceptance, upload, Submit, approval or publication.

## Evidence files and resources

Focused evidence root:
`/tmp/a-store026-boundary-r1`.

Hashes:
- package hash list: `d605a26ac5f37d11226735bab6a7d2bc24aba997dd52b7f590ed867031480c30`;
- WB source result: `92d7ef12f17ae50e2788a2346f164dd7ab68ed7c34479305c5b7c28cff54d11e`;
- WB extracted result: identical;
- Opera smoke tee result:
  `2c1462af91b672706ac6c5db8884d2a09197dbc4901057b95dc133cec92485d0`.

Resource receipt:
`/root/octoport-control/resource-jobs/525a27e182f34b1da9877e87eee05b1d/receipt.json`.

Supervisor:
- exit 0;
- systemd success;
- OOM 0;
- cleanup verified;
- peak 503316480 bytes.

## Remaining gates

A's exact-package changed boundary is complete.
C owns release metadata, reviewer binding, store dashboard/upload/Submit and catalog evidence.

Still open outside this receipt:
- ordinary Opera reviewer/auth/useful-flow on the exact STORE candidate;
- Opera Add-ons catalog installation/publication evidence;
- same-item signed N→N+1 update and owner Windows UX/preservation confirmation;
- other browser store-channel gates where required;
- real owner/provider business gold-set and later beta feedback.

No owner credentials, live marketplace call, deployment, catalog mutation or store submission
was performed by A in this task.
