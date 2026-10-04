# A03 Firefox 140 carrier-floor compatibility evidence — 2026-10-04

Task: `A03-0212-FIREFOX140-COMPATIBILITY-FLOOR-EVIDENCE-20261004`

## Exact inputs

- Fresh main at evidence freeze: `de64e69350b63d658e82bda8f34d408af21fbcba`.
- Product/package source remains `350533044b417a12d52a273071fa61131d2765d7`.
- The only changes from `35053304..de64e693` are two coordination receipts (B06 retention and B03 joint acceptance); extension/runtime/package inputs did not change.
- Exact Firefox STORE package: version `0.2.12`, SHA-256 `11a6e60ba1b246645fc5643ba3df241b2d21d7bf014b13b66c43dbb5b49ef7c3`, 4,210,559 bytes.
- Package carrier declares `browser_specific_settings.gecko.strict_min_version=140.0` and add-on id `octoport@octoport.ru`.
- Official Mozilla Firefox Linux x86_64 en-US `140.0` archive was used. Mozilla release `SHA256SUMS` gives `ca3469774734743b878bca2cfb7efb7b8a8eb4a3c15c2f1f427fbc0472ad3f6e`; downloaded bytes matched exactly.
- Existing geckodriver `0.37.1` and Selenium `4.49.0` were reused read-only.

## Harness boundary

The accepted prior Firefox-155 signed-out consent/support harness was copied task-locally. Its only semantic change was the expected browser version assertion from `155.0.1` to `140.0`.

Accepted source harness SHA-256:
`bdf26957ebc49d39754efbfca114079c3441fe0872d61b24cd1c8932859146d6`

Firefox-140 task harness SHA-256:
`d8b2e71f1a72ae36dbd0fa0e6221e8c3180cfedb7ed300e12241585ae0387011`

No product source, package bytes, policy, catalog, DB or service was modified.

## Real browser result

Exactly one supervised browser job ran under the B browser resource profile and `LOCAL_DENY_PROXY_NO_UPSTREAM`.

Result: **PASS**.

Verified on real Firefox `140.0`:
- exact STORE 0.2.12 temporary add-on installation succeeds at the carrier floor;
- extension identity is `octoport@octoport.ru`;
- before optional technical consent, `authenticated=false`, `workAllowed=false`, sensitive support flags are all false, and browser technical metadata is withheld;
- denying `technicalAndInteraction` leaves technical metadata withheld;
- granting it adds exactly that optional permission and exposes browser family/version in the support snapshot;
- revoking it removes the optional permission and technical metadata becomes withheld again;
- the extension remains signed out throughout;
- forbidden Octoport, AI, Ozon and Wildberries network attempts: **0**;
- denied environmental traffic was Mozilla settings/update/connectivity traffic only.

Resource job `afe02c10477f438d965859a334dff0c7` completed exit 0, peak 537 MiB, cleanup verified.

## Evidence level and limitation

Accepted evidence level proposed:
`INSTALLED_SYNTHETIC_EXACT_FIREFOX_STORE_SIGNED_OUT_AT_CARRIER_FLOOR`.

This result proves that the exact Firefox STORE 0.2.12 carrier can install and preserve the accepted signed-out privacy/consent/support behavior on Firefox 140.0, the package-declared installation floor.

It **does not** by itself authorize or populate `minimumBrowserVersions` in a live/server profile. The current canonical multibrowser preflight intentionally keeps Chrome/Yandex/Firefox profile minimums empty until a separately approved compatibility requirement establishes a support floor.

Not claimed:
- ordinary authenticated Octoport Work;
- signed live profile/bootstrap compatibility on Firefox 140;
- AMO/store installation or update;
- full 45-control action parity;
- LIVE_OWNER;
- marketplace/provider useful flow;
- deployment or production.

## Preserved evidence

- `/root/octoport-control/logs/B/a03-0212-firefox140-compatibility-floor-evidence-20261004/EVIDENCE_MANIFEST.json`
- `/root/octoport-control/logs/B/a03-0212-firefox140-compatibility-floor-evidence-20261004/FIREFOX140_RESULT.json`
- `/root/octoport-control/logs/B/a03-0212-firefox140-compatibility-floor-evidence-20261004/FIREFOX140_ARCHIVE_VERIFICATION.txt`
- `/root/octoport-control/logs/B/a03-0212-firefox140-compatibility-floor-evidence-20261004/method/firefox140_signedout_smoke.py`
- `/root/octoport-control/logs/B/a03-0212-firefox140-compatibility-floor-evidence-20261004/RESOURCE_RECEIPT.json`
- `/root/octoport-control/logs/B/a03-0212-firefox140-compatibility-floor-evidence-20261004/TEMP_CLEANUP.json`
- `/root/octoport-control/logs/B/a03-0212-firefox140-compatibility-floor-evidence-20261004/DISK_COMPLETE.json`

Temporary Firefox/download/profile/output bytes were removed after preservation; disk lifecycle reports `unresolved=[]`.
