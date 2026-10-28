import type {
  TelegramKeyboard,
  TelegramTransport,
  TelegramUpdate,
} from "./telegram.js";
import { MAX_SWAGGER_UPLOAD_BYTES } from "@product/monitoring-control";

type TelegramApiResponse<T> = { ok: boolean; result?: T };

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
    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined)
      throw new Error(`TELEGRAM_${method.toUpperCase()}_FAILED`);
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
      if (!file.file_path) throw new Error("TELEGRAM_FILE_PATH_MISSING");
      const response = await fetcher(
        "https://api.telegram.org/file/bot" + token + "/" + file.file_path,
        { signal: AbortSignal.timeout(60_000) },
      );
      if (!response.ok) throw new Error("TELEGRAM_FILE_DOWNLOAD_FAILED");
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
      const chunks: Uint8Array[] = [];
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
          total += value.byteLength;
          chunks.push(value);
        }
      } catch (error) {
        void reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
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
