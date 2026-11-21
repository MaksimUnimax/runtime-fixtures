# Исходящий роутер моделей

Стенд открывает HTTPS-соединение через HTTP CONNECT. Роутер соединяется с API поставщика и возвращает ответ стенду в том же туннеле. Секреты передаются внутри TLS между стендом и поставщиком.

На роутере установите httpd.conf и providers.conf в /etc/octoport-provider-router/, создайте пустой подкаталог empty и установите службу octoport-provider-router.service. В router.env в том же каталоге задайте OCTOPORT_ROUTER_LISTEN как адрес и порт прослушивания. В OCTOPORT_ROUTER_CLIENTS укажите через пробел доверенные IP-адреса или CIDR. Для каждого нового поставщика добавьте точное DNS-имя API в providers.conf. Перезапустите octoport-provider-router.service после изменения настроек.

На стенде задайте HARNESS_MODEL_EGRESS_PROXY в /etc/octoport-provider-router-client.env. Значение — HTTP URL роутера с портом. Установите model-egress.conf в каталог drop-in службы приложения и службы octoport-hub-catalog.service. Путь к общему файлу настроек одинаков для обеих служб. После изменения адреса перезапустите приложение и обновите каталог.

Проверка маршрута с сервера стенда:

    curl --proxy "$HARNESS_MODEL_EGRESS_PROXY" https://openrouter.ai/cdn-cgi/trace

Поле ip должно совпадать с внешним IP роутера. Проверки отдельных моделей должны использовать тот же клиент для поставщиков.
