# Contour R13 — dark-only owner reference

Date: 2026-09-29

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

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

The hero scene uses the owner-reference dark navy gradient. DOM badge backgrounds are transparent so the same scene background remains visible inside each circle.

## Source/browser evidence

- site regression suite: 39/39 PASS;
- Chrome quick hero run: 8 states; 8/8 hover + focus; pointer click PASS; underlay stationary;
- Opera quick hero run: 8 states; 8/8 focus + pointer click; underlay stationary; headless hover state is not used as acceptance evidence;
- Yandex quick hero run: 8 states; 8/8 hover + focus; pointer click PASS; underlay stationary;
- Chrome approved-copy/public-page run: 15 states and 48 disclosure interactions PASS;
- 1440, 960, 390 and 320 viewport checks have no horizontal overflow.
