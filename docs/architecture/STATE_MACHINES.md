# Состояния и переходы

## Work

| Состояние | Событие | Результат |
|---|---|---|
| UNBOUND / FINISHED | Start с выбранным магазином | STARTING, новый workSessionId/generation, отправка стартового промпта |
| STARTING | Доказана отправка промпта | ACTIVE, фиксируется baseline новых команд |
| STARTING | Доказан отказ до отправки | START_FAILED, понятное действие пользователя |
| STARTING | Исход отправки неизвестен | START_UNKNOWN, наблюдение/уточнение без повторного Send |
| ACTIVE | Клик на новый блок | RUNNING с неизменяемым контекстом пакета |
| RUNNING | Все результаты доставлены/явно завершены | ACTIVE |
| Любое рабочее | Finish / logout / конфликт новой binding revision | FINISHING → FINISHED, отмена будущих действий, generation++ |
| ACTIVE / FINISHED | Явная смена магазина | Новый draft; только следующий Start открывает новую сессию |

Show/Hide — отдельное свойство видимости. Не создавать из него pause-state.
Popup open/close не владеет Work lifecycle. Ошибка вторичного статуса не перезаписывает сохранённый основной результат.

## Элемент пакета

VALIDATED → WAITING_LOCAL_QUOTA → DISPATCHED → RECEIVED → STORED → DELIVERING → DELIVERED.
Отдельные терминальные исходы: REJECTED_LOCAL, PROVIDER_ERROR, CANCELLED_BEFORE_DISPATCH, EXECUTION_UNKNOWN, DELIVERY_UNKNOWN, RESULT_EXPIRED.
DISPATCHED не означает RECEIVED; сохранённый STORED не означает DELIVERED. При обрыве после dispatch нельзя считать, что площадка запрос не видела.
Повтор доставки из STORED допустим при доказанном отсутствии предыдущей отправки; неизвестный send сначала уточняется, второй click не выполняется автоматически.

## Асинхронные границы

После каждого ожидания перед сетевым запросом, записью результата и изменением DOM сверять accountId, storeId, credentialRevision, conversationKey, bindingRevision и generation.
Несовпадение отклоняет позднее действие. Результат старого магазина не переназначается новому.
Запись в IndexedDB считается состоявшейся только после transaction complete; request success недостаточно.
Попытка вернуться к старой сессии после Finish не разрешена поздним callback.

## Привязка и служебная задача

Локальный sync status: CLEAN, PENDING, RETRY_WAIT, CONFLICT, ACKNOWLEDGED. Это не глобальный статус доступности сервиса.
CONFLICT содержит конкретную bindingRevision/storeId и безопасное объяснение; исправная работа других диалогов продолжается.
Server revision монотонна; изменяющий запрос несёт baseRevision и requestId. Старый report marker не является командой смены магазина.

## Ожидание квоты

QUEUED_FIRST_REQUEST не означает, что запрос уже ушёл. Finish удаляет его из очереди.
429 после DISPATCHED — PROVIDER_RATE_LIMITED: результат передаётся ИИ, автоматический retry не появляется.
Общий limiter одной установки учитывает deadline и подтверждённый provider account. Смена AI-профиля или вкладки не обнуляет deadline.

### Исполнение R3: терминальность и видимость

Work хранит work_session_id, монотонный work_generation, finished и finished_at. Переход в FINISHING устанавливает терминальный признак до последующих эффектов; INACTIVE сохраняет его. Обычный patch и Resume не стирают признак. Новый BINDING с новым явным Start intent создаёт новую Work и следующее поколение. Show/Hide и допустимое восстановление незавершённой Work сохраняют поколение. Dispatch уже допущенного пакета сравнивает поколение, binding, магазин и полномочия; смена только видимости не является отменой. Запись Work выполняется под существующим binding writer и подтверждается точным readback. Это не гарантия физической долговечности при полной потере storage.
