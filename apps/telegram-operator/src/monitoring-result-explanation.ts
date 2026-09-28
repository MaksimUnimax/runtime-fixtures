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
  API_SOURCE_CANDIDATE_ACQUIRED: {
    lane: "SWAGGER_API",
    status: "SUCCEEDED",
    text: "Официальный документ API получен и прошёл проверку источника. Само получение документа ещё не означает, что версия API сравнена с принятой продуктовой базой.",
  },
  OPERATOR_SOURCE_REQUIRED: {
    lane: "SWAGGER_API",
    status: "SOURCE_UNAVAILABLE",
    text: "Для одного или нескольких официальных документов нужен разрешённый операторский источник. Сравнение соответствующей части API не выполнено.",
  },
  API_SOURCE_TEMPORARILY_UNAVAILABLE: {
    lane: "SWAGGER_API",
    status: "NOT_OBSERVABLE",
    text: "Официальный источник API временно недоступен. Сравнение этой части API не выполнено; поломка расширения не подтверждена.",
  },
  SOURCE_URL_AUTHORITY_MISSING: {
    lane: "SWAGGER_API",
    status: "NOT_OBSERVABLE",
    text: "Для одного или нескольких источников API нет принятой официальной адресной основы. Сравнение не выполнялось.",
  },
  INVALID_OFFICIAL_SOURCE_RESPONSE: {
    lane: "SWAGGER_API",
    status: "FAILED",
    text: "Ответ официального источника API отклонён проверкой формата или происхождения. По этому результату нельзя считать API проверенным или расширение сломанным.",
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
    text: "Обработка документов API маркетплейсов завершена. Итог ниже относится только к фактически выполненной проверке и не подтверждает работу расширения.",
  },
  API_WATCH_REPORT_FAILED: {
    lane: "SWAGGER_API",
    status: "FAILED",
    text: "Не удалось завершить проверку документов API маркетплейсов. Точная причина в этом отчёте не указана; исправность расширения не подтверждена.",
  },
};

const extensionBoundary =
  "Работа кнопок расширения и проверка под учётной записью этим сообщением не подтверждены.";

const targetLabels: Readonly<Record<string, string>> = {
  CHATGPT_STANDARD: "ChatGPT Standard",
  CHATGPT_WORK: "ChatGPT Work",
  ALICE: "Алиса",
  DEEPSEEK: "DeepSeek",
  GROK: "Grok",
  CLAUDE: "Claude",
  GEMINI: "Gemini",
  QWEN: "Qwen",
  KIMI: "Kimi",
  OZON_SELLER: "Ozon Seller",
  OZON_PERFORMANCE: "Ozon Performance",
  WILDBERRIES: "Wildberries",
};

function targetLabel(target: string): string {
  const [scope] = target.split(":", 1);
  return targetLabels[target] ?? targetLabels[scope ?? ""] ?? target;
}

function compactTargets(targets: readonly string[]): string {
  const labels = [...new Set(targets.map(targetLabel))];
  const visible = labels.slice(0, 8);
  return labels.length > visible.length
    ? `${visible.join(", ")} и ещё ${labels.length - visible.length}`
    : visible.join(", ");
}

function observedAtPlusFive(value: string | null): string | null {
  if (!value) return null;
  const shifted = new Date(new Date(value).valueOf() + 5 * 60 * 60 * 1000);
  if (!Number.isFinite(shifted.valueOf())) return null;
  const two = (part: number) => String(part).padStart(2, "0");
  return `${two(shifted.getUTCDate())}.${two(
    shifted.getUTCMonth() + 1,
  )}.${shifted.getUTCFullYear()} ${two(shifted.getUTCHours())}:${two(
    shifted.getUTCMinutes(),
  )} +05`;
}

function explainCoverage(notification: MonitoringNotification): string {
  const coverage = notification.result.coverage;
  if (!coverage) {
    return notification.lane === "LLM"
      ? "Структурированных данных о фактически проверенных сайтах в этом результате нет."
      : "Структурированных данных о фактически выполненном сравнении в этом результате нет.";
  }

  const parts: string[] = [];
  const observedAt = observedAtPlusFive(coverage.observedAt);
  if (observedAt) parts.push(`Время наблюдения: ${observedAt}.`);
  if (coverage.testedTargets.length > 0)
    parts.push(`Проверено: ${compactTargets(coverage.testedTargets)}.`);
  if (coverage.unverifiedTargets.length > 0)
    parts.push(`Не проверено: ${compactTargets(coverage.unverifiedTargets)}.`);

  if (coverage.checkDepth === "PUBLIC_NO_SESSION")
    parts.push("Глубина: публичная проверка без входа в аккаунт.");
  else if (coverage.checkDepth === "SCHEDULED_EXECUTION")
    parts.push(
      "Глубина: автоматический цикл; этот уровень сам по себе не подтверждает проверку конкретных сайтов.",
    );
  else if (coverage.checkDepth === "API_SOURCE_ACQUISITION")
    parts.push(
      "Получение официальных документов выполнено; сравнение версий API не выполнялось.",
    );
  else if (coverage.comparisonState === "COMPLETED")
    parts.push("Сравнение документов API выполнено по всем указанным целям.");
  else if (coverage.comparisonState === "PARTIAL")
    parts.push("Сравнение документов API выполнено только по части целей.");
  else parts.push("Сравнение документов API не выполнялось.");

  if (coverage.changeSeverity === "BLOCKING_RISK")
    parts.push("Найдены изменения с риском блокировки; требуется разбор.");
  else if (coverage.changeSeverity === "REVIEW_REQUIRED")
    parts.push("Найдены изменения, требующие проверки.");
  else if (coverage.changeSeverity === "UNKNOWN")
    parts.push("Значимость наблюдаемых изменений пока не определена.");
  else if (
    coverage.changeSeverity === "NO_POLICY_IMPACT" &&
    coverage.comparisonState === "COMPLETED"
  )
    parts.push(
      "По выполненному сравнению изменений, влияющих на текущие правила, не найдено.",
    );

  return parts.join(" ");
}

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
        ? result.coverage
          ? "Цикл автоматических проверок завершён без зарегистрированной ошибки выполнения."
          : "Цикл автоматических проверок завершён без зарегистрированной ошибки выполнения. В этом сообщении нет перечня фактически проверенных сайтов."
        : result.coverage
          ? "Проверка завершилась."
          : "Проверка завершилась. В этом сообщении нет сведений о полноте проверки и найденных изменениях.";
  } else {
    text =
      "В отчёте недостаточно сведений, чтобы объяснить результат проверки. Неизвестные или противоречивые данные требуют разбора; считать всё исправным нельзя.";
  }
  const label = lane === "LLM" ? "Сайты ИИ" : "API маркетплейсов";
  return [
    `${label}: ${text}`,
    explainCoverage(notification),
    lane === "LLM" ? extensionBoundary : "",
  ]
    .filter(Boolean)
    .join(" ");
}
