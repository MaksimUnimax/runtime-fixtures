# Contour R2 — four owner-reported website defects

Status: SOURCE_AND_PREDEPLOY_PASS / NOT_YET_DEPLOYED.
Base: db7dd52d014924a1195b81d79e6fa4c16a33b022.

The owner requested code changes on the live website, not an image/mockup:
1. Remove the rectangular illustration backdrop in both themes.
2. Center and normalize Wildberries/Ozon badges and labels.
3. Stack the illustration below the text before the two-column layout makes it small.
4. Restore color to all six AI and two marketplace marks.

Scope: apps/site public HTML/CSS and independently sourced logo SVGs, site regression tests and related documentation/CI checks. No product/backend/extension change. Preserve the selected Contour drawing, header/favicon, SEO metadata, utility copy, site navigation and zero executable JavaScript.

Known causes reproduced from the source: .contour-scene has an opaque background using --art-paper; marketplace text uses different viewport-relative font sizes and negative tracking; stacking happens only at 760px; AI logo SVG fills were overwritten and dark-theme CSS removes their color. Drawing assets already have transparent corners; no generated replacement is needed.

Acceptance must inspect real rendered pixels, all eight independent hover/focus controls and widths around the actual tablet breakpoint, not merely 320px/no-overflow. Source PASS is not live PASS.

## Implemented fixes
- The scene has a transparent background. Both original drawing assets retain their alpha; no new illustration was generated. Pixel samples at all four corners match the surrounding page in light and dark themes.
- WB and Ozon have equal circular boxes, equal logo slots, equal caption fonts and baselines, and centered text. Separate SVG wordmarks replace differently tracked viewport-sized text. WB is magenta/purple; Ozon is blue; both use white marks and captions.
- At <=1180 CSS pixels the hero is a single column. The scene follows the full text/actions block and uses the available width, up to 780px. At 960px its width is 780px, instead of the previous 413.5px column.
- Alice, Gemini, ChatGPT, DeepSeek, Anthropic and Qwen use their independently saved color SVGs. Original gradients are retained; no dark-theme grayscale/inversion filter is applied. ChatGPT/Anthropic get explicit green/terracotta fills instead of unresolved currentColor.
- Eight controls remain independent links; drawing and orbit remain stationary on hover and keyboard focus. Existing logo/favicon, SEO metadata, accepted page copy and zero executable JavaScript are unchanged.
- All page stylesheets use `?v=contour-20260927-r2`; new color asset filenames prevent stale monochrome copies.

## Source acceptance evidence
- Site source CI inline checks: PASS; deployment source regression 13/13; Contour source regression 10/10.
- Real Chrome, Opera and Yandex: 102 checked states (90 home width/theme combinations plus 12 utility-page checks), 48 hover/focus pairs.
- Widths: 1778, 1440, 1232, 1181, 1180, 1100, 1024, 960, 900, 820, 768, 760, 640, 390, 320 CSS px.
- Zero horizontal overflow, all six AI glyphs retain chromatic pixels in both themes, equal and centered marketplace captions, full-width stacking at/below the actual tablet breakpoint.
- 16 screenshot-corner checks PASS (four sampled corners per image): the scene rectangle is absent, rather than merely recolored.
- Private nginx mount/network namespace: 41 HTTP/asset/MIME/redirect/query-string/security-header/source-byte checks PASS.
- Native theme/menu keyboard activation PASS. Branded Opera/Yandex ran with an actual Xvfb-rendered window. Opera headless CDP reported a pending animation with startTime=null despite :hover=true; that harness state was not accepted as a website failure or a passing animation test.
- Visual review: desktop both themes, tablet stacked below text and mobile, colored marketplace circles/captions and all six AI marks.

## Reproducible checks
`python3 tests/regression/site/test_site_contour.py`
`python3 -m unittest tests/regression/site/test_site_deployment.py`
`xvfb-run -a -s '-screen 0 1920x1200x24 -ac -nolisten tcp' python3 tests/regression/site/browser_contour_r2.py --out /tmp/contour-r2`
`python3 tests/regression/site/check_contour_background.py /tmp/contour-r2`
Browser runner requires installed Chrome/Opera/Yandex and websocket-client; pixel check requires Pillow. It starts and closes its own temporary HTTP server and browser process groups. Add `--url https://octoport.ru` for a live read-only browser run.

## Evidence hashes
- browser: `63f7e049119b2d488128816a99e2b56060717ac246f8772cbf19f4a35fb85598`
- pixel: `59108149c5046c8e4af5a47ebec9413f1cd76c7f31af3bc3c608659208a7f352`
- nginx-http: `0c72b0bfb11683644b35e147a223b9970bde9a669bff8d21cd5d399912bcc262`
