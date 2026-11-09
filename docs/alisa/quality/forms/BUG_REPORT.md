# BUG · <legacy ID или QA-YYYYMMDD-TESTER-8hex>

State: NEW. Role: TESTER. Run ID: <обязателен>. Source kind: BUG / CAPABILITY_GAP / PROVIDER_ERROR / PROVIDER_FORMAT / PREVENTED / ACCEPTANCE_RULE / LIMITATION / RESEARCH_FIX / RESEARCH_TOOLING.

## Версия и границы
Build/path и SHA: <значение или UNKNOWN с причиной>. Catalog/source/decoder version: <значение>. Канал: OFFLINE / RECORDED_PROVIDER / LIVE_PROVIDER / LIVE_DIALOGS / PHYSICAL_STATION. UTC: <время>. Был ли изменён runtime: <нет/точный diff>.

## Воспроизведение
Безопасная исходная реплика и уточнения по порядку. Конкретные параметры заменены на типизированные placeholders там, где это частные данные. Expected: смысл, ось даты, единица, валюта и независимый synthetic gold. Actual: очищенный ответ/код. Минимальные шаги. Частота повторения и что действительно повторялось.

## Доказательства
Run/evidence_ref, hash и факт наличия. HTTP/LLM counts. Webhook, job-to-ready, provider и UI timings отдельно; null означает не измерено. Не вставлять credentials/cookies/полный Request/покупательские строки.

## Разбор
Severity P0/P1/P2/P3 или UNSET, основание. Причина: подтверждена чем / гипотеза / неизвестна. Связанный candidate/issue. Исправлено в исследовании не означает установлено в сервис.

## Возврат на проверку
Заполняет интегратор: fix commit; package hash; test IDs; expected changed behavior; regression scope; candidate/active status. Тестер: отдельный retest run, target version, PASS/FAIL/PARTIAL, незакрытые пункты.
