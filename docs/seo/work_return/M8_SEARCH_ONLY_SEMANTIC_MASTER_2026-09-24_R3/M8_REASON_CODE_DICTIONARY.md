# M8 reason code dictionary

Search only M8 R3. Every code has exactly one primary state. Examples are identity labels, never page decisions.

## B_PRODUCT_BRAND

- Allowed state: `BRAND_DEFENSE`.
- Definition: Product Truth enumerates the brand form for navigation defense with no assumed demand.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: New accepted product, exact demand, or Search authority that changes this referent and task.
- Representative rule example: `Октопорт` (`M8SID_f575406849a5bbfb`).

## H_CARD_CONTENT_BOUNDARY

- Allowed state: `REVIEW_HOLD`.
- Definition: Card text preparation may instead ask for standalone generation or publishing.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `M2R:line=160:B01/B01-02; NONE; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Determine operational card preparation versus standalone generator or direct publishing
- Representative rule example: `нейросеть для создания описания товаров для маркетплейсов` (`M8SID_73c933eda8a1fb06`).

## H_COMPETITOR_ONLY

- Allowed state: `REVIEW_HOLD`.
- Definition: Competitor wording does not resolve seller task, demand, intent, and product fit for this exact string.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND007261; M6SRC01945:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Public competitor wording alone cannot prove demand, referent and Octoport product fit
- Representative rule example: `10 шагов успешного запуска новинки и вывода ее в ТОП на WildBerries` (`M8SID_d0573e1e00720bff`).

## H_CREATIVE_CARD_COLLISION

- Allowed state: `REVIEW_HOLD`.
- Definition: Operational product card help cannot yet be separated from unsupported creative generation.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND006736; M6SRC05677:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Determine if this is operational card review or a standalone creative generator
- Representative rule example: `Дизайн карточки товара на Wildberries и Ozon: как выделиться в выдаче и повысить CTR` (`M8SID_adb48a9af749d948`).

## H_DEVELOPER_INTENT

- Allowed state: `REVIEW_HOLD`.
- Definition: Developer API/docs task may differ from the seller facing browser bridge.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND000512 | M4CCAND000515 | M4CCAND001644 | M4CCAND001645; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Separate API developer task from the seller-facing browser bridge
- Representative rule example: `AI Native документы и отчётность для разработчиков` (`M8SID_3ba8b65bb424c363`).

## H_EXTERNAL_INTELLIGENCE

- Allowed state: `REVIEW_HOLD`.
- Definition: External niche, market, or competitor coverage lacks endpoint level proof.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Prove exact accessible marketplace endpoints for external or niche intelligence
- Representative rule example: `Shedeux. Рост на 70% за год до 15млн/мес, сокращение операционки в нише \"нижнее белье\"` (`M8SID_39dcd4bdb762b604`).

## H_FINANCIAL_COMPLETENESS

- Allowed state: `REVIEW_HOLD`.
- Definition: Net profit, margin, or financial completeness depends on unproven inputs or definitions.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND004131 | M4QR2CD00057 | RECOVERED_TARGETED_PAGE:M4QR2TR0032:ARTICLE_OR_GUIDE:SELLER_DATA_OR_OPERATIONAL_TASK_CONTEXT_NOT_PRODUCT_CAPABILITY_PROOF; M6SRC00197:NO_INCREMENTAL_INFORMATION_GAIN | M6SRC06030:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Prove input completeness and metric definition before claiming net profit or margin
- Representative rule example: `11 шагов к увеличению маржинальности на маркетплейсах` (`M8SID_0ac1acada8ac83c3`).

## H_HUMAN_SOFTWARE_ROLE

- Allowed state: `REVIEW_HOLD`.
- Definition: The exact query may seek a human analyst, assistant, or service rather than software.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `M2R:line=650:M2R/M2R-A01; NONE; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Resolve whether the user seeks a human analyst/assistant or a software tool
- Representative rule example: `аналитик данных маркетплейсов` (`M8SID_83ebf39ad75ed5bc`).

## H_LLM_ADAPTER_UNPROVEN

- Allowed state: `REVIEW_HOLD`.
- Definition: A named web AI integration is not established as a currently supported adapter by Product Truth.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND002047; M6SRC03381:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Confirm this named web AI adapter and exact supported marketplace workflow before making a provider-specific claim
- Representative rule example: `Интеграция DeepSeek и Ozon Seller` (`M8SID_bbad8b8ac2fcc1e5`).

## H_M2R_BOUNDARY

- Allowed state: `REVIEW_HOLD`.
- Definition: M2R marked adjacency or boundary without a confirmed addressable core task.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `M2R:line=645:M2R/M2R-A01; NONE; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Resolve M2R fit and capability boundary before admitting the seller task
- Representative rule example: `eggheads аналитика маркетплейсов` (`M8SID_dbbefa4e28e5f6b3`).

## H_M4Q_AMBIGUOUS

- Allowed state: `REVIEW_HOLD`.
- Definition: Current M4Q candidate preparation explicitly carries ambiguity.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND001062; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Resolve M4Q source wording and seller intent using exact accepted evidence
- Representative rule example: `100% безопасная работа по официальному API.` (`M8SID_85a4716927e1191f`).

