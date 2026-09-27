# Contour (variant 2) integration — owner-selected visual

Status: SOURCE_PREDEPLOY_PASS / REMOTE_CI_AND_PRODUCTION_PENDING.

## Owner instruction and scope
The owner selected the existing variant 2, «Контур», at /octopus/2 in the working-design Site, supplied a reference screenshot, and explicitly requested deployment to octoport.ru, a visible brand/favicon, and eight independent controls rather than moving background crops. This replaces the previous engraving choice only in the public-site subsystem; A/B/C, API, database and extension scopes are untouched.

## Source provenance
The original working-site handoff dated 2026-09-25 contains dist/octopus/2.html, its palette/layout CSS, dist/octopus/assets/2-outline.png and independent brand SVGs. The original 2-outline.png is already a transparent clean drawing with no badges. Do not use reference-art.js crop/mask logic. The original drawing was resized from 1254 to 900 pixels and quantized to 64 RGBA colors for a 44,612-byte WebP. This is a deterministic optimized derivative, not a byte-identical original or a generated replacement.
Underlay SHA-256: 8b2e1c1783c48f5f8037205ea3dd93b25162017a40c463a1d5d9dd726659219e.

## Implementation contract
- Pale blue-gray/light and navy/dark visual palettes; Rubik; reference header and centered left-copy/right-art composition.
- Preserve accepted production Title, H1, description, canonical, structured data, utility-page content, robots and Sitemap. The comparison navigation and demonstration noindex are not copied to production.
- Six AI circles: Alice/Gemini highest, ChatGPT/DeepSeek middle, Anthropic/Qwen outer; WB bottom-left, Ozon bottom-right.
- One static clean drawing per theme plus separate decorative orbit. Eight genuine, accessible links; no image cropping, background fragments, duplicate drawn badges, hidden clipping or rectangular repair masks.
- Original blue-purple brand mark, tightly bounded in header and 120px favicon; a versioned alternate favicon avoids stale browser caches.
- Preserve zero executable JavaScript; use native accessible checkbox and details for theme/menu.

## Acceptance required
Source CI and deployment regression; header/logo and fetched favicon visual checks; all eight hover/focus states with unchanged background geometry; light/dark at desktop, 390px and 320px; real Chrome/Opera/Yandex; utility-page regression. Exact-head CI, fresh-main drift reconciliation, non-force integration, existing rollback-safe site deployment, then live verification and screenshots. No claim of production completion until these pass.

## Source and predeploy results
- Accepted SEO metadata/H1/JSON-LD and all page-content guards pass unchanged.
- Existing deployment regression: 13/13 PASS. New Contour architecture regression: 6/6 PASS.
- Chrome/Opera/Yandex: 20 render/theme/mobile/utility states PASS; 48 hover/focus pairs keep both drawing layers and orbit stationary.
- 320px: clientWidth=305, scrollWidth=305. 390px: clientWidth=375, scrollWidth=375. Native theme Space and menu Enter activation pass.
- An initial 320px header overflow was caught and fixed. At <=360px login remains available in the menu; brand and touch controls stay visible.
- Private mount/network namespace nginx: 39 real HTTP checks PASS, including canonical redirects, query preservation, new assets, explicit self-hosted WOFF2 MIME, security headers, true 404 and exact source-byte parity.
- Favicon: tightly bounded original blue-purple mark on a pale rounded plate for contrast in either browser theme; /favicon.png remains compatible, and /assets/favicon-contour-v1.png supplies the new cache identity. Header uses a separate 192px brand asset, not the old whitespace-heavy favicon.
- Rubik is self-hosted under assets/fonts with the upstream OFL retained. No executable JS or third-party font runtime requests.
- Manual screenshot review: selected outline character and circle layout, light/dark, mobile, WB/Ozon hover. No background fragment belongs to any button.

Evidence SHA-256:
- browser: `dce16874ffe2b321267e61e659363610488f7950930914eb9b41bfce390cf430`
- isolated-http: `966b73534f29d5c4483c8f5dcf2a6f84756044f02c74e52a8a1258fc8c78a3aa`

## Cache-safe cutover
All pages reference `/styles.css?v=contour-20260927-r1`; the actual shared stylesheet and nginx route are unchanged. The new URL prevents a cached engraving stylesheet from being combined with new Contour HTML. The existing favicon link is retained, followed by the newly versioned icon URL.
