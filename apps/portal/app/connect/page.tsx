"use client";
import { useEffect, useRef, useState } from "react";
import {
  ConnectionCodeStatusV1Schema,
  ConnectionTransferDevicesV1Schema,
} from "@product/contracts";
import { controlPlane } from "../../lib/control-plane";
import {
  parseConnectionIssueAttempt,
  requestConnectionCode,
  selectConnectionIssueAttempt,
  type ConnectionIssueAttempt,
  type ConnectionIssueInput,
} from "../../lib/connection-code-outcome";

type Account = { id: string; displayName: string | null; status: string };
type Device = {
  deviceId: string;
  label: string | null;
  createdAt: string;
  approvedAt: string | null;
};
type Credential = {
  credentialId: string;
  generation: number;
  createdAt: string;
  active: boolean;
} | null;
export default function Connect() {
  const [accounts, setAccounts] = useState<Account[]>([]),
    [account, setAccount] = useState("");
  const [credential, setCredential] = useState<Credential>(null),
    [loaded, setLoaded] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]),
    [code, setCode] = useState(""),
    [message, setMessage] = useState("");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<ConnectionIssueAttempt>(),
    [emergency, setEmergency] = useState(false);
  const [confirmDevice, setConfirmDevice] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const epoch = useRef(0),
    flight = useRef(false),
    controller = useRef<AbortController | null>(null),
    selected = useRef("");
  const storageKey = (id: string) => "octoport.connection.issue.v1:" + id;
  const reauthenticate = () => location.assign("/login?returnTo=%2Fconnect");
  const load = async (id: string, version: number) => {
    try {
      const [status, list] = await Promise.all([
        controlPlane(
          "/v1/connection-codes?accountId=" + encodeURIComponent(id),
          { cache: "no-store" },
        ),
        controlPlane(
          "/v1/connection-codes/devices?accountId=" + encodeURIComponent(id),
          { cache: "no-store" },
        ),
      ]);
      if (version !== epoch.current || selected.current !== id) return;
      if (status.status === 401) {
        reauthenticate();
        return;
      }
      if (!status.ok || !list.ok) throw new Error("UNAVAILABLE");
      const value = ConnectionCodeStatusV1Schema.parse(await status.json()),
        rows = ConnectionTransferDevicesV1Schema.parse(await list.json());
      if (version !== epoch.current || selected.current !== id) return;
      setCredential(value.credential);
      setDevices(rows.devices);
      setLoaded(true);
    } catch {
      if (version === epoch.current)
        setMessage(
          "Не удалось проверить состояние аккаунта. Обновите страницу; новый код автоматически не выпускается.",
        );
    }
  };
  useEffect(() => {
    let live = true;
    void controlPlane("/v1/accounts", { cache: "no-store" })
      .then(async (response) => {
        if (!live) return;
        if (!response.ok) {
          reauthenticate();
          return;
        }
        const rows = (await response.json()).accounts as Account[];
        if (live) {
          setAccounts(rows);
          if (rows[0]) setAccount(rows[0].id);
        }
      })
      .catch(() => {
        if (live) setMessage("Нет связи с кабинетом.");
      });
    return () => {
      live = false;
      epoch.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const version = ++epoch.current;
    selected.current = account;
    setCode("");
    setLoaded(false);
    setCredential(null);
    setDevices([]);
    setEmergency(false);
    setConfirmDevice("");
    setConfirmation("");
    let prior: ConnectionIssueAttempt | undefined;
    let unreadable = false;
    try {
      const raw = account ? sessionStorage.getItem(storageKey(account)) : null;
      prior = parseConnectionIssueAttempt(raw, account);
      unreadable = raw !== null && prior === undefined;
    } catch {
      unreadable = true;
    }
    setStorageBlocked(unreadable);
    setPending(prior);
    setMessage(
      unreadable
        ? "Не удалось прочитать сохранённую попытку. Новый выпуск заблокирован: восстановите хранилище вкладки и обновите страницу."
        : prior
          ? "Исход предыдущего выпуска ещё не подтверждён. Сначала проверьте ту же попытку."
          : "",
    );
    if (account) void load(account, version);
  }, [account]);
  const issue = async (mode: ConnectionIssueInput["mode"]) => {
    if (flight.current || !loaded || !account || storageBlocked) return;
    if (!pending && mode === "REPLACE_REVOKE_DEVICES" && !emergency) return;
    const input: ConnectionIssueInput = pending?.input ?? {
      accountId: account,
      expectedGeneration: credential?.generation ?? 0,
      mode,
    };
    let attempt: ConnectionIssueAttempt;
    try {
      attempt = selectConnectionIssueAttempt(pending, input, () =>
        crypto.randomUUID(),
      );
      // Persist only operation metadata, never the secret or a portal credential.
      sessionStorage.setItem(storageKey(account), JSON.stringify(attempt));
    } catch {
      setMessage(
        "Нельзя безопасно сохранить попытку. Разрешите хранилище вкладки и повторите.",
      );
      return;
    }
    flight.current = true;
    setBusy(true);
    setPending(attempt);
    setCode("");
    setMessage("");
    const id = account,
      version = epoch.current,
      abort = new AbortController();
    controller.current = abort;
    const result = await requestConnectionCode(() =>
      controlPlane("/v1/connection-codes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": attempt.key,
        },
        body: JSON.stringify(attempt.input),
        signal: abort.signal,
        cache: "no-store",
      }),
    );
    flight.current = false;
    setBusy(false);
    controller.current = null;
    if (version !== epoch.current || selected.current !== id) return;
    if (result.kind === "CONFIRMED") {
      try {
        sessionStorage.removeItem(storageKey(id));
      } catch {
        // The confirmed terminal response is authoritative. If metadata remains,
        // a reload can only replay this same idempotent attempt, never its secret.
      }
      setPending(undefined);
      setCredential(result.value.credential);
      if (result.value.status === "created") {
        setCode(result.value.code);
        setMessage(
          result.value.revokedDevices
            ? "Новый код выпущен. Устройства отозваны: " +
                result.value.revokedDevices +
                ". Офлайн-устройство узнает об отзыве по действующей политике связи и сроков допуска."
            : "Сохраните код сейчас. После закрытия страницы он больше не показывается.",
        );
      } else
        setMessage(
          "Сервер подтверждает прошлый выпуск. Код повторно не раскрывается. Если он не сохранён, явно замените его.",
        );
      setEmergency(false);
      void load(id, version);
      return;
    }
    if (result.kind === "CONFLICT" || result.kind === "REJECTED") {
      try {
        sessionStorage.removeItem(storageKey(id));
      } catch {
        // The confirmed terminal response is authoritative. If metadata remains,
        // a reload can only replay this same idempotent attempt, never its secret.
      }
      setPending(undefined);
      setMessage(
        result.kind === "CONFLICT"
          ? "Состояние изменилось. Прежний код не показывается; проверьте актуальное состояние перед новой заменой."
          : "Операция отклонена.",
      );
      void load(id, version);
      return;
    }
    if (result.kind === "REAUTH_REQUIRED") {
      setMessage(
        "Для выпуска или замены подтвердите почту ещё раз. Сохранённая попытка будет продолжена после входа.",
      );
      return;
    }
    setMessage(
      result.kind === "RATE_LIMITED"
        ? "Слишком много попыток. Повторите ту же попытку позже."
        : "Ответ не подтверждён. Новый выпуск не запускается. Кнопка ниже повторно проверит только ту же попытку.",
    );
  };
  const approve = async () => {
    if (
      flight.current ||
      !account ||
      !confirmDevice ||
      confirmation.trim().toLowerCase() !==
        confirmDevice.slice(-8).toLowerCase()
    )
      return;
    flight.current = true;
    setBusy(true);
    const version = epoch.current,
      id = account,
      deviceId = confirmDevice;
    try {
      const response = await controlPlane(
        "/v1/connection-codes/devices/approve-transfer",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: id, deviceId }),
          cache: "no-store",
        },
      );
      const value = await response.json();
      if (version !== epoch.current) return;
      if (!response.ok) {
        setMessage(
          value?.error?.code === "CONNECTION_REAUTH_REQUIRED"
            ? "Подтвердите почту ещё раз перед разрешением переноса."
            : "Подтверждение не получено. Проверьте состояние устройства перед повтором.",
        );
      } else {
        setMessage(
          "Получение ключей разрешено этой установке. Выбор магазинов и согласие на передачу выполняются отдельно в расширении.",
        );
        setConfirmDevice("");
        setConfirmation("");
      }
      await load(id, version);
    } catch {
      if (version === epoch.current)
        setMessage(
          "Исход подтверждения неизвестен. Обновите список устройств; повтор подтверждения не создаёт новую установку.",
        );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  const active = accounts.find((a) => a.id === account)?.status === "ACTIVE";
  return (
    <main>
      <h1>Подключение расширения</h1>
      <p>
        Секретный код подключает отдельный браузер к вашему аккаунту.
        Сохранённый код можно ввести в другом браузере без повторного посещения
        сайта. Не передавайте его другим людям или ИИ.
      </p>
      <label>
        Аккаунт{" "}
        <select
          value={account}
          disabled={busy}
          onChange={(e) => setAccount(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName ?? a.id} — {a.status}
            </option>
          ))}
        </select>
      </label>
      {account && (
        <p>
          Публичный ID аккаунта: <code>{account}</code>. Это не код входа.
        </p>
      )}
      {loaded && (
        <p>
          {credential
            ? "Код уже выпущен. Он не хранится в открытом виде и повторно не показывается."
            : "Код подключения ещё не выпущен."}
        </p>
      )}
      <div>
        {pending && (
          <p>
            Сохранённое действие:{" "}
            {pending.input.mode === "REPLACE_REVOKE_DEVICES"
              ? "заменить код и отозвать все устройства этого аккаунта"
              : pending.input.mode === "CREATE"
                ? "выпустить первый код"
                : "заменить код с сохранением устройств"}
            .
          </p>
        )}
        {pending ? (
          <button
            disabled={busy || !loaded || storageBlocked}
            onClick={() => void issue(pending.input.mode)}
          >
            Проверить ту же попытку
          </button>
        ) : (
          <button
            disabled={busy || !loaded || !active || storageBlocked}
            onClick={() =>
              void issue(credential ? "REPLACE_KEEP_DEVICES" : "CREATE")
            }
          >
            {credential
              ? "Заменить код, оставить устройства"
              : "Получить код подключения"}
          </button>
        )}
        <button disabled={busy} onClick={reauthenticate}>
          Подтвердить почту
        </button>
        {busy && controller.current && (
          <button onClick={() => controller.current?.abort()}>
            Прекратить ожидание ответа
          </button>
        )}
      </div>
      {credential && !pending && (
        <section>
          <h2>При подозрении на кражу</h2>
          <p>
            Обычная замена закрывает новые подключения старым кодом. Аварийная
            замена дополнительно отзывает все подключённые устройства только
            этого аккаунта. Кабинет остаётся открыт; локальные файлы и ключи
            устройств не удаляются.
          </p>
          <label>
            <input
              type="checkbox"
              checked={emergency}
              disabled={busy}
              onChange={(e) => setEmergency(e.target.checked)}
            />{" "}
            Понимаю, что все устройства этого аккаунта будут отозваны
          </label>
          <button
            disabled={busy || !emergency || !active || storageBlocked}
            onClick={() => void issue("REPLACE_REVOKE_DEVICES")}
          >
            Заменить код и отозвать устройства
          </button>
        </section>
      )}
      {code && (
        <section>
          <h2>Сохраните секретный код</h2>
          <input
            aria-label="Секретный код подключения"
            value={code}
            readOnly
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(code)
                .then(() =>
                  setMessage(
                    "Код скопирован. Сохраните его в защищённом месте.",
                  ),
                )
                .catch(() =>
                  setMessage(
                    "Копирование недоступно. Выделите и сохраните код вручную.",
                  ),
                )
            }
          >
            Копировать
          </button>
          <button onClick={() => setCode("")}>
            Скрыть и забыть на странице
          </button>
        </section>
      )}
      <p role="status">{message}</p>
      <section>
        <h2>Получение ключей магазинов новым браузером</h2>
        <p>
          Подключение кодом само по себе не переносит ключи. Перед
          подтверждением сравните ID установки с расширением в нужном браузере.
        </p>
        <button
          disabled={busy || !account}
          onClick={() => void load(account, epoch.current)}
        >
          Обновить список
        </button>
        <ul>
          {devices.map((d) => (
            <li key={d.deviceId}>
              {d.label ?? "Браузер"} — <code>{d.deviceId}</code> —{" "}
              {d.approvedAt ? (
                "получение ключей разрешено"
              ) : (
                <button
                  disabled={busy}
                  onClick={() => {
                    setConfirmDevice(d.deviceId);
                    setConfirmation("");
                  }}
                >
                  Разрешить получение ключей
                </button>
              )}
            </li>
          ))}
        </ul>
        {confirmDevice && (
          <div>
            <p>
              Разрешить получение выбранных в расширении магазинов установке{" "}
              <code>{confirmDevice}</code>.
            </p>
            <label>
              Введите последние 8 символов ID из нужного расширения{" "}
              <input
                value={confirmation}
                disabled={busy}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button
              disabled={
                busy ||
                confirmation.trim().toLowerCase() !==
                  confirmDevice.slice(-8).toLowerCase()
              }
              onClick={() => void approve()}
            >
              Подтверждаю эту установку
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setConfirmDevice("");
                setConfirmation("");
              }}
            >
              Отмена
            </button>
          </div>
        )}
      </section>
      <a href="/devices">Все устройства и индивидуальный отзыв</a>
    </main>
  );
}
