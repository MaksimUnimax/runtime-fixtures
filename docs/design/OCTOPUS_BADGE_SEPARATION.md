# Octoport engraving integration R1

Status: DESIGN CANDIDATE / NOT PRODUCTION.

## Scope
- working-design visual system moved from the separate Sites prototype into the real site source;
- engraving variant 3 is the hero illustration;
- Rubik is the selected font;
- light/dark theme remains CSS-only;
- six AI marks are independent links;
- Wildberries and Ozon are independent non-link badges;
- no badge is a crop of the moving illustration layer.

## Layering rule
1. engraving-3-underlay.webp is a static background layer.
2. Embedded badge rectangles from the reference were removed from the underlay.
3. Each AI glyph is a transparent isolated asset extracted from the reference.
4. Badge frames/text are HTML/CSS elements.
5. Hover/focus transforms only the badge element, never the underlay.
6. Marketplace badges use their own brand colors and are rectangular.

## Current SEO preserved
- exact accepted HOME Title/H1/description/canonical;
- WebSite JSON-LD;
- /seller-analytics, /privacy, /support, /install;
- current sitemap/robots/indexability contract;
- zero executable JavaScript.

## Review boundary
This branch is for visual/browser acceptance before any production replacement.
