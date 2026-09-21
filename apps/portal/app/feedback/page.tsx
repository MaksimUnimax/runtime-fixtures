"use client";

import { FormEvent, useEffect, useState } from "react";
import { controlPlane } from "../../lib/control-plane";
import {
  FEEDBACK_CATEGORIES,
  buildFeedbackPayload,
} from "../../lib/feedback-ui";

type Account = { id: string; displayName: string | null; status: string };
type CaseItem = {
  caseId: string;
  category: string;
  severity: string;
  status: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export default function FeedbackPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [accountId, setAccountId] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [description, setDescription] = useState("");
  const [diagnostics, setDiagnostics] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  const load = async () => {
    setBusy(true);
    const [accountResponse, caseResponse] = await Promise.all([
      controlPlane("/v1/accounts"),
      controlPlane("/v1/support/cases"),
    ]);
    if (accountResponse.ok) {
      const data = (await accountResponse.json()) as { accounts: Account[] };
      setAccounts(data.accounts);
      if (!accountId) setAccountId(data.accounts[0]?.id ?? "");
    }
    if (caseResponse.ok) {
      const data = (await caseResponse.json()) as { items: CaseItem[] };
      setCases(data.items);
    }
    setBusy(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    const response = await controlPlane("/v1/support/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildFeedbackPayload({
          accountId,
          category,
          description,
          includeDiagnostics: diagnostics,
        }),
      ),
    });
    if (!response.ok) {
      setMessage(
        "Не удалось отправить сообщение. Проверьте текст и повторите позже.",
      );
      return;
    }
    const data = (await response.json()) as { case: { caseId: string } };
    setDescription("");
    setMessage(`Сообщение принято. Номер обращения: ${data.case.caseId}`);
    await load();
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
            required
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={diagnostics}
            onChange={(event) => setDiagnostics(event.target.checked)}
          />
          Приложить только безопасные технические сведения
        </label>
        <button
          type="submit"
          disabled={busy || !accountId || !description.trim()}
        >
          Отправить
        </button>
      </form>
      {message && <p role="status">{message}</p>}
      <h2>Мои обращения</h2>
      {busy ? (
        <p role="status">Загрузка…</p>
      ) : cases.length === 0 ? (
        <p>Обращений пока нет.</p>
      ) : (
        <ul>
          {cases.map((item) => (
            <li key={item.caseId}>
              <strong>{item.category}</strong> — {item.status} —{" "}
              {item.description}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
