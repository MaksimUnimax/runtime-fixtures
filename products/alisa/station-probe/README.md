> **Актуализация 08.11.2026 — автоответ R1 установлен.** Однократный QR на нашем сайте разрешён владельцем; сессия сохраняется, ручного голосового кода и ручных сценариев нет. В админке: автоответ вкл/выкл, серверный таймер **10 секунд** (10–300), сообщения ожидания и ручная фраза (по умолчанию «результат»). Готовый отчёт доставляется отдельным вызовом навыка, не ждёт интервала. **31/31 проверок и установка PASS; полный физический прогон владельца ещё открыт.** Новый обычный клиент и персональное имя из сайта этим выпуском не закрыты. [Действующий путь, тесты, границы и roadmap](https://github.com/MaksimUnimax/runtime-fixtures/blob/alisa/docs/alisa/quality/STATION_AUTO_DELIVERY_R1_2026-11-08.md). Текст ниже сохраняет исходную фиксацию своего этапа; прежние 15 секунд относятся только к историческому probe.

# Station delivery probe

Isolated owner-only transport probe. It uses a separate QR-approved Yandex session,
creates only its own scenario on the explicitly selected speaker, and sends only
two fixed non-financial commands. It does not change skill linking or marketplace
runtime. Yandex's internal Quasar interface is experimental.

The access link carries a random capability in its fragment; the browser removes
the fragment and keeps it only in sessionStorage. Requests require this capability
and the exact HTTPS Origin. Session cookies and QR state are memory-only and expire
with the three-hour probe. No tokens or customer responses enter logs.

Run `python3 -B -m unittest discover -v` for offline checks. See REPORT.md for the
installed version, current evidence, and the owner test.
