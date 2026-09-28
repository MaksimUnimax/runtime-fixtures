# Site SEO and language audit — 2026-09-28

## Authority and scope

- Website baseline: `182847f15abdf307ea1dabca38e5b52ab3695731`.
- SEO research baseline: `448e29b9b973a2619af6e579a5e74acd6fec6717`.
- Five public pages: `/`, `/seller-analytics`, `/privacy`, `/support`, `/install`.
- Also inspected robots, sitemap, aliases, a missing URL, and anonymous login indexing headers.
- Owner authorized only marketplace-name colours for immediate modification.
- Copy, translations, metadata wording, claims and page structure remain unchanged pending approval.
- English instructions at `/install#api-keys` are explicitly excluded from translation.
- Colour wrapping preserves every text node, link, metadata value and instruction term.
- Original mascot drawing and logo geometry remain unchanged.

## Fresh technical evidence

The five publicly retrieved HTML responses all returned 200 and matched the baseline Git blobs byte-for-byte.
Each page has one H1 and a self-canonical. The four indexable pages have individual descriptions.
`/install` retains `noindex, follow`; a description is not required by the current status-page contract.
Sitemap returns 200 and contains exactly the four indexable canonical pages, not `/install`.
Robots returns 200, allows crawling and references the sitemap.
HTTP, www and index.html redirect to the canonical home with 308. Each .html/trailing-slash alias of the four non-root pages redirects with 308.
A deliberately missing URL returns 404.
Anonymous app login returns 200 with `X-Robots-Tag: noindex, nofollow, noarchive`.
These observations prove technical availability, not actual indexing or rankings.
GSC Wizard currently returns no connected properties. Its advertised Yandex site-list method failed as not found; Yandex console state remains unknown.

## Research interpretation

M11 current registry contains 104 clusters: two OWNER_ASSIGNED and 102 HOLD_NO_FINAL_OWNER.
Main owner: «подключить ии к маркетплейсу»; numeric Wordstat count was not returned.
Analytics owner: «ии для аналитики маркетплейсов»; recorded metric value 15.
The owner-approved branded HOME wording supersedes the old H1 wording, not the page-ownership decisions.
Twelve capability cards are a product inventory, not twelve approved standalone SEO landing pages.
The analytics page is still required to supply substantive own-store examples rather than competing as another generic connector homepage.

## Editorial findings for approval only

HOME: read-only; CTR/CPC/ДРР; API; Seller Client ID; API key; Performance credentials; Personal token; cookies; API-токены.
Analytics: seller-owned; read-only; untranslated Octoport; internal proof-process prose rather than a displayed result; generic examples and no direct beta-request route.
Privacy: Privacy in title/H1/footer; read-only; Backend; AI-разговоры; AI-диалог; DOM-данные; opaque service-metadata and retention prose.
Support: Support in title/H1; read-only in body and description; request ID; client secrets; OTP; cookies; API-токены; exports of AI conversations; Privacy footer.
Secondary language review: топ, кейсы, скриншоты, аккаунт, бета, бизнес-состояние, ревизия реквизитов, финансовые переходы.
Do not mechanically translate proper product names, domains, exact key-field labels or established marketplace terminology.
Do not simplify privacy promises by removing the one-hour expiry versus delayed physical cleanup distinction or the encrypted inter-device transfer exception.

## Funnel findings

The current terminal action is a mailto contact request, not immediate installation or a confirmed submitted request.
The main button first scrolls to the beta block. The beta button opens an email composer; the site does not prove that the message was sent or received.
Browser catalog cards show pending status and contain no extension-listing links.
A visitor arriving on analytics is offered generic home/install navigation, not the same direct beta-contact path.
The intentionally deleted HOME proof block is not proposed for automatic restoration. A real approved result belongs on the analytics page.
No conversion rate, ranking improvement or revenue effect has been measured by this audit.

## Browser measurements after colour-only source change

Chrome: all five pages at 1440, 390 and 320 px; HOME light/dark; 18 states PASS.
All visible marketplace names have the intended computed colour. No horizontal overflow; Rubik and images loaded; API guide anchor reached after smooth scrolling.
At 390 × 844: HOME height 10513 px; capabilities 3683 px; how-block begins at y=4766; beta begins at y=9412.
The hero action is already visible at y=621; visitors can skip the long page with its anchor links.
The email action appears at y=10045 when reading linearly. This is a layout measurement, not measured abandonment.
Utility pages currently use a light-only layout; no new theme system was introduced.

## External methodology references

- https://developers.google.com/search/docs/appearance/title-link — descriptive page titles, language consistency, no fixed character ceiling.
- https://developers.google.com/search/docs/fundamentals/creating-helpful-content — original useful content, trust and no preferred word count.
- https://developers.google.com/search/docs/crawling-indexing/block-indexing — crawlable noindex is distinct from robots blocking.
- https://developers.google.com/search/docs/appearance/snippet — descriptive page summaries, not guaranteed verbatim snippets.
- https://www.nngroup.com/articles/information-scent/ — labels and surrounding context set expectations for links.
- https://yandex.ru/support/webmaster/ru/recommendations/site-structure — accessible structure and meaningful navigation.

## Colour implementation checks

Visible names: Ozon blue; WB/Wildberries magenta. HOME dark-theme variants retained.
HTML metadata and all instruction words are unchanged. No executable JavaScript or remote font/asset dependency added.
Added regression tests for all-page name colouring and metadata/instruction preservation.
Fixed the CI H1-count guard to count H1 elements, not text fragments split by the new colour spans. Exact H1 text assertions remain.
Existing contour tests: 15 PASS. New brand tests: 3 PASS. Deployment regressions: 13 PASS.
The complete inline Site CI validator and shell syntax checks pass locally.
Source evidence: `/root/octoport-control/site/brand-audit-source-final-20260928/audit.json`.
Production acceptance must be read from the subsequent deployment and live verification, not inferred from these source checks.
