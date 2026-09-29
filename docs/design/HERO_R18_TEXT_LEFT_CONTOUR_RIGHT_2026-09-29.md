# HERO R18 — approved text left + restored full R15 contour right

Date: 2026-09-29

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

R18 corrects R17. The owner explicitly required the octopus to be restored **as it was before the text-first redesign**, not as a standalone mascot below the CTA buttons.

## Exact restored visual behavior

Desktop HOME hero is again a two-column composition:

- left: the currently approved R16/R17 text treatment and CTA buttons;
- right: the complete R15 `contour-wrap`/`contour-scene` composition restored from commit `4a502f017a51f0aebd0c3bae4f6eed1e805f9249`.

The restored right composition contains the accepted R13 static octopus/orbit/star underlay plus eight independent clickable DOM circles: Alice, Gemini, ChatGPT, DeepSeek, Anthropic, Qwen, Wildberries and Ozon. WB/Ozon remain the larger lower circles. The caption `Сложные технологии. Простые решения.` is restored below the scene.

The R16 cosmic outer arcs, horizon and top pill remain absent. The temporary R17 standalone octopus below the CTA buttons is removed.

At <=1180px the whole contour composition moves below the text as one unit, preserving the pre-R16 responsive behavior. Hover/focus moves only the selected circular control; the static underlay remains stationary.

## Preserved current text treatment

- H1: `Личный помощник на базе любимой Нейросети.`;
- `Нейросети.` keeps the blue gradient;
- Ozon/Wildberries keep the current blue/magenta text colors;
- Алиса, ChatGPT, DeepSeek, Gemini and Qwen keep the current individual colors;
- separator star, employee sentence, free-account sentence and CTA styling remain unchanged.

## Source acceptance

- site regression suite: 40/40 PASS;
- Chrome: 8 hero states, 8/8 contour hover-focus pairs PASS at 1440/960/390/320;
- Chrome approved-copy/public-page run: 15 states, 48 disclosure interactions PASS;
- visual review confirms the right-side contour matches the pre-R16 arrangement and the complete mobile contour remains intact.

## Production acceptance

Production source commit: `c3e0fd366346e3a4502154560ecf00dca51b868b`.
Live release: `/var/www/octoport-site/releases/c3e0fd366346e3a4502154560ecf00dca51b868b`.
Rollback backup: `/var/backups/octoport-site/20260929T100727Z`.

Live browser acceptance on `https://octoport.ru`:
- Chrome: 8 states, 8/8 contour hover-focus pairs PASS;
- Opera: 8 states, 8/8 contour hover-focus pairs PASS;
- Yandex Browser: 8 states, 8/8 contour hover-focus pairs PASS;
- Chrome approved-copy/public-page run: 15 states, 48 disclosure interactions PASS;
- production ingress/TLS/redirect/security-header verification PASS.
