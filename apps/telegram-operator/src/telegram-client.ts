import type {
  TelegramKeyboard,
  TelegramTransport,
  TelegramUpdate,
} from "./telegram.js";
import { MAX_SWAGGER_UPLOAD_BYTES } from "@product/monitoring-control";

type TelegramApiResponse<T> = { ok: unknown; result?: T | null };

// Bot API sendMessage resolves to a Message, not to a Boolean or a
// truthy object. No positive message identifier means no delivery ACK.
function hasConfirmedMessageId(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const id = (value as { message_id?: unknown }).message_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

// A long-poll page is untrusted network input, not a local file. Bound raw
// JSON bytes before allocating the decoded string and parsed objects.
const MAX_TELEGRAM_API_RESPONSE_BYTES = 8 * 1024 * 1024;

async function readBoundedTelegramApiResponse<T>(
  response: Response,
): Promise<TelegramApiResponse<T>> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > MAX_TELEGRAM_API_RESPONSE_BYTES
    ) {
      void response.body?.cancel().catch(() => {});
      throw new Error("TELEGRAM_API_RESPONSE_TOO_LARGE");
    }
  }
  if (!response.body) throw new Error("TELEGRAM_API_RESPONSE_BODY_MISSING");

  const reader = response.body.getReader();
  let bytes = new Uint8Array(0);
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array))
        throw new Error("TELEGRAM_API_RESPONSE_BODY_INVALID");
      if (value.byteLength > MAX_TELEGRAM_API_RESPONSE_BYTES - total)
        throw new Error("TELEGRAM_API_RESPONSE_TOO_LARGE");
      const required = total + value.byteLength;
      if (required > bytes.byteLength) {
        const capacity = Math.min(
          MAX_TELEGRAM_API_RESPONSE_BYTES,
          Math.max(required, bytes.byteLength * 2, 64 * 1024),
        );
        const grown = new Uint8Array(capacity);
        grown.set(bytes.subarray(0, total));
        bytes = grown;
      }
      // The stream is permitted to reuse or mutate its previous value.
      bytes.set(value, total);
      total = required;
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(
      new TextDecoder().decode(bytes.subarray(0, total)),
    ) as TelegramApiResponse<T>;
  } catch {
    throw new Error("TELEGRAM_API_RESPONSE_INVALID");
  }
}

