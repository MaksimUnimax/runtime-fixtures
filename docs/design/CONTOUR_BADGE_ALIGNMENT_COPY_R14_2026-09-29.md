# Contour R14 — badge alignment and owner hero copy

Date: 2026-09-29

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

## Owner correction

- keep the accepted R13 octopus, orbit, stars, dots, circle geometry and transparent scene unchanged;
- align the visible icon and label inside every clickable circle independently of the SVG file's internal whitespace;
- match the Wildberries/Ozon typography and spacing to the supplied reference crops;
- replace the HOME hero heading with `Личный помощник на базе любимой Нейросети.`;
- use the AI line `Алиса, ChatGPT, DeepSeek, Gemini, Qwen и т.д.`;
- use `Так привычный вам ИИ становится вашим сотрудником.`;
- preserve all routes, SEO title/description/canonical, beta state and read-only product boundaries.

## Implementation

AI marks use an absolute 42% square mark box centered at 50% X / 38.5% Y; labels share 50% X / 74% Y. Marketplace marks use separate fitted boxes: WB 82%×36% at 42.5% Y, Ozon 78%×22% at 47.5% Y; both labels use 73% Y and reference-sized 2.35cqi text. WB/Ozon badge-only colors are `#e11ee8` and `#0187ed`; marketplace colors elsewhere on the site are unchanged.

All eight circles remain real DOM links. Only a hovered/focused circle transforms; the R13 underlay remains pointer-inert and stationary.

## Source evidence

- site regression suite includes a dedicated badge-alignment contract;
- Chrome local hero check: 8 states / 8 hover-focus pairs PASS at 1440, 960, 390 and 320;
- visual captures confirm the revised owner heading and reference-aligned badge contents with no separate hero background.
