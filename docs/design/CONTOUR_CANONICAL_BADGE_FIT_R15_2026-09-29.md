# Contour R15 — canonical badge fit and final owner hero copy

Date: 2026-09-29

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

R15 supersedes the R14 badge-layout attempt. The octopus, orbit, dots, stars, circle centers/diameters and transparent scene remain unchanged from the accepted R13 owner reference.

Canonical owner reference: 1448×1086 PNG, SHA-256 `8402c8faab101c7975d075f1a8bdebc9c2d3f0f64d4367e7ec52313282bbcfb9`.

## Owner copy

HOME H1 is exactly `Личный помощник на базе любимой Нейросети.`

The first explanatory paragraph is exactly the existing Ozon/Wildberries sentence followed by `Алиса, ChatGPT, DeepSeek, Gemini, Qwen и т.д.`. The provider list is not a second H1 line.

The following sentence is `Так привычный вам ИИ становится вашим сотрудником.` and the free-account sentence remains unchanged.

## Badge fitting method

Badge content is no longer aligned by one shared guessed offset. Visible icon and label bounds were measured from the canonical owner reference and translated into per-brand CSS positions/sizes. The underlying brand SVG path data is unchanged.

AI mark target centers are approximately 40% of circle height. Label centers follow the reference separately per brand: Alice 74.28%, Gemini 72.85%, ChatGPT 73.89%, DeepSeek 74.04%, Anthropic 71.38%, Qwen 74.50%.

Marketplace fitting uses the canonical reference proportions rather than R14 enlargement: WB mark ~63% circle width at 42.60% Y, Ozon mark ~73.5% at 47.67% Y. Both colored labels sit at ~71.6% Y with separately fitted font sizes. Badge-only colors are reference-matched magenta `#ee20f5` and blue `#008cf3`.

All eight circles remain independent DOM links. Hover/focus transforms only the selected circle; the octopus/orbit underlay remains stationary and pointer-inert.

## Source evidence

- site regression suite: 40/40 PASS;
- Chrome hero quick run: 8 states / 8 hover-focus pairs PASS at 1440, 960, 390 and 320;
- Chrome approved-copy/public-page run: 15 states / 48 disclosure interactions PASS;
- local visual review confirms the WB/Ozon logo-label separation and corrected Anthropic/ChatGPT/DeepSeek optical alignment;
- no separate hero background was reintroduced.

## Production acceptance

Production source commit: `c335ca3647de3aa82673f491f4c713b8d1a33fa1`.

Deployment result: PASS. Immutable release: `/var/www/octoport-site/releases/c335ca3647de3aa82673f491f4c713b8d1a33fa1`.
Rollback backup: `/var/backups/octoport-site/20260929T091803Z`.

Live browser acceptance on `https://octoport.ru`:
- Chrome: 8 hero states, 8/8 hover-focus pairs PASS;
- Opera: 8 hero states, 8/8 hover-focus pairs PASS;
- Yandex Browser: 8 hero states, 8/8 hover-focus pairs PASS;
- Chrome approved-copy/public-page run: 15 states, 48 disclosure interactions PASS;
- 1440, 960, 390 and 320 layouts remain overflow-free;
- live screenshots confirm provider list is in the first paragraph, not the H1, and WB/Ozon plus the AI marks follow the canonical reference fit.
