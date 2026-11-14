# Callback fixtures для конечного AL-S11 rollout

Оба файла — неизменённые результаты сборки приложения SOURCE `d4eb0ccf798fbb45438f9742222425507867a99a`. Они не исполняются тестами: используются для проверки допуска точного пакета и отказа при изменённых байтах.

| Файл | Происхождение | SHA256 |
|---|---|---|
| [admin-callback-ci-d4eb0ccf.js](admin-callback-ci-d4eb0ccf.js) | GitHub Actions run 43564556119, artifact 14102365893; ZIP digest 8cce53cd527565527b69d2907f8babca5b0a3fbad936dfc1c754b52378e8bb2c проверен | 20195466e79c8cfc2d6b05b46e7ac0994fad05846821fcf2afc81b15d068fcd2 |
| [admin-callback-qualified-d4eb0ccf.js](admin-callback-qualified-d4eb0ccf.js) | Ранее квалифицированный пакет catalog-ui-d4eb0ccf.tar.gz, SHA256 e19d1ce54b4a4579af2b206327f5548b02cdc2d6039a39b0f3914c490f57b6e2 | 40a57b81a79321ed77b34876c7958a2f413d3d2d0fedc09b3517559dcd2afc58 |

В обоих callback `s(j,x,2592e3)` использует `j="__Host-alisa_staff"`, а функция s возвращает cookie с Path=/, HttpOnly, Secure, SameSite=Lax и Max-Age. Проверка полного hash заменяет эвристическое распознавание minified JavaScript. Изменённые/новые сборки не принимаются автоматически даже при эквивалентной записи числа: нужен новый подтверждённый контракт.

Это серверный код приложения с зависимостями Next.js, без аккаунтов, сессий, пользовательских данных и ключей. Не читать целиком через строковый MCP: каждый файл является длинной строкой около 18 КБ; использовать hash и короткие адресные фрагменты.
