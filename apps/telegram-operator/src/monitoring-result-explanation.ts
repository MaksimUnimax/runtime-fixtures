import type { MonitoringNotification } from "@product/monitoring-control";

type KnownExplanation = {
  lane: MonitoringNotification["lane"];
  status: MonitoringNotification["result"]["status"];
  text: string;
};

// Match the producer's lane, status and code together. Never infer a cause from
// summary: it can contain arbitrary upstream text and is not structured proof.
const explanations: Readonly<Record<string, KnownExplanation>> = {
  PROVIDER_SURFACE_DRIFT: {
    lane: "LLM",
    status: "FAILED",
    text: "На публичной странице сайта ИИ найдены признаки изменения или сбоя. Нужно проверить, затронуты ли нужные расширению элементы страницы.",
  },
  AUTH_REQUIRED: {
    lane: "LLM",
    status: "AUTH_REQUIRED",
    text: "Часть страниц ИИ нельзя проверить без входа в аккаунт. Эти страницы остаются непроверенными; это не доказательство поломки.",
  },
  NO_SESSION_NOT_OBSERVABLE: {
    lane: "LLM",
    status: "NOT_OBSERVABLE",
    text: "В текущих условиях не удалось проверить публичные страницы ИИ. Отчёт не позволяет определить, мешает ли сайт, сеть или браузер.",
  },
  HEALTH_SCHEDULER_EXECUTION_FAILED: {
    lane: "LLM",
    status: "FAILED",
    text: "Часть автоматических проверок ИИ не завершилась. В этом отчёте нет точной причины сбоя. По нему нельзя заключить, что сайт сломался или требуется вход в аккаунт.",
  },
  API_SOURCE_UNAVAILABLE: {
    lane: "SWAGGER_API",
    status: "SOURCE_UNAVAILABLE",
    text: "Не удалось получить официальный документ для проверки API маркетплейса. Изменения в этом API пока не проверены.",
  },
  API_WATCH_REPORT_BLOCKED: {
    lane: "SWAGGER_API",
    status: "NOT_OBSERVABLE",
    text: "Сравнение документов API маркетплейсов заблокировано: нет принятых исходных документов для этой проверки. Отчёт не уточняет, не удалось ли их получить или подтвердить.",
  },
  API_WATCH_REPORT_PARTIAL: {
    lane: "SWAGGER_API",
    status: "NOT_OBSERVABLE",
    text: "Документы API маркетплейсов проверены частично. Часть источников осталась непроверенной; считать, что изменений нет, нельзя.",
  },
  API_WATCH_REPORT_COMPLETED: {
    lane: "SWAGGER_API",
    status: "SUCCEEDED",
    text: "Обработка документов API маркетплейсов завершена. В этом сообщении нет результата сравнения: оно не означает, что изменений нет или что прежняя проблема исправлена.",
  },
  API_WATCH_REPORT_FAILED: {
    lane: "SWAGGER_API",
    status: "FAILED",
    text: "Не удалось завершить проверку документов API маркетплейсов. Точная причина в этом отчёте не указана; исправность расширения не подтверждена.",
  },
};

const extensionBoundary =
  "Работа кнопок расширения и проверка под учётной записью этим сообщением не подтверждены.";

export function explainMonitoringResult(
  notification: MonitoringNotification,
): string {
  const { lane, result, source } = notification;
  const known = result.code ? explanations[result.code] : undefined;
  let text: string;
  if (known && known.lane === lane && known.status === result.status) {
    text = known.text;
  } else if (
    result.code === "MONITORING_EXECUTION_FAILED" &&
    result.status === "FAILED"
  ) {
    text =
      "Служба мониторинга не смогла завершить проверку. Точная причина в этом отчёте не указана; это не доказательство поломки проверяемого сайта.";
  } else if (result.status === "SUCCEEDED" && result.code === null) {
    text =
      lane === "LLM" && source === "SCHEDULED"
        ? "Цикл автоматических проверок завершён без зарегистрированной ошибки выполнения. В этом сообщении нет перечня фактически проверенных сайтов."
        : "Проверка завершилась. В этом сообщении нет сведений о полноте проверки и найденных изменениях.";
  } else {
    text =
      "В отчёте недостаточно сведений, чтобы объяснить результат проверки. Неизвестные или противоречивые данные требуют разбора; считать всё исправным нельзя.";
  }
  const label = lane === "LLM" ? "Сайты ИИ" : "API маркетплейсов";
  return `${label}: ${text}${lane === "LLM" ? ` ${extensionBoundary}` : ""}`;
}
