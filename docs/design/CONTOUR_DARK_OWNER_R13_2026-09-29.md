# Contour R13 — dark-only owner reference

Date: 2026-09-29

Status: PRODUCTION_DEPLOYED / LIVE_QA_PASS.

Canonical owner reference: 1448×1086 PNG, SHA-256 `8402c8faab101c7975d075f1a8bdebc9c2d3f0f64d4367e7ec52313282bbcfb9`.

## Owner requirements

- public site is dark-only; light theme and the theme toggle are removed;
- the hero octopus follows the canonical owner reference, with no generative redraw;
- all eight circular brand controls remain genuine independent links;
- hovering/focusing a control must never move the octopus, orbit, dots or stars;
- public copy, routes, SEO ownership and read-only/beta boundaries are unchanged.

## Implementation

The static scene is `assets/contour-owner-static-r13.svg`. It is derived directly from the owner reference linework. The eight badge discs are removed from that static layer so there is no duplicate circle/logo beneath an interactive control.

The static SVG contains the reference octopus, orbit arcs, orbit dots and stars. It is `pointer-events:none` and has no transform, transition or animation.

Each brand circle is still an independent DOM `<a>` element with its own vector mark and live text. The circle itself is CSS, not baked into the static art.
## Reference-fitted button geometry

| Control | X center | Y center | diameter |
|---|---:|---:|---:|
| Алиса | 35.789023% | 15.728910% | 11.714492% |
| Gemini | 64.106944% | 15.721128% | 11.715736% |
| ChatGPT | 22.838506% | 33.124850% | 11.637252% |
| DeepSeek | 77.080688% | 33.136609% | 11.672000% |
| Anthropic | 22.120675% | 59.920163% | 11.874733% |
| Qwen | 77.776983% | 59.954784% | 11.810259% |
| Wildberries | 34.325460% | 78.933766% | 15.599677% |
| Ozon | 65.547265% | 78.941405% | 15.687104% |

Static asset SHA-256: `39b40b0333c40be7a1ee16ca232f11ed158fc45694ee33fbf93278f03f70aae2`.

The normalized geometry is also recorded in `apps/site/design-sources/contour-owner-dark-r13.json`.

## Dark-only contract

All five public pages declare `color-scheme=dark` and theme color `#0d1929`. The HOME theme checkbox/label and all light/dark switching CSS are removed. The header logo and browser-card Octoport mark use a fixed dark-site treatment.

The hero scene has no separate rectangular or gradient background. It is transparent and sits directly on the site dark background. DOM badge backgrounds are also transparent, so no box is visible around the illustration.

## Source/browser evidence

- site regression suite: 39/39 PASS;
- Chrome quick hero run: 8 states; 8/8 hover + focus; pointer click PASS; underlay stationary;
- Opera quick hero run: 8 states; 8/8 focus + pointer click; underlay stationary; headless hover state is not used as acceptance evidence;
- Yandex quick hero run: 8 states; 8/8 hover + focus; pointer click PASS; underlay stationary;
- Chrome approved-copy/public-page run: 15 states and 48 disclosure interactions PASS;
- 1440, 960, 390 and 320 viewport checks have no horizontal overflow.

## Production acceptance

Production source commit: `4aad6e30a186ec635a9e2841697f5cdf3cb0c7ad`.

Deployment result: PASS. Immutable release: `/var/www/octoport-site/releases/4aad6e30a186ec635a9e2841697f5cdf3cb0c7ad`.
Rollback backup: `/var/backups/octoport-site/20260929T080234Z`.

Live post-deploy verification confirms TLS, redirects, security headers, unchanged app/API ingress, anonymous authentication guard and legacy docs service.

Live browser acceptance on `https://octoport.ru`:
- Chrome: 8 states, 8/8 hover/focus checks, pointer click PASS;
- Opera: 8 states, 8/8 interaction checks PASS;
- Yandex Browser: 8 states, 8/8 interaction checks PASS;
- 1440, 960, 390 and 320 viewport checks show no horizontal overflow;
- the static underlay remains stationary while badge controls interact independently.

Live static SVG SHA-256: `39b40b0333c40be7a1ee16ca232f11ed158fc45694ee33fbf93278f03f70aae2`, byte-identical to the accepted source asset.
