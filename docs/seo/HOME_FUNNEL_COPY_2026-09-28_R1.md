# Octoport HOME — product presentation and funnel R1

Date: 2026-09-28
Status: OWNER-DIRECTED HOME COPY / SOURCE IMPLEMENTED

## Owner copy directive

The first-screen wording was explicitly approved by the owner and supersedes the prior HOME presentation wording that used “ваш ИИ” as the headline concept.

Current first-screen copy:

- «Подключите Алису, ChatGPT, DeepSeek»
- «или другую нейросеть к своему магазину на WB и Ozon.»
- «Октопорт соединяет ваш кабинет продавца на Ozon или Wildberries с любой нейросетью на ваш выбор.»
- «Так привычный ИИ становится вашим сотрудником.»
- «Можно использовать бесплатные аккаунты нейросетей.»
- CTAs: «Попробовать» / «Как это работает»

This is a presentation/copy authority from the owner. It does not reopen M9/M10/M11 clustering or page ownership.

## Funnel correction

The HOME route now answers these questions in sequence:

1. What is being connected?
2. What does a real seller task look like?
3. What questions can the product help inspect?
4. How does the browser-extension path work?
5. What is required to use it?
6. What is sent to the AI dialog and what remains in the extension?
7. What can a new visitor actually do while the beta/catalog installation is not generally available?

The previous primary route was:
`Попробовать -> #beta -> Инструкция по установке -> /install -> нет ссылки для установки`.

R1 changes that terminal action to an executable contact path:
`Попробовать -> #beta -> mailto:support@octoport.ru?subject=Бета%20Октопорт`.

The installation status page remains linked as a secondary action.

## Product-proof boundary

The public HOME proof block uses only the already accepted real Ozon sales scenario:

- question: sales yesterday, aggregate revenue + ordered units;
- read-only Ozon Seller API analytics path;
- seller-owned data only;
- private seller values and identifiers omitted.

Authority:
- `docs/seo/M15_ANALYTICS_REAL_PRODUCT_PROOF_CLOSURE_2026-09-27_R1.md`
- current product readiness remains bounded; this does not claim every AI × marketplace combination is currently acceptance-tested.

The task cards use previously proven/historical seller jobs (period sales comparison, stock attention, priority inspection) but do not add quantitative performance claims or autonomous write-back promises.

## SEO continuity

The HOME still covers the accepted connector/category job:
`подключить ии к маркетплейсу`.

The owner-directed H1 now uses concrete AI brands instead of the phrase “ваш ИИ”. The Title and meta description retain:
- AI/нейросеть connection intent;
- Ozon + Wildberries;
- Octoport brand;
- browser-extension mechanism.

The `/seller-analytics` child route remains the owner for the distinct seller-owned analytics job. No held semantic cluster is converted into a new page or FAQ.

## Source QA

- contour/source unit tests: 15/15 PASS;
- deployment regression: 13/13 PASS;
- Chrome full source matrix: 34 states + 16 hover/focus pairs PASS;
- Opera full source matrix: 34 states + 16 hover/focus pairs PASS;
- Yandex full source matrix: 34 states + 16 hover/focus pairs PASS;
- no horizontal overflow at the existing 320px browser gate;
- no executable public JavaScript added.