export function createTelegramTransport(
  token: string,
  fetcher: typeof fetch = fetch,
): TelegramTransport {
  const endpoint = `https://api.telegram.org/bot${token}`;
  async function call<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    // Bound every API exchange so a pending command cannot block shutdown.
    // A timed-out mutating request is UNKNOWN. This transport does not retry;
    // caller-side durability across restart remains a separate requirement.
    const signal = AbortSignal.timeout(30_000);
    const response = await fetcher(`${endpoint}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error("TELEGRAM_" + method.toUpperCase() + "_FAILED");
    }
    const payload = await readBoundedTelegramApiResponse<T>(response);
    // JSON is untrusted, regardless of the TypeScript assertion in the
    // bounded decoder. A malformed success must never mark a send as ACKed.
    if (
      payload?.ok !== true ||
      payload.result == null ||
      (method === "sendMessage" && !hasConfirmedMessageId(payload.result)) ||
      (method === "answerCallbackQuery" && payload.result !== true)
    ) {
      throw new Error(`TELEGRAM_${method.toUpperCase()}_FAILED`);
    }
    return payload.result;
  }
  return {
    async getUpdates(offset) {
      const updates = await call<
        Array<{
          update_id: number;
          message?: {
            chat: { id: number };
            from?: { id: number };
            text?: string;
            caption?: string;
            document?: {
              file_id: string;
              file_name?: string;
              file_size?: number;
              mime_type?: string;
            };
          };
          callback_query?: {
            id: string;
            from: { id: number };
            data?: string;
            message?: { chat: { id: number } };
          };
        }>
      >("getUpdates", {
        offset,
        timeout: 20,
        allowed_updates: ["message", "callback_query"],
      });
      if (!Array.isArray(updates)) throw new Error("TELEGRAM_UPDATES_INVALID");
      // Validate the complete raw page before any command can be dispatched.
      // A malformed or repeated update_id must not advance the poll cursor.
      let previousId = -1;
      for (const update of updates) {
        if (
          !update ||
          typeof update !== "object" ||
          !Number.isSafeInteger(update.update_id) ||
          update.update_id < 0 ||
          update.update_id >= Number.MAX_SAFE_INTEGER
        )
          throw new Error("TELEGRAM_UPDATE_ID_INVALID");
        if (update.update_id <= previousId)
          throw new Error("TELEGRAM_UPDATE_ID_ORDER_INVALID");
        previousId = update.update_id;
      }
      const mapped: TelegramUpdate[] = [];
      for (const update of updates) {
        if (
          update.message?.from &&
          (update.message.text || update.message.document)
        ) {
          mapped.push({
            updateId: update.update_id,
            message: {
              chatId: String(update.message.chat.id),
              userId: String(update.message.from.id),
              text: update.message.text,
              caption: update.message.caption,
              document: update.message.document
                ? {
                    fileId: update.message.document.file_id,
                    fileName: update.message.document.file_name,
                    fileSize: update.message.document.file_size,
                    mimeType: update.message.document.mime_type,
                  }
                : undefined,
            },
          });
        } else if (
          update.callback_query?.message?.chat &&
          update.callback_query.data
        ) {
          mapped.push({
            updateId: update.update_id,
            callbackQuery: {
              id: update.callback_query.id,
              chatId: String(update.callback_query.message.chat.id),
              userId: String(update.callback_query.from.id),
              data: update.callback_query.data,
            },
          });
        }
      }
      return {
        updates: mapped,
        // Unsupported updates are still consumed. A full raw page must not
        // hide every subsequent operator command behind an unchanged offset.
        nextOffset: updates.reduce(
          (next, update) =>
            Number.isSafeInteger(update.update_id) && update.update_id >= 0
              ? Math.max(next ?? 0, update.update_id + 1)
              : next,
          offset,
        ),
      };
    },
    async downloadFile(fileId: string, maxBytes = MAX_SWAGGER_UPLOAD_BYTES) {
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 ||
        maxBytes > MAX_SWAGGER_UPLOAD_BYTES
      ) {
        throw new Error("TELEGRAM_FILE_LIMIT_INVALID");
      }
      const file = await call<{ file_path?: string }>("getFile", {
        file_id: fileId,
      });
      if (
        typeof file.file_path !== "string" ||
        file.file_path.trim().length === 0
      ) {
        throw new Error("TELEGRAM_FILE_PATH_MISSING");
      }
      const response = await fetcher(
        "https://api.telegram.org/file/bot" + token + "/" + file.file_path,
        { signal: AbortSignal.timeout(60_000) },
      );
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error("TELEGRAM_FILE_DOWNLOAD_FAILED");
      }
      const declared = response.headers.get("content-length");
      if (declared !== null) {
        const length = Number(declared);
        if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
          void response.body?.cancel().catch(() => {});
          throw new Error("TELEGRAM_FILE_TOO_LARGE");
        }
      }
      if (!response.body) throw new Error("TELEGRAM_FILE_BODY_UNAVAILABLE");
      const reader = response.body.getReader();
      // Retain at most a bounded contiguous buffer, not one object per HTTP
      // chunk. Some valid streaming sources reuse the same Uint8Array.
      let bytes = new Uint8Array(0);
      let total = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array))
            throw new Error("TELEGRAM_FILE_BODY_INVALID");
          if (value.byteLength === 0) continue;
          if (value.byteLength > maxBytes - total)
            throw new Error("TELEGRAM_FILE_TOO_LARGE");
          const required = total + value.byteLength;
          if (required > bytes.byteLength) {
            const capacity = Math.min(
              maxBytes,
              Math.max(required, bytes.byteLength * 2, 64 * 1024),
            );
            const grown = new Uint8Array(capacity);
            grown.set(bytes.subarray(0, total));
            bytes = grown;
          }
          bytes.set(value, total);
          total = required;
        }
      } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      return bytes.slice(0, total);
    },
    async sendMessage(
      chatId: string,
      text: string,
      keyboard?: TelegramKeyboard,
    ) {
      await call("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: keyboard,
      });
    },
    async answerCallback(callbackQueryId: string, text: string) {
      await call("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text,
      });
    },
  };
}
