# Owner copy cleanup R22 — analytics + HOME

Date: 2026-09-29

Status: SOURCE_ACCEPTED / PRODUCTION_PENDING.

## Owner changes

### `/seller-analytics`

1. Lead copy now reads: `Разбирайте продажи, поисковые позиции, рекламу, остатки и финансы в привычном диалоге с Алисой, ChatGPT или DeepSeek. Октопорт позволяет получить нейросети доступ к данным вашего кабинета селлера.`
2. The introduction under `От вопроса о магазине — к понятному результату` now explains that the user asks a question in the dialogue and the neural network requests the required data through Octoport.
3. Search-position result copy removes the crossed-out missing-data caveat.
4. Unit-economics result copy removes the crossed-out net-profit/storage-allocation caveat while retaining revenue, marketplace expenses, advertising spend, marginal contribution and profitability factors.

### HOME

1. `Что даёт Октопорт продавцу`: the second paragraph now says the neural network gains access to seller-cabinet data and answers based on those data.
2. `Сильная модель + Октопорт`: the boundary sentence now says the model helps make decisions based on real store data; the crossed-out `доступ ... только на чтение` phrase is removed from this block.
3. Footer tagline `Нейросеть + данные вашего магазина.` is removed.

Obvious typing slips from the owner's message were normalized only for readability (`вопрос в`, `у неё`, punctuation/spacing); meaning was not changed.

## Source acceptance

- site regression suite: 43/43 PASS;
- local Chrome, Opera and Yandex approved-copy/public-page runs: 15 states / 48 disclosure interactions PASS each.
