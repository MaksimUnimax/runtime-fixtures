# Получение ключей для хаба Octoport

Проверено 21 ноября 2026 года. Зайдите в кабинет поставщика, создайте ключ и сразу сохраните его в **Администрирование → Хаб моделей → Ключи хаба**. Выберите поставщика и задайте метку, например `Основной`. Если ключ этой организации уже сохранён, тот же ключ используется для других поддерживаемых моделей. Каждый поставщик учитывает расход по своим правилам.

Актуальные задачи по недостающим ключам выводятся выше формы. Состояние авторизации, тарифа и успешность ответа видны в разделе «Прямые маршруты». Хранение ключа само по себе не включает модель для клиентского трафика. При лимите расходов проекта до $2 платные тарифы и платное превышение квоты не включать.

## Бесплатные модели или возобновляемая квота

| Поставщик | Как получить ключ | Условия |
| --- | --- | --- |
| [Z.ai](https://z.ai/manage-apikey/apikey-list) | Войдите в Z.ai, откройте API Keys и создайте Standard API Key. | GLM-4.7-Flash, GLM-4.5-Flash и GLM-4.6V-Flash имеют нулевые ставки. Варианты FlashX тарифицируются отдельно. [Источник](https://docs.z.ai/guides/overview/pricing) |
| [GroqCloud](https://console.groq.com/keys) | Войдите, выберите организацию с Free Plan. В API Keys нажмите Create API Key. | Для нескольких моделей есть бесплатная квота на организацию. Ограничения по запросам и токенам зависят от модели. [Источник](https://console.groq.com/docs/rate-limits) |
| [Google AI Studio](https://aistudio.google.com/apikey) | Выберите проект в AI Studio, откройте API keys и нажмите Create API key. | Один ключ проекта для обеих Gemma 4. Область применения определяется условиями проекта и проверкой хаба. [Источник](https://ai.google.dev/gemini-api/docs/pricing) |
| [Cloudflare](https://dash.cloudflare.com/profile/api-tokens) | Войдите в Cloudflare, откройте API Tokens → Create Token. Хабу нужны Workers AI и чтение подписок аккаунта (Billing Read). Сохраните Account ID отдельно в хабе. | Для бесплатного маршрута хаб проверяет план Workers Free и разрешения токена. [Источник](https://developers.cloudflare.com/workers-ai/platform/pricing/) |

## Испытания и прототипы

| Поставщик | Как получить ключ | Условия |
| --- | --- | --- |
| [NVIDIA Build](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b/build) | Войдите в NVIDIA Developer, откройте страницу модели, нажмите Get API Key и сгенерируйте ключ. | Четыре кандидата Nemotron в текущем каталоге. Публичные условия бесплатного API разрешают внутренние испытания. [Источник](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf) |
| [Mistral AI](https://console.mistral.ai/api-keys) | Войдите в Mistral Studio. В своём workspace выберите бесплатный режим Experiment, откройте API Keys и нажмите New key. | Бесплатный режим для оценки и прототипов. Лимиты действуют на организацию. [Источник](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them) |
| [Cohere](https://dashboard.cohere.com/api-keys) | Войдите в Dashboard, откройте API Keys и скопируйте Trial key. | При регистрации выдаётся ограниченный ключ для оценки. Для клиентского сервиса нужны условия Production. [Источник](https://docs.cohere.com/docs/going-live) |

## Разовый стартовый кредит

| Поставщик | Как получить ключ | Условия |
| --- | --- | --- |
| [Liquid AI](https://console.liquid.ai/) | Войдите в консоль, выберите свою организацию, откройте API Keys и создайте ключ. | LFM3-1.7B тарифицируется. Новая организация получает $2 стартового кредита. [Источник](https://www.liquid.ai/pricing) |
| [SiliconFlow](https://cloud.siliconflow.com/account/ak) | Войдите в международную консоль. В API Keys нажмите Create API Key. В Models проверьте цену нужного ID. | Международная платформа указывает $1 стартового кредита. Нулевую ставку каждой модели проверяют отдельно. [Источник](https://www.siliconflow.com/pricing) |
| [Cerebras](https://cloud.cerebras.ai/) | Войдите в Cloud Console, откройте API Keys и создайте ключ. Для получения пробного кредита поставщик просит подтвердить карту. | Разовый кредит $5 на 30 дней после проверки карты. Постоянной бесплатной квоты у этого тарифа нет. [Источник](https://inference-docs.cerebras.ai/support/rate-limits) |

## Кабинеты с платным прямым API

| Поставщик | Как получить ключ | Условия |
| --- | --- | --- |
| [Ant Ling](https://chat.ant-ling.com/open) | Войдите в API Console, привяжите Alipay и нажмите Create Token. | Прямой Ling-3.2-Flash тарифицируется. [Источник](https://developer.ant-ling.com/en/docs/models/price/) |
| [Baidu Qianfan](https://console.bce.baidu.com/iam/#/iam/apikey/list) | Войдите в Baidu AI Cloud. В Security Authentication → API Key нажмите Create API Key. В Add Permissions выберите Qianfan ModelBuilder. | ERNIE-5.5-Flash-Preview имеет платную ставку. [Источник](https://cloud.baidu.com/product/qianfan_home/model_3.html) |
| [Particle AI](https://platform.particle.ai/) | Войдите в Particle Platform через Google, откройте раздел API Keys и создайте ключ. | Обычный ключ Particle-1 требует положительного баланса. Исключение действует для ключа со специально выданным бесплатным доступом. [Источник](https://docs.particle.ai/usage-billing) |
| [Hugging Face Inference Providers](https://huggingface.co/settings/tokens) | Войдите, нажмите Create new token, выберите Fine-grained и включите Make calls to Inference Providers. | Агрегатор. Для Free-аккаунта актуальная таблица не даёт ежемесячных кредитов. [Источник](https://huggingface.co/docs/inference-providers/main/pricing) |

## Исключения для регистрации

- **Dots Studio**. Регистрация недоступна для проекта. Не предлагать регистрацию повторно.
- **Atlas Cloud**. По решению владельца исключён из регистрации. Продолжать проверять состояние уже сохранённого ключа.
- **Recursive Flint v1**. На [официальном сайте](https://recursive.com/) опубликованы веса и доступ через OpenRouter. Выдача отдельного ключа Recursive для hosted API не подтверждена.

В первом снимке каталога хаба 21 ноября было 12 текстовых кандидатов с поддержкой инструментов. Это две Google Gemma 4 (26B-A4B, 31B), четыре NVIDIA Nemotron (3 Nano Omni, 3 Ultra, 3.5 Lightning и 3.5 Super VL), а также Dots 3 Note Preview, Ling 3.2 Flash, Liquid LFM3-1.7B, Baidu ERNIE 5.5 Flash Preview, Particle-1 и Recursive Flint v1. При обновлении в 08:51 по UTC+5 Dots 3 Note Preview исчез из каталога, осталось 11 кандидатов. Дополнительные кабинеты в справочнике расширяют выбор за пределами этого снимка.

Для Z.ai подключены три профиля прямого вызова. Хаб проверяет точный идентификатор и четыре ставки в опубликованной таблице перед обращением. До проверки собственным ключом эти маршруты остаются вне выдачи. Для Groq нужен отдельный допуск конкретной организации на бесплатном тарифе. Для остальных кандидатов справочник даёт возможность зарегистрировать ключ для последующей интеграции и прямой проверки.
