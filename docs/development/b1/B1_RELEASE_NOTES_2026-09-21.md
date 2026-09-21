# Seller Agents managed free beta — release-candidate notes

Candidate: `seller-agents-free-beta-rc-2026-09-21`, version `0.2.4`.

This candidate combines the Ozon and Wildberries seller extension surfaces,
multiple local store bindings, authenticated device/bootstrap flow, explicit
read/report operations, local credential handling, and bounded offline/local
state behavior. Raw seller reports and marketplace credentials are not a
server archive.

Browser truth is deliberately narrow: Opera is bounded-automated accepted;
Playwright Chromium is the canonical automated reference; Chrome needs manual
follow-up; Yandex and Firefox are package-ready but runtime-deferred; Safari
requires real macOS tooling. This is not a claim of universal browser support.

Known limitations: real owner/live AI and marketplace sessions remain outside
this automated preparation; normal external OTP delivery awaits the separate
Octoport SMTP infrastructure actions; browser-store publication and legal
acceptance have not occurred. The beta is read/report scope and does not claim
marketplace editing or production launch.
