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
export default function ServiceAccessPanel({
  apiOrigin,
}: {
  apiOrigin: string;
}) {
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
      const result = await controlPlane<{
        grant: Grant;
        credential: { token: string; expiresAt: string };
      }>("/v1/admin/maintenance-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Controller",
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
      // Credential is delivered once, never placed in the DOM or browser storage.
      const blob = new Blob(
        [
          JSON.stringify({
            version: 1,
            origin: apiOrigin,
            ...result.credential,
            rotatedAt: new Date().toISOString(),
          }),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "octoport-maintenance-credential.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "Доступ создан. Файл содержит секретный ключ; передайте его только доверенному средству обслуживания.",
      );
      await reload();
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
      <button disabled={busy} onClick={() => void create()}>
        Создать доступ и скачать ключ
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
