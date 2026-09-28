import {
  NotificationDeliveryError,
  type NotificationDeliveryPort,
  type NotificationDeliveryReceipt,
  type NotificationDeliveryRequest,
} from "@product/health";

const MAX_MESSAGE_LENGTH = 4_096;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RETRY_AFTER_SECONDS = 3_600;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const ROUTE = "OWNER_MONITORING";

type SafePayload = {
  eventKind: string;
  provider: string;
  surface: string;
  healthLevel: string;
  healthState: string;
  severity: string;
  observedAt: string;
  incidentId: string;
  healthRunId: string;
};

type TelegramResponse = {
  ok?: boolean;
  result?: { message_id?: number };
  parameters?: { retry_after?: number };
};

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    return undefined;
  if (containsControlCharacter(value)) return undefined;
  return value;
}

function safePayload(value: Readonly<Record<string, unknown>>): SafePayload {
  const result: SafePayload = {
    eventKind: boundedText(value.eventKind, 32) ?? "",
    provider: boundedText(value.provider, 32) ?? "",
    surface: boundedText(value.surface, 64) ?? "",
    healthLevel: boundedText(value.healthLevel, 2) ?? "",
    healthState: boundedText(value.healthState, 16) ?? "",
    severity: boundedText(value.severity, 16) ?? "",
    observedAt: boundedText(value.observedAt, 40) ?? "",
    incidentId: boundedText(value.incidentId, 36) ?? "",
    healthRunId: boundedText(value.healthRunId, 36) ?? "",
  };
  if (Object.values(result).some((field) => field.length === 0)) {
    throw new NotificationDeliveryError("PERMANENT_PROVIDER_REJECTION");
  }
  return result;
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  chatgpt: "ChatGPT",
  alice: "Алиса",
  claude: "Claude",
  gemini: "Gemini",
  grok: "Grok",
  kimi: "Kimi",
  deepseek: "DeepSeek",
  qwen: "Qwen",
};

const SURFACE_LABELS: Readonly<Record<string, string>> = {
  "chatgpt:standard": "обычный чат",
  "chatgpt:CHATGPT_STANDARD": "обычный чат",
  "chatgpt:work": "рабочий режим",
  "chatgpt:CHATGPT_WORK": "рабочий режим",
  "alice:ALICE": "страница чата",
  "deepseek:DEEPSEEK": "страница чата",
  "grok:GROK": "страница чата",
  "claude:CLAUDE": "страница чата",
  "gemini:GEMINI": "страница чата",
  "qwen:QWEN": "страница чата",
  "kimi:KIMI": "страница чата",
};

const CONTOUR_LABELS: Readonly<Record<string, string>> = {
  C01_PAGE_IDENTITY: "распознавание страницы",
  C02_CONVERSATION_ROOT: "область текущего диалога",
  C03_COMPOSER_ROOT: "область ввода",
  C04_COMPOSER_INPUT: "ввод текста",
  C05_SEND_CONTROL: "кнопка отправки",
  C06_BUSY_STOP_STATE: "начало и остановка ответа",
  C07_ASSISTANT_MESSAGE: "распознавание ответа ИИ",
  C08_MESSAGE_COMPLETION: "завершение ответа",
  C09_COMMAND_CODE_BLOCK_SURFACE: "блок кода в ответе",
  C10_NATIVE_COPY_CONTROL: "копирование кода",
  C11_CONVERSATION_IDENTITY: "принадлежность ответа текущему диалогу",
  C12_DELIVERY_INSERTION_PATH: "вставка результата в нужный диалог",
  C13_BLOCKING_STATE: "состояние, мешающее проверке",
};

const LEVEL_LABELS: Readonly<Record<string, string>> = {
  H0: "Проверялись настройки без открытия сайта.",
  H1: "Проверялся сохранённый пример страницы, а не текущий сайт.",
  H2: "Проверялись элементы страницы. Получение ответа ИИ этим уровнем не подтверждается.",
  H3: "Проверялся контрольный сценарий общения с ИИ.",
  H4: "Проверялся кандидат исправления. Ручное одобрение и выпуск этим результатом не подтверждаются.",
  H5: "Проверялось поведение после ограниченного выпуска. Работа у всех пользователей этим результатом не подтверждается.",
};

const STATE_LABELS: Readonly<Record<string, string>> = {
  HEALTHY: "В проверенном сценарии ошибок не обнаружено.",
  DRIFT:
    "Структура страницы изменилась; проверка прошла с запасным способом распознавания.",
  DEGRADED: "Часть проверенных возможностей работает хуже или недоступна.",
  BROKEN: "Обязательная часть проверяемого сценария не прошла проверку.",
  UNKNOWN:
    "Работоспособность определить не удалось. Точная причина в этом сообщении не указана.",
  MAINTENANCE: "Проверяемый сценарий временно отключён оператором.",
};

function knownLabel(
  labels: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  return Object.hasOwn(labels, key) ? labels[key] : undefined;
}

function observedTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value)
    return "Время проверки не распознано.";
  const local = new Date(date.valueOf() + 5 * 60 * 60 * 1_000);
  const iso = local.toISOString();
  return `Время проверки: ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} ${iso.slice(11, 16)} (+05).`;
}

