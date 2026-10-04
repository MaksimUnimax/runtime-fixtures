"use client";
import { useEffect, useState } from "react";
import { controlPlane, ControlPlaneError } from "../../lib/control-plane";

type Grant = {
  id: string;
  label: string;
  permissions: string[];
  expiresAt: string;
  revokedAt: string | null;
};
export default function ServiceAccessPanel() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function reload() {
    const result = await controlPlane<{ grants: Grant[] }>(
      "/v1/admin/maintenance-grants",
    );
    setGrants(result.grants);
  }
  function report(error: unknown) {
    setMessage(
      error instanceof ControlPlaneError
        ? "Операция не выполнена: " + error.code
        : "Не удалось связаться с сервером.",
    );
  }
  useEffect(() => {
    void reload().catch(report);
  }, []);
  async function create() {
    setBusy(true);
    setMessage("");
    try {
      await controlPlane<{
        grant: Grant;
        delivery: "server";
        saved: true;
      }>("/v1/admin/maintenance-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Controller",
          delivery: "server",
          permissions: [
            "compatibility.read",
            "compatibility.manage",
            "health.read",
            "ai.registry.read",
            "ai.registry.manage",
            "ai.profile.read",
            "ai.profile.manage",
            "ai.assignment.read",
            "ai.assignment.manage",
          ],
        }),
      });
      setMessage(
        "Доступ сохранён на сервере. Контроллер может продолжить работу.",
      );
      await reload().catch(() =>
        setMessage(
          "Доступ сохранён на сервере. Не удалось обновить список доступов.",
        ),
      );
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await controlPlane("/v1/admin/maintenance-grants/" + id, {
        method: "DELETE",
      });
      setMessage("Доступ отозван.");
      await reload();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <h1>Доступ для обслуживания</h1>
      <p>
        Контроллер может обслуживать совместимость версий, настройки ИИ и читать
        состояние сервиса. Управление пользователями, оплатой и администраторами
        в этот доступ не входит.
      </p>
      <p>
        Ключ обновляется автоматически при работе. Доступ можно отозвать в любой
        момент. После 30 дней без обновления ключ перестаёт действовать.
      </p>
      <p>
        Ключ сохраняется в закрытом файле на сервере. Скачивать и переносить его
        вручную не нужно.
      </p>
      <button disabled={busy} onClick={() => void create()}>
        Создать доступ на сервере
      </button>
      <p role="status">{message}</p>
      <ul>
        {grants.map((grant) => (
          <li key={grant.id}>
            {grant.label} —{" "}
            {grant.revokedAt
              ? "отозван"
              : "срок ключа до " + new Date(grant.expiresAt).toLocaleString()}
            {!grant.revokedAt && (
              <button disabled={busy} onClick={() => void revoke(grant.id)}>
                Отозвать доступ
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
