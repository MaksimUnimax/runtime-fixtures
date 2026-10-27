"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { controlPlane } from "../../lib/control-plane";
import {
  FEEDBACK_CATEGORIES,
  buildFeedbackPayload,
  ownSupportResponse,
  type OwnSupportResponse,
} from "../../lib/feedback-ui";

type Account = { id: string; displayName: string | null; status: string };
type CaseItem = {
  caseId: string;
  category: string;
  status: string;
  description: string;
};
type SupportDetail =
  | { caseId: string; state: "loading" | "error" }
  | { caseId: string; state: "ready"; response: OwnSupportResponse };

const caseIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isAccount(value: unknown): value is Account {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.displayName === null || typeof value.displayName === "string") &&
    typeof value.status === "string"
  );
}
function isCase(value: unknown): value is CaseItem {
  return (
    isRecord(value) &&
    typeof value.caseId === "string" &&
    caseIdPattern.test(value.caseId) &&
    typeof value.category === "string" &&
    typeof value.status === "string" &&
    typeof value.description === "string"
  );
}

export default function FeedbackPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [accountId, setAccountId] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [description, setDescription] = useState("");
  const [diagnostics, setDiagnostics] = useState(false);
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [supportDetail, setSupportDetail] = useState<SupportDetail | null>(null);
  // Refs fence repeated events before React commits the disabled controls.
  const loading = useRef(false);
  const submitting = useRef(false);
  const detailLoading = useRef(false);
  const detailGeneration = useRef(0);

  const load = async () => {
    if (loading.current) return;
    loading.current = true;
    // Old own-case replies cannot survive a refreshed user-case list.
    detailGeneration.current++;
    detailLoading.current = false;
    setSupportDetail(null);
    setBusy(true);
    setLoadError("");
    try {
      const [accountResponse, caseResponse] = await Promise.all([
        controlPlane("/v1/accounts"),
        controlPlane("/v1/support/cases"),
      ]);
      if (!accountResponse.ok || !caseResponse.ok)
        throw new Error("FEEDBACK_LOAD_FAILED");
      const accountData: unknown = await accountResponse.json();
      const caseData: unknown = await caseResponse.json();
      if (
        !isRecord(accountData) ||
        !Array.isArray(accountData.accounts) ||
        !accountData.accounts.every(isAccount) ||
        !isRecord(caseData) ||
        !Array.isArray(caseData.items) ||
        !caseData.items.every(isCase)
      ) {
        throw new Error("FEEDBACK_LOAD_INVALID");
      }
      const loadedAccounts: Account[] = accountData.accounts;
      setAccounts(loadedAccounts);
      setAccountId((current) =>
        loadedAccounts.some((account) => account.id === current)
          ? current
          : (loadedAccounts[0]?.id ?? ""),
      );
      setCases(caseData.items);
    } catch {
      setLoadError(
        "Не удалось загрузить данные обратной связи. Нажмите «Обновить», чтобы проверить обращения.",
      );
    } finally {
      loading.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const showSupportReply = async (caseId: string) => {
    if (
      loading.current ||
      submitting.current ||
      detailLoading.current ||
      !caseIdPattern.test(caseId) ||
      !cases.some((item) => item.caseId === caseId)
    )
      return;
    const requestGeneration = ++detailGeneration.current;
    detailLoading.current = true;
    setSupportDetail({ caseId, state: "loading" });
    try {
      const response = await controlPlane(
        `/v1/support/cases/${encodeURIComponent(caseId)}`,
      );
      if (!response.ok) throw new Error("SUPPORT_DETAIL_NOT_CONFIRMED");
      const detail: unknown = await response.json();
      const projected = ownSupportResponse(detail, caseId);
      if (!projected) throw new Error("SUPPORT_DETAIL_INVALID");
      if (requestGeneration === detailGeneration.current)
        setSupportDetail({ caseId, state: "ready", response: projected });
    } catch {
      if (requestGeneration === detailGeneration.current)
        setSupportDetail({ caseId, state: "error" });
    } finally {
      if (requestGeneration === detailGeneration.current)
        detailLoading.current = false;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      loading.current ||
      submitting.current ||
      !accountId ||
      !description.trim()
    )
      return;
    submitting.current = true;
    setSending(true);
    setMessage("");
    const submittedDescription = description;
    try {
      const response = await controlPlane("/v1/support/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildFeedbackPayload({
            accountId,
            category,
            description: submittedDescription,
            includeDiagnostics: diagnostics,
          }),
        ),
      });
      if (!response.ok) throw new Error("FEEDBACK_SUBMIT_UNCONFIRMED");
      const data: unknown = await response.json();
      if (
        !isRecord(data) ||
        !isRecord(data.case) ||
        typeof data.case.caseId !== "string" ||
        !data.case.caseId.trim()
      ) {
        throw new Error("FEEDBACK_SUBMIT_INVALID");
      }
      setDescription((current) =>
        current === submittedDescription ? "" : current,
      );
      setMessage(`Сообщение принято. Номер обращения: ${data.case.caseId}`);
      // A failed list refresh must not turn a confirmed submission into failure.
      await load();
    } catch {
      setMessage(
        "Не удалось подтвердить отправку. Текст сохранён. Проверьте список обращений перед повторной отправкой.",
      );
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };

  return (
    <main>
      <h1>Обратная связь</h1>
      <p>
        Опишите проблему. Не отправляйте пароли, коды, токены или файлы отчётов.
      </p>
      <p>
        <a href="/">На главную</a>
      </p>
      <form onSubmit={submit}>
        <label>
          Аккаунт
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            disabled={busy || sending}
            required
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName ?? account.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Категория
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={busy || sending}
          >
            {FEEDBACK_CATEGORIES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Описание
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4000}
            disabled={busy || sending}
            required
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={diagnostics}
            onChange={(event) => setDiagnostics(event.target.checked)}
            disabled={busy || sending}
          />
          Приложить только безопасные технические сведения
        </label>
        <button
          type="submit"
          disabled={busy || sending || !accountId || !description.trim()}
        >
          Отправить
        </button>
      </form>
      {sending && <p role="status">Отправка…</p>}
      {message && <p role="status">{message}</p>}
      <h2>Мои обращения</h2>
      <button
        type="button"
        onClick={() => void load()}
        disabled={busy || sending}
      >
        Обновить
      </button>
      {loadError && <p role="status">{loadError}</p>}
      {busy ? (
        <p role="status">Загрузка…</p>
      ) : cases.length > 0 ? (
        <ul>
          {cases.map((item) => (
            <li key={item.caseId}>
              <strong>{item.category}</strong> — {item.status} —{" "}
              {item.description}
              <p>Номер обращения: {item.caseId}</p>
              <button
                type="button"
                onClick={() => void showSupportReply(item.caseId)}
                disabled={busy || sending || supportDetail?.state === "loading"}
                aria-expanded={supportDetail?.caseId === item.caseId}
              >
                Проверить ответ поддержки
              </button>
              {supportDetail?.caseId === item.caseId ? (
                <section aria-label={`Ответ по обращению ${item.caseId}`}>
                  {supportDetail.state === "loading" ? (
                    <p role="status">Загрузка ответа…</p>
                  ) : supportDetail.state === "error" ? (
                    <p role="alert">
                      Не удалось подтвердить ответ по этому обращению.
                      Попробуйте проверить его ещё раз.
                    </p>
                  ) : (
                    <>
                      <p>Актуальный статус: {supportDetail.response.status}</p>
                      {supportDetail.response.replies.length === 0 ? (
                        <p>Ответ поддержки пока не поступил.</p>
                      ) : (
                        <ul>
                          {supportDetail.response.replies.map((reply) => (
                            <li key={reply.followupId}>
                              <strong>Ответ поддержки</strong> — {reply.body}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </section>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !loadError ? (
        <p>Обращений пока нет.</p>
      ) : null}
    </main>
  );
}
