# API Watch DNS fallback and early HTTP cleanup

Original findings: P2-VETTED-DNS-FALLBACK and P2-EARLY-HTTPS-429-SOCKET from the unfinished Controller audit.

Current main 34f4af7330f1ec3fd99ea2c2c311ae810e428456 reproduces both failures on actual TCP/TLS in a disposable network namespace. First public address refuses TCP; second serves a CA-verified response with the original hostname and SNI. Main does not try the second address. An endless HTTP 429 response leaves its socket alive beyond the original deadline.

The fix supplies the entire validated public address set to native bounded fallback and aborts/cancels unread transport on every exit. Mixed private DNS remains rejected. This candidate preserves the current redirect-body cancellation deadline helper and existing package build changes.

Primary red/green, exact source hashes and lifecycle: /root/octoport-control/controllers/audits/CONTROLLER-4P2-TRUSTEDROOT-20261010T120000Z/BLOCK_REPAIR_B04_B05_20261012T0340Z/APIWATCH_NATIVE_TCP_FIXTURE_20261012/result-r2.json and lifecycle-r2.json. Reviewed a480 source passed both native cases; this composed current-main candidate passed all three native cases (result-r3.json), the full 281/281 affected-package tests (package-tests-r5.json), typecheck and lint. Its independent exact-candidate review is still pending. SOURCE evidence is distinct from installed/live acceptance. No service, DB, browser, security policy or foreign worktree changed.