## H_M6_INVALID_QUERY

- Allowed state: `REVIEW_HOLD`.
- Definition: M6PC004 provider invalid query supplies no observed zero demand or resolved task.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND007963; M6SRC02978:PROVIDER_REQUIRED_DEMAND_VALIDATION`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Validate the exact return-rate demand wording with an authorized provider query
- Representative rule example: `Процент возвратов на Wildberries: как считать, анализировать и снижать` (`M8SID_ad3c3013de9a5fbd`).

## H_M6_PRODUCT_CAPABILITY

- Allowed state: `REVIEW_HOLD`.
- Definition: M6 owner reconciliation retains an unresolved product endpoint, workflow, input, or method hold.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND003705; M6SRC05565:OWNER_OR_PRODUCT_FACT_REQUIRED`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Verify the exact required marketplace data, endpoint and workflow before claiming support
- Representative rule example: `Базовые шаблоны для увеличения чистой прибыли селлера WB и Ozon` (`M8SID_fe7c275c73c6c47c`).

## H_M6_SOURCE_IDENTITY

- Allowed state: `REVIEW_HOLD`.
- Definition: M6 retained exact source candidate as ambiguous; its referent or task remains unresolved.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND007231 | M4CCAND007232; M6SRC03710:HOLD_AMBIGUOUS`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Clarify the source wording and seller task without semantic rewriting
- Representative rule example: `(title not exposed by public renderer)` (`M8SID_d4d14fc635bd815d`).

## H_OTHER_ENTITY_NAVIGATION

- Allowed state: `REVIEW_HOLD`.
- Definition: A named other vendor or entity could be the navigational referent.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND007073; M6SRC04288:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Separate named competitor/vendor navigation from the generic Octoport seller task
- Representative rule example: `10 самых популярных товаров на зарубежных маркетплейсах, которых ещё нет на Ozon` (`M8SID_54bef87e7e228988`).

## H_PROCEDURAL_OR_CURRENT_POLICY

- Allowed state: `REVIEW_HOLD`.
- Definition: Current marketplace policy or seller action cannot be asserted from report interpretation.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND005293; M6SRC03912:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Separate current marketplace policy or seller action from available historical report interpretation
- Representative rule example: `Ozon повышает комиссии для продавцов с 6 апреля` (`M8SID_92b9d35370efec50`).

## H_REPORT_ACTOR_AMBIGUITY

- Allowed state: `REVIEW_HOLD`.
- Definition: An agent or manager report could have a different actor/data meaning.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `M2R:line=837:M2R/M2R-A03; NONE; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Resolve agent/manager report meaning before assuming seller-owned marketplace API report
- Representative rule example: `отчет агента маркетплейс` (`M8SID_0c7eab3e433d9dee`).

## H_SEARCH_ONLY_PRODUCT_FIT

- Allowed state: `REVIEW_HOLD`.
- Definition: Organic Search establishes possible intent context but product fit remains unproven.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; M4A:R04R1 | M4Q:M4QR2Q00004:SERP100; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Current organic results support intent context, not exact Octoport capability or demand
- Representative rule example: `аналитика маркетплейсов для селлеров` (`M8SID_64c1a9a5c83139ce`).

## H_SOURCE_FRAGMENT

- Allowed state: `REVIEW_HOLD`.
- Definition: The source text is a heading fragment, truncated content, or implausible standalone query.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND000961; M6SRC02344:HOLD_AMBIGUOUS`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Recover an independently plausible complete user query from the source fragment
- Representative rule example: `# Визуал без фотостудии` (`M8SID_45517d8af3a1541c`).

## H_SOURCE_PRODUCT_SCOPE_CONFLICT

- Allowed state: `REVIEW_HOLD`.
- Definition: Exact seller wording conflicts with accepted out of scope source disposition.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND004137; M6SRC01845:OUT_OF_PRODUCT_SCOPE`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Review accepted source exclusion against the explicit marketplace seller task; neither source label nor token establishes product fit
- Representative rule example: `1С для торговли: маркетплейсы, ИИ-аналитика, доставка и госинтеграции в одной системе` (`M8SID_5ec5c4a36244f53c`).

## H_STATUTORY_SELLER_BOUNDARY

- Allowed state: `REVIEW_HOLD`.
- Definition: Accounting or statutory wording is mixed with seller operational reporting.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `M2R:line=838:M2R/M2R-A03; NONE; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Separate marketplace seller reporting from statutory accounting/filings
- Representative rule example: `авансовый отчет маркетплейс` (`M8SID_a9af8d44e1e22db9`).

## H_UNDER_SPECIFIED

- Allowed state: `REVIEW_HOLD`.
- Definition: The wording alone cannot establish actor, object, or seller task.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND000917; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Resolve actor, object and task for this short or generic phrase
- Representative rule example: `Android` (`M8SID_f60ed56a9c827589`).

## H_UNRESOLVED_CONTEXT

