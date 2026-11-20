# Каркас сервиса на DeepSeek Harness

Самостоятельная основа для подключаемых функций личного помощника. Одна сборка работает с пустым каталогом или с композицией доверенных модулей. Каждый модуль регистрирует собственные инструменты и схемы. Для новой функции разработчик меняет композицию. Ядро, модельный промпт и команды пользователя остаются общими.

**Что уже запускается:** CLI для настройки локального тестового пространства и чата, постоянные права в SQLite, каталог, проверка доступа при обнаружении и при каждом вызове, MCP-сервер по stdio, адаптер официального MCP-клиента Harness. Одна доверенная привязка обслуживает один чат. Инструменты поставки выполняют чтение. Результат текущего прогона и граница проверки описаны в [приёмке](docs/ACCEPTANCE.md).

**Следующий технический этап:** связать область доступа с реальной серверной сессией и проверить два независимых чата в общем native runtime. Аккаунты, пользовательский интерфейс, фоновые поручения, кошелёк, мобильный клиент и отраслевые подключения описаны в целевом ТЗ и дорожной карте.

## Запуск с нуля

Требуются Python 3.12 и для адаптера Node 24. Проверки ядра выполняются без ключей модели, магазинов и платных запросов. Из корня продукта:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
mkdir -m 700 -p .local
python -m platform_core --db .local/state.sqlite3 init --actor owner --workspace shop --chat first
python -m platform_core --db .local/state.sqlite3 list --actor owner --workspace shop --chat first
```

Ожидаемый ответ последней команды — `[]`. Дальше подключите нейтральный модуль примера:

```bash
platform() {
  python -m platform_core --db .local/state.sqlite3 --composition examples.reference_plugin "$@"
}
platform grant --workspace shop --plugin reference-text
platform enable --workspace shop --actor owner --chat first --plugin reference-text
platform list --workspace shop --actor owner --chat first
platform call --workspace shop --actor owner --chat first summarize_text '{"text":"один   два"}'
platform revoke --workspace shop --plugin reference-text
platform list --workspace shop --actor owner --chat first
```

В списке появится `summarize_text`, затем вызов вернёт `{"words": 2, "normalized": "один два"}`. После отзыва список вновь пустой. Настройки сохраняются между процессами. Повторная выдача права требует нового явного включения для чата.

## Что читать и как проверить

| Документ | Для чего он нужен |
| --- | --- |
| [Техническое задание](docs/SPECIFICATION.md) | Пользовательские возможности, права, плагины, информация и деньги, мобильный клиент, условия приёмки. |
| [Архитектура](docs/ARCHITECTURE.md) | Текущие компоненты, доверенная граница, данные, дальнейшая эволюция. |
| [Руководство разработчика плагинов](docs/PLUGINS.md) | Контракт v1 и подключение к native Harness. |
| [Дорожная карта](docs/ROADMAP.md) | Этапы, зависимости, выпуск, эксплуатация и приёмка. |
| [Проверка и эксплуатация](docs/ACCEPTANCE.md) | Воспроизведение, границы первой поставки, обновление и откат. |

```bash
python -m unittest discover -s tests -v
node --test native/*.test.mjs
```
