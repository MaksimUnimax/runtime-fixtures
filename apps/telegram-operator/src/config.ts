export type TelegramOperatorEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type TelegramOperatorRuntimeConfig = {
  databaseUrl: string;
  token: string;
  operatorIds: ReadonlySet<string>;
  notificationChatIds: readonly string[];
};

function csvValues(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseTelegramOperatorConfig(
  environment: TelegramOperatorEnvironment,
): TelegramOperatorRuntimeConfig {
  const databaseUrl = environment.DATABASE_URL?.trim();
  const token = environment.TELEGRAM_BOT_TOKEN?.trim();
  if (!databaseUrl || !token) {
    throw new Error("TELEGRAM_OPERATOR_CONFIGURATION_MISSING");
  }

  const operatorIds = csvValues(environment.TELEGRAM_OPERATOR_IDS);
  if (operatorIds.length === 0) {
    throw new Error("TELEGRAM_OPERATOR_IDENTITY_INVALID");
  }

  const notificationChatIds = csvValues(
    environment.TELEGRAM_NOTIFICATION_CHAT_IDS,
  );
  if (notificationChatIds.length === 0) {
    throw new Error("TELEGRAM_NOTIFICATION_DESTINATION_INVALID");
  }

  return {
    databaseUrl,
    token,
    operatorIds: new Set(operatorIds),
    notificationChatIds,
  };
}