- Allowed state: `REVIEW_HOLD`.
- Definition: No accepted exact evidence resolves the wording and product job.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Obtain exact seller task, referent and product-fit evidence
- Representative rule example: `Блок \"Статистика\" в Сценариях Агента` (`M8SID_0d31d60a8163c2aa`).

## H_UNSUPPORTED_ACTION

- Allowed state: `REVIEW_HOLD`.
- Definition: A named workflow suggests an unproven write action, premium data endpoint, developer route, or promised outcome.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND005964; M6SRC01768:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: Separate seller-owned report interpretation from named premium endpoints, third-party developer flows, editing, or guaranteed outcomes
- Representative rule example: `Wildberries повышает цены на подписку «Джем»: селлеров ждет подорожание на 4–7 тысяч рублей` (`M8SID_bb16aefbc68cfe2f`).

## W_M2R_PRODUCT_MATCH

- Allowed state: `WORKING`.
- Definition: The exact wording has accepted M2R core fit with confirmed addressable bounded seller work.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `M2R:line=300:B01/B01-10; M4A:R02 | M4Q:M4QR2Q00001:SERP100; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: New accepted product, exact demand, or Search authority that changes this referent and task.
- Representative rule example: `chatgpt для ozon` (`M8SID_8c1225a6582027f4`).

## W_PRODUCT_BOUNDED_COMPETITOR_LANGUAGE

- Allowed state: `WORKING`.
- Definition: The exact seller job is supported by Product Truth in a read-only form; competitor wording supplies language only.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND007723; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: New accepted product, exact demand, or Search authority that changes this referent and task.
- Representative rule example: `Аналитика Wildberries: отчёты, метрики и дашборды продавца` (`M8SID_a5452022da8e1c54`).

## X_ACCEPTED_SOURCE_SCOPE

- Allowed state: `EXCLUDED`.
- Definition: Accepted M6 or source out of scope plus no contradictory confirmed seller job.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND004130; M6SRC03597:OUT_OF_PRODUCT_SCOPE`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: New accepted product, exact demand, or Search authority that changes this referent and task.
- Representative rule example: `10 правил успешных закупок` (`M8SID_97a710e0a97f8840`).

## X_BUYER_ONLY

- Allowed state: `EXCLUDED`.
- Definition: The exact task serves consumer shopping rather than seller owned data.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND007079; M6SRC02961:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: New accepted product, exact demand, or Search authority that changes this referent and task.
- Representative rule example: `7 ошибок в общении с покупателями на маркетплейсе и как их избежать` (`M8SID_b8c7448de53c66bf`).

## X_FOREIGN_ENTITY

- Allowed state: `EXCLUDED`.
- Definition: A different named entity/context provides no target seller data job.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND004146; M6SRC01082:OUT_OF_PRODUCT_SCOPE`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: New accepted product, exact demand, or Search authority that changes this referent and task.
- Representative rule example: `289-ФЗ на Ozon, Wildberries и Авито: что меняется для продавца` (`M8SID_3c4a6fba6b5f2550`).

## X_HUMAN_TRAINING

- Allowed state: `EXCLUDED`.
- Definition: The exact task concerns hiring, work, training, or a human profession.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND006013; M6SRC04988:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: New accepted product, exact demand, or Search authority that changes this referent and task.
- Representative rule example: `RWB Среда: обучение и мероприятия Wildberries` (`M8SID_10c9479a94f509f6`).

## X_M2R_NOISE

- Allowed state: `EXCLUDED`.
- Definition: Accepted M2R exact fit is noise and no seller task is established.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `M2R:line=839:M2R/M2R-A03; NONE; NONE; NO_EXACT_M6_SOURCE_LINK`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: New accepted product, exact demand, or Search authority that changes this referent and task.
- Representative rule example: `1с загрузка отчетов маркетплейсов` (`M8SID_1a8ac7559b1d6448`).

## X_STATUTORY_ONLY

- Allowed state: `EXCLUDED`.
- Definition: The exact task concerns statutory/accounting compliance alone.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND007351; M6SRC04814:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: New accepted product, exact demand, or Search authority that changes this referent and task.
- Representative rule example: `FAQ по документам, маркировке, ЭДО и налогам на Wildberries` (`M8SID_593b079ab8ba4d35`).

## X_THIRD_PARTY_CONNECTOR

- Allowed state: `EXCLUDED`.
- Definition: The named integration connects a different provider or software to marketplace, not the owned web AI bridge.
- Required evidence: Product Truth boundary plus exact wording and source lineage; representative frozen refs: `NONE; NONE; M4CCAND001916; M6SRC03939:NO_INCREMENTAL_INFORMATION_GAIN`. For an exclusion, accepted source disposition or explicit foreign role must be present; for a hold, preserve the exact unresolved fact.
- Forbidden inference: frequency, ranking, competitor topic, provider failure, or lexical similarity alone cannot establish state, demand, capability, or intent.
- Reopen condition: New accepted product, exact demand, or Search authority that changes this referent and task.
- Representative rule example: `Интеграция 101 и Ozon Seller` (`M8SID_407ddd7fe1fb08ea`).

