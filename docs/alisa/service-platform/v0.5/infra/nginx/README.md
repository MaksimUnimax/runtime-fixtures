# Только новые vhosts Алисы

Примеры не установлены и не прогнаны через nginx -t на целевом сервере. `01-http` — первый временный этап; `02-https` **заменяет**, а не дублирует те же шесть HTTP blocks и добавляет TLS. Одновременное включение обоих примеров создаёт конфликт server_name и запрещено. Не изменять default vhost/старый lab.

Webroot `/var/www/alisa-platform-acme` создаётся отдельно с разрешением чтения nginx. Перед `02-https` должны существовать все шесть cert directories. Права private keys сохраняет ACME-клиент; не делать chmod world-readable. Не добавлять AAAA/listen IPv6 без готовой сети.

При переходе к приложению `location /` заменяется проверенным upstream только данного host. Marker не отражает здоровье приложения и не даёт готовность платформы. Stage доступ настраивается отдельно и не может сломать нужные protocol callbacks. Нет `includeSubDomains/preload`, wildcard или изменений корня octoport.ru.
