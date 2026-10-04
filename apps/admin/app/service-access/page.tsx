import ServiceAccessPanel from "./access-panel";
import { controlPlaneOrigin } from "../../lib/control-plane-route";
export const dynamic = "force-dynamic";

export default function ServiceAccessPage() {
  const origin = controlPlaneOrigin();
  if (origin !== "https://api.octoport.ru")
    return (
      <main>
        Служебный доступ доступен только для настроенного сервера
        api.octoport.ru.
      </main>
    );
  return <ServiceAccessPanel />;
}
