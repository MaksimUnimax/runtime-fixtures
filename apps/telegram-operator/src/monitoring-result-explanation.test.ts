import { describe, expect, it } from "vitest";
import type {
  MonitoringNotification,
  MonitoringRunResult,
} from "@product/monitoring-control";
import { explainMonitoringResult } from "./monitoring-result-explanation.js";

function notification(
  code: string | null,
  status: MonitoringRunResult["status"],
  lane: MonitoringNotification["lane"] = "LLM",
): MonitoringNotification {
  return {
    lane,
    source: "SCHEDULED",
    runId: "00000000-0000-4000-8000-000000000001",
    result: { code, status, summary: "upstream-private-text" },
  };
}

describe("bounded Russian monitoring explanations", () => {
  it("does not label a scheduler failure as a site or login failure", () => {
    const text = explainMonitoringResult(
      notification("HEALTH_SCHEDULER_EXECUTION_FAILED", "FAILED"),
    );
    expect(text).toContain("Часть автоматических проверок ИИ не завершилась");
    expect(text).toContain("нет точной причины");
    expect(text).toContain(
      "нельзя заключить, что сайт сломался или требуется вход",
    );
    expect(text).not.toContain(
      "часть поверхностей недоступна или требует входа",
    );
  });

  it.each([
    ["PROVIDER_SURFACE_DRIFT", "FAILED", "признаки изменения или сбоя"],
    ["AUTH_REQUIRED", "AUTH_REQUIRED", "нельзя проверить без входа"],
    [
      "NO_SESSION_NOT_OBSERVABLE",
      "NOT_OBSERVABLE",
      "мешает ли сайт, сеть или браузер",
    ],
  ] as const)(
    "explains %s without claiming installed acceptance",
    (code, status, expected) => {
      const text = explainMonitoringResult(notification(code, status));
      expect(text).toContain(expected);
      expect(text).toContain("Работа кнопок расширения");
      expect(text).toContain("не подтверждены");
    },
  );

  it.each([
    [
      "API_SOURCE_CANDIDATE_ACQUIRED",
      "SUCCEEDED",
      "ещё не означает, что версия API сравнена",
    ],
    [
      "OPERATOR_SOURCE_REQUIRED",
      "SOURCE_UNAVAILABLE",
      "нужен разрешённый операторский источник",
    ],
    [
      "API_SOURCE_TEMPORARILY_UNAVAILABLE",
      "NOT_OBSERVABLE",
      "временно недоступен",
    ],
    [
      "SOURCE_URL_AUTHORITY_MISSING",
      "NOT_OBSERVABLE",
      "нет принятой официальной адресной основы",
    ],
    [
      "INVALID_OFFICIAL_SOURCE_RESPONSE",
      "FAILED",
      "отклонён проверкой формата или происхождения",
    ],
    [
      "API_SOURCE_UNAVAILABLE",
      "SOURCE_UNAVAILABLE",
      "Не удалось получить официальный документ",
    ],
    [
      "API_WATCH_REPORT_BLOCKED",
      "NOT_OBSERVABLE",
      "не удалось ли их получить или подтвердить",
    ],
    [
      "API_WATCH_REPORT_PARTIAL",
      "NOT_OBSERVABLE",
      "Часть источников осталась непроверенной",
    ],
    [
      "API_WATCH_REPORT_COMPLETED",
      "SUCCEEDED",
      "не подтверждает работу расширения",
    ],
    ["API_WATCH_REPORT_FAILED", "FAILED", "Точная причина"],
  ] as const)(
    "explains %s without assuming unchanged or repaired APIs",
    (code, status, expected) => {
      const text = explainMonitoringResult(
        notification(code, status, "SWAGGER_API"),
      );
      expect(text).toContain(expected);
      expect(text).not.toContain("upstream-private-text");
    },
  );

  it.each(["LLM", "SWAGGER_API"] as const)(
    "keeps a generic runner failure generic for %s",
    (lane) => {
      const text = explainMonitoringResult(
        notification("MONITORING_EXECUTION_FAILED", "FAILED", lane),
      );
      expect(text).toContain("Служба мониторинга не смогла завершить проверку");
      expect(text).toContain("Точная причина");
      expect(text).not.toContain("без входа");
    },
  );

  it.each([
    ["AUTH_REQUIRED", "SUCCEEDED", "LLM"],
    ["API_WATCH_REPORT_COMPLETED", "FAILED", "SWAGGER_API"],
    ["API_WATCH_REPORT_COMPLETED", "SUCCEEDED", "LLM"],
    ["AUTH_REQUIRED", "AUTH_REQUIRED", "SWAGGER_API"],
    ["UNKNOWN_FUTURE_RESULT", "SUCCEEDED", "LLM"],
    ["UNKNOWN_FUTURE_RESULT", "FAILED", "SWAGGER_API"],
    [null, "FAILED", "LLM"],
  ] as const)(
    "does not trust an unknown or inconsistent triple %s/%s/%s",
    (code, status, lane) => {
      const text = explainMonitoringResult(notification(code, status, lane));
      expect(text).toContain("недостаточно сведений");
      expect(text).toContain("считать всё исправным нельзя");
    },
  );

  it("does not invent coverage or completed checks from an empty successful cycle", () => {
    const input = notification(null, "SUCCEEDED");
    input.result.summary =
      "Durable Health cycle: materialized=0, claimed=0, succeeded=0, failed=0, reconciled=0.";
    const text = explainMonitoringResult(input);
    expect(text).toContain("Цикл автоматических проверок завершён");
    expect(text).toContain("нет перечня фактически проверенных сайтов");
    expect(text).toContain("не подтверждены");
    expect(text).not.toContain("все сайты");
  });

  it("keeps a forced public check distinct from the scheduled cycle", () => {
    const input = notification(null, "SUCCEEDED");
    input.source = "FORCED";
    const text = explainMonitoringResult(input);
    expect(text).toContain("нет сведений о полноте проверки");
    expect(text).not.toContain("Цикл автоматических");
  });

  it("uses structured LLM coverage without upgrading public checks to authenticated acceptance", () => {
    const input = notification("PROVIDER_SURFACE_DRIFT", "FAILED");
    input.result.coverage = {
      observedAt: "2026-09-28T10:00:02.000Z",
      checkDepth: "PUBLIC_NO_SESSION",
      testedTargets: ["CHATGPT_STANDARD", "GEMINI"],
      unverifiedTargets: ["CHATGPT_WORK", "DEEPSEEK"],
      comparisonState: "NOT_APPLICABLE",
      changeSeverity: "REVIEW_REQUIRED",
    };
    const text = explainMonitoringResult(input);
    expect(text).toContain("Время наблюдения: 28.09.2026 15:00 +05");
    expect(text).toContain("Проверено: ChatGPT Standard, Gemini");
    expect(text).toContain("Не проверено: ChatGPT Work, DeepSeek");
    expect(text).toContain("публичная проверка без входа");
    expect(text).toContain("Найдены изменения, требующие проверки");
    expect(text).toContain("Работа кнопок расширения");
  });

  it("reports completed API comparison only from structured coverage", () => {
    const input = notification(
      "API_WATCH_REPORT_COMPLETED",
      "SUCCEEDED",
      "SWAGGER_API",
    );
    input.result.coverage = {
      observedAt: "2026-09-28T11:30:00.000Z",
      checkDepth: "API_DOCUMENT_COMPARISON",
      testedTargets: ["OZON_SELLER:seller-public", "WILDBERRIES:products"],
      unverifiedTargets: [],
      comparisonState: "COMPLETED",
      changeSeverity: "NO_POLICY_IMPACT",
    };
    const text = explainMonitoringResult(input);
    expect(text).toContain("Проверено: Ozon Seller, Wildberries");
    expect(text).toContain(
      "Сравнение документов API выполнено по всем указанным целям",
    );
    expect(text).toContain(
      "изменений, влияющих на текущие правила, не найдено",
    );
    expect(text).not.toContain("сравнение не выполнялось");
  });

  it("keeps acquisition-only API coverage distinct from version comparison", () => {
    const input = notification(
      "API_SOURCE_CANDIDATE_ACQUIRED",
      "SUCCEEDED",
      "SWAGGER_API",
    );
    input.result.coverage = {
      observedAt: "2026-09-28T11:30:00.000Z",
      checkDepth: "API_SOURCE_ACQUISITION",
      testedTargets: ["OZON_SELLER"],
      unverifiedTargets: ["WILDBERRIES"],
      comparisonState: "NOT_RUN",
      changeSeverity: null,
    };
    const text = explainMonitoringResult(input);
    expect(text).toContain("Проверено: Ozon Seller");
    expect(text).toContain("Не проверено: Wildberries");
    expect(text).toContain("сравнение версий API не выполнялось");
    expect(text).not.toContain("изменений нет");
  });

  it("never reproduces upstream summary, identifiers, tokens or raw codes", () => {
    const input = notification("UNKNOWN_UPSTREAM_SECRET", "FAILED");
    input.runId = "private-run-id";
    input.result.summary =
      "token=private-token https://private.example/chat/user-conversation";
    const text = explainMonitoringResult(input);
    for (const secret of [
      "private",
      "UNKNOWN_UPSTREAM_SECRET",
      "https://",
      "token=",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text.length).toBeLessThan(800);
  });
});
