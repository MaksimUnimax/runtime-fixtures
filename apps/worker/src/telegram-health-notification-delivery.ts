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

export function formatHealthNotification(
  payload: Readonly<Record<string, unknown>>,
): string {
  const safe = safePayload(payload);
  const text = [
    `Health ${safe.severity}: ${safe.healthState}`,
    `Provider/surface: ${safe.provider} / ${safe.surface}`,
    `Level/event: ${safe.healthLevel} / ${safe.eventKind}`,
    `Observed: ${safe.observedAt}`,
    `Incident: ${safe.incidentId}`,
    `Run: ${safe.healthRunId}`,
  ].join("\n");
  return text.slice(0, MAX_MESSAGE_LENGTH);
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
