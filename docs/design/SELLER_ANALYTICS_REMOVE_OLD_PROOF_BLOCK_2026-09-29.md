# Seller Analytics — remove superseded Ozon proof block

Date: 2026-09-29

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

Owner requested removal of the entire `Проверенные примеры на данных Ozon` section from `/seller-analytics`, including both verified-example cards and their explanatory microcopy. The surrounding analytics examples, read-only boundary and beta-access sections remain unchanged.

Source regression suite after removal: 41/41 PASS.

Production source commit: `77d73ab19ea46bd2774c0e5c3090a499477db9b2`.
Live release: `/var/www/octoport-site/releases/77d73ab19ea46bd2774c0e5c3090a499477db9b2`.
Rollback backup: `/var/backups/octoport-site/20260929T104831Z`.

Live check on `https://octoport.ru/seller-analytics`: `analytics-proof`, `verified-example`, `Проверенные примеры на данных` and the September-2026 proof copy are absent; the read-only boundary and beta-access sections remain present.
