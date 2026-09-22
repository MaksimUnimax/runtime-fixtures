import type {
  TelegramKeyboard,
  TelegramTransport,
  TelegramUpdate,
} from "./telegram.js";

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
    const response = await fetcher(`${endpoint}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
        nextOffset: mapped.length
          ? mapped[mapped.length - 1]!.updateId + 1
          : offset,
      };
    },
    async downloadFile(fileId: string) {
      const file = await call<{ file_path?: string }>("getFile", {
        file_id: fileId,
      });
      if (!file.file_path) throw new Error("TELEGRAM_FILE_PATH_MISSING");
      const response = await fetcher(
        `https://api.telegram.org/file/bot${token}/${file.file_path}`,
      );
      if (!response.ok) throw new Error("TELEGRAM_FILE_DOWNLOAD_FAILED");
      return new Uint8Array(await response.arrayBuffer());
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
