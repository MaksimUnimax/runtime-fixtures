# Chromium для управляемого владельцем тестирования Алисы

Дата: 2026-11-04 UTC. Область: сервер Alisa, отдельный проект «Октопорт маркет», ветка alisa.

## Поручение владельца

Поднять обычный оконный Chromium на сервере, дать владельцу интерактивную трансляцию для самостоятельного входа в Яндекс. Затем проводить проверки Алисы через этот браузер только по командам владельца. Подготовка браузера не является разрешением самостоятельно запускать пользовательские сценарии или публиковать навык.

## Установлено и проверено

- Штатный список устройств подтвердил Alisa online, deviceId 89049fc7-4160-4636-9ad7-89c31f9bcb32.
- Ubuntu 24.04 LTS; Chromium stable 156.0.8078.47, Snap revision 3569, официальный канал Ubuntu/Canonical.
- Отдельный непривилегированный пользователь alice-browser, постоянный профиль /home/alice-browser/snap/chromium/common/test-profile.
- Оконная сессия Xvfb :99, 1366×900, Openbox. Не использовались headless, Playwright, Chrome for Testing, --enable-automation или --no-sandbox.
- X11 TCP отключён. x11vnc и websockify слушают loopback. HTTPS-проксирование через действующий nginx с закрытым непредсказуемым маршрутом и отдельной VNC-аутентификацией. Маршрут и пароль не публикуются в Git.
- Службы alice-browser, alice-browser-display, alice-browser-window-manager, alice-browser-vnc и alice-browser-web: active при проверке около 01:37 UTC.
- На сервере около 1 ГБ RAM; дополнительно создан swap-файл /var/swap-alice-browser размером 2 ГБ с правами 0600. Браузерному user slice заданы MemoryHigh=650M, MemoryMax=1000M, MemorySwapMax=1500M. Это запас для одного рабочего браузера, не нагрузочная приёмка.
- Четыре службы аналитики остались active; nginx -t успешен; /healthz возвращает HTTP 200.
- Автоматически установленный со Snap сервис CUPS остановлен и отключён; не оставлен публичный порт печати 631. Публичные TCP listeners после настройки: штатные 22, 80, 443.

## Исправленный сбой первого запуска

Snap отказал: `/system.slice/alice-browser.service is not a snap cgroup for tag snap.chromium.chromium`.

Причина: запуск вне полноценной пользовательской systemd/DBus-сессии. Создана штатная persistent user session alice-browser, применён запуск через `systemd-run --user --scope` и пользовательский DBus. Sandbox не отключался. После исправления alice-browser active/running, NRestarts=0 на адресной проверке.

## Воспроизводимость и закрытые данные

Конфигурация desktop-служб находится в /etc/systemd/system/alice-browser*.service. Настройка HTTPS — /etc/nginx/snippets/alice-browser-location.conf; перед изменением сохранена приватная копия nginx. Provisioning script и install-completion log — /opt/alice-browser. Учётные данные трансляции и исходная конфигурация nginx сохранены только в закрытом каталоге /root/alice-lab-evidence/browser-session-20261104.

Рабочий код аналитики, marketplace credentials, OAuth навыка и матрица build8 не изменялись. Main, Easyscript и Business Bridge не затронуты.

## Границы результата

Трансляция снаружи достигла VNC-запроса пароля. Оконный Chromium запущен с исходным адресом тестовой консоли приватного навыка. Вход в Яндекс выполняет сам владелец; на момент записи успешный вход и содержимое страницы внутри Chromium ещё не подтверждены. Тестовые запросы в Алису не отправлялись. Наличие браузера не подтверждает физическую Станцию, звук, API-сценарии или production-готовность.

Следующее действие: владелец подключается к трансляции и самостоятельно авторизуется; после этого исполнитель проверяет видимое состояние и выполняет только полученные команды тестирования.
