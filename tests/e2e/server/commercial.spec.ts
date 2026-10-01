import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  accountId,
  activeCommercialPeriodEnd,
  login,
  reset,
  sql,
} from "./support/fixtures.js";

const at = (value: string) => new Date(value);

async function seedSubscription(
  options: { state?: string; price?: boolean } = {},
) {
  const id = await accountId();
  const plan = randomUUID(),
    revision = randomUUID();
  await sql("INSERT INTO plans(id,code,status) VALUES($1,$2,'ACTIVE')", [
    plan,
    `e2e-${plan.replaceAll("-", "")}`,
  ]);
  await sql(
    "INSERT INTO plan_revisions(id,plan_id,revision,state,display_name,description) VALUES($1,$2,1,'DRAFT','E2E Pro','E2E plan')",
    [revision, plan],
  );
  await sql(
    "INSERT INTO entitlement_definitions(entitlement_key,value_type,security_classification,description) VALUES('device.max_active','INTEGER','LIMIT','Device limit') ON CONFLICT (entitlement_key) DO NOTHING",
  );
  await sql(
    "INSERT INTO plan_entitlements(plan_revision_id,entitlement_key,integer_value) VALUES($1,'device.max_active',2)",
    [revision],
  );
  await sql(
    "UPDATE plan_revisions SET state='PUBLISHED',published_at=$2 WHERE id=$1",
    [revision, at("2026-09-01T00:00:00.000Z")],
  );
  let priceRevision: string | null = null;
  if (options.price !== false) {
    const price = randomUUID();
    priceRevision = randomUUID();
    await sql(
      "INSERT INTO prices(id,plan_id,code,market_key,channel_key,status) VALUES($1,$2,$3,'global','direct','ACTIVE')",
      [price, plan, `e2e-price-${price.replaceAll("-", "")}`],
    );
    await sql(
      "INSERT INTO price_revisions(id,price_id,plan_revision_id,revision,state,amount_minor,currency,billing_interval_unit,billing_interval_count,effective_from,published_at) VALUES($1,$2,$3,1,'PUBLISHED',14900,'EUR','MONTH',1,$4,$4)",
      [priceRevision, price, revision, at("2026-09-01T00:00:00.000Z")],
    );
  }
  await sql(
    "UPDATE subscriptions SET state=$2,state_revision=state_revision+1,current_plan_revision_id=$3,bound_price_revision_id=$4,current_period_end=$5,grace_until=NULL,cancel_at_period_end=false,state_reason='e2e' WHERE account_id=$1 AND state <> 'EXPIRED'",
    [
      id,
      options.state ?? "ACTIVE",
      revision,
      priceRevision,
      activeCommercialPeriodEnd(),
    ],
  );
  return id;
}

test.beforeEach(async () => reset());

test("billing redirects unauthenticated visitors to login with returnTo", async ({
  page,
}) => {
  await page.goto("/billing");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fbilling$/);
});

test("billing provides the owned-account selector", async ({ page }) => {
  await login(page, "/billing");
  await expect(page.getByLabel("Account")).toBeVisible();
});

test("billing displays an eligible subscription and exact plan", async ({
  page,
}) => {
  await login(page, "/billing");
  await seedSubscription();
  await page.reload();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E Pro")).toBeVisible();
});

test("billing displays an ineligible subscription without allowance", async ({
  page,
}) => {
  await login(page, "/billing");
  await seedSubscription({ state: "PAST_DUE" });
  await page.reload();
  await expect(
    page.getByText("INELIGIBLE", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("PAST_DUE", { exact: true })).toBeVisible();
  await expect(page.getByText("Active devices: 0 / unavailable")).toBeVisible();
});

test("billing displays the commercial device allowance", async ({ page }) => {
  await login(page, "/billing");
  await seedSubscription();
  await page.reload();
  await expect(page.getByText("Active devices: 0 / 2")).toBeVisible();
});

test("billing displays safe payment history", async ({ page }) => {
  await login(page, "/billing");
  const id = await seedSubscription();
  const price = (
    await sql<{ id: string }>(
      "SELECT bound_price_revision_id AS id FROM subscriptions WHERE account_id=$1",
      [id],
    )
  )[0]!.id;
  await sql(
    "INSERT INTO payments(account_id,provider,provider_payment_id,price_revision_id,amount_minor,currency,state,idempotency_key_hash,request_fingerprint_sha256) VALUES($1,'fake.billing','private-provider-id',$2,14900,'EUR','SUCCEEDED',$3,$4)",
    [id, price, "a".repeat(64), "b".repeat(64)],
  );
  await page.reload();
  await expect(page.getByText("Payment history")).toBeVisible();
  await expect(page.getByText("SUCCEEDED")).toBeVisible();
  await expect(page.getByText("private-provider-id")).not.toBeVisible();
});

test("billing supports a manual subscription without a price", async ({
  page,
}) => {
  await login(page, "/billing");
  await seedSubscription({ price: false });
  await page.reload();
  await expect(page.getByText("Price: not available")).toBeVisible();
});

test("billing purchase state is visibly unavailable and read-only", async ({
  page,
}) => {
  await login(page, "/billing");
  await seedSubscription();
  await page.reload();
  await expect(
    page.getByText("Online payment is not enabled yet."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /purchase|checkout|pay/i }),
  ).toHaveCount(0);
});
