import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseRuntime } from "./index.js";
import { runMigrations } from "./migrations.js";
import { createHealthAdminReadRepository } from "./health-admin-read-repository.js";
import { createHealthNotificationAdminReadRepository } from "./health-notification-admin-read-repository.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const runtime = createDatabaseRuntime(connectionString);
const repository = createHealthAdminReadRepository(runtime);
const notificationRepository =
  createHealthNotificationAdminReadRepository(runtime);

describe("S2-L7 Health admin read PostgreSQL composition", () => {
  beforeAll(async () => {
    await runtime.query("DROP SCHEMA IF EXISTS public CASCADE");
    await runtime.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runtime.query("CREATE SCHEMA public");
    await runMigrations({ connectionString });
  });
  afterAll(async () => runtime.close());

  it("executes bounded empty target, incident, evaluation, and recommendation reads", async () => {
    await expect(
      repository.listTargets({ limit: 1, activeOnly: false }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    await expect(
      repository.listIncidents({ limit: 1, activeOnly: false }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    await expect(repository.listEvaluations({ limit: 1 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await expect(repository.listRecommendations({ limit: 1 })).resolves.toEqual(
      { items: [], nextCursor: null },
    );
  });

  it("executes bounded notification reads without exposing mutation state", async () => {
    await expect(
      notificationRepository.listNotifications({ limit: 1 }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    await expect(
      notificationRepository.getNotification(
        "00000000-0000-4000-8000-000000000000",
      ),
    ).resolves.toBeNull();
    expect(notificationRepository).not.toHaveProperty("claimDue");
    expect(notificationRepository).not.toHaveProperty("markDelivered");
    expect(notificationRepository).not.toHaveProperty("failClaim");
  });
});