function eventExplanation(safe: SafePayload): string {
  const state = knownLabel(STATE_LABELS, safe.healthState);
  if (safe.eventKind === "INCIDENT_RECOVERED") {
    return safe.healthState === "HEALTHY"
      ? "Ранее обнаруженная проблема больше не воспроизводится в этой проверке."
      : "В отчёте противоречивые данные: восстановление не подтверждено.";
  }
  if (safe.eventKind === "MAINTENANCE_ENTERED")
    return safe.healthState === "MAINTENANCE"
      ? STATE_LABELS.MAINTENANCE!
      : "В отчёте противоречивые данные о режиме обслуживания.";
  if (safe.eventKind === "MAINTENANCE_EXITED")
    return safe.healthState === "MAINTENANCE"
      ? "В отчёте противоречивые данные о завершении обслуживания."
      : `Режим обслуживания завершён. ${state ?? "Текущее состояние не распознано."}`;
  if (
    safe.eventKind === "INCIDENT_OPENED" ||
    safe.eventKind === "INCIDENT_ESCALATED"
  ) {
    if (!["BROKEN", "DRIFT", "DEGRADED"].includes(safe.healthState))
      return "В отчёте противоречивые данные: наличие поломки не подтверждено.";
    const event =
      safe.eventKind === "INCIDENT_ESCALATED"
        ? "Проблема усилилась."
        : "Обнаружена проблема, требующая проверки.";
    return `${event} ${state}`;
  }
  return "Получен нераспознанный отчёт мониторинга. По нему нельзя сделать вывод об исправности.";
}

export function formatHealthNotification(
  payload: Readonly<Record<string, unknown>>,
): string {
  const safe = safePayload(payload);
  const provider =
    knownLabel(PROVIDER_LABELS, safe.provider) ??
    "Сайт ИИ (название не распознано)";
  const surface =
    knownLabel(SURFACE_LABELS, `${safe.provider}:${safe.surface}`) ??
    "режим не распознан";
  const contourKey = boundedText(payload.rootContourKey, 64);
  const contour = contourKey
    ? knownLabel(CONTOUR_LABELS, contourKey)
    : undefined;
  const lines = [
    `${provider}${surface ? ` — ${surface}` : ""}.`,
    eventExplanation(safe),
    knownLabel(LEVEL_LABELS, safe.healthLevel) ??
      "Вид проверки не распознан; её полнота неизвестна.",
    contour
      ? `Участок проверки: ${contour}.`
      : "Конкретный элемент в этом сообщении не указан.",
    "Это не полная проверка всех функций установленного расширения.",
  ];
  if (["BROKEN", "DRIFT", "DEGRADED"].includes(safe.healthState))
    lines.push(
      "Следующий шаг разработки: проверить затронутый сценарий и определить, нужно ли исправление.",
    );
  lines.push(
    "Сведения об одобрении и доставке исправления пользователям в этом сообщении отсутствуют.",
  );
  lines.push(observedTime(safe.observedAt));
  return lines.join("\n").slice(0, MAX_MESSAGE_LENGTH);
}

async function readBoundedTelegramResponse(
  response: Response,
): Promise<TelegramResponse> {
  const rawLength = response.headers.get("content-length");
  if (rawLength !== null) {
    const declaredLength = Number(rawLength);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_RESPONSE_BYTES
    ) {
      throw new Error("TELEGRAM_RESPONSE_SIZE_INVALID");
    }
  }
  if (!response.body) return {};

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("TELEGRAM_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength === 0) return {};
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed = JSON.parse(decoded) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as TelegramResponse)
    : {};
}

export class TelegramHealthNotificationDelivery
  implements NotificationDeliveryPort
{
  public constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    if (
      !/^\d{1,20}:[A-Za-z0-9_-]{8,128}$/.test(token) ||
      containsControlCharacter(token) ||
      !/^-?\d{1,20}$/.test(chatId) ||
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < 10 ||
      requestTimeoutMs > 60_000
    ) {
      throw new NotificationDeliveryError("CONFIGURATION_ERROR");
    }
  }

  public async deliver(
    request: NotificationDeliveryRequest,
  ): Promise<NotificationDeliveryReceipt> {
    if (request.routeKey !== ROUTE) {
      throw new NotificationDeliveryError("DISABLED_ROUTE");
    }
    const text = formatHealthNotification(request.payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetcher(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: this.chatId, text }),
          redirect: "error",
          signal: controller.signal,
        },
      );

      let body: TelegramResponse = {};
      try {
        body = await readBoundedTelegramResponse(response);
      } catch {
        if (controller.signal.aborted) {
          throw new NotificationDeliveryError("TRANSIENT_PROVIDER_FAILURE");
        }
        if (response.status === 429) {
          throw new NotificationDeliveryError("RATE_LIMIT");
        }
        if (response.status >= 500) {
          throw new NotificationDeliveryError("TRANSIENT_PROVIDER_FAILURE");
        }
        throw new NotificationDeliveryError("PERMANENT_PROVIDER_REJECTION");
      }

      if (response.status === 429) {
        const retryAfter = body.parameters?.retry_after;
        throw new NotificationDeliveryError(
          "RATE_LIMIT",
          typeof retryAfter === "number" &&
          Number.isFinite(retryAfter) &&
          retryAfter >= 0
            ? Math.min(MAX_RETRY_AFTER_SECONDS, retryAfter) * 1_000
            : undefined,
        );
      }
      if (response.status >= 500) {
        throw new NotificationDeliveryError("TRANSIENT_PROVIDER_FAILURE");
      }
      if (response.status === 401 || response.status === 403) {
        throw new NotificationDeliveryError("CONFIGURATION_ERROR");
      }
      const messageId = body.result?.message_id;
      if (
        !response.ok ||
        body.ok !== true ||
        !Number.isSafeInteger(messageId) ||
        Number(messageId) <= 0
      ) {
        throw new NotificationDeliveryError("PERMANENT_PROVIDER_REJECTION");
      }
      return {
        providerAdapterKey: "telegram-owner-monitoring",
        providerDeliveryId: String(messageId),
      };
    } catch (error) {
      if (error instanceof NotificationDeliveryError) throw error;
      throw new NotificationDeliveryError("TRANSIENT_PROVIDER_FAILURE");
    } finally {
      clearTimeout(timer);
    }
  }
}
